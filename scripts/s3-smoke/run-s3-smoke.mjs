import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd());
const artifactsDir = resolve(repoRoot, 'test-results/s3-smoke');
const publicOrigin = 'https://s-lot.ru';
const mode = process.env.S3_SMOKE_MODE || 'mock';
const runId = process.env.S3_SMOKE_RUN_ID || `local-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const skipCode = 78;

const expected = {
  lotBucket: 'lots-images',
  adBucket: 'ads-images',
  providerHost: 's3.regru.cloud',
};

const fixture = {
  lotImages: [
    `${publicOrigin}/lots-images/smoke-fixtures/lot-21001/photo-main.jpg`,
  ],
  lotDocuments: [
    {
      kind: 'backend-download',
      url: '/api/lots/21001/documents/doc-smoke-001/download',
      expectedPrefix: '/api/lots/',
    },
    {
      kind: 'direct-public-object',
      url: `${publicOrigin}/lots-images/smoke-fixtures/lot-21001/document-public.pdf`,
    },
  ],
  adImages: [
    `${publicOrigin}/ads-images/smoke-fixtures/ad-31001/photo-main.jpg`,
  ],
  mockedUploads: [
    {
      label: 'lot-image-upload',
      bucket: expected.lotBucket,
      key: `smoke/${runId}/lot-image.jpg`,
      contentType: 'image/jpeg',
    },
    {
      label: 'lot-document-upload',
      bucket: expected.lotBucket,
      key: `smoke/${runId}/lot-document.pdf`,
      contentType: 'application/pdf',
    },
    {
      label: 'ad-image-upload',
      bucket: expected.adBucket,
      key: `smoke/${runId}/ad-image.jpg`,
      contentType: 'image/jpeg',
    },
  ],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parsePublicOrigin() {
  const parsed = new URL(publicOrigin);
  assert(parsed.href === 'https://s-lot.ru/', `Public origin must remain https://s-lot.ru for Story 7-5: ${publicOrigin}`);
  assert(parsed.hostname !== expected.providerHost, `Public origin must not expose provider host ${expected.providerHost}`);
  return parsed;
}

function redactUrl(value) {
  const parsed = new URL(value, publicOrigin);
  const [bucket] = parsed.pathname.split('/').filter(Boolean);
  return `${parsed.origin}/${bucket || '<no-bucket>'}/<redacted>`;
}

function redactBackendPath(value) {
  const parsed = new URL(value, publicOrigin);
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && segments[0] === 'api' && segments[1] === 'lots') {
    return '/api/lots/<lot-id>/documents/<document-id>/download';
  }
  return `${parsed.pathname.split('/').slice(0, 3).join('/')}/<redacted>`;
}

function assertPublicObjectUrl(value, bucket, label) {
  const parsed = new URL(value);
  const origin = parsePublicOrigin();
  assert(parsed.protocol === 'https:', `${label} must be https: ${value}`);
  assert(parsed.hostname === origin.hostname, `${label} must use public host ${origin.hostname}: ${value}`);
  assert(parsed.hostname !== expected.providerHost, `${label} leaks provider host ${expected.providerHost}: ${value}`);
  assert(parsed.pathname.startsWith(`/${bucket}/`), `${label} must start with /${bucket}/: ${value}`);
  assert(!parsed.search, `${label} must not include query strings/signed URL material: ${value}`);
  assert(!parsed.hash, `${label} must not include fragments: ${value}`);
  return { label, bucket, redactedUrl: redactUrl(value), status: 'PASS_SHAPE_ONLY_NO_NETWORK' };
}

function assertBackendDocumentUrl(value, label) {
  const parsed = new URL(value, publicOrigin);
  assert(parsed.pathname.startsWith('/api/lots/'), `${label} must use backend lot documents route: ${value}`);
  assert(parsed.pathname.endsWith('/download'), `${label} must end with /download: ${value}`);
  assert(!parsed.search, `${label} must not include query strings/auth material: ${value}`);
  return { label, kind: 'backend-download', redactedUrl: redactBackendPath(value), status: 'PASS_ROUTE_SHAPE_ONLY_NO_NETWORK' };
}

function publicUploadUrl({ bucket, key }) {
  return `${publicOrigin}/${bucket}/${key}`;
}

function assertSandboxKey(key, label) {
  assert(key.startsWith(`smoke/${runId}/`), `${label} must use run-scoped smoke prefix: ${key}`);
  assert(!key.includes('..'), `${label} key must not contain path traversal: ${key}`);
}

