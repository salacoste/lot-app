import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeCounterpartyUpdate, emptyHistoryMessage, formatMoscowDate, freshnessStatusView,
  identityStatusView, mergeById, safeCounterpartyError, safeFedresursEvidenceUrl,
  monitoringTimeView, sourceStatusView, validateCounterpartyCreate, validateInn, validateOgrn,
  beginDueDiligenceReport, completeDueDiligenceReport, dueDiligenceReportCopy,
  dueDiligenceReportFailureCopy, dueDiligenceReportLevelLabel, dueDiligenceReasonView,
  dueDiligenceSourceSummaryView, emptyDueDiligenceReport,
} from '../../utils/counterpartyMonitoring.logic.shared.mjs';

test('identifier validation matches legal-entity INN-10 and OGRN-13 contract', () => {
  assert.equal(validateInn('7736050003'), null);
  assert.equal(validateInn('7736050004'), 'Контрольная сумма ИНН не совпадает.');
  assert.match(validateInn('500100732259'), /физлица/u);
  assert.equal(validateOgrn('1027700070518'), null);
  assert.match(validateOgrn('304500116000157'), /ОГРНИП/u);
  assert.match(validateOgrn('1027700070519'), /сумма/u);
  assert.deepEqual(validateCounterpartyCreate({ name: ' A\u202E B ' }), { name: 'Название содержит недопустимые символы или слишком длинное.' });
  assert.deepEqual(validateCounterpartyCreate({}), { name: 'Укажите ИНН, ОГРН или название длиной не менее двух символов.' });
});

test('status axes are exhaustive and unknown remains neutral', () => {
  assert.equal(identityStatusView('pending').label, 'Ожидает проверки');
  assert.equal(identityStatusView('alien').label, 'Неизвестно');
  assert.equal(sourceStatusView('no-bankruptcy-data', 'fresh').label, 'Сообщения не найдены');
  assert.equal(sourceStatusView('no-bankruptcy-data', 'stale').label, 'Статус источника требует обновления');
  assert.equal(sourceStatusView('alien', 'fresh').label, 'Неизвестно');
  assert.equal(freshnessStatusView('stale').label, 'Данные устарели');
  assert.equal(freshnessStatusView('alien').label, 'Неизвестно');
  assert.equal(emptyHistoryMessage('confirmed', 'no-bankruptcy-data', 'fresh'), 'По последней успешной проверке сообщения не найдены.');
  assert.equal(/сообщения не найдены/u.test(emptyHistoryMessage('confirmed', 'no-bankruptcy-data', 'stale')), false);
  for (const state of ['pending', 'ambiguous', 'not-found', 'invalid-input', 'unknown']) assert.ok(emptyHistoryMessage(state, 'unknown', 'unknown'));
});

test('Moscow formatter is timezone-explicit, future-neutral and boundary-safe', () => {
  const reference = Date.parse('2026-01-02T00:00:00Z');
  assert.match(formatMoscowDate('2026-01-01T00:00:00Z', reference), /03:00 МСК/u);
  assert.match(formatMoscowDate('2025-12-31T21:00:00Z', reference), /01\.01\.2026, 00:00 МСК/u);
  assert.equal(formatMoscowDate('not-a-date', reference), 'Время недоступно');
  assert.equal(formatMoscowDate(null, reference), 'Время недоступно');
  assert.equal(monitoringTimeView('2999-01-01T00:00:00Z', reference).accepted, false);
  assert.equal(monitoringTimeView('2026-01-02T00:05:00Z', reference).accepted, true);
  assert.equal(monitoringTimeView('2026-01-02T00:05:00.001Z', reference).accepted, false);
  assert.equal(monitoringTimeView('2025-12-31T00:00:00Z', reference).dateTime, '2025-12-31T00:00:00.000Z');
});

