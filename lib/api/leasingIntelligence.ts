import { getBackendBaseUrl } from '@/lib/api/backendClient';
import type { components, paths } from '@/lib/generated/lots-webapi';
import { canonicalLeasingSearch, validateLeasingResponse, type LeasingFilters } from '@/utils/leasingDashboard.logic.shared.mjs';
import {
  validateAlertFeed, validateCounterpartyLeasingSignals, validateSavedSearchItem, validateSavedSearchList,
  hasExactLeasingEmpty204, hasExactLeasingJsonSuccess, readExactLeasingFixedProblem,
} from '@/utils/leasingAlerts.logic.shared.mjs';

export type LeasingExtractedDate = components['schemas']['LeasingExtractedDate'];
export type LeasingIntelligenceItem = components['schemas']['LeasingIntelligenceItem'];
export type LeasingIntelligenceResponse = components['schemas']['LeasingIntelligenceSearchResponse'];
type SavedSearchCreateResponses = paths['/api/leasing-intelligence/saved-searches']['post']['responses'];
type SavedSearchUpdateResponses = paths['/api/leasing-intelligence/saved-searches/{savedSearchId}']['put']['responses'];
export type LeasingFixedProblem =
  SavedSearchCreateResponses[400 | 409 | 413 | 415 | 429 | 500]['content']['application/problem+json'] |
  SavedSearchUpdateResponses[404]['content']['application/problem+json'];
export type LeasingSearchProblem = components['schemas']['LeasingIntelligenceProblem'];
export type LeasingProblem = LeasingFixedProblem | LeasingSearchProblem;
export type LeasingSavedSearchItem = components['schemas']['LeasingSavedSearchItem'];
export type LeasingSavedSearchListResponse = components['schemas']['LeasingSavedSearchListResponse'];
export type LeasingAlertFeedResponse = components['schemas']['LeasingAlertFeedResponse'];
export type CounterpartyLeasingSignalsResponse = components['schemas']['CounterpartyLeasingSignalsResponse'];
export type LeasingSavedSearchCreateRequest = NonNullable<paths['/api/leasing-intelligence/saved-searches']['post']['requestBody']>['content']['application/json'];
export type LeasingSavedSearchUpdateRequest = NonNullable<paths['/api/leasing-intelligence/saved-searches/{savedSearchId}']['put']['requestBody']>['content']['application/json'];

export class LeasingApiError extends Error {
  constructor(public readonly status: number, public readonly problem: LeasingProblem | null = null) {
    super(`Leasing intelligence request failed: ${status}`); this.name = 'LeasingApiError';
  }
}

const endpoint = (path: string) => `${getBackendBaseUrl()}${path}`;
async function searchProblem(response: Response): Promise<LeasingSearchProblem | null> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/problem+json')) return null;
  try {
    const value = await response.json() as Partial<LeasingSearchProblem>;
    const keys = Object.keys(value);
    return keys.join(',') === 'type,title,status,code' && value.type === 'about:blank' && value.status === response.status && typeof value.title === 'string' && typeof value.code === 'string'
      ? value as LeasingSearchProblem : null;
  } catch { return null; }
}

async function fixedProblem(response: Response, allowedStatuses: readonly number[]): Promise<LeasingFixedProblem | null> {
  return await readExactLeasingFixedProblem(response, allowedStatuses) as LeasingFixedProblem | null;
}

async function request(path: string, init: RequestInit = {}, fixedStatuses: readonly number[] | null = null) {
  const response = await fetch(endpoint(path), { credentials: 'include', cache: 'no-store', ...init });
  if (!response.ok) {
    if (response.status === 401) throw new LeasingApiError(401);
    if (fixedStatuses !== null) {
      const parsed = await fixedProblem(response, fixedStatuses);
      if (parsed === null) throw new LeasingApiError(500);
      throw new LeasingApiError(response.status, parsed);
    }
    throw new LeasingApiError(response.status, await searchProblem(response));
  }
  return response;
}

async function boundedJson<T>(response: Response, validate: (value: unknown) => boolean, maxBytes = 2_000_000): Promise<T> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes) throw new LeasingApiError(500);
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!validate(value)) throw new LeasingApiError(500);
    return value as T;
  } catch (error) { throw error instanceof LeasingApiError ? error : new LeasingApiError(500); }
}

function requireStatus(response: Response, ...allowed: number[]) {
  if (!hasExactLeasingJsonSuccess(response, allowed)) throw new LeasingApiError(500);
}

async function requireEmpty204(response: Response): Promise<void> {
  if (!await hasExactLeasingEmpty204(response)) throw new LeasingApiError(500);
}

