'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  CaseBatchApiError, type CaseBatchItem, type CaseBatchJob, type CaseBatchPreview,
  cancel, confirmCaseBatch, exportCaseBatch, getCaseBatch, getCaseBatchItems,
  listCaseBatches, previewCaseBatch, resume, retryFailed,
} from '@/lib/api/caseBatches';
import styles from './case-batches.module.css';

type RunLatest = <T>(region: string, task: (signal: AbortSignal) => Promise<T>) => Promise<T | undefined>;

const POLL_DELAY_MS = 1_000;
const TERMINAL_STATUSES = new Set(['completed', 'completed-with-failures', 'failed', 'canceled', 'cancelled']);
const CASE_DOSSIER_ROUTE_PREFIX = '/account/cases/';

function idempotencyKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `case-batch-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function statusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case 'queued': return 'В очереди';
    case 'processing': case 'running': return 'Выполняется';
    case 'completed': return 'Завершено';
    case 'completed-with-failures': return 'Завершено с ошибками';
    case 'failed': return 'Ошибка выполнения';
    case 'canceled': case 'cancelled': return 'Отменено';
    default: return 'Статус обновляется';
  }
}

function safeError(error: unknown): string {
  if (error instanceof CaseBatchApiError) {
    if (error.status === 400) return 'Файл не прошёл проверку формата. Исправьте его и повторите.';
    if (error.status === 401) return 'Сессия завершена. Войдите снова.';
    if (error.status === 409) return 'Предварительная проверка устарела. Запустите её повторно.';
    if (error.status === 413) return 'Файл слишком большой.';
    if (error.status === 404) return 'Задание больше недоступно. Обновите список.';
  }
  return 'Не удалось выполнить запрос. Повторите попытку.';
}

function focusLater(element: HTMLElement | null) {
  if (element) requestAnimationFrame(() => element.focus());
}

function previewDisplay(row: CaseBatchPreview['rows'][number]): string {
  return row.maskedDisplay ?? row.maskedTarget ?? 'Значение скрыто';
}

function previewClass(row: CaseBatchPreview['rows'][number]): string {
  const value = row.classification ?? row.status ?? 'unknown';
  if (value === 'duplicate') return 'Пропущено';
  if (value === 'would-check' || value === 'valid') return 'Будет проверено';
  if (value === 'invalid') return 'Ошибка';
  return value;
}

function caseDossierRoute(value: string | null | undefined): string | null {
  if (!value?.startsWith(CASE_DOSSIER_ROUTE_PREFIX)) return null;
  return /^[0-9a-f]{32}$/u.test(value.slice(CASE_DOSSIER_ROUTE_PREFIX.length)) ? value : null;
}

export default function CaseBatchWorkbenchClient() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const sessionKey = user?.id ?? user?.email ?? '';

  useEffect(() => {
    if (!loading && !sessionKey) router.replace('/login?returnUrl=/account/case-batches');
  }, [loading, router, sessionKey]);

  if (loading || !sessionKey) {
    return <main className={styles.container}><p role="status">Проверяем сессию…</p></main>;
  }
  return <OwnerWorkbench key={sessionKey} />;
}

function OwnerWorkbench() {
  const router = useRouter();
  const controllers = useRef(new Map<string, AbortController>());
  const requestVersions = useRef(new Map<string, number>());
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const keyRef = useRef('');
  const fileRef = useRef<File | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CaseBatchPreview | null>(null);
  const [jobs, setJobs] = useState<CaseBatchJob[]>([]);
  const [selected, setSelected] = useState<CaseBatchJob | null>(null);
  const [items, setItems] = useState<CaseBatchItem[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => { fileRef.current = file; }, [file]);
  useEffect(() => { selectedIdRef.current = selected?.id ?? null; }, [selected]);
  useEffect(() => { if (error) focusLater(errorSummary.current); }, [error]);

  const abortRegion = useCallback((region: string) => {
    controllers.current.get(region)?.abort();
    controllers.current.delete(region);
    requestVersions.current.set(region, (requestVersions.current.get(region) ?? 0) + 1);
  }, []);

  const abortAll = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    for (const region of requestVersions.current.keys()) {
      requestVersions.current.set(region, (requestVersions.current.get(region) ?? 0) + 1);
    }
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  const runLatest = useCallback<RunLatest>(async (region, task) => {
    controllers.current.get(region)?.abort();
    const controller = new AbortController();
    const requestVersion = (requestVersions.current.get(region) ?? 0) + 1;
    requestVersions.current.set(region, requestVersion);
    controllers.current.set(region, controller);
    const currentRequest = () => !controller.signal.aborted &&
      controllers.current.get(region) === controller && requestVersions.current.get(region) === requestVersion;
    try {
      const value = await task(controller.signal);
      return currentRequest() ? value : undefined;
    } catch (requestError) {
      if (!currentRequest() || requestError instanceof DOMException && requestError.name === 'AbortError') return undefined;
      throw requestError;
    } finally {
      if (currentRequest()) controllers.current.delete(region);
    }
  }, []);

  const handleError = useCallback((requestError: unknown) => {
    if (requestError instanceof CaseBatchApiError && requestError.status === 401) {
      abortAll();
      router.replace('/login?returnUrl=/account/case-batches');
      return;
    }
    setError(safeError(requestError));
    focusLater(errorSummary.current);
  }, [abortAll, router]);

  const loadJob = useCallback(async (jobId: string, announce = false) => {
    setError('');
    try {
      const result = await runLatest('job-detail', async (signal) => {
        const jobPromise = getCaseBatch(jobId, signal);
        const allItems: CaseBatchItem[] = [];
        let offset = 0;
        let hasMore = true;
        while (hasMore && offset < 500) {
          const page = await getCaseBatchItems(jobId, offset, 100, signal);
          allItems.push(...page.items);
          hasMore = Boolean(page.hasMore);
          offset += page.items.length;
          if (hasMore && page.items.length === 0) throw new Error('Case batch pagination did not advance.');
        }
        if (hasMore) throw new Error('Case batch result exceeded the supported 500-row bound.');
        return { job: await jobPromise, items: allItems };
      });
      if (!result || selectedIdRef.current && selectedIdRef.current !== jobId) return;
      setSelected(result.job);
      setItems(result.items);
      setJobs((current) => current.map((entry) => entry.id === result.job.id ? result.job : entry));
      if (announce) setNotice(`Состояние задания обновлено: ${statusLabel(result.job.status)}.`);
    } catch (requestError) {
      handleError(requestError);
    }
  }, [handleError, runLatest]);

  const loadJobs = useCallback(async (announce = false) => {
    setError('');
    try {
      const page = await runLatest('jobs', (signal) => listCaseBatches(signal));
      if (!page) return;
      setJobs(page.items);
      const currentId = selectedIdRef.current;
      const nextId = currentId && page.items.some((entry) => entry.id === currentId) ? currentId : page.items[0]?.id;
      if (!nextId) {
        setSelected(null); setItems([]);
        if (announce) setNotice('Список заданий обновлён. Активных заданий нет.');
        return;
      }
      selectedIdRef.current = nextId;
      await loadJob(nextId, announce);
    } catch (requestError) {
      handleError(requestError);
    }
  }, [handleError, loadJob, runLatest]);

  useEffect(() => {
    // This keyed owner component performs one initial recovery read for the authenticated session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadJobs();
    const recover = () => { if (document.visibilityState === 'visible') void loadJobs(true); };
    const pageshow = () => { void loadJobs(false); };
    document.addEventListener('visibilitychange', recover);
    window.addEventListener('pageshow', pageshow);
    return () => {
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('pageshow', pageshow);
      abortAll();
    };
  }, [abortAll, loadJobs]);

  useEffect(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
    if (!selected || TERMINAL_STATUSES.has(selected.status.toLowerCase())) return;
    pollTimer.current = setTimeout(() => { void loadJob(selected.id); }, POLL_DELAY_MS);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      pollTimer.current = null;
    };
  }, [loadJob, selected]);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    abortRegion('upload');
    const nextFile = event.target.files?.[0] ?? null;
    fileRef.current = nextFile;
    setFile(nextFile);
    keyRef.current = nextFile ? idempotencyKey() : '';
    setPreview(null); setError(''); setNotice(nextFile ? 'Файл выбран. Выполните предварительную проверку.' : '');
  }

  async function runPreview() {
    const currentFile = fileRef.current;
    if (!currentFile) {
      setError('Выберите CSV или XLSX файл.');
      focusLater(errorSummary.current);
      return;
    }
    if (!keyRef.current) keyRef.current = idempotencyKey();
    setBusy('preview'); setError(''); setNotice(''); setPreview(null);
    try {
      const result = await runLatest('upload', (signal) => previewCaseBatch(currentFile, keyRef.current, signal));
      if (!result) return;
      setPreview(result);
      setNotice(`Предварительная проверка завершена: ${result.totalRows} строк.`);
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy((current) => current === 'preview' ? '' : current);
    }
  }

  async function confirm() {
    const currentFile = fileRef.current;
    if (!currentFile || !preview || !keyRef.current) {
      setError('Сначала выполните предварительную проверку выбранного файла.');
      focusLater(errorSummary.current);
      return;
    }
    setBusy('confirm'); setError(''); setNotice('');
    try {
      const job = await runLatest('upload', (signal) => confirmCaseBatch(currentFile, keyRef.current, preview.previewToken, signal));
      if (!job) return;
      selectedIdRef.current = job.id;
      setSelected(job); setItems([]); setJobs((current) => [job, ...current.filter((entry) => entry.id !== job.id)]);
      setPreview(null); setFile(null); fileRef.current = null; keyRef.current = '';
      if (uploadInput.current) uploadInput.current.value = '';
      setNotice('Задание создано и поставлено в очередь.');
      await loadJob(job.id);
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy((current) => current === 'confirm' ? '' : current);
    }
  }

  async function runControl(action: 'cancel' | 'resume' | 'retryFailed') {
    const jobId = selectedIdRef.current;
    if (!jobId) return;
    setBusy(action); setError(''); setNotice('');
    try {
      const job = await runLatest('job-detail', (signal) => {
        if (action === 'cancel') return cancel(jobId, signal);
        if (action === 'resume') return resume(jobId, signal);
        return retryFailed(jobId, signal);
      });
      if (!job) return;
      setSelected(job);
      setJobs((current) => current.map((entry) => entry.id === job.id ? job : entry));
      setNotice(`Команда принята. ${statusLabel(job.status)}.`);
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy('');
    }
  }

  async function download(format: 'csv' | 'json') {
    const jobId = selectedIdRef.current;
    if (!jobId) return;
    setBusy(`export-${format}`); setError('');
    try {
      const blob = await runLatest(`export-${format}`, (signal) => exportCaseBatch(jobId, format, signal));
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `case-batch.${format}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setNotice(`Экспорт ${format.toUpperCase()} подготовлен.`);
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy('');
    }
  }

  const progress = useMemo(() => {
    if (!selected?.totalItems) return 0;
    return Math.min(100, Math.round(((selected.completedItems ?? 0) / selected.totalItems) * 100));
  }, [selected]);

  return <main className={styles.container}>
    <header className={styles.header}>
      <div className={styles.headingBlock}>
        <Link href="/account" className={styles.backLink}>← Личный кабинет</Link>
        <h1>Пакетная проверка дел</h1>
        <p>Загрузите список ИНН и номеров дел. Сервис показывает только маскированные цели и результаты из сохранённых локальных данных.</p>
      </div>
      <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => loadJobs(true)}>Обновить</button>
    </header>

    <div className={styles.live} role="status" aria-live="polite" aria-atomic="true">{notice}</div>
    {error && <div ref={errorSummary} className={styles.error} role="alert" tabIndex={-1}>{error}</div>}

    <section className={styles.panel} aria-labelledby="upload-heading" aria-busy={busy === 'preview' || busy === 'confirm'}>
      <h2 id="upload-heading">Новое пакетное задание</h2>
      <div className={styles.field}>
        <label htmlFor="case-batch-file">CSV или XLSX файл</label>
        <input ref={uploadInput} id="case-batch-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFileChange} />
        <small>Файл и ключ проверки хранятся только в памяти этой вкладки и не попадают в адрес страницы.</small>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={runPreview}>{busy === 'preview' ? 'Проверяем…' : 'Предварительная проверка'}</button>
        {preview && <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={confirm}>{busy === 'confirm' ? 'Запускаем…' : 'Подтвердить и запустить'}</button>}
      </div>

      {preview && <div className={styles.preview}>
        <h3>Предварительный результат</h3>
        <p>Всего строк: <strong>{preview.totalRows}</strong>. В задании останутся только допустимые уникальные цели.</p>
        <div className={styles.tableWrap}>
          <table>
            <caption>Маскированные строки загруженного файла</caption>
            <thead><tr><th scope="col">Строка</th><th scope="col">Цель</th><th scope="col">Результат</th><th scope="col">Причина</th></tr></thead>
            <tbody>{preview.rows.map((row) => <tr key={`${row.rowNumber}-${row.duplicateOfRowNumber ?? 0}`}>
              <td>{row.rowNumber}</td><td>{previewDisplay(row)}</td><td>{previewClass(row)}</td>
              <td>{row.issueCodes?.join(', ') ?? row.issueCode ?? (row.duplicateOfRowNumber ? `Дубликат строки ${row.duplicateOfRowNumber}` : '—')}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>}
    </section>

    <div className={styles.workspace}>
      <section className={styles.panel} aria-labelledby="jobs-heading">
        <h2 id="jobs-heading">Последние задания</h2>
        {jobs.length === 0 ? <p>Заданий пока нет.</p> : <ul className={styles.jobList}>{jobs.map((job) => <li key={job.id}>
          <button type="button" className={job.id === selected?.id ? styles.selectedJob : styles.jobButton} onClick={() => {
            selectedIdRef.current = job.id; setSelected(job); void loadJob(job.id, true);
          }}><span>{statusLabel(job.status)}</span><small>{job.totalItems ?? 0} целей</small></button>
        </li>)}</ul>}
      </section>

      <section className={styles.panel} aria-labelledby="result-heading" aria-busy={busy === 'cancel' || busy === 'resume' || busy === 'retryFailed'}>
        <h2 id="result-heading">Выполнение и результаты</h2>
        {!selected ? <p>Выберите или создайте задание.</p> : <>
          <div className={styles.statusRow}><strong>{statusLabel(selected.status)}</strong><span>{progress}%</span></div>
          <div className={styles.progressTrack} role="progressbar" aria-label="Выполнение задания" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
          <dl className={styles.counts}>
            <div><dt>Всего</dt><dd>{selected.totalItems ?? 0}</dd></div><div><dt>Завершено</dt><dd>{selected.completedItems ?? 0}</dd></div><div><dt>Ошибки</dt><dd>{selected.failedItems ?? 0}</dd></div>
          </dl>
          <div className={styles.actions}>
            {selected.canCancel && <button type="button" className={styles.danger} disabled={Boolean(busy)} onClick={() => runControl('cancel')}>Отменить</button>}
            {selected.canResume && <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => runControl('resume')}>Возобновить</button>}
            {selected.canRetryFailed && <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => runControl('retryFailed')}>Повторить ошибки</button>}
            <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => download('csv')}>Скачать CSV</button>
            <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => download('json')}>Скачать JSON</button>
          </div>
          {items.length > 0 && <div className={styles.tableWrap}><table>
            <caption>Маскированные результаты задания</caption>
            <thead><tr><th scope="col">Строка</th><th scope="col">Цель</th><th scope="col">Статус</th><th scope="col">Доказательство</th></tr></thead>
            <tbody>{items.map((item) => { const dossierRoute = caseDossierRoute(item.safeRouteReference); return <tr key={item.id}><td>{item.rowNumber ?? '—'}</td><td>{dossierRoute ? <><span>{item.maskedDisplay ?? 'Дело'}</span><br /><Link href={dossierRoute}>Открыть досье дела</Link></> : item.maskedDisplay ?? 'Значение скрыто'}</td><td>{item.status}</td><td><span>{item.evidenceKind ?? 'Нет'}</span>{item.caveatCode === 'local-evidence-only' && <small className={styles.caveat}>Проверены только сохранённые локальные данные.</small>}</td></tr>; })}</tbody>
          </table></div>}
        </>}
      </section>
    </div>
  </main>;
}
