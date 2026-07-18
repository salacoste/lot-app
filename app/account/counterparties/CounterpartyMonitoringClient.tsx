'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  CounterpartyApiError, type CounterpartyInAppAlertItem, type CounterpartyWatchEventItem,
  type CounterpartyWatchlistCreateRequest, type CounterpartyWatchlistItem,
  createCounterparty, deleteCounterparty, getCounterparty, getCounterpartyHistory,
  getDueDiligenceReport, listCounterparties, listCounterpartyAlerts, markCounterpartyAlertRead, updateCounterparty,
  type DueDiligenceReportResponse,
} from '@/lib/api/counterpartyWatchlist';
import {
  getCounterpartyLeasingSignals, LeasingApiError, type CounterpartyLeasingSignalsResponse,
} from '@/lib/api/leasingIntelligence';
import {
  beginDueDiligenceReport, completeDueDiligenceReport, dueDiligenceReportCopy,
  dueDiligenceReportFailureCopy, dueDiligenceReportLevelLabel, dueDiligenceReasonView,
  dueDiligenceSourceSummaryView, emptyDueDiligenceReport,
  completeCounterpartyUpdate, emptyHistoryMessage, freshnessStatusView,
  identityStatusView, mergeById, monitoringTimeView, safeCounterpartyError,
  safeFedresursEvidenceUrl, sourceStatusView, validateCounterpartyCreate,
} from '@/utils/counterpartyMonitoring.logic.shared.mjs';
import styles from './counterparties.module.css';

const PAGE_SIZE = 50;
type CreateFields = { inn: string; ogrn: string; name: string; displayLabel: string };
type FieldErrors = Record<string, string>;
type LoadStatus = 'loading' | 'ready' | 'error';
type FailureKind = 'auth' | 'not-found' | 'conflict' | 'other';
type RunLatest = <T>(region: string, task: (signal: AbortSignal) => Promise<T>, settle?: () => void) => Promise<T | undefined>;
type ReportState =
  | { status: 'closed' }
  | { status: 'loading'; ownerKey: string; entryId: string; generation: number }
  | { status: 'ready'; ownerKey: string; entryId: string; generation: number; rawText: string; report: DueDiligenceReportResponse }
  | { status: 'error'; ownerKey: string; entryId: string; generation: number; message: string };

function requestMessage(error: unknown) {
  return safeCounterpartyError(error instanceof CounterpartyApiError || error instanceof LeasingApiError ? error.status : 500);
}

function focusLater(target: HTMLElement | null | undefined) {
  if (target) requestAnimationFrame(() => target.focus());
}

function EvidenceLink({ value }: { value: string }) {
  const safe = safeFedresursEvidenceUrl(value);
  return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">Открыть сообщение на Федресурсе</a> : <span>Ссылка источника недоступна</span>;
}

function MonitoringTime({ value }: { value?: string | null }) {
  const view = monitoringTimeView(value, Date.now());
  return view.accepted ? <time dateTime={view.dateTime}>{view.label}</time> : <span>{view.label}</span>;
}

function StatusAxis({ title, view }: { title: string; view: { label: string; description: string } }) {
  return <div className={styles.statusAxis}><dt>{title}</dt><dd><strong>{view.label}</strong><span>{view.description}</span></dd></div>;
}

export default function CounterpartyMonitoringClient() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const sessionKey = user?.id ?? user?.email ?? '';

  useEffect(() => {
    if (!loading && !sessionKey) router.replace('/login?returnUrl=/account/counterparties');
  }, [loading, router, sessionKey]);

  if (loading || !sessionKey) return <main className={styles.container}><p role="status">Проверяем сессию…</p></main>;
  return <OwnerCounterpartyWorkspace key={sessionKey} sessionKey={sessionKey} />;
}

