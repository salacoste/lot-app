import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const files = {
  page: 'app/account/case-batches/page.tsx',
  client: 'app/account/case-batches/CaseBatchWorkbenchClient.tsx',
  styles: 'app/account/case-batches/case-batches.module.css',
  api: 'lib/api/caseBatches.ts',
  generated: 'lib/generated/lots-webapi.ts',
};

async function source(name) {
  try { return await readFile(resolve(root, files[name]), 'utf8'); }
  catch { return ''; }
}

function requireSource(value, path) {
  assert.notEqual(value, '', `${path} must exist for Story 14-5`);
}

test('generated API types expose the complete private case-batch surface', async () => {
  const generated = await source('generated');
  requireSource(generated, files.generated);
  for (const path of [
    '/api/case-batches',
    '/api/case-batches/preview',
    '/api/case-batches/confirm',
    '/api/case-batches/{jobId}',
    '/api/case-batches/{jobId}/items',
    '/api/case-batches/{jobId}/cancel',
    '/api/case-batches/{jobId}/resume',
    '/api/case-batches/{jobId}/retry-failed',
    '/api/case-batches/{jobId}/export',
  ]) assert.ok(new RegExp(`"${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`, 'u').test(generated), path);

  for (const type of ['CaseBatchPreview', 'CaseBatchJob', 'CaseBatchItem']) {
    assert.match(generated, new RegExp(type, 'u'), `${type} generated contract`);
  }
  for (const capability of ['canCancel', 'canResume', 'canRetryFailed']) {
    assert.match(generated, new RegExp(`\\b${capability}\\b`, 'u'), `${capability} server capability`);
  }
  for (const field of ['confidenceCode', 'caveatCode', 'safeRouteReference']) {
    assert.match(generated, new RegExp(`\\b${field}\\b`, 'u'), `${field} canonical item field`);
  }
  for (const forbidden of [
    'parserRunId', 'taskId', 'attemptId', 'leaseOwnerId', 'fencingToken',
    'idempotencyHash', 'targetDigest', 'userId', 'rawInput', 'fileName',
  ]) {
    const schemaStart = generated.indexOf('CaseBatchExportDto:');
    const schemaEnd = generated.indexOf('CaseProgress', schemaStart);
    assert.ok(schemaStart >= 0 && schemaEnd > schemaStart, 'contiguous generated CaseBatch schema block');
    const caseBatchSchemas = generated.slice(schemaStart, schemaEnd);
    assert.doesNotMatch(caseBatchSchemas, new RegExp(`\\b${forbidden}\\b`, 'u'), forbidden);
  }
});

test('account route implements upload preview confirm poll control and both exports', async () => {
  const page = await source('page');
  const client = await source('client');
  const api = await source('api');
  requireSource(page, files.page);
  requireSource(client, files.client);
  requireSource(api, files.api);

  assert.match(page, /robots\s*:\s*\{[^}]*index\s*:\s*false[^}]*follow\s*:\s*false/su);
  assert.match(client, /type=["']file["']/u);
  assert.match(client, /\.csv.*\.xlsx|accept=["'][^"']*(?:csv|spreadsheetml)[^"']*["']/isu);
  assert.match(client, /preview/iu);
  assert.match(client, /confirm/iu);
  assert.match(client, /poll|setTimeout|setInterval/iu);
  for (const action of ['cancel', 'resume', 'retryFailed']) assert.match(api, new RegExp(`\\b${action}\\b`, 'u'));
  assert.match(api, /response\.json\(\)\s+as\s+Promise<CaseBatchJob>/u, 'control returns canonical job JSON');
  assert.match(client, /hasMore/u, 'result loading follows bounded pagination');
  assert.match(client, /offset/u, 'result loading advances the server cursor');
  assert.match(client + api, /export[^\n]*(?:csv|json)|(?:csv|json)[^\n]*export/iu);
  assert.match(client, /URL\.createObjectURL/u);
  assert.match(client, /URL\.revokeObjectURL/u);
});

test('refresh recovery and request generations reject stale preview poll and control responses', async () => {
  const client = await source('client');
  requireSource(client, files.client);
  assert.match(client, /AbortController/u);
  assert.match(client, /\.abort\(\)/u);
  assert.match(client, /signal/u);
  assert.match(client, /generation|requestVersion|requestId|currentRequest/iu);
  assert.match(client, /visibilitychange|pageshow|loadJobs|restore|recover/iu);
  assert.match(client, /clearTimeout|clearInterval/u);
  assert.match(client, /return\s*\(\)\s*=>|return\s*=>/u);
});

test('workbench exposes keyboard focus error summary and polite progress semantics', async () => {
  const client = await source('client');
  requireSource(client, files.client);
  assert.match(client, /aria-live=["']polite["']/u);
  assert.match(client, /role=["'](?:status|progressbar)["']/u);
  assert.match(client, /role=["']alert["']/u);
  assert.match(client, /\.focus\(\)/u);
  assert.match(client, /htmlFor=/u);
  assert.match(client, /aria-busy=/u);
  assert.match(client, /<table|role=["']table["']/u);
  assert.match(client, /<caption|aria-label=/u);
});

test('responsive source covers narrow tablet desktop and reduced motion', async () => {
  const styles = await source('styles');
  requireSource(styles, files.styles);
  assert.match(styles, /@media[^\{]*(?:max-width\s*:\s*(?:480|560|640)px|width\s*<=\s*(?:480|560|640)px)/u);
  assert.match(styles, /@media[^\{]*(?:max-width\s*:\s*(?:768|800|900)px|width\s*<=\s*(?:768|800|900)px)/u);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/u);
  assert.match(styles, /overflow-wrap|word-break/u);
  assert.match(styles, /min-width\s*:\s*0/u);
});

test('private targets token and hashes never enter URL storage console or analytics', async () => {
  const client = await source('client');
  const api = await source('api');
  requireSource(client, files.client);
  requireSource(api, files.api);
  const combined = `${client}\n${api}`;
  assert.doesNotMatch(combined, /localStorage|sessionStorage|indexedDB|caches\.open/u);
  assert.doesNotMatch(combined, /console\.(?:log|debug|info|warn|error)/u);
  assert.doesNotMatch(combined, /(?:ym|gtag|dataLayer|analytics)\s*\(/u);
  assert.doesNotMatch(combined, /URLSearchParams[^\n]*(?:inn|case|token|hash)|searchParams[^\n]*(?:inn|case|token|hash)/iu);
  assert.doesNotMatch(combined, /router\.(?:push|replace)[^\n]*(?:previewToken|idempotencyKey|targetDigest)/iu);
  assert.match(api, /credentials\s*:\s*["']include["']/u);
  assert.match(api, /Idempotency-Key/u);
  assert.match(api, /FormData/u);
});
