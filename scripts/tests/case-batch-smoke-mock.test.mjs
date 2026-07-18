import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaseBatchMockBackend } from '../case-batch-smoke/mock-backend.mjs';
import {
  CASE_BATCH_LATER_PAGE_MASKED, CASE_BATCH_PRIVATE, CASE_BATCH_SMOKE_USER,
  caseBatchCsv, caseBatchItems, jobId,
} from '../case-batch-smoke/fixture-data.mjs';

async function withBackend(run) {
  const server = createCaseBatchMockBackend();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function authenticated(baseUrl) {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: CASE_BATCH_SMOKE_USER.email, password: CASE_BATCH_SMOKE_USER.password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return { cookie };
}

test('case-batch smoke mock enforces auth and complete preview-confirm-control-export lifecycle', async () => {
  await withBackend(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/case-batches`)).status, 401);
    const headers = await authenticated(baseUrl);
    const key = 'case-batch-smoke-client-key-00000001';
    const previewForm = new FormData();
    previewForm.append('file', new Blob([caseBatchCsv], { type: 'text/csv' }), 'fixture.csv');
    const preview = await fetch(`${baseUrl}/api/case-batches/preview`, {
      method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: previewForm,
    });
    assert.equal(preview.status, 200);
    const previewBody = await preview.json();
    assert.equal(previewBody.validRows, 2);
    assert.equal(JSON.stringify(previewBody).includes(CASE_BATCH_PRIVATE.inn), false);

    const confirmForm = new FormData();
    confirmForm.append('file', new Blob([caseBatchCsv], { type: 'text/csv' }), 'fixture.csv');
    confirmForm.append('previewToken', previewBody.previewToken);
    confirmForm.append('confirm', 'true');
    const confirm = await fetch(`${baseUrl}/api/case-batches/confirm`, {
      method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: confirmForm,
    });
    assert.equal(confirm.status, 201);
    assert.equal((await confirm.json()).status, 'processing');

    assert.equal((await fetch(`${baseUrl}/api/case-batches/${jobId}`, { headers })).status, 200);
    const itemPages = [];
    for (const offset of [0, 50, 100]) {
      const response = await fetch(`${baseUrl}/api/case-batches/${jobId}/items?offset=${offset}&limit=50`, { headers });
      assert.equal(response.status, 200);
      itemPages.push(await response.json());
    }
    assert.deepEqual(itemPages.map((page) => page.items.length), [50, 50, 12]);
    assert.deepEqual(itemPages.map((page) => page.hasMore), [true, true, false]);
    assert.deepEqual(itemPages.map((page) => page.offset), [0, 50, 100]);
    assert.equal(itemPages.flatMap((page) => page.items).length, caseBatchItems.length);
    assert.equal(itemPages[2].items.at(-1)?.maskedDisplay, CASE_BATCH_LATER_PAGE_MASKED);
    for (const action of ['cancel', 'resume', 'retry-failed']) {
      const response = await fetch(`${baseUrl}/api/case-batches/${jobId}/${action}`, { method: 'POST', headers });
      assert.equal(response.status, 200);
      const job = await response.json();
      assert.equal(job.id, jobId);
      for (const capability of ['canCancel', 'canResume', 'canRetryFailed']) {
        assert.equal(typeof job[capability], 'boolean', capability);
      }
    }
    const csv = await fetch(`${baseUrl}/api/case-batches/${jobId}/export?format=csv`, { headers });
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type') ?? '', /^text\/csv/u);
    const json = await fetch(`${baseUrl}/api/case-batches/${jobId}/export?format=json`, { headers });
    assert.equal(json.status, 200); assert.match(json.headers.get('content-type') ?? '', /^application\/json/u);

    const requests = await (await fetch(`${baseUrl}/__case-batch-smoke/requests`)).json();
    const serialized = JSON.stringify(requests);
    assert.doesNotMatch(serialized, new RegExp(jobId, 'u'));
    for (const privateValue of Object.values(CASE_BATCH_PRIVATE)) assert.doesNotMatch(serialized, new RegExp(privateValue, 'u'));
    assert.match(serialized, /\/api\/case-batches\/\[job\]\/export/u);
  });
});

test('case-batch mock mismatched confirmation is fixed 409 and creates no job', async () => {
  await withBackend(async (baseUrl) => {
    const headers = await authenticated(baseUrl);
    const previewForm = new FormData();
    previewForm.append('file', new Blob([caseBatchCsv]), 'fixture.csv');
    const preview = await fetch(`${baseUrl}/api/case-batches/preview`, {
      method: 'POST', headers: { ...headers, 'Idempotency-Key': 'preview-key-00000000000000000001' }, body: previewForm,
    });
    const token = (await preview.json()).previewToken;
    const confirmForm = new FormData();
    confirmForm.append('file', new Blob([caseBatchCsv]), 'fixture.csv');
    confirmForm.append('previewToken', token); confirmForm.append('confirm', 'true');
    const mismatch = await fetch(`${baseUrl}/api/case-batches/confirm`, {
      method: 'POST', headers: { ...headers, 'Idempotency-Key': 'different-key-000000000000000001' }, body: confirmForm,
    });
    assert.equal(mismatch.status, 409);
    assert.deepEqual(await mismatch.json(), { code: 'preview-mismatch' });
    assert.deepEqual((await (await fetch(`${baseUrl}/api/case-batches`, { headers })).json()).items, []);
  });
});
