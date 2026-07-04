import http from 'node:http';
import { URL } from 'node:url';
import { passengerCarLot, vehicleFilterOptions } from '../public-smoke/fixture-data.mjs';
import { ACCOUNT_SMOKE_PROTECTED_PATHS, SIGNALR_ROUTE_STORY_PATH } from './constants.mjs';
import { ACCOUNT_SMOKE_USER, accountAd, favoriteLot, initialAlert, inboxItem, initialMessages } from './fixture-data.mjs';

const port = Number(process.env.ACCOUNT_SMOKE_BACKEND_PORT || 4022);
const host = process.env.ACCOUNT_SMOKE_BACKEND_HOST || '127.0.0.1';
const appHost = process.env.ACCOUNT_SMOKE_APP_HOST || '127.0.0.1';
const appPort = Number(process.env.ACCOUNT_SMOKE_APP_PORT || 3102);
const allowedHosts = new Set(['127.0.0.1', 'localhost']);

for (const [label, value] of [['ACCOUNT_SMOKE_BACKEND_HOST', host], ['ACCOUNT_SMOKE_APP_HOST', appHost]]) {
  if (!allowedHosts.has(value)) throw new Error(`${label} must be loopback/local IPv4 or localhost for account smoke: ${value}`);
}

const appOrigin = `http://${appHost}:${appPort}`;

function createInitialState() {
  return {
    requests: [],
    sessionActive: false,
    favoriteIds: new Set([favoriteLot.id]),
    alerts: [structuredClone(initialAlert)],
    messages: structuredClone(initialMessages),
    inbox: [structuredClone(inboxItem)],
  };
}

function record(req, url) {
  const item = { method: req.method, path: url.pathname, search: url.search, statusCode: null, hasFixtureCookie: hasFixtureSessionCookie(req), at: new Date().toISOString() };
  return item;
}

function hasFixtureSessionCookie(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .includes('account_smoke_session=fixture');
}

function headers(extra = {}) {
  return {
    'access-control-allow-origin': appOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,x-requested-with,x-signalr-user-agent',
    ...extra,
  };
}

function json(res, statusCode, body, requestRecord, extraHeaders = {}) {
  if (requestRecord) requestRecord.statusCode = statusCode;
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, headers({ 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), ...extraHeaders }));
  res.end(payload);
}

