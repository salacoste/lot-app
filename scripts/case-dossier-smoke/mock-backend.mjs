import http from 'node:http';
import { caseDossierBytes, caseDossierIds, caseDossierProblems, caseDossierSnapshot } from './fixture-data.mjs';
import {
  CASE_DOSSIER_SCENARIO_IDS, caseDossierScenario, caseDossierScenarioBytes,
} from './scenario-fixtures.mjs';

const privateHeaders = Object.freeze({
  'cache-control': 'private, no-store, max-age=0',
  pragma: 'no-cache',
  vary: 'Authorization, Cookie',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow, noarchive',
});

function corsHeaders(appOrigin) {
  return {
    'access-control-allow-origin': appOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function assertLoopbackAddress(value) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(value)) {
    throw new Error('case-dossier-smoke-loopback-only');
  }
}

function writeEmpty(response, status, extra = {}) {
  response.writeHead(status, { ...privateHeaders, ...extra, 'content-length': '0' });
  response.end();
}

function writeJson(response, status, value, extra = {}) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(status, {
    ...extra,
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.length),
  });
  response.end(bytes);
}

function writeProblem(response, problem, extra = {}) {
  const bytes = Buffer.from(JSON.stringify(problem), 'utf8');
  response.writeHead(problem.status, {
    ...privateHeaders,
    ...extra,
    'content-type': 'application/problem+json; charset=utf-8',
    'content-length': String(bytes.length),
  });
  response.end(bytes);
}

function sanitizePath(pathname) {
  return pathname.replace(
    /^\/api\/case-dossiers\/(?:[0-9a-f]{32}|[0-9a-f-]{36})$/iu,
    '/api/case-dossiers/[case]',
  ).replace(/^\/api\/case-progress-watches\/[0-9a-f]{32}$/iu, '/api/case-progress-watches/[watch]');
}

