import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalLeasingSearch, normalizeCompany, parseLeasingSearch, resetLeasingSearch, safeLeasingError, validateLeasingResponse } from '../../utils/leasingDashboard.logic.shared.mjs';

const filters = { from: '2026-01-01', to: '2026-01-31', company: 'ООО Тест + Партнёр', category: 'lifting', confidence: 'low', reviewState: 'needs-review', sourceStatus: 'stale' };
test('canonical URL has frozen order, encoding and omitted page defaults', () => {
  assert.equal(canonicalLeasingSearch(filters), 'from=2026-01-01&to=2026-01-31&company=%D0%9E%D0%9E%D0%9E%20%D0%A2%D0%B5%D1%81%D1%82%20%2B%20%D0%9F%D0%B0%D1%80%D1%82%D0%BD%D1%91%D1%80&category=lifting&confidence=low&reviewState=needs-review&sourceStatus=stale');
  assert.equal(canonicalLeasingSearch(filters, 25, 50).endsWith('&offset=25&limit=50'), true);
  assert.equal(canonicalLeasingSearch({ ...filters, company: "!*'()~ +" }).split('&').find((part) => part.startsWith('company=')), 'company=%21%2A%27%28%29~%20%2B');
});
test('reset removes only leasing keys', () => assert.equal(resetLeasingSearch('?campaign=safe&company=test&limit=50'), 'campaign=safe'));
test('strict parser keeps plus literal and rejects framework-lenient forms', () => {
  assert.equal(parseLeasingSearch('?from=2026-01-01&to=2026-01-02&company=A+B', '2026-07-17').filters.company, 'A+B');
  for (const query of ['?from=2026-01-01&&to=2026-01-02', '?from=2026-01-01&to=2026-01-02&company=%ZZ', '?from=2026-01-01&to=2026-01-02&%63ategory=lifting&category=lifting', '?from=2026-01-01&to=2026-01-02&other=x', '?from=2026-01-01&to=2026-01-02=bad']) assert.equal(parseLeasingSearch(query, '2026-07-17').ok, false, query);
});
test('URL parser rejects invalid pairs, spans, vocabularies and page grammar', () => {
  for (const query of ['?from=2026-01-01', '?from=2025-01-01&to=2026-01-02', '?category=LIFTING', '?offset=01', '?limit=0', '?company=x']) assert.equal(parseLeasingSearch(query, '2026-07-17').ok, false, query);
  assert.equal(parseLeasingSearch('', '2026-07-17').filters.to, '2026-07-17');
});
test('company normalization is NFKC bounded and rejects controls', () => {
  assert.equal(normalizeCompany('  ＡＢ  '), 'AB'); assert.equal(normalizeCompany('A\u200bB'), null); assert.equal(normalizeCompany('x'), null);
});

const buckets = (values) => values.map((value) => ({ value, count: 0 }));
const response = {
  authorityAtUtc: '2026-07-17T10:00:00Z', filters: { ...filters }, offset: 0, limit: 25, hasMore: false, totalCount: 1,
  items: [{ classificationId: '11111111-1111-4111-8111-111111111111', sourceMessageId: null, sourceUrl: null, sourceReferenceState: 'unavailable', publishedDate: '2026-01-10', publishedAtUtc: null, fetchedAtUtc: '2026-01-10T10:00:00Z', partyRole: 'weak-side', companyName: 'ООО Тест', assetDescription: 'кран', evidenceSnippet: 'кран', extractionStatus: 'processed', extractionConfidence: 'medium', extractionReviewState: 'needs-review', category: 'lifting', relevance: 'construction', classificationConfidence: 'high', classificationMethod: 'deterministic-rules', classificationReviewState: 'auto-accepted', ruleIds: ['equipment.crane.v1'], extractedDates: [], sourceStatus: 'stale', freshUntilUtc: '2026-01-17T10:00:00Z', caveatCodes: ['derived-observation', 'weak-party-role', 'not-risk-conclusion', 'source-reference-unavailable', 'stale-observations'] }],
  summary: { categoryTotals: buckets(['earthmoving', 'lifting', 'concrete-asphalt', 'roadbuilding', 'transport-support', 'attachments', 'other', 'unknown', 'ambiguous']), confidenceTotals: buckets(['high', 'medium', 'low', 'unknown']), reviewStateTotals: buckets(['auto-accepted', 'needs-review', 'unknown']), sourceStatusTotals: buckets(['fresh', 'stale']) },
  sourceHealth: { state: 'degraded', latestOutcomeStatus: 'timeout', latestOutcomeRetryable: true, latestOutcomeFinishedAtUtc: '2026-07-17T09:00:00Z', lastSuccessfulAtUtc: '2026-07-16T09:00:00Z' },
  caveatCodes: ['derived-observation', 'weak-party-role', 'not-risk-conclusion', 'source-reference-unavailable', 'stale-observations', 'source-degraded'],
};
for (const key of ['categoryTotals', 'confidenceTotals', 'reviewStateTotals', 'sourceStatusTotals']) response.summary[key][key === 'categoryTotals' ? 1 : key === 'sourceStatusTotals' ? 1 : 0].count = 1;
test('runtime guard accepts exact contract and rejects extra/private/malformed fields', () => {
  assert.equal(validateLeasingResponse(response), true);
  assert.equal(validateLeasingResponse({ ...response, items: [{ ...response.items[0], companyName: 'ООО\nТест', evidenceSnippet: 'строка 1\r\nстрока 2\tфрагмент' }] }), true);
  assert.equal(validateLeasingResponse({ ...response, privateValue: 'no' }), false);
  assert.equal(validateLeasingResponse({ ...response, items: [{ ...response.items[0], sourceUrl: 'https://example.test' }] }), false);
  assert.equal(validateLeasingResponse({ ...response, summary: { ...response.summary, categoryTotals: response.summary.categoryTotals.slice(1) } }), false);
  assert.equal(validateLeasingResponse({ ...response, items: [{ ...response.items[0], companyName: '' }] }), false);
  assert.equal(validateLeasingResponse({ ...response, items: [{ ...response.items[0], companyName: '\ud800' }] }), false);
  assert.equal(validateLeasingResponse({ ...response, sourceHealth: { state: 'unknown', latestOutcomeStatus: null, latestOutcomeRetryable: null, latestOutcomeFinishedAtUtc: null, lastSuccessfulAtUtc: '2026-07-16T09:00:00Z' } }), false);
  assert.equal(validateLeasingResponse({ ...response, sourceHealth: { ...response.sourceHealth, lastSuccessfulAtUtc: '2026-07-18T09:00:00Z' } }), false);
  assert.equal(validateLeasingResponse({ ...response, sourceHealth: { state: 'healthy', latestOutcomeStatus: 'done-found', latestOutcomeRetryable: false, latestOutcomeFinishedAtUtc: '2026-07-17T09:00:00Z', lastSuccessfulAtUtc: null } }), false);
  assert.equal(validateLeasingResponse({ ...response, sourceHealth: { state: 'healthy', latestOutcomeStatus: 'done-no-data', latestOutcomeRetryable: false, latestOutcomeFinishedAtUtc: '2026-07-17T09:00:00Z', lastSuccessfulAtUtc: '2026-07-16T09:00:00Z' } }), false);
});
test('fixed error copy never reflects backend content', () => {
  assert.match(safeLeasingError(400), /фильтр/u); assert.match(safeLeasingError(409), /5000/u); assert.doesNotMatch(safeLeasingError(500), /exception/iu);
});
