import { getBackendBaseUrl } from '@/lib/api/backendClient';
import type { components } from '@/lib/generated/lots-webapi';
import { validateCaseDossier } from '@/lib/api/caseDossier.validation.mjs';

export type CaseDossier = components['schemas']['CaseDossierResponse'];
export type CaseDossierProblem = components['schemas']['CaseDossierProblem'];
export type CaseProgressWatch = components['schemas']['CaseProgressWatchItem'];

export type CaseDossierPayload = {
  dossier: CaseDossier;
  bytes: Uint8Array;
};

export class CaseDossierApiError extends Error {
  constructor(public readonly status: number, public readonly problem: CaseDossierProblem | null = null) {
    super(`Case dossier request failed: ${status}`);
    this.name = 'CaseDossierApiError';
  }
}

function url(path: string): string {
  return `${getBackendBaseUrl()}${path}`;
}

async function parseProblem(response: Response): Promise<CaseDossierProblem | null> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/problem+json')) return null;
  try {
    const value = await response.json() as Partial<CaseDossierProblem>;
    return typeof value.code === 'string' && typeof value.title === 'string' && value.status === response.status
      ? value as CaseDossierProblem : null;
  } catch { return null; }
}

async function ownerRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url(path), { ...init, credentials: 'include' });
  if (!response.ok) throw new CaseDossierApiError(response.status, await parseProblem(response));
  return response;
}

export async function getCaseDossier(caseId: string, signal?: AbortSignal): Promise<CaseDossierPayload> {
  if (!/^[0-9a-f]{32}$/u.test(caseId)) throw new CaseDossierApiError(404);
  const response = await ownerRequest(`/api/case-dossiers/${encodeURIComponent(caseId)}`, { signal });
  if (response.headers.get('content-type')?.toLowerCase() !== 'application/json; charset=utf-8')
    throw new CaseDossierApiError(500);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 1_048_576) throw new CaseDossierApiError(500);
  let dossier: CaseDossier;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!validateCaseDossier(parsed)) throw new CaseDossierApiError(500);
    dossier = parsed as CaseDossier;
  } catch { throw new CaseDossierApiError(500); }
  return { dossier, bytes };
}

export async function createDirectCaseWatch(
  caseNumber: string,
  displayLabel: string,
  signal?: AbortSignal,
): Promise<CaseProgressWatch> {
  const response = await ownerRequest('/api/case-progress-watches', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseNumber, displayLabel }),
  });
  return response.json() as Promise<CaseProgressWatch>;
}

export async function updateDirectCaseWatch(
  id: string,
  version: number,
  enabled: boolean,
  alertOptIn: boolean,
  displayLabel: string | null,
  signal?: AbortSignal,
): Promise<void> {
  await ownerRequest(`/api/case-progress-watches/${encodeURIComponent(id)}`, {
    method: 'PUT', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, enabled, alertOptIn, displayLabel }),
  });
}
