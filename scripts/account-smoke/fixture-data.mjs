import { primaryLot } from '../public-smoke/fixture-data.mjs';
import { DEFAULT_ACCOUNT_SMOKE_BACKEND_URL } from './constants.mjs';

const ACCOUNT_SMOKE_BACKEND_URL = process.env.NEXT_PUBLIC_CSHARP_BACKEND_URL || DEFAULT_ACCOUNT_SMOKE_BACKEND_URL;

export const ACCOUNT_SMOKE_USER = {
  id: 'fixture-user-2-2',
  name: 'Account Smoke User',
  email: 'account-smoke@example.test',
  password: 'fixture-password',
  isSubscriptionActive: true,
  subscriptionEndDate: '2026-12-31T00:00:00Z',
  isOnTrial: false,
  createdAt: '2026-07-01T00:00:00Z',
  isAdmin: false,
};

export const ACCOUNT_SMOKE_SECOND_USER = {
  ...ACCOUNT_SMOKE_USER,
  id: 'fixture-user-11-3-b',
  name: 'Account Smoke Second Owner',
  email: 'account-smoke-b@example.test',
  isAdmin: true,
};

export const favoriteLot = {
  ...primaryLot,
  id: '33333333-3333-4333-8333-333333333333',
  publicId: 22001,
  slug: 'account-smoke-favorite-lot',
  title: 'Account Smoke Favorite Lot',
  imageUrl: `${ACCOUNT_SMOKE_BACKEND_URL}/fixtures/account-favorite-lot.svg`,
  images: [`${ACCOUNT_SMOKE_BACKEND_URL}/fixtures/account-favorite-lot.svg`],
  documents: [],
  isFavorite: true,
  votesCount: 1,
};

export const accountAd = {
  id: 'account-smoke-ad-1',
  title: 'Account Smoke Ad — экскаватор',
  description: 'Детерминированное объявление для account smoke без S3-загрузки.',
  price: 765000,
  region: 'Москва',
  createdAt: '2026-07-02T12:00:00Z',
  status: 1,
  imageUrls: [`${ACCOUNT_SMOKE_BACKEND_URL}/fixtures/account-ad.svg`],
};

export const initialAlert = {
  id: 'account-smoke-alert-1',
  regionCodes: ['77'],
  categories: ['Недвижимость'],
  minPrice: 1000000,
  maxPrice: 5000000,
  biddingType: null,
  isSharedOwnership: null,
  deliveryTimeStr: '09:00',
  isActive: true,
};

export const counterpartyWatchItem = {
  id: '44444444-4444-4444-8444-444444444441',
  inn: '7736050003',
  ogrn: '1027700070518',
  name: 'Синтетический контрагент',
  displayLabel: 'PRIVATE-COUNTERPARTY-SMOKE',
  identityStatus: 'confirmed',
  enabled: true,
  alertOptIn: true,
  createdAtUtc: '2026-07-13T07:00:00Z',
  updatedAtUtc: '2026-07-13T07:00:00Z',
  disabledAtUtc: null,
  version: 1,
  snapshot: {
    identityStatus: 'confirmed', sourceStatus: 'found', freshnessStatus: 'fresh',
    lastAttemptedAtUtc: '2026-07-13T07:05:00Z', lastSucceededAtUtc: '2026-07-13T07:05:00Z',
    lastEventAtUtc: '2026-07-13T07:04:00Z', nextDueAtUtc: '2026-07-14T07:05:00Z', updatedAtUtc: '2026-07-13T07:05:00Z',
  },
};

function statusWatchItem(sequence, label, identityStatus, sourceStatus, freshnessStatus) {
  return {
    ...structuredClone(counterpartyWatchItem),
    id: `44444444-4444-4444-8444-${String(sequence).padStart(12, '0')}`,
    inn: null,
    ogrn: null,
    name: label,
    displayLabel: label,
    identityStatus,
    alertOptIn: false,
    snapshot: {
      ...structuredClone(counterpartyWatchItem.snapshot),
      identityStatus,
      sourceStatus,
      freshnessStatus,
      lastSucceededAtUtc: freshnessStatus === 'unknown' ? null : counterpartyWatchItem.snapshot.lastSucceededAtUtc,
    },
  };
}

export const counterpartyConfirmedMissingWatchItem =
  statusWatchItem(451, 'SMOKE-CONFIRMED-MISSING', 'confirmed', 'unknown', 'unknown');

