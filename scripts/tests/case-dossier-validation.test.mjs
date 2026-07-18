import assert from 'node:assert/strict';
import test from 'node:test';
import { caseDossierSnapshot } from '../case-dossier-smoke/fixture-data.mjs';
import { caseDossierScenario } from '../case-dossier-smoke/scenario-fixtures.mjs';
import { validateCaseDossier } from '../../lib/api/caseDossier.validation.mjs';

const clone = () => structuredClone(caseDossierSnapshot);

test('closed runtime validator accepts the canonical dossier fixture', () => {
  assert.equal(validateCaseDossier(clone()), true);
});

test('closed runtime validator rejects extra missing and non-canonical properties', () => {
  const extra = clone(); extra.traceId = 'private';
  const missingNull = clone(); delete missingNull.timeline.sourceUpdatedAtUtc;
  const hostileText = clone(); hostileText.subjects[0].displayName = '  hidden\tname  ';
  assert.equal(validateCaseDossier(extra), false);
  assert.equal(validateCaseDossier(missingNull), false);
  assert.equal(validateCaseDossier(hostileText), false);
});

test('closed runtime validator rejects semantic state count and ordering mutations', () => {
  const partial = clone(); partial.bankruptcy.projections[0].collectionState = 'partial';
  const collectedUnknown = clone(); collectedUnknown.bankruptcy.projections[0].presentationState = 'unknown';
  const count = clone(); count.subjectsReturned = 2;
  const actions = clone(); actions.allowedActions.reverse();
  const caveats = clone(); caveats.caveats.reverse();
  const falseNegative = clone(); falseNegative.state = 'not-found'; falseNegative.timeline.presentationStatus = 'unknown';
  for (const value of [partial, collectedUnknown, count, actions, caveats, falseNegative]) {
    assert.equal(validateCaseDossier(value), false);
  }
});

test('closed runtime validator rejects unsafe references and optional-field omission', () => {
  const punctuation = clone(); punctuation.timeline.events[0].documents[0].sourceReference = 'https://kad.arbitr.ru/Card/a!b';
  const omitted = clone(); delete omitted.bankruptcy.projections[0].priorAuthority;
  assert.equal(validateCaseDossier(punctuation), false);
  assert.equal(validateCaseDossier(omitted), false);
});

test('closed runtime validator requires every present-null field', () => {
  const paths = [
    ['subjects', 0, 'inn'], ['subjects', 0, 'ogrn'],
    ['bankruptcy', 'projections', 0, 'priorAuthority'],
    ['bankruptcy', 'projections', 0, 'authorityMembers', 0, 'evidence', 0, 'sourceReference'],
    ['timeline', 'sourceUpdatedAtUtc'], ['timeline', 'latestEvent'],
    ['timeline', 'events', 0, 'sourceUpdatedAtUtc'], ['timeline', 'events', 0, 'summary'],
    ['timeline', 'events', 0, 'documents', 0, 'documentDate'],
    ['timeline', 'events', 0, 'documents', 0, 'summary'],
    ['timeline', 'events', 0, 'documents', 0, 'sourceReference'],
    ['watch', 'directWatch'],
  ];
  for (const path of paths) {
    const value = clone();
    const parent = path.slice(0, -1).reduce((item, key) => item[key], value);
    delete parent[path.at(-1)];
    assert.equal(validateCaseDossier(value), false, path.join('.'));
  }
});

test('closed runtime validator rejects non-Z instants hostile Unicode and broken count equations', () => {
  const nonZ = clone(); nonZ.generatedAtUtc = '2026-07-16T09:30:00+00:00';
  const bidi = clone(); bidi.subjects[0].displayName = 'Тест\u202eовая организация';
  const memberTotal = clone(); memberTotal.bankruptcy.authorityMembersTotal = 2;
  const evidenceReturned = clone(); evidenceReturned.bankruptcy.caseEvidenceReturned = 0;
  const projectionTotal = clone(); projectionTotal.bankruptcy.projectionsTotal = 2;
  const documentReturned = clone(); documentReturned.timeline.documentsReturned = 0;
  const latestMismatch = clone(); latestMismatch.timeline.latestEvent.title = 'Другое событие';
  for (const [name, value] of Object.entries({
    nonZ, bidi, memberTotal, evidenceReturned, projectionTotal, documentReturned, latestMismatch,
  })) assert.equal(validateCaseDossier(value), false, name);
});

