import {
  normalizeCompany, validLeasingCopiedText, validateLeasingEvidenceFields, validateLeasingSourceHealth,
} from './leasingDashboard.logic.shared.mjs';

const CATEGORIES = Object.freeze(['earthmoving', 'lifting', 'concrete-asphalt', 'roadbuilding', 'transport-support', 'attachments', 'other', 'unknown', 'ambiguous']);
const CONFIDENCE = Object.freeze(['high', 'medium', 'low', 'unknown']);
const REVIEW = Object.freeze(['auto-accepted', 'needs-review', 'unknown']);
const STATES = Object.freeze(['unavailable', 'unlinked', 'degraded', 'empty-persisted-set', 'stale', 'found']);
const FIXED_PROBLEM_TITLES = Object.freeze({
  400: 'Bad Request', 404: 'Not Found', 409: 'Conflict', 413: 'Payload Too Large',
  415: 'Unsupported Media Type', 429: 'Too Many Requests', 500: 'Internal Server Error',
});
const PROFILE_CAVEATS = Object.freeze(['unverified-name-filter-association']);

const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && Object.keys(value).every((key, index) => key === keys[index]);
const guid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
const utc = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/u.test(value) && Number.isFinite(Date.parse(value));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const nullableVocabulary = (value, vocabulary) => value === null || vocabulary.includes(value);
const exactVector = (value, expected) => Array.isArray(value) && value.length === expected.length &&
  value.every((item, index) => item === expected[index]);

export function validateLeasingFixedProblem(value, expectedStatus) {
  return Object.hasOwn(FIXED_PROBLEM_TITLES, expectedStatus) &&
    exact(value, ['type', 'title', 'status']) && value.type === 'about:blank' &&
    value.title === FIXED_PROBLEM_TITLES[expectedStatus] && value.status === expectedStatus;
}

export async function readExactLeasingFixedProblem(response, allowedStatuses) {
  if (!Array.isArray(allowedStatuses) || !allowedStatuses.includes(response.status) ||
      !Object.hasOwn(FIXED_PROBLEM_TITLES, response.status) ||
      response.headers.get('content-type') !== 'application/problem+json') return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 256) return null;
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return validateLeasingFixedProblem(value, response.status) ? value : null;
  } catch { return null; }
}

export function createLeasingRequestCoordinator() {
  let generation = 0;
  let controller = null;
  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      const mine = ++generation;
      return { signal: controller.signal, isCurrent: () => mine === generation && !controller.signal.aborted };
    },
    abort() { controller?.abort(); controller = null; generation += 1; },
  };
}

export function hasExactLeasingJsonSuccess(response, allowedStatuses) {
  return allowedStatuses.includes(response.status) &&
    response.headers.get('content-type') === 'application/json; charset=utf-8';
}

export async function hasExactLeasingEmpty204(response) {
  return response.status === 204 && response.headers.get('content-length') === '0' &&
    !response.headers.has('content-type') && (await response.arrayBuffer()).byteLength === 0;
}

export function alertableFiltersFromSuccessfulResponse(response) {
  const filters = response?.filters;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return null;
  const result = { company: filters.company ?? null, category: filters.category ?? null, confidence: filters.confidence ?? null, reviewState: filters.reviewState ?? null };
  return result.company !== null || result.category !== null ? result : null;
}

export function buildSavedSearchCreate(name, filters, counterpartyWatchlistEntryId) {
  return { name, company: filters.company, category: filters.category, confidence: filters.confidence, reviewState: filters.reviewState, counterpartyWatchlistEntryId };
}

export function buildSavedSearchUpdate(name, filters, counterpartyWatchlistEntryId, alertOptIn, version) {
  return { name, company: filters.company, category: filters.category, confidence: filters.confidence, reviewState: filters.reviewState, counterpartyWatchlistEntryId, alertOptIn, version };
}

export function containsDeletedLeasingPrivateMaterial(savedItems, alertItems, deletedIds) {
  const tombstones = deletedIds instanceof Set ? deletedIds : new Set(deletedIds);
  return savedItems.some((item) => tombstones.has(item.id)) ||
    alertItems.some((item) => tombstones.has(item.savedSearchId));
}

export function purgeDeletedLeasingPrivateState(savedItems, feed, deletedId) {
  const items = feed.items.filter((item) => item.savedSearchId !== deletedId);
  return {
    saved: savedItems.filter((item) => item.id !== deletedId),
    feed: { ...feed, offset: 0, hasMore: false, totalCount: items.length, items },
  };
}