function OwnerCounterpartyWorkspace({ sessionKey }: { sessionKey: string }) {
  const router = useRouter();
  const requestVersions = useRef(new Map<string, number>());
  const controllers = useRef(new Map<string, AbortController>());
  const itemsRef = useRef<CounterpartyWatchlistItem[]>([]);
  const alertsRef = useRef<CounterpartyInAppAlertItem[]>([]);
  const createOpener = useRef<HTMLButtonElement>(null);
  const watchlistHeading = useRef<HTMLHeadingElement>(null);
  const [invalidSession, setInvalidSession] = useState(false);
  const [items, setItems] = useState<CounterpartyWatchlistItem[]>([]);
  const [itemsStatus, setItemsStatus] = useState<LoadStatus>('loading');
  const [itemsBusy, setItemsBusy] = useState(true);
  const [itemsError, setItemsError] = useState('');
  const [itemsHasMore, setItemsHasMore] = useState(false);
  const [itemsPagingStarted, setItemsPagingStarted] = useState(false);
  const [alerts, setAlerts] = useState<CounterpartyInAppAlertItem[]>([]);
  const [alertsStatus, setAlertsStatus] = useState<LoadStatus>('loading');
  const [alertsBusy, setAlertsBusy] = useState(true);
  const [alertsError, setAlertsError] = useState('');
  const [alertsHasMore, setAlertsHasMore] = useState(false);
  const [notice, setNotice] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reportState, setReportState] = useState<ReportState>(() => emptyDueDiligenceReport());
  const reportStateRef = useRef<ReportState>(reportState);
  const reportGeneration = useRef(0);

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);
  useEffect(() => { reportStateRef.current = reportState; }, [reportState]);

  const abortRegion = useCallback((region: string) => {
    controllers.current.get(region)?.abort();
    controllers.current.delete(region);
    requestVersions.current.set(region, (requestVersions.current.get(region) ?? 0) + 1);
  }, []);

  const abortAll = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    for (const region of requestVersions.current.keys()) requestVersions.current.set(region, (requestVersions.current.get(region) ?? 0) + 1);
  }, []);

  const closeReport = useCallback((restoreFocus = false) => {
    const entryId = reportStateRef.current.status === 'closed' ? null : reportStateRef.current.entryId;
    abortRegion('report');
    reportGeneration.current += 1;
    const closed = emptyDueDiligenceReport() as ReportState;
    reportStateRef.current = closed;
    setReportState(closed);
    if (restoreFocus && entryId) focusLater(document.getElementById(`report-open-${entryId}`));
  }, [abortRegion]);

  const runLatest = useCallback<RunLatest>(async (region, task, settle) => {
    controllers.current.get(region)?.abort();
    const controller = new AbortController();
    const version = (requestVersions.current.get(region) ?? 0) + 1;
    requestVersions.current.set(region, version);
    controllers.current.set(region, controller);
    const current = () => !controller.signal.aborted && requestVersions.current.get(region) === version && controllers.current.get(region) === controller;
    try {
      const value = await task(controller.signal);
      return current() ? value : undefined;
    } catch (error) {
      if (!current() || error instanceof DOMException && error.name === 'AbortError') return undefined;
      throw error;
    } finally {
      if (current()) {
        controllers.current.delete(region);
        settle?.();
      }
    }
  }, []);

  const handleFailure = useCallback((error: unknown): FailureKind => {
    if ((error instanceof CounterpartyApiError || error instanceof LeasingApiError) && error.status === 401) {
      setInvalidSession(true);
      closeReport();
      abortAll();
      setItems([]); setAlerts([]); setSelectedId(null); setShowCreate(false); setNotice(''); setGlobalError('');
      router.replace('/login?returnUrl=/account/counterparties');
      return 'auth';
    }
    if (error instanceof CounterpartyApiError && error.status === 404) return 'not-found';
    if (error instanceof CounterpartyApiError && error.status === 409) return 'conflict';
    return 'other';
  }, [abortAll, closeReport, router]);

  const loadItems = useCallback(async (reset = true, announce = false) => {
    if (announce) setNotice('');
    setItemsBusy(true); setItemsError('');
    if (!reset && !itemsHasMore) { setItemsBusy(false); return; }
    try {
      const offset = reset ? 0 : itemsRef.current.length;
      const page = await runLatest('items', (signal) => listCounterparties(signal, { offset, limit: PAGE_SIZE }), () => setItemsBusy(false));
      if (!page) return;
      setItems((current) => mergeById(current, page.items, reset));
      setItemsHasMore(page.hasMore); setItemsStatus('ready');
      if (announce) setNotice(reset
        ? `Список наблюдения обновлён: ${page.items.length}.`
        : page.hasMore ? `Загружено ещё контрагентов: ${page.items.length}.` : 'Все контрагенты загружены.');
    } catch (error) {
      if (handleFailure(error) === 'auth') return;
      setItemsError(requestMessage(error)); setItemsStatus('error'); setItemsBusy(false);
    }
  }, [handleFailure, itemsHasMore, runLatest]);

  const loadAlerts = useCallback(async (reset = true, announce = false) => {
    if (announce) setNotice('');
    setAlertsBusy(true); setAlertsError('');
    if (!reset && !alertsHasMore) { setAlertsBusy(false); return; }
    try {
      const offset = reset ? 0 : alertsRef.current.length;
      const page = await runLatest('alerts', (signal) => listCounterpartyAlerts(signal, { offset, limit: PAGE_SIZE }), () => setAlertsBusy(false));
      if (!page) return;
      setAlerts((current) => mergeById(current, page.items, reset));
      setAlertsHasMore(page.hasMore); setAlertsStatus('ready');
      if (announce) setNotice(reset
        ? `Уведомления обновлены: ${page.items.length}.`
        : page.hasMore ? `Загружено ещё уведомлений: ${page.items.length}.` : 'Все уведомления загружены.');
    } catch (error) {
      if (handleFailure(error) === 'auth') return;
      setAlertsError(requestMessage(error)); setAlertsStatus('error'); setAlertsBusy(false);
    }
  }, [alertsHasMore, handleFailure, runLatest]);

  useEffect(() => {
    void loadItems(true); void loadAlerts(true);
    return abortAll;
  // OwnerCounterpartyWorkspace is keyed by sessionKey; this is the only initialization for this owner instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const refreshAfterMutation = useCallback(async (message: string) => {
    setGlobalError('');
    await Promise.all([loadItems(true), loadAlerts(true)]);
    setNotice(message);
  }, [loadAlerts, loadItems]);

  const removeMissing = useCallback(async (id: string, message: string) => {
    setGlobalError('');
    if (reportStateRef.current.status !== 'closed' && reportStateRef.current.entryId === id) closeReport();
    const before = itemsRef.current;
    const index = before.findIndex((item) => item.id === id);
    const focusId = before[index + 1]?.id ?? before[index - 1]?.id;
    setItems((current) => current.filter((item) => item.id !== id));
    setSelectedId(null);
    await Promise.all([loadItems(true), loadAlerts(true)]);
    setNotice(message);
    focusLater(focusId ? document.getElementById(`counterparty-${focusId}`) : watchlistHeading.current);
  }, [closeReport, loadAlerts, loadItems]);

  const openReport = useCallback(async (entryId: string) => {
    closeReport();
    const generation = reportGeneration.current + 1;
    reportGeneration.current = generation;
    const loadingState = beginDueDiligenceReport(sessionKey, entryId, generation) as ReportState;
    reportStateRef.current = loadingState;
    setReportState(loadingState);
    try {
      const result = await runLatest('report', (signal) => getDueDiligenceReport(entryId, signal));
      if (!result) return;
      setReportState((current) => {
        const ready = completeDueDiligenceReport(
          current, sessionKey, entryId, generation, result.rawText, result.report,
        ) as ReportState;
        reportStateRef.current = ready;
        return ready;
      });
    } catch (error) {
      if (error instanceof CounterpartyApiError && error.status === 401) {
        handleFailure(error);
        return;
      }
      if (error instanceof CounterpartyApiError && error.status === 404) {
        closeReport();
        await removeMissing(entryId, dueDiligenceReportCopy('state.notFound'));
        return;
      }
      setReportState((current) => {
        if (current.status === 'closed' || current.ownerKey !== sessionKey || current.entryId !== entryId || current.generation !== generation) return current;
        const failed: ReportState = {
          status: 'error', ownerKey: sessionKey, entryId, generation,
          message: dueDiligenceReportFailureCopy(error instanceof CounterpartyApiError ? error.status : 500),
        };
        reportStateRef.current = failed;
        return failed;
      });
    }
  }, [closeReport, handleFailure, removeMissing, runLatest, sessionKey]);

  useEffect(() => () => abortAll(), [abortAll]);

  if (invalidSession) return <main className={styles.container}><p role="status">{dueDiligenceReportCopy('state.unauthorized')}</p></main>;

  return <main className={styles.container}>
    <div className={styles.header}>
      <div><Link href="/account" className={styles.backLink} onClick={() => closeReport()}>← Личный кабинет</Link><h1>Наблюдение за контрагентами</h1>
        <p>Статусы и история из источника. Это не юридическая оценка и не вывод о безопасности организации.</p></div>
      <button ref={createOpener} type="button" className={styles.primary} onClick={() => setShowCreate(true)}>Добавить контрагента</button>
    </div>
    <div className={styles.live} role="status" aria-live="polite" aria-atomic="true">{notice}</div>
    {globalError && <p role="alert" className={styles.error}>{globalError}</p>}

    <AlertFeed items={alerts} status={alertsStatus} error={alertsError} hasMore={alertsHasMore} busy={alertsBusy}
      onRetry={() => loadAlerts(true, true)} onMore={() => loadAlerts(false, true)} onRead={async (id) => {
        setGlobalError('');
        try {
          const marked = await runLatest(`read:${id}`, async (signal) => { await markCounterpartyAlertRead(id, signal); return true; });
          if (!marked) return;
          await loadAlerts(true);
          setNotice('Уведомление отмечено прочитанным.');
          focusLater(document.getElementById(`alert-${id}`));
        } catch (error) {
          const kind = handleFailure(error);
          if (kind === 'not-found') await loadAlerts(true);
          else if (kind !== 'auth') setAlertsError(requestMessage(error));
        }
      }} />

    {showCreate && <CreateForm run={runLatest} onCancel={() => { setShowCreate(false); focusLater(createOpener.current); }} onCreated={async (created) => {
      setGlobalError(''); setShowCreate(false); await loadItems(true); setSelectedId(created.id); setNotice('Контрагент добавлен.');
      focusLater(document.getElementById(`counterparty-${created.id}`));
    }} onError={(error) => { if (handleFailure(error) !== 'auth') setGlobalError(requestMessage(error)); }} />}

    {reportState.status !== 'closed' && <DueDiligenceReportPanel state={reportState}
      onClose={() => closeReport(true)} onRetry={() => openReport(reportState.entryId)} />}

    <section aria-labelledby="watchlist-heading" className={styles.section} aria-busy={itemsBusy}>
      <div className={styles.sectionHeading}><h2 ref={watchlistHeading} id="watchlist-heading" tabIndex={-1}>Список наблюдения</h2>
        <button type="button" className={styles.secondary} disabled={itemsBusy} onClick={() => loadItems(true, true)}>Обновить</button></div>
      {itemsStatus === 'loading' ? <p role="status">Загружаем список наблюдения…</p> :
        itemsStatus === 'error' && items.length === 0 ? <div><p role="alert" className={styles.error}>{itemsError}</p><button className={styles.secondary} type="button" onClick={() => loadItems(true, true)}>Повторить</button></div> : <>
          {itemsError && <div><p role="alert" className={styles.error}>{itemsError}</p><button className={styles.secondary} type="button" onClick={() => loadItems(true, true)}>Повторить обновление</button></div>}
          {items.length === 0 ? <div className={styles.empty}><h3 tabIndex={-1}>Вы ещё не добавили контрагентов.</h3><p>Добавьте ИНН-10, ОГРН-13 или название организации.</p></div> :
            <ul className={styles.cardGrid}>{items.map((item) => <li key={item.id} className={styles.card}>
              <WatchCard item={item} expanded={selectedId === item.id} onToggle={() => setSelectedId(selectedId === item.id ? null : item.id)}
                reportStatus={reportState.status !== 'closed' && reportState.entryId === item.id ? reportState.status : null}
                onOpenReport={() => openReport(item.id)} onCloseReport={() => closeReport(true)}
                run={runLatest} abortRegion={abortRegion} handleFailure={handleFailure}
                onAnnounce={setNotice}
                onCanonical={(canonical) => setItems((current) => current.map((value) => value.id === canonical.id ? canonical : value))}
                onChanged={refreshAfterMutation} onMissing={(id) => removeMissing(id, 'Запись больше недоступна; список обновлён.')}
                onGone={(id) => removeMissing(id, 'Наблюдение удалено.')} onError={(error) => setGlobalError(requestMessage(error))} />
            </li>)}</ul>}
          {(itemsHasMore || itemsPagingStarted) && <button className={styles.secondary} type="button" aria-disabled={itemsBusy || !itemsHasMore}
            onClick={() => { if (itemsBusy || !itemsHasMore) return; setItemsPagingStarted(true); void loadItems(false, true); }}>
            {itemsHasMore ? 'Показать ещё контрагентов' : 'Все контрагенты загружены'}</button>}
        </>}
    </section>
  </main>;
}

