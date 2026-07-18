import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  alertableFiltersFromSuccessfulResponse,
  buildSavedSearchCreate,
  buildSavedSearchUpdate,
  containsDeletedLeasingPrivateMaterial,
  createLeasingRequestCoordinator,
  hasExactLeasingEmpty204,
  hasExactLeasingJsonSuccess,
  readExactLeasingFixedProblem,
  purgeDeletedLeasingPrivateState,
  validateLeasingFixedProblem,
  validateAlertFeed,
  validateCounterpartyLeasingSignals,
  validateSavedSearchItem,
  validateSavedSearchList,
} from '../../utils/leasingAlerts.logic.shared.mjs';

const id = '00112233-4455-6677-8899-aabbccddeeff';
const otherId = '11112233-4455-6677-8899-aabbccddeeff';
const now = '2026-07-17T11:00:00Z';
const freshUntil = '2026-07-24T11:00:00Z';
const health = { state: 'healthy', latestOutcomeStatus: 'done-found', latestOutcomeRetryable: false, latestOutcomeFinishedAtUtc: now, lastSuccessfulAtUtc: now };
const freshCaveats = ['derived-observation', 'weak-party-role', 'not-risk-conclusion', 'source-reference-unavailable'];
const evidence = {
  publishedDate: '2026-07-17', publishedAtUtc: null, fetchedAtUtc: now,
  companyName: 'ООО Тест', assetDescription: 'Экскаватор', evidenceSnippet: 'Экскаватор в лизинге',
  extractionStatus: 'processed', extractionConfidence: 'medium', extractionReviewState: 'needs-review',
  category: 'earthmoving', relevance: 'construction', classificationConfidence: 'high',
  classificationMethod: 'deterministic-rules', classificationReviewState: 'auto-accepted',
  ruleIds: [], extractedDates: [], sourceStatus: 'fresh', freshUntilUtc: freshUntil, caveatCodes: freshCaveats,
};
const staleEvidence = { ...evidence, fetchedAtUtc: '2026-07-09T11:00:00Z', freshUntilUtc: '2026-07-16T11:00:00Z',
  sourceStatus: 'stale', caveatCodes: [...freshCaveats, 'stale-observations'] };
const degradedHealth = { state: 'degraded', latestOutcomeStatus: 'failed', latestOutcomeRetryable: true,
  latestOutcomeFinishedAtUtc: now, lastSuccessfulAtUtc: '2026-07-16T11:00:00Z' };
const unknownHealth = { state: 'unknown', latestOutcomeStatus: null, latestOutcomeRetryable: null,
  latestOutcomeFinishedAtUtc: null, lastSuccessfulAtUtc: null };

test('save authority uses only last successful alertable server filters', () => {
  const response = { filters: { from: '2026-01-01', to: '2026-07-17', company: 'ООО Тест', category: 'earthmoving', confidence: 'high', reviewState: 'auto-accepted', sourceStatus: 'fresh' } };
  assert.deepEqual(alertableFiltersFromSuccessfulResponse(response), {
    company: 'ООО Тест', category: 'earthmoving', confidence: 'high', reviewState: 'auto-accepted',
  });
  assert.equal(alertableFiltersFromSuccessfulResponse(null), null);
});

test('POST and PUT payloads preserve exact required property order and default off', () => {
  const filters = { company: 'ООО Тест', category: null, confidence: null, reviewState: null };
  assert.deepEqual(Object.keys(buildSavedSearchCreate('Тест', filters, null)),
    ['name', 'company', 'category', 'confidence', 'reviewState', 'counterpartyWatchlistEntryId']);
  assert.deepEqual(Object.keys(buildSavedSearchUpdate('Тест', filters, null, true, 2)),
    ['name', 'company', 'category', 'confidence', 'reviewState', 'counterpartyWatchlistEntryId', 'alertOptIn', 'version']);
  assert.equal(buildSavedSearchCreate('Тест', filters, null).alertOptIn, undefined);
  assert.equal(buildSavedSearchUpdate('Тест', filters, null, true, Number.MAX_SAFE_INTEGER).version,
    Number.MAX_SAFE_INTEGER);
});