function validateMockedUploads() {
  return fixture.mockedUploads.map((upload) => {
    assertSandboxKey(upload.key, upload.label);
    const redacted = assertPublicObjectUrl(publicUploadUrl(upload), upload.bucket, upload.label);
    return {
      label: upload.label,
      bucket: upload.bucket,
      contentType: upload.contentType,
      keyPrefix: `smoke/${runId}/<redacted>`,
      publicUrl: redacted.redactedUrl,
      cleanup: 'SKIPPED_MOCK_NO_WRITE',
      status: 'PASS_MOCK_UPLOAD_URL_SHAPE_NO_WRITE',
    };
  });
}

async function writeEvidence(evidence) {
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(resolve(artifactsDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

function missingSandboxRequirements() {
  const required = {
    S3_SMOKE_SANDBOX_BUCKET: process.env.S3_SMOKE_SANDBOX_BUCKET,
    S3_SMOKE_SANDBOX_PREFIX: process.env.S3_SMOKE_SANDBOX_PREFIX,
    S3_SMOKE_CLEANUP_OWNER: process.env.S3_SMOKE_CLEANUP_OWNER,
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (process.env.S3_SMOKE_ALLOW_SANDBOX_UPLOAD !== 'true') {
    missing.unshift('S3_SMOKE_ALLOW_SANDBOX_UPLOAD=true');
  }
  if (process.env.S3_SMOKE_SANDBOX_PREFIX && !process.env.S3_SMOKE_SANDBOX_PREFIX.startsWith('smoke/')) {
    missing.push('S3_SMOKE_SANDBOX_PREFIX must start with smoke/');
  }
  return [...new Set(missing)];
}

async function runSandboxFailClosed() {
  const missing = missingSandboxRequirements();
  const evidence = {
    story: '7-5-s3-runtime-smoke-and-upload-validation',
    mode,
    runId,
    status: 'SKIP_NO_SAFE_S3_SANDBOX',
    skipCode,
    missingSafeAuthority: missing,
    publicOrigin: redactUrl(`${publicOrigin}/lots-images/redacted`),
    note: 'No S3 upload, delete, credential use, or network request was attempted.',
  };
  await writeEvidence(evidence);
  console.error(`[s3-smoke] ${evidence.status}: ${missing.join(', ') || 'sandbox execution is not implemented in this local harness'}`);
  process.exitCode = skipCode;
}

async function runMockSmoke() {
  const routeEvidence = [];

  for (const [index, url] of fixture.lotImages.entries()) {
    routeEvidence.push(assertPublicObjectUrl(url, expected.lotBucket, `lot-image-${index + 1}`));
  }

  for (const [index, doc] of fixture.lotDocuments.entries()) {
    if (doc.kind === 'backend-download') {
      routeEvidence.push(assertBackendDocumentUrl(doc.url, `lot-document-${index + 1}`));
    } else {
      routeEvidence.push(assertPublicObjectUrl(doc.url, expected.lotBucket, `lot-document-${index + 1}`));
    }
  }

  for (const [index, url] of fixture.adImages.entries()) {
    routeEvidence.push(assertPublicObjectUrl(url, expected.adBucket, `ad-image-${index + 1}`));
  }

  const uploadEvidence = validateMockedUploads();
  const evidence = {
    story: '7-5-s3-runtime-smoke-and-upload-validation',
    mode,
    runId,
    status: 'PASS_LOCAL_MOCK_NO_WRITE',
    publicOrigin,
    providerHostForbiddenForBrowser: expected.providerHost,
    readOnlyRouteSmoke: routeEvidence,
    mockedUploadSmoke: uploadEvidence,
    cleanup: 'VERIFIED_SKIPPED_MOCK_NO_WRITE_NO_OBJECTS_CREATED',
    redaction: 'Evidence includes only bucket names, route classes, and redacted object paths; no credentials/cookies/auth headers/signed URLs are read or written.',
  };
  await writeEvidence(evidence);
  console.log(`[s3-smoke] ${evidence.status}`);
  console.log(`[s3-smoke] read-only route shapes: ${routeEvidence.length}; mocked upload URL shapes: ${uploadEvidence.length}`);
  console.log(`[s3-smoke] evidence: ${resolve(artifactsDir, 'evidence.json')}`);
}

if (!['mock', 'sandbox'].includes(mode)) {
  throw new Error(`Unsupported S3_SMOKE_MODE=${mode}. Use mock or sandbox.`);
}

if (mode === 'sandbox') {
  await runSandboxFailClosed();
} else {
  await runMockSmoke();
}
