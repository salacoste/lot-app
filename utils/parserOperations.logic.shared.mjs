const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/u;
const STATUS = new Set(['pending', 'processing', 'done-found', 'done-no-data', 'invalid', 'ambiguous', 'retry-scheduled', 'captcha-blocked', 'rate-limited', 'source-unavailable', 'timeout', 'schema-changed', 'failed', 'canceled']);
const RUN_KEYS = ['id','sourceFamily','status','stopReason','totalTasks','pendingTasks','processingTasks','completedTasks','retryScheduledTasks','failedTasks','canceledTasks','createdAtUtc','updatedAtUtc','startedAtUtc','finishedAtUtc','cancelRequestedAtUtc','freshness','resultFreshness','sourceControls','sourceStatusCounts','runAllowedActions','caveatCodes'];
const TASK_KEYS = ['id','rowNumber','source','targetType','inputDisplay','status','stopReason','attemptCount','maxAttempts','nextAttemptAtUtc','resultKind','diagnosticCode','createdAtUtc','updatedAtUtc','startedAtUtc','finishedAtUtc','retryable','finding','freshness','resultFreshness','taskAllowedActions','caveatCodes'];
const ATTEMPT_KEYS = ['id','attemptNumber','source','status','stopReason','retryable','diagnosticCode','startedAtUtc','finishedAtUtc','freshness','caveatCodes'];
const CONTROL_KEYS = ['policyVersion','environment','adminOverride','maxConcurrency','requestDelayMs','maxRetries','pageTimeoutSeconds','maxRows','captchaMode','proxyMode','proxyReference','proxyConfigured','diagnostics'];
const SOURCE_COUNT_KEYS = ['captcha-blocked','rate-limited','source-unavailable','timeout','schema-changed'];
const CAVEATS = new Set(['live-keyset-not-snapshot','result-freshness-unavailable','cooperative-cancel','lease-timeout-not-process-kill','source-failure-is-not-no-data','redacted-operator-view']);
const CONTROL_DIAGNOSTICS = new Set(['captcha-manual-dev-only','proxy-disabled','proxy-config-reference','captcha-disabled','admin-override-bounded','safe-defaults']);
const RUN_FRESHNESS = new Set(['terminal','queued','active-fresh','active-stale']);
const ATTEMPT_FRESHNESS = new Set(['terminal','active-fresh','active-stale']);
const STOP_REASON = new Set(['completed','no-data','invalid-input','ambiguous-match','retry-scheduled','retry-budget-exhausted','retry-suppressed','schema-changed','cancellation-requested','canceled','lease-lost']);
const TERMINAL_STATUS = new Set(['done-found','done-no-data','invalid','ambiguous','schema-changed','failed','canceled']);
const ATTEMPT_TERMINAL_STATUS = new Set([...STATUS].filter((value) => !['pending','processing','retry-scheduled'].includes(value)));
const RETRYABLE_STATUS = new Set(['source-unavailable','captcha-blocked','rate-limited','timeout','retry-scheduled']);

const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).join('|') === keys.join('|');
const guid = (value) => typeof value === 'string' && GUID.test(value) && value !== '00000000-0000-0000-0000-000000000000';
const utc = (value) => typeof value === 'string' && UTC.test(value) && Number.isFinite(Date.parse(value));
const maybeUtc = (value) => value === null || utc(value);
const integer = (value, min = 0, max = 2_147_483_647) => Number.isInteger(value) && value >= min && value <= max;
const closedStrings = (value, allowed, max = 16) => Array.isArray(value) && value.length <= max && new Set(value).size === value.length && value.every((item) => typeof item === 'string' && allowed.has(item));
const status = (value) => typeof value === 'string' && STATUS.has(value);
const stopReason = (value) => value === null || STOP_REASON.has(value);
const token = (value) => typeof value === 'string' && /^[a-z0-9-]{1,32}$/u.test(value);
const targetToken = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,31}$/u.test(value);
const code = (value) => value === null || typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]{0,63}$/u.test(value);
const orderedDates = (created, updated, started, finished) => Date.parse(updated) >= Date.parse(created) &&
  (started === null || Date.parse(started) >= Date.parse(created)) &&
  (finished === null || started === null || Date.parse(finished) >= Date.parse(started));
