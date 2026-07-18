import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const paths = Object.freeze({
  page: 'app/account/cases/[caseId]/page.tsx',
  client: 'app/account/cases/[caseId]/CaseDossierClient.tsx',
  styles: 'app/account/cases/[caseId]/case-dossier.module.css',
  api: 'lib/api/caseDossier.ts',
  logic: 'lib/api/caseDossier.logic.mjs',
  generated: 'lib/generated/lots-webapi.ts',
  referencePolicy: 'lib/generated/case-dossier-reference-policy.mjs',
  robots: 'app/robots.ts',
  batch: 'app/account/case-batches/CaseBatchWorkbenchClient.tsx',
});

async function source(name) {
  try { return await readFile(resolve(root, paths[name]), 'utf8'); }
  catch { return ''; }
}

function requireSource(value, name) {
  assert.notEqual(value, '', `${paths[name]} must exist for Story 14-6`);
}

test('physical private route and generated API contract exist at the approved paths', async () => {
  const [page, client, api, generated, referencePolicy] = await Promise.all([
    source('page'), source('client'), source('api'), source('generated'), source('referencePolicy'),
  ]);
  requireSource(page, 'page');
  requireSource(client, 'client');
  requireSource(api, 'api');
  requireSource(generated, 'generated');
  requireSource(referencePolicy, 'referencePolicy');
  assert.match(page, /robots\s*:\s*\{[^}]*index\s*:\s*false[^}]*follow\s*:\s*false/su);
  assert.match(generated, /"\/api\/case-dossiers\/\{caseId\}"\s*:/u);
  for (const field of ['contractVersion', 'accountReference', 'sourceUpdatedAtUtc', 'allowedActions']) {
    assert.match(generated, new RegExp(`\\b${field}\\b`, 'u'), field);
  }
  const timeline = generated.match(/TimelineSection:\s*\{([^]*?)\n\s*\};/u)?.[1] ?? '';
  assert.notEqual(timeline, '', 'TimelineSection schema must exist');
  assert.doesNotMatch(timeline, /sourceFetchedAtUtc/iu);
  assert.match(referencePolicy, /Generated from scraper\/Lots\.WebApi\/openapi\/Lots\.WebApi\.json/u);
  assert.match(referencePolicy, /maximumLength:\s*512/u);
  assert.ok(referencePolicy.includes('segmentPattern: "^[A-Za-z0-9._~-]+$"'));
  const logic = await source('logic');
  assert.match(logic, /from ['"]\.\.\/generated\/case-dossier-reference-policy\.mjs['"]/u);
  assert.doesNotMatch(logic, /case-dossier-reference-policy-v1/u);
});

test('client retains exact raw bytes and implements no-network JSON download and print', async () => {
  const [client, api] = await Promise.all([source('client'), source('api')]);
  requireSource(client, 'client');
  requireSource(api, 'api');
  assert.match(api, /arrayBuffer\(\)|Uint8Array/u);
  assert.match(api, /credentials\s*:\s*['"]include['"]/u);
  assert.match(client, /application\/json; charset=utf-8/u);
  assert.match(client, /Blob/u);
  assert.match(client, /URL\.createObjectURL/u);
  assert.match(client, /URL\.revokeObjectURL/u);
  assert.match(client, /window\.print\(\)/u);
  assert.doesNotMatch(client, /refresh/iu);
});

test('latest-request auth watch-conflict and accessibility controls are explicit', async () => {
  const client = await source('client');
  requireSource(client, 'client');
  assert.match(client, /AbortController/u);
  assert.match(client, /\.abort\(\)/u);
  assert.match(client, /409/u);
  assert.match(client, /aria-live=['"]polite['"]/u);
  assert.match(client, /role=['"]alert['"]/u);
  assert.match(client, /\.focus\(\)/u);
  assert.match(client, /allowedActions/u);
});

test('private dossier source prohibits storage analytics console and raw HTML', async () => {
  const combined = (await Promise.all(['client', 'api', 'logic'].map(source))).join('\n');
  for (const name of ['client', 'api', 'logic']) requireSource(await source(name), name);
  assert.doesNotMatch(combined, /localStorage|sessionStorage|indexedDB|caches\.open|serviceWorker/u);
  assert.doesNotMatch(combined, /console\.(?:log|debug|info|warn|error)/u);
  assert.doesNotMatch(combined, /(?:ym|gtag|dataLayer|analytics)\s*\(/u);
  assert.doesNotMatch(combined, /dangerouslySetInnerHTML/u);
  assert.doesNotMatch(combined, /URLSearchParams[^\n]*(?:caseId|inn|ogrn|accountReference)/iu);
});

test('approved opaque entry point and robots exclusions are wired', async () => {
  const [batch, robots] = await Promise.all([source('batch'), source('robots')]);
  requireSource(batch, 'batch');
  requireSource(robots, 'robots');
  assert.match(batch, /safeRouteReference/u);
  assert.match(batch, /\/account\/cases\//u);
  assert.match(robots, /\/account\/cases/u);
});

test('responsive print and reduced-motion styles are present', async () => {
  const styles = await source('styles');
  requireSource(styles, 'styles');
  assert.match(styles, /@media[^\{]*(?:max-width\s*:\s*(?:480|560|640)px|width\s*<=\s*(?:480|560|640)px)/u);
  assert.match(styles, /@media[^\{]*(?:max-width\s*:\s*(?:768|800|900)px|width\s*<=\s*(?:768|800|900)px)/u);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/u);
  assert.match(styles, /@media\s+print/u);
  assert.match(styles, /overflow-wrap|word-break/u);
});
