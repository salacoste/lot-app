import type { paths } from '@/lib/generated/lots-webapi';

export type BackendApiPath = keyof paths;
export type HealthVersionPath = '/api/health/version';
export type HealthVersionOperation = paths[HealthVersionPath]['get'];

// The current backend OpenAPI endpoint lists HTTP 200 but does not yet describe
// JSON content for /api/health/version, so keep this narrow handwritten payload
// tied to the generated path until the backend contract exposes a schema.
export type HealthVersionPayload = {
  scraperVersion?: string | null;
  version?: string | null;
  webApiVersion?: string | null;
};

const BACKEND_URL_ENV = 'NEXT_PUBLIC_CSHARP_BACKEND_URL';

export class BackendResponseError extends Error {
  constructor(public readonly status: number) {
    super(`Backend request failed: ${status}`);
    this.name = 'BackendResponseError';
  }
}

export function getBackendBaseUrl(): string {
  // Keep a direct NEXT_PUBLIC_* reference so Next.js can inline it into client bundles.
  const baseUrl = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL;

  if (!baseUrl) {
    throw new Error(`URL бэкенда не настроен. Проверьте переменную ${BACKEND_URL_ENV}.`);
  }

  return baseUrl.replace(/\/+$/, '');
}

export function buildBackendUrl(path: BackendApiPath): string {
  return `${getBackendBaseUrl()}${path}`;
}

export function backendFetch<TPath extends BackendApiPath>(
  path: TPath,
  init?: RequestInit,
): Promise<Response> {
  return fetch(buildBackendUrl(path), init);
}

export async function fetchHealthVersion(init?: RequestInit): Promise<HealthVersionPayload> {
  const response = await backendFetch('/api/health/version', init);

  if (!response.ok) {
    throw new BackendResponseError(response.status);
  }

  return response.json() as Promise<HealthVersionPayload>;
}