test('evidence URL allowlist rejects traversal, ambiguity and exfiltration', () => {
  assert.equal(safeFedresursEvidenceUrl('https://fedresurs.ru/bankruptmessages/abc'), 'https://fedresurs.ru/bankruptmessages/abc');
  for (const value of [
    'http://fedresurs.ru/bankruptmessages/a', 'https://evil.example/bankruptmessages/a',
    'https://user@fedresurs.ru/bankruptmessages/a', 'https://fedresurs.ru:444/bankruptmessages/a',
    'https://fedresurs.ru/bankruptmessages/a?x=1', 'https://fedresurs.ru/bankruptmessages/a#x',
    'https://fedresurs.ru/bankruptmessages/a/b', 'https://fedresurs.ru/bankruptmessages/%2e%2e',
    'https://fedresurs.ru/bankruptmessages/a%2fb', 'https://fedresurs.ru//bankruptmessages/a',
  ]) assert.equal(safeFedresursEvidenceUrl(value), null, value);
});

test('pagination merge dedupes and update payload is complete', () => {
  assert.deepEqual(mergeById([{ id: 'a', value: 1 }], [{ id: 'a', value: 2 }, { id: 'b', value: 3 }]), [{ id: 'a', value: 2 }, { id: 'b', value: 3 }]);
  assert.deepEqual(mergeById([{ id: 'a' }], [{ id: 'b' }], true), [{ id: 'b' }]);
  assert.deepEqual(completeCounterpartyUpdate({ enabled: true, alertOptIn: false, displayLabel: 'A', version: 7 }, { alertOptIn: true }), {
    enabled: true, alertOptIn: true, displayLabel: 'A', version: 7,
  });
});

test('safe errors never echo response bodies', () => {
  assert.match(safeCounterpartyError(400), /формы/u);
  assert.match(safeCounterpartyError(401), /Повторите/u);
  assert.match(safeCounterpartyError(404), /недоступна/u);
  assert.match(safeCounterpartyError(409), /актуальную версию/u);
  assert.match(safeCounterpartyError(429), /много запросов/u);
  assert.match(safeCounterpartyError(500), /Повторите/u);
});

test('due diligence report copy is the exact reviewed executable corpus', () => {
  const expected = {
    'report.title': 'Отчёт о проверке контрагента', 'action.open': 'Открыть отчёт',
    'action.close': 'Закрыть отчёт', 'action.download': 'Скачать JSON', 'action.print': 'Печать',
    'action.retry': 'Повторить', 'state.loading': 'Формируем отчёт…',
    'state.timeout': 'Не удалось сформировать отчёт за отведённое время. Повторите попытку.',
    'state.unavailable': 'Отчёт сейчас недоступен. Повторите попытку позже.',
    'state.notFound': 'Запись больше недоступна; список обновлён.',
    'state.unauthorized': 'Сессия завершена. Переходим ко входу…',
    'axis.level': 'Уровень риска', 'axis.confidence': 'Надёжность оценки', 'axis.coverage': 'Полнота покрытия',
    'level.high': 'Высокий', 'level.medium': 'Средний', 'level.low': 'Низкий', 'level.unknown': 'Не определён',
    'disclaimer.not-legal-advice': 'Отчёт не является юридической консультацией или заключением.',
    'disclaimer.coverage-may-be-incomplete': 'Данные источников могут быть неполными, устаревшими или временно недоступными.',
    'disclaimer.kad-operator-asserted-unverified': 'Данные КАД загружены оператором, не подтверждены источником и отражают только найденные положительные сигналы; отсутствие записей ничего не доказывает.',
    'disclaimer.low-not-proof-of-solvency': 'Низкий уровень не доказывает платёжеспособность, безопасность или отсутствие споров и банкротных событий.',
  };
  for (const [key, value] of Object.entries(expected)) assert.equal(dueDiligenceReportCopy(key), value, key);
  assert.equal(dueDiligenceReportCopy('unknown.key'), '');
  for (const level of ['high', 'medium', 'low', 'unknown']) assert.equal(dueDiligenceReportLevelLabel(level), expected[`level.${level}`]);
  assert.equal(dueDiligenceReportLevelLabel('future'), expected['level.unknown']);
  assert.equal(dueDiligenceReportFailureCopy(408), expected['state.timeout']);
  assert.equal(dueDiligenceReportFailureCopy(500), expected['state.unavailable']);
});