function text(res, statusCode, contentType, body, requestRecord) {
  if (requestRecord) requestRecord.statusCode = statusCode;
  res.writeHead(statusCode, headers({ 'content-type': contentType, 'content-length': Buffer.byteLength(body) }));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function requireAuth(state, req, res, requestRecord) {
  if (state.sessionActive && hasFixtureSessionCookie(req)) return true;
  json(res, 401, { error: 'account smoke session required' }, requestRecord);
  return false;
}

function paged(items) {
  return { items, totalPages: 1, page: 1, totalCount: items.length };
}

function publicLotListFor(url) {
  const categories = url.searchParams.getAll('categories');
  const items = categories.includes('Легковой автомобиль') ? [passengerCarLot] : [favoriteLot, passengerCarLot];
  return paged(items);
}

export function createAccountMockBackend() {
  const state = createInitialState();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`);
    const requestRecord = record(req, url);
    state.requests.push(requestRecord);

    try {
      if (req.method === 'OPTIONS') {
        requestRecord.statusCode = 204;
        res.writeHead(204, headers());
        res.end();
        return;
      }

      if (url.pathname === '/__smoke/health') return json(res, 200, { ok: true, requests: state.requests.length }, requestRecord);
      if (url.pathname === '/__smoke/requests') return json(res, 200, state.requests, requestRecord);
      if (url.pathname === '/__smoke/state') return json(res, 200, { sessionActive: state.sessionActive, favoriteIds: [...state.favoriteIds], alerts: state.alerts, inbox: state.inbox, messages: state.messages }, requestRecord);
      if (url.pathname === '/api/health/version' && req.method === 'GET') return json(res, 200, { version: 'account-smoke', commit: 'fixture', environment: 'local' }, requestRecord);
      if (url.pathname === '/api/lots/vehicle-filter-options' && req.method === 'GET') return json(res, 200, vehicleFilterOptions, requestRecord);
      if (url.pathname === '/api/lots/list' && req.method === 'GET') return json(res, 200, publicLotListFor(url), requestRecord);
      const lotMatch = url.pathname.match(/^\/api\/lots\/(.+)$/);
      if (lotMatch && req.method === 'GET') {
        const id = decodeURIComponent(lotMatch[1]);
        const lot = [favoriteLot, passengerCarLot].find((item) => String(item.publicId) === id || item.id === id || item.slug === id);
        return lot ? json(res, 200, lot, requestRecord) : json(res, 404, { error: 'lot not found', id }, requestRecord);
      }

      if (url.pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.email !== ACCOUNT_SMOKE_USER.email || body.password !== ACCOUNT_SMOKE_USER.password) {
          return json(res, 401, { message: 'invalid fixture credentials' }, requestRecord);
        }
        state.sessionActive = true;
        const { password, ...user } = ACCOUNT_SMOKE_USER;
        return json(res, 200, user, requestRecord, { 'set-cookie': 'account_smoke_session=fixture; Path=/; HttpOnly; SameSite=Lax' });
      }
      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        state.sessionActive = false;
        return json(res, 200, { ok: true }, requestRecord, { 'set-cookie': 'account_smoke_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
      }
      if (url.pathname === '/api/auth/me' && req.method === 'GET') {
        if (!requireAuth(state, req, res, requestRecord)) return;
        const { password, ...user } = ACCOUNT_SMOKE_USER;
        return json(res, 200, user, requestRecord);
      }

      if (!state.sessionActive && ACCOUNT_SMOKE_PROTECTED_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))) {
        return requireAuth(state, req, res, requestRecord);
      }
      if (state.sessionActive && ACCOUNT_SMOKE_PROTECTED_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`)) && !hasFixtureSessionCookie(req)) {
        return requireAuth(state, req, res, requestRecord);
      }

      if (url.pathname === '/api/favorites/ids' && req.method === 'GET') return json(res, 200, [...state.favoriteIds], requestRecord);
      if (url.pathname === '/api/favorites' && req.method === 'GET') return json(res, 200, paged(state.favoriteIds.has(favoriteLot.id) ? [favoriteLot] : []), requestRecord);
      const favToggle = url.pathname.match(/^\/api\/favorites\/toggle\/(.+)$/);
      if (favToggle && req.method === 'POST') {
        const id = decodeURIComponent(favToggle[1]);
        if (state.favoriteIds.has(id)) state.favoriteIds.delete(id); else state.favoriteIds.add(id);
        return json(res, 200, { isFavorite: state.favoriteIds.has(id), ids: [...state.favoriteIds] }, requestRecord);
      }

      if (url.pathname === '/api/lotalerts' && req.method === 'GET') return json(res, 200, state.alerts, requestRecord);
      if (url.pathname === '/api/lotalerts' && req.method === 'POST') {
        const body = await readBody(req);
        const alert = { ...initialAlert, ...body, id: `account-smoke-alert-${state.alerts.length + 1}`, isActive: body.isActive ?? true };
        state.alerts.push(alert);
        return json(res, 201, alert, requestRecord);
      }
      const alertMatch = url.pathname.match(/^\/api\/lotalerts\/(.+)$/);
      if (alertMatch && req.method === 'PUT') {
        const id = decodeURIComponent(alertMatch[1]);
        const body = await readBody(req);
        const existingIndex = state.alerts.findIndex((alert) => alert.id === id);
        if (existingIndex === -1) return json(res, 404, { error: 'alert not found', id }, requestRecord);
        state.alerts[existingIndex] = { ...state.alerts[existingIndex], ...body, id };
        return json(res, 200, state.alerts[existingIndex], requestRecord);
      }
      if (alertMatch && req.method === 'DELETE') {
        const id = decodeURIComponent(alertMatch[1]);
        const existingIndex = state.alerts.findIndex((alert) => alert.id === id);
        if (existingIndex === -1) return json(res, 404, { error: 'alert not found', id }, requestRecord);
        state.alerts.splice(existingIndex, 1);
        return json(res, 204, null, requestRecord);
      }

      if (url.pathname === '/api/ads' && req.method === 'GET') return json(res, 200, { ads: [accountAd], total: 1 }, requestRecord);
      if (url.pathname === '/api/ads/my' && req.method === 'GET') return json(res, 200, [accountAd], requestRecord);
      const adMatch = url.pathname.match(/^\/api\/ads\/(.+)$/);
      if (adMatch && req.method === 'GET') return json(res, 200, accountAd, requestRecord);
      if (url.pathname === '/api/ads' && req.method === 'POST') return json(res, 409, { message: 'S3 upload intentionally skipped in account smoke' }, requestRecord);

      if (url.pathname === '/api/chat/inbox' && req.method === 'GET') return json(res, 200, state.inbox, requestRecord);
      if (url.pathname === '/api/chat/history' && req.method === 'GET') return json(res, 200, state.messages, requestRecord);
      if (url.pathname === '/api/chat/read' && req.method === 'POST') {
        state.inbox = state.inbox.map((item) => ({ ...item, unreadCount: 0 }));
        state.messages = state.messages.map((message) => ({ ...message, isRead: true }));
        return json(res, 200, { ok: true }, requestRecord);
      }
      if (url.pathname === '/api/chat/send' && req.method === 'POST') {
        const body = await readBody(req);
        const message = { id: `account-smoke-message-${state.messages.length + 1}`, roomId: inboxItem.roomId, senderId: 'me', text: body.text || 'smoke message', createdAt: new Date().toISOString(), isRead: false };
        state.messages.push(message);
        state.inbox = state.inbox.map((item) => ({ ...item, lastMessageText: message.text, lastMessageDate: message.createdAt }));
        return json(res, 200, message, requestRecord);
      }

      if (url.pathname.startsWith('/chathub')) return json(res, 501, { skipped: true, story: SIGNALR_ROUTE_STORY_PATH }, requestRecord);
      if (url.pathname.endsWith('.svg')) return text(res, 200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#fef3c7"/><text x="24" y="96" font-size="22" fill="#78350f">Account smoke</text></svg>', requestRecord);

      return json(res, 404, { error: 'unknown account smoke endpoint', path: url.pathname }, requestRecord);
    } catch (error) {
      return json(res, 500, { error: error.message }, requestRecord);
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createAccountMockBackend();
  server.listen(port, host, () => console.log(`account smoke mock backend listening at http://${host}:${port}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
