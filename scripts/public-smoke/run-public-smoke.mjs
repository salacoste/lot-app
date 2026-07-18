import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd());
const backendUrl = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL;
const appHost = process.env.PUBLIC_SMOKE_APP_HOST || '127.0.0.1';
const appPort = Number(process.env.PUBLIC_SMOKE_APP_PORT || 3101);
const appBaseUrl = `http://${appHost}:${appPort}`;
const artifactsDir = resolve(repoRoot, 'test-results/public-smoke');
const loopbackHosts = new Set(['127.0.0.1', 'localhost']);
const allowedBlockedExternalHosts = new Set([
  'api-maps.yandex.ru',
  'mc.yandex.ru',
  'yandex.ru',
  'yastatic.net',
]);

function assertLoopbackUrl(value, label) {
  if (!value) {
    throw new Error(`${label} is required and must be loopback/local IPv4 or localhost for public smoke.`);
  }
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !loopbackHosts.has(url.hostname)) {
    throw new Error(`Refusing public smoke against non-loopback ${label}: ${value}`);
  }
}

function assertLoopbackBackendUrl(value) {
  assertLoopbackUrl(value, 'NEXT_PUBLIC_CSHARP_BACKEND_URL');
}

function assertLoopbackAppHost() {
  if (!loopbackHosts.has(appHost)) {
    throw new Error(`PUBLIC_SMOKE_APP_HOST must be loopback/local IPv4 or localhost for public smoke: ${appHost}`);
  }
}

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

async function collectBackendRequests() {
  try {
    return await (await fetch(`${backendUrl}/__smoke/requests`)).json();
  } catch (error) {
    return [{ method: 'SMOKE', path: '__evidence_collection_failed__', search: error.message, at: new Date().toISOString() }];
  }
}

async function writeBrowserEvidence(consoleMessages, failedRequests, blockedExternalRequests) {
  const backendRequests = await collectBackendRequests();
  await writeFile(resolve(artifactsDir, 'console.json'), JSON.stringify({
    consoleMessages,
    failedRequests,
    blockedExternalRequests,
    backendRequests,
  }, null, 2));
  return backendRequests;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    console.log(`[public-smoke] $ ${[command, ...args].join(' ')}`);
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, NEXT_PUBLIC_CSHARP_BACKEND_URL: backendUrl },
      stdio: 'inherit',
      shell: false,
      ...options,
    });
    child.on('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(' ')} failed with ${signal ?? code}`));
    });
    child.on('error', reject);
  });
}

function spawnLogged(command, args, logFile) {
  const log = createWriteStream(logFile, { flags: 'w' });
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, NEXT_PUBLIC_CSHARP_BACKEND_URL: backendUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
    } catch (error) {
      lastError = error.message;
    }
    await wait(500);
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [
    'playwright',
    process.env.PLAYWRIGHT_MODULE_PATH,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try next candidate
    }
  }
  throw new Error('Playwright module not found. Install project-local playwright/@playwright/test or provide PLAYWRIGHT_MODULE_PATH.');
}

function chromiumLaunchOptions() {
  const executablePath = process.env.PUBLIC_SMOKE_CHROMIUM_EXECUTABLE_PATH
    || [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Chromium-Gost.app/Contents/MacOS/Chromium-Gost',
    ].find((candidate) => existsSync(candidate));

  return executablePath ? { headless: true, executablePath } : { headless: true };
}

async function expectText(page, text, scenario) {
  const locator = page.getByText(text, { exact: false }).first();
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  console.log(`[public-smoke] ${scenario}: found text "${text}"`);
}

function expectedBackendStatus(request) {
  const isViewEventPath = /^\/api\/lots\/[^/]+\/view-events$/.test(request.path);
  if (isViewEventPath && request.method === 'POST') return request.statusCode === 200;
  if (isViewEventPath && request.method === 'OPTIONS') return request.statusCode === 204;
  if (request.path === '/api/auth/me') return request.method === 'GET' && request.statusCode === 401;
  if (request.path === '/api/counterparty-watchlist' || request.path === '/api/counterparty-watchlist/alerts') return request.method === 'GET' && request.statusCode === 401;
  if (
    request.path === '/__smoke/health'
    || request.path === '/__smoke/requests'
    || request.path === '/api/health/version'
    || request.path === '/api/lots/list'
    || request.path === '/api/lots/21001'
    || request.path === '/api/lots/21002'
    || request.path === '/api/lots/vehicle-filter-options'
    || request.path === '/api/lots/with-coordinates'
    || request.path === '/api/lots/sitemap-data'
    || request.path.endsWith('.svg')
    || request.path.endsWith('.pdf')
  ) {
    return request.method === 'GET' && request.statusCode === 200;
  }
  return false;
}

