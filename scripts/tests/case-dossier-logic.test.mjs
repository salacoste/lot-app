import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CASE_DOSSIER_REFERENCE_POLICY, actionLabel, caveatLabel, dossierFileName,
  formatInstant, freshnessLabel, problemLabel, safeSourceReference, stateLabel,
} from '../../lib/api/caseDossier.logic.mjs';

test('case dossier copy distinguishes closed states and statuses', () => {
  for (const value of ['found', 'not-found', 'ambiguous', 'stale', 'source-unavailable',
    'blocked-rate-limited', 'timeout', 'schema-changed', 'no-bankruptcy-data',
    'rate-limited-captcha', 'no-case-card', 'no-electronic-case-data',
    'captcha-blocked', 'rate-limited']) {
    assert.notEqual(stateLabel(value), 'Состояние требует проверки', value);
  }
  assert.notEqual(problemLabel(401), problemLabel(404));
  assert.notEqual(problemLabel(408), problemLabel(429));
});

test('source references match the shared canonical backend/frontend corpus byte-for-byte', async () => {
  const corpus = JSON.parse(await readFile(
    new URL('../../../docs/fixtures/case-dossier-reference-policy-corpus.json', import.meta.url), 'utf8'));

  assert.equal(CASE_DOSSIER_REFERENCE_POLICY.version, 'case-dossier-reference-policy-v1');
  assert.equal(corpus.policyVersion, CASE_DOSSIER_REFERENCE_POLICY.version);
  assert.equal(CASE_DOSSIER_REFERENCE_POLICY.maximumLength, 512);
  assert.equal(CASE_DOSSIER_REFERENCE_POLICY.segmentPattern, '^[A-Za-z0-9._~-]+$');
  assert.deepEqual(CASE_DOSSIER_REFERENCE_POLICY.prefixes, [
    'https://fedresurs.ru/bankruptmessages/',
    'https://kad.arbitr.ru/Card/',
    'https://kad.arbitr.ru/Document/',
  ]);

  for (const row of corpus.rows) {
    const accepted = safeSourceReference(row.input);
    assert.equal(accepted !== null, row.accepted, row.input);
    if (row.accepted) assert.deepEqual(Buffer.from(accepted, 'utf8'), Buffer.from(row.input, 'utf8'), row.input);
    else assert.equal(accepted, null, row.input);
  }

  assert.equal(safeSourceReference(`https://kad.arbitr.ru/Card/${'a'.repeat(513)}`), null);
});

test('date and download filename helpers fail closed', () => {
  assert.equal(formatInstant('not-a-date'), 'Дата недоступна');
  assert.equal(dossierFileName('20000000000040008000000000000002'), 'case-dossier-20000000000040008000000000000002.json');
  assert.equal(dossierFileName('А40-1234/2026'), 'case-dossier-case.json');
  assert.equal(dossierFileName('***'), 'case-dossier-case.json');
});

test('server-ordered caveats freshness and actions have safe user copy', () => {
  for (const caveat of ['decision-support-not-legal-advice', 'local-evidence-only',
    'source-freshness-must-be-reviewed', 'snapshot-generated-for-current-account',
    'unsafe-reference-suppressed', 'response-truncated', 'partial-source-failure']) {
    assert.notEqual(caveatLabel(caveat), 'Учитывайте ограничение сохранённых данных.');
  }
  for (const freshness of ['as-observed', 'stale-prior-positive', 'unknown']) {
    assert.notEqual(freshnessLabel(freshness), 'актуальность требует проверки');
  }
  for (const action of ['export-json', 'print', 'create-direct-watch', 'update-direct-watch',
    'enable-direct-watch', 'disable-direct-watch', 'set-alert-opt-in']) {
    assert.notEqual(actionLabel(action), 'Действие доступно');
  }
});