test('due diligence reason and source render projections cover the complete closed vocabulary', () => {
  const reasons = {
    'fns-liquidated': 'fns', 'fns-termination-recorded': 'fns',
    'fedresurs-recent-bankruptcy-publication': 'fedresurs-bankruptcy',
    'kad-high-value-defendant-case': 'kad-litigation', 'fns-reorganizing': 'fns',
    'fedresurs-historical-bankruptcy-publication': 'fedresurs-bankruptcy',
    'kad-defendant-case': 'kad-litigation', 'fns-no-adverse-structural-marker': 'fns',
    'fedresurs-no-bankruptcy-data': 'fedresurs-bankruptcy', 'identity-unresolved': 'assessment',
    'fns-missing': 'fns', 'fns-conflicted': 'fns', 'fns-stale': 'fns', 'fns-source-error': 'fns',
    'fedresurs-missing': 'fedresurs-bankruptcy', 'fedresurs-stale': 'fedresurs-bankruptcy',
    'fedresurs-source-error': 'fedresurs-bankruptcy', 'kad-conflicted-case': 'kad-litigation',
    'kad-stale': 'kad-litigation', 'kad-source-error': 'kad-litigation',
    'kad-positive-only-coverage': 'kad-litigation', 'internal-evidence-inconsistent': 'assessment',
    'insufficient-reliable-coverage': 'assessment', 'explanations-truncated': 'assessment',
  };
  for (const [code, source] of Object.entries(reasons)) {
    assert.deepEqual(dueDiligenceReasonView({ code, source, evidenceCount: 256 }), {
      code, summary: `Источник: ${source}; свидетельств: 256.`,
    });
  }

  const sources = ['fns', 'fedresurs-bankruptcy', 'kad-litigation'];
  const states = ['inconsistent', 'adverse', 'conflicted', 'unavailable', 'clean', 'non-decisive-positive', 'neutral', 'missing'];
  const freshnessValues = ['fresh', 'stale', 'unknown'];
  const confidenceValues = ['high', 'medium', 'low', 'unknown'];
  let projections = 0;
  for (const source of sources) for (const state of states) for (const freshness of freshnessValues) for (const confidence of confidenceValues) {
    assert.deepEqual(dueDiligenceSourceSummaryView({ source, state, freshness, confidence, evidenceCount: 0 }), {
      source, summary: `Состояние: ${state}; актуальность: ${freshness}; надёжность: ${confidence}; свидетельств: 0.`,
    });
    projections += 1;
  }
  assert.equal(projections, 288);
});

test('due diligence report state commits only the latest owner-entry-generation and never persists payloads', () => {
  const closed = emptyDueDiligenceReport();
  assert.deepEqual(closed, { status: 'closed' });
  const first = beginDueDiligenceReport('owner-a', 'entry-a', 1);
  const second = beginDueDiligenceReport('owner-a', 'entry-b', 2);
  assert.deepEqual(first, { status: 'loading', ownerKey: 'owner-a', entryId: 'entry-a', generation: 1 });
  const payload = { schemaVersion: 'due-diligence-report-v1' };
  assert.equal(completeDueDiligenceReport(second, 'owner-a', 'entry-a', 1, 'stale', payload), second);
  assert.equal(completeDueDiligenceReport(second, 'owner-b', 'entry-b', 2, 'foreign', payload), second);
  assert.deepEqual(completeDueDiligenceReport(second, 'owner-a', 'entry-b', 2, '{"safe":true}', payload), {
    status: 'ready', ownerKey: 'owner-a', entryId: 'entry-b', generation: 2,
    rawText: '{"safe":true}', report: payload,
  });
  const serializedHelpers = [emptyDueDiligenceReport, beginDueDiligenceReport, completeDueDiligenceReport]
    .map((value) => value.toString()).join('\n');
  assert.doesNotMatch(serializedHelpers, /localStorage|sessionStorage|indexedDB|console\./u);
});