export const counterpartyWatchItems = [
  counterpartyWatchItem,
  statusWatchItem(442, 'SMOKE-PENDING', 'pending', 'unknown', 'unknown'),
  statusWatchItem(443, 'SMOKE-AMBIGUOUS', 'ambiguous', 'ambiguous', 'unknown'),
  statusWatchItem(444, 'SMOKE-NOT-FOUND', 'not-found', 'no-match', 'fresh'),
  statusWatchItem(445, 'SMOKE-CLEAN-FRESH', 'confirmed', 'no-bankruptcy-data', 'fresh'),
  statusWatchItem(446, 'SMOKE-STALE', 'confirmed', 'no-bankruptcy-data', 'stale'),
  statusWatchItem(447, 'SMOKE-UNAVAILABLE', 'confirmed', 'unavailable', 'stale'),
  statusWatchItem(448, 'SMOKE-RATE-LIMITED', 'confirmed', 'rate-limited-captcha', 'unknown'),
  statusWatchItem(449, 'SMOKE-TIMEOUT', 'confirmed', 'timeout', 'unknown'),
  statusWatchItem(450, 'SMOKE-SCHEMA-CHANGED', 'confirmed', 'schema-changed', 'unknown'),
  counterpartyConfirmedMissingWatchItem,
  statusWatchItem(452, 'SMOKE-INVALID-INPUT', 'invalid-input', 'invalid-input', 'unknown'),
  statusWatchItem(453, 'SMOKE-UNKNOWN', 'unknown', 'unknown', 'unknown'),
  statusWatchItem(454, 'SMOKE-FUTURE', 'future-state', 'unknown', 'unknown'),
  ...Array.from({ length: 45 }, (_, index) => statusWatchItem(455 + index, `SMOKE-PAGE-${index + 1}`, 'confirmed', 'no-bankruptcy-data', 'fresh')),
];

export const counterpartyDueDiligenceReport = {
  schemaVersion: 'due-diligence-report-v1',
  generatedAtUtc: '2026-07-14T10:00:00Z',
  organization: {
    name: '<img src=x onerror="PRIVATE-REPORT-XSS"> Синтетическая организация',
    inn: '7736050003', ogrn: '1027700070518', identityStatus: 'resolved', identityBasis: 'fns-official',
  },
  assessment: {
    ruleSetVersion: 'due-diligence-risk-v1', asOfUtc: '2026-07-14T10:00:00Z',
    level: 'high', confidence: 'medium', coverage: 'limited', disclaimerCode: 'not-legal-advice',
  },
  reasons: [
    { code: 'fedresurs-recent-bankruptcy-publication', source: 'fedresurs-bankruptcy', evidenceKind: 'bankruptcy-publication', evidenceCount: 1, latestEvidenceAtUtc: '2026-07-10T08:00:00Z' },
    { code: 'kad-positive-only-coverage', source: 'kad-litigation', evidenceKind: 'positive-only-coverage', evidenceCount: 1, latestEvidenceAtUtc: '2026-07-09T08:00:00Z' },
  ],
  sources: [
    { source: 'fns', state: 'neutral', freshness: 'fresh', confidence: 'medium', evidenceCount: 1, latestEvidenceAtUtc: '2026-07-12T08:00:00Z' },
    { source: 'fedresurs-bankruptcy', state: 'adverse', freshness: 'fresh', confidence: 'high', evidenceCount: 1, latestEvidenceAtUtc: '2026-07-10T08:00:00Z' },
    { source: 'kad-litigation', state: 'non-decisive-positive', freshness: 'stale', confidence: 'low', evidenceCount: 1, latestEvidenceAtUtc: '2026-07-09T08:00:00Z' },
  ],
  disclaimerCodes: ['not-legal-advice', 'coverage-may-be-incomplete', 'kad-operator-asserted-unverified'],
};

