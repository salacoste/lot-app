import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CASE_BATCH_LATER_PAGE_MASKED, CASE_BATCH_PRIVATE, CASE_BATCH_SMOKE_USER, caseBatchCsv,
} from './fixture-data.mjs';

const root = process.cwd();
const backendHost = process.env.CASE_BATCH_SMOKE_BACKEND_HOST || '127.0.0.1';
const backendPort = Number(process.env.CASE_BATCH_SMOKE_BACKEND_PORT || 4023);
const appHost = process.env.CASE_BATCH_SMOKE_APP_HOST || '127.0.0.1';
const appPort = Number(process.env.CASE_BATCH_SMOKE_APP_PORT || 3103);
const backendUrl = `http://${backendHost}:${backendPort}`;
const appUrl = `http://${appHost}:${appPort}`;
const artifacts = resolve(root, 'test-results/case-batch-smoke');
const loopback = new Set(['127.0.0.1', 'localhost']);

for (const [label, value] of [['backend host', backendHost], ['app host', appHost]]) {
  if (!loopback.has(value)) throw new Error(`${label} must be loopback, got ${value}`);
}

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

function spawnLogged(command, args, logName) {
  const log = createWriteStream(resolve(artifacts, logName), { flags: 'w' });
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, NEXT_PUBLIC_CSHARP_BACKEND_URL: backendUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  child.stdout.pipe(log); child.stderr.pipe(log);
  return child;
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, NEXT_PUBLIC_CSHARP_BACKEND_URL: backendUrl },
      stdio: 'inherit', shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)));
  });
}

async function waitFor(url, label, timeout = 60_000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeout) {
    try { const response = await fetch(url); if (response.ok) return; last = `${response.status}`; }
    catch (error) { last = error.message; }
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

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  return require('playwright');
}

function chromiumOptions() {
  const executablePath = process.env.CASE_BATCH_SMOKE_CHROMIUM_EXECUTABLE_PATH ||
    ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      .find((candidate) => existsSync(candidate));
  return executablePath ? { headless: true, executablePath } : { headless: true };
}

async function control(page, value) {
  const response = await page.request.post(`${backendUrl}/__case-batch-smoke/control`, { data: value });
  if (!response.ok()) throw new Error(`case-batch control failed ${response.status()}`);
}

async function assertFocused(locator, label) {
  await locator.waitFor({ state: 'visible' });
  for (let index = 0; index < 40; index += 1) {
    if (await locator.evaluate((element) => element === document.activeElement)) return;
    await wait(25);
  }
  throw new Error(`${label}: expected keyboard focus`);
}

