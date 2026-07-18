'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  exportParserRun, getParserAttempts, getParserRun, getParserRuns, getParserTasks, ParserOperationsApiError,
  runParserAction, type ParserAction, type ParserAttemptPage, type ParserRun, type ParserTask,
} from '@/lib/api/parserOperations';
import {
  advanceParserOperationsOwner, canonicalParserRunFilters, captureParserOperationsOwner,
  createParserOperationsOwner, ownsParserOperationsCallback, parseParserRunFilters,
  parserPollDelay, parserPollingPausedMessage, parserStatusLabel,
} from '@/utils/parserOperations.logic.shared.mjs';
import styles from './parser-operations.module.css';

const makeKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const focusLater = (target: HTMLElement | null) => requestAnimationFrame(() => target?.focus());
const parserStatuses = ['pending','processing','done-found','done-no-data','invalid','ambiguous','retry-scheduled','captcha-blocked','rate-limited','source-unavailable','timeout','schema-changed','failed','canceled'];
const parserStatusIcons: Record<string, string> = { pending:'◌',processing:'◐','done-found':'✓','done-no-data':'∅',invalid:'!','ambiguous':'?','retry-scheduled':'↻','captcha-blocked':'⛔','rate-limited':'⏱','source-unavailable':'⛓',timeout:'⌛','schema-changed':'⚠',failed:'×',canceled:'—' };
const statusView = (status: string) => <><span aria-hidden="true">{parserStatusIcons[status] ?? '!'}</span> {parserStatusLabel(status)}</>;

export default function ParserOperationsClient() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!loading && !user?.isAdmin) router.replace('/'); }, [loading, router, user]);
  if (loading) return <main className={styles.shell} aria-busy="true">Проверка доступа…</main>;
  if (!user?.isAdmin) return null;
  return <ParserOperationsWorkbench key={user.id} />;
}

