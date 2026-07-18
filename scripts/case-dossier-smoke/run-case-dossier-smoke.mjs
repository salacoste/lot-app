import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { caseDossierIds } from './fixture-data.mjs';
import {
  CASE_DOSSIER_SCENARIO_IDS, caseDossierForeignCorpus, caseDossierScenarioBytes,
} from './scenario-fixtures.mjs';
import { createCaseDossierMockBackend, listenCaseDossierMock } from './mock-backend.mjs';

const root = process.cwd();
const appHost = process.env.CASE_DOSSIER_SMOKE_APP_HOST || '127.0.0.1';
const appPort = Number(process.env.CASE_DOSSIER_SMOKE_APP_PORT || 3114);
const backendPort = Number(process.env.CASE_DOSSIER_SMOKE_BACKEND_PORT || 4024);
const appUrl = `http://${appHost}:${appPort}`;
const artifacts = resolve(root, 'test-results/case-dossier-smoke');
const routeCaseId = caseDossierIds.ownerCase.replaceAll('-', '');
const routePath = `/account/cases/${routeCaseId}`;
const privateCorpus = Object.freeze([
  ...Object.values(caseDossierIds), routeCaseId, '7707083893', '1027700132195',
  'А40-1234/2026', 'Тестовая организация', ...caseDossierForeignCorpus,
]);

if (!['127.0.0.1', 'localhost'].includes(appHost)) throw new Error('case dossier app host must be loopback');

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const loadPlaywright = () => createRequire(import.meta.url)('playwright');

function chromiumOptions() {
  const executablePath = process.env.CASE_DOSSIER_SMOKE_CHROMIUM_EXECUTABLE_PATH ||
    ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      .find((candidate) => existsSync(candidate));
  return executablePath ? { headless: true, executablePath } : { headless: true };
}

function run(command, args, backendUrl) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root, env: { ...process.env, NEXT_PUBLIC_CSHARP_BACKEND_URL: backendUrl },
      stdio: 'inherit', shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
  });
}

function spawnLogged(command, args, logName, backendUrl) {
  const log = createWriteStream(resolve(artifacts, logName), { flags: 'w' });
  const child = spawn(command, args, {
    cwd: root, env: { ...process.env, NEXT_PUBLIC_CSHARP_BACKEND_URL: backendUrl },
    stdio: ['ignore', 'pipe', 'pipe'], shell: false,
  });
  child.stdout.pipe(log); child.stderr.pipe(log);
  return child;
}

async function waitFor(url, label, timeout = 60_000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = String(response.status);
    } catch (error) { last = error.message; }
    await wait(250);
  }
  throw new Error(`${label} not ready: ${last}`);
}

async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    wait(5_000).then(() => child.kill('SIGKILL')),
  ]);
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

async function control(backendUrl, scenarioId, variant = '') {
  const response = await fetch(`${backendUrl}/__case-dossier-smoke/control`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenarioId, variant }),
  });
  assert.equal(response.status, 200, `scenario ${scenarioId} control`);
}

async function resetRequests(backendUrl) {
  const response = await fetch(`${backendUrl}/__case-dossier-smoke/reset-requests`, { method: 'POST' });
  assert.equal(response.status, 200);
}

async function backendRequests(backendUrl) {
  const response = await fetch(`${backendUrl}/__case-dossier-smoke/requests`);
  assert.equal(response.status, 200);
  return response.json();
}

const countRequests = (rows, method, path) => rows.filter((row) => row.method === method && row.path === path).length;

async function dossierSection(page, heading) {
  return page.locator('section', { has: page.getByRole('heading', { name: heading }) });
}

async function waitForDossier(page) {
  await page.getByRole('heading', { name: 'А40-1234/2026' }).waitFor({ state: 'visible', timeout: 20_000 });
}

async function loadDossier(page, backendUrl, scenarioId, variant = '', { rejected = false } = {}) {
  await control(backendUrl, scenarioId, variant);
  await page.goto(routePath, { waitUntil: 'domcontentloaded' });
  if (rejected) {
    await page.locator('main [role="alert"]').waitFor({ state: 'visible', timeout: 20_000 });
    return;
  }
  await waitForDossier(page);
}