const compatibleStopReason = (statusValue, reason) => ({
  pending:[null],processing:[null],'done-found':['completed'],'done-no-data':['no-data'],invalid:['invalid-input'],
  ambiguous:['ambiguous-match'],'source-unavailable':['retry-scheduled'],'captcha-blocked':['retry-scheduled'],
  'rate-limited':['retry-scheduled'],timeout:['retry-scheduled'],'retry-scheduled':['retry-scheduled'],
  'schema-changed':['schema-changed'],failed:[null,'retry-budget-exhausted','retry-suppressed','lease-lost'],
  canceled:['canceled','cancellation-requested'],
}[statusValue]?.includes(reason) === true);

function validActions(value, keys) { return exact(value, keys) && keys.every((key) => typeof value[key] === 'boolean'); }
function validSourceControls(value) {
  if (!exact(value, CONTROL_KEYS) || value.policyVersion !== 'parser-run-source-controls/v1' || !['production','development'].includes(value.environment) || typeof value.adminOverride !== 'boolean') return false;
  if (!integer(value.maxConcurrency, 1, 3) || !integer(value.requestDelayMs, 1_000, 60_000) || !integer(value.maxRetries, 0, 4) || !integer(value.pageTimeoutSeconds, 1, 180) || !integer(value.maxRows, 1, 500)) return false;
  if (!['disabled','manual-headful'].includes(value.captchaMode) || !['disabled','config-reference'].includes(value.proxyMode) || typeof value.proxyConfigured !== 'boolean') return false;
  if (value.proxyMode === 'disabled' ? value.proxyReference !== null : value.proxyReference !== 'ProxySettings' || !value.proxyConfigured) return false;
  return closedStrings(value.diagnostics, CONTROL_DIAGNOSTICS, 4);
}
function validSourceCounts(value) { return exact(value, SOURCE_COUNT_KEYS) && SOURCE_COUNT_KEYS.every((key) => integer(value[key])); }
function validRun(value) {
  if (!exact(value, RUN_KEYS) || !guid(value.id) || !token(value.sourceFamily) || !status(value.status) || !stopReason(value.stopReason)) return false;
  if (!['totalTasks','pendingTasks','processingTasks','completedTasks','retryScheduledTasks','failedTasks','canceledTasks'].every((key) => integer(value[key]))) return false;
  if (!utc(value.createdAtUtc) || !utc(value.updatedAtUtc) || !maybeUtc(value.startedAtUtc) || !maybeUtc(value.finishedAtUtc) || !maybeUtc(value.cancelRequestedAtUtc) || !orderedDates(value.createdAtUtc, value.updatedAtUtc, value.startedAtUtc, value.finishedAtUtc)) return false;
  if (value.pendingTasks + value.processingTasks + value.completedTasks + value.retryScheduledTasks + value.failedTasks + value.canceledTasks > value.totalTasks) return false;
  if (!compatibleStopReason(value.status, value.stopReason)) return false;
  if (TERMINAL_STATUS.has(value.status) !== (value.finishedAtUtc !== null)) return false;
  if (!validActions(value.runAllowedActions, ['cancel','resume','retryFailed','export']) || !closedStrings(value.caveatCodes, CAVEATS)) return false;
  const failClosed = value.status === 'failed' && value.stopReason === null && value.totalTasks === 0 &&
    ['cancel','resume','retryFailed','export'].every((key) => value.runAllowedActions[key] === false);
  const bucketedTasks = value.pendingTasks + value.processingTasks + value.completedTasks + value.retryScheduledTasks + value.failedTasks + value.canceledTasks;
  const knownCancelable = value.pendingTasks + value.processingTasks + value.retryScheduledTasks > 0;
  const definitelyCancelable = !failClosed && value.cancelRequestedAtUtc === null && knownCancelable;
  const ambiguouslyCancelable = !failClosed && value.cancelRequestedAtUtc === null && !knownCancelable && bucketedTasks < value.totalTasks;
  const retryFailedAllowed = !failClosed && value.cancelRequestedAtUtc === null && value.failedTasks > 0;
  if (!ambiguouslyCancelable && value.runAllowedActions.cancel !== definitelyCancelable || value.runAllowedActions.retryFailed && !retryFailedAllowed ||
      value.runAllowedActions.resume && value.cancelRequestedAtUtc === null || value.runAllowedActions.export !== !failClosed) return false;
  if (value.processingTasks > 0 && !['active-fresh','active-stale'].includes(value.freshness) ||
      value.processingTasks === 0 && value.pendingTasks + value.retryScheduledTasks > 0 && value.freshness !== 'queued' ||
      value.processingTasks === 0 && value.pendingTasks + value.retryScheduledTasks === 0 && bucketedTasks === value.totalTasks && value.freshness !== 'terminal' ||
      value.processingTasks === 0 && value.pendingTasks + value.retryScheduledTasks === 0 && bucketedTasks < value.totalTasks && !['queued','terminal'].includes(value.freshness)) return false;
  return RUN_FRESHNESS.has(value.freshness) && value.resultFreshness === 'unavailable' && validSourceControls(value.sourceControls) && validSourceCounts(value.sourceStatusCounts);
}
function validTask(value) {
  if (!(exact(value, TASK_KEYS) && guid(value.id) && integer(value.rowNumber, 1) && token(value.source) && targetToken(value.targetType) && typeof value.inputDisplay === 'string' && value.inputDisplay.length >= 1 && value.inputDisplay.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value.inputDisplay) && status(value.status) && stopReason(value.stopReason) && integer(value.attemptCount) && integer(value.maxAttempts, 1, 5) && value.attemptCount <= value.maxAttempts && maybeUtc(value.nextAttemptAtUtc) && code(value.resultKind) && code(value.diagnosticCode) && utc(value.createdAtUtc) && utc(value.updatedAtUtc) && maybeUtc(value.startedAtUtc) && maybeUtc(value.finishedAtUtc) && orderedDates(value.createdAtUtc, value.updatedAtUtc, value.startedAtUtc, value.finishedAtUtc) && typeof value.retryable === 'boolean' && ['found','no-data','not-applicable'].includes(value.finding) && RUN_FRESHNESS.has(value.freshness) && value.resultFreshness === 'unavailable' && validActions(value.taskAllowedActions, ['selectForRetry']) && closedStrings(value.caveatCodes, CAVEATS))) return false;
  if (value.finding !== (value.status === 'done-found' ? 'found' : value.status === 'done-no-data' ? 'no-data' : 'not-applicable')) return false;
  if (!compatibleStopReason(value.status, value.stopReason)) return false;
  const failClosed = value.status === 'failed' && value.stopReason === null && value.inputDisplay === '***' &&
    value.attemptCount === 0 && value.maxAttempts === 1 && value.resultKind === null && value.diagnosticCode === null &&
    value.taskAllowedActions.selectForRetry === false;
  const definitelyRetryable = !failClosed && (RETRYABLE_STATUS.has(value.status) || value.status === 'failed' && value.attemptCount < value.maxAttempts);
  const ambiguouslyRetryable = !failClosed && value.status === 'failed' && value.attemptCount === value.maxAttempts && value.maxAttempts < 5;
  if (!ambiguouslyRetryable && value.retryable !== definitelyRetryable || value.taskAllowedActions.selectForRetry &&
      (!value.retryable || !['retry-scheduled','failed'].includes(value.status))) return false;
  if ((value.status === 'retry-scheduled') !== (value.nextAttemptAtUtc !== null)) return false;
  if (value.nextAttemptAtUtc !== null && Date.parse(value.nextAttemptAtUtc) < Date.parse(value.updatedAtUtc)) return false;
  if (TERMINAL_STATUS.has(value.status) !== (value.finishedAtUtc !== null)) return false;
  return TERMINAL_STATUS.has(value.status) ? value.freshness === 'terminal' : value.freshness !== 'terminal';
}
function validAttempt(value) {
  if (!(exact(value, ATTEMPT_KEYS) && guid(value.id) && integer(value.attemptNumber, 1) && token(value.source) && status(value.status) && stopReason(value.stopReason) && typeof value.retryable === 'boolean' && code(value.diagnosticCode) && utc(value.startedAtUtc) && maybeUtc(value.finishedAtUtc) && ATTEMPT_FRESHNESS.has(value.freshness) && closedStrings(value.caveatCodes, CAVEATS))) return false;
  if (!compatibleStopReason(value.status, value.stopReason) || value.retryable && !RETRYABLE_STATUS.has(value.status)) return false;
  if (ATTEMPT_TERMINAL_STATUS.has(value.status) !== (value.finishedAtUtc !== null)) return false;
  return value.finishedAtUtc === null ? value.freshness !== 'terminal' : value.freshness === 'terminal';
}
function validPage(value, keys, itemGuard, maxItems) {
  return exact(value, keys) && utc(value.authorityAtUtc) && Array.isArray(value.items) && value.items.length <= maxItems && typeof value.hasMore === 'boolean' && (value.nextCursor === null || typeof value.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value.nextCursor)) && value.items.every(itemGuard) && value.items.every((item) => !item.updatedAtUtc || Date.parse(item.updatedAtUtc) <= Date.parse(value.authorityAtUtc)) && value.hasMore === (value.nextCursor !== null);
}
export const validateParserRunPage = (value) => validPage(value, ['authorityAtUtc','items','nextCursor','hasMore'], validRun, 100);
export const validateParserTaskPage = (value, expectedRunId) => validPage(value, ['authorityAtUtc','runId','items','nextCursor','hasMore'], validTask, 200) && guid(value.runId) && (expectedRunId === undefined || value.runId === expectedRunId);
export const validateParserAttemptPage = (value, expectedRunId, expectedTaskId) => validPage(value, ['authorityAtUtc','runId','taskId','items','nextCursor','hasMore'], validAttempt, 100) && guid(value.runId) && guid(value.taskId) && (expectedRunId === undefined || value.runId === expectedRunId) && (expectedTaskId === undefined || value.taskId === expectedTaskId);
export const validateParserRun = validRun;
export function validateParserActionResponse(value) {
  return exact(value, ['operationId','action','runId','affectedTaskCount','authorityAtUtc','run']) &&
    guid(value.operationId) && ['cancel','resume','retry-failed','retry-selected'].includes(value.action) &&
    guid(value.runId) && integer(value.affectedTaskCount, 1) && utc(value.authorityAtUtc) && validRun(value.run) && value.run.id === value.runId && value.run.updatedAtUtc === value.authorityAtUtc;
}

