'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  createLeasingSavedSearch, deleteLeasingSavedSearch, getLeasingAlerts, LeasingApiError,
  listLeasingSavedSearches, markLeasingAlertRead, updateLeasingSavedSearch,
  type LeasingAlertFeedResponse, type LeasingIntelligenceResponse, type LeasingSavedSearchItem,
} from '@/lib/api/leasingIntelligence';
import { listCounterparties, type CounterpartyWatchlistItem } from '@/lib/api/counterpartyWatchlist';
import {
  alertableFiltersFromSuccessfulResponse, buildSavedSearchCreate, buildSavedSearchUpdate,
  containsDeletedLeasingPrivateMaterial, createLeasingRequestCoordinator, purgeDeletedLeasingPrivateState,
  type AlertableFilters,
} from '@/utils/leasingAlerts.logic.shared.mjs';
import styles from './leasing.module.css';
import alertStyles from './leasing-alerts.module.css';

const emptyFeed: LeasingAlertFeedResponse = {
  authorityAtUtc: '1970-01-01T00:00:00Z', offset: 0, limit: 25, hasMore: false, totalCount: 0, items: [],
};

function copyFor(error: unknown) {
  const status = error instanceof LeasingApiError ? error.status : 500;
  if (status === 400) return 'Проверьте название и фильтры сохранённого поиска.';
  if (status === 404) return 'Сохранённый поиск больше недоступен. Список обновлён.';
  if (status === 409) return 'Настройки изменились или конфликтуют. Список обновлён.';
  return 'Не удалось обновить лизинговые уведомления. Повторите попытку.';
}