async function assertNoOverflow(page) {
  for (const viewport of [{ width: 320, height: 800 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${viewport.width}px overflow ${overflow}`);
  }
}

async function tabTo(page, name, key = 'Tab', maximum = 80) {
  for (let index = 0; index < maximum; index += 1) {
    await page.keyboard.press(key);
    const active = await page.evaluate(() => ({ text: document.activeElement?.textContent?.trim() ?? '',
      tag: document.activeElement?.tagName ?? '' }));
    if (active.tag === 'BUTTON' && active.text.includes(name)) return index + 1;
  }
  throw new Error(`keyboard control not reachable: ${name}`);
}

async function downloadBytes(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать JSON' }).click();
  const download = await pending;
  const path = await download.path();
  assert.ok(path, 'download path');
  return { bytes: await readFile(path), name: download.suggestedFilename() };
}

function scenarioRecorder() {
  const results = [];
  let current = null;
  return {
    async run(id, callback) {
      assert.ok(CASE_DOSSIER_SCENARIO_IDS.includes(id), `unknown scenario ${id}`);
      assert.ok(!results.some((item) => item.id === id), `duplicate scenario ${id}`);
      current = { id, status: 'RUNNING', assertionCount: 0, requestCount: 0 };
      results.push(current);
      const check = (condition, label) => { current.assertionCount += 1; assert.ok(condition, `scenario ${id}: ${label}`); };
      const equal = (actual, expected, label) => { current.assertionCount += 1; assert.deepEqual(actual, expected, `scenario ${id}: ${label}`); };
      await callback({ check, equal });
      current.status = 'PASS';
      current = null;
    },
    setRequestCount(count) { if (current) current.requestCount = count; },
    results,
  };
}

async function browserScenarios(backendUrl) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(chromiumOptions());
  const context = await browser.newContext({ baseURL: appUrl, viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'case-dossier-owner', value: '1', url: backendUrl }]);
  const page = await context.newPage();
  const consoleMessages = [];
  const failedRequests = [];
  const blockedHosts = new Set();
  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${new URL(request.url()).origin}`));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    blockedHosts.add(url.hostname);
    await route.abort('blockedbyclient');
  });
  await page.addInitScript(() => {
    globalThis.__caseDossierPrintCount = 0;
    globalThis.__caseDossierScriptExecuted = 0;
    globalThis.print = () => { globalThis.__caseDossierPrintCount += 1; };
  });

  const recorder = scenarioRecorder();
  const setCount = async () => recorder.setRequestCount((await backendRequests(backendUrl)).length);
  try {
    await recorder.run('01', async ({ check, equal }) => {
      await control(backendUrl, '01');
      const anonymous = await fetch(`${backendUrl}/api/case-dossiers/${caseDossierIds.ownerCase}`);
      equal(anonymous.status, 401, 'anonymous status'); equal(await anonymous.text(), '', 'anonymous empty body');
      const foreign = await fetch(`${backendUrl}/api/case-dossiers/${caseDossierIds.foreignCase}`, {
        headers: { cookie: 'case-dossier-owner=1' },
      });
      equal(foreign.status, 404, 'foreign status'); equal(await foreign.text(), '', 'foreign empty body');
      const anonymousContext = await browser.newContext({ baseURL: appUrl });
      try {
        const anonymousPage = await anonymousContext.newPage();
        await anonymousPage.goto(routePath, { waitUntil: 'domcontentloaded' });
        await anonymousPage.waitForURL('**/login?returnUrl=*', { timeout: 20_000 });
        const location = new URL(anonymousPage.url());
        equal(location.pathname, '/login', 'redirect target');
        equal(location.searchParams.get('returnUrl'), routePath, 'opaque return URL');
        check(!location.search.includes('7707083893'), 'redirect has no corpus');
      } finally { await anonymousContext.close(); }
      await setCount();
    });

    await recorder.run('02', async ({ check }) => {
      await loadDossier(page, backendUrl, '02');
      check(await page.getByText('Данные найдены', { exact: false }).first().isVisible(), 'found state visible');
      check(await page.getByText('Тестовая организация').isVisible(), 'subject visible');
      check(await page.getByRole('heading', { name: 'Судебное заседание' }).isVisible(), 'latest event visible');
      check((await page.locator('body').innerText()).includes('Достоверность:'), 'confidence visible');
      check((await page.locator('body').innerText()).includes('актуальность по времени наблюдения'), 'freshness visible');
      check(await page.getByRole('heading', { name: 'Что важно учитывать' }).isVisible(), 'caveats visible');
      await setCount();
    });

    await recorder.run('03', async ({ check }) => {
      await loadDossier(page, backendUrl, '03');
      const bankruptcy = await dossierSection(page, 'Федресурс и банкротство');
      const timeline = await dossierSection(page, 'Хронология дела');
      check((await bankruptcy.innerText()).includes('Подтверждённых данных нет'), 'bankruptcy no-data distinct');
      check((await timeline.innerText()).includes('Состояние пока не определено'), 'KAD unknown distinct');
      check(!(await timeline.innerText()).includes('Данные найдены'), 'no green KAD claim');
      await setCount();
    });

    await recorder.run('04', async ({ check }) => {
      await loadDossier(page, backendUrl, '04');
      const bankruptcy = await dossierSection(page, 'Федресурс и банкротство');
      const text = await bankruptcy.innerText();
      check(text.includes('Источник не ответил вовремя'), 'current timeout visible');
      check(text.includes('Ранее подтверждённые сведения'), 'prior evidence visible');
      check((await page.locator('body').innerText()).includes('Показаны сохранённые данные, требующие проверки актуальности'), 'stale root warning visible');
      await setCount();
    });

    await recorder.run('05', async ({ check }) => {
      await loadDossier(page, backendUrl, '05');
      const body = await page.locator('body').innerText();
      check(body.includes('Обнаружены противоречивые данные'), 'ambiguous root warning');
      check(body.includes('bankruptcy-authority-ambiguous'), 'authority warning');
      check(!body.includes('Подтверждённых данных нет'), 'no definitive negative');
      await setCount();
    });

    await recorder.run('06', async ({ check }) => {
      for (const [variant, copy] of [
        ['unavailable', 'Источник временно недоступен'], ['blocked', 'Источник ограничил доступ'],
        ['timeout', 'Источник не ответил вовремя'], ['schema', 'Формат источника изменился'],
      ]) {
        await loadDossier(page, backendUrl, '06', variant);
        check((await page.locator('body').innerText()).includes(copy), `${variant} state surfaced`);
      }
      await loadDossier(page, backendUrl, '06', 'http-500', { rejected: true });
      const errorText = await page.locator('main [role="alert"]').innerText();
      check(errorText.includes('Не удалось загрузить досье'), `500 retry surface: ${errorText}`);
      check(await page.getByRole('button', { name: 'Повторить' }).isVisible(), 'retry control');
      check(await page.locator('main [role="alert"]').evaluate((node) => node === document.activeElement), 'error focus');
      await setCount();
    });

    await recorder.run('07', async ({ check }) => {
      await loadDossier(page, backendUrl, '07');
      const bankruptcy = await dossierSection(page, 'Федресурс и банкротство');
      const timeline = await dossierSection(page, 'Хронология дела');
      check((await bankruptcy.innerText()).includes('Источник ограничил доступ'), 'bankruptcy warning retained');
      check((await timeline.innerText()).includes('Данные найдены'), 'timeline found retained');
      await setCount();
    });

    await recorder.run('08', async ({ check, equal }) => {
      await loadDossier(page, backendUrl, '08');
      const timeline = await dossierSection(page, 'Хронология дела');
      const items = timeline.locator('ol > li');
      equal(await items.count(), 100, '100 events rendered');
      check((await timeline.innerText()).includes('событий 100 из 101'), 'root event truncation count');
      check((await items.last().innerText()).includes('Событие 1'), 'latest event is canonical last event');
      equal(await items.locator('a').count(), 200, '200 allocated documents rendered');
      const focusable = await page.locator('a[href],button:not([disabled]),input:not([disabled])').count();
      check(focusable <= 300, `keyboard traversal bounded (${focusable})`);
      await setCount();
    });

    await recorder.run('09', async ({ check, equal }) => {
      await loadDossier(page, backendUrl, '09');
      await tabTo(page, 'Добавить наблюдение');
      await page.keyboard.press('Enter');
      await page.getByRole('status').filter({ hasText: 'Досье обновлено' }).waitFor({ state: 'visible' });
      const rows = await backendRequests(backendUrl);
      equal(countRequests(rows, 'POST', '/api/case-progress-watches'), 1, 'create exactly once');
      equal(countRequests(rows, 'GET', '/api/case-dossiers/[case]'), 2, 'one reload');
      check(await page.getByRole('button', { name: 'Отключить наблюдение' }).isVisible(), 'state changed');
      check(await page.getByRole('button', { name: 'Отключить наблюдение' })
        .evaluate((node) => node === document.activeElement), 'focus retained in watch controls');
      check((await page.getByRole('status').innerText()).includes('обновлено'), 'live announcement');
      recorder.setRequestCount(rows.length);
    });

    await recorder.run('10', async ({ check, equal }) => {
      await loadDossier(page, backendUrl, '10');
      await tabTo(page, 'Отключить наблюдение');
      await page.keyboard.press('Enter');
      await page.getByRole('status').filter({ hasText: 'Досье обновлено' }).waitFor({ state: 'visible' });
      const rows = await backendRequests(backendUrl);
      equal(countRequests(rows, 'PUT', '/api/case-progress-watches/[watch]'), 1, 'single stale PUT');
      equal(countRequests(rows, 'GET', '/api/case-dossiers/[case]'), 2, 'single conflict reload');
      check((await page.getByRole('status').innerText()).includes('обновлено'), 'conflict copy announced');
      check(await page.getByRole('button', { name: 'Отключить наблюдение' })
        .evaluate((node) => node === document.activeElement), 'conflict focus retained');
      recorder.setRequestCount(rows.length);
    });

    await recorder.run('11', async ({ check, equal }) => {
      await loadDossier(page, backendUrl, '11');
      await tabTo(page, 'Отключить наблюдение'); await page.keyboard.press('Space');
      await page.getByRole('button', { name: 'Включить наблюдение' }).waitFor({ state: 'visible' });
      check(await page.getByRole('button', { name: 'Включить наблюдение' })
        .evaluate((node) => node === document.activeElement), 'disable focus retained');
      await page.getByRole('button', { name: 'Включить наблюдение' }).focus(); await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Отключить наблюдение' }).waitFor({ state: 'visible' });
      check(await page.getByRole('button', { name: 'Отключить наблюдение' })
        .evaluate((node) => node === document.activeElement), 'enable focus retained');
      await page.getByRole('button', { name: 'Включить уведомления' }).focus(); await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Отключить уведомления' }).waitFor({ state: 'visible' });
      check(await page.getByRole('button', { name: 'Отключить уведомления' })
        .evaluate((node) => node === document.activeElement), 'opt-in focus retained');
      const rows = await backendRequests(backendUrl);
      equal(countRequests(rows, 'PUT', '/api/case-progress-watches/[watch]'), 3, 'three explicit updates');
      equal(countRequests(rows, 'GET', '/api/case-dossiers/[case]'), 4, 'one reload per update');
      check(await page.getByRole('button', { name: 'Отключить уведомления' }).isVisible(), 'opt-in state changed');
      recorder.setRequestCount(rows.length);
    });

    await recorder.run('12', async ({ check, equal }) => {
      await loadDossier(page, backendUrl, '12');
      const before = await backendRequests(backendUrl);
      const downloaded = await downloadBytes(page);
      equal(downloaded.bytes, caseDossierScenarioBytes('12'), 'exact response bytes');
      equal(downloaded.name, `case-dossier-${routeCaseId}.json`, 'safe opaque filename');
      const after = await backendRequests(backendUrl);
      equal(after.length, before.length, 'download has no request');
      check(downloaded.bytes.toString('utf8').startsWith('{"contractVersion"'), 'JSON MIME corpus');
      recorder.setRequestCount(after.length);
    });

    await recorder.run('13', async ({ check, equal }) => {
      await loadDossier(page, backendUrl, '13');
      await resetRequests(backendUrl);
      await page.getByRole('button', { name: 'Печать' }).click();
      equal(await page.evaluate(() => globalThis.__caseDossierPrintCount), 1, 'print once');
      equal((await backendRequests(backendUrl)).length, 0, 'print no network');
      check(await page.getByRole('heading', { name: 'Судебное заседание' }).isVisible(), 'loaded evidence present');
      await page.emulateMedia({ media: 'print' });
      const printState = await page.locator('button', { hasText: 'Печать' }).evaluate((node) => ({
        display: getComputedStyle(node).display, parentDisplay: getComputedStyle(node.parentElement).display,
        parentClass: node.parentElement.className,
      }));
      check(printState.display === 'none' || printState.parentDisplay === 'none', `controls hidden in print: ${JSON.stringify(printState)}`);
      await page.emulateMedia({ media: 'screen' });
      recorder.setRequestCount(0);
    });

    await recorder.run('14', async ({ check }) => {
      await loadDossier(page, backendUrl, '14', 'suppressed');
      check((await page.locator('body').innerText()).includes('Небезопасная ссылка источника скрыта'), 'suppression caveat');
      check((await page.locator('body').innerText()).includes('Ссылка источника недоступна'), 'suppressed reference copy');
      check(await page.getByRole('link', { name: /Открыть источник|Документ/u }).count() === 0, 'unsafe links non-clickable');
      for (const variant of ['unsafe-link', 'bidi']) {
        await loadDossier(page, backendUrl, '14', variant, { rejected: true });
        check(await page.locator('main [role="alert"]').isVisible(), `${variant} rejected before rendering`);
      }
      await loadDossier(page, backendUrl, '14', 'script');
      check(await page.getByText('<script>globalThis.__caseDossierScriptExecuted=1</script>', { exact: true }).isVisible(), 'script-shaped text rendered only as text');
      check(await page.evaluate(() => globalThis.__caseDossierScriptExecuted === 0), 'script inert');
      const clientSource = await readFile(resolve(root, 'app/account/cases/[caseId]/CaseDossierClient.tsx'), 'utf8');
      check(!clientSource.includes('dangerouslySetInnerHTML'), 'raw HTML API absent');
      await setCount();
    });

    await recorder.run('15', async ({ check }) => {
      await loadDossier(page, backendUrl, '15');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await assertNoOverflow(page);
      check(await page.locator('main').count() === 1, 'single main landmark');
      check(await page.getByRole('heading', { level: 1 }).count() === 1, 'single h1');
      check(await page.getByRole('button', { name: 'Скачать JSON' }).isVisible(), 'named download');
      check(await page.getByRole('status').count() >= 1, 'live region');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await setCount();
    });

    await recorder.run('16', async ({ check, equal }) => {
      await loadDossier(page, backendUrl, '16');
      const state = await page.evaluate(async () => ({
        href: location.href, html: document.documentElement.outerHTML,
        local: Object.keys(localStorage), session: Object.keys(sessionStorage),
        indexedDb: 'databases' in indexedDB ? (await indexedDB.databases()).map((item) => item.name) : [],
        caches: 'caches' in globalThis ? await caches.keys() : [],
        workers: 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).map((item) => item.scope) : [],
        analytics: Boolean(document.querySelector('script[src*="mc.yandex.ru"],#yandex-metrika')),
      }));
      equal(state.local, [], 'localStorage empty'); equal(state.session, [], 'sessionStorage empty');
      equal(state.indexedDb, [], 'IndexedDB empty'); equal(state.caches, [], 'Cache API empty');
      equal(state.workers, [], 'service workers absent'); check(!state.analytics, 'analytics absent');
      check(!state.href.includes('7707083893'), 'URL corpus-free');
      for (const forbidden of privateCorpus) {
        check(!consoleMessages.join('\n').includes(forbidden), 'console corpus-free');
        check(!failedRequests.join('\n').includes(forbidden), 'failed-request evidence corpus-free');
      }
      await setCount();
    });

    await recorder.run('17', async ({ check, equal }) => {
      await control(backendUrl, '17');
      await page.goto('/account/case-batches', { waitUntil: 'domcontentloaded' });
      const link = page.getByRole('link', { name: 'Открыть досье дела' });
      await link.waitFor({ state: 'visible', timeout: 20_000 });
      equal(await link.getAttribute('href'), routePath, 'exact safe opaque href');
      await link.click(); await page.waitForURL(`**${routePath}`); await waitForDossier(page);
      check(page.url().endsWith(routePath), 'entry point navigated');
      await setCount();
    });

    await recorder.run('18', async ({ equal }) => {
      await loadDossier(page, backendUrl, '18');
      await resetRequests(backendUrl);
      await downloadBytes(page);
      equal((await backendRequests(backendUrl)).length, 0, 'download zero delta');
      await resetRequests(backendUrl);
      await page.getByRole('button', { name: 'Печать' }).click();
      equal((await backendRequests(backendUrl)).length, 0, 'print zero delta');
      recorder.setRequestCount(0);
    });

    await recorder.run('19', async ({ check }) => {
      await loadDossier(page, backendUrl, '19');
      const bankruptcy = await dossierSection(page, 'Федресурс и банкротство');
      const text = await bankruptcy.innerText();
      check(text.includes('9'), 'full canonical evidence count visible');
      check(text.includes('8'), 'safe other-case aggregate visible');
      const surfaces = `${await page.locator('body').innerText()}\n${JSON.stringify(await backendRequests(backendUrl))}`;
      for (const forbidden of caseDossierForeignCorpus) check(!surfaces.includes(forbidden), 'foreign corpus absent');
      await setCount();
    });

    await recorder.run('20', async ({ check }) => {
      await loadDossier(page, backendUrl, '20');
      const download = await downloadBytes(page);
      check(download.bytes.includes(Buffer.from(caseDossierIds.account.replaceAll('-', ''))), 'account exists in authorized download');
      const prohibited = `${consoleMessages.join('\n')}\n${failedRequests.join('\n')}\n${JSON.stringify(await backendRequests(backendUrl))}`;
      check(!prohibited.includes(caseDossierIds.account), 'account absent from logs/evidence');
      check(!prohibited.includes(caseDossierIds.account.replaceAll('-', '')), 'opaque account absent from logs/evidence');
      await setCount();
    });

    await recorder.run('21', async ({ check, equal }) => {
      await loadDossier(page, backendUrl, '21');
      const body = await page.locator('body').innerText();
      check(body.includes('20 из 21 · список сокращён'), 'visible subject count');
      check(body.includes('проекций 20 из 21'), 'projection count');
      check(body.includes('Формат источника изменился'), 'omitted severe state drives root');
      equal(await page.locator('section', { has: page.getByRole('heading', { name: 'Участники' }) }).locator('article').count(), 20, '20 aligned subjects');
      await setCount();
    });

    await recorder.run('22', async ({ check, equal }) => {
      await loadDossier(page, backendUrl, '22');
      const issues = (await dossierSection(page, 'Ограничения источников')).locator('li');
      equal(await issues.count(), 40, 'issue cap exact');
      check((await issues.allInnerTexts()).some((value) => value.includes('local: Состояние пока не определено (not-collected-locally)')), 'timeline issue survives pressure');
      const caveatItems = (await dossierSection(page, 'Что важно учитывать')).locator('ul').first().locator('li');
      check((await caveatItems.nth(0).innerText()).includes('юридическую консультацию'), 'caveat order starts legal');
      const actionItems = (await dossierSection(page, 'Что важно учитывать')).locator('ul').nth(1).locator('li');
      equal(await actionItems.allInnerTexts(), ['Скачать JSON', 'Печать', 'Добавить наблюдение'], 'action order unchanged');
      await setCount();
    });

    await recorder.run('23', async ({ check, equal }) => {
      await loadDossier(page, backendUrl, '23', 'positive');
      const expected = [
        'https://fedresurs.ru/bankruptmessages/message-1',
        'https://kad.arbitr.ru/Card/case-1/document-2',
        'https://kad.arbitr.ru/Card/case-1', 'https://kad.arbitr.ru/Document/document-2',
      ];
      const links = page.locator('a[target="_blank"]');
      equal(await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href'))), expected, 'canonical href bytes unchanged');
      check(await links.evaluateAll((nodes) => nodes.every((node) =>
        node.getAttribute('referrerpolicy') === 'no-referrer' &&
        ['noopener', 'noreferrer'].every((token) => node.getAttribute('rel')?.split(/\s+/u).includes(token)))),
      'external link privacy attributes');
      const negatives = [
        'https://FEDRESURS.RU/bankruptmessages/x', 'HTTPS://fedresurs.ru/bankruptmessages/x',
        'https://fedresurs.ru:443/bankruptmessages/x', 'https://fedresurs.ru/bankruptmessages/%78',
        'https://fedresurs.ru/bankruptmessages/x?y=1', 'https://fedresurs.ru/bankruptmessages/x#y',
        'https://sub.fedresurs.ru/bankruptmessages/x', 'https://kad.arbitr.ru/Other/x',
      ];
      for (const value of negatives) {
        await loadDossier(page, backendUrl, '23', value, { rejected: true });
        check(await page.locator('main [role="alert"]').isVisible(), 'reference negative rejected');
      }
      await setCount();
    });

    await recorder.run('24', async ({ check }) => {
      await loadDossier(page, backendUrl, '24', 'not-collected');
      check((await page.locator('body').innerText()).includes('Состояние пока не определено'), 'no-current unknown valid');
      for (const state of ['found', 'no-data', 'stale', 'ambiguous', 'unavailable', 'blocked-rate-limited', 'timeout', 'schema-changed']) {
        await loadDossier(page, backendUrl, '24', state);
        check(await page.getByRole('heading', { name: 'Федресурс и банкротство' }).isVisible(), `Current ${state} renders`);
      }
      await loadDossier(page, backendUrl, '24', 'unknown', { rejected: true });
      check(await page.locator('main [role="alert"]').isVisible(), 'collected unknown rejected before state UI');
      await setCount();
    });

    await recorder.run('25', async ({ check, equal }) => {
      await loadDossier(page, backendUrl, '25');
      const body = await page.locator('body').innerText();
      check(body.includes('Данные найдены'), 'visible found drives root');
      check(body.includes('20 из 24 · список сокращён'), 'visible and omitted counts');
      const issues = (await dossierSection(page, 'Ограничения источников')).locator('li');
      equal(await issues.count(), 4, 'four aggregate warnings visible');
      equal((await issues.allInnerTexts()).map((value) => value.match(/\(([^)]+)\)/u)?.[1]),
        ['omitted-subject-schema-changed', 'omitted-subject-blocked-rate-limited',
          'omitted-subject-timeout', 'omitted-subject-unavailable'], 'canonical warning order');
      check(body.includes('Один или несколько источников вернули неполный результат.'), 'partial caveat');
      check(body.includes('Часть данных не показана из-за ограничения размера ответа.'), 'truncation caveat');
      const allSurfaces = `${await page.locator('body').innerText()}\n${JSON.stringify(await backendRequests(backendUrl))}`;
      for (const forbidden of caseDossierForeignCorpus) check(!allSurfaces.includes(forbidden), 'omitted identity absent');
      await setCount();
    });

    equalScenarioCoverage(recorder.results);
    return {
      result: 'PASS', scenarioCount: recorder.results.length,
      scenarios: recorder.results.map(({ id, status, assertionCount, requestCount }) => ({ id, status, assertionCount, requestCount })),
    };
  } catch (error) {
    const active = recorder.results.find((item) => item.status === 'RUNNING');
    if (active) active.status = 'FAIL';
    await writeEvidence({
      result: 'FAIL', scenarioCount: recorder.results.length,
      scenarios: recorder.results.map(({ id, status, assertionCount, requestCount }) => ({ id, status, assertionCount, requestCount })),
    });
    throw error;
  } finally { await browser.close(); }
}