export function parseParserRunFilters(search) {
  const allowed = new Set(['status','sourceFamily','createdFromUtc','createdToUtc','runId','taskStatus','taskSource','retryability','finding','attemptStatus','attemptRetryable']);
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const result = {};
  for (const [key, value] of params) {
    if (!allowed.has(key) || Object.hasOwn(result, key) || value.length === 0 || value.length > 128) return { ok: false, filters: {} };
    result[key] = value;
  }
  if (result.status && !STATUS.has(result.status)) return { ok: false, filters: {} };
  if (result.sourceFamily && !/^[a-z0-9-]{1,32}$/u.test(result.sourceFamily)) return { ok: false, filters: {} };
  if ((result.createdFromUtc && !utc(result.createdFromUtc)) || (result.createdToUtc && !utc(result.createdToUtc))) return { ok: false, filters: {} };
  if (result.createdFromUtc && result.createdToUtc && Date.parse(result.createdFromUtc) >= Date.parse(result.createdToUtc)) return { ok: false, filters: {} };
  if (result.runId && !guid(result.runId)) return { ok: false, filters: {} };
  if (result.taskStatus && !STATUS.has(result.taskStatus)) return { ok: false, filters: {} };
  if (result.taskSource && !/^[a-z0-9-]{1,32}$/u.test(result.taskSource)) return { ok: false, filters: {} };
  if (result.retryability && !['retryable','non-retryable'].includes(result.retryability)) return { ok: false, filters: {} };
  if (result.finding && !['found','no-data','not-applicable'].includes(result.finding)) return { ok: false, filters: {} };
  if (result.attemptStatus && !STATUS.has(result.attemptStatus)) return { ok: false, filters: {} };
  if (result.attemptRetryable && !['true','false'].includes(result.attemptRetryable)) return { ok: false, filters: {} };
  return { ok: true, filters: result };
}

