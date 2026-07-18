const PRIVATE_ANALYTICS_ROUTE_SEGMENTS = new Set(['account', 'login', 'register']);

export const yandexMetrikaPrivacyConfig = Object.freeze({
  clickmap: false,
  trackLinks: false,
  accurateTrackBounce: false,
  webvisor: false,
});

export function isAnalyticsAllowedPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return false;
  const firstSegment = pathname.split('/', 2)[1]?.toLocaleLowerCase('en-US') ?? '';
  return !PRIVATE_ANALYTICS_ROUTE_SEGMENTS.has(firstSegment);
}

export function yandexMetrikaPageView(pathname, searchParams = '') {
  if (!isAnalyticsAllowedPath(pathname)) return null;
  const query = String(searchParams).replace(/^\?+/u, '');
  return query ? `${pathname}?${query}` : pathname;
}
