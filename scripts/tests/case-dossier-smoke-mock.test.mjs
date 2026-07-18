import assert from 'node:assert/strict';
import test from 'node:test';
import { caseDossierBytes, caseDossierIds, caseDossierProblems } from '../case-dossier-smoke/fixture-data.mjs';
import { createCaseDossierMockBackend, listenCaseDossierMock } from '../case-dossier-smoke/mock-backend.mjs';

const ownerHeaders = { cookie: 'case-dossier-owner=1' };

async function withBackend(run) {
  const server = createCaseDossierMockBackend();
  const baseUrl = await listenCaseDossierMock(server);
  try { await run(baseUrl); }
  finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

function assertPrivateHeaders(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('vary'), 'Authorization, Cookie');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.equal(response.headers.get('etag'), null);
}

test('case dossier mock is loopback-only', () => {
  assert.throws(
    () => createCaseDossierMockBackend({ host: '0.0.0.0' }),
    /case-dossier-smoke-loopback-only/u,
  );
});

test('anonymous and foreign dossier responses are empty and indistinguishable except status', async () => {
  await withBackend(async (baseUrl) => {
    const anonymous = await fetch(`${baseUrl}/api/case-dossiers/${caseDossierIds.ownerCase}`);
    assert.equal(anonymous.status, 401);
    assert.equal(await anonymous.text(), '');
    assert.equal(anonymous.headers.get('content-type'), null);
    assertPrivateHeaders(anonymous);

    const foreign = await fetch(`${baseUrl}/api/case-dossiers/${caseDossierIds.foreignCase}`, { headers: ownerHeaders });
    assert.equal(foreign.status, 404);
    assert.equal(await foreign.text(), '');
    assert.equal(foreign.headers.get('content-type'), null);
    assertPrivateHeaders(foreign);
  });
});

test('authorized dossier returns exact deterministic private bytes', async () => {
  await withBackend(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/case-dossiers/${caseDossierIds.ownerCase}`, { headers: ownerHeaders });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assertPrivateHeaders(response);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), caseDossierBytes);
  });
});

test('closed problems are deterministic and privacy headers survive every status', async () => {
  await withBackend(async (baseUrl) => {
    for (const [query, expected] of Object.entries(caseDossierProblems)) {
      const response = await fetch(
        `${baseUrl}/api/case-dossiers/${caseDossierIds.ownerCase}?${query}=1`,
        { headers: ownerHeaders },
      );
      assert.equal(response.status, expected.status, query);
      assert.equal(response.headers.get('content-type'), 'application/problem+json; charset=utf-8');
      assertPrivateHeaders(response);
      assert.deepEqual(await response.json(), expected);
    }
  });
});

test('request evidence stores method sanitized route and status only', async () => {
  await withBackend(async (baseUrl) => {
    await fetch(`${baseUrl}/api/case-dossiers/${caseDossierIds.ownerCase}`, { headers: ownerHeaders });
    const requests = await (await fetch(`${baseUrl}/__case-dossier-smoke/requests`)).json();
    const serialized = JSON.stringify(requests);
    assert.match(serialized, /\/api\/case-dossiers\/\[case\]/u);
    assert.doesNotMatch(serialized, new RegExp(caseDossierIds.ownerCase, 'iu'));
    assert.doesNotMatch(serialized, new RegExp(caseDossierIds.account, 'iu'));
    assert.doesNotMatch(serialized, /cookie|authorization|query/iu);
  });
});
