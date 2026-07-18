import { getBackendBaseUrl } from '@/lib/api/backendClient';

export type CaseBatchPreviewRow = {
  rowNumber: number;
  status?: string | null;
  classification?: string | null;
  issueCode?: string | null;
  issueCodes?: string[] | null;
  targetKind?: string | null;
  maskedDisplay?: string | null;
  maskedTarget?: string | null;
  duplicateOfRowNumber?: number | null;
};

export type CaseBatchPreview = {
  contractVersion?: string | null;
  previewToken: string;
  expiresAtUtc?: string | null;
  totalRows: number;
  validRows?: number;
  invalidRows?: number;
  duplicateRows?: number;
  alreadyKnownRows?: number;
  wouldCheckRows?: number;
  skippedRows?: number;
  counts?: Record<string, number>;
  rows: CaseBatchPreviewRow[];
  reportTruncated?: boolean;
};

export type CaseBatchJob = {
  id: string;
  status: string;
  createdAtUtc?: string | null;
  updatedAtUtc?: string | null;
  totalItems?: number;
  pendingItems?: number;
  processingItems?: number;
  completedItems?: number;
  failedItems?: number;
  canceledItems?: number;
  version?: number;
  finishedAtUtc?: string | null;
  caveatCode?: string | null;
  canCancel: boolean;
  canResume: boolean;
  canRetryFailed: boolean;
};

export type CaseBatchItem = {
  id: string;
  rowNumber?: number;
  targetKind?: string | null;
  maskedDisplay?: string | null;
  status: string;
  resultKind?: string | null;
  evidenceKind?: string | null;
  evidenceReferenceId?: string | null;
  confidenceCode?: string | null;
  provenanceCode?: string | null;
  caveatCode: string;
  acceptedAtUtc?: string | null;
  sourceAtUtc?: string | null;
  safeRouteReference?: string | null;
};

export type CaseBatchPage<T> = {
  items: T[];
  offset?: number;
  limit?: number;
  hasMore?: boolean;
};

export class CaseBatchApiError extends Error {
  constructor(public readonly status: number) {
    super(`Case batch request failed: ${status}`);
    this.name = 'CaseBatchApiError';
  }
}

function url(path: string): string {
  return `${getBackendBaseUrl()}${path}`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url(path), { ...init, credentials: 'include' });
  if (!response.ok) throw new CaseBatchApiError(response.status);
  return response;
}

function uploadBody(file: File, previewToken?: string): FormData {
  const body = new FormData();
  body.append('file', file);
  if (previewToken) {
    body.append('previewToken', previewToken);
    body.append('confirm', 'true');
  }
  return body;
}

export async function previewCaseBatch(file: File, idempotencyKey: string, signal?: AbortSignal): Promise<CaseBatchPreview> {
  const response = await request('/api/case-batches/preview', {
    method: 'POST', body: uploadBody(file), signal,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.json() as Promise<CaseBatchPreview>;
}

export async function confirmCaseBatch(file: File, idempotencyKey: string, previewToken: string, signal?: AbortSignal): Promise<CaseBatchJob> {
  const response = await request('/api/case-batches/confirm', {
    method: 'POST', body: uploadBody(file, previewToken), signal,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.json() as Promise<CaseBatchJob>;
}

export async function listCaseBatches(signal?: AbortSignal): Promise<CaseBatchPage<CaseBatchJob>> {
  const response = await request('/api/case-batches', { signal });
  return response.json() as Promise<CaseBatchPage<CaseBatchJob>>;
}

export async function getCaseBatch(jobId: string, signal?: AbortSignal): Promise<CaseBatchJob> {
  const response = await request(`/api/case-batches/${encodeURIComponent(jobId)}`, { signal });
  return response.json() as Promise<CaseBatchJob>;
}

export async function getCaseBatchItems(
  jobId: string,
  offset = 0,
  limit = 100,
  signal?: AbortSignal,
): Promise<CaseBatchPage<CaseBatchItem>> {
  const response = await request(
    `/api/case-batches/${encodeURIComponent(jobId)}/items?offset=${offset}&limit=${limit}`,
    { signal },
  );
  return response.json() as Promise<CaseBatchPage<CaseBatchItem>>;
}

async function control(jobId: string, action: 'cancel' | 'resume' | 'retry-failed', signal?: AbortSignal): Promise<CaseBatchJob> {
  const response = await request(`/api/case-batches/${encodeURIComponent(jobId)}/${action}`, { method: 'POST', signal });
  return response.json() as Promise<CaseBatchJob>;
}

export function cancel(jobId: string, signal?: AbortSignal): Promise<CaseBatchJob> {
  return control(jobId, 'cancel', signal);
}

export function resume(jobId: string, signal?: AbortSignal): Promise<CaseBatchJob> {
  return control(jobId, 'resume', signal);
}

export function retryFailed(jobId: string, signal?: AbortSignal): Promise<CaseBatchJob> {
  return control(jobId, 'retry-failed', signal);
}

export async function exportCaseBatch(jobId: string, format: 'csv' | 'json', signal?: AbortSignal): Promise<Blob> {
  const response = await request(`/api/case-batches/${encodeURIComponent(jobId)}/export?format=${format}`, { signal });
  return response.blob();
}
