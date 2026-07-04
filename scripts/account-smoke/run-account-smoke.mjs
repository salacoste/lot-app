import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACCOUNT_SMOKE_ALLOWED_BLOCKED_EXTERNAL_HOSTS, ACCOUNT_SMOKE_PROTECTED_PATHS, SIGNALR_ROUTE_STORY_PATH } from './constants.mjs';
import { ACCOUNT_SMOKE_USER, accountAd, favoriteLot } from './fixture-data.mjs';

const repoRoot = resolve(process.cwd());
const backendUrl = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL;
const appHost = process.env.ACCOUNT_SMOKE_APP_HOST || '127.0.0.1';
const appPort = Number(process.env.ACCOUNT_SMOKE_APP_PORT || 3102);
const appBaseUrl = `http://${appHost}:${appPort}`;
const artifactsDir = resolve(repoRoot, 'test-results/account-smoke');
const loopbackHosts = new Set(['127.0.0.1', 'localhost']);
const allowedBlockedExternalHosts = new Set(ACCOUNT_SMOKE_ALLOWED_BLOCKED_EXTERNAL_HOSTS);
const expectedSkipped = [];
const expectedSkipKeys = new Set();

function recordExpectedSkip(skip) {
  const key = `${skip.kind}:${skip.endpoint || skip.url || skip.story || ''}`;
  if (expectedSkipKeys.has(key)) return;
  expectedSkipKeys.add(key);
  expectedSkipped.push(skip);
}

function assertLoopbackUrl(value, label) {
  if (!value) throw new Error(`${label} is required and must be loopback/local IPv4 or localhost for account smoke.`);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !loopbackHosts.has(url.hostname)) {
    throw new Error(`Refusing account smoke against non-loopback ${label}: ${value}`);
  }
}

function assertLoopbackAppHost() {
  if (!loopbackHosts.has(appHost)) throw new Error(`ACCOUNT_SMOKE_APP_HOST must be loopback/local IPv4 or localhost for account smoke: ${appHost}`);
}

function verifyFailClosedChecks() {
  for (const [value, label] of [[backendUrl, 'NEXT_PUBLIC_CSHARP_BACKEND_URL'], [appBaseUrl, 'ACCOUNT_SMOKE_APP_BASE_URL']]) {
    assertLoopbackUrl(value, label);
  }
  for (const [value, label] of [['https://example.com', 'NEGATIVE_BACKEND_URL'], ['http://10.0.0.1:3102', 'NEGATIVE_APP_URL']]) {
    let failedClosed = false;
    try { assertLoopbackUrl(value, label); }
    catch { failedClosed = true; }
    if (!failedClosed) throw new Error(`${label} negative loopback guard did not fail closed`);
  }
  console.log('[account-smoke] fail-closed loopback guards verified for app and backend URLs');
}

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    console.log(`[account-smoke] $ ${[command, ...args].join(' ')}`);
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, NEXT_PUBLIC_CSHARP_BACKEND_URL: backendUrl },
      stdio: 'inherit',
      shell: false,
      ...options,
    });
    child.on('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`${command} ${args.join(' ')} failed with ${signal ?? code}`)));
    child.on('error', reject);
  });
}

function spawnLogged(command, args, logFile) {
  const log = createWriteStream(logFile, { flags: 'w' });
  const child = spawn(command, args, { cwd: repoRoot, env: { ...process.env, NEXT_PUBLIC_CSHARP_BACKEND_URL: backendUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}

async function waitFor(url, label, { timeoutMs = 60_000, isReady = (res) => res.ok } = {}) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (await isReady(res)) return;
      lastError = `${res.status} ${res.statusText}`;
    } catch (error) { lastError = error.message; }
    await wait(500);
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const candidate of ['playwright', process.env.PLAYWRIGHT_MODULE_PATH].filter(Boolean)) {
    try { return require(candidate); } catch {}
  }
  throw new Error('Playwright module not found. Install project-local playwright or provide PLAYWRIGHT_MODULE_PATH.');
}

