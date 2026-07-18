const REPORT_ROUTE_GUID = /\/api\/counterparty-watchlist\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/due-diligence-report/giu;
const ABSOLUTE_URL = /https?:\/\/[^\s"'<>]+/giu;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const HEADER_VALUE = /\b(authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/giu;
const SECRET_KEY = /(?:authorization|cookie|token|secret)/iu;

function redactReportRoute(value) {
  return value.replace(
    REPORT_ROUTE_GUID,
    '/api/counterparty-watchlist/[redacted]/due-diligence-report',
  );
}

function redactAbsoluteUrls(value) {
  return value.replace(ABSOLUTE_URL, (candidate) => {
    try {
      const url = new URL(candidate);
      return redactReportRoute(url.pathname);
    } catch {
      return '[redacted-url]';
    }
  });
}

export function sanitizeAccountSmokeEvidenceValue(value, key = '') {
  if (value === null || value === undefined) return value;
  if (SECRET_KEY.test(key) && typeof value !== 'boolean') return '[redacted]';
  if (typeof value === 'string') {
    return redactReportRoute(redactAbsoluteUrls(value))
      .replace(JWT, '[redacted-token]')
      .replace(BEARER, 'Bearer [redacted]')
      .replace(HEADER_VALUE, '$1=[redacted]');
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeAccountSmokeEvidenceValue(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([childKey, childValue]) => [childKey, sanitizeAccountSmokeEvidenceValue(childValue, childKey)]));
  }
  return value;
}

export function assertAccountSmokeEvidencePrivate(serialized) {
  const violations = [];
  if (REPORT_ROUTE_GUID.test(serialized)) violations.push('raw report-route GUID');
  REPORT_ROUTE_GUID.lastIndex = 0;
  if (/https?:\/\//iu.test(serialized)) violations.push('absolute URL');
  if (JWT.test(serialized)) violations.push('JWT-like token');
  JWT.lastIndex = 0;
  if (/\bBearer\s+(?!\[redacted\])/iu.test(serialized)) violations.push('bearer credential');
  if (/\b(?:authorization|cookie|set-cookie)\s*[:=]\s*(?!\[redacted\])/iu.test(serialized)
      || /"(?:authorization|cookie|set-cookie|accessToken|access_token)"\s*:\s*"(?!\[redacted\])[^"\r\n]+"/iu.test(serialized)) {
    violations.push('authorization/cookie material');
  }
  if (violations.length) throw new Error(`account-smoke evidence privacy violation: ${violations.join(', ')}`);
}

export function serializeAccountSmokeEvidence(evidence) {
  const serialized = JSON.stringify(sanitizeAccountSmokeEvidenceValue(evidence), null, 2);
  assertAccountSmokeEvidencePrivate(serialized);
  return serialized;
}
