import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountMockBackend } from '../account-smoke/mock-backend.mjs';
import { createMockBackend } from '../public-smoke/mock-backend.mjs';

async function withServer(createServer, run) {
  const server = createServer();
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

test('public smoke mock allows only the exact lot view-event POST route', async () => {
  await withServer(createMockBackend, async (baseUrl) => {
    const accepted = await fetch(`${baseUrl}/api/lots/21001/view-events`, { method: 'POST' });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { accepted: true, noop: true });

    const options = await fetch(`${baseUrl}/api/lots/21001/view-events`, { method: 'OPTIONS' });
    assert.equal(options.status, 204);
    assert.match(options.headers.get('access-control-allow-methods') ?? '', /(?:^|,)POST(?:,|$)/);
    assert.match(options.headers.get('access-control-allow-headers') ?? '', /(?:^|,)x-lot-view-intent(?:,|$)/);
    assert.match(options.headers.get('access-control-allow-headers') ?? '', /(?:^|,)x-lot-client-id(?:,|$)/);

    assert.equal((await fetch(`${baseUrl}/api/lots/21001`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${baseUrl}/api/lots/21001/view-events/extra`, { method: 'POST' })).status, 405);
  });
});

test('account smoke mock handles the exact view-event POST before generic lot matching', async () => {
  await withServer(createAccountMockBackend, async (baseUrl) => {
    const accepted = await fetch(`${baseUrl}/api/lots/21001/view-events`, { method: 'POST' });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { accepted: true, noop: true });

    assert.equal((await fetch(`${baseUrl}/api/lots/21001/view-events/extra`, { method: 'POST' })).status, 404);
  });
});
