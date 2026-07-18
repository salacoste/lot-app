const KEYS = Object.freeze(['from', 'to', 'company', 'category', 'confidence', 'reviewState', 'sourceStatus', 'offset', 'limit']);
const CATEGORIES = Object.freeze(['earthmoving', 'lifting', 'concrete-asphalt', 'roadbuilding', 'transport-support', 'attachments', 'other', 'unknown', 'ambiguous']);
const CONFIDENCE = Object.freeze(['high', 'medium', 'low', 'unknown']);
const REVIEW = Object.freeze(['auto-accepted', 'needs-review', 'unknown']);
const SOURCE = Object.freeze(['fresh', 'stale']);
const OUTCOMES = Object.freeze(['done-found', 'done-no-data', 'captcha-blocked', 'rate-limited', 'source-unavailable', 'timeout', 'schema-changed', 'failed', 'canceled']);
const BASE_CAVEATS = Object.freeze(['derived-observation', 'weak-party-role', 'not-risk-conclusion', 'source-reference-unavailable']);
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}]/u;

const exact = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
};
const oneOf = (value, allowed) => typeof value === 'string' && allowed.includes(value);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const guid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
const utc = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/u.test(value) && Number.isFinite(Date.parse(value));

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function dayNumber(value) { return Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000); }
function defaultDates(authorityDate) {
  const to = validDate(authorityDate) ? authorityDate : new Date().toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

export function normalizeCompany(value) {
  if (typeof value !== 'string' || FORBIDDEN.test(value)) return null;
  const normalized = value.normalize('NFKC').trim();
  const count = [...normalized].length;
  return count >= 2 && count <= 120 && !FORBIDDEN.test(normalized) ? normalized : null;
}

function strictDecode(value) {
  const bytes = [];
  for (let index = 0; index < value.length;) {
    if (value[index] === '%') {
      const hex = value.slice(index + 1, index + 3);
      if (!/^[0-9a-fA-F]{2}$/u.test(hex)) return null;
      bytes.push(Number.parseInt(hex, 16)); index += 3; continue;
    }
    const scalar = value.codePointAt(index);
    if (scalar === undefined || (scalar >= 0xd800 && scalar <= 0xdfff)) return null;
    bytes.push(...new TextEncoder().encode(String.fromCodePoint(scalar))); index += scalar > 0xffff ? 2 : 1;
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)); } catch { return null; }
}

function strictComponents(search) {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return { ok: true, entries: [] };
  const entries = [];
  for (const component of raw.split('&')) {
    const first = component.indexOf('=');
    if (first <= 0 || first !== component.lastIndexOf('=') || first === component.length - 1) return { ok: false, entries: [] };
    const key = strictDecode(component.slice(0, first)); const value = strictDecode(component.slice(first + 1));
    if (key === null || value === null || key === '' || value === '') return { ok: false, entries: [] };
    entries.push({ key, value, raw: component });
  }
  return { ok: true, entries };
}

function parseInteger(value, min, max) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) return null;
  const number = Number(value);
  return integer(number, min, max) ? number : null;
}