export function createCaseDossierMockBackend({
  host = '127.0.0.1', appOrigin = 'http://127.0.0.1:3114',
} = {}) {
  assertLoopbackAddress(host);
  const parsedOrigin = new URL(appOrigin);
  assertLoopbackAddress(parsedOrigin.hostname);
  const requests = [];
  let directWatch = null;
  let scenarioId = '02';
  let scenarioVariant = '';
  let conflictRemaining = 0;
  const readBody = async (request) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    return body;
  };
  const resetScenario = (id, variant = '') => {
    if (!CASE_DOSSIER_SCENARIO_IDS.includes(id)) throw new Error('unknown-case-dossier-scenario');
    scenarioId = id; scenarioVariant = variant;
    const fixture = caseDossierScenario(id, variant);
    directWatch = fixture?.watch.directWatch ? structuredClone(fixture.watch.directWatch) : null;
    conflictRemaining = id === '10' ? 1 : 0;
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${host}`);
    const cors = corsHeaders(appOrigin);

    if (url.pathname === '/__case-dossier-smoke/control' && request.method === 'POST') {
      try {
        const control = JSON.parse(await readBody(request) || '{}');
        resetScenario(String(control.scenarioId ?? ''), String(control.variant ?? ''));
        requests.length = 0;
        return writeJson(response, 200, { scenarioId }, cors);
      } catch {
        return writeJson(response, 400, { code: 'invalid-smoke-control' }, cors);
      }
    }
    if (url.pathname === '/__case-dossier-smoke/reset-requests' && request.method === 'POST') {
      requests.length = 0;
      return writeJson(response, 200, { ok: true }, cors);
    }
    if (url.pathname === '/__case-dossier-smoke/requests') {
      return writeJson(response, 200, requests, cors);
    }

    requests.push({ method: request.method ?? 'GET', path: sanitizePath(url.pathname), status: null });
    const row = requests.at(-1);

    if (request.method === 'OPTIONS') {
      row.status = 204;
      response.writeHead(204, cors);
      response.end();
      return;
    }

    if (url.pathname === '/__case-dossier-smoke/health') {
      row.status = 200;
      writeJson(response, 200, { ok: true }, cors);
      return;
    }

    const cookie = request.headers.cookie ?? '';
    const authorized = cookie.includes('case-dossier-owner=1');
    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      row.status = authorized ? 200 : 401;
      if (!authorized) return writeEmpty(response, 401, cors);
      return writeJson(response, 200, {
        id: caseDossierIds.account, name: 'Case Dossier Owner', email: 'owner@example.test',
        isSubscriptionActive: true, isOnTrial: false, isAdmin: false,
      }, cors);
    }

    if (url.pathname === '/api/case-progress-watches' && request.method === 'POST') {
      if (!authorized) { row.status = 401; return writeEmpty(response, 401, cors); }
      directWatch = {
        id: '60000000000040008000000000000006', enabled: true, alertOptIn: false,
        displayLabel: 'А40-1234/2026', version: 1,
        createdAtUtc: '2026-07-16T09:31:00Z', updatedAtUtc: '2026-07-16T09:31:00Z', disabledAtUtc: null,
      };
      row.status = 201;
      return writeJson(response, 201, directWatch, cors);
    }

    const watchMatch = url.pathname.match(/^\/api\/case-progress-watches\/([0-9a-f]{32})$/u);
    if (watchMatch && request.method === 'PUT') {
      if (!authorized) { row.status = 401; return writeEmpty(response, 401, cors); }
      if (!directWatch || directWatch.id !== watchMatch[1]) { row.status = 404; return writeEmpty(response, 404, cors); }
      const body = await readBody(request);
      const update = JSON.parse(body || '{}');
      if (conflictRemaining > 0) {
        conflictRemaining -= 1;
        directWatch = { ...directWatch, version: directWatch.version + 1,
          displayLabel: 'Обновлено в другой вкладке', updatedAtUtc: '2026-07-16T09:33:00Z' };
        row.status = 409;
        return writeEmpty(response, 409, cors);
      }
      if (update.version !== directWatch.version) {
        row.status = 409;
        return writeEmpty(response, 409, cors);
      }
      directWatch = { ...directWatch, enabled: Boolean(update.enabled), alertOptIn: Boolean(update.alertOptIn),
        displayLabel: update.displayLabel ?? null, version: directWatch.version + 1,
        updatedAtUtc: '2026-07-16T09:32:00Z', disabledAtUtc: update.enabled ? null : '2026-07-16T09:32:00Z' };
      row.status = 204;
      return writeEmpty(response, 204, cors);
    }

    if (scenarioId === '17' && request.method === 'GET' && url.pathname === '/api/case-batches') {
      row.status = 200;
      return writeJson(response, 200, { items: [{
        id: 'batch-safe', status: 'completed', totalItems: 1, completedItems: 1,
        failedItems: 0, canCancel: false, canResume: false, canRetryFailed: false,
      }], offset: 0, limit: 100, hasMore: false }, cors);
    }
    if (scenarioId === '17' && request.method === 'GET' && url.pathname === '/api/case-batches/batch-safe') {
      row.status = 200;
      return writeJson(response, 200, {
        id: 'batch-safe', status: 'completed', totalItems: 1, completedItems: 1,
        failedItems: 0, canCancel: false, canResume: false, canRetryFailed: false,
      }, cors);
    }
    if (scenarioId === '17' && request.method === 'GET' && url.pathname === '/api/case-batches/batch-safe/items') {
      row.status = 200;
      return writeJson(response, 200, { items: [{
        id: 'item-safe', rowNumber: 1, maskedDisplay: 'Дело ••••/2026', status: 'completed',
        evidenceKind: 'case-dossier', caveatCode: 'local-evidence-only',
        safeRouteReference: `/account/cases/${caseDossierIds.ownerCase.replaceAll('-', '')}`,
      }], offset: 0, limit: 100, hasMore: false }, cors);
    }

    if (request.method !== 'GET' || !url.pathname.startsWith('/api/case-dossiers/')) {
      row.status = 404;
      writeEmpty(response, 404, cors);
      return;
    }

    if (!authorized) {
      row.status = 401;
      writeEmpty(response, 401, cors);
      return;
    }

    if (url.searchParams.has('timeout')) {
      row.status = 408;
      writeProblem(response, caseDossierProblems.timeout, cors);
      return;
    }
    if (url.searchParams.has('limited')) {
      row.status = 429;
      writeProblem(response, caseDossierProblems.limited, cors);
      return;
    }
    if (url.searchParams.has('unavailable')) {
      row.status = 500;
      writeProblem(response, caseDossierProblems.unavailable, cors);
      return;
    }

    const requestedCaseId = url.pathname.split('/').at(-1)?.replaceAll('-', '').toLowerCase() ?? '';
    if (requestedCaseId === caseDossierIds.foreignCase.replaceAll('-', '')) {
      row.status = 404;
      writeEmpty(response, 404, cors);
      return;
    }
    if (requestedCaseId !== caseDossierIds.ownerCase.replaceAll('-', '')) {
      row.status = 404;
      writeEmpty(response, 404, cors);
      return;
    }

    if (scenarioId === '06' && scenarioVariant === 'http-500') {
      row.status = 500;
      writeProblem(response, caseDossierProblems.unavailable, cors);
      return;
    }

    row.status = 200;
    const scenarioSnapshot = caseDossierScenario(scenarioId, scenarioVariant) ?? caseDossierSnapshot;
    const snapshot = directWatch ? {
      ...scenarioSnapshot,
      watch: { directWatch, indirectWatchCount: caseDossierSnapshot.watch.indirectWatchCount },
      allowedActions: ['export-json', 'print', 'update-direct-watch',
        directWatch.enabled ? 'disable-direct-watch' : 'enable-direct-watch', 'set-alert-opt-in'],
    } : scenarioSnapshot;
    const bytes = directWatch ? Buffer.from(JSON.stringify(snapshot), 'utf8') :
      (caseDossierScenarioBytes(scenarioId, scenarioVariant) ?? caseDossierBytes);
    response.writeHead(200, {
      ...privateHeaders,
      ...cors,
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(bytes.length),
    });
    response.end(bytes);
  });
  server.caseDossierHost = host;
  return server;
}

export async function listenCaseDossierMock(server, port = 0) {
  const host = server.caseDossierHost ?? '127.0.0.1';
  assertLoopbackAddress(host);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('case-dossier-smoke-address-unavailable');
  return `http://${host}:${address.port}`;
}
