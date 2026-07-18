import http from 'node:http';
import { URL } from 'node:url';
import { passengerCarLot, vehicleFilterOptions } from '../public-smoke/fixture-data.mjs';
import { leasingResponse } from '../leasing-smoke/fixture.mjs';
import { ACCOUNT_SMOKE_PROTECTED_PATHS, SIGNALR_ROUTE_STORY_PATH } from './constants.mjs';
import { ACCOUNT_SMOKE_SECOND_USER, ACCOUNT_SMOKE_USER, accountAd, counterpartyEvents, counterpartyInAppAlerts, counterpartyReportForItem, counterpartySecondOwnerWatchItem, counterpartyWatchItem, counterpartyWatchItems, favoriteLot, initialAlert, inboxItem, initialMessages } from './fixture-data.mjs';

const port = Number(process.env.ACCOUNT_SMOKE_BACKEND_PORT || 4022);
const host = process.env.ACCOUNT_SMOKE_BACKEND_HOST || '127.0.0.1';
const appHost = process.env.ACCOUNT_SMOKE_APP_HOST || '127.0.0.1';
const appPort = Number(process.env.ACCOUNT_SMOKE_APP_PORT || 3102);
const allowedHosts = new Set(['127.0.0.1', 'localhost']);

for (const [label, value] of [['ACCOUNT_SMOKE_BACKEND_HOST', host], ['ACCOUNT_SMOKE_APP_HOST', appHost]]) {
  if (!allowedHosts.has(value)) throw new Error(`${label} must be loopback/local IPv4 or localhost for account smoke: ${value}`);
}

const appOrigin = `http://${appHost}:${appPort}`;
const leasingFixtureItem = leasingResponse().items[0];
const accountLeasingEvidence = Object.fromEntries([
  'publishedDate', 'publishedAtUtc', 'fetchedAtUtc', 'companyName', 'assetDescription', 'evidenceSnippet',
  'extractionStatus', 'extractionConfidence', 'extractionReviewState', 'category', 'relevance',
  'classificationConfidence', 'classificationMethod', 'classificationReviewState', 'ruleIds', 'extractedDates',
  'sourceStatus', 'freshUntilUtc', 'caveatCodes',
].map((key) => [key, structuredClone(leasingFixtureItem[key])]));

function createInitialState() {
  const primaryEventEligibility = Object.fromEntries(counterpartyEvents.map((event) => [
    event.id,
    counterpartyInAppAlerts.some((alert) => alert.id === event.id),
  ]));
  return {
    requests: [],
    sessionActive: false,
    currentUserId: null,
    favoriteIds: new Set([favoriteLot.id]),
    votedLotIds: new Set([favoriteLot.id]),
    alerts: [structuredClone(initialAlert)],
    messages: structuredClone(initialMessages),
    inbox: [structuredClone(inboxItem)],
    counterpartyOwners: {
      [ACCOUNT_SMOKE_USER.id]: {
        items: structuredClone(counterpartyWatchItems),
        events: { [counterpartyWatchItem.id]: structuredClone(counterpartyEvents) },
        eventEligibility: { [counterpartyWatchItem.id]: primaryEventEligibility },
        alerts: structuredClone(counterpartyInAppAlerts),
      },
      [ACCOUNT_SMOKE_SECOND_USER.id]: {
        items: [structuredClone(counterpartySecondOwnerWatchItem)], events: {}, eventEligibility: {}, alerts: [],
      },
    },
    counterpartyControl: {
      delays: { items: [], alerts: [], history: [], report: [], create: [], update: [], delete: [], read: [] },
      failures: { items: [], alerts: [], history: [], report: [], create: [], update: [], delete: [], read: [] },
      invalidJson: { create: [] }, offline: { create: [], update: [], delete: [], read: [] },
    },
  };
}