function equalScenarioCoverage(results) {
  assert.deepEqual(results.map((item) => item.id), CASE_DOSSIER_SCENARIO_IDS, 'all 25 scenario IDs must execute in order');
  assert.ok(results.every((item) => item.status === 'PASS'), 'every scenario must pass');
}

async function writeEvidence(value) {
  const serialized = JSON.stringify(value, null, 2);
  for (const forbidden of privateCorpus) assert.ok(!serialized.includes(forbidden), 'sanitized evidence');
  await writeFile(resolve(artifacts, 'evidence.json'), serialized);
}

async function main() {
  await rm(artifacts, { recursive: true, force: true });
  await mkdir(artifacts, { recursive: true });
  const backend = createCaseDossierMockBackend({ appOrigin: appUrl });
  let app;
  try {
    const backendUrl = await listenCaseDossierMock(backend, backendPort);
    if (process.env.CASE_DOSSIER_SMOKE_SKIP_BUILD !== '1') await run('npm', ['run', 'build'], backendUrl);
    app = spawnLogged('npm', ['run', 'start', '--', '-H', appHost, '-p', String(appPort)], 'next-start.log', backendUrl);
    await waitFor(`${appUrl}/login`, 'Next app');
    const evidence = await browserScenarios(backendUrl);
    await writeEvidence(evidence);
    console.log(`[case-dossier-smoke] PASS ${evidence.scenarioCount}/25`);
  } finally {
    await terminate(app);
    await closeServer(backend);
  }
}

main().catch((error) => {
  console.error(`[case-dossier-smoke] FAIL ${error.stack || error.message}`);
  process.exit(1);
});