export default function LeasingAlertsWorkspace({ successfulResponse, onUnauthorized }: {
  successfulResponse: LeasingIntelligenceResponse | null;
  onUnauthorized: () => void;
}) {
  const coordinator = useRef<ReturnType<typeof createLeasingRequestCoordinator> | null>(null);
  if (coordinator.current == null) coordinator.current = createLeasingRequestCoordinator();
  const deletedSearchIds = useRef(new Set<string>());
  const [saved, setSaved] = useState<LeasingSavedSearchItem[]>([]);
  const [counterparties, setCounterparties] = useState<CounterpartyWatchlistItem[]>([]);
  const [feed, setFeed] = useState<LeasingAlertFeedResponse>(emptyFeed);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [linkId, setLinkId] = useState<string | null>(null);
  const filters = alertableFiltersFromSuccessfulResponse(successfulResponse);

  const handle = useCallback((failure: unknown) => {
    if (failure instanceof LeasingApiError && failure.status === 401) { onUnauthorized(); return true; }
    setError(copyFor(failure)); return false;
  }, [onUnauthorized]);

  const load = useCallback(async (announce = false): Promise<boolean> => {
    const current = coordinator.current!.begin();
    setBusy(false); setLoading(true); setError('');
    try {
      const [savedPage, alertsPage, counterpartyPage] = await Promise.all([
        listLeasingSavedSearches(current.signal), getLeasingAlerts(0, 25, current.signal),
        listCounterparties(current.signal, { offset: 0, limit: 50 }),
      ]);
      if (!current.isCurrent()) return false;
      if (containsDeletedLeasingPrivateMaterial(savedPage.items, alertsPage.items, deletedSearchIds.current))
        throw new LeasingApiError(500);
      setSaved(savedPage.items); setFeed(alertsPage); setCounterparties(counterpartyPage.items.filter((item) => item.enabled));
      if (announce) setNotice('Сохранённые поиски и уведомления обновлены.');
      return true;
    } catch (failure) { if (current.isCurrent()) handle(failure); return false; }
    finally { if (current.isCurrent()) setLoading(false); }
  }, [handle]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(task); coordinator.current?.abort(); };
  }, [load]);

  function beginAction() {
    setLoading(false);
    return coordinator.current!.begin();
  }

  async function create(event: FormEvent) {
    event.preventDefault(); if (!filters || !name.trim()) return;
    if (linkId && !window.confirm('Связать поиск с профилем как неподтверждённый фильтр названия?')) return;
    const current = beginAction();
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await createLeasingSavedSearch(buildSavedSearchCreate(name.trim(), filters,
        filters.company ? linkId : null), current.signal);
      if (!current.isCurrent()) return;
      setSaved((items) => [created, ...items.filter((item) => item.id !== created.id)]);
      setName(''); setLinkId(null);
      setNotice(created.alertOptIn
        ? 'Сохранённый поиск найден.'
        : 'Поиск сохранён. Уведомления выключены; включение действует только для будущих сигналов.');
    } catch (failure) { if (current.isCurrent() && !handle(failure) && failure instanceof LeasingApiError && failure.status === 409) await load(); }
    finally { if (current.isCurrent()) setBusy(false); }
  }

  async function update(item: LeasingSavedSearchItem, next: {
    name: string; alertOptIn: boolean; counterpartyWatchlistEntryId: string | null;
  }) {
    if (next.counterpartyWatchlistEntryId !== item.counterpartyWatchlistEntryId &&
        !window.confirm(next.counterpartyWatchlistEntryId
          ? 'Связать поиск с профилем как неподтверждённый фильтр названия?'
          : 'Убрать сохранённый поиск из профиля контрагента?')) return;
    const current = beginAction();
    setBusy(true); setError(''); setNotice('');
    const itemFilters = { company: item.company, category: item.category, confidence: item.confidence,
      reviewState: item.reviewState } as AlertableFilters;
    try {
      const updated = await updateLeasingSavedSearch(item.id, buildSavedSearchUpdate(next.name.trim(), itemFilters,
        item.company ? next.counterpartyWatchlistEntryId : null, next.alertOptIn, item.version), current.signal);
      if (!current.isCurrent()) return;
      setSaved((items) => items.map((value) => value.id === updated.id ? updated : value));
      setNotice(next.alertOptIn
        ? 'Уведомления включены только для будущих сигналов.'
        : 'Настройки сохранены. Новые уведомления выключены.');
    } catch (failure) { if (current.isCurrent() && !handle(failure) && failure instanceof LeasingApiError && [404, 409].includes(failure.status)) await load(); }
    finally { if (current.isCurrent()) setBusy(false); }
  }

  async function remove(item: LeasingSavedSearchItem) {
    if (!window.confirm('Удалить поиск, его уведомления и связь с профилем без восстановления ожидающих совпадений?')) return;
    const current = beginAction();
    setBusy(true); setError(''); setNotice('');
    try {
      await deleteLeasingSavedSearch(item.id, item.version, current.signal);
      if (!current.isCurrent()) return;
      deletedSearchIds.current.add(item.id);
      setSaved((items) => purgeDeletedLeasingPrivateState(items, feed, item.id).saved);
      setFeed((value) => purgeDeletedLeasingPrivateState(saved, value, item.id).feed);
      if (await load(false))
        setNotice('Сохранённый поиск удалён. Ожидающие необработанные совпадения не будут восстановлены.');
    } catch (failure) { if (current.isCurrent() && !handle(failure) && failure instanceof LeasingApiError && [404, 409].includes(failure.status)) await load(); }
    finally { if (current.isCurrent()) setBusy(false); }
  }

  async function read(id: string) {
    const current = beginAction();
    setBusy(true); setError('');
    try {
      await markLeasingAlertRead(id, current.signal);
      if (!current.isCurrent()) return;
      const readAtUtc = new Date().toISOString();
      setFeed((value) => ({ ...value, items: value.items.map((item) => item.id === id ? { ...item, readAtUtc } : item) }));
      setNotice('Уведомление отмечено прочитанным.');
    } catch (failure) { if (current.isCurrent()) handle(failure); }
    finally { if (current.isCurrent()) setBusy(false); }
  }

  async function moreAlerts() {
    if (!feed.hasMore) return;
    const current = coordinator.current!.begin();
    setBusy(false); setLoading(true); setError('');
    try {
      const next = await getLeasingAlerts(feed.items.length, feed.limit, current.signal);
      if (!current.isCurrent()) return;
      setFeed((value) => ({ ...next, items: [...value.items,
        ...next.items.filter((item) => !value.items.some((currentItem) => currentItem.id === item.id))] }));
      setNotice(next.hasMore ? `Загружено ещё уведомлений: ${next.items.length}.` : 'Все уведомления загружены.');
    } catch (failure) { if (current.isCurrent()) handle(failure); }
    finally { if (current.isCurrent()) setLoading(false); }
  }

  return <section className={alertStyles.alertWorkspace} aria-labelledby="leasing-alerts-heading" aria-busy={loading || busy}>
    <div className={`${styles.resultHeading} ${alertStyles.heading}`}><h2 id="leasing-alerts-heading">Сохранённые поиски и уведомления</h2>
      <button type="button" className={styles.secondary} disabled={loading || busy} onClick={() => void load(true)}>Обновить</button></div>
    <p>Сохранение доступно только для последнего успешно загруженного результата с компанией или категорией. Уведомления выключены по умолчанию и не создаются задним числом.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={alertStyles.live} role="status" aria-live="polite">{notice}</div>
    <form className={alertStyles.saveForm} onSubmit={create}>
      <label>Название поиска<input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Показать в профиле контрагента<select value={linkId ?? ''} disabled={!filters?.company}
        onChange={(event) => setLinkId(event.target.value || null)}><option value="">Не связывать</option>
        {counterparties.map((item) => <option key={item.id} value={item.id}>{item.displayLabel || item.name || item.inn || item.ogrn || item.id}</option>)}</select></label>
      <button type="submit" disabled={busy || !filters || !name.trim() || saved.length >= 50}>Сохранить текущий результат</button>
    </form>
    {!filters && <p className={styles.state}>Примените фильтр компании или категории и дождитесь успешной загрузки, чтобы сохранить поиск.</p>}
    {saved.length === 0 ? <p className={styles.empty}>Сохранённых поисков пока нет.</p> :
      <ul className={alertStyles.savedList}>{saved.map((item) => <SavedSearchRow key={`${item.id}:${item.version}`} item={item} counterparties={counterparties}
        busy={busy} onUpdate={update} onDelete={remove} />)}</ul>}
    <h3>Лизинговые уведомления</h3>
    {feed.items.length === 0 ? <p className={styles.empty}>Новых лизинговых уведомлений нет. Это не доказывает отсутствие активности.</p> :
      <ul className={alertStyles.alertList}>{feed.items.map((item) => <li key={item.id}>
        <strong>{item.savedSearchName}</strong><span>{item.evidence.companyName} — {item.evidence.assetDescription}</span>
        <small>Связь основана на пользовательском фильтре; идентичность не подтверждена.</small>
        {item.readAtUtc ? <span>Прочитано</span> : <button type="button" className={styles.secondary} disabled={busy} onClick={() => void read(item.id)}>Отметить прочитанным</button>}
      </li>)}</ul>}
    {feed.hasMore && <button type="button" className={styles.secondary} disabled={loading || busy}
      onClick={() => void moreAlerts()}>Показать ещё уведомления</button>}
  </section>;
}