export function counterpartyReportForItem(item) {
  const persistedStatus = item.snapshot.identityStatus;
  const publicNonResolvedStatus = persistedStatus === 'ambiguous'
    ? 'ambiguous'
    : persistedStatus === 'not-found'
      ? 'not-found'
      : 'unresolved';
  const confirmedWithoutCanonical = item.id === counterpartyConfirmedMissingWatchItem.id;
  if (persistedStatus !== 'confirmed' || confirmedWithoutCanonical) return {
    ...structuredClone(counterpartyDueDiligenceReport),
    organization: {
      name: item.name || 'Наименование не подтверждено',
      inn: null,
      ogrn: null,
      identityStatus: publicNonResolvedStatus,
      identityBasis: 'owner-submitted-unverified',
    },
    assessment: { ...structuredClone(counterpartyDueDiligenceReport.assessment), level: 'unknown', confidence: 'unknown', coverage: 'insufficient' },
    reasons: [{ code: 'identity-unresolved', source: 'assessment', evidenceKind: 'identity-resolution', evidenceCount: 0, latestEvidenceAtUtc: null }],
    sources: [
      { source: 'fns', state: 'missing', freshness: 'unknown', confidence: 'unknown', evidenceCount: 0, latestEvidenceAtUtc: null },
      { source: 'fedresurs-bankruptcy', state: 'missing', freshness: 'unknown', confidence: 'unknown', evidenceCount: 0, latestEvidenceAtUtc: null },
      { source: 'kad-litigation', state: 'missing', freshness: 'unknown', confidence: 'unknown', evidenceCount: 0, latestEvidenceAtUtc: null },
    ],
  };
  if (item.snapshot.freshnessStatus === 'stale') return {
    ...structuredClone(counterpartyDueDiligenceReport),
    organization: { ...structuredClone(counterpartyDueDiligenceReport.organization), name: item.name },
    assessment: { ...structuredClone(counterpartyDueDiligenceReport.assessment), level: 'low', confidence: 'low', coverage: 'limited' },
    disclaimerCodes: [...counterpartyDueDiligenceReport.disclaimerCodes, 'low-not-proof-of-solvency'],
  };
  const report = structuredClone(counterpartyDueDiligenceReport);
  if (item.id !== counterpartyWatchItem.id) report.organization.name = item.name;
  return report;
}

export const counterpartySecondOwnerWatchItem = {
  ...structuredClone(counterpartyWatchItem),
  id: '44444444-4444-4444-8444-999999999999',
  inn: '7707083893',
  ogrn: null,
  name: 'Второй синтетический владелец',
  displayLabel: 'OWNER-B-COUNTERPARTY-SENTINEL',
};

export const counterpartyEvent = {
  id: '55555555-5555-4555-8555-555555555551', visibleAtUtc: '2026-07-13T07:04:00Z',
  publicationDateUtc: '2026-07-13T06:55:00Z', messageType: 'Сообщение о наблюдении', caseNumber: 'A40-1/2026',
  source: 'fedresurs', sourceReference: 'https://fedresurs.ru/bankruptmessages/synthetic-smoke', confidence: 'source-validated', alertEligible: true,
};

export const counterpartyEvents = [
  counterpartyEvent,
  ...Array.from({ length: 50 }, (_, index) => ({
    ...structuredClone(counterpartyEvent),
    id: `55555555-5555-4555-8555-${String(552 + index).padStart(12, '0')}`,
    messageType: `Сообщение о наблюдении ${index + 2}`,
    caseNumber: `A40-${index + 2}/2026`,
    visibleAtUtc: new Date(Date.parse(counterpartyEvent.visibleAtUtc) - (index + 1) * 60_000).toISOString(),
    publicationDateUtc: new Date(Date.parse(counterpartyEvent.publicationDateUtc) - (index + 1) * 60_000).toISOString(),
    sourceReference: index === 0 ? 'https://evil.example/bankruptmessages/private-exfiltration' : `https://fedresurs.ru/bankruptmessages/synthetic-smoke-${index + 2}`,
  })),
];

export const counterpartyInAppAlert = {
  ...counterpartyEvent,
  watchlistEntryId: counterpartyWatchItem.id,
  watchlistDisplayName: counterpartyWatchItem.displayLabel,
  readAtUtc: null,
  isRead: false,
};

export const counterpartyInAppAlerts = counterpartyEvents.map((event) => ({
  ...structuredClone(event),
  watchlistEntryId: counterpartyWatchItem.id,
  watchlistDisplayName: counterpartyWatchItem.displayLabel,
  readAtUtc: null,
  isRead: false,
}));

export const inboxItem = {
  roomId: 'account-smoke-room-1',
  adId: accountAd.id,
  adTitle: accountAd.title,
  adImageUrl: accountAd.imageUrls[0],
  companionName: 'Smoke Buyer',
  lastMessageText: 'Здравствуйте, объявление актуально?',
  lastMessageDate: '2026-07-04T10:00:00Z',
  unreadCount: 1,
};

export const initialMessages = [
  {
    id: 'account-smoke-message-1',
    roomId: inboxItem.roomId,
    senderId: 'fixture-companion',
    text: inboxItem.lastMessageText,
    createdAt: inboxItem.lastMessageDate,
    isRead: false,
  },
];