function CreateForm({ run, onCancel, onCreated, onError }: {
  run: RunLatest; onCancel: () => void; onCreated: (item: CounterpartyWatchlistItem) => Promise<void>; onError: (error: unknown) => void;
}) {
  const [fields, setFields] = useState<CreateFields>({ inn: '', ogrn: '', name: '', displayLabel: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const refs = { inn: useRef<HTMLInputElement>(null), ogrn: useRef<HTMLInputElement>(null), name: useRef<HTMLInputElement>(null), displayLabel: useRef<HTMLInputElement>(null) };
  useEffect(() => { focusLater(refs.inn.current); }, []); // keyed owner workspace guarantees a clean draft
  async function submit(event: FormEvent) {
    event.preventDefault();
    const validation = validateCounterpartyCreate(fields); setErrors(validation);
    const firstInvalid = (['inn', 'ogrn', 'name', 'displayLabel'] as const).find((field) => validation[field]);
    if (firstInvalid) { focusLater(refs[firstInvalid].current); return; }
    setBusy(true);
    const body: CounterpartyWatchlistCreateRequest = { inn: fields.inn.trim() || null, ogrn: fields.ogrn.trim() || null, name: fields.name.trim() || null, displayLabel: fields.displayLabel.trim() || null };
    try {
      const created = await run('create', (signal) => createCounterparty(body, signal), () => setBusy(false));
      if (created) await onCreated(created);
    } catch (error) { setBusy(false); onError(error); }
  }
  return <section className={styles.section} aria-labelledby="create-heading"><h2 id="create-heading">Добавить контрагента</h2>
    {Object.keys(errors).length > 0 && <p role="alert" className={styles.error}>Проверьте поля формы.</p>}
    <form className={styles.formGrid} onSubmit={submit} noValidate>
      <Field id="inn" label="ИНН организации" help="10 цифр. ИНН физлица из 12 цифр пока не поддерживается." error={errors.inn}><input ref={refs.inn} id="inn" inputMode="numeric" autoComplete="off" maxLength={64} value={fields.inn} onChange={(e) => setFields({ ...fields, inn: e.target.value })} aria-invalid={!!errors.inn} aria-describedby="inn-help inn-error" /></Field>
      <Field id="ogrn" label="ОГРН организации" help="13 цифр. ОГРНИП из 15 цифр пока не поддерживается." error={errors.ogrn}><input ref={refs.ogrn} id="ogrn" inputMode="numeric" autoComplete="off" maxLength={64} value={fields.ogrn} onChange={(e) => setFields({ ...fields, ogrn: e.target.value })} aria-invalid={!!errors.ogrn} aria-describedby="ogrn-help ogrn-error" /></Field>
      <Field id="name" label="Название" help="Можно указать вместо идентификатора; проверка может потребовать уточнения." error={errors.name}><input ref={refs.name} id="name" autoComplete="off" maxLength={512} value={fields.name} onChange={(e) => setFields({ ...fields, name: e.target.value })} aria-invalid={!!errors.name} aria-describedby="name-help name-error" /></Field>
      <Field id="displayLabel" label="Метка для себя (необязательно)" help="Видна только в вашем кабинете." error={errors.displayLabel}><input ref={refs.displayLabel} id="displayLabel" autoComplete="off" maxLength={160} value={fields.displayLabel} onChange={(e) => setFields({ ...fields, displayLabel: e.target.value })} aria-invalid={!!errors.displayLabel} aria-describedby="displayLabel-help displayLabel-error" /></Field>
      <div className={styles.actions}><button className={styles.primary} type="submit" disabled={busy}>{busy ? 'Добавляем…' : 'Добавить'}</button><button className={styles.secondary} type="button" onClick={onCancel} disabled={busy}>Отмена</button></div>
    </form>
  </section>;
}

function Field({ id, label, help, error, children }: { id: string; label: string; help: string; error?: string; children: React.ReactNode }) {
  return <div className={styles.field}><label htmlFor={id}>{label}</label>{children}<small id={`${id}-help`}>{help}</small>{error && <small id={`${id}-error`} className={styles.fieldError}>{error}</small>}</div>;
}

function DueDiligenceReportPanel({ state, onClose, onRetry }: {
  state: Exclude<ReportState, { status: 'closed' }>;
  onClose: () => void;
  onRetry: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { focusLater(heading.current); }, [state.entryId, state.generation, state.status]);

  function downloadExactJson(rawText: string) {
    const objectUrl = URL.createObjectURL(new Blob([rawText], { type: 'application/json;charset=utf-8' }));
    try {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'due-diligence-report.json';
      link.click();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return <article className={`${styles.section} ${styles.reportPrintRoot}`} aria-labelledby="due-diligence-report-heading">
    <div className={`${styles.sectionHeading} ${styles.reportPrintControls}`}>
      <h2 ref={heading} id="due-diligence-report-heading" tabIndex={-1}>{dueDiligenceReportCopy('report.title')}</h2>
      <button type="button" className={styles.secondary} onClick={onClose}>{dueDiligenceReportCopy('action.close')}</button>
    </div>
    {state.status === 'loading' && <p role="status" aria-live="polite">{dueDiligenceReportCopy('state.loading')}</p>}
    {state.status === 'error' && <div><p role="alert">{state.message}</p><button type="button" className={styles.secondary} onClick={onRetry}>{dueDiligenceReportCopy('action.retry')}</button></div>}
    {state.status === 'ready' && <>
      <header className={styles.reportHeader}>
        <h3>{state.report.organization.name}</h3>
        <p>Сформирован: <MonitoringTime value={state.report.generatedAtUtc} /></p>
        <p>Статус идентификации: <code>{state.report.organization.identityStatus}</code></p>
        <div className={styles.identifiers}>{state.report.organization.inn && <span>ИНН: {state.report.organization.inn}</span>}{state.report.organization.ogrn && <span>ОГРН: {state.report.organization.ogrn}</span>}</div>
      </header>
      <dl className={`${styles.statusList} ${styles.reportAxes}`}>
        <StatusAxis title={dueDiligenceReportCopy('axis.level')} view={{ label: dueDiligenceReportLevelLabel(state.report.assessment.level), description: state.report.assessment.level }} />
        <StatusAxis title={dueDiligenceReportCopy('axis.confidence')} view={{ label: dueDiligenceReportLevelLabel(state.report.assessment.confidence), description: state.report.assessment.confidence }} />
        <StatusAxis title={dueDiligenceReportCopy('axis.coverage')} view={{ label: state.report.assessment.coverage, description: state.report.assessment.coverage }} />
      </dl>
      <section aria-labelledby="report-reasons-heading" className={styles.reportSection}>
        <h3 id="report-reasons-heading">Основания оценки</h3>
        {state.report.reasons.length === 0 ? <p>Основания не сформированы.</p> : <ol>{state.report.reasons.map((reason) => {
          const view = dueDiligenceReasonView(reason);
          return <li key={view.code}>
            <code>{view.code}</code><span>{view.summary}</span>
            {reason.latestEvidenceAtUtc && <span> Последнее свидетельство: <MonitoringTime value={reason.latestEvidenceAtUtc} />.</span>}
          </li>;
        })}</ol>}
      </section>
      <section aria-labelledby="report-sources-heading" className={styles.reportSection}>
        <h3 id="report-sources-heading">Покрытие источников</h3>
        <ul>{state.report.sources.map((source) => {
          const view = dueDiligenceSourceSummaryView(source);
          return <li key={view.source}><code>{view.source}</code><span> {view.summary}</span></li>;
        })}</ul>
      </section>
      <section aria-labelledby="report-disclaimers-heading" className={styles.reportSection}>
        <h3 id="report-disclaimers-heading">Ограничения отчёта</h3>
        <ul>{state.report.disclaimerCodes.map((code) => <li key={code}>{dueDiligenceReportCopy(`disclaimer.${code}`)}</li>)}</ul>
      </section>
      <div className={`${styles.actions} ${styles.reportPrintControls}`}>
        <button type="button" className={styles.secondary} onClick={() => downloadExactJson(state.rawText)}>{dueDiligenceReportCopy('action.download')}</button>
        <button type="button" className={styles.secondary} onClick={() => window.print()}>{dueDiligenceReportCopy('action.print')}</button>
      </div>
    </>}
  </article>;
}

function WatchCard({ item, expanded, onToggle, reportStatus, onOpenReport, onCloseReport, run, abortRegion, handleFailure, onAnnounce, onCanonical, onChanged, onMissing, onGone, onError }: {
  item: CounterpartyWatchlistItem; expanded: boolean; onToggle: () => void; run: RunLatest; abortRegion: (region: string) => void;
  reportStatus: Exclude<ReportState['status'], 'closed'> | null; onOpenReport: () => void; onCloseReport: () => void;
  handleFailure: (error: unknown) => FailureKind; onCanonical: (item: CounterpartyWatchlistItem) => void;
  onAnnounce: (message: string) => void;
  onChanged: (message: string) => Promise<void>; onMissing: (id: string) => Promise<void>; onGone: (id: string) => Promise<void>; onError: (error: unknown) => void;
}) {
  const identity = identityStatusView(item.snapshot.identityStatus); const source = sourceStatusView(item.snapshot.sourceStatus, item.snapshot.freshnessStatus); const freshness = freshnessStatusView(item.snapshot.freshnessStatus);
  const historyRegion = `history:${item.id}`; const actionRegion = `action:${item.id}`;
  const historyOpener = useRef<HTMLButtonElement>(null); const historyHeading = useRef<HTMLHeadingElement>(null);
  const editOpener = useRef<HTMLButtonElement>(null); const editHeading = useRef<HTMLHeadingElement>(null); const deleteOpener = useRef<HTMLButtonElement>(null);
  const [history, setHistory] = useState<CounterpartyWatchEventItem[]>([]); const historyRef = useRef<CounterpartyWatchEventItem[]>([]);
  const [historyStatus, setHistoryStatus] = useState<LoadStatus>('loading'); const [historyMore, setHistoryMore] = useState(false); const [historyBusy, setHistoryBusy] = useState(false); const [historyError, setHistoryError] = useState('');
  const [historyPagingStarted, setHistoryPagingStarted] = useState(false);
  const [editing, setEditing] = useState(false); const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [label, setLabel] = useState(item.displayLabel ?? ''); const [enabled, setEnabled] = useState(item.enabled); const [optIn, setOptIn] = useState(item.alertOptIn); const [mutationBusy, setMutationBusy] = useState(false);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { setLabel(item.displayLabel ?? ''); setEnabled(item.enabled); setOptIn(item.alertOptIn); }, [item]);
  useEffect(() => () => { abortRegion(historyRegion); abortRegion(actionRegion); }, [abortRegion, actionRegion, historyRegion]);
  useEffect(() => { if (expanded) { focusLater(historyHeading.current); if (historyStatus === 'loading' && !historyBusy) void loadHistory(true); } }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (editing) focusLater(editHeading.current); }, [editing]);

  async function loadHistory(reset: boolean, announce = false) {
    if (announce) onAnnounce('');
    setHistoryBusy(true); setHistoryError('');
    try {
      const page = await run(historyRegion, (signal) => getCounterpartyHistory(item.id, signal, { offset: reset ? 0 : historyRef.current.length, limit: PAGE_SIZE }), () => setHistoryBusy(false));
      if (!page) return;
      setHistory((current) => mergeById(current, page.items, reset)); setHistoryMore(page.hasMore); setHistoryStatus('ready');
      if (announce) onAnnounce(reset
        ? `История обновлена: ${page.items.length}.`
        : page.hasMore ? `Загружено ещё событий: ${page.items.length}.` : 'Все события истории загружены.');
    } catch (error) {
      setHistoryBusy(false); const kind = handleFailure(error);
      if (kind === 'not-found') await onMissing(item.id);
      else if (kind !== 'auth') { setHistoryStatus('error'); setHistoryError(requestMessage(error)); }
    }
  }

  async function reloadCanonicalAfterConflict(message: string) {
    try {
      const canonical = await run(actionRegion, (signal) => getCounterparty(item.id, signal));
      if (!canonical) return;
      onCanonical(canonical); setLabel(canonical.displayLabel ?? ''); setEnabled(canonical.enabled); setOptIn(canonical.alertOptIn); setDeleteConfirm(false); setEditing(true); setMutationBusy(false); await onChanged(message); focusLater(editHeading.current);
    } catch (error) {
      setMutationBusy(false); const kind = handleFailure(error);
      if (kind === 'not-found') await onMissing(item.id); else if (kind !== 'auth') onError(error);
    }
  }

  return <article>
    <h3 id={`counterparty-${item.id}`} tabIndex={-1}>{item.displayLabel || item.name || 'Контрагент без названия'}</h3>
    <div className={styles.identifiers}>{item.inn && <span>ИНН: {item.inn}</span>}{item.ogrn && <span>ОГРН: {item.ogrn}</span>}</div>
    <p><strong>{item.enabled ? 'Мониторинг включён' : 'Мониторинг выключен'}</strong></p>
    <dl className={styles.statusList}><StatusAxis title="Идентификация" view={identity} /><StatusAxis title="Источник" view={source} /><StatusAxis title="Актуальность" view={freshness} /></dl>
    {item.snapshot.lastSucceededAtUtc && <p>Последняя успешная проверка: <MonitoringTime value={item.snapshot.lastSucceededAtUtc} /></p>}
    <div className={styles.actions}><button id={`report-open-${item.id}`} type="button" className={styles.secondary}
      onClick={reportStatus ? onCloseReport : onOpenReport}>{reportStatus ? dueDiligenceReportCopy('action.close') : dueDiligenceReportCopy('action.open')}</button><button ref={historyOpener} type="button" className={styles.secondary} onClick={() => {
      if (expanded) { abortRegion(historyRegion); setHistoryBusy(false); onToggle(); focusLater(historyOpener.current); }
      else { setHistoryStatus('loading'); onToggle(); }
    }}>{expanded ? 'Скрыть историю' : 'Открыть историю'}</button><button ref={editOpener} type="button" className={styles.secondary} onClick={() => { setEditing(true); setDeleteConfirm(false); }}>Изменить</button><button ref={deleteOpener} type="button" className={styles.danger} onClick={() => { setDeleteConfirm(true); setEditing(false); }}>Удалить</button></div>
    <CounterpartyLeasingPanel entryId={item.id} run={run} abortRegion={abortRegion} handleFailure={handleFailure} />
    {editing && <form className={styles.editForm} onSubmit={async (event) => {
      event.preventDefault(); setMutationBusy(true);
      try {
        const updated = await run(actionRegion, async (signal) => { await updateCounterparty(item.id, completeCounterpartyUpdate(item, { displayLabel: label, enabled, alertOptIn: optIn }), signal); return true; }, () => setMutationBusy(false));
        if (!updated) return; setEditing(false); await onChanged('Настройки обновлены.'); focusLater(editOpener.current);
      } catch (error) {
        setMutationBusy(false); const kind = handleFailure(error);
        if (kind === 'conflict') await reloadCanonicalAfterConflict(safeCounterpartyError(409));
        else if (kind === 'not-found') await onMissing(item.id); else if (kind !== 'auth') onError(error);
      }
    }}><h4 ref={editHeading} tabIndex={-1}>Настройки наблюдения</h4><label>Метка для себя<input maxLength={160} value={label} onChange={(event) => setLabel(event.target.value)} /></label><label className={styles.checkbox}><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Мониторинг включён</label><label className={styles.checkbox}><input type="checkbox" checked={optIn} onChange={(event) => setOptIn(event.target.checked)} />Получать новые уведомления в кабинете</label><small>Выключено по умолчанию. Включение относится только к будущим событиям; прошлые события не станут новыми уведомлениями.</small><div className={styles.actions}><button className={styles.primary} disabled={mutationBusy} type="submit">Сохранить</button><button className={styles.secondary} disabled={mutationBusy} type="button" onClick={() => { setEditing(false); focusLater(editOpener.current); }}>Отмена</button></div></form>}
    {deleteConfirm && <div className={styles.confirm} role="group" aria-label="Подтверждение удаления"><p>Удалить наблюдение? История и уведомления этого контрагента перестанут отображаться.</p><div className={styles.actions}><button className={styles.danger} disabled={mutationBusy} type="button" onClick={async () => {
      setMutationBusy(true);
      try {
        const deleted = await run(actionRegion, async (signal) => { await deleteCounterparty(item.id, item.version, signal); return true; }, () => setMutationBusy(false));
        if (deleted) await onGone(item.id);
      } catch (error) {
        setMutationBusy(false); const kind = handleFailure(error);
        if (kind === 'conflict') await reloadCanonicalAfterConflict(safeCounterpartyError(409));
        else if (kind === 'not-found') await onMissing(item.id); else if (kind !== 'auth') onError(error);
      }
    }}>Удалить</button><button className={styles.secondary} type="button" onClick={() => { setDeleteConfirm(false); focusLater(deleteOpener.current); }}>Отмена</button></div></div>}
    {expanded && <section className={styles.detail} aria-label="История событий">
      <h4 ref={historyHeading} tabIndex={-1}>История источника</h4>
      {historyStatus === 'loading' && history.length === 0 ? <p role="status">Загружаем историю…</p> : historyStatus === 'error' && history.length === 0 ? <div><p role="alert" className={styles.error}>{historyError}</p><button className={styles.secondary} type="button" onClick={() => loadHistory(true, true)}>Повторить</button></div> : <>
        {historyError && <div><p role="alert" className={styles.error}>{historyError}</p><button className={styles.secondary} type="button" onClick={() => loadHistory(true, true)}>Повторить обновление</button></div>}
        {history.length === 0 ? <p>{emptyHistoryMessage(item.snapshot.identityStatus, item.snapshot.sourceStatus, item.snapshot.freshnessStatus)}</p> : <ul className={styles.eventList}>{history.map((event) => <li key={event.id}><strong>{event.messageType}</strong><span>Дело: {event.caseNumber || 'не указано'}</span><span>Опубликовано: <MonitoringTime value={event.publicationDateUtc} /></span><span>Источник: {event.source}; подтверждение: {event.confidence}</span><EvidenceLink value={event.sourceReference} /></li>)}</ul>}
        {(historyMore || historyPagingStarted) && <button className={styles.secondary} type="button" aria-disabled={historyBusy || !historyMore}
          onClick={() => { if (historyBusy || !historyMore) return; setHistoryPagingStarted(true); void loadHistory(false, true); }}>
          {historyMore ? 'Показать ещё события' : 'Все события истории загружены'}</button>}
      </>}
    </section>}
  </article>;
}

function CounterpartyLeasingPanel({ entryId, run, abortRegion, handleFailure }: {
  entryId: string; run: RunLatest; abortRegion: (region: string) => void;
  handleFailure: (error: unknown) => FailureKind;
}) {
  const region = `leasing-signals:${entryId}`;
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<CounterpartyLeasingSignalsResponse | null>(null);
  useEffect(() => () => abortRegion(region), [abortRegion, region]);

  async function load() {
    setOpened(true); setBusy(true); setError('');
    try {
      const result = await run(region, (signal) => getCounterpartyLeasingSignals(entryId, 10, signal), () => setBusy(false));
      if (result) setData(result);
    } catch (failure) {
      setBusy(false);
      if (handleFailure(failure) !== 'auth') setError(requestMessage(failure));
    }
  }

  const stateCopy: Record<string, string> = {
    unavailable: 'Лизинговые сигналы временно недоступны.',
    unlinked: 'К профилю не привязан сохранённый поиск с фильтром компании.',
    degraded: 'Источник работает с ограничениями; состояние нельзя трактовать как отсутствие активности.',
    'empty-persisted-set': 'По привязанному фильтру сохранённых сигналов пока нет.',
    stale: 'Найдены только устаревшие сохранённые сигналы.',
    found: 'Найдены сохранённые лизинговые сигналы.',
  };

  return <section className={styles.detail} aria-label="Лизинговые сигналы контрагента">
    <div className={styles.sectionHeading}><h4>Лизинговые сигналы</h4><button type="button" className={styles.secondary}
      disabled={busy} onClick={() => opened ? (abortRegion(region), setOpened(false), setBusy(false), setData(null), setError('')) : void load()}>{opened ? 'Скрыть' : 'Показать'}</button></div>
    {opened && <>{busy && <p role="status">Загружаем лизинговые сигналы…</p>}
      {error && <p role="alert" className={styles.error}>{error} <button type="button" className={styles.secondary} onClick={() => void load()}>Повторить</button></p>}
      {data && <><p><strong>{stateCopy[data.state] ?? data.state}</strong></p>
        <p>Связь основана только на настроенном пользователем фильтре названия. Идентичность организации не подтверждена.</p>
        <dl className={styles.statusList}><div><dt>Состояние источника</dt><dd>{data.sourceHealth.state}</dd></div>
          <div><dt>Последний исход</dt><dd>{data.sourceHealth.latestOutcomeStatus ?? 'неизвестен'}</dd></div>
          <div><dt>Повтор исхода допустим</dt><dd>{data.sourceHealth.latestOutcomeRetryable === null ? 'неизвестно' : data.sourceHealth.latestOutcomeRetryable ? 'да' : 'нет'}</dd></div>
          <div><dt>Последний исход завершён</dt><dd>{data.sourceHealth.latestOutcomeFinishedAtUtc ?? 'неизвестно'}</dd></div>
          <div><dt>Последний успешный исход</dt><dd>{data.sourceHealth.lastSuccessfulAtUtc ?? 'неизвестен'}</dd></div></dl>
        {data.items.length > 0 && <ul className={styles.eventList}>{data.items.map((item, index) => <li key={`${item.publishedDate}-${item.companyName}-${index}`}>
          <strong>{item.companyName}</strong><span>{item.assetDescription}</span><span>{item.category}; {item.classificationConfidence}</span>
          <span>Опубликовано: {item.publishedDate}; состояние источника: {item.sourceStatus}</span>
        </li>)}</ul>}</>}
    </>}
  </section>;
}

function AlertFeed({ items, status, error, hasMore, busy, onRetry, onMore, onRead }: { items: CounterpartyInAppAlertItem[]; status: LoadStatus; error: string; hasMore: boolean; busy: boolean; onRetry: () => void; onMore: () => void; onRead: (id: string) => Promise<void> }) {
  const [reading, setReading] = useState<string | null>(null);
  const [pagingStarted, setPagingStarted] = useState(false);
  return <section className={styles.section} aria-labelledby="alerts-heading" aria-busy={busy}><div className={styles.sectionHeading}><h2 id="alerts-heading">Уведомления в кабинете</h2><button className={styles.secondary} type="button" disabled={busy} onClick={onRetry}>Обновить уведомления</button></div>
    {status === 'loading' && items.length === 0 ? <p role="status">Загружаем уведомления…</p> : status === 'error' && items.length === 0 ? <div><p role="alert" className={styles.error}>{error}</p><button className={styles.secondary} type="button" onClick={onRetry}>Повторить</button></div> : <>
      {error && <div><p role="alert" className={styles.error}>{error}</p><button className={styles.secondary} type="button" onClick={onRetry}>Повторить обновление</button></div>}
      {items.length === 0 ? <div className={styles.empty}><p>Новых уведомлений нет.</p><p>Это не означает отсутствие событий: проверьте статусы и историю контрагентов.</p></div> : <ul className={styles.alertList}>{items.map((item) => <li id={`alert-${item.id}`} tabIndex={-1} key={item.id} className={item.isRead ? styles.read : ''}><h3>{item.watchlistDisplayName || 'Контрагент без названия'}</h3><p>{item.messageType}</p><p>Дело: {item.caseNumber || 'не указано'}</p><p>Получено: <MonitoringTime value={item.visibleAtUtc} /></p><EvidenceLink value={item.sourceReference} />{item.isRead ? <p>Прочитано: <MonitoringTime value={item.readAtUtc} /></p> : <button type="button" className={styles.secondary} disabled={reading === item.id} onClick={async () => { setReading(item.id); try { await onRead(item.id); } finally { setReading(null); } }}>Отметить прочитанным</button>}</li>)}</ul>}
      {(hasMore || pagingStarted) && <button className={styles.secondary} type="button" aria-disabled={busy || !hasMore}
        onClick={() => { if (busy || !hasMore) return; setPagingStarted(true); onMore(); }}>
        {hasMore ? 'Показать ещё уведомления' : 'Все уведомления загружены'}</button>}
    </>}
  </section>;
}