function chromiumLaunchOptions() {
  const executablePath = process.env.ACCOUNT_SMOKE_CHROMIUM_EXECUTABLE_PATH
    || process.env.PUBLIC_SMOKE_CHROMIUM_EXECUTABLE_PATH
    || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Chromium-Gost.app/Contents/MacOS/Chromium-Gost'].find((candidate) => existsSync(candidate));
  return executablePath ? { headless: true, executablePath } : { headless: true };
}

async function expectText(page, text, scenario) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 15_000 });
  console.log(`[account-smoke] ${scenario}: found text "${text}"`);
}

async function collectBackendRequests() {
  try { return await (await fetch(`${backendUrl}/__smoke/requests`)).json(); }
  catch (error) { return [{ method: 'SMOKE', path: '__evidence_collection_failed__', search: error.message, at: new Date().toISOString() }]; }
}

function expectedBackendStatus(request) {
  if (request.path === '/chathub/negotiate') return request.statusCode === 501;
  if (request.path.startsWith('/chathub')) return request.statusCode === 501;
  if (request.path === '/api/ads' && request.method === 'POST') return request.statusCode === 409;
  if (request.path === '/api/auth/me') return request.statusCode === 200 || request.statusCode === 401;
  if (request.path === '/api/favorites/ids') return request.statusCode === 200 || request.statusCode === 401;
  if (request.method === 'DELETE' && request.path.startsWith('/api/lotalerts/')) return request.statusCode === 204;
  const ok = new Set(['/__smoke/health','/__smoke/requests','/__smoke/state','/api/health/version','/api/lots/vehicle-filter-options','/api/lots/list','/api/auth/login','/api/auth/logout','/api/favorites','/api/lotalerts','/api/ads','/api/ads/my','/api/chat/inbox','/api/chat/history','/api/chat/read','/api/chat/send']);
  if (ok.has(request.path)) return request.statusCode >= 200 && request.statusCode < 300;
  if (request.path.startsWith('/api/favorites/toggle/')) return request.statusCode === 200;
  if (request.path.startsWith('/api/lotalerts/')) return request.statusCode === 200;
  if (request.path.startsWith('/api/lots/')) return request.statusCode === 200;
  if (request.path.startsWith('/api/ads/')) return request.statusCode === 200;
  if (request.path.endsWith('.svg')) return request.statusCode === 200;
  return false;
}

async function writeBrowserEvidence(consoleMessages, failedRequests, blockedExternalRequests) {
  const backendRequests = await collectBackendRequests();
  await writeFile(resolve(artifactsDir, 'console.json'), JSON.stringify({ consoleMessages, failedRequests, blockedExternalRequests, backendRequests, expectedSkipped }, null, 2));
  return backendRequests;
}