async function runBrowserScenarios() {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch(chromiumLaunchOptions());
  const context = await browser.newContext({ baseURL: appBaseUrl, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const consoleMessages = [];
  const failedRequests = [];
  const blockedExternalRequests = [];
  page.on('console', (msg) => consoleMessages.push(`${msg.type()}: ${msg.text()}`));
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));

  await context.route('**/*', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());

    if (!['http:', 'https:'].includes(requestUrl.protocol) || loopbackHosts.has(requestUrl.hostname)) {
      await route.continue();
      return;
    }

    blockedExternalRequests.push({
      method: request.method(),
      url: request.url(),
      host: requestUrl.hostname,
      resourceType: request.resourceType(),
    });

    const resourceType = request.resourceType();
    if (resourceType === 'script') {
      await route.fulfill({ status: 204, contentType: 'application/javascript', body: '' });
      return;
    }
    if (resourceType === 'stylesheet') {
      await route.fulfill({ status: 204, contentType: 'text/css', body: '' });
      return;
    }
    if (resourceType === 'image') {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
      });
      return;
    }
    if (['fetch', 'xhr'].includes(resourceType)) {
      await route.fulfill({ status: 204, contentType: 'application/json', body: '' });
      return;
    }

    await route.abort('blockedbyclient');
  });

  try {
    const assertNoDueDiligenceReportLeak = async (scenario) => {
      const body = await page.locator('body').innerText();
      for (const forbidden of ['Отчёт о проверке контрагента', 'due-diligence-report-v1', 'PRIVATE-REPORT-XSS']) {
        if (body.includes(forbidden)) throw new Error(`${scenario}: private due-diligence report content leaked into a public page`);
      }
    };
    await page.goto('/', { waitUntil: 'networkidle' });
    await expectText(page, 'Smoke Public Lot', 'home/list');
    await expectText(page, 'Smoke Passenger Car', 'home/list');
    await assertNoDueDiligenceReportLeak('home/list');

    await page.goto('/lot/smoke-public-lot-21001', { waitUntil: 'networkidle' });
    await expectText(page, 'Smoke Public Lot', 'lot detail');
    await expectText(page, 'Smoke public document.pdf', 'lot detail document');
    await expectText(page, 'Smoke teaser reasoning', 'lot AI reasoning teaser');
    await expectText(page, 'Это ознакомительный фрагмент', 'lot AI reasoning teaser policy');
    await expectText(page, '4 голосов', 'lot analysis vote count');
    const jsonLdCount = await page.locator('script[type="application/ld+json"]').count();
    if (jsonLdCount < 1) throw new Error('lot detail JSON-LD script not found');
    await assertNoDueDiligenceReportLeak('lot detail');

    await page.goto('/how-it-works/ai-assessment', { waitUntil: 'networkidle' });
    await expectText(page, 'AI-оценка и разбор лотов', 'AI assessment public info');
    await assertNoDueDiligenceReportLeak('AI assessment public info');

    await page.goto('/legkovye-avtomobili', { waitUntil: 'networkidle' });
    await expectText(page, 'Легковые автомобили с торгов', 'vehicle listing');
    await expectText(page, 'Smoke Passenger Car', 'vehicle listing');
    await expectText(page, 'Найдено лотов: 1', 'vehicle listing count');
    await assertNoDueDiligenceReportLeak('vehicle listing');

    await page.goto('/map', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Карта лотов с торгов по банкротству' }).waitFor({ state: 'attached', timeout: 15_000 });
    await page.screenshot({ path: resolve(artifactsDir, 'map-route-shell.png'), fullPage: true });
    const mapData = await page.request.get(`${backendUrl}/api/lots/with-coordinates?minLat=55&maxLat=56&minLon=37&maxLon=38`);
    if (!mapData.ok()) throw new Error(`map data request failed: ${mapData.status()}`);
    const mapBody = await mapData.json();
    if (mapBody.accessLevel !== 0 || !mapBody.lots?.some((lot) => lot.title === 'Smoke Public Lot — складской комплекс')) {
      throw new Error('map data fixture did not expose deterministic anonymous coordinate lot');
    }

    const sitemap = await page.request.get(`${appBaseUrl}/sitemap/0.xml`);
    if (!sitemap.ok()) throw new Error(`sitemap request failed: ${sitemap.status()}`);
    const sitemapBody = await sitemap.text();
    for (const expected of ['/legkovye-avtomobili', '/legkovye-avtomobili/toyota', '/lot/smoke-public-lot-21001']) {
      if (!sitemapBody.includes(expected)) throw new Error(`sitemap missing ${expected}`);
    }
    if (sitemapBody.includes('/account/counterparties') || sitemapBody.includes('PRIVATE-COUNTERPARTY-SMOKE')) {
      throw new Error('private counterparty route or sentinel leaked into sitemap');
    }
    const privateList = await page.request.get(`${backendUrl}/api/counterparty-watchlist`);
    const privateAlerts = await page.request.get(`${backendUrl}/api/counterparty-watchlist/alerts`);
    if (privateList.status() !== 401 || privateAlerts.status() !== 401) throw new Error('anonymous counterparty APIs did not fail closed');
    const privateHtmlResponse = await page.request.get(`${appBaseUrl}/account/counterparties`);
    const privateHtml = await privateHtmlResponse.text();
    if (['PRIVATE-COUNTERPARTY-SMOKE', 'Отчёт о проверке контрагента', 'due-diligence-report-v1', 'PRIVATE-REPORT-XSS'].some((value) => privateHtml.includes(value))) {
      throw new Error('private counterparty or due-diligence report content leaked into anonymous HTML');
    }
    await page.goto('/account/counterparties', { waitUntil: 'networkidle' });
    await page.waitForURL((url) => url.pathname === '/login' && url.searchParams.get('returnUrl') === '/account/counterparties', { timeout: 15_000 });

    const backendRequests = await writeBrowserEvidence(consoleMessages, failedRequests, blockedExternalRequests);
    if (backendRequests.some((request) => request.path.endsWith('/due-diligence-report'))) throw new Error('public browser issued a private due-diligence report request');
    const requiredBackendPaths = ['/api/health/version', '/api/lots/list', '/api/lots/21001', '/api/lots/vehicle-filter-options', '/api/lots/with-coordinates', '/api/lots/sitemap-data', '/api/counterparty-watchlist', '/api/counterparty-watchlist/alerts'];
    for (const path of requiredBackendPaths) {
      if (!backendRequests.some((request) => request.path === path)) {
        throw new Error(`mock backend did not observe ${path}`);
      }
    }
    if (!backendRequests.some((request) => (
      request.method === 'POST'
      && request.path === '/api/lots/21001/view-events'
      && request.statusCode === 200
    ))) {
      throw new Error('mock backend did not observe POST /api/lots/21001/view-events -> 200');
    }
    const unexpectedBackendRequests = backendRequests.filter((request) => !expectedBackendStatus(request));
    if (unexpectedBackendRequests.length > 0) {
      throw new Error(`mock backend observed unexpected path/status: ${unexpectedBackendRequests.map((request) => `${request.method} ${request.path}${request.search} -> ${request.statusCode}`).join('; ')}`);
    }

    const unexpectedFailedRequests = failedRequests.filter((entry) => (
      !entry.includes('favicon')
      && !(entry.includes('/_next/static/chunks/') && entry.includes('net::ERR_ABORTED'))
      && !(entry.includes('_rsc=') && entry.includes('net::ERR_ABORTED'))
    ));
    if (unexpectedFailedRequests.length > 0) {
      throw new Error(`unexpected failed browser requests: ${unexpectedFailedRequests.join('; ')}`);
    }

    const unexpectedExternalRequests = blockedExternalRequests.filter((request) => !allowedBlockedExternalHosts.has(request.host));
    if (unexpectedExternalRequests.length > 0) {
      throw new Error(`unexpected non-loopback browser requests were blocked: ${unexpectedExternalRequests.map((request) => request.url).join('; ')}`);
    }
    if (blockedExternalRequests.length > 0) {
      console.log(`[public-smoke] blocked ${blockedExternalRequests.length} non-loopback third-party request(s); see test-results/public-smoke/console.json`);
    }
  } catch (error) {
    await page.screenshot({ path: resolve(artifactsDir, 'failure.png'), fullPage: true }).catch(() => {});
    await writeBrowserEvidence(consoleMessages, failedRequests, blockedExternalRequests).catch(() => {});
    throw error;
  } finally {
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
  await Promise.race([
    waitForChildExit(child),
    wait(5_000).then(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }),
  ]);
}

