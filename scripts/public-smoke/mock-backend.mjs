import http from 'node:http';
import { URL } from 'node:url';
import { lots, mapLots, primaryLot, passengerCarLot, sitemapLots, vehicleFilterOptions } from './fixture-data.mjs';

const port = Number(process.env.PUBLIC_SMOKE_BACKEND_PORT || 4021);
const host = process.env.PUBLIC_SMOKE_BACKEND_HOST || '127.0.0.1';
const appHost = process.env.PUBLIC_SMOKE_APP_HOST || '127.0.0.1';
const appPort = Number(process.env.PUBLIC_SMOKE_APP_PORT || 3101);
const allowedHosts = new Set(['127.0.0.1', 'localhost']);

for (const [label, value] of [['PUBLIC_SMOKE_BACKEND_HOST', host], ['PUBLIC_SMOKE_APP_HOST', appHost]]) {
  if (!allowedHosts.has(value)) {
    throw new Error(`${label} must be loopback/local IPv4 or localhost for public smoke: ${value}`);
  }
}

const appOrigin = `http://${appHost}:${appPort}`;

const requests = [];

function json(res, statusCode, body, requestRecord) {
  if (requestRecord) requestRecord.statusCode = statusCode;
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': appOrigin,
    'access-control-allow-credentials': 'true',
  });
  res.end(payload);
}

function text(res, statusCode, contentType, body, requestRecord) {
  if (requestRecord) requestRecord.statusCode = statusCode;
  res.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': appOrigin,
  });
  res.end(body);
}

function lotListFor(url) {
  const categories = url.searchParams.getAll('categories');
  const brand = url.searchParams.get('attr_brand');
  const model = url.searchParams.get('attr_model');
  let items = lots;

  if (categories.includes('Легковой автомобиль')) {
    items = items.filter((lot) => lot.categories.some((category) => category.name === 'Легковой автомобиль'));
  }
  if (brand) {
    items = items.filter((lot) => lot.attributes?.brand?.toLowerCase() === brand.toLowerCase());
  }
  if (model) {
    items = items.filter((lot) => lot.attributes?.model?.toLowerCase() === model.toLowerCase());
  }

  return {
    items,
    totalCount: items.length,
    totalPages: 1,
    page: Number(url.searchParams.get('page') || 1),
  };
}

export function createMockBackend() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`);
    const requestRecord = { method: req.method, path: url.pathname, search: url.search, statusCode: null, at: new Date().toISOString() };
    requests.push(requestRecord);

    if (req.method === 'OPTIONS') {
      requestRecord.statusCode = 204;
      res.writeHead(204, {
        'access-control-allow-origin': appOrigin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET,OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      json(res, 405, { error: 'public smoke mock is read-only' }, requestRecord);
      return;
    }

    if (url.pathname === '/__smoke/health') {
      json(res, 200, { ok: true, requests: requests.length }, requestRecord);
      return;
    }
    if (url.pathname === '/__smoke/requests') {
      json(res, 200, requests, requestRecord);
      return;
    }
    if (url.pathname === '/api/auth/me') {
      json(res, 401, { error: 'anonymous smoke user' }, requestRecord);
      return;
    }
    if (url.pathname === '/api/health/version') {
      json(res, 200, { version: 'public-smoke', commit: 'fixture', environment: 'local' }, requestRecord);
      return;
    }
    if (url.pathname === '/api/lots/list') {
      json(res, 200, lotListFor(url), requestRecord);
      return;
    }
    if (url.pathname === '/api/lots/vehicle-filter-options') {
      json(res, 200, vehicleFilterOptions, requestRecord);
      return;
    }
    if (url.pathname === '/api/lots/with-coordinates') {
      json(res, 200, mapLots, requestRecord);
      return;
    }
    if (url.pathname === '/api/lots/sitemap-data') {
      json(res, 200, sitemapLots, requestRecord);
      return;
    }
    const lotMatch = url.pathname.match(/^\/api\/lots\/(.+)$/);
    if (lotMatch) {
      const id = decodeURIComponent(lotMatch[1]);
      const lot = lots.find((item) => String(item.publicId) === id || item.id === id || item.slug === id)
        ?? (id === String(primaryLot.publicId) ? primaryLot : null)
        ?? (id === String(passengerCarLot.publicId) ? passengerCarLot : null);
      if (!lot) {
        json(res, 404, { error: 'not found' }, requestRecord);
        return;
      }
      json(res, 200, lot, requestRecord);
      return;
    }
    if (url.pathname.endsWith('.svg')) {
      text(res, 200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#eef2ff"/><text x="24" y="96" font-size="24" fill="#1f2937">Smoke fixture</text></svg>', requestRecord);
      return;
    }
    if (url.pathname.endsWith('.pdf')) {
      text(res, 200, 'application/pdf', '%PDF-1.4\n% smoke fixture\n', requestRecord);
      return;
    }

    json(res, 404, { error: 'unknown smoke endpoint', path: url.pathname }, requestRecord);
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createMockBackend();
  server.listen(port, host, () => {
    console.log(`public smoke mock backend listening at http://${host}:${port}`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
