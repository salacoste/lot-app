import assert from 'node:assert/strict'; import { spawn, spawnSync } from 'node:child_process'; import { createHash, randomUUID } from 'node:crypto'; import { createRequire } from 'node:module'; import { existsSync } from 'node:fs'; import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'; import { join, resolve } from 'node:path';
import { createLeasingMock, listenLeasingMock } from './mock-backend.mjs';
const appUrl = 'http://127.0.0.1:3115'; const route = '/account/leasing'; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const executablePath = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(existsSync);
async function ready(url) { for (let i = 0; i < 240; i += 1) { try { if ((await fetch(url)).status < 500) return; } catch {} await wait(250); } throw new Error('app-not-ready'); }
async function control(base, mode, privateCorpus = null) { const url = new URL('/__leasing/control', base); url.searchParams.set('mode', mode); if (privateCorpus) url.searchParams.set('privateCorpus', privateCorpus); const response = await fetch(url); assert.equal(response.status, 200); return response.json(); }
async function main() {
  const backend = createLeasingMock({ origin: appUrl }); const backendUrl = await listenLeasingMock(backend, 4025); let app;
  const privateCorpus = `LEASING_PRIVATE_CORPUS_${Date.now()}_${randomUUID()}`; const privateCorpusSha256 = createHash('sha256').update(privateCorpus).digest('hex');
  const artifactDir = resolve('.next/leasing-smoke-artifacts');
  const seedProof = await control(backendUrl, 'healthy', privateCorpus); assert.equal(seedProof.privateCorpusSeeded, true); assert.equal(seedProof.privateCorpusSha256, privateCorpusSha256); assert.equal(seedProof.privateAuditEventCount, 1);
  try {
    if (process.env.LEASING_SMOKE_SKIP_BUILD !== '1') await new Promise((resolve, reject) => { const p = spawn('npm', ['run', 'build'], { stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_CSHARP_BACKEND_URL: backendUrl } }); p.on('exit', (c) => c === 0 ? resolve() : reject(new Error(`build-${c}`))); });
    app = spawn('npm', ['run', 'start', '--', '-H', '127.0.0.1', '-p', '3115'], { stdio: 'inherit', env: { ...process.env, NEXT_PUBLIC_CSHARP_BACKEND_URL: backendUrl } }); await ready(`${appUrl}/login`); await rm(artifactDir, { recursive: true, force: true }); await mkdir(artifactDir, { recursive: true });
    const { chromium } = createRequire(import.meta.url)('playwright'); const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const results = []; const run = async (id, fn) => { await fn(); results.push(id); };
    try {
      await run('01', async () => { const anon = await browser.newPage(); await anon.goto(`${appUrl}${route}`); await anon.waitForURL('**/login?returnUrl=/account/leasing'); await anon.close(); });
      const context = await browser.newContext({ baseURL: appUrl, viewport: { width: 1440, height: 900 } }); await context.addCookies([{ name: 'leasing-owner', value: '1', url: backendUrl }]); const page = await context.newPage(); const blocked = new Set(); const consoleMessages = []; const failedRequests = []; const responseCaptures = []; const downloadArtifacts = []; page.on('console', (message) => consoleMessages.push(message.text())); page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`)); page.on('response', (response) => { if (!response.url().startsWith(backendUrl)) return; responseCaptures.push((async () => { const headers = response.headers(); let body = null; if (/json|text|csv/u.test(headers['content-type'] ?? '')) { try { body = await response.text(); } catch (error) { body = `[capture-failed:${error instanceof Error ? error.message : 'unknown'}]`; } } return { url: response.url(), status: response.status(), headers, body }; })()); }); await context.route('**/*', (r) => { const host = new URL(r.request().url()).hostname; if (['127.0.0.1', 'localhost'].includes(host)) return r.continue(); blocked.add(host); return r.abort(); });
      const load = async (mode) => { await control(backendUrl, mode); await page.goto(route); await page.getByRole('heading', { name: 'Лизинговая активность' }).waitFor(); await page.getByText('Загружаем сигналы…').waitFor({ state: 'hidden' }); };
      await run('02', async () => { await load('healthy'); await page.getByText('ООО Синтетический контур').waitFor(); const body = await page.locator('body').innerText(); assert.match(body, /Состояние источника: стабильно/u); for (const disclosure of ['Категория и релевантность', 'Извлечение', 'Актуально до', 'не является оценкой риска']) assert.match(body, new RegExp(disclosure, 'u')); });
      await run('03', async () => { await load('empty'); await page.getByRole('heading', { name: 'Сигналы не найдены' }).waitFor(); });
      await run('04', async () => { await load('degraded'); assert.match(await page.locator('body').innerText(), /есть ограничения|Устарело/u); });
      await run('05', async () => { await load('unknown'); assert.match(await page.locator('body').innerText(), /не определено/u); });
      await run('06', async () => { await load('low'); assert.match(await page.locator('body').innerText(), /Низкая|Неоднозначно/u); });
      await run('07', async () => { await control(backendUrl, 'healthy'); await page.goto(`${route}?limit=25&company=A%20B&to=2026-07-17&from=2026-04-19`); await page.getByText('ООО Синтетический контур').waitFor(); assert.equal(new URL(page.url()).search, '?from=2026-04-19&to=2026-07-17&company=A%20B'); let requests = await (await fetch(`${backendUrl}/__leasing/requests`)).json(); assert.equal(requests.filter((x) => x.path === '/api/leasing-intelligence').length, 1); await page.getByLabel('С даты').fill('2026-05-01'); await page.getByLabel('По дату').fill('2026-07-01'); await page.getByLabel('Компания').fill('Мульти А'); await page.getByLabel('Категория').selectOption('lifting'); await page.getByLabel('Надёжность').selectOption('low'); await page.getByLabel('Проверка').selectOption('needs-review'); await page.getByLabel('Актуальность').selectOption('stale'); await page.getByRole('button', { name: 'Применить' }).click(); await page.waitForURL(/company=%D0%9C%D1%83%D0%BB%D1%8C%D1%82%D0%B8%20%D0%90/u); const first = page.url(); assert.equal(new URL(first).search, '?from=2026-05-01&to=2026-07-01&company=%D0%9C%D1%83%D0%BB%D1%8C%D1%82%D0%B8%20%D0%90&category=lifting&confidence=low&reviewState=needs-review&sourceStatus=stale'); await page.getByLabel('Компания').fill('Мульти Б'); await page.getByRole('button', { name: 'Применить' }).click(); await page.waitForURL(/%D0%91/u); await page.goBack(); await page.waitForURL(first); assert.equal(await page.getByLabel('Компания').inputValue(), 'Мульти А'); await page.goForward(); await page.waitForURL(/%D0%91/u); assert.equal(await page.getByLabel('Компания').inputValue(), 'Мульти Б'); requests = await (await fetch(`${backendUrl}/__leasing/requests`)).json(); assert.ok(requests.filter((x) => x.path === '/api/leasing-intelligence').length >= 4, 'history navigation reloads authoritative filters'); });
      await run('08', async () => { await page.goto('about:blank'); await control(backendUrl, 'healthy'); await page.goto(`${appUrl}${route}?from=2026-01-01`); await page.getByText('Адрес содержит недопустимые фильтры. Исправьте их или сбросьте поиск.').waitFor(); let requests = await (await fetch(`${backendUrl}/__leasing/requests`)).json(); assert.equal(requests.filter((x) => x.path === '/api/leasing-intelligence').length, 0, 'invalid URL does not reach search API'); await page.getByRole('button', { name: 'Сбросить' }).click(); await page.getByText('ООО Синтетический контур').waitFor(); await page.getByLabel('Компания').fill('%_\\'); const hostileResponse = page.waitForResponse((response) => response.url().startsWith(`${backendUrl}/api/leasing-intelligence?`) && response.url().includes('company=%25_%5C')); await page.getByRole('button', { name: 'Применить' }).click(); await page.waitForURL(/company=%25_%5C/u); await hostileResponse; requests = await (await fetch(`${backendUrl}/__leasing/requests`)).json(); assert.ok(requests.some((x) => x.path === '/api/leasing-intelligence' && x.query.includes('company=%25_%5C'))); });
      await run('09', async () => { await load('paging'); await page.getByRole('heading', { name: 'ООО Страница 1', exact: true }).waitFor(); assert.match(await page.locator('body').innerText(), /1–25 из 26/u); await page.getByRole('button', { name: 'Далее' }).click(); await page.waitForURL(/offset=25/u); await page.getByRole('heading', { name: 'ООО Страница 26', exact: true }).waitFor(); assert.match(await page.locator('body').innerText(), /26–26 из 26/u); await page.getByRole('button', { name: 'Назад' }).click(); await page.getByRole('heading', { name: 'ООО Страница 1', exact: true }).waitFor(); });
      await run('10', async () => { await load('healthy'); await page.getByLabel('Компания').fill('Прежний фильтр'); await page.getByRole('button', { name: 'Применить' }).click(); await page.waitForURL(/company=/u); await page.getByText('ООО Синтетический контур').waitFor(); await control(backendUrl, 'delayed-default'); await page.getByRole('button', { name: 'Сбросить' }).click(); const exportButton = page.getByRole('button', { name: 'Скачать CSV' }); assert.ok(await exportButton.isDisabled(), 'export disabled while defaults are resolving'); await page.getByText('Загружаем сигналы…', { exact: true }).waitFor(); await wait(120); let requests = await (await fetch(`${backendUrl}/__leasing/requests`)).json(); assert.equal(requests.filter((x) => x.path.endsWith('/export')).length, 0, 'reset cannot export stale applied filters'); await page.getByText('ООО Синтетический контур').waitFor(); assert.ok(await exportButton.isEnabled()); await control(backendUrl, 'delayed-error'); await page.getByLabel('Компания').fill('Старый фильтр'); await page.getByRole('button', { name: 'Применить' }).click(); await wait(60); await page.getByLabel('Компания').fill('Новый фильтр'); await page.getByRole('button', { name: 'Применить' }).click(); await page.getByText('Новый фильтр').waitFor(); await wait(600); assert.equal(await page.getByText('Старый фильтр').count(), 0); assert.equal(await page.getByText('Данные лизинговой активности временно недоступны. Повторите попытку.').count(), 0, 'stale delayed error cannot replace current success'); let downloads = 0; page.on('download', () => { downloads += 1; }); await control(backendUrl, 'delay-export'); await exportButton.click(); await page.goto('/account'); await wait(700); assert.equal(downloads, 0, 'unmounted owner workspace suppresses stale export'); await page.goto(route); await page.getByText('ООО Синтетический контур').waitFor(); await control(backendUrl, 'delayed'); await page.getByLabel('Компания').fill('Старый владелец'); await page.getByRole('button', { name: 'Применить' }).click(); await wait(60); await page.getByRole('button', { name: 'Выйти' }).first().click(); await page.waitForURL('**/login**'); await wait(600); assert.equal(await page.getByText('Старый владелец').count(), 0, 'logout isolates delayed owner result'); await control(backendUrl, 'healthy'); await page.goto(route); await page.getByText('ООО Синтетический контур').waitFor(); });
      await run('11', async () => { await load('healthy'); const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Скачать CSV' }).click(); const download = await pending; assert.equal(download.suggestedFilename(), 'leasing-intelligence-20260717-100000Z.csv'); const path = await download.path(); assert.ok(path); const bytes = await readFile(path); const expected = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('"generated_at_utc","company_name"\r\n"2026-07-17T10:00:00.0000000Z","\'=FORMULA"\r\n')]); assert.deepEqual(bytes, expected, 'CSV bytes remain a frozen BOM/CRLF/formula-safe oracle'); const csvArtifactPath = join(artifactDir, download.suggestedFilename()); await writeFile(csvArtifactPath, bytes); downloadArtifacts.push({ filename: download.suggestedFilename(), path: csvArtifactPath, byteLength: bytes.length }); await control(backendUrl, 'large'); await page.getByRole('button', { name: 'Скачать CSV' }).click(); await page.getByText('Экспорт содержит больше 5000 строк. Уточните фильтры.').waitFor(); });
      await run('12', async () => { await control(backendUrl, 'error'); await page.reload(); await page.getByText('Данные лизинговой активности временно недоступны. Повторите попытку.').waitFor(); assert.ok(await page.getByRole('button', { name: 'Повторить' }).isVisible()); await control(backendUrl, 'invalid'); await page.reload(); await page.getByText('Проверьте фильтры и повторите поиск.').waitFor(); await control(backendUrl, 'unauthorized'); await page.reload(); await page.waitForURL('**/login?returnUrl=/account/leasing'); await control(backendUrl, 'healthy'); await page.goto(route); await page.getByText('ООО Синтетический контур').waitFor(); });
      await run('13', async () => { await control(backendUrl, 'delayed-default'); await page.goto(route); const loading = page.getByText('Загружаем сигналы…', { exact: true }); await loading.waitFor(); assert.equal(await loading.getAttribute('role'), 'status', 'loading state is announced through a live status role'); await loading.waitFor({ state: 'hidden' }); for (const width of [320, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)); } await page.getByLabel('Компания').focus(); let reachedApply = false; for (let index = 0; index < 12; index += 1) { await page.keyboard.press('Tab'); if ((await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Применить') { reachedApply = true; break; } } assert.ok(reachedApply, 'Apply keyboard reachable'); await control(backendUrl, 'error'); await page.reload(); const alert = page.locator('main [role="alert"]'); await alert.waitFor(); await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'alert'); assert.ok(await alert.evaluate((node) => node === document.activeElement), 'error receives focus'); });
      await run('14', async () => {
        await load('healthy');
        await page.evaluate(() => fetch('https://blocked.example/private').catch(() => null)); await wait(50); assert.ok(blocked.has('blocked.example'));
        const screenshotPath = join(artifactDir, 'leasing-dashboard.png'); const screenshot = await page.screenshot({ path: screenshotPath }); assert.ok(screenshot.length > 1000); assert.deepEqual([...screenshot.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const browserState = await page.evaluate(() => ({
          html: document.documentElement.outerHTML,
          bodyText: document.body.innerText,
          localStorage: Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, index) => { const key = window.localStorage.key(index) ?? ''; return [key, window.localStorage.getItem(key)]; })),
          sessionStorage: Object.fromEntries(Array.from({ length: window.sessionStorage.length }, (_, index) => { const key = window.sessionStorage.key(index) ?? ''; return [key, window.sessionStorage.getItem(key)]; })),
          documentCookie: document.cookie,
          analytics: { dataLayer: globalThis.dataLayer ?? null, ymType: typeof globalThis.ym, resourceUrls: performance.getEntriesByType('resource').map((entry) => entry.name) },
        }));
        const cookies = await context.cookies(); const backendRequests = await (await fetch(`${backendUrl}/__leasing/all-requests`)).json(); const responseLogs = (await Promise.allSettled(responseCaptures)).map((result) => result.status === 'fulfilled' ? result.value : { captureError: String(result.reason) });
        const privacySurface = { browserState, cookies, backendRequests, responseLogs, consoleMessages, failedRequests, blockedHosts: [...blocked], downloadArtifacts, results };
        const privacyLogPath = join(artifactDir, 'privacy-surface.json'); await writeFile(privacyLogPath, `${JSON.stringify(privacySurface, null, 2)}
`); await writeFile(join(artifactDir, 'private-seed-proof.json'), `${JSON.stringify({ seeded: seedProof.privateCorpusSeeded, sha256: seedProof.privateCorpusSha256, auditEvents: seedProof.privateAuditEventCount }, null, 2)}
`);
        const ocrBinary = join(artifactDir, 'screenshot-ocr'); const compileOcr = spawnSync('xcrun', ['clang', '-fobjc-arc', resolve('scripts/leasing-smoke/screenshot-ocr.m'), '-framework', 'Foundation', '-framework', 'Vision', '-framework', 'ImageIO', '-framework', 'CoreGraphics', '-o', ocrBinary], { encoding: 'utf8', timeout: 120_000 }); assert.equal(compileOcr.error, undefined, `Vision OCR compiler failed to launch: ${compileOcr.error?.message ?? ''}`); assert.equal(compileOcr.status, 0, `Vision OCR compilation failed closed: ${compileOcr.stderr}`); const ocr = spawnSync(ocrBinary, [screenshotPath], { encoding: 'utf8', timeout: 120_000 }); assert.equal(ocr.error, undefined, `Vision OCR failed to launch: ${ocr.error?.message ?? ''}`); assert.equal(ocr.status, 0, `Vision OCR failed closed: ${ocr.stderr}`); assert.ok(ocr.stdout.trim().length > 20, 'Vision OCR returned recognized dashboard text'); assert.equal(ocr.stdout.includes(privateCorpus), false, 'private corpus absent from screenshot OCR'); const ocrPath = join(artifactDir, 'leasing-dashboard.ocr.txt'); await writeFile(ocrPath, ocr.stdout);
        const artifactPaths = [privacyLogPath, join(artifactDir, 'private-seed-proof.json'), screenshotPath, ocrPath, ...downloadArtifacts.map((artifact) => artifact.path)]; for (const artifactPath of artifactPaths) { const bytes = await readFile(artifactPath); assert.equal(bytes.includes(Buffer.from(privateCorpus)), false, `private corpus leaked to persisted artifact ${artifactPath}`); }
        assert.equal(JSON.stringify(privacySurface).includes(privateCorpus), false, 'private corpus absent from captured client surfaces'); assert.doesNotMatch(`${browserState.html}
${browserState.bodyText}
${JSON.stringify(responseLogs)}`, /SourceRecordKey|InputContentHash|secret-private-corpus/u);
      });
      await run('15', async () => {
        await load('healthy');
        await page.getByLabel('Компания').fill('ООО Синтетический контур');
        await page.getByRole('button', { name: 'Применить' }).click();
        await page.getByText('ООО Синтетический контур').first().waitFor();
        await page.getByLabel('Название поиска').fill('Будущая техника');
        await page.getByRole('button', { name: 'Сохранить текущий результат' }).click();
        await page.getByText('Поиск сохранён. Уведомления выключены; включение действует только для будущих сигналов.').waitFor();
        await control(backendUrl, 'delayed-save');
        await page.getByLabel('Будущие уведомления').check();
        await page.getByRole('button', { name: 'Сохранить настройки' }).click();
        await wait(60);
        await page.getByLabel('Компания').fill('Ререндер родителя не прерывает мутацию');
        await page.getByText('Уведомления включены только для будущих сигналов.').waitFor();
        const rerenderRequests = await (await fetch(`${backendUrl}/__leasing/requests`)).json();
        assert.equal(rerenderRequests.filter((request) => request.method === 'PUT').length, 1, 'parent rerender does not abort or duplicate the active mutation');
        assert.equal(rerenderRequests.filter((request) => request.method === 'GET' && (request.path === '/api/leasing-intelligence/saved-searches' || request.path === '/api/leasing-intelligence/alerts' || request.path === '/api/counterparty-watchlist')).length, 0, 'parent rerender does not schedule an unsolicited child reload');
        page.once('dialog', (dialog) => dialog.accept());
        await page.getByRole('button', { name: 'Удалить' }).click();
        await page.getByText('Сохранённый поиск удалён. Ожидающие необработанные совпадения не будут восстановлены.').waitFor();
        assert.equal(await page.getByText('Будущая техника').count(), 0);
        const storyRequests = await (await fetch(`${backendUrl}/__leasing/all-requests`)).json();
        assert.ok(storyRequests.some((request) => request.method === 'POST' && request.path === '/api/leasing-intelligence/saved-searches'));
        assert.ok(storyRequests.some((request) => request.method === 'PUT' && request.path.includes('/saved-searches/')));
        assert.ok(storyRequests.some((request) => request.method === 'DELETE' && request.query === '?version=2'));
      });
      await run('16', async () => {
        await control(backendUrl, 'delete-paging-race');
        await page.goto(route);
        await page.getByText('DELETE-TARGET-1 — автокран тестовый', { exact: true }).waitFor();
        assert.equal(await page.getByText('KEEP-UNLOADED-30').count(), 0, 'unloaded retained alert starts beyond page one');
        await page.getByRole('button', { name: 'Показать ещё уведомления' }).click();
        await wait(60);
        const row = page.locator('input[value="Удаляемый поиск"]').locator('xpath=ancestor::form');
        page.once('dialog', (dialog) => dialog.accept());
        await row.getByRole('button', { name: 'Удалить' }).click();
        await page.getByText('Сохранённый поиск удалён. Ожидающие необработанные совпадения не будут восстановлены.').waitFor();
        await page.getByText('KEEP-UNLOADED-30').waitFor();
        await wait(550);
        assert.equal(await page.getByText(/DELETE-TARGET-/u).count(), 0, 'loaded and unloaded deleted-search alerts are erased');
        assert.equal(await page.getByRole('button', { name: 'Показать ещё уведомления' }).count(), 0, 'authoritative total/hasMore replace stale pagination');
        const storyRequests = await (await fetch(`${backendUrl}/__leasing/requests`)).json();
        const deleteIndex = storyRequests.findIndex((request) => request.method === 'DELETE');
        assert.ok(deleteIndex >= 0);
        const afterDelete = storyRequests.slice(deleteIndex + 1);
        assert.ok(afterDelete.some((request) => request.method === 'GET' && request.path === '/api/leasing-intelligence/saved-searches'));
        assert.ok(afterDelete.some((request) => request.method === 'GET' && request.path === '/api/leasing-intelligence/alerts' && request.query === '?offset=0&limit=25'));
      });
      for (const [id, mode] of [['17', 'delete-reload-failed'], ['18', 'delete-reload-stale']]) await run(id, async () => {
        await control(backendUrl, mode);
        await page.goto(route);
        await page.getByText('DELETE-TARGET-1 — автокран тестовый', { exact: true }).waitFor();
        const row = page.locator('input[value="Удаляемый поиск"]').locator('xpath=ancestor::form');
        const deleted = page.waitForResponse((response) => response.request().method() === 'DELETE' && response.status() === 204);
        page.once('dialog', (dialog) => dialog.accept());
        await row.getByRole('button', { name: 'Удалить' }).click();
        await deleted;
        await wait(75);
        assert.equal(await page.getByText(/DELETE-TARGET-/u).count(), 0, `${mode}: private alerts purge before reload completes`);
        assert.equal(await page.locator('input[value="Удаляемый поиск"]').count(), 0, `${mode}: saved search purges before reload completes`);
        await page.getByText('Не удалось обновить лизинговые уведомления. Повторите попытку.').waitFor();
        await wait(100);
        assert.equal(await page.getByText(/DELETE-TARGET-/u).count(), 0, `${mode}: delayed reload cannot resurrect private alerts`);
        assert.equal(await page.locator('input[value="Удаляемый поиск"]').count(), 0, `${mode}: delayed reload cannot resurrect saved search`);
      });
      assert.deepEqual(results, Array.from({ length: 18 }, (_, i) => String(i + 1).padStart(2, '0'))); await context.close();
    } finally { await browser.close(); }
    console.log('[leasing-smoke] PASS 18/18');
  } finally { if (app) app.kill('SIGTERM'); await new Promise((r) => backend.close(r)); }
}
main().catch((error) => { console.error(`[leasing-smoke] FAIL ${error.stack ?? error}`); process.exit(1); });
