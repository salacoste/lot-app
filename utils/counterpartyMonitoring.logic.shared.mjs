const FORMAT_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const DIGITS = /^\d+$/u;

export function normalizeCounterpartyText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (normalized.length > maxLength || FORMAT_CONTROLS.test(normalized)) return '';
  return normalized;
}

export function validateInn(value) {
  const canonical = String(value ?? '').normalize('NFKC').replace(/[\s\-‐‑‒–—]/gu, '');
  if (!canonical) return null;
  if (!DIGITS.test(canonical)) return 'Введите ИНН из 10 цифр.';
  if (canonical.length === 12) return 'ИНН физлица из 12 цифр пока не поддерживается.';
  if (canonical.length !== 10) return 'Введите ИНН из 10 цифр.';
  const weights = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const check = weights.reduce((sum, weight, index) => sum + Number(canonical[index]) * weight, 0) % 11 % 10;
  return check === Number(canonical[9]) ? null : 'Контрольная сумма ИНН не совпадает.';
}

export function validateOgrn(value) {
  const canonical = String(value ?? '').normalize('NFKC').replace(/[\s\-‐‑‒–—]/gu, '');
  if (!canonical) return null;
  if (!DIGITS.test(canonical)) return 'Введите ОГРН из 13 цифр.';
  if (canonical.length === 15) return 'ОГРНИП из 15 цифр пока не поддерживается.';
  if (canonical.length !== 13) return 'Введите ОГРН из 13 цифр.';
  return Number(BigInt(canonical.slice(0, 12)) % 11n % 10n) === Number(canonical[12])
    ? null
    : 'Контрольная сумма ОГРН не совпадает.';
}

export function validateCounterpartyCreate(input) {
  const errors = {};
  const innError = validateInn(input.inn);
  const ogrnError = validateOgrn(input.ogrn);
  if (innError) errors.inn = innError;
  if (ogrnError) errors.ogrn = ogrnError;
  const name = normalizeCounterpartyText(input.name, 512);
  const label = normalizeCounterpartyText(input.displayLabel, 160);
  if (input.name && !name) errors.name = 'Название содержит недопустимые символы или слишком длинное.';
  if (input.displayLabel && !label) errors.displayLabel = 'Метка содержит недопустимые символы или слишком длинная.';
  if (!errors.name && !String(input.inn ?? '').trim() && !String(input.ogrn ?? '').trim() && name.length < 2) {
    errors.name = 'Укажите ИНН, ОГРН или название длиной не менее двух символов.';
  }
  return errors;
}

const IDENTITY = {
  pending: ['Ожидает проверки', 'Организация ещё не подтверждена источником.'],
  confirmed: ['Организация подтверждена', 'Идентификаторы сопоставлены с источником.'],
  ambiguous: ['Нужно уточнение', 'Источник вернул неоднозначное сопоставление.'],
  'not-found': ['Организация не найдена', 'Источник не подтвердил указанную организацию.'],
  'invalid-input': ['Некорректные данные', 'Проверьте идентификаторы или название.'],
};
const SOURCE = {
  found: ['Сообщения найдены', 'Показаны подтверждённые источником события.'],
  'no-match': ['Нет сопоставления в источнике', 'Полнота истории не подтверждена.'],
  ambiguous: ['Неоднозначный ответ источника', 'Полнота истории не подтверждена.'],
  unavailable: ['Источник временно недоступен', 'Последние данные могут быть неполными.'],
  'rate-limited-captcha': ['Проверка ограничена источником', 'Попытка будет повторена позже.'],
  timeout: ['Источник не ответил вовремя', 'Последние данные могут быть неполными.'],
  'schema-changed': ['Формат источника изменился', 'Автоматическая проверка требует обновления.'],
};
const UNKNOWN_IDENTITY = ['Неизвестно', 'Статус идентификации пока недоступен.'];
const UNKNOWN_SOURCE = ['Неизвестно', 'Статус источника пока недоступен.'];
const UNKNOWN_FRESHNESS = ['Неизвестно', 'Актуальность данных пока не подтверждена.'];

export function identityStatusView(value) {
  const [label, description] = IDENTITY[value] ?? UNKNOWN_IDENTITY;
  return { label, description };
}

export function sourceStatusView(value, freshness) {
  if (value === 'no-bankruptcy-data') return freshness === 'fresh'
    ? { label: 'Сообщения не найдены', description: 'По последней успешной проверке сообщения не найдены.' }
    : { label: 'Статус источника требует обновления', description: 'Отсутствие событий не подтверждено актуальной проверкой.' };
  const [label, description] = SOURCE[value] ?? UNKNOWN_SOURCE;
  return { label, description };
}

export function freshnessStatusView(value) {
  if (value === 'fresh') return { label: 'Данные актуальны', description: 'Актуальность относится только к отдельному результату источника.' };
  if (value === 'stale') return { label: 'Данные устарели', description: 'Не делайте вывод об отсутствии событий до новой успешной проверки.' };
  const [label, description] = UNKNOWN_FRESHNESS;
  return { label, description };
}

export function emptyHistoryMessage(identity, source, freshness) {
  if (freshness === 'stale') return 'Последняя проверка устарела; отсутствие новых событий не подтверждено.';
  if (identity === 'confirmed' && source === 'no-bankruptcy-data' && freshness === 'fresh') return 'По последней успешной проверке сообщения не найдены.';
  if (identity === 'pending') return 'Проверка организации ещё не завершена.';
  if (identity === 'ambiguous') return 'Историю нельзя подтвердить, пока сопоставление неоднозначно.';
  if (identity === 'not-found') return 'Организация не подтверждена источником; отсутствие событий не установлено.';
  if (identity === 'invalid-input') return 'Исправьте данные контрагента, чтобы начать проверку.';
  return 'Источник сейчас не подтверждает полноту истории.';
}

