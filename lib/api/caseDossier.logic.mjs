import { CASE_DOSSIER_REFERENCE_POLICY } from '../generated/case-dossier-reference-policy.mjs';

export { CASE_DOSSIER_REFERENCE_POLICY };

const stateLabels = Object.freeze({
  found: 'Данные найдены',
  'not-found': 'Локальные подтверждённые данные не найдены',
  ambiguous: 'Обнаружены противоречивые данные',
  stale: 'Показаны сохранённые данные, требующие проверки актуальности',
  'source-unavailable': 'Источник временно недоступен',
  'blocked-rate-limited': 'Источник ограничил доступ',
  timeout: 'Источник не ответил вовремя',
  'schema-changed': 'Формат источника изменился',
  unknown: 'Состояние пока не определено',
  unavailable: 'Источник временно недоступен',
  blocked: 'Источник ограничил доступ',
  'no-data': 'Подтверждённых данных нет',
  'no-bankruptcy-data': 'Подтверждённых сведений о банкротстве нет',
  'rate-limited-captcha': 'Источник ограничил доступ проверкой CAPTCHA',
  'no-case-card': 'Карточка дела не найдена',
  'no-electronic-case-data': 'Электронные материалы дела недоступны',
  'captcha-blocked': 'Доступ к источнику заблокирован CAPTCHA',
  'rate-limited': 'Источник временно ограничил частоту запросов',
});

const sourceReferenceSegmentPattern = new RegExp(CASE_DOSSIER_REFERENCE_POLICY.segmentPattern, 'u');

const caveatLabels = Object.freeze({
  'decision-support-not-legal-advice': 'Досье поддерживает решение, но не заменяет юридическую консультацию.',
  'local-evidence-only': 'Показаны только уже сохранённые локальные сведения.',
  'source-freshness-must-be-reviewed': 'Перед решением проверьте время обновления каждого источника.',
  'operator-asserted-unverified': 'Часть сведений внесена оператором и не подтверждена источником.',
  'snapshot-generated-for-current-account': 'Снимок сформирован только для текущего аккаунта.',
  'unsafe-reference-suppressed': 'Небезопасная ссылка источника скрыта.',
  'response-truncated': 'Часть данных не показана из-за ограничения размера ответа.',
  'partial-source-failure': 'Один или несколько источников вернули неполный результат.',
});

const freshnessLabels = Object.freeze({
  'as-observed': 'актуальность по времени наблюдения',
  'stale-prior-positive': 'показаны ранее подтверждённые сведения',
  unknown: 'актуальность не определена',
});

const actionLabels = Object.freeze({
  'export-json': 'Скачать JSON', print: 'Печать',
  'create-direct-watch': 'Добавить наблюдение', 'update-direct-watch': 'Изменить наблюдение',
  'enable-direct-watch': 'Включить наблюдение', 'disable-direct-watch': 'Отключить наблюдение',
  'set-alert-opt-in': 'Настроить уведомления',
});

export function stateLabel(value) {
  return stateLabels[value] ?? 'Состояние требует проверки';
}

export function caveatLabel(value) {
  return caveatLabels[value] ?? 'Учитывайте ограничение сохранённых данных.';
}

export function freshnessLabel(value) {
  return freshnessLabels[value] ?? 'актуальность требует проверки';
}

export function actionLabel(value) {
  return actionLabels[value] ?? 'Действие доступно';
}

export function problemLabel(status) {
  if (status === 401) return 'Сессия завершена. Войдите снова.';
  if (status === 404) return 'Досье больше недоступно.';
  if (status === 408) return 'Формирование досье заняло слишком много времени.';
  if (status === 429) return 'Слишком много запросов. Повторите позже.';
  return 'Не удалось загрузить досье. Повторите позже.';
}

export function formatInstant(value) {
  if (!value) return 'Нет данных';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Дата недоступна';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  }).format(date);
}

export function safeSourceReference(value) {
  if (typeof value !== 'string' || value.length < 1 ||
      value.length > CASE_DOSSIER_REFERENCE_POLICY.maximumLength ||
      value !== value.trim() || /[%\\\s]/u.test(value) || /[^\x21-\x7e]/u.test(value)) return null;
  const prefix = CASE_DOSSIER_REFERENCE_POLICY.prefixes.find((candidate) => value.startsWith(candidate));
  if (!prefix) return null;
  const segments = value.slice(prefix.length).split('/');
  if (segments.length === 0 || segments.some((segment) =>
    !segment || segment === '.' || segment === '..' || !sourceReferenceSegmentPattern.test(segment))) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
      parsed.search || parsed.hash || parsed.toString() !== value) return null;
  return value;
}

export function dossierFileName(caseId) {
  if (!/^[0-9a-f]{32}$/u.test(String(caseId))) return 'case-dossier-case.json';
  return `case-dossier-${caseId}.json`;
}