export function canonicalParserRunFilters(filters) {
  const params = new URLSearchParams();
  for (const key of ['status','sourceFamily','createdFromUtc','createdToUtc','runId','taskStatus','taskSource','retryability','finding','attemptStatus','attemptRetryable']) if (filters[key]) params.set(key, filters[key]);
  const canonical = params.toString();
  return canonical.length === 0 || parseParserRunFilters(canonical).ok ? canonical : '';
}

export function createParserOperationsOwner() {
  return { auth: 1, view: 1, poll: 1, action: 1, export: 1, attempt: 1 };
}
export function advanceParserOperationsOwner(owner, family) {
  const next = { ...owner };
  if (family === 'auth') for (const key of ['auth','view','poll','action','export','attempt']) next[key] += 1;
  else if (family === 'view') { next.view += 1; next.poll += 1; next.attempt += 1; next.export += 1; }
  else next[family] += 1;
  return next;
}
export const captureParserOperationsOwner = (owner) => ({ ...owner });
export const ownsParserOperationsCallback = (owner, token, family) => owner.auth === token.auth &&
  (family === 'view' ? owner.view === token.view :
    family === 'poll' ? owner.view === token.view && owner.poll === token.poll :
      family === 'attempt' ? owner.view === token.view && owner.attempt === token.attempt :
        family === 'export' ? owner.view === token.view && owner.export === token.export :
        family === 'auth' ? true : owner[family] === token[family]);
