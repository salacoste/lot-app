export type YandexMetrikaPrivacyConfig = Readonly<{
  clickmap: false;
  trackLinks: false;
  accurateTrackBounce: false;
  webvisor: false;
}>;

export const yandexMetrikaPrivacyConfig: YandexMetrikaPrivacyConfig;
export function isAnalyticsAllowedPath(pathname: unknown): boolean;
export function yandexMetrikaPageView(pathname: unknown, searchParams?: unknown): string | null;
