import { caseDossierIds, caseDossierSnapshot } from './fixture-data.mjs';

export const CASE_DOSSIER_SCENARIO_IDS = Object.freeze(Array.from({ length: 25 }, (_, index) =>
  String(index + 1).padStart(2, '0')));

const clone = () => structuredClone(caseDossierSnapshot);
const nGuid = (number) => number.toString(16).padStart(32, '0');

function event(index, documentCount = 0) {
  const day = String(28 - Math.floor(index / 24)).padStart(2, '0');
  const hour = String(23 - (index % 24)).padStart(2, '0');
  const documents = Array.from({ length: documentCount }, (_, documentIndex) => ({
    documentDate: `2026-06-${day}`,
    documentType: 'ruling',
    name: `Документ ${index + 1}.${documentIndex + 1}`,
    summary: `Публичное описание документа ${index + 1}.${documentIndex + 1}.`,
    sourceReference: `https://kad.arbitr.ru/Document/doc-${index + 1}-${documentIndex + 1}`,
  }));
  return {
    occurredAtUtc: `2026-06-${day}T${hour}:00:00Z`,
    sourceUpdatedAtUtc: `2026-06-${day}T${hour}:30:00Z`,
    eventType: 'hearing', title: `Событие ${index + 1}`,
    summary: `Описание события ${index + 1}.`, revision: 1,
    documents, documentCount, returnedDocumentCount: documents.length,
    documentsTruncated: false,
  };
}

function subject(index) {
  return {
    subjectReference: nGuid(0x1000 + index), subjectType: 'organization',
    inn: String(7700000000 + index), ogrn: String(1027700000000 + index),
    displayName: `Организация ${index}`, identityConfidence: 'exact-inn',
    identityProvenance: 'source-validated',
  };
}

function foundProjection(item, index) {
  return {
    subjectReference: item.subjectReference, collectionState: 'collected', presentationState: 'found',
    authorityAtUtc: '2026-07-16T09:00:00Z', updatedAtUtc: '2026-07-16T09:10:00Z',
    authorityMembers: [{
      memberOrdinal: 1, actualSourceStatus: 'found', retryable: false,
      safeCode: 'bankruptcy-data-found', confidence: 'source-confirmed',
      sourceFetchedAtUtc: '2026-07-16T09:00:00Z', linkedAtUtc: '2026-07-16T09:05:00Z',
      canonicalCaseCount: 1, canonicalEvidenceCount: 1,
      evidence: [{
        evidenceReference: nGuid(0x5000 + index), source: 'fedresurs',
        messageType: `Сообщение ${index}`, publicationDateUtc: '2026-07-15T12:00:00Z',
        fetchedAtUtc: '2026-07-16T09:00:00Z', confidence: 'source-confirmed',
        sourceReference: `https://fedresurs.ru/bankruptmessages/message-${index}`,
        normalizedCaseNumber: 'А40-1234/2026',
      }],
      caseEvidenceTotal: 1, caseEvidenceReturned: 1, caseEvidenceTruncated: false,
      otherCaseEvidenceCount: 0,
    }],
    authorityMembersTotal: 1, authorityMembersReturned: 1,
    authorityMembersTruncated: false, priorAuthority: null,
  };
}

function issue(overrides = {}) {
  return {
    source: 'fedresurs', section: 'bankruptcy', presentationState: 'ambiguous',
    safeCode: 'bankruptcy-authority-ambiguous', retryable: false,
    subjectReference: caseDossierSnapshot.subjects[0].subjectReference,
    authorityMemberOrdinal: 1, observedAtUtc: '2026-07-16T09:00:00Z',
    omittedSubjectCount: null, ...overrides,
  };
}

function noTimeline(value) {
  value.timeline = {
    collectionState: 'not-collected', authorityState: null, actualStatus: null,
    presentationStatus: 'unknown', safeCode: 'not-collected-locally', retryable: false,
    freshness: 'unknown', confidence: 'unknown', authorityAtUtc: null,
    sourceUpdatedAtUtc: null, locallyUpdatedAtUtc: null, latestEvent: null, events: [],
    eventsTotal: 0, eventsReturned: 0, eventsTruncatedBefore: false,
    documentsTotal: 0, documentsReturned: 0, documentsTruncated: false,
  };
  value.sourceIssues = value.sourceIssues.filter((item) => item.section !== 'timeline');
  value.sourceIssues.push(issue({ source: 'local', section: 'timeline', presentationState: 'unknown',
    safeCode: 'not-collected-locally', retryable: false, subjectReference: null,
    authorityMemberOrdinal: null, observedAtUtc: null }));
}