export function parseLeasingSearch(search, authorityDate) {
  const defaults = defaultDates(authorityDate);
  const errors = [];
  const parsed = strictComponents(search);
  if (!parsed.ok) errors.push('structure');
  const values = new Map();
  for (const entry of parsed.entries) {
    if (!KEYS.includes(entry.key)) errors.push('unknown');
    else if (values.has(entry.key)) errors.push('duplicate');
    else values.set(entry.key, entry.value);
  }
  const suppliedFrom = values.get('from') ?? null; const suppliedTo = values.get('to') ?? null;
  if ((suppliedFrom === null) !== (suppliedTo === null)) errors.push('date-pair');
  const from = suppliedFrom ?? defaults.from; const to = suppliedTo ?? defaults.to;
  if (!validDate(from) || !validDate(to) || dayNumber(from) > dayNumber(to) || dayNumber(to) - dayNumber(from) + 1 > 366) errors.push('date-range');
  const companyRaw = values.get('company') ?? null;
  const company = companyRaw === null ? null : normalizeCompany(companyRaw);
  if (companyRaw !== null && company === null) errors.push('company');
  const category = values.get('category') ?? null; const confidence = values.get('confidence') ?? null;
  const reviewState = values.get('reviewState') ?? null; const sourceStatus = values.get('sourceStatus') ?? null;
  if (category !== null && !CATEGORIES.includes(category)) errors.push('category');
  if (confidence !== null && !CONFIDENCE.includes(confidence)) errors.push('confidence');
  if (reviewState !== null && !REVIEW.includes(reviewState)) errors.push('reviewState');
  if (sourceStatus !== null && !SOURCE.includes(sourceStatus)) errors.push('sourceStatus');
  const offset = values.has('offset') ? parseInteger(values.get('offset'), 0, 10_000) : 0;
  const limit = values.has('limit') ? parseInteger(values.get('limit'), 1, 100) : 25;
  if (offset === null || limit === null) errors.push('page');
  return { ok: errors.length === 0, errors, useServerDefaults: parsed.entries.length === 0, filters: { from, to, company, category, confidence, reviewState, sourceStatus }, offset: offset ?? 0, limit: limit ?? 25 };
}