test('closed runtime validator rejects every cycle-2 semantic witness', () => {
  const noCurrent = clone();
  noCurrent.bankruptcy.projections[0].authorityMembers = [];
  noCurrent.bankruptcy.projections[0].authorityMembersReturned = 0;
  noCurrent.bankruptcy.authorityMembersReturned = 0;
  noCurrent.bankruptcy.caseEvidenceReturned = 0;

  const incompatibleMember = clone();
  incompatibleMember.bankruptcy.projections[0].authorityMembers[0].actualSourceStatus = 'timeout';

  const evidenceContradiction = clone();
  evidenceContradiction.bankruptcy.projections[0].authorityMembers[0].canonicalEvidenceCount = 0;

  const collectionReduction = clone();
  collectionReduction.bankruptcy.collectionState = 'not-collected';

  const reversedAuthorityTime = clone();
  reversedAuthorityTime.bankruptcy.projections[0].updatedAtUtc = '2026-07-16T08:59:59Z';

  for (const [name, value] of Object.entries({
    noCurrent, incompatibleMember, evidenceContradiction, collectionReduction, reversedAuthorityTime,
  })) assert.equal(validateCaseDossier(value), false, name);
});

test('closed runtime validator mirrors member projection timeline and watch equations', () => {
  const mutations = [];
  const mutate = (name, change) => { const value = clone(); change(value); mutations.push([name, value]); };
  mutate('member ordinal sequence', (value) => { value.bankruptcy.projections[0].authorityMembers[0].memberOrdinal = 2; });
  mutate('linked before fetched', (value) => { value.bankruptcy.projections[0].authorityMembers[0].linkedAtUtc = '2026-07-16T08:59:59Z'; });
  mutate('canonical case exceeds evidence', (value) => { value.bankruptcy.projections[0].authorityMembers[0].canonicalCaseCount = 4; });
  mutate('other case equation', (value) => { value.bankruptcy.projections[0].authorityMembers[0].otherCaseEvidenceCount = 1; });
  mutate('no-data with found member', (value) => {
    value.bankruptcy.projections[0].presentationState = 'no-data'; value.bankruptcy.presentationState = 'no-data';
  });
  mutate('ambiguous without two members', (value) => {
    value.bankruptcy.projections[0].presentationState = 'ambiguous'; value.bankruptcy.presentationState = 'ambiguous';
    value.state = 'ambiguous';
  });
  mutate('stale without prior authority', (value) => {
    value.bankruptcy.projections[0].presentationState = 'stale'; value.bankruptcy.presentationState = 'stale';
    value.state = 'stale';
  });
  mutate('prior authority on non-stale', (value) => {
    value.bankruptcy.projections[0].priorAuthority = {
      presentationState: 'found', authorityAtUtc: '2026-07-16T08:00:00Z',
      authorityMembers: structuredClone(value.bankruptcy.projections[0].authorityMembers),
      authorityMembersTotal: 1, authorityMembersReturned: 1, authorityMembersTruncated: false,
    };
  });
  mutate('timeline confidence', (value) => { value.timeline.confidence = 'source-confirmed'; });
  mutate('timeline actual presentation mismatch', (value) => {
    value.timeline.actualStatus = 'timeout'; value.timeline.presentationStatus = 'found';
  });
  mutate('timeline equal conflict requires null actual', (value) => {
    value.timeline.authorityState = 'equal-time-conflict'; value.timeline.presentationStatus = 'ambiguous';
    value.timeline.safeCode = 'equal-time-conflict'; value.state = 'ambiguous';
  });
  mutate('watch enabled disabled shape', (value) => {
    value.watch.directWatch = {
      id: '60000000000040008000000000000006', enabled: true, alertOptIn: false,
      displayLabel: null, version: 1, createdAtUtc: '2026-07-16T09:00:00Z',
      updatedAtUtc: '2026-07-16T09:01:00Z', disabledAtUtc: '2026-07-16T09:01:00Z',
    };
    value.allowedActions = ['export-json', 'print', 'update-direct-watch', 'disable-direct-watch', 'set-alert-opt-in'];
  });
  mutate('invalid date-only', (value) => { value.timeline.events[0].documents[0].documentDate = '2026-02-30'; });
  for (const [name, value] of mutations) assert.equal(validateCaseDossier(value), false, name);
});