const users = new Map([[ACCOUNT_SMOKE_USER.id, ACCOUNT_SMOKE_USER], [ACCOUNT_SMOKE_SECOND_USER.id, ACCOUNT_SMOKE_SECOND_USER]]);
function activeUser(state) { return users.get(state.currentUserId) || null; }
function ownerCounterparties(state) { return state.counterpartyOwners[state.currentUserId]; }
async function controlled(state, region) {
  const failure = state.counterpartyControl.failures[region].shift();
  const delay = state.counterpartyControl.delays[region].shift() || 0;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  return failure || null;
}
async function controlledMutation(state, region) {
  const control = state.counterpartyControl;
  const failure = control.failures[region].shift() || null;
  const invalidJson = control.invalidJson[region]?.shift() || false;
  const offline = control.offline[region]?.shift() || false;
  const delay = control.delays[region].shift() || 0;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  return { failure, invalidJson, offline };
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
    'access-control-allow-headers': 'content-type,x-requested-with,x-signalr-user-agent,x-lot-view-intent,x-lot-client-id',
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

function disconnect(res, requestRecord) {
  requestRecord.statusCode = 0;
  // A complete response without CORS headers is a deterministic browser-level
  // transport failure. Resetting the socket lets Chromium retry idempotent PUTs,
  // which would turn the offline scenario into a successful mutation.
  res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('offline fixture');
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
      if (url.pathname === '/__smoke/state') {
        const owner = ownerCounterparties(state);
        return json(res, 200, { sessionActive: state.sessionActive, currentUserId: state.currentUserId, favoriteIds: [...state.favoriteIds], alerts: state.alerts, inbox: state.inbox, messages: state.messages, counterpartyItems: owner?.items || [], counterpartyAlerts: owner?.alerts || [], counterpartyEvents: owner?.events || {} }, requestRecord);
      }
      if (url.pathname === '/__smoke/counterparty-control' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.delays) for (const region of ['items', 'alerts', 'history', 'report', 'create', 'update', 'delete', 'read']) state.counterpartyControl.delays[region].push(...(body.delays[region] || []));
        if (body.failures) for (const region of ['items', 'alerts', 'history', 'report', 'create', 'update', 'delete', 'read']) state.counterpartyControl.failures[region].push(...(body.failures[region] || []));
        if (body.invalidJson) state.counterpartyControl.invalidJson.create.push(...(body.invalidJson.create || []));
        if (body.offline) for (const region of ['create', 'update', 'delete', 'read']) state.counterpartyControl.offline[region].push(...(body.offline[region] || []));
        const owner = ownerCounterparties(state);
        const item = owner?.items.find((value) => value.id === body.bumpVersionId);
        if (item) item.version += 1;
        if (body.removeId && owner) {
          owner.items = owner.items.filter((value) => value.id !== body.removeId);
          owner.alerts = owner.alerts.filter((value) => value.watchlistEntryId !== body.removeId);
          delete owner.events[body.removeId];
          delete owner.eventEligibility[body.removeId];
        }
        let projection = null;
        if (body.projectEvent && owner) {
          const spec = body.projectEvent;
          const watch = owner.items.find((value) => value.id === spec.watchlistEntryId);
          if (!watch) return json(res, 404, { title: 'watch not found' }, requestRecord);
          const history = owner.events[watch.id] ||= [];
          const eligibilityByEvent = owner.eventEligibility[watch.id] ||= {};
          let event = history.find((value) => value.id === spec.eventId);
          const created = !event;
          if (!event) {
            event = { ...structuredClone(counterpartyEvents[0]), id: spec.eventId, messageType: spec.messageType, caseNumber: spec.caseNumber, visibleAtUtc: spec.visibleAtUtc || '2026-07-13T09:00:00Z', publicationDateUtc: spec.publicationDateUtc || '2026-07-13T08:55:00Z', sourceReference: `https://fedresurs.ru/bankruptmessages/${spec.sourceKey}` };
            eligibilityByEvent[event.id] = Boolean(watch.enabled && watch.alertOptIn);
            history.unshift(event);
          }
          // Production persists CounterpartyWatchEvent.AlertEligible at event creation.
          // Replay must use that immutable snapshot, never current watch preferences.
          const eligible = eligibilityByEvent[event.id] === true;
          if (eligible && !owner.alerts.some((value) => value.id === event.id)) owner.alerts.unshift({ ...structuredClone(event), watchlistEntryId: watch.id, watchlistDisplayName: watch.displayLabel || watch.name, readAtUtc: null, isRead: false });
          projection = { created, eligible, eventCount: history.filter((value) => value.id === event.id).length, alertCount: owner.alerts.filter((value) => value.id === event.id).length };
        }
        if (body.expireSession) { state.sessionActive = false; state.currentUserId = null; }
        return json(res, 200, { ok: true, projection }, requestRecord);
      }
      if (url.pathname === '/api/health/version' && req.method === 'GET') return json(res, 200, { version: 'account-smoke', commit: 'fixture', environment: 'local' }, requestRecord);
      if (url.pathname === '/api/lots/vehicle-filter-options' && req.method === 'GET') return json(res, 200, vehicleFilterOptions, requestRecord);
      if (url.pathname === '/api/lots/list' && req.method === 'GET') return json(res, 200, publicLotListFor(url), requestRecord);
      const viewEventMatch = url.pathname.match(/^\/api\/lots\/([^/]+)\/view-events$/);
      if (viewEventMatch && req.method === 'POST') return json(res, 200, { accepted: true, noop: true }, requestRecord);
      const voteMatch = url.pathname.match(/^\/api\/lots\/([^/]+)\/vote(?:\/status)?$/);
      if (voteMatch) {
        if (!requireAuth(state, req, res, requestRecord)) return;
        const lotId = decodeURIComponent(voteMatch[1]);
        if (lotId !== favoriteLot.id) return json(res, 404, { message: 'Лот не найден' }, requestRecord);
        if (req.method === 'PUT') state.votedLotIds.add(lotId);
        else if (req.method === 'DELETE') state.votedLotIds.delete(lotId);
        else if (req.method !== 'GET') return json(res, 405, { message: 'method not allowed' }, requestRecord);
        return json(res, 200, { isVoted: state.votedLotIds.has(lotId), votesCount: state.votedLotIds.has(lotId) ? 1 : 0 }, requestRecord);
      }
      const lotMatch = url.pathname.match(/^\/api\/lots\/(.+)$/);
      if (lotMatch && req.method === 'GET') {
        const id = decodeURIComponent(lotMatch[1]);
        const lot = [favoriteLot, passengerCarLot].find((item) => String(item.publicId) === id || item.id === id || item.slug === id);
        return lot ? json(res, 200, lot, requestRecord) : json(res, 404, { error: 'lot not found', id }, requestRecord);
      }

      if (url.pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await readBody(req);
        const matched = [ACCOUNT_SMOKE_USER, ACCOUNT_SMOKE_SECOND_USER].find((user) => body.email === user.email && body.password === user.password);
        if (!matched) {
          return json(res, 401, { message: 'invalid fixture credentials' }, requestRecord);
        }
        state.sessionActive = true;
        state.currentUserId = matched.id;
        const { password, ...user } = matched;
        return json(res, 200, user, requestRecord, { 'set-cookie': 'account_smoke_session=fixture; Path=/; HttpOnly; SameSite=Lax' });
      }
      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        state.sessionActive = false;
        state.currentUserId = null;
        return json(res, 200, { ok: true }, requestRecord, { 'set-cookie': 'account_smoke_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
      }
      if (url.pathname === '/api/auth/me' && req.method === 'GET') {
        if (!requireAuth(state, req, res, requestRecord)) return;
        const { password, ...user } = activeUser(state);
        return json(res, 200, user, requestRecord);
      }

      if (req.method === 'GET' && [
        '/api/admin/ads/moderation/count',
        '/api/admin/lots/needs-description/count',
        '/api/admin/lots/unmatched-vehicle-attributes/count',
      ].includes(url.pathname)) {
        if (!requireAuth(state, req, res, requestRecord)) return;
        return json(res, 200, { count: 0 }, requestRecord);
      }

      const counterpartyReport = url.pathname.match(/^\/api\/counterparty-watchlist\/([^/]+)\/due-diligence-report$/);
      if (counterpartyReport && req.method === 'GET') {
        const privacyHeaders = {
          'cache-control': 'private, no-store, max-age=0', pragma: 'no-cache', vary: 'Authorization, Cookie',
          'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
        };
        if (!state.sessionActive || !hasFixtureSessionCookie(req)) {
          requestRecord.statusCode = 401; res.writeHead(401, headers(privacyHeaders)); return res.end();
        }
        const id = decodeURIComponent(counterpartyReport[1]);
        const item = ownerCounterparties(state).items.find((value) => value.id === id);
        const failure = await controlled(state, 'report');
        if (!item || failure === 404) {
          requestRecord.statusCode = 404; res.writeHead(404, headers(privacyHeaders)); return res.end();
        }
        if (failure === 401) {
          state.sessionActive = false; state.currentUserId = null;
          requestRecord.statusCode = 401; res.writeHead(401, headers(privacyHeaders)); return res.end();
        }
        if (failure) return json(res, failure, { title: 'PRIVATE-RAW-MUST-NOT-ECHO' }, requestRecord, privacyHeaders);
        return json(res, 200, counterpartyReportForItem(item), requestRecord, privacyHeaders);
      }

      if (!state.sessionActive && ACCOUNT_SMOKE_PROTECTED_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`))) {
        return requireAuth(state, req, res, requestRecord);
      }
      if (state.sessionActive && ACCOUNT_SMOKE_PROTECTED_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`)) && !hasFixtureSessionCookie(req)) {
        return requireAuth(state, req, res, requestRecord);
      }

      const counterpartyLeasingSignals = url.pathname.match(/^\/api\/counterparty-watchlist\/([^/]+)\/leasing-signals$/);
      if (counterpartyLeasingSignals && req.method === 'GET') {
        const id = decodeURIComponent(counterpartyLeasingSignals[1]);
        const item = ownerCounterparties(state).items.find((value) => value.id === id);
        if (!item) return json(res, 404, { title: 'not found' }, requestRecord);
        const linked = id === counterpartyWatchItem.id;
        return json(res, 200, {
          authorityAtUtc: '2026-07-17T09:59:59Z', state: linked ? 'found' : 'unlinked',
          sourceHealth: { state: 'healthy', latestOutcomeStatus: 'done-found', latestOutcomeRetryable: false,
            latestOutcomeFinishedAtUtc: '2026-07-17T09:59:00Z', lastSuccessfulAtUtc: '2026-07-17T09:59:00Z' },
          associationBasis: 'user-configured-name-filter', identityConfirmed: false,
          caveatCodes: ['unverified-name-filter-association'], totalMatchedCount: linked ? 1 : 0,
          items: linked ? [accountLeasingEvidence] : [],
        }, requestRecord);
      }

      if (url.pathname === '/api/favorites/ids' && req.method === 'GET') return json(res, 200, [...state.favoriteIds], requestRecord);

      if (url.pathname === '/api/counterparty-watchlist/alerts' && req.method === 'GET') {
        const offset = Number(url.searchParams.get('offset') || 0); const limit = Number(url.searchParams.get('limit') || 50);
        const values = ownerCounterparties(state).alerts;
        const payload = { items: structuredClone(values.slice(offset, offset + limit)), offset, limit, hasMore: offset + limit < values.length };
        const failure = await controlled(state, 'alerts');
        return failure ? json(res, failure, { title: 'PRIVATE-RAW-MUST-NOT-ECHO' }, requestRecord) : json(res, 200, payload, requestRecord);
      }
      const counterpartyRead = url.pathname.match(/^\/api\/counterparty-watchlist\/alerts\/([^/]+)\/read$/);
      if (counterpartyRead && req.method === 'PUT') {
        const mode = await controlledMutation(state, 'read');
        if (mode.offline) return disconnect(res, requestRecord);
        if (mode.failure) return json(res, mode.failure, { title: 'PRIVATE-RAW-MUST-NOT-ECHO' }, requestRecord);
        const alert = ownerCounterparties(state).alerts.find((item) => item.id === decodeURIComponent(counterpartyRead[1]));
        if (!alert) return json(res, 404, { title: 'not found' }, requestRecord);
        if (!alert.readAtUtc) alert.readAtUtc = '2026-07-13T08:00:00Z';
        alert.isRead = true; requestRecord.statusCode = 204; res.writeHead(204, headers()); return res.end();
      }
      if (url.pathname === '/api/counterparty-watchlist' && req.method === 'GET') {
        const offset = Number(url.searchParams.get('offset') || 0); const limit = Number(url.searchParams.get('limit') || 50);
        const values = ownerCounterparties(state).items;
        const payload = { items: structuredClone(values.slice(offset, offset + limit)), offset, limit, hasMore: offset + limit < values.length };
        const failure = await controlled(state, 'items');
        return failure ? json(res, failure, { title: 'PRIVATE-RAW-MUST-NOT-ECHO' }, requestRecord) : json(res, 200, payload, requestRecord);
      }
      if (url.pathname === '/api/counterparty-watchlist' && req.method === 'POST') {
        const body = await readBody(req);
        const mode = await controlledMutation(state, 'create');
        if (mode.offline) return disconnect(res, requestRecord);
        if (mode.failure) return json(res, mode.failure, { title: 'PRIVATE-RAW-MUST-NOT-ECHO' }, requestRecord);
        const owner = ownerCounterparties(state);
        const item = { ...structuredClone(counterpartyWatchItem), ...body, id: `44444444-4444-4444-8444-${String(owner.items.length + 2).padStart(12, '0')}`, displayLabel: body.displayLabel ?? null, identityStatus: 'pending', alertOptIn: false, version: 1, snapshot: { ...counterpartyWatchItem.snapshot, identityStatus: 'pending', sourceStatus: 'unknown', freshnessStatus: 'unknown', lastSucceededAtUtc: null, lastEventAtUtc: null } };
        owner.items.unshift(item); owner.events[item.id] = [];
        return mode.invalidJson ? text(res, 200, 'application/json; charset=utf-8', '{invalid-json', requestRecord) : json(res, 200, item, requestRecord);
      }
      const counterpartyHistory = url.pathname.match(/^\/api\/counterparty-watchlist\/([^/]+)\/events$/);
      if (counterpartyHistory && req.method === 'GET') {
        const id = decodeURIComponent(counterpartyHistory[1]);
        const owner = ownerCounterparties(state);
        if (!owner.items.some((item) => item.id === id)) return json(res, 404, { title: 'not found' }, requestRecord);
        const offset = Number(url.searchParams.get('offset') || 0); const limit = Number(url.searchParams.get('limit') || 50);
        const values = owner.events[id] || [];
        const payload = { items: structuredClone(values.slice(offset, offset + limit)), offset, limit, hasMore: offset + limit < values.length };
        const failure = await controlled(state, 'history');
        return failure ? json(res, failure, { title: 'PRIVATE-RAW-MUST-NOT-ECHO' }, requestRecord) : json(res, 200, payload, requestRecord);
      }
      const counterpartyItemMatch = url.pathname.match(/^\/api\/counterparty-watchlist\/([^/]+)$/);
      if (counterpartyItemMatch) {
        const owner = ownerCounterparties(state);
        const id = decodeURIComponent(counterpartyItemMatch[1]);
        if (req.method === 'GET') {
          const index = owner.items.findIndex((item) => item.id === id);
          return index === -1 ? json(res, 404, { title: 'not found' }, requestRecord) : json(res, 200, owner.items[index], requestRecord);
        }
        if (req.method === 'PUT') {
          const body = await readBody(req); const mode = await controlledMutation(state, 'update');
          if (mode.offline) return disconnect(res, requestRecord);
          if (mode.failure) return json(res, mode.failure, { title: 'PRIVATE-RAW-MUST-NOT-ECHO' }, requestRecord);
          const index = owner.items.findIndex((item) => item.id === id);
          if (index === -1) return json(res, 404, { title: 'not found' }, requestRecord);
          const current = owner.items[index];
          if (body.version !== current.version) return json(res, 409, { title: 'conflict', detail: 'PRIVATE-RAW-MUST-NOT-ECHO' }, requestRecord);
          owner.items[index] = { ...current, enabled: body.enabled, alertOptIn: body.alertOptIn, displayLabel: body.displayLabel ?? null, version: current.version + 1 };
          requestRecord.statusCode = 204; res.writeHead(204, headers()); return res.end();
        }
        if (req.method === 'DELETE') {
          const mode = await controlledMutation(state, 'delete');
          if (mode.offline) return disconnect(res, requestRecord);
          if (mode.failure) return json(res, mode.failure, { title: 'PRIVATE-RAW-MUST-NOT-ECHO' }, requestRecord);
          const index = owner.items.findIndex((item) => item.id === id);
          if (index === -1) return json(res, 404, { title: 'not found' }, requestRecord);
          owner.items.splice(index, 1); owner.alerts = owner.alerts.filter((alert) => alert.watchlistEntryId !== id); requestRecord.statusCode = 204; res.writeHead(204, headers()); return res.end();
        }
      }
      if (url.pathname === '/api/favorites' && req.method === 'GET') return json(res, 200, paged(state.favoriteIds.has(favoriteLot.id) ? [favoriteLot] : []), requestRecord);
      if (url.pathname === `/api/contracts/permission/${favoriteLot.id}` && req.method === 'GET') {
        return json(res, 200, { hasPermission: false }, requestRecord);
      }
      if (url.pathname === '/api/voted-lots' && req.method === 'GET') {
        return json(res, 200, paged(state.votedLotIds.has(favoriteLot.id) ? [favoriteLot] : []), requestRecord);
      }
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