export function monitoringTimeView(value, referenceNow = Date.now(), maxFutureSkewMs = 5 * 60 * 1000) {
  if (!value) return { accepted: false, label: 'Время недоступно', dateTime: null };
  const date = new Date(value);
  const reference = Number(referenceNow);
  if (Number.isNaN(date.getTime()) || !Number.isFinite(reference) || date.getTime() > reference + maxFutureSkewMs) {
    return { accepted: false, label: 'Время недоступно', dateTime: null };
  }
  return { accepted: true, dateTime: date.toISOString(), label: `${new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)} МСК` };
}

export function formatMoscowDate(value, referenceNow = Date.now()) {
  return monitoringTimeView(value, referenceNow).label;
}

export function safeFedresursEvidenceUrl(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024) return null;
  if (/[\\]/u.test(value) || /%(?:2e|2f|5c)/iu.test(value)) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'fedresurs.ru' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (parsed.pathname.includes('//') || parsed.pathname.includes('..')) return null;
  const match = parsed.pathname.match(/^\/bankruptmessages\/([^/]+)$/u);
  return match?.[1] ? parsed.href : null;
}

export function mergeById(current, incoming, reset = false) {
  const map = new Map((reset ? [] : current).map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

export function completeCounterpartyUpdate(item, changes) {
  return {
    enabled: changes.enabled ?? item.enabled,
    alertOptIn: changes.alertOptIn ?? item.alertOptIn,
    displayLabel: changes.displayLabel === undefined ? item.displayLabel : (normalizeCounterpartyText(changes.displayLabel ?? '', 160) || null),
    version: item.version,
  };
}

export function safeCounterpartyError(status) {
  if (status === 400) return 'Проверьте заполнение формы.';
  if (status === 404) return 'Запись больше недоступна.';
  if (status === 409) return 'Данные изменились в другой вкладке. Мы загрузили актуальную версию — проверьте изменения и повторите действие.';
  if (status === 429) return 'Слишком много запросов. Подождите и повторите попытку.';
  return 'Не удалось выполнить действие. Повторите попытку.';
}

const DUE_DILIGENCE_REPORT_COPY = Object.freeze({
  'report.title': 'Отчёт о проверке контрагента',
  'action.open': 'Открыть отчёт',
  'action.close': 'Закрыть отчёт',
  'action.download': 'Скачать JSON',
  'action.print': 'Печать',
  'action.retry': 'Повторить',
  'state.loading': 'Формируем отчёт…',
  'state.timeout': 'Не удалось сформировать отчёт за отведённое время. Повторите попытку.',
  'state.unavailable': 'Отчёт сейчас недоступен. Повторите попытку позже.',
  'state.notFound': 'Запись больше недоступна; список обновлён.',
  'state.unauthorized': 'Сессия завершена. Переходим ко входу…',
  'axis.level': 'Уровень риска',
  'axis.confidence': 'Надёжность оценки',
  'axis.coverage': 'Полнота покрытия',
  'level.high': 'Высокий',
  'level.medium': 'Средний',
  'level.low': 'Низкий',
  'level.unknown': 'Не определён',
  'disclaimer.not-legal-advice': 'Отчёт не является юридической консультацией или заключением.',
  'disclaimer.coverage-may-be-incomplete': 'Данные источников могут быть неполными, устаревшими или временно недоступными.',
  'disclaimer.kad-operator-asserted-unverified': 'Данные КАД загружены оператором, не подтверждены источником и отражают только найденные положительные сигналы; отсутствие записей ничего не доказывает.',
  'disclaimer.low-not-proof-of-solvency': 'Низкий уровень не доказывает платёжеспособность, безопасность или отсутствие споров и банкротных событий.',
});

export function dueDiligenceReportCopy(key) {
  return DUE_DILIGENCE_REPORT_COPY[key] ?? '';
}

export function dueDiligenceReportLevelLabel(level) {
  return dueDiligenceReportCopy(`level.${['high', 'medium', 'low'].includes(level) ? level : 'unknown'}`);
}

export function dueDiligenceReportFailureCopy(status) {
  return dueDiligenceReportCopy(status === 408 ? 'state.timeout' : 'state.unavailable');
}

export function dueDiligenceReasonView(reason) {
  return {
    code: reason.code,
    summary: `Источник: ${reason.source}; свидетельств: ${reason.evidenceCount}.`,
  };
}

export function dueDiligenceSourceSummaryView(source) {
  return {
    source: source.source,
    summary: `Состояние: ${source.state}; актуальность: ${source.freshness}; надёжность: ${source.confidence}; свидетельств: ${source.evidenceCount}.`,
  };
}

export function emptyDueDiligenceReport() {
  return { status: 'closed' };
}

export function beginDueDiligenceReport(ownerKey, entryId, generation) {
  return { status: 'loading', ownerKey, entryId, generation };
}

export function completeDueDiligenceReport(state, ownerKey, entryId, generation, rawText, report) {
  if (state.status !== 'loading' || state.ownerKey !== ownerKey || state.entryId !== entryId || state.generation !== generation) return state;
  return { status: 'ready', ownerKey, entryId, generation, rawText, report };
}