test('closed runtime validator accepts the valid equal-time-conflict tuple', () => {
  const value = clone();
  value.timeline.authorityState = 'equal-time-conflict';
  value.timeline.actualStatus = null;
  value.timeline.presentationStatus = 'ambiguous';
  value.timeline.safeCode = 'equal-time-conflict';
  value.timeline.retryable = false;
  value.state = 'ambiguous';
  value.sourceIssues = [{
    source: 'kad-arbitr', section: 'timeline', presentationState: 'ambiguous',
    safeCode: 'equal-time-conflict', retryable: false, subjectReference: null,
    authorityMemberOrdinal: null, observedAtUtc: value.timeline.sourceUpdatedAtUtc,
    omittedSubjectCount: null,
  }];
  value.sourceIssuesTotal = 1; value.sourceIssuesReturned = 1;
  value.caveats.splice(5, 0, 'partial-source-failure');
  assert.equal(validateCaseDossier(value), true);
});

test('closed runtime validator enforces exact source-issue tuples', () => {
  const baseIssue = {
    source: 'local', section: 'timeline', presentationState: 'unknown',
    safeCode: 'not-collected-locally', retryable: false, subjectReference: null,
    authorityMemberOrdinal: null, observedAtUtc: null, omittedSubjectCount: null,
  };
  const withIssue = (issue) => {
    const value = clone();
    value.timeline = {
      collectionState: 'not-collected', authorityState: null, actualStatus: null,
      presentationStatus: 'unknown', safeCode: 'not-collected-locally', retryable: false,
      freshness: 'unknown', confidence: 'unknown', authorityAtUtc: null,
      sourceUpdatedAtUtc: null, locallyUpdatedAtUtc: null, latestEvent: null,
      events: [], eventsTotal: 0, eventsReturned: 0, eventsTruncatedBefore: false,
      documentsTotal: 0, documentsReturned: 0, documentsTruncated: false,
    };
    value.sourceIssues = [issue]; value.sourceIssuesTotal = 1;
    value.sourceIssuesReturned = 1; value.sourceIssuesTruncated = false;
    value.caveats = [
      'decision-support-not-legal-advice', 'local-evidence-only',
      'source-freshness-must-be-reviewed', 'snapshot-generated-for-current-account',
      'partial-source-failure',
    ];
    return value;
  };
  assert.equal(validateCaseDossier(withIssue(baseIssue)), true);
  for (const issue of [
    { ...baseIssue, source: 'kad-arbitr' },
    { ...baseIssue, subjectReference: caseDossierSnapshot.subjects[0].subjectReference },
    { ...baseIssue, retryable: true },
    { ...baseIssue, omittedSubjectCount: 1 },
    { ...baseIssue, safeCode: 'omitted-subject-timeout', source: 'fedresurs', section: 'bankruptcy',
      presentationState: 'timeout', retryable: false, omittedSubjectCount: 1 },
  ]) assert.equal(validateCaseDossier(withIssue(issue)), false, JSON.stringify(issue));
});

test('closed runtime validator mirrors pre-cap bankruptcy issue semantics', () => {
  const valid = caseDossierScenario('22');
  assert.equal(valid.bankruptcy.authorityMembersTotal, 80);
  assert.equal(valid.bankruptcy.authorityMembersReturned, 40);
  assert.equal(valid.sourceIssuesTotal, 61);
  assert.equal(valid.sourceIssues.some((item) => item.authorityMemberOrdinal === 2), true);
  assert.equal(validateCaseDossier(valid), true);

  for (const variant of [
    'ordinal-beyond-current-total', 'false-current-count', 'visible-member-tuple-mismatch',
  ]) assert.equal(validateCaseDossier(caseDossierScenario('22', variant)), false, variant);
});