async function focusByTab(page, locator, label) {
  await locator.waitFor({ state: 'visible' });
  for (let index = 0; index < 80; index += 1) {
    if (await locator.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${label}: keyboard Tab navigation did not reach the control`);
}

async function keyboardActivate(page, locator, label, key = 'Enter') {
  await focusByTab(page, locator, label);
  await assertFocused(locator, label);
  await page.keyboard.press(key);
}

async function assertLiveNotice(page, expected, label) {
  const live = page.locator('[aria-live="polite"]').first();
  await live.filter({ hasText: expected }).waitFor({ state: 'visible' });
  if ((await live.getAttribute('role')) !== 'status') throw new Error(`${label}: polite region must expose status role`);
}

async function storageText(page) {
  return page.evaluate(async () => {
    const cacheKeys = 'caches' in globalThis ? await caches.keys() : [];
    return JSON.stringify({
      localStorage: { ...localStorage }, sessionStorage: { ...sessionStorage },
      url: location.href, historyState: history.state, cacheKeys,
    });
  });
}

async function browserScenarios() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(chromiumOptions());
  const context = await browser.newContext({ baseURL: appUrl, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const consoleMessages = [];
  const blocked = [];
  page.on('console', (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!['http:', 'https:'].includes(url.protocol) || loopback.has(url.hostname)) return route.continue();
    blocked.push({ method: route.request().method(), host: url.hostname, resourceType: route.request().resourceType() });
    await route.abort('blockedbyclient');
  });

  try {
    // The authenticated shell may keep SignalR/background requests open; the route DOM is the readiness boundary.
    await page.goto('/login?returnUrl=/account/case-batches', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email').fill(CASE_BATCH_SMOKE_USER.email);
    await page.getByLabel('Пароль').fill(CASE_BATCH_SMOKE_USER.password);
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.waitForURL('**/account/case-batches', { timeout: 20_000 });
    try {
      await page.getByRole('heading', { name: /Пакетная проверка дел/iu }).waitFor({ state: 'visible' });
    } catch (error) {
      const body = (await page.locator('body').innerText()).slice(0, 800);
      throw new Error(`private route did not render at ${page.url()}; body=${body}; browser=${consoleMessages.join(' | ')}; ${error.message}`);
    }

    const preview = page.getByRole('button', { name: /Предварительная проверка/iu });
    await keyboardActivate(page, preview, 'empty-upload preview', 'Enter');
    const error = page.getByRole('alert').first();
    await error.waitFor({ state: 'visible' });
    await assertFocused(error, 'empty-upload error summary');

    await page.getByLabel(/CSV или XLSX файл/iu).setInputFiles({
      name: 'case-batch.csv', mimeType: 'text/csv', buffer: caseBatchCsv,
    });
    await keyboardActivate(page, preview, 'uploaded-file preview', 'Space');
    await assertLiveNotice(page, /Предварительная проверка завершена/iu, 'preview completion');
    await page.getByText('ИНН ••••••3893', { exact: true }).first().waitFor({ state: 'visible' });
    await page.getByText('Дело A40-••••••/2026', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText(/duplicate-target|Дубликат/iu).waitFor({ state: 'visible' });
    for (const value of [CASE_BATCH_PRIVATE.inn, CASE_BATCH_PRIVATE.caseNumber, CASE_BATCH_PRIVATE.label, CASE_BATCH_PRIVATE.token]) {
      if (await page.getByText(value, { exact: false }).count()) throw new Error('preview rendered a raw private value');
    }

    await keyboardActivate(page, page.getByRole('button', { name: /Подтвердить и запустить/iu }), 'confirm case batch', 'Enter');
    const live = page.locator('[aria-live="polite"]').first();
    await live.waitFor({ state: 'visible' });
    await assertLiveNotice(page, /Задание создано и поставлено в очередь/iu, 'confirmation');
    await page.getByText(/Завершено с ошибками/iu).first().waitFor({ state: 'visible', timeout: 20_000 });
    await page.getByText(/Проверены только сохранённые локальные данные/iu).first().waitFor({ state: 'visible' });
    await page.getByText(CASE_BATCH_LATER_PAGE_MASKED, { exact: true }).waitFor({ state: 'visible' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(/Завершено с ошибками/iu).first().waitFor({ state: 'visible' });

    await control(page, { status: 'processing', freeze: true, delayedDetailMs: 800 });
    await page.getByRole('button', { name: /Обновить/iu }).click();
    await wait(80);
    await keyboardActivate(page, page.getByRole('button', { name: /Отменить/iu }), 'cancel control', 'Space');
    await page.getByText(/Отменено/iu).first().waitFor({ state: 'visible' });
    await assertLiveNotice(page, /Команда принята\. Отменено/iu, 'cancel control');
    await wait(900);
    if (await page.getByText(/Выполняется/iu).count()) throw new Error('stale poll overwrote cancel response');

    await keyboardActivate(page, page.getByRole('button', { name: /Возобновить/iu }), 'resume control', 'Enter');
    await assertLiveNotice(page, /Команда принята\. Выполняется/iu, 'resume control');
    await control(page, { freeze: false });
    await page.getByText(/Завершено с ошибками/iu).first().waitFor({ state: 'visible', timeout: 20_000 });
    await keyboardActivate(page, page.getByRole('button', { name: /Повторить ошибки/iu }), 'retry-failed control', 'Space');
    await assertLiveNotice(page, /Команда принята\. Выполняется/iu, 'retry-failed control');

    for (const format of ['CSV', 'JSON']) {
      const downloadPromise = page.waitForEvent('download');
      await keyboardActivate(page, page.getByRole('button', { name: new RegExp(`Скачать ${format}`, 'iu') }), `${format} export`, format === 'CSV' ? 'Enter' : 'Space');
      const download = await downloadPromise;
      assertSafeDownloadName(download.suggestedFilename(), format);
      await assertLiveNotice(page, new RegExp(`Экспорт ${format} подготовлен`, 'iu'), `${format} export`);
    }

    for (const viewport of [{ width: 320, height: 800 }, { width: 768, height: 900 }, { width: 1440, height: 1000 }]) {
      await page.setViewportSize(viewport);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) throw new Error(`${viewport.width}px layout overflowed by ${overflow}px`);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!reduced) throw new Error('reduced-motion media preference was not active');

    const privateBrowserState = await storageText(page);
    const consoleText = consoleMessages.join('\n');
    for (const forbidden of Object.values(CASE_BATCH_PRIVATE)) {
      if (privateBrowserState.includes(forbidden)) throw new Error('private case-batch value entered URL/browser storage');
      if (consoleText.includes(forbidden)) throw new Error('private case-batch value entered browser console');
    }
    const analytics = await page.evaluate(() => ({
      script: Boolean(document.querySelector('script[src*="mc.yandex.ru"], #yandex-metrika')),
      privateHit: Array.isArray(globalThis.ym?.a) && globalThis.ym.a.some((args) => args[1] === 'hit' && String(args[2]).startsWith('/account')),
    }));
    if (analytics.script || analytics.privateHit) throw new Error('private workbench initialized analytics');
    await writeFile(resolve(artifacts, 'evidence.json'), JSON.stringify({ consoleCount: consoleMessages.length, blocked, privateScan: 'clean' }, null, 2));
  } finally {
    await browser.close();
  }
}

function assertSafeDownloadName(value, format) {
  if (!/^case-batch(?:-[0-9TZ-]+)?\.(?:csv|json)$/iu.test(value)) {
    throw new Error(`${format} export returned unsafe filename ${value}`);
  }
}

async function main() {
  await rm(artifacts, { recursive: true, force: true });
  await mkdir(artifacts, { recursive: true });
  const backend = spawnLogged(process.execPath, ['scripts/case-batch-smoke/mock-backend.mjs'], 'mock-backend.log');
  let app;
  try {
    await waitFor(`${backendUrl}/__case-batch-smoke/health`, 'case-batch mock', 15_000);
    if (process.env.CASE_BATCH_SMOKE_SKIP_BUILD !== '1') await run('npm', ['run', 'build']);
    app = spawnLogged('npm', ['run', 'start', '--', '-H', appHost, '-p', String(appPort)], 'next-start.log');
    await waitFor(`${appUrl}/login`, 'Next app');
    await browserScenarios();
    console.log('[case-batch-smoke] PASS');
  } finally {
    await terminate(app); await terminate(backend);
  }
}

main().catch((error) => {
  console.error(`[case-batch-smoke] FAIL ${error.stack || error.message}`);
  process.exit(1);
});