export function validateSavedSearchItem(item) {
  return exact(item, ['id', 'name', 'company', 'category', 'confidence', 'reviewState', 'alertOptIn', 'counterpartyWatchlistEntryId', 'version', 'createdAtUtc', 'updatedAtUtc']) &&
    guid(item.id) && validLeasingCopiedText(item.name, 80) &&
    (item.company === null || normalizeCompany(item.company) === item.company) && nullableVocabulary(item.category, CATEGORIES) &&
    nullableVocabulary(item.confidence, CONFIDENCE) && nullableVocabulary(item.reviewState, REVIEW) &&
    typeof item.alertOptIn === 'boolean' && (item.counterpartyWatchlistEntryId === null || guid(item.counterpartyWatchlistEntryId)) &&
    integer(item.version, 1, Number.MAX_SAFE_INTEGER) && utc(item.createdAtUtc) && utc(item.updatedAtUtc);
}

export function validateSavedSearchList(value) {
  return exact(value, ['items', 'totalCount', 'maxItems']) && Array.isArray(value.items) && value.items.every(validateSavedSearchItem) &&
    integer(value.totalCount, 0, 50) && value.totalCount === value.items.length && value.maxItems === 50;
}

function validEvidence(value, authorityAtUtc) {
  return exact(value, ['publishedDate', 'publishedAtUtc', 'fetchedAtUtc', 'companyName', 'assetDescription', 'evidenceSnippet', 'extractionStatus', 'extractionConfidence', 'extractionReviewState', 'category', 'relevance', 'classificationConfidence', 'classificationMethod', 'classificationReviewState', 'ruleIds', 'extractedDates', 'sourceStatus', 'freshUntilUtc', 'caveatCodes']) &&
    validateLeasingEvidenceFields(value, authorityAtUtc);
}

export function validateAlertFeed(value) {
  if (!exact(value, ['authorityAtUtc', 'offset', 'limit', 'hasMore', 'totalCount', 'items']) || !utc(value.authorityAtUtc) ||
      !integer(value.offset, 0, 10_000) || !integer(value.limit, 1, 100) || typeof value.hasMore !== 'boolean' ||
      !integer(value.totalCount, 0, Number.MAX_SAFE_INTEGER) || !Array.isArray(value.items) || value.items.length > value.limit ||
      value.hasMore !== (value.offset + value.items.length < value.totalCount)) return false;
  return value.items.every((item) => exact(item, ['id', 'savedSearchId', 'savedSearchName', 'filterSnapshot', 'visibleAtUtc', 'readAtUtc', 'evidence']) &&
      guid(item.id) && guid(item.savedSearchId) && validLeasingCopiedText(item.savedSearchName, 80) &&
      exact(item.filterSnapshot, ['company', 'category', 'confidence', 'reviewState']) &&
      (item.filterSnapshot.company === null || normalizeCompany(item.filterSnapshot.company) === item.filterSnapshot.company) &&
      nullableVocabulary(item.filterSnapshot.category, CATEGORIES) && nullableVocabulary(item.filterSnapshot.confidence, CONFIDENCE) &&
      nullableVocabulary(item.filterSnapshot.reviewState, REVIEW) && utc(item.visibleAtUtc) &&
      (item.readAtUtc === null || utc(item.readAtUtc)) && validEvidence(item.evidence, value.authorityAtUtc));
}

export function validateCounterpartyLeasingSignals(value, expectedLimit = 10) {
  if (!exact(value, ['authorityAtUtc', 'state', 'sourceHealth', 'associationBasis', 'identityConfirmed', 'caveatCodes', 'totalMatchedCount', 'items']) ||
      !utc(value.authorityAtUtc) || !STATES.includes(value.state) || !validateLeasingSourceHealth(value.sourceHealth) ||
      !integer(expectedLimit, 1, 10) || !integer(value.totalMatchedCount, 0, Number.MAX_SAFE_INTEGER) ||
      !Array.isArray(value.items) || value.items.length > expectedLimit ||
      value.associationBasis !== 'user-configured-name-filter' || value.identityConfirmed !== false ||
      !exactVector(value.caveatCodes, PROFILE_CAVEATS) ||
      !value.items.every((item) => validEvidence(item, value.authorityAtUtc))) return false;
  const empty = value.totalMatchedCount === 0 && value.items.length === 0;
  if (value.state === 'unavailable') return value.sourceHealth.state === 'unknown' && empty;
  if (value.state === 'unlinked') return value.sourceHealth.state !== 'unknown' && empty;
  if (value.state === 'degraded') return value.sourceHealth.state === 'degraded' && empty;
  if (value.state === 'empty-persisted-set') return value.sourceHealth.state === 'healthy' && empty;
  if (value.sourceHealth.state !== 'healthy' || value.totalMatchedCount === 0 ||
      value.items.length !== Math.min(value.totalMatchedCount, expectedLimit)) return false;
  const statuses = value.items.map((item) => item.sourceStatus);
  if (value.state === 'stale') return statuses.every((status) => status === 'stale');
  if (value.state !== 'found' || statuses[0] !== 'fresh') return false;
  const firstStale = statuses.indexOf('stale');
  return firstStale < 0 || statuses.slice(firstStale).every((status) => status === 'stale');
}