function timelineState(value, presentationStatus, actualStatus, safeCode, retryable = false) {
  value.timeline = {
    collectionState: 'collected', authorityState: 'single', actualStatus,
    presentationStatus, safeCode, retryable,
    freshness: presentationStatus === 'stale' ? 'stale-prior-positive' : 'as-observed',
    confidence: 'operator-asserted-unverified',
    authorityAtUtc: '2026-07-16T08:30:00Z', sourceUpdatedAtUtc: '2026-07-16T08:00:00Z',
    locallyUpdatedAtUtc: '2026-07-16T08:30:00Z', latestEvent: null, events: [],
    eventsTotal: 0, eventsReturned: 0, eventsTruncatedBefore: false,
    documentsTotal: 0, documentsReturned: 0, documentsTruncated: false,
  };
  value.sourceIssues = value.sourceIssues.filter((item) => item.section !== 'timeline');
  if (presentationStatus !== 'found') value.sourceIssues.push(issue({
    source: 'kad-arbitr', section: 'timeline', presentationState: presentationStatus,
    safeCode, retryable, subjectReference: null, authorityMemberOrdinal: null,
    observedAtUtc: '2026-07-16T08:00:00Z',
  }));
}

function deriveState(bankruptcy, timeline) {
  if (bankruptcy === 'ambiguous' || timeline === 'ambiguous') return 'ambiguous';
  if (bankruptcy === 'stale' || timeline === 'stale') return 'stale';
  if (bankruptcy === 'found' || timeline === 'found') return 'found';
  if (bankruptcy === 'schema-changed' || timeline === 'schema-changed') return 'schema-changed';
  if (bankruptcy === 'blocked-rate-limited' || timeline === 'blocked') return 'blocked-rate-limited';
  if (bankruptcy === 'timeout' || timeline === 'timeout') return 'timeout';
  if (bankruptcy === 'unavailable' || timeline === 'unavailable' || bankruptcy === 'unknown' || timeline === 'unknown') return 'source-unavailable';
  return 'not-found';
}