test('parent passes a stable unauthorized callback so unrelated rerenders do not restart child effects', async () => {
  const source = await readFile(new URL('../../app/account/leasing/LeasingDashboardClient.tsx', import.meta.url), 'utf8');
  assert.match(source, /const handleUnauthorized = useCallback\(\(\) => \{/u);
  assert.match(source, /onUnauthorized=\{handleUnauthorized\}/u);
  assert.doesNotMatch(source, /onUnauthorized=\{\(\) =>/u);
});

test('saved-search list guard freezes item/list order and max 50', () => {
  const item = { id, name: 'Тест', company: 'ООО Тест', category: null, confidence: null, reviewState: null, alertOptIn: false, counterpartyWatchlistEntryId: null, version: 1, createdAtUtc: now, updatedAtUtc: now };
  assert.equal(validateSavedSearchList({ items: [item], totalCount: 1, maxItems: 50 }), true);
  assert.equal(validateSavedSearchItem(item), true);
  assert.equal(validateSavedSearchList({ totalCount: 1, items: [item], maxItems: 50 }), false);
});

test('alert and profile guards reject leaked internal identity fields', () => {
  const feed = { authorityAtUtc: now, offset: 0, limit: 25, hasMore: false, totalCount: 0, items: [] };
  assert.equal(validateAlertFeed(feed), true);
  assert.equal(validateAlertFeed({ ...feed, signalSequence: 1 }), false);
  const profile = { authorityAtUtc: now, state: 'unlinked', sourceHealth: health, associationBasis: 'user-configured-name-filter', identityConfirmed: false, caveatCodes: ['unverified-name-filter-association'], totalMatchedCount: 0, items: [] };
  assert.equal(validateCounterpartyLeasingSignals(profile), true);
  assert.equal(validateCounterpartyLeasingSignals({ ...profile, counterpartyId: id }), false);
});

test('one coordinator invalidates delayed loads and mutations in both directions', () => {
  const coordinator = createLeasingRequestCoordinator();
  const load = coordinator.begin();
  const mutation = coordinator.begin();
  assert.equal(load.signal.aborted, true);
  assert.equal(load.isCurrent(), false);
  assert.equal(mutation.isCurrent(), true);
  const reload = coordinator.begin();
  assert.equal(mutation.signal.aborted, true);
  assert.equal(mutation.isCurrent(), false);
  assert.equal(reload.isCurrent(), true);
  coordinator.abort();
  assert.equal(reload.isCurrent(), false);
});

test('frontend success boundary rejects status, content type and hidden 204 body drift', async () => {
  const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
  assert.equal(hasExactLeasingJsonSuccess(new Response('{}', { status: 200, headers: jsonHeaders }), [200]), true);
  assert.equal(hasExactLeasingJsonSuccess(new Response('{}', { status: 202, headers: jsonHeaders }), [200]), false);
  assert.equal(hasExactLeasingJsonSuccess(new Response('{}', { status: 206, headers: jsonHeaders }), [200]), false);
  assert.equal(hasExactLeasingJsonSuccess(new Response('{}', { status: 200,
    headers: { 'content-type': 'Application/Json; Charset=UTF-8' } }), [200]), false);
  assert.equal(await hasExactLeasingEmpty204(new Response(null, { status: 204,
    headers: { 'content-length': '0' } })), true);
  assert.equal(await hasExactLeasingEmpty204(new Response(null, { status: 204 })), false);
  assert.equal(await hasExactLeasingEmpty204(new Response(null, { status: 204,
    headers: { 'content-length': '0', 'content-type': 'application/json' } })), false);
  const hiddenBody = new Response('x', { status: 200, headers: { 'content-length': '0' } });
  Object.defineProperty(hiddenBody, 'status', { value: 204 });
  assert.equal(await hasExactLeasingEmpty204(hiddenBody), false);
});

test('Story 15-6 fixed problems are exact three-key operation bodies for every documented status', async () => {
  const titles = { 400: 'Bad Request', 404: 'Not Found', 409: 'Conflict', 413: 'Payload Too Large',
    415: 'Unsupported Media Type', 429: 'Too Many Requests', 500: 'Internal Server Error' };
  for (const status of [400, 404, 409, 413, 415, 429, 500]) {
    const value = { type: 'about:blank', title: titles[status], status };
    assert.equal(validateLeasingFixedProblem(value, status), true);
    assert.equal(validateLeasingFixedProblem({ ...value, code: 'wrong-story-contract' }, status), false);
    assert.equal(validateLeasingFixedProblem({ title: value.title, type: value.type, status }, status), false);
    assert.equal(validateLeasingFixedProblem({ ...value, status: status === 500 ? 400 : 500 }, status), false);
    assert.deepEqual(await readExactLeasingFixedProblem(new Response(JSON.stringify(value), { status,
      headers: { 'content-type': 'application/problem+json' } }), [status]), value);
    assert.equal(await readExactLeasingFixedProblem(new Response(JSON.stringify(value), { status,
      headers: { 'content-type': 'application/problem+json' } }), status === 413 ? [400, 429, 500] : [413]), null);
    assert.equal(await readExactLeasingFixedProblem(new Response(JSON.stringify({ ...value, code: 'hostile' }), { status,
      headers: { 'content-type': 'application/problem+json' } }), [status]), null);
    assert.equal(await readExactLeasingFixedProblem(new Response(JSON.stringify(value), { status,
      headers: { 'content-type': 'application/problem+json; charset=utf-8' } }), [status]), null);
  }
  assert.equal(validateLeasingFixedProblem({ type: 'about:blank', title: 'Unknown', status: 418 }, 418), false);
});

test('alert evidence and profile guards freeze generated bounds vocabularies and caveat order', () => {
  const feed = (itemEvidence) => ({ authorityAtUtc: now, offset: 0, limit: 25, hasMore: false, totalCount: 1,
    items: [{ id, savedSearchId: id, savedSearchName: 'Тест', filterSnapshot: { company: 'ООО Тест', category: null,
      confidence: null, reviewState: null }, visibleAtUtc: now, readAtUtc: null, evidence: itemEvidence }] });
  assert.equal(validateAlertFeed(feed({ ...evidence, ruleIds: Array.from({ length: 32 }, (_, i) => `R${i}`) })), true);
  assert.equal(validateAlertFeed(feed({ ...evidence, ruleIds: Array.from({ length: 33 }, (_, i) => `R${i}`) })), false);
  const extractedDate = { dateKind: 'contract', value: '2026-07-17', confidence: 'medium', reviewState: 'needs-review' };
  assert.equal(validateAlertFeed(feed({ ...evidence, extractedDates: Array.from({ length: 8 }, () => extractedDate) })), true);
  assert.equal(validateAlertFeed(feed({ ...evidence, extractedDates: Array.from({ length: 9 }, () => extractedDate) })), false);
  assert.equal(validateAlertFeed(feed({ ...evidence, caveatCodes: [...freshCaveats].reverse() })), false);
  assert.equal(validateAlertFeed(feed(staleEvidence)), true);
  assert.equal(validateAlertFeed(feed({ ...evidence, sourceStatus: 'stale', caveatCodes: freshCaveats })), false);
  assert.equal(validateAlertFeed(feed({ ...evidence, extractionStatus: 'hostile' })), false);
  assert.equal(validateAlertFeed(feed({ ...evidence, companyName: 'Я'.repeat(512) })), true);
  assert.equal(validateAlertFeed(feed({ ...evidence, companyName: 'Я'.repeat(513) })), false);
  assert.equal(validateAlertFeed(feed({ ...evidence, assetDescription: `bad\ud800text` })), false);
  assert.equal(validateAlertFeed(feed({ ...evidence, ruleIds: ['R'.repeat(64)] })), true);
  assert.equal(validateAlertFeed(feed({ ...evidence, ruleIds: ['R'.repeat(65)] })), false);
  assert.equal(validateAlertFeed(feed({ ...evidence, ruleIds: [`R\udc00`] })), false);
  assert.equal(validateAlertFeed(feed({ ...evidence, freshUntilUtc: now })), false);
  assert.equal(validateAlertFeed(feed({ ...evidence, freshUntilUtc: '2026-07-23T11:00:00Z' })), false);
  assert.equal(validateAlertFeed(feed({ ...evidence, sourceStatus: 'stale',
    caveatCodes: [...freshCaveats, 'stale-observations'] })), false);

  const profile = { authorityAtUtc: now, state: 'found', sourceHealth: health,
    associationBasis: 'user-configured-name-filter', identityConfirmed: false,
    caveatCodes: ['unverified-name-filter-association'], totalMatchedCount: 1, items: [evidence] };
  assert.equal(validateCounterpartyLeasingSignals(profile), true);
  assert.equal(validateCounterpartyLeasingSignals({ ...profile,
    caveatCodes: ['unverified-name-filter-association', 'private-extra'] }), false);
  assert.equal(validateCounterpartyLeasingSignals({ ...profile,
    caveatCodes: ['private-extra', 'unverified-name-filter-association'] }), false);
  assert.equal(validateCounterpartyLeasingSignals({ ...profile,
    sourceHealth: { ...health, latestOutcomeRetryable: true } }), false);
  assert.equal(validateCounterpartyLeasingSignals({ ...profile,
    sourceHealth: { ...health, state: 'degraded', latestOutcomeStatus: 'failed', latestOutcomeRetryable: true } }), false);
  assert.equal(validateCounterpartyLeasingSignals({ ...profile,
    sourceHealth: { ...health, lastSuccessfulAtUtc: '2026-07-17T12:00:00Z' } }), false);
});

test('profile guard exhaustively freezes first-match state, count, page and freshness truth table', () => {
  const states = ['unavailable', 'unlinked', 'degraded', 'empty-persisted-set', 'stale', 'found'];
  const healthCases = [unknownHealth, degradedHealth, health];
  const itemCases = [
    [], [evidence], [staleEvidence], [evidence, staleEvidence], [staleEvidence, evidence],
    Array.from({ length: 10 }, () => evidence),
    Array.from({ length: 10 }, () => staleEvidence),
    [evidence, ...Array.from({ length: 9 }, () => staleEvidence)],
  ];
  const totals = [0, 1, 2, 11];
  const expected = (state, sourceHealth, total, items, limit = 10) => {
    const empty = total === 0 && items.length === 0;
    if (state === 'unavailable') return sourceHealth.state === 'unknown' && empty;
    if (state === 'unlinked') return sourceHealth.state !== 'unknown' && empty;
    if (state === 'degraded') return sourceHealth.state === 'degraded' && empty;
    if (state === 'empty-persisted-set') return sourceHealth.state === 'healthy' && empty;
    if (sourceHealth.state !== 'healthy' || total === 0 || items.length !== Math.min(total, limit)) return false;
    const statuses = items.map((item) => item.sourceStatus);
    if (state === 'stale') return statuses.every((status) => status === 'stale');
    const firstStale = statuses.indexOf('stale');
    return state === 'found' && statuses[0] === 'fresh' &&
      (firstStale < 0 || statuses.slice(firstStale).every((status) => status === 'stale'));
  };
  for (const state of states) for (const sourceHealth of healthCases) for (const totalMatchedCount of totals)
  for (const items of itemCases) {
    const profile = { authorityAtUtc: now, state, sourceHealth, associationBasis: 'user-configured-name-filter',
      identityConfirmed: false, caveatCodes: ['unverified-name-filter-association'], totalMatchedCount, items };
    assert.equal(validateCounterpartyLeasingSignals(profile), expected(state, sourceHealth, totalMatchedCount, items),
      `${state}/${sourceHealth.state}/total=${totalMatchedCount}/items=${items.map((item) => item.sourceStatus).join(',')}`);
  }

  const legitimateUnlinkedDegraded = { authorityAtUtc: now, state: 'unlinked', sourceHealth: degradedHealth,
    associationBasis: 'user-configured-name-filter', identityConfirmed: false,
    caveatCodes: ['unverified-name-filter-association'], totalMatchedCount: 0, items: [] };
  assert.equal(validateCounterpartyLeasingSignals(legitimateUnlinkedDegraded), true);
  const page = { ...legitimateUnlinkedDegraded, state: 'found', sourceHealth: health,
    totalMatchedCount: 11, items: Array.from({ length: 10 }, () => evidence) };
  assert.equal(validateCounterpartyLeasingSignals(page, 10), true, 'total may exceed the bounded page length');
  assert.equal(validateCounterpartyLeasingSignals({ ...page, items: page.items.slice(0, 9) }, 10), false);
  assert.equal(validateCounterpartyLeasingSignals({ ...page, totalMatchedCount: 10 }, 10), true);
  assert.equal(validateCounterpartyLeasingSignals({ ...page, totalMatchedCount: 9 }, 10), false);
  assert.equal(validateCounterpartyLeasingSignals(page, 0), false);
  assert.equal(validateCounterpartyLeasingSignals(page, 11), false);
});

test('saved-search delete synchronously purges private state then reloads without resurrection', async () => {
  const saved = [{ id, name: 'deleted' }, { id: otherId, name: 'kept' }];
  const feed = { authorityAtUtc: now, offset: 25, limit: 25, hasMore: true, totalCount: 40,
    items: [{ id: 'a', savedSearchId: id }, { id: 'b', savedSearchId: otherId }] };
  const purged = purgeDeletedLeasingPrivateState(saved, feed, id);
  assert.deepEqual(purged.saved, [{ id: otherId, name: 'kept' }]);
  assert.deepEqual(purged.feed.items, [{ id: 'b', savedSearchId: otherId }]);
  assert.equal(purged.feed.offset, 0); assert.equal(purged.feed.totalCount, 1); assert.equal(purged.feed.hasMore, false);
  assert.equal(containsDeletedLeasingPrivateMaterial(purged.saved, purged.feed.items, new Set([id])), false);
  assert.equal(containsDeletedLeasingPrivateMaterial(saved, feed.items, new Set([id])), true);
  const source = await readFile(new URL('../../app/account/leasing/LeasingAlertsWorkspace.tsx', import.meta.url), 'utf8');
  const removeBody = /async function remove[\s\S]*?async function read/u.exec(source)?.[0] ?? '';
  assert.match(removeBody, /await deleteLeasingSavedSearch[\s\S]*?deletedSearchIds\.current\.add[\s\S]*?setSaved[\s\S]*?setFeed[\s\S]*?await load\(false/u);
  assert.match(source, /containsDeletedLeasingPrivateMaterial\(savedPage\.items, alertsPage\.items, deletedSearchIds\.current\)/u);
});

test('API source binds each Story 15-6 operation to its generated fixed-status union', async () => {
  const source = await readFile(new URL('../../lib/api/leasingIntelligence.ts', import.meta.url), 'utf8');
  assert.match(source, /saved-searches', \{ signal \}, \[400, 429, 500\]\)/u);
  assert.match(source, /method: 'POST'[\s\S]*?\[400, 409, 413, 415, 429, 500\]/u);
  assert.match(source, /method: 'DELETE'[\s\S]*?\[400, 404, 409, 429, 500\]/u);
  assert.match(source, /\/alerts\?\$\{query\}`[\s\S]*?\[400, 429, 500\]/u);
  assert.match(source, /alerts\/\$\{encodeURIComponent\(id\)\}\/read`[\s\S]*?\[400, 404, 429, 500\]/u);
  assert.match(source, /leasing-signals\?\$\{query\}`[\s\S]*?\[400, 404, 429, 500\]/u);
  assert.match(source, /validateCounterpartyLeasingSignals\(value, limit\)/u);
});

test('committed OpenAPI and generated TypeScript freeze both bodyless 204 header contracts', async () => {
  const openapi = JSON.parse(await readFile(new URL('../../../scraper/Lots.WebApi/openapi/Lots.WebApi.json', import.meta.url), 'utf8'));
  for (const operation of [
    openapi.paths['/api/leasing-intelligence/saved-searches/{savedSearchId}'].delete,
    openapi.paths['/api/leasing-intelligence/alerts/{alertId}/read'].put,
  ]) {
    const noContent = operation.responses['204'];
    assert.equal(noContent.description, 'No Content. Content-Length is exactly 0 and Content-Type is absent.');
    assert.equal(noContent['x-content-type-absent'], true);
    assert.deepEqual(noContent.headers['Content-Length'].schema.enum, [0]);
    assert.equal(noContent.content, undefined);
  }
  const generated = await readFile(new URL('../../lib/generated/lots-webapi.ts', import.meta.url), 'utf8');
  assert.ok((generated.match(/"Content-Length": 0;/gu) ?? []).length >= 2);
  assert.ok((generated.match(/No Content\. Content-Length is exactly 0 and Content-Type is absent\./gu) ?? []).length >= 2);
});