async function runBrowserScenarios() {
  const { chromium, request } = await loadPlaywright();
  const browser = await chromium.launch(chromiumLaunchOptions());
  const context = await browser.newContext({ baseURL: appBaseUrl, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const noCookieRequest = await request.newContext({ ignoreHTTPSErrors: true });
  const consoleMessages = [];
  const failedRequests = [];
  const blockedExternalRequests = [];
  page.on('console', (msg) => consoleMessages.push(`${msg.type()}: ${msg.text()}`));
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));

  await context.route('**/*', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    if (requestUrl.href.startsWith(`${backendUrl}/chathub`)) {
      recordExpectedSkip({ kind: 'signalr', url: `${backendUrl}/chathub`, story: SIGNALR_ROUTE_STORY_PATH });
      await route.continue();
      return;
    }
    if (!['http:', 'https:'].includes(requestUrl.protocol) || loopbackHosts.has(requestUrl.hostname)) return route.continue();
    blockedExternalRequests.push({ method: request.method(), url: request.url(), host: requestUrl.hostname, resourceType: request.resourceType() });
    await route.abort('blockedbyclient');
  });

  try {
    const meWithoutCookie = await noCookieRequest.get(`${backendUrl}/api/auth/me`);
    if (meWithoutCookie.status() !== 401) throw new Error(`no-cookie /api/auth/me should fail closed with 401, got ${meWithoutCookie.status()}`);
    const favoritesWithoutCookie = await noCookieRequest.get(`${backendUrl}/api/favorites/ids`);
    if (favoritesWithoutCookie.status() !== 401) throw new Error(`no-cookie /api/favorites/ids should fail closed with 401, got ${favoritesWithoutCookie.status()}`);

    await page.goto('/login?returnUrl=/account', { waitUntil: 'networkidle' });
    await page.getByLabel('Email').fill(ACCOUNT_SMOKE_USER.email);
    await page.getByLabel('Пароль').fill(ACCOUNT_SMOKE_USER.password);
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.waitForURL('**/account', { timeout: 20_000 });
    await expectText(page, ACCOUNT_SMOKE_USER.email, 'session/account');
    const meAfterLogin = await page.request.get(`${backendUrl}/api/auth/me`);
    if (!meAfterLogin.ok()) throw new Error(`cookie-backed /api/auth/me after login failed: ${meAfterLogin.status()}`);
    const meAfterLoginBody = await meAfterLogin.json();
    if (meAfterLoginBody.email !== ACCOUNT_SMOKE_USER.email) throw new Error(`cookie-backed /api/auth/me returned unexpected user: ${meAfterLoginBody.email}`);
    await page.screenshot({ path: resolve(artifactsDir, 'account-profile.png'), fullPage: true });

    const favoriteIdsBefore = await (await page.request.get(`${backendUrl}/api/favorites/ids`)).json();
    if (!favoriteIdsBefore.includes(favoriteLot.id)) throw new Error('favorite IDs did not include fixture lot before toggle');
    const toggleOff = await page.request.post(`${backendUrl}/api/favorites/toggle/${favoriteLot.id}`);
    if (!toggleOff.ok()) throw new Error(`favorite toggle off failed: ${toggleOff.status()}`);
    const favoriteIdsAfterOff = await (await page.request.get(`${backendUrl}/api/favorites/ids`)).json();
    if (favoriteIdsAfterOff.includes(favoriteLot.id)) throw new Error('favorite fixture lot was not removed by toggle');
    const toggleOn = await page.request.post(`${backendUrl}/api/favorites/toggle/${favoriteLot.id}`);
    if (!toggleOn.ok()) throw new Error(`favorite toggle restore failed: ${toggleOn.status()}`);
    await page.goto('/favorites', { waitUntil: 'networkidle' });
    await expectText(page, 'Account Smoke Favorite Lot', 'favorites list');

    const createdAlert = await (await page.request.post(`${backendUrl}/api/lotalerts`, { data: { categories: ['Транспорт'], regionCodes: ['77'], deliveryTimeStr: '10:00', isActive: true } })).json();
    const alertsAfterCreate = await (await page.request.get(`${backendUrl}/api/lotalerts`)).json();
    if (!alertsAfterCreate.some((alert) => alert.id === createdAlert.id && alert.isActive === true)) {
      throw new Error(`created alert ${createdAlert.id} was not visible in authenticated /api/lotalerts state`);
    }
    const updatedAlert = await page.request.put(`${backendUrl}/api/lotalerts/${createdAlert.id}`, { data: { ...createdAlert, isActive: false } });
    if (!updatedAlert.ok()) throw new Error(`alert update failed: ${updatedAlert.status()}`);
    const alertsAfterUpdate = await (await page.request.get(`${backendUrl}/api/lotalerts`)).json();
    if (!alertsAfterUpdate.some((alert) => alert.id === createdAlert.id && alert.isActive === false)) {
      throw new Error(`updated alert ${createdAlert.id} did not reflect isActive=false in authenticated /api/lotalerts state`);
    }
    const deletedAlert = await page.request.delete(`${backendUrl}/api/lotalerts/${createdAlert.id}`);
    if (deletedAlert.status() !== 204) throw new Error(`alert delete failed: ${deletedAlert.status()}`);
    const alertsAfterDelete = await (await page.request.get(`${backendUrl}/api/lotalerts`)).json();
    if (alertsAfterDelete.some((alert) => alert.id === createdAlert.id)) {
      throw new Error(`deleted alert ${createdAlert.id} remained visible in authenticated /api/lotalerts state`);
    }
    recordExpectedSkip({ kind: 'smtp-alert-delivery', endpoint: '/api/lotalerts worker delivery', reason: 'real SMTP/parser worker side effects are out of scope for Story 2-2 first slice; mock CRUD/toggle/delete is asserted instead' });
    await page.goto('/alerts', { waitUntil: 'networkidle' });
    await expectText(page, 'Мои подписки на лоты', 'alerts route');

    await page.goto('/ads', { waitUntil: 'networkidle' });
    await expectText(page, accountAd.title, 'ads list');
    await page.goto(`/ads/${accountAd.id}`, { waitUntil: 'networkidle' });
    await expectText(page, accountAd.title, 'ads detail');
    await page.goto('/account', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Мои объявления' }).click();
    await expectText(page, accountAd.title, 'account my ads');
    const createAd = await page.request.post(`${backendUrl}/api/ads`, { data: { title: 'skip multipart' } });
    if (createAd.status() !== 409) throw new Error(`expected mocked S3 upload skip status 409, got ${createAd.status()}`);
    recordExpectedSkip({ kind: 's3-upload', endpoint: '/api/ads POST multipart', reason: 'real S3 writes are out of scope for Story 2-2 first slice' });

    await page.goto('/inbox', { waitUntil: 'networkidle' });
    await expectText(page, 'Smoke Buyer', 'inbox list');
    await page.getByText('Smoke Buyer').click();
    await expectText(page, 'Здравствуйте, объявление актуально?', 'chat history');
    await page.getByPlaceholder('Напишите сообщение...').fill('Smoke REST reply');
    await page.getByRole('button', { name: 'Отправить' }).click();
    await expectText(page, 'Smoke REST reply', 'chat send');

    await page.goto('/account', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Выйти' }).first().click();
    await page.waitForURL((url) => (
      url.pathname === '/login'
      && url.searchParams.get('returnUrl') === '/account'
    ), { timeout: 15_000 });
    const meAfterLogout = await page.request.get(`${backendUrl}/api/auth/me`);
    if (meAfterLogout.status() !== 401) throw new Error(`logout did not expire fixture session: /api/auth/me -> ${meAfterLogout.status()}`);

    const backendRequests = await writeBrowserEvidence(consoleMessages, failedRequests, blockedExternalRequests);
    const requiredPaths = ['/api/auth/login','/api/auth/me','/api/auth/logout','/api/favorites/ids','/api/favorites','/api/lotalerts','/api/ads','/api/ads/my','/api/chat/inbox','/api/chat/history','/api/chat/read','/api/chat/send'];
    for (const path of requiredPaths) {
      if (!backendRequests.some((request) => request.path === path)) throw new Error(`mock backend did not observe ${path}`);
    }
    if (!backendRequests.some((request) => request.path.startsWith('/chathub'))) throw new Error('mock backend did not observe deterministic /chathub stub/skip attempt');
    if (!backendRequests.some((request) => request.path === '/api/auth/me' && request.statusCode === 401 && request.hasFixtureCookie === false)) {
      throw new Error('mock backend did not record no-cookie /api/auth/me 401 evidence');
    }
    if (!backendRequests.some((request) => request.path === '/api/favorites/ids' && request.statusCode === 401 && request.hasFixtureCookie === false)) {
      throw new Error('mock backend did not record no-cookie protected endpoint 401 evidence');
    }
    if (!backendRequests.some((request) => request.path === '/api/auth/me' && request.statusCode === 200 && request.hasFixtureCookie === true)) {
      throw new Error('mock backend did not record cookie-backed /api/auth/me 200 evidence');
    }
    const protectedSuccessWithoutCookie = backendRequests.filter((request) => (
      request.statusCode >= 200
      && request.statusCode < 300
      && request.hasFixtureCookie === false
      && ACCOUNT_SMOKE_PROTECTED_PATHS.some((path) => request.path === path || request.path.startsWith(`${path}/`))
    ));
    if (protectedSuccessWithoutCookie.length) throw new Error(`protected endpoints succeeded without fixture cookie: ${protectedSuccessWithoutCookie.map((r) => `${r.method} ${r.path}`).join('; ')}`);
    const unexpectedBackendRequests = backendRequests.filter((request) => !expectedBackendStatus(request));
    if (unexpectedBackendRequests.length) throw new Error(`unexpected mock backend path/status: ${unexpectedBackendRequests.map((r) => `${r.method} ${r.path}${r.search} -> ${r.statusCode}`).join('; ')}`);
    const unexpectedFailedRequests = failedRequests.filter((entry) => (
      !entry.includes('favicon')
      && !entry.includes('/chathub')
      && !entry.includes('mc.yandex.ru/metrika/tag.js')
      && !(entry.includes('_rsc=') && entry.includes('net::ERR_ABORTED'))
      && !(entry.includes('/api/chat/read') && entry.includes('net::ERR_ABORTED') && backendRequests.some((request) => request.path === '/api/chat/read' && request.statusCode === 200))
      && !(entry.includes('/api/chat/send') && entry.includes('net::ERR_ABORTED') && backendRequests.some((request) => request.path === '/api/chat/send' && request.statusCode === 200))
    ));
    if (unexpectedFailedRequests.length) throw new Error(`unexpected failed browser requests: ${unexpectedFailedRequests.join('; ')}`);
    const unexpectedBlockedExternalRequests = blockedExternalRequests.filter((request) => !allowedBlockedExternalHosts.has(request.host));
    if (unexpectedBlockedExternalRequests.length) throw new Error(`unexpected non-loopback browser requests were blocked: ${unexpectedBlockedExternalRequests.map((r) => r.url).join('; ')}`);
  } catch (error) {
    await page.screenshot({ path: resolve(artifactsDir, 'failure.png'), fullPage: true }).catch(() => {});
    await writeBrowserEvidence(consoleMessages, failedRequests, blockedExternalRequests).catch(() => {});
    throw error;
  } finally {
    await noCookieRequest.dispose();
    await browser.close();
  }
}

function waitForChildExit(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => child.once('exit', resolveExit));
}

