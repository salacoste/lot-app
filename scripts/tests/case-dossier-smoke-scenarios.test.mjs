import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateCaseDossier } from '../../lib/api/caseDossier.validation.mjs';
import { caseDossierIds } from '../case-dossier-smoke/fixture-data.mjs';
import {
  CASE_DOSSIER_SCENARIO_IDS, caseDossierScenario, caseDossierScenarioBytes,
} from '../case-dossier-smoke/scenario-fixtures.mjs';
import { createCaseDossierMockBackend, listenCaseDossierMock } from '../case-dossier-smoke/mock-backend.mjs';

const ownerHeaders = { cookie: 'case-dossier-owner=1' };

async function withBackend(run) {
  const server = createCaseDossierMockBackend();
  const baseUrl = await listenCaseDossierMock(server);
  try { await run(baseUrl); }
  finally { await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); }
}

async function control(baseUrl, scenarioId, variant = '') {
  const response = await fetch(`${baseUrl}/__case-dossier-smoke/control`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenarioId, variant }),
  });
  assert.equal(response.status, 200);
}

test('binding matrix exposes exactly the required 25 fail-closed scenario IDs', () => {
  assert.deepEqual(CASE_DOSSIER_SCENARIO_IDS, Array.from({ length: 25 }, (_, index) => String(index + 1).padStart(2, '0')));
  assert.throws(() => caseDossierScenario('26'), /unknown-case-dossier-scenario/u);
});

test('every positive dynamic fixture passes the same closed runtime validator as the UI', () => {
  const variants = {
    '06': ['unavailable', 'blocked', 'timeout', 'schema'], '14': ['suppressed'], '23': ['positive'],
    '24': ['not-collected', 'found', 'no-data', 'stale', 'ambiguous', 'unavailable',
      'blocked-rate-limited', 'timeout', 'schema-changed'],
  };
  for (const id of CASE_DOSSIER_SCENARIO_IDS) for (const variant of variants[id] ?? ['']) {
    assert.equal(validateCaseDossier(caseDossierScenario(id, variant)), true, `${id}:${variant}`);
  }
});

test('hostile text references and collected unknown fixtures are rejected before rendering', () => {
  for (const [id, variant] of [
    ['14', 'unsafe-link'], ['14', 'bidi'],
    ['23', 'https://FEDRESURS.RU/bankruptmessages/x'], ['23', 'https://kad.arbitr.ru/Card/x?secret=1'],
    ['24', 'unknown'],
  ]) assert.equal(validateCaseDossier(caseDossierScenario(id, variant)), false, `${id}:${variant}`);
  assert.equal(validateCaseDossier(caseDossierScenario('14', 'script')), true, 'script-shaped safe text remains inert text');
});

test('capped multi-projection issues accept omitted current members and reject false cap metadata', () => {
  assert.equal(validateCaseDossier(caseDossierScenario('22')), true, 'valid pre-cap issues survive the global member cap');
  for (const variant of [
    'ordinal-beyond-current-total', 'false-current-count', 'visible-member-tuple-mismatch',
  ]) assert.equal(validateCaseDossier(caseDossierScenario('22', variant)), false, variant);
});

test('scenario control returns exact selected bytes and keeps request evidence sanitized', async () => {
  await withBackend(async (baseUrl) => {
    await control(baseUrl, '04');
    const response = await fetch(`${baseUrl}/api/case-dossiers/${caseDossierIds.ownerCase}`, { headers: ownerHeaders });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), caseDossierScenarioBytes('04'));
    const requests = await (await fetch(`${baseUrl}/__case-dossier-smoke/requests`)).json();
    assert.deepEqual(requests, [{ method: 'GET', path: '/api/case-dossiers/[case]', status: 200 }]);
    assert.doesNotMatch(JSON.stringify(requests), /20000000|А40|7707083893/u);
  });
});

test('409 fixture is single-use and watch paths are opaque in request evidence', async () => {
  await withBackend(async (baseUrl) => {
    await control(baseUrl, '10');
    const dossier = await (await fetch(`${baseUrl}/api/case-dossiers/${caseDossierIds.ownerCase}`, { headers: ownerHeaders })).json();
    const watch = dossier.watch.directWatch;
    const request = () => fetch(`${baseUrl}/api/case-progress-watches/${watch.id}`, {
      method: 'PUT', headers: { ...ownerHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ version: watch.version, enabled: false, alertOptIn: false, displayLabel: watch.displayLabel }),
    });
    assert.equal((await request()).status, 409);
    assert.equal((await request()).status, 409, 'stale version remains conflict and is not silently accepted');
    const requests = await (await fetch(`${baseUrl}/__case-dossier-smoke/requests`)).json();
    assert.equal(requests.filter((row) => row.path === '/api/case-progress-watches/[watch]').length, 2);
    assert.doesNotMatch(JSON.stringify(requests), new RegExp(watch.id, 'u'));
  });
});

test('runner fails closed on missing IDs and evidence schema contains only scenario status/count fields', async () => {
  const source = await readFile(resolve(process.cwd(), 'scripts/case-dossier-smoke/run-case-dossier-smoke.mjs'), 'utf8');
  assert.match(source, /equalScenarioCoverage\(recorder\.results\)/u);
  assert.match(source, /CASE_DOSSIER_SCENARIO_IDS/u);
  assert.match(source, /scenarioCount/u);
  assert.match(source, /assertionCount/u);
  assert.match(source, /requestCount/u);
  assert.match(source, /\{ id, status, assertionCount, requestCount \}/u);
});