const jsonBody = (body: unknown): Pick<RequestInit, 'body' | 'headers'> => ({
  body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
});

export async function searchLeasingIntelligence(filters: LeasingFilters, offset = 0, limit = 25, signal?: AbortSignal, useServerDefaults = false): Promise<LeasingIntelligenceResponse> {
  const query = canonicalLeasingSearch(filters, offset, limit, useServerDefaults);
  const response = await request(`/api/leasing-intelligence${query ? `?${query}` : ''}`, { signal });
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new LeasingApiError(500);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 2_000_000) throw new LeasingApiError(500);
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!validateLeasingResponse(value)) throw new LeasingApiError(500);
    const result = value as LeasingIntelligenceResponse;
    if (result.offset !== offset || result.limit !== limit || (!useServerDefaults && JSON.stringify(result.filters) !== JSON.stringify(filters))) throw new LeasingApiError(500);
    return result;
  } catch (error) { throw error instanceof LeasingApiError ? error : new LeasingApiError(500); }
}

export async function exportLeasingIntelligence(filters: LeasingFilters, signal?: AbortSignal): Promise<{ bytes: Uint8Array; filename: string }> {
  const query = canonicalLeasingSearch(filters);
  const response = await request(`/api/leasing-intelligence/export?${query}`, { signal });
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="(leasing-intelligence-\d{8}-\d{6}Z\.csv)"/u.exec(disposition);
  if (!match || !response.headers.get('content-type')?.toLowerCase().startsWith('text/csv')) throw new LeasingApiError(500);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 3 || bytes.length > 16_000_000 || bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) throw new LeasingApiError(500);
  return { bytes, filename: match[1] };
}

export async function listLeasingSavedSearches(signal?: AbortSignal): Promise<LeasingSavedSearchListResponse> {
  const response = await request('/api/leasing-intelligence/saved-searches', { signal }, [400, 429, 500]);
  requireStatus(response, 200);
  return boundedJson(response, validateSavedSearchList, 256_000);
}

export async function createLeasingSavedSearch(body: LeasingSavedSearchCreateRequest, signal?: AbortSignal): Promise<LeasingSavedSearchItem> {
  const response = await request('/api/leasing-intelligence/saved-searches',
    { method: 'POST', signal, ...jsonBody(body) }, [400, 409, 413, 415, 429, 500]);
  requireStatus(response, 200, 201);
  return boundedJson(response, validateSavedSearchItem, 32_000);
}

export async function updateLeasingSavedSearch(id: string, body: LeasingSavedSearchUpdateRequest, signal?: AbortSignal): Promise<LeasingSavedSearchItem> {
  const response = await request(`/api/leasing-intelligence/saved-searches/${encodeURIComponent(id)}`,
    { method: 'PUT', signal, ...jsonBody(body) }, [400, 404, 409, 413, 415, 429, 500]);
  requireStatus(response, 200);
  return boundedJson(response, validateSavedSearchItem, 32_000);
}

export async function deleteLeasingSavedSearch(id: string, version: number, signal?: AbortSignal): Promise<void> {
  const query = new URLSearchParams({ version: String(version) });
  const response = await request(`/api/leasing-intelligence/saved-searches/${encodeURIComponent(id)}?${query}`,
    { method: 'DELETE', signal }, [400, 404, 409, 429, 500]);
  await requireEmpty204(response);
}

export async function getLeasingAlerts(offset = 0, limit = 25, signal?: AbortSignal): Promise<LeasingAlertFeedResponse> {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  const response = await request(`/api/leasing-intelligence/alerts?${query}`, { signal }, [400, 429, 500]);
  requireStatus(response, 200);
  const result = await boundedJson<LeasingAlertFeedResponse>(response, validateAlertFeed, 1_000_000);
  if (result.offset !== offset || result.limit !== limit) throw new LeasingApiError(500);
  return result;
}

export async function markLeasingAlertRead(id: string, signal?: AbortSignal): Promise<void> {
  const response = await request(`/api/leasing-intelligence/alerts/${encodeURIComponent(id)}/read`,
    { method: 'PUT', signal }, [400, 404, 429, 500]);
  await requireEmpty204(response);
}

export async function getCounterpartyLeasingSignals(entryId: string, limit = 10, signal?: AbortSignal): Promise<CounterpartyLeasingSignalsResponse> {
  const query = new URLSearchParams({ limit: String(limit) });
  const response = await request(`/api/counterparty-watchlist/${encodeURIComponent(entryId)}/leasing-signals?${query}`,
    { signal }, [400, 404, 429, 500]);
  requireStatus(response, 200);
  return boundedJson(response, (value) => validateCounterpartyLeasingSignals(value, limit), 512_000);
}
