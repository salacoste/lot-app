import http from 'node:http';
import { pathToFileURL } from 'node:url';
import {
  CASE_BATCH_PRIVATE, CASE_BATCH_SMOKE_USER, caseBatchItems, caseBatchJob, jobId, previewFixture,
} from './fixture-data.mjs';

const defaultHost = process.env.CASE_BATCH_SMOKE_BACKEND_HOST || '127.0.0.1';
const defaultPort = Number(process.env.CASE_BATCH_SMOKE_BACKEND_PORT || 4023);
const appOrigin = `http://${process.env.CASE_BATCH_SMOKE_APP_HOST || '127.0.0.1'}:${Number(process.env.CASE_BATCH_SMOKE_APP_PORT || 3103)}`;
const loopback = new Set(['127.0.0.1', 'localhost']);

function responseHeaders(extra = {}) {
  return {
    'access-control-allow-origin': appOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,idempotency-key',
    'cache-control': 'private, no-store, max-age=0',
    pragma: 'no-cache',
    vary: 'Authorization, Cookie',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...extra,
  };
}

function json(res, status, value, record, extra = {}) {
  record.status = status;
  const body = JSON.stringify(value);
  res.writeHead(status, responseHeaders({ 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...extra }));
  res.end(body);
}

function bytes(res, status, contentType, body, record, filename) {
  record.status = status;
  res.writeHead(status, responseHeaders({
    'content-type': contentType,
    'content-disposition': `attachment; filename="${filename}"`,
    'content-length': body.length,
  }));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function cookieAuthenticated(req, state) {
  return state.sessionActive && String(req.headers.cookie || '').split(';').map((part) => part.trim())
    .includes('case_batch_smoke_session=fixture');
}

function publicUser() {
  return Object.fromEntries(Object.entries(CASE_BATCH_SMOKE_USER).filter(([key]) => key !== 'password'));
}

function safeRequest(req, url) {
  const caseBatchPath = url.pathname.replace(
    /^\/api\/case-batches\/[0-9a-f-]{36}(?=\/|$)/iu,
    '/api/case-batches/[job]',
  );
  return { method: req.method, path: caseBatchPath, status: null, at: new Date().toISOString() };
}

export function createCaseBatchMockBackend() {
  const state = {
    requests: [], sessionActive: false, status: 'processing', polls: 0, freeze: false,
    delayedDetailMs: 0, jobCreated: false, previewKey: null,
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${defaultHost}:${defaultPort}`);
    const record = safeRequest(req, url);
    state.requests.push(record);
    if (req.method === 'OPTIONS') {
      record.status = 204; res.writeHead(204, responseHeaders()); res.end(); return;
    }
    if (url.pathname === '/__case-batch-smoke/health') return json(res, 200, { ok: true }, record);
    if (url.pathname === '/__case-batch-smoke/requests') return json(res, 200, state.requests, record);
    if (url.pathname === '/__case-batch-smoke/control' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (typeof body.status === 'string') state.status = body.status;
      if (typeof body.freeze === 'boolean') state.freeze = body.freeze;
      if (Number.isInteger(body.delayedDetailMs)) state.delayedDetailMs = body.delayedDetailMs;
      return json(res, 200, { ok: true }, record);
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (body.email !== CASE_BATCH_SMOKE_USER.email || body.password !== CASE_BATCH_SMOKE_USER.password) {
        return json(res, 401, { title: 'unauthorized' }, record);
      }
      state.sessionActive = true;
      return json(res, 200, publicUser(), record, { 'set-cookie': 'case_batch_smoke_session=fixture; Path=/; HttpOnly; SameSite=Lax' });
    }
    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      if (!cookieAuthenticated(req, state)) return json(res, 401, { title: 'unauthorized' }, record);
      return json(res, 200, publicUser(), record);
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      state.sessionActive = false;
      return json(res, 200, { ok: true }, record, { 'set-cookie': 'case_batch_smoke_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
    }
    if (url.pathname.startsWith('/api/case-batches') && !cookieAuthenticated(req, state)) {
      return json(res, 401, { title: 'unauthorized' }, record);
    }
    if (url.pathname === '/api/case-batches/preview' && req.method === 'POST') {
      const body = await readBody(req);
      if (!req.headers['idempotency-key'] || body.length === 0) return json(res, 400, { code: 'invalid-upload' }, record);
      state.previewKey = String(req.headers['idempotency-key']);
      return json(res, 200, previewFixture, record);
    }
    if (url.pathname === '/api/case-batches/confirm' && req.method === 'POST') {
      const body = await readBody(req);
      if (String(req.headers['idempotency-key'] || '') !== state.previewKey ||
          !body.includes(Buffer.from(CASE_BATCH_PRIVATE.token))) {
        return json(res, 409, { code: 'preview-mismatch' }, record);
      }
      state.jobCreated = true; state.status = 'processing'; state.polls = 0;
      return json(res, 201, caseBatchJob(state.status), record);
    }
    if (url.pathname === '/api/case-batches' && req.method === 'GET') {
      return json(res, 200, { items: state.jobCreated ? [caseBatchJob(state.status)] : [], offset: 0, limit: 50, hasMore: false }, record);
    }
    const detail = url.pathname.match(/^\/api\/case-batches\/([^/]+)$/u);
    if (detail && req.method === 'GET') {
      if (decodeURIComponent(detail[1]) !== jobId || !state.jobCreated) return json(res, 404, {}, record);
      const captured = state.status;
      if (state.delayedDetailMs) {
        const delay = state.delayedDetailMs; state.delayedDetailMs = 0;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (!state.freeze && captured === 'processing' && ++state.polls >= 2) state.status = 'completed-with-failures';
      return json(res, 200, caseBatchJob(captured), record);
    }
    const items = url.pathname.match(/^\/api\/case-batches\/([^/]+)\/items$/u);
    if (items && req.method === 'GET') {
      if (decodeURIComponent(items[1]) !== jobId || !state.jobCreated) return json(res, 404, {}, record);
      const requestedOffset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10);
      const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
      const offset = Number.isSafeInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
      const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 50;
      const pageItems = caseBatchItems.slice(offset, offset + limit);
      return json(res, 200, {
        items: pageItems,
        offset,
        limit,
        hasMore: offset + pageItems.length < caseBatchItems.length,
      }, record);
    }
    const action = url.pathname.match(/^\/api\/case-batches\/([^/]+)\/(cancel|resume|retry-failed)$/u);
    if (action && req.method === 'POST') {
      if (decodeURIComponent(action[1]) !== jobId || !state.jobCreated) return json(res, 404, {}, record);
      state.status = action[2] === 'cancel' ? 'canceled' : 'processing';
      state.freeze = action[2] === 'cancel';
      state.polls = 0;
      return json(res, 200, caseBatchJob(state.status), record);
    }
    const exportRoute = url.pathname.match(/^\/api\/case-batches\/([^/]+)\/export$/u);
    if (exportRoute && req.method === 'GET') {
      if (decodeURIComponent(exportRoute[1]) !== jobId || !state.jobCreated) return json(res, 404, {}, record);
      if (url.searchParams.get('format') === 'csv') {
        return bytes(res, 200, 'text/csv; charset=utf-8', Buffer.from('row,status,masked_target\n2,found-local,ИНН ••••••3893\n', 'utf8'), record, 'case-batch.csv');
      }
      return bytes(res, 200, 'application/json; charset=utf-8', Buffer.from(JSON.stringify({ items: caseBatchItems })), record, 'case-batch.json');
    }
    if (url.pathname.startsWith('/chathub')) return json(res, 501, { code: 'smoke-no-signalr' }, record);
    if (url.pathname.startsWith('/api/admin/') || url.pathname === '/api/favorites/ids' || url.pathname === '/api/voted-lots') {
      return json(res, 200, url.pathname === '/api/voted-lots' ? { items: [], totalPages: 0 } : { count: 0 }, record);
    }
    return json(res, 404, { title: 'not found' }, record);
  });
  server.caseBatchState = state;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!loopback.has(defaultHost)) throw new Error('Case-batch smoke backend must use loopback.');
  const server = createCaseBatchMockBackend();
  server.listen(defaultPort, defaultHost, () => console.log(`[case-batch-smoke] backend ${defaultHost}:${defaultPort}`));
}
