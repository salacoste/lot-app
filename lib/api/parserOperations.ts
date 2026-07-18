import { getBackendBaseUrl } from '@/lib/api/backendClient';
import type { components } from '@/lib/generated/lots-webapi';
import {
  validateParserActionResponse, validateParserAttemptPage, validateParserRun,
  validateParserRunPage, validateParserTaskPage, readBoundedParserExport,
} from '@/utils/parserOperations.logic.shared.mjs';

export type ParserRun = components['schemas']['ParserOperationRunSummaryDto'];
export type ParserRunPage = components['schemas']['ParserOperationRunPageDto'];
export type ParserTask = components['schemas']['ParserOperationTaskItemDto'];
export type ParserTaskPage = components['schemas']['ParserOperationTaskPageDto'];
export type ParserAttemptPage = components['schemas']['ParserOperationAttemptPageDto'];
export type ParserAction = 'cancel' | 'resume' | 'retry-failed' | 'retry-selected';
export type ParserActionResponse = { operationId: string; action: ParserAction; runId: string; affectedTaskCount: number; authorityAtUtc: string; run: ParserRun };

export class ParserOperationsApiError extends Error {
  constructor(public readonly status: number) { super(`Parser operations request failed: ${status}`); this.name = 'ParserOperationsApiError'; }
}

const endpoint = (path: string) => `${getBackendBaseUrl()}${path}`;
async function request(path: string, init: RequestInit = {}, authorityLost?: (status: 401 | 403) => void) {
  const response = await fetch(endpoint(path), { credentials: 'include', cache: 'no-store', ...init });
  if (response.status === 401 || response.status === 403) authorityLost?.(response.status);
  if (!response.ok) throw new ParserOperationsApiError(response.status);
  return response;
}
async function guardedJson<T>(response: Response, guard: (value: unknown) => boolean, maxBytes = 2_000_000): Promise<T> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes) throw new ParserOperationsApiError(500);
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!guard(value)) throw new ParserOperationsApiError(500);
    return value as T;
  } catch (error) { throw error instanceof ParserOperationsApiError ? error : new ParserOperationsApiError(500); }
}

export async function getParserRuns(query: string, signal?: AbortSignal, authorityLost?: (status: 401 | 403) => void) {
  const response = await request(`/api/parser-operations/runs${query ? `?${query}` : ''}`, { signal }, authorityLost);
  return guardedJson<ParserRunPage>(response, validateParserRunPage);
}
export async function getParserRun(runId: string, signal?: AbortSignal, authorityLost?: (status: 401 | 403) => void) {
  const response = await request(`/api/parser-operations/runs/${encodeURIComponent(runId)}`, { signal }, authorityLost);
  return guardedJson<ParserRun>(response, validateParserRun);
}
export async function getParserTasks(runId: string, query = '', signal?: AbortSignal, authorityLost?: (status: 401 | 403) => void) {
  const response = await request(`/api/parser-operations/runs/${encodeURIComponent(runId)}/tasks${query ? `?${query}` : ''}`, { signal }, authorityLost);
  return guardedJson<ParserTaskPage>(response, (value) => validateParserTaskPage(value, runId));
}
export async function getParserAttempts(runId: string, taskId: string, query = '', signal?: AbortSignal, authorityLost?: (status: 401 | 403) => void) {
  const response = await request(`/api/parser-operations/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/attempts${query ? `?${query}` : ''}`, { signal }, authorityLost);
  return guardedJson<ParserAttemptPage>(response, (value) => validateParserAttemptPage(value, runId, taskId));
}
export async function runParserAction(runId: string, action: ParserAction, taskIds: string[], idempotencyKey: string, signal?: AbortSignal, authorityLost?: (status: 401 | 403) => void) {
  const body = action === 'retry-selected' ? JSON.stringify({ taskIds }) : '{}';
  const response = await request(`/api/parser-operations/runs/${encodeURIComponent(runId)}/${action}`, {
    method: 'POST', signal, headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body,
  }, authorityLost);
  return guardedJson<ParserActionResponse>(response, validateParserActionResponse, 256_000);
}
export async function exportParserRun(runId: string, signal?: AbortSignal, authorityLost?: (status: 401 | 403) => void) {
  const response = await request(`/api/parser-operations/runs/${encodeURIComponent(runId)}/export`, { signal }, authorityLost);
  try { return await readBoundedParserExport(response, runId); }
  catch { throw new ParserOperationsApiError(500); }
}
