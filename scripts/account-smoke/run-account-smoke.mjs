import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACCOUNT_SMOKE_ALLOWED_BLOCKED_EXTERNAL_HOSTS, ACCOUNT_SMOKE_PROTECTED_PATHS, SIGNALR_ROUTE_STORY_PATH } from './constants.mjs';
import { ACCOUNT_SMOKE_SECOND_USER, ACCOUNT_SMOKE_USER, accountAd, counterpartyDueDiligenceReport, counterpartyInAppAlert, counterpartyWatchItem, favoriteLot } from './fixture-data.mjs';
import { assertAccountSmokeEvidencePrivate, serializeAccountSmokeEvidence } from './evidence-privacy.mjs';

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

async function expectFocused(locator, scenario) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  const focused = await locator.evaluate(async (element) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (element === document.activeElement) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  });
  if (!focused) throw new Error(`${scenario}: expected focus on ${await locator.evaluate((element) => element.outerHTML.slice(0, 240))}`);
  console.log(`[account-smoke] ${scenario}: focus verified`);
}

async function collectBackendRequests() {
  try { return await (await fetch(`${backendUrl}/__smoke/requests`)).json(); }
  catch (error) { return [{ method: 'SMOKE', path: '__evidence_collection_failed__', search: error.message, at: new Date().toISOString() }]; }
}

function expectedBackendStatus(request) {
  if (/^\/api\/lots\/[^/]+\/view-events$/.test(request.path) && request.method === 'POST') return request.statusCode === 200;
  if (request.path === '/chathub/negotiate') return request.statusCode === 501;
  if (request.path.startsWith('/chathub')) return request.statusCode === 501;
  if (request.path === '/api/ads' && request.method === 'POST') return request.statusCode === 409;
  if (request.path === '/api/auth/me') return request.statusCode === 200 || request.statusCode === 401;
  if (['/api/admin/ads/moderation/count','/api/admin/lots/needs-description/count','/api/admin/lots/unmatched-vehicle-attributes/count'].includes(request.path)) return request.statusCode === 200;
  if (request.path === '/__smoke/counterparty-control') return request.statusCode === 200;
  if (request.path === '/api/favorites/ids') return request.statusCode === 200 || request.statusCode === 401;
  if (request.path === '/api/voted-lots') return request.statusCode === 200 || request.statusCode === 401;
  if (/^\/api\/lots\/[^/]+\/vote(?:\/status)?$/.test(request.path)) return request.statusCode === 200 || request.statusCode === 401;
  if (/^\/api\/contracts\/permission\/[^/]+$/.test(request.path)) return request.statusCode === 200 || request.statusCode === 401;
  if (request.path === '/api/counterparty-watchlist' && request.method === 'GET') return [200, 401, 500].includes(request.statusCode);
  if (request.path === '/api/counterparty-watchlist' && request.method === 'POST') return [0, 200, 400, 401, 429].includes(request.statusCode);
  if (request.path === '/api/counterparty-watchlist/alerts' && request.method === 'GET') return [200, 401].includes(request.statusCode);
  if (/^\/api\/counterparty-watchlist\/alerts\/[^/]+\/read$/.test(request.path)) return [0, 204, 400, 401, 404, 429].includes(request.statusCode);
  if (/^\/api\/counterparty-watchlist\/[^/]+\/due-diligence-report$/.test(request.path)) return [200, 401, 404, 408, 500].includes(request.statusCode);
  if (/^\/api\/counterparty-watchlist\/[^/]+\/leasing-signals$/.test(request.path)) return [200, 401, 404].includes(request.statusCode);
  if (/^\/api\/counterparty-watchlist\/[^/]+\/events$/.test(request.path)) return [200, 401, 404].includes(request.statusCode);
  if (/^\/api\/counterparty-watchlist\/[^/]+$/.test(request.path)) return [0, 200, 204, 400, 401, 404, 409, 429].includes(request.statusCode);
  if (request.method === 'DELETE' && request.path.startsWith('/api/lotalerts/')) return request.statusCode === 204;
  const ok = new Set(['/__smoke/health','/__smoke/requests','/__smoke/state','/api/health/version','/api/lots/vehicle-filter-options','/api/lots/list','/api/auth/login','/api/auth/logout','/api/favorites','/api/lotalerts','/api/ads','/api/ads/my','/api/chat/inbox','/api/chat/history','/api/chat/read','/api/chat/send']);
  if (ok.has(request.path)) return request.statusCode >= 200 && request.statusCode < 300;
  if (request.path.startsWith('/api/favorites/toggle/')) return request.statusCode === 200;
  if (request.path.startsWith('/api/lotalerts/')) return request.statusCode === 200;
  if (request.method === 'GET' && request.path.startsWith('/api/lots/')) return request.statusCode === 200;
  if (request.path.startsWith('/api/ads/')) return request.statusCode === 200;
  if (request.path.endsWith('.svg')) return request.statusCode === 200;
  return false;
}

async function writeBrowserEvidence(consoleMessages, failedRequests, blockedExternalRequests) {
  const backendRequests = await collectBackendRequests();
  const evidencePath = resolve(artifactsDir, 'console.json');
  await writeFile(evidencePath, serializeAccountSmokeEvidence({
    consoleMessages,
    failedRequests,
    blockedExternalRequests,
    backendRequests,
    expectedSkipped,
  }));
  assertAccountSmokeEvidencePrivate(await readFile(evidencePath, 'utf8'));
  return backendRequests;
}