async function terminateChild(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  await Promise.race([waitForChildExit(child), wait(5_000).then(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); })]);
}

async function main() {
  verifyFailClosedChecks();
  assertLoopbackAppHost();
  await rm(artifactsDir, { recursive: true, force: true });
  await mkdir(artifactsDir, { recursive: true });

  const mock = spawnLogged(process.execPath, ['scripts/account-smoke/mock-backend.mjs'], resolve(artifactsDir, 'mock-backend.log'));
  const app = { child: null };
  const cleanup = async () => { await terminateChild(app.child); await terminateChild(mock); };
  const handleSignal = () => cleanup().finally(() => process.exit(130));
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  try {
    await waitFor(`${backendUrl}/__smoke/health`, 'mock backend', { timeoutMs: 15_000, isReady: async (res) => res.ok && (await res.json().catch(() => null))?.ok === true });
    await runCommand('npm', ['run', 'build']);
    app.child = spawnLogged('npm', ['run', 'start', '--', '-H', appHost, '-p', String(appPort)], resolve(artifactsDir, 'next-start.log'));
    await waitFor(`${appBaseUrl}/login`, 'Next app', { timeoutMs: 60_000 });
    await runBrowserScenarios();
    console.log('[account-smoke] PASS account engagement smoke scenarios completed. Artifacts: test-results/account-smoke');
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[account-smoke] FAIL ${error.stack || error.message}`);
  process.exit(1);
});
