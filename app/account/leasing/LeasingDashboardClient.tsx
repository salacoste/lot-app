'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { exportLeasingIntelligence, LeasingApiError, searchLeasingIntelligence, type LeasingIntelligenceResponse } from '@/lib/api/leasingIntelligence';
import { canonicalLeasingSearch, leasingCaveatCopy, leasingLabels, leasingVocabulary, parseLeasingSearch, resetLeasingSearch, safeLeasingError, type LeasingFilters } from '@/utils/leasingDashboard.logic.shared.mjs';
import styles from './leasing.module.css';
import LeasingAlertsWorkspace from './LeasingAlertsWorkspace';

type LoadState = 'loading' | 'ready' | 'error' | 'invalid';
const today = () => new Date().toISOString().slice(0, 10);
const displayDate = (value: string) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
const displayTime = (value: string | null) => value ? `${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(value))} МСК` : 'время публикации недоступно';

export default function LeasingDashboardClient() {
  const { user, loading } = useAuth(); const router = useRouter(); const ownerKey = user?.id ?? user?.email ?? '';
  useEffect(() => { if (!loading && !ownerKey) router.replace('/login?returnUrl=/account/leasing'); }, [loading, ownerKey, router]);
  if (loading || !ownerKey) return <main className={styles.container}><p role="status">Проверяем сессию…</p></main>;
  return <OwnerWorkspace key={ownerKey} ownerKey={ownerKey} />;
}

