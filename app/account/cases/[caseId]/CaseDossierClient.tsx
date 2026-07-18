'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  CaseDossierApiError, createDirectCaseWatch, getCaseDossier, updateDirectCaseWatch,
  type CaseDossierPayload,
} from '@/lib/api/caseDossier';
import {
  actionLabel, caveatLabel, dossierFileName, formatInstant, freshnessLabel,
  problemLabel, safeSourceReference, stateLabel,
} from '@/lib/api/caseDossier.logic.mjs';
import styles from './case-dossier.module.css';

function focusLater(element: HTMLElement | null) {
  if (element) requestAnimationFrame(() => element.focus());
}

export default function CaseDossierClient({ caseId }: { caseId: string }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const sessionKey = user?.id ?? user?.email ?? '';

  useEffect(() => {
    if (!authLoading && !sessionKey) {
      router.replace(`/login?returnUrl=${encodeURIComponent(`/account/cases/${caseId}`)}`);
    }
  }, [authLoading, caseId, router, sessionKey]);

  if (authLoading || !sessionKey) {
    return <main className={styles.container}><p role="status">Проверяем сессию…</p></main>;
  }
  return <OwnerDossier key={`${sessionKey}:${caseId}`} caseId={caseId} />;
}

function OwnerDossier({ caseId }: { caseId: string }) {
  const router = useRouter();
  const controller = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const errorSummary = useRef<HTMLDivElement>(null);
  const watchLabelInput = useRef<HTMLInputElement>(null);
  const watchControls = useRef<HTMLDivElement>(null);
  const restoreWatchAction = useRef<'create' | 'toggle' | 'alerts' | 'update' | null>(null);
  const [payload, setPayload] = useState<CaseDossierPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingWatch, setEditingWatch] = useState(false);
  const [watchLabel, setWatchLabel] = useState('');

  const loadDossier = useCallback(async (announce = false) => {
    controller.current?.abort();
    const current = new AbortController();
    const version = ++requestVersion.current;
    controller.current = current;
    setLoading(true); setError('');
    try {
      const result = await getCaseDossier(caseId, current.signal);
      if (current.signal.aborted || version !== requestVersion.current) return;
      setPayload(result);
      if (announce) setNotice('Досье обновлено после изменения наблюдения.');
    } catch (requestError) {
      if (current.signal.aborted || version !== requestVersion.current) return;
      if (requestError instanceof CaseDossierApiError && requestError.status === 401) {
        router.replace(`/login?returnUrl=${encodeURIComponent(`/account/cases/${caseId}`)}`);
        return;
      }
      setPayload(null);
      setError(problemLabel(requestError instanceof CaseDossierApiError ? requestError.status : 500));
      focusLater(errorSummary.current);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [caseId, router]);

  useEffect(() => {
    // This keyed owner component performs one initial private read for the current route/session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDossier();
    return () => { controller.current?.abort(); requestVersion.current += 1; };
  }, [loadDossier]);

  useEffect(() => { if (error) focusLater(errorSummary.current); }, [error]);

  useEffect(() => {
    if (editingWatch) focusLater(watchLabelInput.current);
  }, [editingWatch]);

  useEffect(() => {
    if (busy || !restoreWatchAction.current) return;
    const action = restoreWatchAction.current;
    restoreWatchAction.current = null;
    const selector = action === 'update' ? '[data-action="update-direct-watch"]'
      : action === 'alerts' ? '[data-action="set-alert-opt-in"]'
        : '[data-action="enable-direct-watch"], [data-action="disable-direct-watch"]';
    focusLater(watchControls.current?.querySelector<HTMLButtonElement>(selector) ?? null);
  }, [busy, payload]);

  async function mutateWatch(action: 'create' | 'toggle' | 'alerts' | 'update') {
    const dossier = payload?.dossier;
    if (!dossier || busy) return;
    const mutation = new AbortController();
    setBusy(true); setError(''); setNotice('');
    try {
      const watch = dossier.watch.directWatch;
      if (action === 'create') {
        await createDirectCaseWatch(dossier.case.caseNumber, dossier.case.caseNumber, mutation.signal);
      } else if (watch) {
        await updateDirectCaseWatch(
          watch.id, watch.version,
          action === 'toggle' ? !watch.enabled : watch.enabled,
          action === 'alerts' ? !watch.alertOptIn : watch.alertOptIn,
          action === 'update' ? watchLabel.trim() || null : watch.displayLabel ?? null,
          mutation.signal,
        );
      }
      setEditingWatch(false);
      await loadDossier(true);
      restoreWatchAction.current = action;
    } catch (requestError) {
      if (requestError instanceof CaseDossierApiError && requestError.status === 401) {
        router.replace(`/login?returnUrl=${encodeURIComponent(`/account/cases/${caseId}`)}`);
      } else if (requestError instanceof CaseDossierApiError && requestError.status === 409) {
        await loadDossier(true);
        restoreWatchAction.current = action;
      } else {
        setError(problemLabel(requestError instanceof CaseDossierApiError ? requestError.status : 500));
        focusLater(errorSummary.current);
      }
    } finally { setBusy(false); }
  }

  function downloadJson() {
    if (!payload) return;
    const bytes = payload.bytes.slice();
    const blob = new Blob([bytes], { type: 'application/json; charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = dossierFileName(payload.dossier.case.caseId);
    anchor.click();
    URL.revokeObjectURL(href);
  }

  if (loading && !payload) return <main className={styles.container}><p role="status" aria-live="polite">Формируем досье…</p></main>;

  if (error || !payload) return <main className={styles.container}>
    <div ref={errorSummary} tabIndex={-1} role="alert" className={styles.error}>{error || 'Досье недоступно.'}</div>
    <button type="button" className={styles.primary} onClick={() => void loadDossier()}>Повторить</button>
  </main>;

  const dossier = payload.dossier;
  const watch = dossier.watch.directWatch;
  const openWatchEditor = () => {
    setWatchLabel(watch?.displayLabel ?? '');
    setEditingWatch(true);
  };
  const offlineActions = dossier.allowedActions.filter((action) => action === 'export-json' || action === 'print');
  const watchActions = dossier.allowedActions.filter((action) => action !== 'export-json' && action !== 'print');
  return <main className={styles.container}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Приватное досье</p><h1>{dossier.case.caseNumber}</h1>
        <p>{stateLabel(dossier.state)} · сформировано {formatInstant(dossier.generatedAtUtc)}</p></div>
      <div className={styles.actions}>{offlineActions.map((action) => action === 'export-json'
        ? <button key={action} type="button" onClick={downloadJson}>Скачать JSON</button>
        : <button key={action} type="button" onClick={() => window.print()}>Печать</button>)}</div>
    </header>
    <p className={styles.disclaimer}>Информация предназначена для поддержки решений и не является юридической консультацией.</p>
    <div role="status" aria-live="polite" className={styles.notice}>{notice}</div>
    {error && <div ref={errorSummary} tabIndex={-1} role="alert" className={styles.error}>{error}</div>}

    <section className={styles.card} aria-labelledby="subjects-heading">
      <h2 id="subjects-heading">Участники</h2>
      <p>{dossier.subjectsReturned} из {dossier.subjectsTotal}{dossier.subjectsTruncated ? ' · список сокращён' : ''}</p>
      <div className={styles.grid}>{dossier.subjects.map((subject) => <article key={subject.subjectReference} className={styles.item}>
        <h3>{subject.displayName}</h3><p>ИНН: {subject.inn ?? 'нет данных'} · ОГРН: {subject.ogrn ?? 'нет данных'}</p>
        <small>{subject.identityConfidence} · {subject.identityProvenance}</small>
      </article>)}</div>
    </section>

    <section className={styles.card} aria-labelledby="bankruptcy-heading">
      <h2 id="bankruptcy-heading">Федресурс и банкротство</h2>
      <p>{stateLabel(dossier.bankruptcy.presentationState)} · проекций {dossier.bankruptcy.projectionsReturned} из {dossier.bankruptcy.projectionsTotal}</p>
      <p><small>Наблюдений источника: {dossier.bankruptcy.authorityMembersReturned} из {dossier.bankruptcy.authorityMembersTotal}
        {dossier.bankruptcy.authorityMembersTruncated ? ' · список наблюдений сокращён' : ''}. Доказательств по делу: {dossier.bankruptcy.caseEvidenceReturned} из {dossier.bankruptcy.caseEvidenceTotal}
        {dossier.bankruptcy.caseEvidenceTruncated ? ' · часть доказательств не показана' : ''}.</small></p>
      {dossier.bankruptcy.projections.map((projection) => <article key={projection.subjectReference} className={styles.item}>
        <h3>{stateLabel(projection.presentationState)}</h3>
        <p><small>Текущая authority: {projection.authorityMembersReturned} из {projection.authorityMembersTotal}
          {projection.authorityMembersTruncated ? ' · список сокращён' : ''}</small></p>
        {projection.authorityMembers.map((member) => <div key={member.memberOrdinal} className={styles.evidence}>
          <p>Наблюдение {member.memberOrdinal}: {stateLabel(member.actualSourceStatus)} · {member.safeCode}</p>
          <p><small>Достоверность: {member.confidence} · получено {formatInstant(member.sourceFetchedAtUtc)} · связано {formatInstant(member.linkedAtUtc)}</small></p>
          <p><small>Повтор запроса: {member.retryable ? 'допустим' : 'не предусмотрен'} · канонических дел: {member.canonicalCaseCount} · доказательств всего: {member.canonicalEvidenceCount} · по этому делу: {member.caseEvidenceReturned} из {member.caseEvidenceTotal}{member.caseEvidenceTruncated ? ' (список сокращён)' : ''} · по другим делам: {member.otherCaseEvidenceCount}</small></p>
          {member.evidence.map((evidence) => {
            const href = safeSourceReference(evidence.sourceReference);
            return <p key={evidence.evidenceReference}>{evidence.messageType} · {formatInstant(evidence.publicationDateUtc)}{' '}
              {href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Открыть источник</a> : <span>Ссылка источника недоступна</span>}</p>;
          })}
        </div>)}
        {projection.priorAuthority && <div className={styles.prior}>
          <h4>Ранее подтверждённые сведения</h4>
          <p>{stateLabel(projection.priorAuthority.presentationState)} · актуально на {formatInstant(projection.priorAuthority.authorityAtUtc)}</p>
          <p><small>Предыдущая authority: {projection.priorAuthority.authorityMembersReturned} из {projection.priorAuthority.authorityMembersTotal}
            {projection.priorAuthority.authorityMembersTruncated ? ' · список сокращён' : ''}</small></p>
          {projection.priorAuthority.authorityMembers.map((member) => <div key={`prior:${member.memberOrdinal}`} className={styles.evidence}>
            <p>Предыдущее наблюдение {member.memberOrdinal}: {stateLabel(member.actualSourceStatus)} · {member.safeCode}</p>
            <p><small>Достоверность: {member.confidence} · получено {formatInstant(member.sourceFetchedAtUtc)}</small></p>
            <p><small>Повтор запроса: {member.retryable ? 'допустим' : 'не предусмотрен'} · канонических дел: {member.canonicalCaseCount} · доказательств всего: {member.canonicalEvidenceCount} · по этому делу: {member.caseEvidenceReturned} из {member.caseEvidenceTotal}{member.caseEvidenceTruncated ? ' (список сокращён)' : ''} · по другим делам: {member.otherCaseEvidenceCount}</small></p>
            {member.evidence.map((evidence) => {
              const href = safeSourceReference(evidence.sourceReference);
              return <p key={evidence.evidenceReference}>{evidence.messageType} · {formatInstant(evidence.publicationDateUtc)}{' '}
                {href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Открыть предыдущий источник</a> : <span>Ссылка источника недоступна</span>}</p>;
            })}
          </div>)}
        </div>}
      </article>)}
    </section>

    <section className={styles.card} aria-labelledby="timeline-heading">
      <h2 id="timeline-heading">Хронология дела</h2>
      <p>{stateLabel(dossier.timeline.presentationStatus)} · событий {dossier.timeline.eventsReturned} из {dossier.timeline.eventsTotal}</p>
      <p><small>{dossier.timeline.eventsTruncatedBefore ? 'Ранние события не показаны. ' : ''}Документов: {dossier.timeline.documentsReturned} из {dossier.timeline.documentsTotal}{dossier.timeline.documentsTruncated ? ' · часть документов не показана' : ''}.</small></p>
      <p><small>Достоверность: {dossier.timeline.confidence} · {freshnessLabel(dossier.timeline.freshness)} · источник обновлён {formatInstant(dossier.timeline.sourceUpdatedAtUtc)} · локальный снимок {formatInstant(dossier.timeline.locallyUpdatedAtUtc)}</small></p>
      <ol className={styles.timeline}>{dossier.timeline.events.map((event, index) => <li key={`${event.occurredAtUtc}:${event.revision}:${index}`}>
        <h3>{event.title}</h3><p>{formatInstant(event.occurredAtUtc)} · {event.eventType}</p>
        {event.summary && <p>{event.summary}</p>}
        {event.documents.map((document, documentIndex) => {
          const href = safeSourceReference(document.sourceReference);
          return <p key={`${document.name}:${documentIndex}`}>{document.name} · {href
            ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Документ</a>
            : <span>Ссылка источника недоступна</span>}</p>;
        })}<p><small>Документов события: {event.returnedDocumentCount} из {event.documentCount}{event.documentsTruncated ? ' · список сокращён' : ''}</small></p>
      </li>)}</ol>
    </section>

    {dossier.sourceIssues.length > 0 && <section className={styles.card} aria-labelledby="issues-heading">
      <h2 id="issues-heading">Ограничения источников</h2>
      <p>{dossier.sourceIssuesReturned} из {dossier.sourceIssuesTotal}{dossier.sourceIssuesTruncated ? ' · список ограничений сокращён' : ''}</p>
      <ul>{dossier.sourceIssues.map((issue, index) => <li key={`${issue.source}:${issue.section}:${issue.safeCode}:${index}`}>
        {issue.source}: {stateLabel(issue.presentationState)} ({issue.safeCode})
        {issue.omittedSubjectCount ? ` · скрытых участников: ${issue.omittedSubjectCount}` : ''}
      </li>)}</ul>
    </section>}

    <section className={styles.card} aria-labelledby="caveats-heading">
      <h2 id="caveats-heading">Что важно учитывать</h2>
      <ul>{dossier.caveats.map((caveat) => <li key={caveat}>{caveatLabel(caveat)}</li>)}</ul>
      <h3>Доступные действия</h3>
      <ul>{dossier.allowedActions.map((action) => <li key={action}>{actionLabel(action)}</li>)}</ul>
    </section>

    <section className={styles.card} aria-labelledby="watch-heading">
      <h2 id="watch-heading">Наблюдение</h2>
      <p>Связанных наблюдений: {dossier.watch.indirectWatchCount}</p>
      <div ref={watchControls} className={styles.actions}>{watchActions.map((action) => {
        if (action === 'create-direct-watch') return <button key={action} data-action={action} type="button" disabled={busy} onClick={() => void mutateWatch('create')}>Добавить наблюдение</button>;
        if (action === 'update-direct-watch') return <button key={action} data-action={action} type="button" disabled={busy} onClick={openWatchEditor}>Изменить наблюдение</button>;
        if (action === 'enable-direct-watch' || action === 'disable-direct-watch') return <button key={action} data-action={action} type="button" disabled={busy} onClick={() => void mutateWatch('toggle')}>{action === 'disable-direct-watch' ? 'Отключить' : 'Включить'} наблюдение</button>;
        if (action === 'set-alert-opt-in') return <button key={action} data-action={action} type="button" disabled={busy} onClick={() => void mutateWatch('alerts')}>{watch?.alertOptIn ? 'Отключить' : 'Включить'} уведомления</button>;
        return null;
      })}</div>
      {editingWatch && watch && <form className={styles.watchEditor} onSubmit={(event) => { event.preventDefault(); void mutateWatch('update'); }}>
        <label htmlFor="case-dossier-watch-label">Метка для себя</label>
        <input ref={watchLabelInput} id="case-dossier-watch-label" autoComplete="off" maxLength={160} value={watchLabel} onChange={(event) => setWatchLabel(event.target.value)} />
        <div className={styles.actions}>
          <button type="submit" disabled={busy}>Сохранить метку</button>
          <button type="button" disabled={busy} onClick={() => setEditingWatch(false)}>Отмена</button>
        </div>
      </form>}
    </section>
  </main>;
}