async function assertPrivateRouteAnalyticsExcluded(page, { requireUninitialized = false } = {}) {
  const state = await page.evaluate(() => {
    const tracker = globalThis.ym;
    const queuedCalls = Array.isArray(tracker?.a)
      ? tracker.a.map((args) => Array.from(args, (value) => {
          if (value && typeof value === 'object') return JSON.parse(JSON.stringify(value));
          return value;
        }))
      : [];
    return {
      pathname: location.pathname,
      trackerDefined: typeof tracker === 'function',
      scriptPresent: Boolean(document.querySelector('#yandex-metrika, script[src*="mc.yandex.ru/metrika"]')),
      queuedCalls,
    };
  });
  if (!/^\/(?:account(?:\/|$)|login(?:\/|$))/iu.test(state.pathname)) {
    throw new Error(`analytics privacy assertion requires a private route, got ${state.pathname}`);
  }
  if (requireUninitialized && (state.trackerDefined || state.scriptPresent)) {
    throw new Error(`Yandex Metrika initialized on initial private route ${state.pathname}`);
  }
  for (const call of state.queuedCalls) {
    if (call[1] === 'hit' && /^\/(?:account(?:\/|$)|login(?:\/|$))/iu.test(String(call[2]))) {
      throw new Error(`private route entered Yandex Metrika hit queue: ${call[2]}`);
    }
    if (call[1] === 'init') {
      const config = call[2] ?? {};
      for (const feature of ['clickmap', 'trackLinks', 'accurateTrackBounce', 'webvisor']) {
        if (config[feature] !== false) throw new Error(`Yandex Metrika ${feature} is not fail-closed`);
      }
      if ('ecommerce' in config) throw new Error('Yandex Metrika ecommerce observer must not be enabled');
    }
  }
  console.log(`[account-smoke] analytics excluded from private route ${state.pathname}`);
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
    await assertPrivateRouteAnalyticsExcluded(page, { requireUninitialized: true });
    const meAfterLogin = await page.request.get(`${backendUrl}/api/auth/me`);
    if (!meAfterLogin.ok()) throw new Error(`cookie-backed /api/auth/me after login failed: ${meAfterLogin.status()}`);
    const meAfterLoginBody = await meAfterLogin.json();
    if (meAfterLoginBody.email !== ACCOUNT_SMOKE_USER.email) throw new Error(`cookie-backed /api/auth/me returned unexpected user: ${meAfterLoginBody.email}`);
    await page.screenshot({ path: resolve(artifactsDir, 'account-profile.png'), fullPage: true });

    await page.goto('/account?tab=my-votes', { waitUntil: 'networkidle' });
    await expectText(page, 'Лоты, которые вы поддержали', 'account voted lots tab');
    await expectText(page, favoriteLot.title, 'account voted lots list');
    await page.goto(`/lot/${favoriteLot.slug}-${favoriteLot.publicId}`, { waitUntil: 'networkidle' });
    await expectText(page, '1 голос', 'authenticated vote status');
    await page.getByRole('button', { name: 'Отозвать голос' }).click();
    await expectText(page, '0 голосов', 'idempotent vote removal');
    const voteRestore = await page.request.put(`${backendUrl}/api/lots/${favoriteLot.id}/vote`);
    if (!voteRestore.ok()) throw new Error(`vote restore failed: ${voteRestore.status()}`);

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

    const watchlistWithoutCookie = await noCookieRequest.get(`${backendUrl}/api/counterparty-watchlist`);
    if (watchlistWithoutCookie.status() !== 401) throw new Error(`no-cookie counterparty watchlist should be 401, got ${watchlistWithoutCookie.status()}`);
    const leasingSignalsWithoutCookie = await noCookieRequest.get(`${backendUrl}/api/counterparty-watchlist/${counterpartyWatchItem.id}/leasing-signals?limit=10`);
    if (leasingSignalsWithoutCookie.status() !== 401) throw new Error(`no-cookie counterparty leasing signals should be 401, got ${leasingSignalsWithoutCookie.status()}`);
    await page.goto('/account/counterparties', { waitUntil: 'networkidle' });
    await expectText(page, 'Наблюдение за контрагентами', 'counterparty private route');
    await expectText(page, 'PRIVATE-COUNTERPARTY-SMOKE', 'counterparty owner-private item');
    await expectText(page, 'Сообщения найдены', 'counterparty source state');
    const primaryCounterpartyCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'PRIVATE-COUNTERPARTY-SMOKE' }) });
    const leasingPanel = primaryCounterpartyCard.getByRole('region', { name: 'Лизинговые сигналы контрагента' });
    await leasingPanel.getByRole('button', { name: 'Показать' }).click();
    await expectText(leasingPanel, 'Найдены сохранённые лизинговые сигналы.', 'counterparty leasing profile state');
    await expectText(leasingPanel, 'Идентичность организации не подтверждена.', 'counterparty leasing profile caveat');
    await expectText(leasingPanel, 'ООО Синтетический контур', 'counterparty leasing profile evidence');
    await leasingPanel.getByRole('button', { name: 'Скрыть' }).click();
    await assertPrivateRouteAnalyticsExcluded(page);
    for (const [text, label] of [
      ['Ожидает проверки', 'pending'], ['Нужно уточнение', 'ambiguous'],
      ['Организация не найдена', 'not-found'], ['Сообщения не найдены', 'fresh no-data'],
      ['Статус источника требует обновления', 'stale no-data'], ['Источник временно недоступен', 'unavailable'],
      ['Проверка ограничена источником', 'rate-limited'], ['Источник не ответил вовремя', 'timeout'],
      ['Формат источника изменился', 'schema-changed'],
    ]) await expectText(page, text, `counterparty ${label} state`);
    const control = (data) => page.request.post(`${backendUrl}/__smoke/counterparty-control`, { data });
    const cardId = async (card) => {
      const headingId = await card.locator('h3').getAttribute('id');
      if (!headingId?.startsWith('counterparty-')) throw new Error(`counterparty card is missing a stable heading id: ${headingId}`);
      return headingId.slice('counterparty-'.length);
    };
    const liveStatus = page.locator('[role="status"][aria-live="polite"]');
    const expectLive = async (text, scenario) => {
      await liveStatus.getByText(text, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
      console.log(`[account-smoke] ${scenario}: live announcement verified`);
    };
    const projectEvent = async (spec) => {
      const response = await control({ projectEvent: spec });
      if (!response.ok()) throw new Error(`counterparty fixture projection failed with ${response.status()}`);
      return (await response.json()).projection;
    };
    const reportRequestCount = async () => (await (await page.request.get(`${backendUrl}/__smoke/requests`)).json())
      .filter((request) => request.path.endsWith('/due-diligence-report')).length;
    const assertUniformEmptyReport404 = async (response, scenario) => {
      const responseHeaders = response.headers();
      if (response.status() !== 404 || (await response.body()).length !== 0 ||
          responseHeaders['cache-control'] !== 'private, no-store, max-age=0' || responseHeaders.pragma !== 'no-cache' ||
          responseHeaders.vary !== 'Authorization, Cookie' || responseHeaders['referrer-policy'] !== 'no-referrer' ||
          responseHeaders['x-content-type-options'] !== 'nosniff' || responseHeaders.etag) {
        throw new Error(`${scenario} report absence was not the uniform empty private 404: ${response.status()} ${JSON.stringify(responseHeaders)}`);
      }
    };
    const storageSnapshot = () => page.evaluate(() => ({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    }));

    const reportWithoutCookie = await noCookieRequest.get(`${backendUrl}/api/counterparty-watchlist/${counterpartyWatchItem.id}/due-diligence-report`);
    if (reportWithoutCookie.status() !== 401 || (await reportWithoutCookie.body()).length !== 0) {
      throw new Error(`no-cookie due-diligence report should be empty 401, got ${reportWithoutCookie.status()}`);
    }
    const identityReportScenarios = [
      ['PRIVATE-COUNTERPARTY-SMOKE', 'resolved', 'fns-official', counterpartyDueDiligenceReport.organization.name],
      ['SMOKE-CONFIRMED-MISSING', 'unresolved', 'owner-submitted-unverified', 'SMOKE-CONFIRMED-MISSING'],
      ['SMOKE-PENDING', 'unresolved', 'owner-submitted-unverified', 'SMOKE-PENDING'],
      ['SMOKE-AMBIGUOUS', 'ambiguous', 'owner-submitted-unverified', 'SMOKE-AMBIGUOUS'],
      ['SMOKE-NOT-FOUND', 'not-found', 'owner-submitted-unverified', 'SMOKE-NOT-FOUND'],
      ['SMOKE-INVALID-INPUT', 'unresolved', 'owner-submitted-unverified', 'SMOKE-INVALID-INPUT'],
      ['SMOKE-UNKNOWN', 'unresolved', 'owner-submitted-unverified', 'SMOKE-UNKNOWN'],
      ['SMOKE-FUTURE', 'unresolved', 'owner-submitted-unverified', 'SMOKE-FUTURE'],
    ];
    const reportPanel = page.getByRole('article', { name: 'Отчёт о проверке контрагента' });
    for (const [label, identityStatus, identityBasis, expectedName] of identityReportScenarios) {
      const card = page.locator('article').filter({ hasText: label }).first();
      const response = await page.request.get(`${backendUrl}/api/counterparty-watchlist/${await cardId(card)}/due-diligence-report`);
      if (response.status() !== 200) throw new Error(`${label} identity report returned ${response.status()}`);
      const headers = response.headers();
      if (headers['cache-control'] !== 'private, no-store, max-age=0' || headers.pragma !== 'no-cache' ||
          headers.vary !== 'Authorization, Cookie' || headers['referrer-policy'] !== 'no-referrer' ||
          headers['x-content-type-options'] !== 'nosniff' || headers.etag) {
        throw new Error(`${label} identity report privacy/cache headers drifted: ${JSON.stringify(headers)}`);
      }
      const report = await response.json();
      if (report.organization.identityStatus !== identityStatus ||
          report.organization.identityBasis !== identityBasis ||
          report.organization.name !== expectedName) {
        throw new Error(`${label} identity report mapped out of contract: ${JSON.stringify(report.organization)}`);
      }
      if (identityStatus !== 'resolved') {
        if (report.assessment.level !== 'unknown' || report.assessment.confidence !== 'unknown' || report.assessment.coverage !== 'insufficient') {
          throw new Error(`${label} unresolved assessment leaked a resolved result`);
        }
        if (report.sources.some((source) => source.evidenceCount !== 0) || JSON.stringify(report).includes('PRIVATE-REPORT-XSS')) {
          throw new Error(`${label} unresolved report leaked resolved evidence or identity`);
        }
      }

      const openButton = card.getByRole('button', { name: 'Открыть отчёт' });
      await openButton.click();
      await reportPanel.getByText(expectedName, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
      const renderedStatus = reportPanel.locator('p').filter({ hasText: 'Статус идентификации:' }).locator('code');
      if (await renderedStatus.textContent() !== identityStatus) {
        throw new Error(`${label} report component rendered identity status ${await renderedStatus.textContent()} instead of ${identityStatus}`);
      }
      await reportPanel.getByRole('button', { name: 'Закрыть отчёт' }).click();
      await reportPanel.waitFor({ state: 'detached' });
      await expectFocused(openButton, `${label} identity report component close focus return`);
    }
    const storageBeforeReport = await storageSnapshot();
    await control({ delays: { report: [250] } });
    const reportCountBefore = await reportRequestCount();
    const analyticsRequestCountBeforeReport = blockedExternalRequests
      .filter((request) => request.host === 'mc.yandex.ru').length;
    const primaryCard = page.locator('article').filter({ hasText: 'PRIVATE-COUNTERPARTY-SMOKE' }).first();
    await primaryCard.getByRole('button', { name: 'Открыть отчёт' }).click();
    await reportPanel.getByRole('status').getByText('Формируем отчёт…', { exact: true }).waitFor({ state: 'visible' });
    await expectFocused(reportPanel.getByRole('heading', { name: 'Отчёт о проверке контрагента' }), 'due-diligence report loading focus');
    await reportPanel.getByText(counterpartyDueDiligenceReport.organization.name, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    if (await page.getByRole('article', { name: 'Отчёт о проверке контрагента' }).count() !== 1) throw new Error('more than one due-diligence report rendered');
    if (await reportPanel.locator('img[src="x"]').count()) throw new Error('hostile report organization name executed as markup');
    for (const text of [
      'Уровень риска', 'Высокий', 'Надёжность оценки', 'Средний', 'Полнота покрытия', 'limited',
      'adverse', 'Отчёт не является юридической консультацией или заключением.',
      'Данные источников могут быть неполными, устаревшими или временно недоступными.',
      'Данные КАД загружены оператором, не подтверждены источником',
    ]) await reportPanel.getByText(text, { exact: false }).first().waitFor({ state: 'visible' });
    if (await reportRequestCount() !== reportCountBefore + 1) throw new Error('opening one report did not issue exactly one report request');
    if (blockedExternalRequests.filter((request) => request.host === 'mc.yandex.ru').length !== analyticsRequestCountBeforeReport) {
      throw new Error('rendering the private due-diligence report initiated a Yandex Metrika request');
    }
    await assertPrivateRouteAnalyticsExcluded(page);

    await page.evaluate(() => {
      const nativeCreate = URL.createObjectURL.bind(URL);
      const nativeRevoke = URL.revokeObjectURL.bind(URL);
      window.__reportBlobProbe = { type: null, rawText: null, createdUrl: null, revokedUrl: null };
      URL.createObjectURL = (blob) => {
        const createdUrl = nativeCreate(blob);
        window.__reportBlobProbe.type = blob.type;
        window.__reportBlobProbe.createdUrl = createdUrl;
        void blob.text().then((rawText) => { window.__reportBlobProbe.rawText = rawText; });
        return createdUrl;
      };
      URL.revokeObjectURL = (url) => {
        window.__reportBlobProbe.revokedUrl = url;
        nativeRevoke(url);
      };
    });
    const downloadPromise = page.waitForEvent('download');
    await reportPanel.getByRole('button', { name: 'Скачать JSON' }).click();
    const download = await downloadPromise;
    if (download.suggestedFilename() !== 'due-diligence-report.json') throw new Error(`unsafe report filename: ${download.suggestedFilename()}`);
    const downloadPath = await download.path();
    const exactReportJson = JSON.stringify(counterpartyDueDiligenceReport);
    if (!downloadPath || await readFile(downloadPath, 'utf8') !== exactReportJson) throw new Error('downloaded report bytes differ from the exact backend JSON response');
    await page.waitForFunction(() => window.__reportBlobProbe?.rawText !== null);
    const blobProbe = await page.evaluate(() => window.__reportBlobProbe);
    if (blobProbe.type !== 'application/json;charset=utf-8' || blobProbe.rawText !== exactReportJson ||
        !blobProbe.createdUrl || blobProbe.revokedUrl !== blobProbe.createdUrl) {
      throw new Error(`download Blob MIME/bytes/revoke lifecycle drifted: ${JSON.stringify(blobProbe)}`);
    }
    await page.emulateMedia({ media: 'print' });
    if (!await reportPanel.isVisible() || await primaryCard.isVisible() ||
        await reportPanel.getByRole('button', { name: 'Скачать JSON' }).isVisible() ||
        await reportPanel.getByRole('button', { name: 'Печать' }).isVisible()) {
      throw new Error('print isolation did not expose only the report or hide interactive controls');
    }
    await page.emulateMedia({ media: 'screen' });
    const reportTextBeforePrint = await reportPanel.innerText();
    await page.evaluate(() => {
      window.__accountSmokePrintCount = 0;
      window.__accountSmokePrintedText = null;
      window.print = () => {
        window.__accountSmokePrintCount += 1;
        window.__accountSmokePrintedText = document.querySelector('[aria-labelledby="due-diligence-report-heading"]')?.textContent || null;
      };
    });
    const countBeforePrint = await reportRequestCount();
    await reportPanel.getByRole('button', { name: 'Печать' }).click();
    if (await page.evaluate(() => window.__accountSmokePrintCount) !== 1) throw new Error('report print did not invoke window.print exactly once');
    const printedText = await page.evaluate(() => window.__accountSmokePrintedText);
    if (!printedText || !printedText.includes(counterpartyDueDiligenceReport.organization.name) ||
        !reportTextBeforePrint.includes(counterpartyDueDiligenceReport.organization.name)) {
      throw new Error('print did not use the same in-memory report projection');
    }
    if (await reportRequestCount() !== countBeforePrint) throw new Error('printing the report issued another backend request');
    for (const viewport of [{ width: 320, height: 568 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error(`due-diligence report overflow at ${viewport.width}x${viewport.height}`);
      for (const buttonName of ['Закрыть отчёт', 'Скачать JSON', 'Печать']) {
        const button = reportPanel.getByRole('button', { name: buttonName });
        await button.focus();
        await expectFocused(button, `due-diligence ${buttonName} keyboard target ${viewport.width}x${viewport.height}`);
      }

      if (viewport.width === 320) {
        const keyboardDownload = page.waitForEvent('download');
        const button = reportPanel.getByRole('button', { name: 'Скачать JSON' });
        await button.focus();
        await page.keyboard.press('Space');
        const downloaded = await keyboardDownload;
        if (downloaded.suggestedFilename() !== 'due-diligence-report.json' || !await reportPanel.isVisible()) {
          throw new Error('keyboard Space did not complete the 320px report download action');
        }
        await expectFocused(button, 'due-diligence keyboard download preserves focus at 320px');
      } else if (viewport.width === 768) {
        const beforeKeyboardPrint = await page.evaluate(() => window.__accountSmokePrintCount);
        const beforeKeyboardPrintRequests = await reportRequestCount();
        const button = reportPanel.getByRole('button', { name: 'Печать' });
        await button.focus();
        await page.keyboard.press('Enter');
        if (await page.evaluate(() => window.__accountSmokePrintCount) !== beforeKeyboardPrint + 1 ||
            await reportRequestCount() !== beforeKeyboardPrintRequests || !await reportPanel.isVisible()) {
          throw new Error('keyboard Enter did not complete the 768px in-memory print action');
        }
        await expectFocused(button, 'due-diligence keyboard print preserves focus at 768px');
      } else {
        const closeButton = reportPanel.getByRole('button', { name: 'Закрыть отчёт' });
        await closeButton.focus();
        await page.keyboard.press('Space');
        await reportPanel.waitFor({ state: 'detached' });
        const openButton = primaryCard.getByRole('button', { name: 'Открыть отчёт' });
        await expectFocused(openButton, 'due-diligence keyboard close returns focus at 1440px');
        await control({ delays: { report: [150] } });
        await page.keyboard.press('Enter');
        await reportPanel.getByRole('status').getByText('Формируем отчёт…', { exact: true }).waitFor({ state: 'visible' });
        await expectFocused(reportPanel.getByRole('heading', { name: 'Отчёт о проверке контрагента' }), 'due-diligence keyboard reopen loading focus at 1440px');
        await reportPanel.getByText(counterpartyDueDiligenceReport.organization.name, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    const browserCachePrivacy = await page.evaluate(async () => {
      const reportRequests = [];
      for (const cacheName of await caches.keys()) {
        const cache = await caches.open(cacheName);
        for (const request of await cache.keys()) {
          if (request.url.includes('/due-diligence-report')) reportRequests.push(request.url);
        }
      }
      const registrations = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
      return { reportRequests, serviceWorkerScopes: registrations.map((registration) => registration.scope) };
    });
    if (browserCachePrivacy.reportRequests.length || browserCachePrivacy.serviceWorkerScopes.length) {
      throw new Error(`private report entered Cache API/service-worker control: ${JSON.stringify(browserCachePrivacy)}`);
    }
    if (consoleMessages.some((message) => message.includes(counterpartyDueDiligenceReport.organization.name) || message.includes('PRIVATE-REPORT-XSS'))) {
      throw new Error('private due-diligence fields leaked to browser console');
    }

    await reportPanel.getByRole('button', { name: 'Закрыть отчёт' }).click();
    await reportPanel.waitFor({ state: 'detached' });
    await expectFocused(primaryCard.getByRole('button', { name: 'Открыть отчёт' }), 'due-diligence report close focus return');
    await control({ delays: { report: [700, 0] } });
    await primaryCard.getByRole('button', { name: 'Открыть отчёт' }).click();
    await wait(80);
    const pendingCard = page.locator('article').filter({ hasText: 'SMOKE-PENDING' }).first();
    await pendingCard.getByRole('button', { name: 'Открыть отчёт' }).click();
    await reportPanel.getByText('SMOKE-PENDING', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await wait(750);
    if (await reportPanel.getByText(counterpartyDueDiligenceReport.organization.name, { exact: true }).count()) throw new Error('stale owner/entry report response replaced the latest report');
    await reportPanel.getByText('Не определён', { exact: true }).first().waitFor({ state: 'visible' });
    await reportPanel.getByText('insufficient', { exact: true }).first().waitFor({ state: 'visible' });

    await reportPanel.getByRole('button', { name: 'Закрыть отчёт' }).click();
    const staleCard = page.locator('article').filter({ hasText: 'SMOKE-STALE' }).first();
    const staleReportUrl = `${backendUrl}/api/counterparty-watchlist/${await cardId(staleCard)}/due-diligence-report`;
    // Chromium transparently retries network HTTP 408 responses. Record real backend evidence through APIRequestContext,
    // then fulfill one browser request at the page boundary so the client state machine can observe the terminal 408.
    await control({ failures: { report: [408] } });
    const backendTimeout = await page.request.get(staleReportUrl);
    if (backendTimeout.status() !== 408) throw new Error(`due-diligence backend timeout fixture returned ${backendTimeout.status()}`);
    await page.route(staleReportUrl, (route) => route.fulfill({
      status: 408, contentType: 'application/json', body: JSON.stringify({ title: 'PRIVATE-RAW-MUST-NOT-ECHO' }),
      headers: { 'cache-control': 'private, no-store, max-age=0', pragma: 'no-cache' },
    }), { times: 1 });
    await staleCard.getByRole('button', { name: 'Открыть отчёт' }).click();
    await reportPanel.getByRole('alert').filter({ hasText: 'Не удалось сформировать отчёт за отведённое время. Повторите попытку.' }).waitFor({ state: 'visible' });
    if (await reportPanel.getByText('PRIVATE-RAW-MUST-NOT-ECHO', { exact: false }).count()) throw new Error('report timeout echoed private backend body');
    await reportPanel.getByRole('button', { name: 'Повторить' }).click();
    await reportPanel.getByText('SMOKE-STALE', { exact: true }).waitFor({ state: 'visible' });
    await reportPanel.getByText('Низкий', { exact: true }).first().waitFor({ state: 'visible' });
    await reportPanel.getByText('Низкий уровень не доказывает платёжеспособность', { exact: false }).waitFor({ state: 'visible' });
    await reportPanel.getByRole('button', { name: 'Закрыть отчёт' }).click();

    await control({ failures: { report: [500] } });
    await primaryCard.getByRole('button', { name: 'Открыть отчёт' }).click();
    await reportPanel.getByRole('alert').filter({ hasText: 'Отчёт сейчас недоступен. Повторите попытку позже.' }).waitFor({ state: 'visible' });
    if (await reportPanel.getByText('PRIVATE-RAW-MUST-NOT-ECHO', { exact: false }).count()) throw new Error('report 500 echoed private backend body');
    await reportPanel.getByRole('button', { name: 'Закрыть отчёт' }).click();

    const missingReportCard = page.locator('article').filter({ hasText: 'SMOKE-PAGE-35' }).first();
    const missingReportId = await cardId(missingReportCard);
    await control({ removeId: missingReportId });
    await missingReportCard.getByRole('button', { name: 'Открыть отчёт' }).click();
    await missingReportCard.waitFor({ state: 'detached', timeout: 15_000 });
    await expectLive('Запись больше недоступна; список обновлён.', 'due-diligence report 404 canonical removal');
    const foreignReport404 = await page.request.get(`${backendUrl}/api/counterparty-watchlist/44444444-4444-4444-8444-999999999999/due-diligence-report`);
    const softDeletedReport404 = await page.request.get(`${backendUrl}/api/counterparty-watchlist/${missingReportId}/due-diligence-report`);
    const neverPresentReport404 = await page.request.get(`${backendUrl}/api/counterparty-watchlist/00000000-0000-0000-0000-000000000000/due-diligence-report`);
    await assertUniformEmptyReport404(foreignReport404, 'foreign-owner');
    await assertUniformEmptyReport404(softDeletedReport404, 'soft-deleted');
    await assertUniformEmptyReport404(neverPresentReport404, 'never-present');
    const storageAfterReport = await storageSnapshot();
    for (const [label, snapshot] of [['before', storageBeforeReport], ['after', storageAfterReport]]) {
      const serialized = JSON.stringify(snapshot);
      for (const forbidden of [counterpartyDueDiligenceReport.schemaVersion, 'PRIVATE-REPORT-XSS', counterpartyDueDiligenceReport.organization.name]) {
        if (serialized.includes(forbidden)) throw new Error(`due-diligence report leaked into ${label} browser storage`);
      }
    }

    await control({ failures: { items: [500] } });
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expectText(page, 'Не удалось выполнить действие', 'counterparty safe list 500');
    await expectText(page, 'PRIVATE-COUNTERPARTY-SMOKE', 'counterparty preserves canonical list on refresh failure');
    if (await page.getByText('PRIVATE-RAW-MUST-NOT-ECHO', { exact: false }).count()) throw new Error('counterparty UI echoed a private backend error body');
    await page.getByRole('button', { name: 'Повторить обновление' }).first().click();
    await expectLive('Список наблюдения обновлён: 50.', 'counterparty refresh success');
    const watchlistMore = page.getByRole('button', { name: 'Показать ещё контрагентов' });
    await watchlistMore.focus();
    await watchlistMore.click();
    await expectText(page, 'SMOKE-PAGE-45', 'counterparty watchlist 51+ pagination');
    const watchlistComplete = page.getByRole('button', { name: 'Все контрагенты загружены' });
    await expectFocused(watchlistComplete, 'counterparty final watchlist page focus retention');
    await expectLive('Все контрагенты загружены.', 'counterparty final watchlist page announcement');

    await control({ failures: { read: [429] } });
    await page.getByRole('button', { name: 'Отметить прочитанным' }).first().click();
    await expectText(page, 'Слишком много запросов. Подождите и повторите попытку.', 'counterparty read 429 safe error');
    if (await page.getByText('PRIVATE-RAW-MUST-NOT-ECHO', { exact: false }).count()) throw new Error('counterparty read error echoed a private backend response');
    await control({ delays: { read: [500], alerts: [700] } });
    await page.getByRole('button', { name: 'Отметить прочитанным' }).first().click();
    await wait(80);
    await page.getByRole('button', { name: 'Обновить уведомления' }).click();
    await expectText(page, 'Уведомление отмечено прочитанным', 'counterparty delayed read supersedes stale feed refresh');
    const firstAlert = page.locator(`#alert-${counterpartyInAppAlert.id}`);
    await expectFocused(firstAlert, 'counterparty mark-read focus transfer');
    await firstAlert.getByText('Прочитано:', { exact: false }).waitFor({ state: 'visible' });
    await control({ delays: { alerts: [700] } });
    await page.getByRole('button', { name: 'Обновить уведомления' }).click();
    await wait(80);
    await page.getByRole('button', { name: 'Обновить уведомления' }).click();
    await expectLive('Уведомления обновлены: 50.', 'counterparty alert refresh success');
    await wait(750);
    if (await firstAlert.getByRole('button', { name: 'Отметить прочитанным' }).count()) throw new Error('stale feed response restored an unread alert');
    const stateBeforeRepeatedRead = await (await page.request.get(`${backendUrl}/__smoke/state`)).json();
    const firstReadAt = stateBeforeRepeatedRead.counterpartyAlerts.find((item) => item.id === counterpartyInAppAlert.id)?.readAtUtc;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const repeated = await page.request.put(`${backendUrl}/api/counterparty-watchlist/alerts/${counterpartyInAppAlert.id}/read`);
      if (repeated.status() !== 204) throw new Error(`counterparty repeated read ${attempt + 1} returned ${repeated.status()}`);
    }
    const stateAfterRepeatedRead = await (await page.request.get(`${backendUrl}/__smoke/state`)).json();
    if (stateAfterRepeatedRead.counterpartyAlerts.find((item) => item.id === counterpartyInAppAlert.id)?.readAtUtc !== firstReadAt) throw new Error('counterparty repeated read changed immutable first-read timestamp');
    const alertsMore = page.getByRole('button', { name: 'Показать ещё уведомления' });
    await alertsMore.focus();
    await alertsMore.click();
    await expectText(page, 'A40-51/2026', 'counterparty alert pagination');
    const alertsComplete = page.getByRole('button', { name: 'Все уведомления загружены' });
    await expectFocused(alertsComplete, 'counterparty final alert page focus retention');
    await expectLive('Все уведомления загружены.', 'counterparty final alert page announcement');

    const firstCard = page.locator('article').filter({ hasText: 'PRIVATE-COUNTERPARTY-SMOKE' }).first();
    const historyOpen = firstCard.getByRole('button', { name: 'Открыть историю' });
    await historyOpen.focus(); await page.keyboard.press('Enter');
    const historyHeading = firstCard.getByRole('heading', { name: 'История источника' });
    await expectFocused(historyHeading, 'counterparty history keyboard open focus');
    await expectText(page, 'Сообщение о наблюдении', 'counterparty history');
    await expectText(page, 'Ссылка источника недоступна', 'counterparty hostile evidence link fallback');
    if (await page.locator('a[href*="evil.example"]').count()) throw new Error('hostile counterparty evidence URL was rendered as a link');
    const historyRegion = firstCard.getByRole('region', { name: 'История событий' });
    if (await historyRegion.getByRole('listitem').count() !== 50) throw new Error('counterparty first history page did not contain 50 events');
    await control({ delays: { history: [700] } });
    await historyRegion.getByRole('button', { name: 'Показать ещё события' }).click();
    await firstCard.getByRole('button', { name: 'Скрыть историю' }).click();
    await expectFocused(historyOpen, 'counterparty history close focus return');
    await historyOpen.click();
    await expectFocused(historyHeading, 'counterparty history reopen focus');
    await wait(750);
    if (await historyRegion.getByRole('listitem').count() !== 50) throw new Error('stale history append committed after a newer reset');
    const historyMore = historyRegion.getByRole('button', { name: 'Показать ещё события' });
    await historyMore.focus();
    await historyMore.click();
    await historyRegion.getByRole('listitem').nth(50).waitFor({ state: 'visible', timeout: 15_000 });
    if (await historyRegion.getByRole('listitem').count() !== 51) throw new Error('counterparty history pagination did not expose the 51st event');
    const historyComplete = historyRegion.getByRole('button', { name: 'Все события истории загружены' });
    await expectFocused(historyComplete, 'counterparty final history page focus retention');
    await expectLive('Все события истории загружены.', 'counterparty final history page announcement');

    const createOpener = page.getByRole('button', { name: 'Добавить контрагента' }).first();
    await createOpener.focus(); await page.keyboard.press('Enter');
    await expectFocused(page.getByLabel('ИНН организации'), 'counterparty create open focus');
    const addButton = page.getByRole('button', { name: 'Добавить', exact: true });
    await addButton.click();
    await expectText(page, 'Проверьте поля формы', 'counterparty create validation');
    await expectFocused(page.getByLabel('Название'), 'counterparty first-invalid-field focus');
    await page.getByRole('button', { name: 'Отмена' }).first().click();
    await expectFocused(createOpener, 'counterparty create cancel focus return');

    await createOpener.click();
    await page.getByLabel('ИНН организации').fill('7707083893');
    await page.getByLabel('Название').fill('Rejected mutation organization');
    await page.getByLabel('Метка для себя (необязательно)').fill('CREATE-400-SHOULD-NOT-EXIST');
    await control({ failures: { create: [400] } });
    await addButton.click();
    await expectText(page, 'Проверьте заполнение формы.', 'counterparty create 400 safe error');
    if (!await page.getByLabel('Название').isVisible()) throw new Error('counterparty create form closed after recoverable 400');
    if (await page.getByText('PRIVATE-RAW-MUST-NOT-ECHO', { exact: false }).count()) throw new Error('counterparty create 400 echoed a private backend response');
    await page.getByRole('button', { name: 'Отмена' }).first().click();

    await createOpener.click();
    await page.getByLabel('ИНН организации').fill('7707083893');
    await page.getByLabel('Название').fill('Invalid JSON response organization');
    await page.getByLabel('Метка для себя (необязательно)').fill('Invalid JSON canonical');
    await control({ invalidJson: { create: [true] } });
    await addButton.click();
    await expectText(page, 'Не удалось выполнить действие. Повторите попытку.', 'counterparty invalid JSON safe error');
    if (!await page.getByLabel('Название').isVisible()) throw new Error('counterparty create form closed after invalid JSON');
    await page.getByRole('button', { name: 'Отмена' }).first().click();
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expectText(page, 'Invalid JSON canonical', 'counterparty invalid JSON canonical server state recovery');
    if (await page.getByText('Invalid JSON canonical', { exact: true }).count() !== 1) throw new Error('counterparty invalid JSON recovery duplicated the canonical item');

    await createOpener.click();
    await page.getByLabel('ИНН организации').fill('7707083893');
    await page.getByLabel('Название').fill('Synthetic second organization');
    await page.getByLabel('Метка для себя (необязательно)').fill('Second smoke counterparty');
    await addButton.click();
    await expectText(page, 'Контрагент добавлен', 'counterparty create');
    await expectText(page, 'Second smoke counterparty', 'counterparty create canonical item');

    let secondCard = page.locator('article').filter({ hasText: 'Second smoke counterparty' }).first();
    const secondId = await cardId(secondCard);
    const lifecycleEvents = {
      beforeOptIn: { watchlistEntryId: secondId, eventId: '66666666-6666-4666-8666-000000000001', sourceKey: 'lifecycle-pre-optin', messageType: 'LIFECYCLE-PRE-OPTIN', caseNumber: 'LIFE-01/2026' },
      eligibleOne: { watchlistEntryId: secondId, eventId: '66666666-6666-4666-8666-000000000002', sourceKey: 'lifecycle-eligible-one', messageType: 'LIFECYCLE-ELIGIBLE-ONE', caseNumber: 'LIFE-02/2026' },
      excluded: { watchlistEntryId: secondId, eventId: '66666666-6666-4666-8666-000000000003', sourceKey: 'lifecycle-excluded', messageType: 'LIFECYCLE-EXCLUDED-WHILE-OFF', caseNumber: 'LIFE-03/2026' },
      eligibleTwo: { watchlistEntryId: secondId, eventId: '66666666-6666-4666-8666-000000000004', sourceKey: 'lifecycle-eligible-two', messageType: 'LIFECYCLE-ELIGIBLE-TWO', caseNumber: 'LIFE-04/2026' },
    };
    const alertRegion = page.getByRole('region', { name: 'Уведомления в кабинете' });
    const refreshAlertFeed = async () => {
      await alertRegion.getByRole('button', { name: 'Обновить уведомления' }).click();
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await alertRegion.getAttribute('aria-busy') === 'false') return;
        await wait(25);
      }
      throw new Error('counterparty alert refresh did not settle');
    };
    const expectAlertCount = async (message, expected, scenario) => {
      await wait(120);
      const actual = await alertRegion.getByText(message, { exact: true }).count();
      if (actual !== expected) throw new Error(`${scenario}: expected ${expected} alert(s), got ${actual}`);
      console.log(`[account-smoke] ${scenario}: alert count ${actual}`);
    };

    let projection = await projectEvent(lifecycleEvents.beforeOptIn);
    if (!projection.created || projection.eligible || projection.eventCount !== 1 || projection.alertCount !== 0) throw new Error(`future-only pre-opt-in projection was incorrect: ${JSON.stringify(projection)}`);
    await refreshAlertFeed();
    await expectAlertCount(lifecycleEvents.beforeOptIn.messageType, 0, 'counterparty pre-opt-in event excluded from alerts');

    await secondCard.getByRole('button', { name: 'Изменить' }).click();
    await expectFocused(secondCard.getByRole('heading', { name: 'Настройки наблюдения' }), 'counterparty edit open focus');
    await secondCard.getByLabel('Метка для себя').fill('Second smoke canonical');
    await secondCard.getByLabel('Получать новые уведомления в кабинете').check();
    await control({ delays: { items: [700] } });
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await wait(80);
    await secondCard.getByRole('button', { name: 'Сохранить' }).click();
    await expectText(page, 'Настройки обновлены', 'counterparty mutation supersedes stale list refresh');
    await wait(750);
    await expectText(page, 'Second smoke canonical', 'counterparty canonical list survives out-of-order response');
    projection = await projectEvent(lifecycleEvents.beforeOptIn);
    if (projection.created || projection.eligible || projection.eventCount !== 1 || projection.alertCount !== 0) throw new Error(`pre-opt-in replay recomputed eligibility: ${JSON.stringify(projection)}`);
    await refreshAlertFeed();
    await expectAlertCount(lifecycleEvents.beforeOptIn.messageType, 0, 'counterparty pre-opt-in replay remains ineligible after opt-in');

    projection = await projectEvent(lifecycleEvents.eligibleOne);
    if (!projection.created || !projection.eligible || projection.eventCount !== 1 || projection.alertCount !== 1) throw new Error(`eligible projection was incorrect: ${JSON.stringify(projection)}`);
    projection = await projectEvent(lifecycleEvents.eligibleOne);
    if (projection.created || !projection.eligible || projection.eventCount !== 1 || projection.alertCount !== 1) throw new Error(`replayed projection was not idempotent: ${JSON.stringify(projection)}`);
    await refreshAlertFeed();
    await expectAlertCount(lifecycleEvents.eligibleOne.messageType, 1, 'counterparty replay produces one alert');

    secondCard = page.locator('article').filter({ hasText: 'Second smoke canonical' }).first();
    await secondCard.getByRole('button', { name: 'Изменить' }).click();
    await control({ delays: { update: [500] } });
    await secondCard.getByLabel('Метка для себя').fill('DELAYED-STALE-SHOULD-NOT-COMMIT');
    await secondCard.getByRole('button', { name: 'Сохранить' }).click();
    await wait(80);
    await control({ bumpVersionId: secondId });
    await expectText(page, 'Данные изменились в другой вкладке', 'counterparty delayed stale update conflict recovery');
    await expectFocused(secondCard.getByRole('heading', { name: 'Настройки наблюдения' }), 'counterparty conflict focus');
    if (await page.getByText('PRIVATE-RAW-MUST-NOT-ECHO', { exact: false }).count()) throw new Error('counterparty conflict echoed private response detail');
    if (await secondCard.getByLabel('Метка для себя').inputValue() !== 'Second smoke canonical') throw new Error('counterparty delayed conflict did not restore canonical values');
    await secondCard.getByRole('button', { name: 'Сохранить' }).click();
    await expectText(page, 'Настройки обновлены', 'counterparty post-conflict explicit retry');

    secondCard = page.locator('article').filter({ hasText: 'Second smoke canonical' }).first();
    await secondCard.getByRole('button', { name: 'Изменить' }).click();
    await secondCard.getByLabel('Мониторинг включён').uncheck();
    await secondCard.getByLabel('Получать новые уведомления в кабинете').uncheck();
    await secondCard.getByRole('button', { name: 'Сохранить' }).click();
    await expectText(page, 'Мониторинг выключен', 'counterparty opt-out and disable');
    await refreshAlertFeed();
    await expectAlertCount(lifecycleEvents.eligibleOne.messageType, 1, 'counterparty prior eligible alert remains after opt-out');
    projection = await projectEvent(lifecycleEvents.excluded);
    if (!projection.created || projection.eligible || projection.eventCount !== 1 || projection.alertCount !== 0) throw new Error(`disabled projection was incorrect: ${JSON.stringify(projection)}`);
    await refreshAlertFeed();
    await expectAlertCount(lifecycleEvents.excluded.messageType, 0, 'counterparty disabled event excluded from alerts');

    secondCard = page.locator('article').filter({ hasText: 'Second smoke canonical' }).first();
    await secondCard.getByRole('button', { name: 'Изменить' }).click();
    await secondCard.getByLabel('Мониторинг включён').check();
    await secondCard.getByLabel('Получать новые уведомления в кабинете').check();
    await secondCard.getByRole('button', { name: 'Сохранить' }).click();
    await expectText(page, 'Мониторинг включён', 'counterparty re-enable');
    projection = await projectEvent(lifecycleEvents.excluded);
    if (projection.created || projection.eligible || projection.eventCount !== 1 || projection.alertCount !== 0) throw new Error(`disabled-period replay recomputed eligibility: ${JSON.stringify(projection)}`);
    await refreshAlertFeed();
    await expectAlertCount(lifecycleEvents.excluded.messageType, 0, 'counterparty disabled-period replay remains ineligible after re-enable');
    await expectAlertCount(lifecycleEvents.eligibleOne.messageType, 1, 'counterparty prior eligible alert survives re-enable');
    projection = await projectEvent(lifecycleEvents.eligibleTwo);
    if (!projection.created || !projection.eligible || projection.alertCount !== 1) throw new Error(`post-re-enable projection was incorrect: ${JSON.stringify(projection)}`);
    projection = await projectEvent(lifecycleEvents.eligibleTwo);
    if (projection.created || projection.alertCount !== 1) throw new Error(`post-re-enable replay was not idempotent: ${JSON.stringify(projection)}`);
    await refreshAlertFeed();
    await expectAlertCount(lifecycleEvents.eligibleTwo.messageType, 1, 'counterparty post-re-enable event produces one alert');

    const invalidJsonCard = page.locator('article').filter({ hasText: 'Invalid JSON canonical' }).first();
    await invalidJsonCard.getByRole('button', { name: 'Изменить' }).click();
    await invalidJsonCard.getByLabel('Метка для себя').fill('OFFLINE-SHOULD-NOT-COMMIT');
    await control({ offline: { update: [true] } });
    await invalidJsonCard.getByRole('button', { name: 'Сохранить' }).click();
    await expectText(page, 'Не удалось выполнить действие. Повторите попытку.', 'counterparty offline update safe error');
    if (!await invalidJsonCard.getByRole('heading', { name: 'Настройки наблюдения' }).isVisible()) throw new Error('counterparty edit form closed after offline update');
    await control({ failures: { update: [429] } });
    await invalidJsonCard.getByRole('button', { name: 'Сохранить' }).click();
    await expectText(page, 'Слишком много запросов. Подождите и повторите попытку.', 'counterparty update 429 safe error');
    await invalidJsonCard.getByRole('button', { name: 'Отмена' }).click();
    await invalidJsonCard.getByRole('button', { name: 'Удалить' }).click();
    await control({ failures: { delete: [400] } });
    await invalidJsonCard.getByRole('group', { name: 'Подтверждение удаления' }).getByRole('button', { name: 'Удалить', exact: true }).click();
    await expectText(page, 'Проверьте заполнение формы.', 'counterparty delete 400 safe error');
    if (!await invalidJsonCard.isVisible()) throw new Error('counterparty row disappeared after rejected delete');
    await invalidJsonCard.getByRole('group', { name: 'Подтверждение удаления' }).getByRole('button', { name: 'Отмена' }).click();
    await invalidJsonCard.getByRole('button', { name: 'Удалить' }).click();
    await invalidJsonCard.getByRole('group', { name: 'Подтверждение удаления' }).getByRole('button', { name: 'Удалить', exact: true }).click();
    await invalidJsonCard.waitFor({ state: 'detached', timeout: 15_000 });

    const missingUpdateCard = page.locator('article').filter({ hasText: 'SMOKE-PENDING' }).first();
    await missingUpdateCard.getByRole('button', { name: 'Изменить' }).click();
    await control({ removeId: await cardId(missingUpdateCard) });
    await missingUpdateCard.getByRole('button', { name: 'Сохранить' }).click();
    await missingUpdateCard.waitFor({ state: 'detached', timeout: 15_000 });
    await expectText(page, 'Запись больше недоступна', 'counterparty update 404 canonical removal');
    if (await page.getByText('SMOKE-PENDING', { exact: true }).count()) throw new Error('counterparty update 404 left a stale row');

    const missingDeleteCard = page.locator('article').filter({ hasText: 'SMOKE-AMBIGUOUS' }).first();
    await missingDeleteCard.getByRole('button', { name: 'Удалить' }).click();
    await control({ removeId: await cardId(missingDeleteCard) });
    await missingDeleteCard.getByRole('group', { name: 'Подтверждение удаления' }).getByRole('button', { name: 'Удалить', exact: true }).click();
    await missingDeleteCard.waitFor({ state: 'detached', timeout: 15_000 });
    await expectText(page, 'Запись больше недоступна', 'counterparty delete 404 canonical removal');
    if (await page.getByText('SMOKE-AMBIGUOUS', { exact: true }).count()) throw new Error('counterparty delete 404 left a stale row');

    secondCard = page.locator('article').filter({ hasText: 'Second smoke canonical' }).first();
    await secondCard.getByRole('button', { name: 'Открыть историю' }).click();
    const lifecycleHistory = secondCard.getByRole('region', { name: 'История событий' });
    for (const event of Object.values(lifecycleEvents)) {
      await lifecycleHistory.getByText(event.messageType, { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
      if (await lifecycleHistory.getByText(event.messageType, { exact: true }).count() !== 1) throw new Error(`counterparty history did not dedupe ${event.messageType}`);
    }
    await control({ delays: { delete: [500] } });
    await secondCard.getByRole('button', { name: 'Удалить' }).click();
    const delayedDelete = secondCard.getByRole('group', { name: 'Подтверждение удаления' }).getByRole('button', { name: 'Удалить', exact: true });
    await delayedDelete.click();
    await wait(80);
    if (!await delayedDelete.isDisabled() || !await secondCard.isVisible()) throw new Error('counterparty delayed delete did not retain a busy canonical row');
    await expectText(page, 'Наблюдение удалено', 'counterparty delete');
    if (await page.getByText('Second smoke canonical', { exact: true }).count()) throw new Error('deleted counterparty remained in the DOM');
    await expectAlertCount(lifecycleEvents.eligibleOne.messageType, 0, 'counterparty delete hides prior eligible alert');
    await expectAlertCount(lifecycleEvents.eligibleTwo.messageType, 0, 'counterparty delete hides post-re-enable alert');
    const stateAfterLifecycleDelete = await (await page.request.get(`${backendUrl}/__smoke/state`)).json();
    if (stateAfterLifecycleDelete.counterpartyItems.some((item) => item.id === secondId)) throw new Error('counterparty soft delete left active watchlist membership');
    if (stateAfterLifecycleDelete.counterpartyAlerts.some((item) => item.watchlistEntryId === secondId)) throw new Error('counterparty soft delete left visible alerts');
    if (!stateAfterLifecycleDelete.counterpartyEvents[secondId] || stateAfterLifecycleDelete.counterpartyEvents[secondId].length !== 4) throw new Error('counterparty soft delete did not retain the audit event projection');
    if (stateAfterLifecycleDelete.counterpartyItems.some((item) => item.displayLabel === 'CREATE-400-SHOULD-NOT-EXIST')) throw new Error('rejected create mutation changed canonical state');
    const focusedAfterDelete = await page.evaluate(() => document.activeElement?.id || '');
    if (!focusedAfterDelete.startsWith('counterparty-') && focusedAfterDelete !== 'watchlist-heading') throw new Error(`counterparty delete focus target was ${focusedAfterDelete || 'empty'}`);
    for (const viewport of [{ width: 320, height: 568 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (overflow) {
        const diagnostics = await page.evaluate(() => ({
          document: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
          offenders: [...document.querySelectorAll('body *')].map((element) => {
            const rect = element.getBoundingClientRect();
            return { tag: element.tagName, className: String(element.className || ''), left: rect.left, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth };
          }).filter((item) => item.right > document.documentElement.clientWidth + 1 || item.left < -1).slice(0, 12),
        }));
        throw new Error(`counterparty route overflow at ${viewport.width}x${viewport.height}: ${JSON.stringify(diagnostics)}`);
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });

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

    await page.goto('/account/counterparties', { waitUntil: 'networkidle' });
    await control({ failures: { report: [401] } });
    await page.locator('article').filter({ hasText: 'PRIVATE-COUNTERPARTY-SMOKE' }).getByRole('button', { name: 'Открыть отчёт' }).click();
    await page.waitForURL((url) => url.pathname === '/login' && url.searchParams.get('returnUrl') === '/account/counterparties', { timeout: 15_000 });
    if (await page.getByText('PRIVATE-COUNTERPARTY-SMOKE', { exact: false }).count() || await page.getByText('Отчёт о проверке контрагента', { exact: false }).count()) {
      throw new Error('due-diligence report 401 left private data visible');
    }
    await page.getByLabel('Email').fill(ACCOUNT_SMOKE_USER.email);
    await page.getByLabel('Пароль').fill(ACCOUNT_SMOKE_USER.password);
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.waitForURL('**/account/counterparties', { timeout: 20_000 });
    await expectText(page, 'PRIVATE-COUNTERPARTY-SMOKE', 'counterparty owner A restored after canonical report 401 login');
    await page.getByRole('button', { name: 'Добавить контрагента' }).click();
    await page.getByLabel('Метка для себя (необязательно)').fill('OWNER-A-PRIVATE-DRAFT');
    await page.goto('/account', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Выйти' }).first().click();
    await page.waitForURL((url) => (
      url.pathname === '/login'
      && url.searchParams.get('returnUrl') === '/account'
    ), { timeout: 15_000 });
    const meAfterLogout = await page.request.get(`${backendUrl}/api/auth/me`);
    if (meAfterLogout.status() !== 401) throw new Error(`logout did not expire fixture session: /api/auth/me -> ${meAfterLogout.status()}`);
    await page.goBack();
    await page.waitForURL('**/login**', { timeout: 15_000 });
    await page.goto('/account/counterparties');
    await page.waitForURL((url) => url.pathname === '/login' && url.searchParams.get('returnUrl') === '/account/counterparties', { timeout: 15_000 });
    if (await page.getByText('PRIVATE-COUNTERPARTY-SMOKE', { exact: false }).count() || await page.getByText('OWNER-A-PRIVATE-DRAFT', { exact: false }).count()) {
      throw new Error('prior-owner counterparty state rendered after logout/back');
    }
    await page.getByLabel('Email').fill(ACCOUNT_SMOKE_SECOND_USER.email);
    await page.getByLabel('Пароль').fill(ACCOUNT_SMOKE_SECOND_USER.password);
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.waitForURL('**/account/counterparties', { timeout: 20_000 });
    await expectText(page, 'OWNER-B-COUNTERPARTY-SENTINEL', 'counterparty second owner session');
    if (await page.getByText('PRIVATE-COUNTERPARTY-SMOKE', { exact: false }).count() || await page.getByText('OWNER-A-PRIVATE-DRAFT', { exact: false }).count()) {
      throw new Error('owner A counterparty data or draft rendered for owner B');
    }
    const ownerAReportForOwnerB = await page.request.get(`${backendUrl}/api/counterparty-watchlist/${counterpartyWatchItem.id}/due-diligence-report`);
    if (ownerAReportForOwnerB.status() !== 404 || (await ownerAReportForOwnerB.body()).length !== 0) throw new Error('owner B could access owner A due-diligence report');
    const ownerALeasingForOwnerB = await page.request.get(`${backendUrl}/api/counterparty-watchlist/${counterpartyWatchItem.id}/leasing-signals?limit=10`);
    if (ownerALeasingForOwnerB.status() !== 404) throw new Error('owner B could access owner A leasing signals');
    const ownerBCard = page.locator('article').filter({ hasText: 'OWNER-B-COUNTERPARTY-SENTINEL' }).first();
    await ownerBCard.getByRole('button', { name: 'Открыть отчёт' }).click();
    const ownerBReport = page.getByRole('article', { name: 'Отчёт о проверке контрагента' });
    await ownerBReport.getByText('Второй синтетический владелец', { exact: true }).waitFor({ state: 'visible' });
    if (await ownerBReport.getByText(counterpartyDueDiligenceReport.organization.name, { exact: true }).count()) throw new Error('owner A report bytes rendered for owner B');
    await page.goto('/account');
    await page.getByRole('button', { name: 'Выйти' }).first().click();
    await page.waitForURL((url) => url.pathname === '/login' && url.searchParams.get('returnUrl') === '/account', { timeout: 15_000 });

    const backendRequests = await writeBrowserEvidence(consoleMessages, failedRequests, blockedExternalRequests);
    const requiredPaths = ['/api/auth/login','/api/auth/me','/api/auth/logout','/api/favorites/ids','/api/favorites','/api/voted-lots','/api/lotalerts','/api/counterparty-watchlist','/api/counterparty-watchlist/alerts','/api/ads','/api/ads/my','/api/chat/inbox','/api/chat/history','/api/chat/read','/api/chat/send'];
    for (const path of requiredPaths) {
      if (!backendRequests.some((request) => request.path === path)) throw new Error(`mock backend did not observe ${path}`);
    }
    if (!backendRequests.some((request) => request.path.endsWith('/leasing-signals') && request.statusCode === 200)) {
      throw new Error('mock backend did not observe owner-private counterparty leasing signal evidence');
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
    const reportEvidence = backendRequests.filter((request) => request.path.endsWith('/due-diligence-report'));
    for (const status of [200, 401, 404, 408, 500]) {
      if (!reportEvidence.some((request) => request.statusCode === status)) throw new Error(`mock backend did not record due-diligence report ${status} evidence`);
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
      && !(entry.includes('/_next/static/chunks/') && entry.includes('net::ERR_ABORTED'))
      && !(entry.includes('_rsc=') && entry.includes('net::ERR_ABORTED'))
      && !(entry.includes('/api/chat/read') && entry.includes('net::ERR_ABORTED') && backendRequests.some((request) => request.path === '/api/chat/read' && request.statusCode === 200))
      && !(entry.includes('/api/chat/send') && entry.includes('net::ERR_ABORTED') && backendRequests.some((request) => request.path === '/api/chat/send' && request.statusCode === 200))
      && !(entry.includes('/api/counterparty-watchlist') && backendRequests.some((request) => entry.includes(request.path) && request.statusCode === 0))
      && !(entry.includes('/api/counterparty-watchlist') && entry.includes('net::ERR_ABORTED') && backendRequests.some((request) => entry.includes(request.path) && request.statusCode >= 200 && request.statusCode < 300))
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