function OwnerWorkspace({ ownerKey }: { ownerKey: string }) {
  const router = useRouter(); const generation = useRef(0); const controller = useRef<AbortController | null>(null);
  const exportGeneration = useRef(0); const exportController = useRef<AbortController | null>(null);
  const initial = typeof window === 'undefined' ? parseLeasingSearch('', today()) : parseLeasingSearch(window.location.search, today());
  const [query, setQuery] = useState(initial); const [draft, setDraft] = useState<LeasingFilters>(initial.filters);
  const [state, setState] = useState<LoadState>(initial.ok ? 'loading' : 'invalid'); const [data, setData] = useState<LeasingIntelligenceResponse | null>(null);
  const [dataQueryKey, setDataQueryKey] = useState<string | null>(null);
  const [message, setMessage] = useState(''); const [exporting, setExporting] = useState(false); const errorRef = useRef<HTMLDivElement>(null);
  const handleUnauthorized = useCallback(() => {
    router.replace('/login?returnUrl=/account/leasing');
  }, [router]);

  useEffect(() => { if (!message) return; const task = window.setTimeout(() => errorRef.current?.focus(), 0); return () => window.clearTimeout(task); }, [message, state]);

  const normalizeBrowserUrl = useCallback((next: ReturnType<typeof parseLeasingSearch>) => {
    if (!next.ok || next.useServerDefaults) return;
    const canonical = canonicalLeasingSearch(next.filters, next.offset, next.limit);
    const current = window.location.search.startsWith('?') ? window.location.search.slice(1) : window.location.search;
    if (current !== canonical) window.history.replaceState(null, '', `/account/leasing?${canonical}`);
  }, []);
  const queryKey = useCallback((next: ReturnType<typeof parseLeasingSearch>) => next.useServerDefaults
    ? `defaults|${next.offset}|${next.limit}` : canonicalLeasingSearch(next.filters, next.offset, next.limit), []);

  const load = useCallback(async (next = query) => {
    if (!next.ok) { setState('invalid'); setMessage('Адрес содержит недопустимые фильтры. Исправьте их или сбросьте поиск.'); return; }
    controller.current?.abort(); const current = new AbortController(); controller.current = current; const version = ++generation.current;
    setState('loading'); setMessage('');
    try {
      const value = await searchLeasingIntelligence(next.filters, next.offset, next.limit, current.signal, next.useServerDefaults);
      if (!current.signal.aborted && version === generation.current) { setData(value); setDataQueryKey(queryKey(next)); if (next.useServerDefaults) setDraft(value.filters); setState('ready'); }
    } catch (error) {
      if (current.signal.aborted || version !== generation.current) return;
      const status = error instanceof LeasingApiError ? error.status : 500;
      if (status === 401) { setData(null); setDataQueryKey(null); router.replace('/login?returnUrl=/account/leasing'); return; }
      setMessage(safeLeasingError(status)); setState(status === 400 ? 'invalid' : 'error'); requestAnimationFrame(() => errorRef.current?.focus());
    }
  }, [query, queryKey, router]);

  useEffect(() => { normalizeBrowserUrl(query); const task = window.setTimeout(() => load(), 0); return () => { window.clearTimeout(task); controller.current?.abort(); exportController.current?.abort(); exportGeneration.current += 1; }; }, [load, normalizeBrowserUrl, ownerKey, query]);
  useEffect(() => {
    const pop = () => { const next = parseLeasingSearch(window.location.search, today()); exportController.current?.abort(); exportGeneration.current += 1; setExporting(false); setDataQueryKey(null); setState(next.ok ? 'loading' : 'invalid'); normalizeBrowserUrl(next); setQuery(next); setDraft(next.filters); };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, [normalizeBrowserUrl]);

  const navigate = (next: ReturnType<typeof parseLeasingSearch>, replace = false) => {
    exportController.current?.abort(); exportGeneration.current += 1; setExporting(false);
    setDataQueryKey(null); setState(next.ok ? 'loading' : 'invalid'); setMessage('');
    const search = canonicalLeasingSearch(next.filters, next.offset, next.limit); const url = `/account/leasing${search ? `?${search}` : ''}`;
    window.history[replace ? 'replaceState' : 'pushState'](null, '', url); setQuery(next);
  };
  const apply = (event: FormEvent) => { event.preventDefault(); const raw = canonicalLeasingSearch(draft); const next = parseLeasingSearch(raw, today()); if (!next.ok) { setState('invalid'); setMessage('Проверьте значения фильтров.'); return; } navigate(next); };
  const reset = () => { exportController.current?.abort(); exportGeneration.current += 1; setExporting(false); setDataQueryKey(null); setState('loading'); setMessage(''); const remaining = resetLeasingSearch(window.location.search); window.history.pushState(null, '', `/account/leasing${remaining ? `?${remaining}` : ''}`); const next = parseLeasingSearch('', today()); setDraft(next.filters); setQuery(next); };
  const page = (offset: number) => navigate({ ...query, useServerDefaults: false, filters: query.useServerDefaults && data ? data.filters : query.filters, offset: Math.max(0, offset) });
  const download = async () => {
    if (state !== 'ready' || !data || dataQueryKey !== queryKey(query)) return;
    exportController.current?.abort(); const current = new AbortController(); exportController.current = current; const version = ++exportGeneration.current;
    setExporting(true); setMessage('');
    try { const file = await exportLeasingIntelligence(data.filters, current.signal); if (current.signal.aborted || version !== exportGeneration.current) return; const blob = new Blob([file.bytes as BlobPart], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.filename; anchor.hidden = true; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
    catch (error) { if (current.signal.aborted || version !== exportGeneration.current) return; const status = error instanceof LeasingApiError ? error.status : 500; if (status === 401) router.replace('/login?returnUrl=/account/leasing'); else { setMessage(safeLeasingError(status)); requestAnimationFrame(() => errorRef.current?.focus()); } }
    finally { if (version === exportGeneration.current) setExporting(false); }
  };

  return <main className={styles.container}>
    <nav aria-label="Навигация личного кабинета"><Link href="/account">Личный кабинет</Link><span aria-hidden="true"> / </span><span>Лизинговая активность</span></nav>
    <header className={styles.header}><div><h1>Лизинговая активность</h1><p>Сохранённые сигналы по слабой стороне сообщения. Это не вывод о роли лизингополучателя, платёжеспособности, риске или правовом статусе.</p></div><button type="button" onClick={download} disabled={exporting || state !== 'ready' || !data || dataQueryKey !== queryKey(query)}>{exporting ? 'Готовим CSV…' : 'Скачать CSV'}</button></header>
    <form className={styles.filters} onSubmit={apply} noValidate>
      <label>С даты<input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
      <label>По дату<input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
      <label className={styles.company}>Компания<input value={draft.company ?? ''} maxLength={120} placeholder="Буквальное вхождение" onChange={(e) => setDraft({ ...draft, company: e.target.value || null })} /></label>
      <Select label="Категория" value={draft.category} values={leasingVocabulary.categories} change={(category) => setDraft({ ...draft, category })} />
      <Select label="Надёжность" value={draft.confidence} values={leasingVocabulary.confidence} change={(confidence) => setDraft({ ...draft, confidence })} />
      <Select label="Проверка" value={draft.reviewState} values={leasingVocabulary.review} change={(reviewState) => setDraft({ ...draft, reviewState })} />
      <Select label="Актуальность" value={draft.sourceStatus} values={leasingVocabulary.source} change={(sourceStatus) => setDraft({ ...draft, sourceStatus })} />
      <div className={styles.actions}><button type="submit">Применить</button><button type="button" className={styles.secondary} onClick={reset}>Сбросить</button></div>
    </form>
    {message && <div ref={errorRef} tabIndex={-1} role="alert" className={styles.error}>{message}{state === 'error' && <button type="button" onClick={() => load()}>Повторить</button>}</div>}
    <LeasingAlertsWorkspace successfulResponse={state === 'ready' && data && dataQueryKey === queryKey(query) ? data : null}
      onUnauthorized={handleUnauthorized} />
    {state === 'loading' && <p role="status" className={styles.state}>Загружаем сигналы…</p>}
    {state === 'ready' && data && <Dashboard data={data} previous={() => page(query.offset - query.limit)} next={() => page(query.offset + query.limit)} />}
  </main>;
}

function Select({ label, value, values, change }: { label: string; value: string | null; values: readonly string[]; change: (value: string | null) => void }) {
  return <label>{label}<select value={value ?? ''} onChange={(e) => change(e.target.value || null)}><option value="">Все</option>{values.map((item) => <option key={item} value={item}>{leasingLabels[item] ?? item}</option>)}</select></label>;
}

function Dashboard({ data, previous, next }: { data: LeasingIntelligenceResponse; previous: () => void; next: () => void }) {
  const health = data.sourceHealth.state;
  return <>
    <section className={`${styles.health} ${styles[health]}`} aria-labelledby="health-heading"><h2 id="health-heading">Состояние источника: {health === 'healthy' ? 'стабильно' : health === 'degraded' ? 'есть ограничения' : 'не определено'}</h2><p>{health === 'degraded' ? 'Последнее обращение к источнику завершилось с ограничением. Сохранённые данные остаются доступны, но могут быть неполными.' : health === 'unknown' ? 'Нет подтверждённого результата проверки источника.' : 'Последняя проверка источника завершилась успешно.'}</p><ul className={styles.caveats}>{data.caveatCodes.map((code) => <li key={code}>{leasingCaveatCopy(code)}</li>)}</ul></section>
    <section aria-labelledby="summary-heading"><h2 id="summary-heading">Сводка по фильтру</h2><div className={styles.summary}>{data.summary.categoryTotals.filter((x) => x.count > 0).map((x) => <div key={x.value}><strong>{x.count}</strong><span>{leasingLabels[x.value] ?? x.value}</span></div>)}</div></section>
    <div className={styles.resultHeading}><h2>Сигналы</h2><span>{data.totalCount.toLocaleString('ru-RU')}</span></div>
    {data.items.length === 0 ? <div className={styles.empty}><h3>Сигналы не найдены</h3><p>Измените фильтры. Отсутствие результатов не доказывает отсутствие лизинговой активности.</p></div> : <div className={styles.feed}>{data.items.map((item) => <article key={item.classificationId} className={styles.card}><div className={styles.cardHeader}><div><p className={styles.eyebrow}>Слабая сторона сообщения</p><h3>{item.companyName}</h3></div><span className={item.sourceStatus === 'stale' ? styles.staleBadge : styles.freshBadge}>{leasingLabels[item.sourceStatus]}</span></div><p className={styles.asset}>{item.assetDescription}</p><blockquote>{item.evidenceSnippet}</blockquote><dl className={styles.facts}><div><dt>Публикация</dt><dd>{displayDate(item.publishedDate)} · {displayTime(item.publishedAtUtc)}</dd></div><div><dt>Получено</dt><dd>{displayTime(item.fetchedAtUtc)}</dd></div><div><dt>Актуально до</dt><dd>{displayTime(item.freshUntilUtc)}</dd></div><div><dt>Категория и релевантность</dt><dd>{leasingLabels[item.category] ?? item.category}; {leasingLabels[item.relevance] ?? item.relevance}</dd></div><div><dt>Классификация</dt><dd>{leasingLabels[item.classificationConfidence] ?? item.classificationConfidence}; {leasingLabels[item.classificationReviewState] ?? item.classificationReviewState}</dd></div><div><dt>Извлечение</dt><dd>{leasingLabels[item.extractionStatus] ?? item.extractionStatus}; {leasingLabels[item.extractionConfidence] ?? item.extractionConfidence}; {leasingLabels[item.extractionReviewState] ?? item.extractionReviewState}</dd></div></dl>{item.extractedDates.length > 0 && <p className={styles.dates}><strong>Извлечённые даты:</strong> {item.extractedDates.map((date) => `${date.dateKind}: ${displayDate(date.value)}`).join('; ')}</p>}<details><summary>Правила и оговорки</summary><p>Метод: детерминированные правила. {item.ruleIds.length ? `Правила: ${item.ruleIds.join(', ')}.` : 'Совпавшие правила не указаны.'}</p><ul className={styles.caveats}>{item.caveatCodes.map((code) => <li key={code}>{leasingCaveatCopy(code)}</li>)}</ul></details></article>)}</div>}
    <nav className={styles.pagination} aria-label="Страницы результатов"><button type="button" onClick={previous} disabled={data.offset === 0}>Назад</button><span>{data.offset + 1}–{Math.min(data.offset + data.items.length, data.totalCount)} из {data.totalCount}</span><button type="button" onClick={next} disabled={!data.hasMore}>Далее</button></nav>
  </>;
}
