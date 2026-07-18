import type { components, paths } from '@/lib/generated/lots-webapi';
import { getBackendBaseUrl } from '@/lib/api/backendClient';

export type CounterpartyWatchlistItem = components['schemas']['CounterpartyWatchlistItem'];
export type CounterpartyWatchlistPage = components['schemas']['CounterpartyWatchlistPage'];
export type CounterpartyWatchEventItem = components['schemas']['CounterpartyWatchEventItem'];
export type CounterpartyWatchEventPage = components['schemas']['CounterpartyWatchEventPage'];
export type CounterpartyInAppAlertItem = components['schemas']['CounterpartyInAppAlertItem'];
export type CounterpartyInAppAlertPage = components['schemas']['CounterpartyInAppAlertPage'];
export type CounterpartyWatchlistCreateRequest = components['schemas']['CounterpartyWatchlistCreateRequest'];
export type CounterpartyWatchlistUpdateRequest = components['schemas']['CounterpartyWatchlistUpdateRequest'];
export type DueDiligenceReportResponse = components['schemas']['DueDiligenceReportResponse'];
export type DueDiligenceReportEnvelope = { rawText: string; report: DueDiligenceReportResponse };

export type CounterpartyListQuery = NonNullable<paths['/api/counterparty-watchlist']['get']['parameters']['query']>;
export type CounterpartyAlertQuery = NonNullable<paths['/api/counterparty-watchlist/alerts']['get']['parameters']['query']>;
export type CounterpartyHistoryQuery = NonNullable<paths['/api/counterparty-watchlist/{id}/events']['get']['parameters']['query']>;

export class CounterpartyApiError extends Error {
  constructor(public readonly status: number) {
    super(`Counterparty API request failed with status ${status}`);
    this.name = 'CounterpartyApiError';
  }
}

function url(path: string, query?: Record<string, string | number | undefined>) {
  const result = new URL(`${getBackendBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) result.searchParams.set(key, String(value));
  return result.toString();
}

async function request(path: string, init: RequestInit, query?: Record<string, string | number | undefined>) {
  const response = await fetch(url(path, query), {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
  });
  if (!response.ok) throw new CounterpartyApiError(response.status);
  return response;
}

async function json<T>(path: string, signal: AbortSignal, query?: Record<string, string | number | undefined>): Promise<T> {
  const response = await request(path, { method: 'GET', signal }, query);
  return response.json() as Promise<T>;
}

export function listCounterparties(signal: AbortSignal, query: CounterpartyListQuery = { offset: 0, limit: 50 }) {
  return json<CounterpartyWatchlistPage>('/api/counterparty-watchlist', signal, query);
}

export async function createCounterparty(body: CounterpartyWatchlistCreateRequest, signal: AbortSignal) {
  const response = await request('/api/counterparty-watchlist', { method: 'POST', signal, body: JSON.stringify(body) });
  return response.json() as Promise<CounterpartyWatchlistItem>;
}

export async function getCounterparty(id: string, signal: AbortSignal) {
  const response = await request(`/api/counterparty-watchlist/${encodeURIComponent(id)}`, { method: 'GET', signal });
  return response.json() as Promise<CounterpartyWatchlistItem>;
}

export async function updateCounterparty(id: string, body: CounterpartyWatchlistUpdateRequest, signal: AbortSignal) {
  await request(`/api/counterparty-watchlist/${encodeURIComponent(id)}`, { method: 'PUT', signal, body: JSON.stringify(body) });
}

export async function deleteCounterparty(id: string, version: number, signal: AbortSignal) {
  await request(`/api/counterparty-watchlist/${encodeURIComponent(id)}`, { method: 'DELETE', signal }, { version });
}

export function getCounterpartyHistory(id: string, signal: AbortSignal, query: CounterpartyHistoryQuery = { offset: 0, limit: 50 }) {
  return json<CounterpartyWatchEventPage>(`/api/counterparty-watchlist/${encodeURIComponent(id)}/events`, signal, query);
}

export function listCounterpartyAlerts(signal: AbortSignal, query: CounterpartyAlertQuery = { offset: 0, limit: 50 }) {
  return json<CounterpartyInAppAlertPage>('/api/counterparty-watchlist/alerts', signal, query);
}

export async function markCounterpartyAlertRead(eventId: string, signal: AbortSignal) {
  await request(`/api/counterparty-watchlist/alerts/${encodeURIComponent(eventId)}/read`, { method: 'PUT', signal });
}

export async function getDueDiligenceReport(id: string, signal: AbortSignal): Promise<DueDiligenceReportEnvelope> {
  const response = await request(`/api/counterparty-watchlist/${encodeURIComponent(id)}/due-diligence-report`, {
    method: 'GET', signal,
  });
  const rawText = await response.text();
  if (new TextEncoder().encode(rawText).byteLength > 32 * 1024) throw new CounterpartyApiError(500);
  try {
    return { rawText, report: JSON.parse(rawText) as DueDiligenceReportResponse };
  } catch {
    throw new CounterpartyApiError(500);
  }
}