async function main() {
  assertLoopbackBackendUrl(backendUrl);
  assertLoopbackAppHost();
  await rm(artifactsDir, { recursive: true, force: true });
  await mkdir(artifactsDir, { recursive: true });

  const mock = spawnLogged(process.execPath, ['scripts/public-smoke/mock-backend.mjs'], resolve(artifactsDir, 'mock-backend.log'));
  const app = { child: null };
  const cleanup = async () => {
    await terminateChild(app.child);
    await terminateChild(mock);
  };
  const handleSignal = () => {
    cleanup().finally(() => process.exit(130));
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  try {
    await waitFor(`${backendUrl}/__smoke/health`, 'mock backend', {
      timeoutMs: 15_000,
      isReady: async (res) => {
        if (!res.ok) return false;
        const body = await res.json().catch(() => null);
        return body?.ok === true;
      },
    });
    await runCommand('npm', ['run', 'build']);
    app.child = spawnLogged('npm', ['run', 'start', '--', '-H', appHost, '-p', String(appPort)], resolve(artifactsDir, 'next-start.log'));
    await waitFor(`${appBaseUrl}/`, 'Next app', { timeoutMs: 60_000 });
    await runBrowserScenarios();
    console.log('[public-smoke] PASS public browsing smoke scenarios completed. Artifacts: test-results/public-smoke');
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(`[public-smoke] FAIL ${error.stack || error.message}`);
  process.exit(1);
});