export const parserPollingPausedMessage = 'Автообновление приостановлено: выбраны строки.';
export const parserPollDelay = (transportFailures) => [5_000, 10_000, 20_000, 30_000][Math.min(Math.max(transportFailures, 0), 3)];

export async function readBoundedParserExport(response, runId, maxBytes = 6_422_936) {
  const expected = `parser-run-${runId}.zip`;
  if (response.headers.get('content-type')?.split(';', 1)[0] !== 'application/zip') throw new Error('parser-export-content-type');
  if (response.headers.get('content-disposition') !== `attachment; filename="${expected}"; filename*=UTF-8''${expected}`) throw new Error('parser-export-disposition');
  const declared = response.headers.get('content-length');
  if (declared === null || !/^[1-9]\d{0,6}$/u.test(declared)) throw new Error('parser-export-length');
  const declaredBytes = Number(declared);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes || !response.body) throw new Error('parser-export-length');
  const reader = response.body.getReader(); const chunks = []; let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      received += value.byteLength;
      if (received > declaredBytes || received > maxBytes) { await reader.cancel('parser-export-bound'); throw new Error('parser-export-bound'); }
      chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }
  } catch (cause) {
    try { await reader.cancel(); } catch { /* bounded cleanup is best effort */ }
    throw cause;
  } finally { reader.releaseLock(); }
  if (received !== declaredBytes) throw new Error('parser-export-truncated');
  return { blob: new Blob(chunks, { type: 'application/zip' }), filename: expected };
}

export const parserStatusLabel = (value) => ({
  'done-found': 'Данные найдены', 'done-no-data': 'Подтверждено: данных нет', pending: 'В очереди', processing: 'В работе',
  invalid: 'Некорректный ввод', ambiguous: 'Неоднозначный ввод',
  'retry-scheduled': 'Повтор запланирован', 'captcha-blocked': 'Источник: CAPTCHA', 'rate-limited': 'Источник ограничил частоту',
  'source-unavailable': 'Источник недоступен', timeout: 'Тайм-аут источника', 'schema-changed': 'Изменилась схема источника', failed: 'Ошибка', canceled: 'Отменено',
}[value] ?? 'Неизвестное состояние');