function SavedSearchRow({ item, counterparties, busy, onUpdate, onDelete }: {
  item: LeasingSavedSearchItem; counterparties: CounterpartyWatchlistItem[]; busy: boolean;
  onUpdate: (item: LeasingSavedSearchItem, next: { name: string; alertOptIn: boolean; counterpartyWatchlistEntryId: string | null }) => Promise<void>;
  onDelete: (item: LeasingSavedSearchItem) => Promise<void>;
}) {
  const [name, setName] = useState(item.name);
  const [optIn, setOptIn] = useState(item.alertOptIn);
  const [linkId, setLinkId] = useState(item.counterpartyWatchlistEntryId ?? '');
  return <li><form onSubmit={(event) => { event.preventDefault(); void onUpdate(item, { name, alertOptIn: optIn, counterpartyWatchlistEntryId: linkId || null }); }}>
    <label>Название<input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <span>{item.company || 'Все компании'} · {item.category || 'Все категории'}</span>
    <label className={alertStyles.checkbox}><input type="checkbox" checked={optIn} onChange={(event) => setOptIn(event.target.checked)} />Будущие уведомления</label>
    <label>Профиль<select value={linkId} disabled={!item.company} onChange={(event) => setLinkId(event.target.value)}><option value="">Не связывать</option>
      {counterparties.map((counterparty) => <option key={counterparty.id} value={counterparty.id}>{counterparty.displayLabel || counterparty.name || counterparty.inn || counterparty.ogrn || counterparty.id}</option>)}</select></label>
    <div className={`${styles.actions} ${alertStyles.rowActions}`}><button type="submit" disabled={busy || !name.trim()}>Сохранить настройки</button>
      <button type="button" className={alertStyles.danger} disabled={busy} onClick={() => void onDelete(item)}>Удалить</button></div>
  </form></li>;
}