function ParserOperationsWorkbench() {
  const { user, setUser, loading: authLoading } = useAuth();
  const router = useRouter(); const searchParams = useSearchParams();
  const search = searchParams.toString();
  const parsed = useMemo(() => parseParserRunFilters(search), [search]);
  const runQuery = useMemo(() => canonicalParserRunFilters({
    status: parsed.filters.status, sourceFamily: parsed.filters.sourceFamily,
    createdFromUtc: parsed.filters.createdFromUtc, createdToUtc: parsed.filters.createdToUtc,
  }), [parsed.filters.createdFromUtc, parsed.filters.createdToUtc, parsed.filters.sourceFamily, parsed.filters.status]);
  const taskQuery = useMemo(() => new URLSearchParams(Object.entries({
    status: parsed.filters.taskStatus, source: parsed.filters.taskSource,
    retryability: parsed.filters.retryability, finding: parsed.filters.finding,
  }).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString(), [parsed.filters.finding, parsed.filters.retryability, parsed.filters.taskSource, parsed.filters.taskStatus]);
  const attemptQuery = useMemo(() => new URLSearchParams(Object.entries({
    status: parsed.filters.attemptStatus, retryable: parsed.filters.attemptRetryable,
  }).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString(), [parsed.filters.attemptRetryable, parsed.filters.attemptStatus]);
  const [runs, setRuns] = useState<ParserRun[]>([]); const [runCursor, setRunCursor] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ParserRun | null>(null); const [tasks, setTasks] = useState<ParserTask[]>([]);
  const [taskCursor, setTaskCursor] = useState<string | null>(null); const [attempts, setAttempts] = useState<ParserAttemptPage | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [pollReady, setPollReady] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'visible' && navigator.onLine);
  const [pollFailureCount, setPollFailureCount] = useState(0);
  const [pollCycle, setPollCycle] = useState(0);
  const owner = useRef(createParserOperationsOwner());
  const controllers = useRef(new Map<string, Set<AbortController>>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollInFlight = useRef<ReturnType<typeof captureParserOperationsOwner> | null>(null);
  const actionKeys = useRef(new Map<string, string>()); const objectUrls = useRef(new Set<string>());
  const dirtyEligibleRetirements = useRef(new Set<number>());
  const activeActionViews = useRef(new Map<number, number>());
  const liveRegion = useRef<HTMLDivElement>(null); const pendingFocus = useRef<HTMLElement | null>(null);
  const authorityRetired = useRef(false);
  const canonicalReloading = useRef(0); const navigationPending = useRef(false);

  const abortFamily = useCallback((family: string) => {
    for (const controller of controllers.current.get(family) ?? []) controller.abort();
    controllers.current.delete(family);
    if (family === 'poll' && timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);
  const abortAll = useCallback(() => {
    for (const family of controllers.current.values()) for (const controller of family) controller.abort();
    controllers.current.clear(); if (timer.current) clearTimeout(timer.current); timer.current = null;
    for (const url of objectUrls.current) URL.revokeObjectURL(url); objectUrls.current.clear();
  }, []);
  const retireView = useCallback((dirtyEligible = false) => {
    if (dirtyEligible && activeActionViews.current.has(owner.current.view)) dirtyEligibleRetirements.current.add(owner.current.view);
    owner.current = advanceParserOperationsOwner(owner.current, 'view');
    abortFamily('view'); abortFamily('poll'); abortFamily('attempt'); abortFamily('export'); pollInFlight.current = null;
  }, [abortFamily]);
  const authorityLost = useCallback((status: 401 | 403) => {
    if (authorityRetired.current) return;
    authorityRetired.current = true;
    owner.current = advanceParserOperationsOwner(owner.current, 'auth'); abortAll();
    const reauthToken = captureParserOperationsOwner(owner.current);
    actionKeys.current.clear(); dirtyEligibleRetirements.current.clear(); activeActionViews.current.clear(); pendingFocus.current = null; pollInFlight.current = null;
    setRuns([]); setRunCursor(null); setActiveRun(null); setTasks([]); setTaskCursor(null); setAttempts(null);
    setSelected(new Set()); setDirty(new Set()); setPollFailureCount(0); setBusy(false); setMessage(''); setError('');
    if (status === 401) { setUser(null); globalThis.location.replace('/login?returnUrl=/admin/parser-operations'); }
    else { void fetch(`${process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL}/api/auth/me`, { credentials: 'include', cache: 'no-store' }).finally(() => {
      if (!ownsParserOperationsCallback(owner.current, reauthToken, 'auth')) return;
      setUser(null); router.replace('/');
    }); }
  }, [abortAll, router, setUser]);

  const controlled = useCallback(async <T,>(family: 'view' | 'poll' | 'attempt' | 'export', operation: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    const token = captureParserOperationsOwner(owner.current); const controller = new AbortController();
    const familyControllers = controllers.current.get(family) ?? new Set<AbortController>(); familyControllers.add(controller); controllers.current.set(family, familyControllers);
    try { const result = await operation(controller.signal); return !controller.signal.aborted && ownsParserOperationsCallback(owner.current, token, family) ? result : null; }
    catch (cause) { if (!ownsParserOperationsCallback(owner.current, token, family) || controller.signal.aborted) return null; throw cause; }
    finally { familyControllers.delete(controller); if (familyControllers.size === 0) controllers.current.delete(family); }
  }, []);

  const loadRuns = useCallback(async (append = false, cursor?: string | null, family: 'view' | 'poll' = 'view') => {
    if (!parsed.ok) { setError('Некорректные фильтры в адресе.'); return null; }
    const query = [runQuery, cursor ? `cursor=${encodeURIComponent(cursor)}` : ''].filter(Boolean).join('&');
    const page = await controlled(family, (signal) => getParserRuns(query, signal, authorityLost));
    if (!page) return null;
    if (family !== 'poll') { setRuns((current) => append ? [...current, ...page.items] : page.items); setRunCursor(page.nextCursor); setError(''); }
    return page;
  }, [authorityLost, controlled, parsed.ok, runQuery]);

  const selectRun = useCallback(async (run: ParserRun) => {
    retireView(); const token = captureParserOperationsOwner(owner.current);
    setActiveRun(run); setTasks([]); setAttempts(null); setSelected(new Set()); setTaskCursor(null); setBusy(true); setError('');
    try { const page = await controlled('view', (signal) => getParserTasks(run.id, taskQuery, signal, authorityLost)); if (page) { setTasks(page.items); setTaskCursor(page.nextCursor); } }
    catch (cause) {
      if (cause instanceof ParserOperationsApiError && cause.status === 404) {
        navigationPending.current = true; retireView(); setRuns([]); setRunCursor(null); setSelected(new Set());
        setActiveRun(null); setTasks([]); setAttempts(null); setTaskCursor(null); setBusy(false);
        router.replace(`/admin/parser-operations${runQuery ? `?${runQuery}` : ''}`);
        setError('Запуск больше недоступен. Выбран безопасный список запусков.');
      } else setError('Не удалось загрузить задачи запуска.');
    } finally { if (ownsParserOperationsCallback(owner.current, token, 'view')) setBusy(false); }
  }, [authorityLost, controlled, retireView, router, runQuery, taskQuery]);

  const selectTask = useCallback(async (task: ParserTask) => {
    if (!activeRun) return; owner.current = advanceParserOperationsOwner(owner.current, 'attempt'); abortFamily('attempt'); setAttempts(null);
    try { const page = await controlled('attempt', (signal) => getParserAttempts(activeRun.id, task.id, attemptQuery, signal, authorityLost)); if (page) setAttempts(page); }
    catch { setError('Не удалось загрузить попытки задачи.'); }
  }, [abortFamily, activeRun, attemptQuery, authorityLost, controlled]);

  const reloadCanonicalView = useCallback(async (runId: string, clearPrivate = false, dirtyEligible = true, clearSelectionAtStart = true) => {
    const openTaskId = clearPrivate ? null : attempts?.taskId ?? null;
    canonicalReloading.current += 1; retireView(dirtyEligible); const token = captureParserOperationsOwner(owner.current);
    setBusy(true); if (clearSelectionAtStart) setSelected(new Set()); setAttempts(null); setTaskCursor(null); setMessage(''); setError('');
    if (clearPrivate) { setRuns([]); setRunCursor(null); setActiveRun(null); setTasks([]); }
    try {
      if (!parsed.ok) { setError('Некорректные фильтры в адресе.'); return false; }
      const page = await controlled('view', (signal) => getParserRuns(runQuery, signal, authorityLost)); if (!page) return false;
      let refreshed = page.items.find((run) => run.id === runId) ?? null;
      if (!refreshed) refreshed = await controlled('view', (signal) => getParserRun(runId, signal, authorityLost));
      if (!refreshed) return false;
      const detail = await controlled('view', (signal) => getParserTasks(refreshed!.id, taskQuery, signal, authorityLost));
      if (!detail || !ownsParserOperationsCallback(owner.current, token, 'view')) return false;
      let attemptPage: ParserAttemptPage | null = null;
      if (openTaskId && detail.items.some((task) => task.id === openTaskId)) {
        try { attemptPage = await controlled('view', (signal) => getParserAttempts(refreshed!.id, openTaskId, attemptQuery, signal, authorityLost)); }
        catch (cause) { if (!(cause instanceof ParserOperationsApiError) || cause.status !== 404) throw cause; }
      }
      if (!ownsParserOperationsCallback(owner.current, token, 'view')) return false;
      setRuns(page.items); setRunCursor(page.nextCursor); setActiveRun(refreshed); setTasks(detail.items);
      setTaskCursor(detail.nextCursor); setAttempts(attemptPage); setError('');
      return true;
    } catch (cause) {
      if (!(cause instanceof ParserOperationsApiError) || cause.status !== 404) {
        setError('Не удалось безопасно перечитать операции парсеров.');
        return false;
      }
      navigationPending.current = true; retireView(); setRuns([]); setRunCursor(null); setSelected(new Set());
      setActiveRun(null); setTasks([]); setAttempts(null); setTaskCursor(null); setBusy(false);
      router.replace(`/admin/parser-operations${runQuery ? `?${runQuery}` : ''}`);
      return false;
    } finally {
      canonicalReloading.current -= 1;
      if (ownsParserOperationsCallback(owner.current, token, 'view')) setBusy(false);
    }
  }, [attemptQuery, attempts?.taskId, authorityLost, controlled, parsed.ok, retireView, router, runQuery, taskQuery]);

  const toggle = useCallback((id: string) => {
    const next = new Set(selected); const wasEmpty = selected.size === 0;
    if (next.has(id)) next.delete(id); else next.add(id);
    if (wasEmpty && next.size > 0) { owner.current = advanceParserOperationsOwner(owner.current, 'poll'); abortFamily('poll'); }
    setSelected(next);
    if (!wasEmpty && next.size === 0 && activeRun) void reloadCanonicalView(activeRun.id, false, false);
  }, [abortFamily, activeRun, reloadCanonicalView, selected]);

  const act = useCallback(async (action: ParserAction, trigger: HTMLButtonElement) => {
    if (!activeRun || !confirm(`Выполнить действие «${action}» для выбранного запуска?`)) return;
    const runId = activeRun.id; const chosen = [...selected].sort(); const fingerprint = `${runId}|${action}|${chosen.join(',')}`;
    const key = actionKeys.current.get(fingerprint) ?? makeKey(); actionKeys.current.set(fingerprint, key);
    owner.current = advanceParserOperationsOwner(owner.current, 'action'); abortFamily('action');
    const token = captureParserOperationsOwner(owner.current); const controller = new AbortController();
    activeActionViews.current.set(token.view, (activeActionViews.current.get(token.view) ?? 0) + 1);
    const familyControllers = new Set([controller]); controllers.current.set('action', familyControllers);
    let restoreFocus: HTMLElement | null = null; let settledView = token.view;
    setBusy(true); setMessage(''); setError('');
    try {
      const result = await runParserAction(runId, action, chosen, key, controller.signal, authorityLost);
      if (!ownsParserOperationsCallback(owner.current, token, 'action')) return;
      if (owner.current.view !== token.view) {
        actionKeys.current.delete(fingerprint);
        if (dirtyEligibleRetirements.current.has(token.view)) setDirty((value) => new Set(value).add(runId));
        dirtyEligibleRetirements.current.delete(token.view);
        return;
      }
      const reloaded = await reloadCanonicalView(runId, false, false, false); settledView = owner.current.view;
      if (!reloaded || !ownsParserOperationsCallback(owner.current, token, 'action')) return;
      actionKeys.current.delete(fingerprint); setSelected(new Set());
      setMessage(`Действие выполнено. Изменено задач: ${result.affectedTaskCount}.`); restoreFocus = liveRegion.current;
    } catch (cause) {
      if (!ownsParserOperationsCallback(owner.current, token, 'action') || controller.signal.aborted) return;
      if (owner.current.view !== token.view) {
        if (cause instanceof ParserOperationsApiError) actionKeys.current.delete(fingerprint);
        dirtyEligibleRetirements.current.delete(token.view);
        return;
      }
      if (cause instanceof ParserOperationsApiError && cause.status === 409) { actionKeys.current.delete(fingerprint); setError('Состояние изменилось или выбор больше не допустим. Данные не менялись.'); restoreFocus = trigger; }
      else if (cause instanceof ParserOperationsApiError) {
        actionKeys.current.delete(fingerprint); const reloaded = await reloadCanonicalView(runId, true, false); settledView = owner.current.view;
        if (!reloaded) return;
        if (!ownsParserOperationsCallback(owner.current, token, 'action')) return;
        setError('Действие не выполнено. Выполнено безопасное перечитывание.'); restoreFocus = liveRegion.current;
      } else { setError('Транспортная ошибка. Выбор сохранён; повтор использует тот же ключ операции.'); restoreFocus = trigger; }
    } finally { const activeCount = activeActionViews.current.get(token.view) ?? 0; if (activeCount <= 1) activeActionViews.current.delete(token.view); else activeActionViews.current.set(token.view, activeCount - 1); dirtyEligibleRetirements.current.delete(token.view); familyControllers.delete(controller); if (controllers.current.get('action') === familyControllers) controllers.current.delete('action'); if (ownsParserOperationsCallback(owner.current, token, 'action') && owner.current.view === settledView) { pendingFocus.current = restoreFocus; setBusy(false); } }
  }, [abortFamily, activeRun, authorityLost, reloadCanonicalView, selected]);

  const download = useCallback(async (trigger: HTMLButtonElement) => {
    if (!activeRun) return; owner.current = advanceParserOperationsOwner(owner.current, 'export'); abortFamily('export'); setBusy(true);
    const token = captureParserOperationsOwner(owner.current);
    const restoreFocus: HTMLElement | null = trigger;
    try {
      const value = await controlled('export', (signal) => exportParserRun(activeRun.id, signal, authorityLost)); if (!value) return;
      const url = URL.createObjectURL(value.blob); objectUrls.current.add(url); try { const link = document.createElement('a'); link.href = url; link.download = value.filename; link.click(); } finally { URL.revokeObjectURL(url); objectUrls.current.delete(url); }
    } catch { setError('Не удалось сформировать безопасный экспорт.'); } finally { if (ownsParserOperationsCallback(owner.current, token, 'export')) { pendingFocus.current = restoreFocus; setBusy(false); } }
  }, [abortFamily, activeRun, authorityLost, controlled]);

  useEffect(() => { if (!busy && pendingFocus.current) { const target = pendingFocus.current; pendingFocus.current = null; focusLater(target); } }, [busy]);
  const clearForNavigation = useCallback((dirtyEligible = false) => {
    retireView(dirtyEligible); setRuns([]); setRunCursor(null); setSelected(new Set()); setActiveRun(null); setTasks([]); setAttempts(null); setTaskCursor(null); setBusy(false); setMessage(''); setError('');
  }, [retireView]);
  const navigate = useCallback((url: string) => { navigationPending.current = true; clearForNavigation(true); router.push(url); }, [clearForNavigation, router]);

  useEffect(() => () => { authorityRetired.current = true; owner.current = advanceParserOperationsOwner(owner.current, 'auth'); abortAll(); actionKeys.current.clear(); dirtyEligibleRetirements.current.clear(); activeActionViews.current.clear(); pendingFocus.current = null; }, [abortAll]);
  useEffect(() => {
    const update = () => setPollReady(document.visibilityState === 'visible' && navigator.onLine);
    document.addEventListener('visibilitychange', update); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { document.removeEventListener('visibilitychange', update); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    let start: ReturnType<typeof setTimeout> | null = null;
    if (!authLoading && user?.isAdmin) {
      start = setTimeout(() => {
        void (async () => {
          navigationPending.current = false; canonicalReloading.current += 1; clearForNavigation();
          try {
            const page = await loadRuns(); const selectedRunId = parsed.filters.runId;
            if (!page || !selectedRunId) return;
            let refreshed = page.items.find((run) => run.id === selectedRunId) ?? null;
            if (!refreshed) refreshed = await controlled('view', (signal) => getParserRun(selectedRunId, signal, authorityLost));
            if (refreshed) await selectRun(refreshed);
          } catch (cause) {
            if (cause instanceof ParserOperationsApiError && cause.status === 404) {
              navigationPending.current = true; clearForNavigation(); router.replace(`/admin/parser-operations${runQuery ? `?${runQuery}` : ''}`);
              setError('Выбранный запуск не найден; выбор очищен.');
            }
          } finally { canonicalReloading.current -= 1; }
        })();
      }, 0);
    }
    return () => { if (start) clearTimeout(start); navigationPending.current = true; retireView(); };
  }, [authLoading, authorityLost, clearForNavigation, controlled, loadRuns, parsed.filters.runId, retireView, router, runQuery, search, selectRun, user?.id, user?.isAdmin]);
  useEffect(() => {
    if (navigationPending.current || canonicalReloading.current > 0 || !parsed.ok || !parsed.filters.runId || activeRun?.id === parsed.filters.runId) return;
    const listed = runs.find((run) => run.id === parsed.filters.runId);
    if (listed) { let current = true; queueMicrotask(() => { if (current) void selectRun(listed); }); return () => { current = false; }; }
    void controlled('view', (signal) => getParserRun(parsed.filters.runId!, signal, authorityLost))
      .then((run) => { if (run) { setRuns((value) => value.some((item) => item.id === run.id) ? value : [run, ...value]); void selectRun(run); } })
      .catch((cause) => {
        if (cause instanceof ParserOperationsApiError && cause.status === 404) {
          navigationPending.current = true; clearForNavigation(); router.replace(`/admin/parser-operations${runQuery ? `?${runQuery}` : ''}`);
          setError('Выбранный запуск не найден; выбор очищен.');
        }
      });
  }, [activeRun?.id, authorityLost, clearForNavigation, controlled, parsed.filters.runId, parsed.ok, router, runQuery, runs, selectRun]);

  const pollCanonical = useCallback(async () => {
    const page = await loadRuns(false, null, 'poll'); if (!page || !activeRun) return;
    let refreshed = page.items.find((item) => item.id === activeRun.id) ?? null;
    if (!refreshed) {
      try { refreshed = await controlled('poll', (signal) => getParserRun(activeRun.id, signal, authorityLost)); }
      catch (cause) {
        if (cause instanceof ParserOperationsApiError && cause.status === 404) {
          navigationPending.current = true; clearForNavigation(); router.replace(`/admin/parser-operations${runQuery ? `?${runQuery}` : ''}`); return;
        }
        throw cause;
      }
    }
    if (!refreshed) return;
    const detail = await controlled('poll', (signal) => getParserTasks(refreshed!.id, taskQuery, signal, authorityLost));
    if (!detail) return;
    let attemptPage: ParserAttemptPage | null = null; const openTaskId = attempts?.taskId ?? null;
    if (openTaskId && detail.items.some((task) => task.id === openTaskId)) {
      try { attemptPage = await controlled('poll', (signal) => getParserAttempts(refreshed!.id, openTaskId, attemptQuery, signal, authorityLost)); }
      catch (cause) { if (!(cause instanceof ParserOperationsApiError) || cause.status !== 404) throw cause; }
    }
    setRuns(page.items); setRunCursor(page.nextCursor); setActiveRun(refreshed); setTasks(detail.items);
    setTaskCursor(detail.nextCursor); setAttempts(attemptPage); setPollFailureCount(0); setError('');
  }, [activeRun, attemptQuery, attempts?.taskId, authorityLost, clearForNavigation, controlled, loadRuns, router, runQuery, taskQuery]);

  useEffect(() => {
    const hasActiveRun = runs.some((run) => run.freshness !== 'terminal') || (activeRun !== null && activeRun.freshness !== 'terminal');
    if (!user?.isAdmin || selected.size || !pollReady || !hasActiveRun || pollInFlight.current !== null) return;
    timer.current = setTimeout(() => {
      if (pollInFlight.current !== null) return;
      owner.current = advanceParserOperationsOwner(owner.current, 'poll');
      const token = captureParserOperationsOwner(owner.current);
      pollInFlight.current = token;
      void pollCanonical()
        .catch(() => { if (ownsParserOperationsCallback(owner.current, token, 'poll')) { setPollFailureCount((count) => count + 1); setError('Автообновление временно недоступно; повтор выполняется с ограниченной задержкой.'); } })
        .finally(() => {
          const stillOwned = ownsParserOperationsCallback(owner.current, token, 'poll');
          if (pollInFlight.current === token) {
            pollInFlight.current = null;
            if (stillOwned) setPollCycle((value) => value + 1);
          }
        });
    }, parserPollDelay(pollFailureCount));
    return () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  }, [activeRun, pollCanonical, pollCycle, pollFailureCount, pollReady, runs, selected.size, user?.isAdmin]);

  return <main className={styles.shell}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Admin · redacted operator view</p><h1>Операции парсеров</h1><p>Live keyset-срез. Источник может измениться между страницами; это не исторический snapshot.</p></div><button onClick={() => { if (activeRun) void reloadCanonicalView(activeRun.id); else { clearForNavigation(); void loadRuns().catch(() => setError('Не удалось безопасно перечитать операции парсеров.')); } }}>Обновить</button></header>
    <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const query = canonicalParserRunFilters({ status: String(data.get('status') ?? ''), sourceFamily: String(data.get('sourceFamily') ?? ''), createdFromUtc: String(data.get('createdFromUtc') ?? ''), createdToUtc: String(data.get('createdToUtc') ?? '') }); navigate(`/admin/parser-operations${query ? `?${query}` : ''}`); }}>
      <label>Статус<select name="status" defaultValue={parsed.filters.status ?? ''}><option value="">Все</option>{parserStatuses.map((value) => <option key={value} value={value}>{parserStatusLabel(value)}</option>)}</select></label>
      <label>Источник<input name="sourceFamily" defaultValue={parsed.filters.sourceFamily ?? ''} pattern="[a-z0-9-]{1,32}" /></label>
      <label>Создан с (UTC)<input name="createdFromUtc" defaultValue={parsed.filters.createdFromUtc ?? ''} placeholder="2026-07-17T00:00:00Z" /></label>
      <label>Создан до (UTC)<input name="createdToUtc" defaultValue={parsed.filters.createdToUtc ?? ''} placeholder="2026-07-18T00:00:00Z" /></label><button type="submit">Применить</button>
    </form>
    <div ref={liveRegion} tabIndex={-1} role="status" aria-live="polite" className={styles.live}>{selected.size ? parserPollingPausedMessage : message}</div>{error && <p role="alert" className={styles.error}>{error}</p>}
    <section aria-label="Запуски" className={styles.grid}>{runs.map((run) => <button type="button" key={run.id} className={`${styles.runCard} ${activeRun?.id === run.id ? styles.active : ''}`} onClick={() => navigate(`/admin/parser-operations?${canonicalParserRunFilters({ ...parsed.filters, runId: run.id })}`)}>
      <span>{run.sourceFamily}</span><strong>{statusView(run.status)}</strong><span>{run.completedTasks}/{run.totalTasks} завершено</span><small>{new Date(run.updatedAtUtc).toLocaleString('ru-RU')} {dirty.has(run.id) ? '· изменён' : ''}</small>
    </button>)}</section>{runCursor && <button onClick={() => { clearForNavigation(true); void loadRuns(true, runCursor); }}>Следующая страница запусков</button>}
    {activeRun && <section className={styles.workspace}><div className={styles.actions}><h2>{activeRun.sourceFamily}: {parserStatusLabel(activeRun.status)}</h2>
      <button type="button" onClick={() => navigate(`/admin/parser-operations${runQuery ? `?${runQuery}` : ''}`)}>Очистить выбранный запуск</button>
      <button type="button" onClick={() => void reloadCanonicalView(activeRun.id)}>Обновить детали</button>
      <button disabled={busy || !activeRun.runAllowedActions.cancel} onClick={(event) => void act('cancel', event.currentTarget)}>Отменить</button><button disabled={busy || !activeRun.runAllowedActions.resume} onClick={(event) => void act('resume', event.currentTarget)}>Возобновить</button><button disabled={busy || !activeRun.runAllowedActions.retryFailed} onClick={(event) => void act('retry-failed', event.currentTarget)}>Повторить ошибки</button><button disabled={busy || selected.size === 0} onClick={(event) => void act('retry-selected', event.currentTarget)}>Повторить выбранные</button><button disabled={busy || !activeRun.runAllowedActions.export} onClick={(event) => void download(event.currentTarget)}>Скачать ZIP</button></div>
      {selected.size > 0 && <button type="button" onClick={() => void reloadCanonicalView(activeRun.id, false, false)}>Очистить выбранные строки</button>}
      <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); navigate(`/admin/parser-operations?${canonicalParserRunFilters({ ...parsed.filters, taskStatus: String(data.get('taskStatus') ?? ''), taskSource: String(data.get('taskSource') ?? ''), retryability: String(data.get('retryability') ?? ''), finding: String(data.get('finding') ?? '') })}`); }}>
        <label>Статус задач<select name="taskStatus" defaultValue={parsed.filters.taskStatus ?? ''}><option value="">Все</option>{parserStatuses.map((value) => <option key={value} value={value}>{parserStatusLabel(value)}</option>)}</select></label>
        <label>Источник задачи<input name="taskSource" defaultValue={parsed.filters.taskSource ?? ''} pattern="[a-z0-9-]{1,32}" /></label>
        <label>Повтор<select name="retryability" defaultValue={parsed.filters.retryability ?? ''}><option value="">Все</option><option value="retryable">Доступен</option><option value="non-retryable">Недоступен</option></select></label>
        <label>Результат<select name="finding" defaultValue={parsed.filters.finding ?? ''}><option value="">Все</option><option value="found">Найдено</option><option value="no-data">Нет данных</option><option value="not-applicable">Не применимо</option></select></label><button type="submit">Фильтровать задачи</button>
      </form>
      <div className={styles.tableWrap}><table><thead><tr><th scope="col">Выбор</th><th scope="col">Строка</th><th scope="col">Цель</th><th scope="col">Статус</th><th scope="col">Повторы</th><th scope="col">Свежесть</th></tr></thead><tbody>{tasks.map((task) => <tr key={task.id}><td><input aria-label={`Выбрать строку ${task.rowNumber}`} type="checkbox" checked={selected.has(task.id)} disabled={!task.taskAllowedActions.selectForRetry} onChange={() => toggle(task.id)} /></td><td><button className={styles.link} onClick={() => void selectTask(task)}>{task.rowNumber}</button></td><td>{task.inputDisplay}</td><td>{statusView(task.status)}<small>{task.diagnosticCode ? ` · ${task.diagnosticCode}` : ''}</small></td><td>{task.attemptCount}/{task.maxAttempts}</td><td>{task.freshness}</td></tr>)}</tbody></table></div>
      {taskCursor && <button onClick={async () => { if (!activeRun) return; retireView(true); setSelected(new Set()); const query = [taskQuery, `cursor=${encodeURIComponent(taskCursor)}`].filter(Boolean).join('&'); const page = await controlled('view', (signal) => getParserTasks(activeRun.id, query, signal, authorityLost)); if (page) { setTasks((value) => [...value, ...page.items]); setTaskCursor(page.nextCursor); } }}>Следующая страница задач</button>}
      {attempts && <aside className={styles.attempts}><h3>Попытки задачи</h3><p>Показана live-страница; данные между страницами могут измениться.</p>
        <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); navigate(`/admin/parser-operations?${canonicalParserRunFilters({ ...parsed.filters, attemptStatus: String(data.get('attemptStatus') ?? ''), attemptRetryable: String(data.get('attemptRetryable') ?? '') })}`); }}>
          <label>Статус попыток<select name="attemptStatus" defaultValue={parsed.filters.attemptStatus ?? ''}><option value="">Все</option>{parserStatuses.map((value) => <option key={value} value={value}>{parserStatusLabel(value)}</option>)}</select></label>
          <label>Повторяемость<select name="attemptRetryable" defaultValue={parsed.filters.attemptRetryable ?? ''}><option value="">Все</option><option value="true">Да</option><option value="false">Нет</option></select></label><button type="submit">Фильтровать попытки</button>
        </form>
        {attempts.items.length === 0 ? <p>Попыток нет.</p> : attempts.items.map((attempt) => <p key={attempt.id}><strong>#{attempt.attemptNumber}</strong> {statusView(attempt.status)} · {attempt.freshness}{attempt.diagnosticCode ? ` · ${attempt.diagnosticCode}` : ''}</p>)}
        {attempts.nextCursor && <button type="button" onClick={async () => { const base = [parsed.filters.attemptStatus ? `status=${encodeURIComponent(parsed.filters.attemptStatus)}` : '', parsed.filters.attemptRetryable ? `retryable=${parsed.filters.attemptRetryable}` : ''].filter(Boolean).join('&'); const query = [base, `cursor=${encodeURIComponent(attempts.nextCursor!)}`].filter(Boolean).join('&'); const page = await controlled('attempt', (signal) => getParserAttempts(attempts.runId, attempts.taskId, query, signal, authorityLost)); if (page) setAttempts((current) => current ? { ...page, items: [...current.items, ...page.items] } : page); }}>Следующая страница попыток</button>}
      </aside>}
    </section>}
    <footer className={styles.caveat}>Результаты скрывают payload, credentials, lease/fence и внутренние идентификаторы. «Данных нет» показывается только для подтверждённого <code>done-no-data</code>.</footer>
  </main>;
}