function finish(value, { preserveSubjectTotal = false, preserveIssueTotal = false } = {}) {
  value.subjectsReturned = value.subjects.length;
  if (!preserveSubjectTotal) value.subjectsTotal = value.subjectsReturned;
  value.subjectsTruncated = value.subjectsTotal > value.subjectsReturned;
  value.bankruptcy.projectionsReturned = value.bankruptcy.projections.length;
  value.bankruptcy.projectionsTotal = value.subjectsTotal;
  value.bankruptcy.projectionsTruncated = value.bankruptcy.projectionsTotal > value.bankruptcy.projectionsReturned;
  const projections = value.bankruptcy.projections;
  const members = projections.flatMap((projection) => [
    ...projection.authorityMembers, ...(projection.priorAuthority?.authorityMembers ?? []),
  ]);
  value.bankruptcy.authorityMembersReturned = members.length;
  value.bankruptcy.authorityMembersTotal = projections.reduce((sum, projection) => sum +
    projection.authorityMembersTotal + (projection.priorAuthority?.authorityMembersTotal ?? 0), 0);
  value.bankruptcy.authorityMembersTruncated = value.bankruptcy.authorityMembersTotal > value.bankruptcy.authorityMembersReturned;
  value.bankruptcy.caseEvidenceReturned = members.reduce((sum, member) => sum + member.evidence.length, 0);
  value.bankruptcy.caseEvidenceTotal = members.reduce((sum, member) => sum + member.caseEvidenceTotal, 0);
  value.bankruptcy.caseEvidenceTruncated = value.bankruptcy.caseEvidenceTotal > value.bankruptcy.caseEvidenceReturned;
  value.timeline.eventsReturned = value.timeline.events.length;
  value.timeline.documentsReturned = value.timeline.events.reduce((sum, item) => sum + item.documents.length, 0);
  if (!value.timeline.eventsTruncatedBefore) value.timeline.eventsTotal = value.timeline.eventsReturned;
  if (!value.timeline.documentsTruncated) value.timeline.documentsTotal = value.timeline.events.reduce((sum, item) => sum + item.documentCount, 0);
  value.sourceIssuesReturned = value.sourceIssues.length;
  if (!preserveIssueTotal) value.sourceIssuesTotal = value.sourceIssuesReturned;
  value.sourceIssuesTruncated = value.sourceIssuesTotal > value.sourceIssuesReturned;
  value.state = deriveState(value.bankruptcy.presentationState, value.timeline.presentationStatus);
  value.caveats = ['decision-support-not-legal-advice', 'local-evidence-only',
    'source-freshness-must-be-reviewed', 'snapshot-generated-for-current-account'];
  if (value.timeline.collectionState !== 'not-collected') value.caveats.push('operator-asserted-unverified');
  if (value.sourceIssuesTotal > 0) value.caveats.push('partial-source-failure');
  if (value.__unsafeReferenceSuppressed) value.caveats.push('unsafe-reference-suppressed');
  const nestedTruncated = projections.some((projection) => projection.authorityMembersTruncated ||
    projection.authorityMembers.some((member) => member.caseEvidenceTruncated) ||
    projection.priorAuthority?.authorityMembersTruncated ||
    projection.priorAuthority?.authorityMembers.some((member) => member.caseEvidenceTruncated)) ||
    value.timeline.events.some((item) => item.documentsTruncated);
  if (value.subjectsTruncated || value.bankruptcy.projectionsTruncated ||
      value.bankruptcy.authorityMembersTruncated || value.bankruptcy.caseEvidenceTruncated ||
      value.timeline.eventsTruncatedBefore || value.timeline.documentsTruncated ||
      value.sourceIssuesTruncated || nestedTruncated) value.caveats.push('response-truncated');
  delete value.__unsafeReferenceSuppressed;
  return value;
}

function noDataUnknown() {
  const value = clone();
  const member = value.bankruptcy.projections[0].authorityMembers[0];
  Object.assign(member, { actualSourceStatus: 'no-bankruptcy-data', safeCode: 'no-bankruptcy-data', canonicalCaseCount: 0,
    canonicalEvidenceCount: 0, evidence: [], caseEvidenceTotal: 0, caseEvidenceReturned: 0,
    caseEvidenceTruncated: false, otherCaseEvidenceCount: 0 });
  value.bankruptcy.projections[0].presentationState = 'no-data';
  value.bankruptcy.presentationState = 'no-data';
  noTimeline(value);
  return finish(value);
}

function stale() {
  const value = clone();
  const projection = value.bankruptcy.projections[0];
  const priorMember = structuredClone(projection.authorityMembers[0]);
  Object.assign(projection.authorityMembers[0], {
    actualSourceStatus: 'timeout', retryable: true, safeCode: 'source-timeout',
    canonicalCaseCount: 0, canonicalEvidenceCount: 0, evidence: [], caseEvidenceTotal: 0,
    caseEvidenceReturned: 0, otherCaseEvidenceCount: 0,
  });
  projection.presentationState = 'stale';
  projection.priorAuthority = {
    presentationState: 'found', authorityAtUtc: '2026-07-15T09:00:00Z',
    authorityMembers: [priorMember], authorityMembersTotal: 1,
    authorityMembersReturned: 1, authorityMembersTruncated: false,
  };
  value.bankruptcy.presentationState = 'stale';
  value.sourceIssues = [issue({ presentationState: 'stale', safeCode: 'source-timeout', retryable: true })];
  return finish(value);
}

function ambiguous() {
  const value = clone();
  value.bankruptcy.presentationState = 'ambiguous';
  const projection = value.bankruptcy.projections[0];
  projection.presentationState = 'ambiguous';
  projection.authorityMembers[0].safeCode = 'bankruptcy-authority-ambiguous';
  const second = structuredClone(projection.authorityMembers[0]);
  second.memberOrdinal = 2;
  second.evidence[0].evidenceReference = nGuid(0x6202);
  projection.authorityMembers.push(second);
  projection.authorityMembersTotal = 2; projection.authorityMembersReturned = 2;
  value.sourceIssues = [issue(), issue({ authorityMemberOrdinal: 2 })];
  return finish(value);
}