function rfc3986(value) { return encodeURIComponent(String(value)).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`); }
export function canonicalLeasingSearch(filters, offset = 0, limit = 25, omitDates = false) {
  const pairs = [];
  const append = (key, value) => { if (value !== null && value !== undefined && value !== '') pairs.push(`${key}=${rfc3986(value)}`); };
  if (!omitDates) { append('from', filters.from); append('to', filters.to); }
  append('company', filters.company); append('category', filters.category); append('confidence', filters.confidence);
  append('reviewState', filters.reviewState); append('sourceStatus', filters.sourceStatus);
  if (offset !== 0) append('offset', offset); if (limit !== 25) append('limit', limit);
  return pairs.join('&');
}

export function resetLeasingSearch(search) {
  const parsed = strictComponents(search);
  if (!parsed.ok) return '';
  return parsed.entries.filter((entry) => !KEYS.includes(entry.key)).map((entry) => entry.raw).join('&');
}

function validDateItem(value) {
  return exact(value, ['dateKind', 'value', 'confidence', 'reviewState']) &&
    oneOf(value.dateKind, ['contract', 'effective', 'term-start', 'term-end', 'other-explicit']) && validDate(value.value) &&
    oneOf(value.confidence, ['medium', 'low']) && value.reviewState === 'needs-review';
}
function validBuckets(value, vocabulary) {
  return Array.isArray(value) && value.length === vocabulary.length && value.every((item, index) =>
    exact(item, ['value', 'count']) && item.value === vocabulary[index] && integer(item.count, 0, Number.MAX_SAFE_INTEGER));
}
function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(index + 1); if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true; index += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
export function validLeasingCopiedText(value, maximum) { return typeof value === 'string' && !hasUnpairedSurrogate(value) && [...value].length >= 1 && [...value].length <= maximum; }

export function validateLeasingEvidenceFields(value, authorityAtUtc) {
  const authority = typeof authorityAtUtc === 'number' ? authorityAtUtc : Date.parse(authorityAtUtc);
  return Number.isFinite(authority) && validDate(value.publishedDate) &&
    (value.publishedAtUtc === null || utc(value.publishedAtUtc)) && utc(value.fetchedAtUtc) &&
    validLeasingCopiedText(value.companyName, 512) && validLeasingCopiedText(value.assetDescription, 512) &&
    validLeasingCopiedText(value.evidenceSnippet, 512) && oneOf(value.extractionStatus, ['processed', 'partial']) &&
    oneOf(value.extractionConfidence, ['medium', 'low']) && value.extractionReviewState === 'needs-review' && oneOf(value.category, CATEGORIES) &&
    oneOf(value.relevance, ['construction', 'non-construction', 'unknown', 'ambiguous']) && oneOf(value.classificationConfidence, CONFIDENCE) &&
    value.classificationMethod === 'deterministic-rules' && oneOf(value.classificationReviewState, REVIEW) && Array.isArray(value.ruleIds) && value.ruleIds.length <= 32 && value.ruleIds.every((item) => validLeasingCopiedText(item, 64)) &&
    Array.isArray(value.extractedDates) && value.extractedDates.length <= 8 && value.extractedDates.every(validDateItem) && oneOf(value.sourceStatus, SOURCE) && utc(value.freshUntilUtc) &&
    Array.isArray(value.caveatCodes) && value.caveatCodes.join('|') === [...BASE_CAVEATS, ...(value.sourceStatus === 'stale' ? ['stale-observations'] : [])].join('|') &&
    Date.parse(value.freshUntilUtc) - Date.parse(value.fetchedAtUtc) === 7 * 86_400_000 &&
    value.sourceStatus === (Date.parse(value.freshUntilUtc) > authority ? 'fresh' : 'stale');
}

function validItem(value, authority) {
  return exact(value, ['classificationId', 'sourceMessageId', 'sourceUrl', 'sourceReferenceState', 'publishedDate', 'publishedAtUtc', 'fetchedAtUtc', 'partyRole', 'companyName', 'assetDescription', 'evidenceSnippet', 'extractionStatus', 'extractionConfidence', 'extractionReviewState', 'category', 'relevance', 'classificationConfidence', 'classificationMethod', 'classificationReviewState', 'ruleIds', 'extractedDates', 'sourceStatus', 'freshUntilUtc', 'caveatCodes']) &&
    guid(value.classificationId) && value.sourceMessageId === null && value.sourceUrl === null &&
    value.sourceReferenceState === 'unavailable' && value.partyRole === 'weak-side' &&
    validateLeasingEvidenceFields(value, authority);
}

export function validateLeasingSourceHealth(health) {
  if (!exact(health, ['state', 'latestOutcomeStatus', 'latestOutcomeRetryable', 'latestOutcomeFinishedAtUtc', 'lastSuccessfulAtUtc']) ||
      !oneOf(health.state, ['unknown', 'healthy', 'degraded']) ||
      !(health.latestOutcomeStatus === null || OUTCOMES.includes(health.latestOutcomeStatus)) ||
      !(health.latestOutcomeRetryable === null || typeof health.latestOutcomeRetryable === 'boolean') ||
      !(health.latestOutcomeFinishedAtUtc === null || utc(health.latestOutcomeFinishedAtUtc)) ||
      !(health.lastSuccessfulAtUtc === null || utc(health.lastSuccessfulAtUtc))) return false;
  const mapping = health.latestOutcomeStatus === null ? ['unknown', null, null] :
    ['done-found', 'done-no-data'].includes(health.latestOutcomeStatus) ? ['healthy', false, 'time'] :
      health.latestOutcomeStatus === 'canceled' ? ['unknown', false, 'time'] : ['degraded', true, 'time'];
  if (health.state !== mapping[0] || health.latestOutcomeRetryable !== mapping[1] ||
      (mapping[2] === null ? health.latestOutcomeFinishedAtUtc !== null : health.latestOutcomeFinishedAtUtc === null)) return false;
  if (health.latestOutcomeStatus === null && health.lastSuccessfulAtUtc !== null) return false;
  if (health.lastSuccessfulAtUtc !== null && health.latestOutcomeFinishedAtUtc !== null &&
      Date.parse(health.lastSuccessfulAtUtc) > Date.parse(health.latestOutcomeFinishedAtUtc)) return false;
  return !['done-found', 'done-no-data'].includes(health.latestOutcomeStatus) ||
    health.lastSuccessfulAtUtc === health.latestOutcomeFinishedAtUtc;
}

export function validateLeasingResponse(value) {
  if (!exact(value, ['authorityAtUtc', 'filters', 'offset', 'limit', 'hasMore', 'totalCount', 'items', 'summary', 'sourceHealth', 'caveatCodes']) || !utc(value.authorityAtUtc)) return false;
  const authority = Date.parse(value.authorityAtUtc);
  const filters = value.filters;
  if (!exact(filters, ['from', 'to', 'company', 'category', 'confidence', 'reviewState', 'sourceStatus']) || !validDate(filters.from) || !validDate(filters.to) ||
      !(filters.company === null || normalizeCompany(filters.company) === filters.company) || !(filters.category === null || CATEGORIES.includes(filters.category)) ||
      !(filters.confidence === null || CONFIDENCE.includes(filters.confidence)) || !(filters.reviewState === null || REVIEW.includes(filters.reviewState)) || !(filters.sourceStatus === null || SOURCE.includes(filters.sourceStatus))) return false;
  if (!integer(value.offset, 0, 10_000) || !integer(value.limit, 1, 100) || typeof value.hasMore !== 'boolean' || !integer(value.totalCount, 0, Number.MAX_SAFE_INTEGER) || !Array.isArray(value.items) || value.items.length > value.limit || !value.items.every((item) => validItem(item, authority)) || value.hasMore !== (value.offset + value.items.length < value.totalCount)) return false;
  if (!exact(value.summary, ['categoryTotals', 'confidenceTotals', 'reviewStateTotals', 'sourceStatusTotals']) || !validBuckets(value.summary.categoryTotals, CATEGORIES) || !validBuckets(value.summary.confidenceTotals, CONFIDENCE) || !validBuckets(value.summary.reviewStateTotals, REVIEW) || !validBuckets(value.summary.sourceStatusTotals, SOURCE)) return false;
  for (const totals of [value.summary.categoryTotals, value.summary.confidenceTotals, value.summary.reviewStateTotals, value.summary.sourceStatusTotals]) if (totals.reduce((sum, item) => sum + item.count, 0) !== value.totalCount) return false;
  const health = value.sourceHealth;
  if (!validateLeasingSourceHealth(health)) return false;
  const staleCount = value.summary.sourceStatusTotals.find((item) => item.value === 'stale').count;
  const expectedCaveats = [...BASE_CAVEATS, ...(staleCount > 0 ? ['stale-observations'] : []), ...(health.state === 'degraded' ? ['source-degraded'] : [])];
  return Array.isArray(value.caveatCodes) && value.caveatCodes.join('|') === expectedCaveats.join('|');
}

export const leasingVocabulary = Object.freeze({ categories: CATEGORIES, confidence: CONFIDENCE, review: REVIEW, source: SOURCE });
export const leasingLabels = Object.freeze({
  earthmoving: 'Землеройная техника', lifting: 'Подъёмная техника', 'concrete-asphalt': 'Бетон и асфальт', roadbuilding: 'Дорожная техника',
  'transport-support': 'Транспорт и поддержка', attachments: 'Навесное оборудование', other: 'Другое', unknown: 'Не определено', ambiguous: 'Неоднозначно',
  high: 'Высокая', medium: 'Средняя', low: 'Низкая', construction: 'Строительная техника', 'non-construction': 'Не относится к строительной технике', processed: 'Обработано', partial: 'Обработано частично',
  'auto-accepted': 'Принято автоматически', 'needs-review': 'Требует проверки', fresh: 'Актуально', stale: 'Устарело',
});

const CAVEAT_COPY = Object.freeze({
  'derived-observation': 'Запись получена из производного наблюдения, а не из авторитетной карточки сообщения.',
  'weak-party-role': 'Компания указана как слабая сторона сообщения; её роль лизингополучателя или лизингодателя не установлена.',
  'not-risk-conclusion': 'Сигнал не является оценкой риска, кредита, платёжеспособности или юридическим заключением.',
  'source-reference-unavailable': 'Ссылка и авторитетный идентификатор исходного сообщения недоступны.',
  'stale-observations': 'Наблюдение устарело и требует повторной проверки источника.',
  'source-degraded': 'Последняя проверка источника завершилась с ограничением.',
});
export function leasingCaveatCopy(code) { return CAVEAT_COPY[code] ?? 'Дополнительное ограничение интерпретации данных.'; }

export function safeLeasingError(status) {
  if (status === 400) return 'Проверьте фильтры и повторите поиск.';
  if (status === 401) return 'Сессия завершена. Выполните вход снова.';
  if (status === 409) return 'Экспорт содержит больше 5000 строк. Уточните фильтры.';
  return 'Данные лизинговой активности временно недоступны. Повторите попытку.';
}
