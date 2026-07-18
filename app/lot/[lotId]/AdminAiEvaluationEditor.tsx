'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { components } from '@/lib/generated/lots-webapi';
import { buildAdminEvaluationPatchFields } from '@/utils/adminAiEvaluationEditor.logic.shared.mjs';

export type AdminAiEvaluationSnapshot = components['schemas']['AdminEvaluationEditorialSnapshotDto'];
type Snapshot = AdminAiEvaluationSnapshot;
type PatchFields = NonNullable<components['schemas']['AdminEvaluationPatchFieldsDto']>;
type Revision = components['schemas']['AdminEvaluationRevisionDto'];
type Op = 'keep' | 'set' | 'clear';

type FieldName = 'estimatedPrice' | 'liquidityScore' | 'investmentSummary' | 'reasoningText';

type FieldState = {
  op: Op;
  value: string;
};

const FIELD_LABELS: Record<FieldName, string> = {
  estimatedPrice: 'Оценочная цена',
  liquidityScore: 'Ликвидность',
  investmentSummary: 'Резюме',
  reasoningText: 'Детальное рассуждение',
};

const INITIAL_FIELDS: Record<FieldName, FieldState> = {
  estimatedPrice: { op: 'keep', value: '' },
  liquidityScore: { op: 'keep', value: '' },
  investmentSummary: { op: 'keep', value: '' },
  reasoningText: { op: 'keep', value: '' },
};

function formatMoney(value?: number | null) {
  return value == null ? '—' : `${value.toLocaleString('ru-RU')} ₽`;
}

function formatText(value?: string | null) {
  return value && value.trim() ? value : '—';
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU');
}

function revisionTitle(revision: Revision) {
  return `v${revision.expectedVersion ?? '?'} → v${revision.newVersion ?? '?'} · ${formatDate(revision.editedAt)}`;
}