const internalStates = Object.freeze({
  unavailable: ['unavailable', 'unavailable', 'unavailable', 'source-unavailable', true],
  blocked: ['blocked-rate-limited', 'rate-limited-captcha', 'blocked', 'captcha-blocked', true],
  timeout: ['timeout', 'timeout', 'timeout', 'timeout', true],
  schema: ['schema-changed', 'schema-changed', 'schema-changed', 'schema-changed', false],
});

function internalError(name) {
  const [bankruptcyState, bankruptcyActual, timelineStateName, timelineActual, retryable] = internalStates[name];
  const value = clone();
  value.bankruptcy.presentationState = bankruptcyState;
  value.bankruptcy.projections[0].presentationState = bankruptcyState;
  const member = value.bankruptcy.projections[0].authorityMembers[0];
  Object.assign(member, { actualSourceStatus: bankruptcyActual, safeCode: `${name}-source`, retryable,
    canonicalCaseCount: 0, canonicalEvidenceCount: 0, evidence: [], caseEvidenceTotal: 0,
    caseEvidenceReturned: 0, otherCaseEvidenceCount: 0 });
  value.sourceIssues = [issue({ presentationState: bankruptcyState, safeCode: `${name}-source`, retryable })];
  timelineState(value, timelineStateName, timelineActual, `${name}-source`, retryable);
  return finish(value);
}

function mixed() {
  const value = internalError('blocked');
  value.timeline = structuredClone(caseDossierSnapshot.timeline);
  value.sourceIssues = value.sourceIssues.filter((item) => item.section !== 'timeline');
  return finish(value);
}

function bounds() {
  const value = clone();
  value.timeline.events = Array.from({ length: 100 }, (_, index) => event(index, 2)).reverse();
  value.timeline.eventsTotal = 101; value.timeline.eventsTruncatedBefore = true;
  value.timeline.documentsTotal = 202; value.timeline.documentsTruncated = true;
  value.timeline.latestEvent = structuredClone(value.timeline.events.at(-1));
  return finish(value);
}

function withWatch({ enabled = true, alertOptIn = false, version = 7 } = {}) {
  const value = clone();
  value.watch.directWatch = {
    id: '60000000000040008000000000000006', enabled, alertOptIn,
    displayLabel: 'А40-1234/2026', version,
    createdAtUtc: '2026-07-16T09:31:00Z', updatedAtUtc: '2026-07-16T09:32:00Z',
    disabledAtUtc: enabled ? null : '2026-07-16T09:32:00Z',
  };
  value.allowedActions = ['export-json', 'print', 'update-direct-watch',
    enabled ? 'disable-direct-watch' : 'enable-direct-watch', 'set-alert-opt-in'];
  return finish(value);
}

function unsafeSuppressed() {
  const value = clone();
  value.bankruptcy.projections[0].authorityMembers[0].evidence[0].sourceReference = null;
  value.timeline.events[0].documents[0].sourceReference = null;
  value.timeline.latestEvent = structuredClone(value.timeline.events[0]);
  value.__unsafeReferenceSuppressed = true;
  return finish(value);
}

function hostile(variant) {
  const value = clone();
  if (variant === 'script') value.subjects[0].displayName = '<script>globalThis.__caseDossierScriptExecuted=1</script>';
  else if (variant === 'bidi') value.subjects[0].displayName = 'Скрыто\u202eе имя';
  else value.timeline.events[0].documents[0].sourceReference = 'https://kad.arbitr.ru/Card/a!b';
  return value;
}

function crossCase() {
  const value = clone();
  const member = value.bankruptcy.projections[0].authorityMembers[0];
  member.canonicalCaseCount = 4; member.canonicalEvidenceCount = 9;
  member.caseEvidenceTotal = 1; member.otherCaseEvidenceCount = 8;
  return finish(value);
}

