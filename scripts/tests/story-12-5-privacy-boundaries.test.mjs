import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAnalyticsAllowedPath,
  yandexMetrikaPageView,
  yandexMetrikaPrivacyConfig,
} from '../../utils/analyticsPrivacy.logic.shared.mjs';
import {
  assertAccountSmokeEvidencePrivate,
  serializeAccountSmokeEvidence,
} from '../account-smoke/evidence-privacy.mjs';
import {
  counterpartyDueDiligenceReport,
  counterpartyReportForItem,
  counterpartyWatchItems,
} from '../account-smoke/fixture-data.mjs';

test('analytics route policy excludes private account and authentication route segments', () => {
  for (const pathname of [
    '/account', '/account/', '/account/counterparties', '/ACCOUNT/COUNTERPARTIES',
    '/login', '/login/reset', '/register',
  ]) {
    assert.equal(isAnalyticsAllowedPath(pathname), false, pathname);
    assert.equal(yandexMetrikaPageView(pathname, 'returnUrl=/account/counterparties'), null, pathname);
  }
  for (const pathname of ['/', '/lots', '/accounting', '/login-help']) {
    assert.equal(isAnalyticsAllowedPath(pathname), true, pathname);
  }
  assert.equal(yandexMetrikaPageView('/lots', ''), '/lots');
  assert.equal(yandexMetrikaPageView('/lots', '?category=vehicle'), '/lots?category=vehicle');
});

test('analytics initialization has no DOM, interaction, bounce, replay, or ecommerce observer', () => {
  assert.deepEqual(yandexMetrikaPrivacyConfig, {
    clickmap: false,
    trackLinks: false,
    accurateTrackBounce: false,
    webvisor: false,
  });
  assert.equal(Object.isFrozen(yandexMetrikaPrivacyConfig), true);
  assert.equal('ecommerce' in yandexMetrikaPrivacyConfig, false);
});

test('account-smoke evidence strips report identifiers, absolute URLs, cookies, and authorization values', () => {
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const serialized = serializeAccountSmokeEvidence({
    consoleMessages: [`GET http://127.0.0.1:4022/api/counterparty-watchlist/${id}/due-diligence-report?secret=1`],
    failedRequests: [`Bearer private-token https://app.example/account/counterparties`],
    backendRequests: [{
      path: `/api/counterparty-watchlist/${id}/due-diligence-report`,
      authorization: 'Bearer another-private-token',
      cookie: 'access_token=private-cookie',
      hasFixtureCookie: true,
    }],
  });

  assert.match(serialized, /\/api\/counterparty-watchlist\/\[redacted\]\/due-diligence-report/u);
  assert.doesNotMatch(serialized, new RegExp(id, 'iu'));
  assert.doesNotMatch(serialized, /https?:\/\//iu);
  assert.doesNotMatch(serialized, /private-token|private-cookie/iu);
  assert.match(serialized, /"authorization": "\[redacted\]"/u);
  assert.match(serialized, /"cookie": "\[redacted\]"/u);
  assert.match(serialized, /"hasFixtureCookie": true/u);
  assert.doesNotThrow(() => assertAccountSmokeEvidencePrivate(serialized));
});

test('account-smoke evidence negative scan rejects each raw sensitive transport class', () => {
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  for (const mutation of [
    `/api/counterparty-watchlist/${id}/due-diligence-report`,
    'https://app.example/account/counterparties',
    'Authorization: Bearer private',
    'Cookie: access_token=private',
    { authorization: 'private' },
    { cookie: 'access_token=private' },
    'eyJhbGciOiJIUzI1NiJ9.cHJpdmF0ZQ.c2lnbmF0dXJl',
  ]) assert.throws(() => assertAccountSmokeEvidencePrivate(JSON.stringify({ mutation })), /privacy violation/u, mutation);
});

test('account fixture maps every persisted identity state without generic resolved fallthrough', () => {
  const scenarios = [
    ['PRIVATE-COUNTERPARTY-SMOKE', 'resolved', 'fns-official', counterpartyDueDiligenceReport.organization.name],
    ['SMOKE-CONFIRMED-MISSING', 'unresolved', 'owner-submitted-unverified', 'SMOKE-CONFIRMED-MISSING'],
    ['SMOKE-PENDING', 'unresolved', 'owner-submitted-unverified', 'SMOKE-PENDING'],
    ['SMOKE-AMBIGUOUS', 'ambiguous', 'owner-submitted-unverified', 'SMOKE-AMBIGUOUS'],
    ['SMOKE-NOT-FOUND', 'not-found', 'owner-submitted-unverified', 'SMOKE-NOT-FOUND'],
    ['SMOKE-INVALID-INPUT', 'unresolved', 'owner-submitted-unverified', 'SMOKE-INVALID-INPUT'],
    ['SMOKE-UNKNOWN', 'unresolved', 'owner-submitted-unverified', 'SMOKE-UNKNOWN'],
    ['SMOKE-FUTURE', 'unresolved', 'owner-submitted-unverified', 'SMOKE-FUTURE'],
  ];

  for (const [label, identityStatus, identityBasis, expectedName] of scenarios) {
    const item = counterpartyWatchItems.find((candidate) => candidate.displayLabel === label);
    assert.ok(item, label);
    const report = counterpartyReportForItem(item);
    assert.equal(report.organization.identityStatus, identityStatus, label);
    assert.equal(report.organization.identityBasis, identityBasis, label);
    assert.equal(report.organization.name, expectedName, label);
    if (identityStatus !== 'resolved') {
      assert.equal(report.assessment.level, 'unknown', label);
      assert.equal(report.assessment.confidence, 'unknown', label);
      assert.equal(report.assessment.coverage, 'insufficient', label);
      assert.deepEqual(report.sources.map((source) => source.evidenceCount), [0, 0, 0], label);
      assert.doesNotMatch(JSON.stringify(report), /PRIVATE-REPORT-XSS/u, label);
    }
  }
});