export default function AdminAiEvaluationEditor({
  lotPublicId,
  onSnapshotChange,
}: {
  lotPublicId: number | string;
  onSnapshotChange?: (snapshot: Snapshot) => void;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [fields, setFields] = useState<Record<FieldName, FieldState>>(INITIAL_FIELDS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL;

  const loadSnapshot = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/lots/${lotPublicId}/evaluation/editorial`, {
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error(`Не удалось загрузить редакторскую оценку (${res.status})`);
      }

      const data = await res.json() as Snapshot;
      const headerEtag = res.headers.get('ETag');
      const nextSnapshot = headerEtag ? { ...data, eTag: headerEtag } : data;
      setSnapshot(nextSnapshot);
      onSnapshotChange?.(nextSnapshot);
      setFields(INITIAL_FIELDS);
    } catch (e: any) {
      setError(e.message ?? 'Ошибка загрузки редакторской оценки');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotPublicId, apiUrl]);

  const hasChanges = useMemo(
    () => Object.values(fields).some((field) => field.op === 'set' || field.op === 'clear'),
    [fields],
  );
  const patchBuild = useMemo(() => buildAdminEvaluationPatchFields(fields), [fields]);
  const canSave = hasChanges && patchBuild.fields !== null;

  const setField = (name: FieldName, patch: Partial<FieldState>) => {
    setFields((current) => ({
      ...current,
      [name]: { ...current[name], ...patch },
    }));
  };

  const handleSave = async () => {
    if (!snapshot || !canSave || !patchBuild.fields) return;

    const clearFields = Object.entries(fields)
      .filter(([, value]) => value.op === 'clear')
      .map(([name]) => FIELD_LABELS[name as FieldName]);

    if (clearFields.length > 0 && !confirm(`Подтвердите очистку полей: ${clearFields.join(', ')}`)) {
      return;
    }

    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/api/lots/${lotPublicId}/evaluation/editorial`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': snapshot.eTag ?? '',
        },
        credentials: 'include',
        body: JSON.stringify({
          expectedVersion: snapshot.version,
          fields: patchBuild.fields as PatchFields,
        }),
      });

      if (res.status === 412) {
        await loadSnapshot();
        setError('Данные изменились, проверьте актуальную версию и повторите правку.');
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.title ?? body?.message ?? `Ошибка сохранения (${res.status})`);
      }

      const data = await res.json() as Snapshot;
      const headerEtag = res.headers.get('ETag');
      const nextSnapshot = headerEtag ? { ...data, eTag: headerEtag } : data;
      setSnapshot(nextSnapshot);
      onSnapshotChange?.(nextSnapshot);
      setFields(INITIAL_FIELDS);
      setMessage('Ручная оценка сохранена. История обновлена, IndexNow отправлен после commit.');
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'Ошибка сохранения редакторской оценки');
    } finally {
      setIsSaving(false);
    }
  };

  const renderControl = (name: FieldName, input: 'number' | 'text' | 'textarea') => {
    const state = fields[name];
    const fieldError = patchBuild.errors[name];
    return (
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.75rem', background: '#fff' }}>
        <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{FIELD_LABELS[name]}</div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          {(['keep', 'set', 'clear'] as Op[]).map((op) => (
            <label key={op} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input
                type="radio"
                checked={state.op === op}
                onChange={() => setField(name, { op })}
              />
              {op === 'keep' ? 'Оставить' : op === 'set' ? 'Задать' : 'Очистить'}
            </label>
          ))}
        </div>
        {state.op === 'set' && input === 'textarea' && (
          <textarea
            value={state.value}
            onChange={(e) => setField(name, { value: e.target.value })}
            rows={name === 'reasoningText' ? 6 : 3}
            style={{ width: '100%', padding: '0.5rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
          />
        )}
        {state.op === 'set' && input !== 'textarea' && (
          <input
            type={input}
            value={state.value}
            onChange={(e) => setField(name, { value: e.target.value })}
            min={name === 'estimatedPrice' ? 0 : name === 'liquidityScore' ? 1 : undefined}
            max={name === 'estimatedPrice' ? 1_000_000_000_000_000 : name === 'liquidityScore' ? 10 : undefined}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? `${name}-error` : undefined}
            style={{ width: '100%', padding: '0.5rem', border: `1px solid ${fieldError ? '#dc2626' : '#cbd5e1'}`, borderRadius: 6 }}
          />
        )}
        {fieldError && (
          <div id={`${name}-error`} role="alert" style={{ marginTop: '0.375rem', color: '#b91c1c', fontSize: '0.875rem' }}>
            {fieldError}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return <div style={{ color: '#64748b' }}>Загрузка AI editorial editor…</div>;
  }

  if (error && !snapshot) {
    return <div style={{ color: '#dc2626' }}>❌ {error}</div>;
  }

  if (!snapshot) return null;

  return (
    <section style={{ border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 12, padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: '#1e3a8a' }}>Редактор AI-оценки (admin)</h2>
          <p style={{ margin: '0.25rem 0 0', color: '#475569' }}>Версия: {snapshot.version} · ETag: {snapshot.eTag}</p>
        </div>
        <button onClick={loadSnapshot} disabled={isSaving} style={{ padding: '0.5rem 0.75rem' }}>Обновить</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
        <div style={{ background: '#fff', borderRadius: 8, padding: '0.75rem' }}>
          <h3 style={{ marginTop: 0 }}>Quick fields</h3>
          <div>Цена: <b>{formatMoney(snapshot.quick?.estimatedPrice)}</b></div>
          <div>Уверенность: <b>{snapshot.quick?.priceConfidence ?? '—'}</b></div>
          <div>Резюме: {formatText(snapshot.quick?.investmentSummary)}</div>
        </div>
        <div style={{ background: '#fff', borderRadius: 8, padding: '0.75rem' }}>
          <h3 style={{ marginTop: 0 }}>Deep snapshot</h3>
          <div>Цена: <b>{formatMoney(snapshot.deep?.estimatedPrice)}</b></div>
          <div>Ликвидность: <b>{snapshot.deep?.liquidityScore ?? '—'}</b></div>
          <div>Источник: <b>{snapshot.deep?.source ?? '—'}</b></div>
          <div>Резюме: {formatText(snapshot.deep?.investmentSummary)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
        {renderControl('estimatedPrice', 'number')}
        {renderControl('liquidityScore', 'number')}
        {renderControl('investmentSummary', 'textarea')}
        {renderControl('reasoningText', 'textarea')}
      </div>

      {error && <div style={{ marginTop: '0.75rem', color: '#b91c1c' }}>❌ {error}</div>}
      {message && <div style={{ marginTop: '0.75rem', color: '#166534' }}>✅ {message}</div>}

      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={handleSave}
          disabled={isSaving || !canSave}
          style={{ padding: '0.625rem 1rem', background: canSave ? '#2563eb' : '#94a3b8', color: '#fff', borderRadius: 6, border: 0 }}
        >
          {isSaving ? 'Сохранение…' : 'Сохранить ручную правку'}
        </button>
      </div>

      <details style={{ marginTop: '1rem' }} open={Boolean(snapshot.revisions?.length)}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>История правок ({snapshot.revisions?.length ?? 0})</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
          {(snapshot.revisions ?? []).map((revision) => (
            <div key={revision.id} style={{ background: '#fff', borderRadius: 8, padding: '0.75rem', border: '1px solid #dbeafe' }}>
              <div style={{ fontWeight: 700 }}>{revisionTitle(revision)}</div>
              <div>Редактор: {revision.editorEmail ?? revision.editorUserId ?? '—'}</div>
              <div>Цена: {formatMoney(revision.previousEstimatedPrice)} → {formatMoney(revision.newEstimatedPrice)}</div>
              <div>Ликвидность: {revision.previousLiquidityScore ?? '—'} → {revision.newLiquidityScore ?? '—'}</div>
              <div>IndexNow URL: {revision.indexNowUrl ?? '—'}</div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