function multiSubject({ total = 21, root = 'schema-changed' } = {}) {
  const value = clone();
  value.subjects = Array.from({ length: 20 }, (_, index) => subject(index + 1))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'en'));
  value.bankruptcy.projections = value.subjects.map((item, index) => foundProjection(item, index + 1));
  value.subjectsTotal = total;
  value.bankruptcy.presentationState = root;
  noTimeline(value);
  const timelineIssue = value.sourceIssues.at(-1);
  value.sourceIssues = [issue({
    subjectReference: null, authorityMemberOrdinal: null, observedAtUtc: null,
    safeCode: `omitted-subject-${root}`, presentationState: root,
    retryable: ['blocked-rate-limited', 'timeout', 'unavailable'].includes(root), omittedSubjectCount: total - 20,
  }), timelineIssue];
  return finish(value, { preserveSubjectTotal: true });
}

function ordering(variant = '') {
  const value = clone();
  value.subjects = Array.from({ length: 20 }, (_, index) => subject(index + 1))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'en'));
  const bankruptcyIssues = [];
  value.bankruptcy.projections = value.subjects.map((item, index) => {
    const projection = foundProjection(item, index + 1);
    const priorMember = structuredClone(projection.authorityMembers[0]);
    Object.assign(priorMember, {
      sourceFetchedAtUtc: '2026-07-15T09:00:00Z', linkedAtUtc: '2026-07-15T09:05:00Z',
    });
    const currentMember = projection.authorityMembers[0];
    Object.assign(currentMember, {
      actualSourceStatus: 'timeout', retryable: true, safeCode: 'source-timeout',
      canonicalCaseCount: 0, canonicalEvidenceCount: 0, evidence: [],
      caseEvidenceTotal: 0, caseEvidenceReturned: 0, caseEvidenceTruncated: false,
      otherCaseEvidenceCount: 0,
    });
    Object.assign(projection, {
      presentationState: 'stale', authorityMembersTotal: 3,
      authorityMembersReturned: 1, authorityMembersTruncated: true,
      priorAuthority: {
        presentationState: 'found', authorityAtUtc: '2026-07-15T09:00:00Z',
        authorityMembers: [priorMember], authorityMembersTotal: 1,
        authorityMembersReturned: 1, authorityMembersTruncated: false,
      },
    });
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) bankruptcyIssues.push(issue({
      presentationState: 'stale', safeCode: 'source-timeout', retryable: true,
      subjectReference: item.subjectReference, authorityMemberOrdinal: ordinal,
    }));
    return projection;
  });
  value.bankruptcy.presentationState = 'stale';
  noTimeline(value);
  const timelineIssue = value.sourceIssues.at(-1);
  value.sourceIssues = [bankruptcyIssues[0], timelineIssue, ...bankruptcyIssues.slice(1, 39)];
  value.sourceIssuesTotal = 61;
  const result = finish(value, { preserveIssueTotal: true });
  if (variant === 'ordinal-beyond-current-total') result.sourceIssues[2].authorityMemberOrdinal = 4;
  if (variant === 'false-current-count') {
    result.bankruptcy.projections[0].authorityMembersTotal = 1;
    result.bankruptcy.projections[0].authorityMembersTruncated = false;
    result.bankruptcy.authorityMembersTotal -= 2;
  }
  if (variant === 'visible-member-tuple-mismatch') result.sourceIssues[0].safeCode = 'different-safe-code';
  return result;
}

function references(variant = 'positive') {
  const value = clone();
  if (variant === 'positive') {
    const member = value.bankruptcy.projections[0].authorityMembers[0];
    const base = structuredClone(member.evidence[0]);
    member.evidence = [
      { ...base, evidenceReference: nGuid(0x7101), sourceReference: 'https://fedresurs.ru/bankruptmessages/message-1' },
      { ...base, evidenceReference: nGuid(0x7102), sourceReference: 'https://kad.arbitr.ru/Card/case-1/document-2' },
    ];
    member.canonicalCaseCount = 1; member.canonicalEvidenceCount = 2;
    member.caseEvidenceTotal = 2; member.caseEvidenceReturned = 2; member.otherCaseEvidenceCount = 0;
    value.timeline.events[0].documents = [
      { ...value.timeline.events[0].documents[0], name: 'Карточка', sourceReference: 'https://kad.arbitr.ru/Card/case-1' },
      { ...value.timeline.events[0].documents[0], name: 'Документ', sourceReference: 'https://kad.arbitr.ru/Document/document-2' },
    ];
    value.timeline.events[0].documentCount = 2; value.timeline.events[0].returnedDocumentCount = 2;
    value.timeline.latestEvent = structuredClone(value.timeline.events[0]);
  } else {
    value.timeline.events[0].documents[0].sourceReference = variant;
    value.timeline.latestEvent = structuredClone(value.timeline.events[0]);
  }
  return finish(value);
}

