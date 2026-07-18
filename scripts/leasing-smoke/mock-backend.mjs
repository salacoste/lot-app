import http from 'node:http';
import { createHash } from 'node:crypto';
import { item as leasingItem, leasingResponse } from './fixture.mjs';
const privateHeaders = { 'cache-control': 'private, no-store, max-age=0', pragma: 'no-cache', expires: '0', vary: 'Authorization, Cookie' };
const cors = (origin) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-expose-headers': 'content-disposition,content-type,content-length,cache-control,pragma,expires,vary' });
const json = (res, status, value, headers = {}) => { const bytes = Buffer.from(JSON.stringify(value)); res.writeHead(status, { ...headers, 'content-type': headers['content-type'] ?? 'application/json; charset=utf-8', 'content-length': bytes.length }); res.end(bytes); };
const empty = (res, status, headers = {}) => { res.writeHead(status, { ...headers, 'content-length': 0 }); res.end(); };
export function createLeasingMock({ origin }) {
  let mode = 'healthy'; const requests = []; const allRequests = [];
  let savedSearches = []; let alerts = [];
  let deleteReloadSnapshot = null;
  const privateFixture = { sourceRecordKey: 'internal-only', inputContentHash: 'internal-only', syntheticCorpus: null };
  const privateAuditLog = [];
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1'); const headers = cors(origin);
    if (req.method === 'OPTIONS') return empty(res, 204, headers);
    if (url.pathname === '/__leasing/control') {
      mode = url.searchParams.get('mode') ?? 'healthy'; requests.length = 0;
      deleteReloadSnapshot = null;
      if (['delete-paging-race', 'delete-reload-failed', 'delete-reload-stale'].includes(mode)) {
        const timestamp = '2026-07-17T10:00:00Z';
        savedSearches = [
          { id: '22222222-2222-4222-8222-222222222222', name: 'Удаляемый поиск', company: 'ООО Удалить', category: null, confidence: null, reviewState: null, alertOptIn: true, counterpartyWatchlistEntryId: null, version: 3, createdAtUtc: timestamp, updatedAtUtc: timestamp },
          { id: '33333333-3333-4333-8333-333333333333', name: 'Сохраняемый поиск', company: 'ООО Оставить', category: null, confidence: null, reviewState: null, alertOptIn: true, counterpartyWatchlistEntryId: null, version: 2, createdAtUtc: timestamp, updatedAtUtc: timestamp },
        ];
        alerts = Array.from({ length: 40 }, (_, index) => {
          const deleting = index < 10 || index >= 35;
          const saved = deleting ? savedSearches[0] : savedSearches[1];
          return { id: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`, savedSearchId: saved.id,
            savedSearchName: saved.name, filterSnapshot: { company: saved.company, category: null, confidence: null, reviewState: null },
            visibleAtUtc: timestamp, readAtUtc: null, evidence: alertEvidence(deleting ? `DELETE-TARGET-${index + 1}` : `KEEP-UNLOADED-${index + 1}`) };
        });
      }
      const syntheticCorpus = url.searchParams.get('privateCorpus');
      if (syntheticCorpus) { privateFixture.syntheticCorpus = syntheticCorpus; privateAuditLog.push({ event: 'private-corpus-seeded', syntheticCorpus }); }
      const privateCorpusSha256 = privateFixture.syntheticCorpus ? createHash('sha256').update(privateFixture.syntheticCorpus).digest('hex') : null;
      return json(res, 200, { mode, privateCorpusSeeded: privateFixture.syntheticCorpus !== null, privateCorpusSha256, privateAuditEventCount: privateAuditLog.length }, headers);
    }
    if (url.pathname === '/__leasing/requests') return json(res, 200, requests, headers);
    if (url.pathname === '/__leasing/all-requests') return json(res, 200, allRequests, headers);
    const authorized = (req.headers.cookie ?? '').includes('leasing-owner=1'); const requestLog = { method: req.method, path: url.pathname, query: url.search, authorized }; requests.push(requestLog); allRequests.push(requestLog);
    if (url.pathname === '/api/auth/me') return authorized ? json(res, 200, { id: 'owner-1', email: 'owner@example.test', name: 'Owner' }, headers) : empty(res, 401, headers);
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') return empty(res, 204, headers);
    if (url.pathname === '/api/counterparty-watchlist' && req.method === 'GET') return authorized
      ? json(res, 200, { offset: 0, limit: 50, hasMore: false, items: [] }, { ...privateHeaders, ...headers })
      : empty(res, 401, { ...privateHeaders, ...headers });
    if (!url.pathname.startsWith('/api/leasing-intelligence')) return empty(res, 404, headers);
    if (!authorized || mode === 'unauthorized') return empty(res, 401, { ...privateHeaders, ...headers });
    if (url.pathname === '/api/leasing-intelligence/saved-searches' && req.method === 'GET') {
      if (deleteReloadSnapshot && ['delete-reload-failed', 'delete-reload-stale'].includes(mode)) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (mode === 'delete-reload-stale')
          return json(res, 200, { items: deleteReloadSnapshot.saved, totalCount: deleteReloadSnapshot.saved.length, maxItems: 50 }, { ...privateHeaders, ...headers });
      }
      return json(res, 200, { items: savedSearches, totalCount: savedSearches.length, maxItems: 50 }, { ...privateHeaders, ...headers });
    }
    if (url.pathname === '/api/leasing-intelligence/saved-searches' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req)); const existing = savedSearches.find((item) => item.company === body.company && item.category === body.category && item.confidence === body.confidence && item.reviewState === body.reviewState);
      if (existing) return json(res, existing.name === body.name && existing.counterpartyWatchlistEntryId === body.counterpartyWatchlistEntryId && !existing.alertOptIn ? 200 : 409, existing.name === body.name ? existing : { type: 'about:blank', title: 'Conflict', status: 409 }, { ...privateHeaders, ...headers });
      const now = '2026-07-17T10:00:00Z'; const item = { id: '22222222-2222-4222-8222-222222222222', name: body.name, company: body.company, category: body.category, confidence: body.confidence, reviewState: body.reviewState, alertOptIn: false, counterpartyWatchlistEntryId: body.counterpartyWatchlistEntryId, version: 1, createdAtUtc: now, updatedAtUtc: now };
      savedSearches = [item, ...savedSearches]; return json(res, 201, item, { ...privateHeaders, ...headers });
    }
    const savedMatch = /^\/api\/leasing-intelligence\/saved-searches\/([0-9a-f-]{36})$/u.exec(url.pathname);
    if (savedMatch && req.method === 'PUT') {
      const body = JSON.parse(await readBody(req)); const current = savedSearches.find((item) => item.id === savedMatch[1]);
      if (!current) return json(res, 404, { type: 'about:blank', title: 'Not Found', status: 404 }, { ...privateHeaders, ...headers, 'content-type': 'application/problem+json' });
      if (current.version !== body.version) return json(res, 409, { type: 'about:blank', title: 'Conflict', status: 409 }, { ...privateHeaders, ...headers, 'content-type': 'application/problem+json' });
      if (mode === 'delayed-save') await new Promise((resolve) => setTimeout(resolve, 500));
      const next = { ...current, name: body.name, company: body.company, category: body.category, confidence: body.confidence, reviewState: body.reviewState, counterpartyWatchlistEntryId: body.counterpartyWatchlistEntryId, alertOptIn: body.alertOptIn, version: current.version + 1, updatedAtUtc: '2026-07-17T10:01:00Z' };
      savedSearches = savedSearches.map((item) => item.id === next.id ? next : item); return json(res, 200, next, { ...privateHeaders, ...headers });
    }
    if (savedMatch && req.method === 'DELETE') {
      deleteReloadSnapshot = { saved: structuredClone(savedSearches), alerts: structuredClone(alerts) };
      savedSearches = savedSearches.filter((item) => item.id !== savedMatch[1]); alerts = alerts.filter((item) => item.savedSearchId !== savedMatch[1]);
      return empty(res, 204, { ...privateHeaders, ...headers });
    }
    if (url.pathname === '/api/leasing-intelligence/alerts' && req.method === 'GET') {
      const offset = Number(url.searchParams.get('offset') ?? 0); const limit = Number(url.searchParams.get('limit') ?? 25);
      if (mode === 'delete-paging-race' && offset > 0) await new Promise((resolve) => setTimeout(resolve, 500));
      if (deleteReloadSnapshot && ['delete-reload-failed', 'delete-reload-stale'].includes(mode)) {
        await new Promise((resolve) => setTimeout(resolve, 650));
        if (mode === 'delete-reload-failed')
          return json(res, 500, { type: 'about:blank', title: 'Internal Server Error', status: 500 }, { ...privateHeaders, ...headers, 'content-type': 'application/problem+json' });
        const stale = deleteReloadSnapshot.alerts;
        return json(res, 200, { authorityAtUtc: '2026-07-17T09:59:59Z', offset, limit,
          hasMore: offset + limit < stale.length, totalCount: stale.length, items: stale.slice(offset, offset + limit) }, { ...privateHeaders, ...headers });
      }
      return json(res, 200, { authorityAtUtc: '2026-07-17T09:59:59Z', offset, limit,
        hasMore: offset + limit < alerts.length, totalCount: alerts.length, items: alerts.slice(offset, offset + limit) }, { ...privateHeaders, ...headers });
    }
    if (mode === 'invalid') return json(res, 400, { type: 'about:blank', title: 'Invalid leasing intelligence request.', status: 400, code: 'leasing-invalid-query' }, { ...privateHeaders, ...headers, 'content-type': 'application/problem+json; charset=utf-8' });
    if (mode === 'error') return json(res, 500, { type: 'about:blank', title: 'Leasing intelligence is temporarily unavailable.', status: 500, code: 'leasing-search-unavailable' }, { ...privateHeaders, ...headers, 'content-type': 'application/problem+json; charset=utf-8' });
    if (url.pathname.endsWith('/export')) {
      if (mode === 'delay-export') await new Promise((resolve) => setTimeout(resolve, 500));
      if (mode === 'large') return json(res, 409, { type: 'about:blank', title: 'Leasing intelligence export is too large.', status: 409, code: 'leasing-export-too-large' }, { ...privateHeaders, ...headers, 'content-type': 'application/problem+json; charset=utf-8' });
      const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('"generated_at_utc","company_name"\r\n"2026-07-17T10:00:00.0000000Z","\'=FORMULA"\r\n')]);
      res.writeHead(200, { ...privateHeaders, ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="leasing-intelligence-20260717-100000Z.csv"', 'content-length': bytes.length }); return res.end(bytes);
    }
    if (mode === 'delayed-default' && url.search === '') await new Promise((resolve) => setTimeout(resolve, 500));
    if (mode === 'delayed') await new Promise((resolve) => setTimeout(resolve, url.searchParams.get('company')?.includes('Старый') ? 500 : 20));
    if (mode === 'delayed-error') {
      const old = url.searchParams.get('company')?.includes('Старый'); await new Promise((resolve) => setTimeout(resolve, old ? 500 : 20));
      if (old) return json(res, 500, { type: 'about:blank', title: 'Leasing intelligence is temporarily unavailable.', status: 500, code: 'leasing-search-unavailable' }, { ...privateHeaders, ...headers, 'content-type': 'application/problem+json; charset=utf-8' });
    }
    const value = leasingResponse({ empty: mode === 'empty', degraded: mode === 'degraded', unknown: mode === 'unknown', stale: mode === 'degraded', low: mode === 'low' });
    for (const key of ['from', 'to', 'company', 'category', 'confidence', 'reviewState', 'sourceStatus']) if (url.searchParams.has(key)) value.filters[key] = url.searchParams.get(key);
    value.offset = Number(url.searchParams.get('offset') ?? 0); value.limit = Number(url.searchParams.get('limit') ?? 25);
    if (['delayed', 'delayed-error'].includes(mode) && value.filters.company) value.items[0] = { ...value.items[0], companyName: value.filters.company };
    if (mode === 'paging') {
      const total = 26; const returned = Math.max(0, Math.min(value.limit, total - value.offset));
      value.totalCount = total; value.hasMore = value.offset + returned < total;
      value.items = Array.from({ length: returned }, (_, index) => ({ ...value.items[0], classificationId: `11111111-1111-4111-8111-${String(value.offset + index + 1).padStart(12, '0')}`, companyName: `ООО Страница ${value.offset + index + 1}` }));
      for (const totals of [value.summary.categoryTotals, value.summary.confidenceTotals, value.summary.reviewStateTotals, value.summary.sourceStatusTotals]) for (const bucket of totals) bucket.count = 0;
      value.summary.categoryTotals.find((x) => x.value === 'lifting').count = total; value.summary.confidenceTotals.find((x) => x.value === 'high').count = total;
      value.summary.reviewStateTotals.find((x) => x.value === 'auto-accepted').count = total; value.summary.sourceStatusTotals.find((x) => x.value === 'fresh').count = total;
    }
    return json(res, 200, value, { ...privateHeaders, ...headers });
  });
}
function alertEvidence(companyName) {
  return { publishedDate: leasingItem.publishedDate, publishedAtUtc: leasingItem.publishedAtUtc,
    fetchedAtUtc: leasingItem.fetchedAtUtc, companyName, assetDescription: leasingItem.assetDescription,
    evidenceSnippet: leasingItem.evidenceSnippet, extractionStatus: leasingItem.extractionStatus,
    extractionConfidence: leasingItem.extractionConfidence, extractionReviewState: leasingItem.extractionReviewState,
    category: leasingItem.category, relevance: leasingItem.relevance,
    classificationConfidence: leasingItem.classificationConfidence, classificationMethod: leasingItem.classificationMethod,
    classificationReviewState: leasingItem.classificationReviewState, ruleIds: leasingItem.ruleIds,
    extractedDates: leasingItem.extractedDates, sourceStatus: leasingItem.sourceStatus,
    freshUntilUtc: leasingItem.freshUntilUtc, caveatCodes: leasingItem.caveatCodes };
}
async function readBody(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks).toString('utf8'); }
export async function listenLeasingMock(server, port) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); return `http://127.0.0.1:${port}`; }
