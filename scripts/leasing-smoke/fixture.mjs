const categories = ['earthmoving', 'lifting', 'concrete-asphalt', 'roadbuilding', 'transport-support', 'attachments', 'other', 'unknown', 'ambiguous'];
const buckets = (values, selected) => values.map((value) => ({ value, count: value === selected ? 1 : 0 }));
export const item = Object.freeze({
  classificationId: '11111111-1111-4111-8111-111111111111', sourceMessageId: null, sourceUrl: null, sourceReferenceState: 'unavailable',
  publishedDate: '2026-07-10', publishedAtUtc: null, fetchedAtUtc: '2026-07-10T10:00:00Z', partyRole: 'weak-side', companyName: 'ООО Синтетический контур',
  assetDescription: 'автокран тестовый', evidenceSnippet: 'Передан автокран тестовый', extractionStatus: 'processed', extractionConfidence: 'medium', extractionReviewState: 'needs-review',
  category: 'lifting', relevance: 'construction', classificationConfidence: 'high', classificationMethod: 'deterministic-rules', classificationReviewState: 'auto-accepted',
  ruleIds: ['equipment.crane.v1'], extractedDates: [{ dateKind: 'contract', value: '2026-07-01', confidence: 'medium', reviewState: 'needs-review' }],
  sourceStatus: 'fresh', freshUntilUtc: '2026-07-17T10:00:00Z', caveatCodes: ['derived-observation', 'weak-party-role', 'not-risk-conclusion', 'source-reference-unavailable'],
});
export function leasingResponse({ empty = false, degraded = false, unknown = false, stale = false, low = false } = {}) {
  const row = { ...item, ...(stale ? { sourceStatus: 'stale', fetchedAtUtc: '2026-07-10T09:59:59Z', freshUntilUtc: '2026-07-17T09:59:59Z', caveatCodes: [...item.caveatCodes, 'stale-observations'] } : {}), ...(low ? { classificationConfidence: 'low', classificationReviewState: 'needs-review', category: 'ambiguous', relevance: 'ambiguous' } : {}) };
  const rows = empty ? [] : [row]; const count = rows.length;
  const health = unknown ? { state: 'unknown', latestOutcomeStatus: null, latestOutcomeRetryable: null, latestOutcomeFinishedAtUtc: null, lastSuccessfulAtUtc: null } : degraded ? { state: 'degraded', latestOutcomeStatus: 'timeout', latestOutcomeRetryable: true, latestOutcomeFinishedAtUtc: '2026-07-17T09:00:00Z', lastSuccessfulAtUtc: '2026-07-16T09:00:00Z' } : { state: 'healthy', latestOutcomeStatus: 'done-found', latestOutcomeRetryable: false, latestOutcomeFinishedAtUtc: '2026-07-17T09:00:00Z', lastSuccessfulAtUtc: '2026-07-17T09:00:00Z' };
  const caveats = [...item.caveatCodes, ...(stale ? ['stale-observations'] : []), ...(degraded ? ['source-degraded'] : [])];
  return { authorityAtUtc: '2026-07-17T09:59:59Z', filters: { from: '2026-04-19', to: '2026-07-17', company: null, category: null, confidence: null, reviewState: null, sourceStatus: null }, offset: 0, limit: 25, hasMore: false, totalCount: count, items: rows,
    summary: { categoryTotals: buckets(categories, low ? 'ambiguous' : count ? 'lifting' : ''), confidenceTotals: buckets(['high', 'medium', 'low', 'unknown'], low ? 'low' : count ? 'high' : ''), reviewStateTotals: buckets(['auto-accepted', 'needs-review', 'unknown'], low ? 'needs-review' : count ? 'auto-accepted' : ''), sourceStatusTotals: buckets(['fresh', 'stale'], stale ? 'stale' : count ? 'fresh' : '') }, sourceHealth: health, caveatCodes: caveats };
}