function projectionInvariant(variant) {
  if (variant === 'no-data') return noDataUnknown();
  if (variant === 'stale') return stale();
  if (variant === 'ambiguous') return ambiguous();
  if (variant === 'unavailable') return internalError('unavailable');
  if (variant === 'blocked-rate-limited') return internalError('blocked');
  if (variant === 'timeout') return internalError('timeout');
  if (variant === 'schema-changed') return internalError('schema');
  const value = clone();
  if (variant === 'not-collected') {
    const projection = value.bankruptcy.projections[0];
    Object.assign(projection, { collectionState: 'not-collected', presentationState: 'unknown',
      authorityAtUtc: null, updatedAtUtc: null, authorityMembers: [], authorityMembersTotal: 0,
      authorityMembersReturned: 0, authorityMembersTruncated: false, priorAuthority: null });
    value.bankruptcy.collectionState = 'not-collected'; value.bankruptcy.presentationState = 'unknown';
  } else if (variant !== 'found') {
    const projection = value.bankruptcy.projections[0];
    projection.collectionState = 'collected'; projection.presentationState = variant;
    value.bankruptcy.presentationState = variant;
    if (variant === 'unknown') return value;
  }
  noTimeline(value);
  return finish(value);
}

function visibleFoundOmittedFailures() {
  const value = multiSubject({ total: 24, root: 'found' });
  value.bankruptcy.presentationState = 'found';
  value.timeline = structuredClone(caseDossierSnapshot.timeline);
  const omitted = [
    ['schema-changed', false], ['blocked-rate-limited', true], ['timeout', true], ['unavailable', true],
  ].map(([state, retryable]) => issue({
    subjectReference: null, authorityMemberOrdinal: null, observedAtUtc: null,
    safeCode: `omitted-subject-${state}`, presentationState: state, retryable, omittedSubjectCount: 1,
  }));
  value.sourceIssues = omitted;
  return finish(value, { preserveSubjectTotal: true });
}

export function caseDossierScenario(id, variant = '') {
  if (!CASE_DOSSIER_SCENARIO_IDS.includes(id)) throw new Error(`unknown-case-dossier-scenario:${id}`);
  switch (id) {
    case '03': return noDataUnknown();
    case '04': return stale();
    case '05': return ambiguous();
    case '06': return variant === 'http-500' ? null : internalError(variant || 'unavailable');
    case '07': return mixed();
    case '08': return bounds();
    case '10': return withWatch();
    case '11': return withWatch({ enabled: variant !== 'disabled', alertOptIn: variant === 'alerts-on' });
    case '14': return variant === 'suppressed' || !variant ? unsafeSuppressed() : hostile(variant);
    case '19': return crossCase();
    case '21': return multiSubject();
    case '22': return ordering(variant);
    case '23': return references(variant || 'positive');
    case '24': return projectionInvariant(variant || 'not-collected');
    case '25': return visibleFoundOmittedFailures();
    default: return clone();
  }
}

export function caseDossierScenarioBytes(id, variant = '') {
  const value = caseDossierScenario(id, variant);
  return value === null ? null : Buffer.from(JSON.stringify(value), 'utf8');
}

export const caseDossierForeignCorpus = Object.freeze([
  caseDossierIds.foreignCase.replaceAll('-', ''), 'Чужая организация', 'ЧУЖОЕ-ДЕЛО-999',
  'https://fedresurs.ru/bankruptmessages/foreign-secret',
]);
