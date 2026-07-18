import { safeSourceReference } from './caseDossier.logic.mjs';

const enums = Object.freeze({
  dossier: ['found', 'not-found', 'ambiguous', 'source-unavailable', 'blocked-rate-limited', 'timeout', 'schema-changed', 'stale'],
  collection: ['collected', 'partial', 'not-collected'],
  projectionCollection: ['collected', 'not-collected'],
  bankruptcyActual: ['found', 'no-bankruptcy-data', 'unavailable', 'rate-limited-captcha', 'timeout', 'schema-changed'],
  bankruptcyPresentation: ['found', 'no-data', 'stale', 'ambiguous', 'unavailable', 'blocked-rate-limited', 'timeout', 'schema-changed', 'unknown'],
  timelineAuthority: ['single', 'equal-time-conflict'],
  timelineActual: ['found', 'no-case-card', 'no-electronic-case-data', 'captcha-blocked', 'rate-limited', 'source-unavailable', 'timeout', 'schema-changed'],
  timelinePresentation: ['found', 'unknown', 'stale', 'ambiguous', 'unavailable', 'blocked', 'timeout', 'schema-changed'],
  freshness: ['as-observed', 'stale-prior-positive', 'unknown'],
  source: ['fedresurs', 'kad-arbitr', 'local'],
  section: ['bankruptcy', 'timeline'],
  issue: ['ambiguous', 'stale', 'unavailable', 'blocked-rate-limited', 'blocked', 'timeout', 'schema-changed', 'unknown'],
  action: ['export-json', 'print', 'create-direct-watch', 'update-direct-watch', 'enable-direct-watch', 'disable-direct-watch', 'set-alert-opt-in'],
  caveat: ['decision-support-not-legal-advice', 'local-evidence-only', 'source-freshness-must-be-reviewed', 'operator-asserted-unverified', 'snapshot-generated-for-current-account', 'unsafe-reference-suppressed', 'response-truncated', 'partial-source-failure'],
});

function exactRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

const integer = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) =>
  Number.isInteger(value) && value >= minimum && value <= maximum;
const oneOf = (value, values) => typeof value === 'string' && values.includes(value);
const nGuid = (value) => typeof value === 'string' && /^[0-9a-f]{32}$/u.test(value);
const nullable = (value, validator) => value === null || validator(value);

function validDateParts(year, month, day) {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function utcTicks(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?Z$/u.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ''] = match;
  const [year, month, day, hour, minute, second] =
    [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (!validDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  const milliseconds = Date.parse(`${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}.000Z`);
  if (!Number.isFinite(milliseconds)) return null;
  return BigInt(milliseconds) * 10_000n + BigInt(fraction.padEnd(7, '0') || '0');
}

const utc = (value) => utcTicks(value) !== null;
const atOrAfter = (value, boundary) => utcTicks(value) >= utcTicks(boundary);
const before = (value, boundary) => utcTicks(value) < utcTicks(boundary);
const dateOnly = (value) => {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return Boolean(match && validDateParts(Number(match[1]), Number(match[2]), Number(match[3])));
};

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function text(value, maximum) {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximum &&
    value.normalize('NFKC') === value && value.trim().replace(/\s+/gu, ' ') === value &&
    !/[\p{Cc}\p{Cf}]/u.test(value) && !hasUnpairedSurrogate(value);
}

function boundedArray(value, total, returned, truncated, maximumReturned, validator, minimumTotal = 0, maximumTotal = Number.MAX_SAFE_INTEGER) {
  return Array.isArray(value) && integer(total, minimumTotal, maximumTotal) && integer(returned, 0, maximumReturned) &&
    returned === value.length && total >= returned && truncated === (total > returned) && value.every(validator);
}

function reduceCollection(projections) {
  if (projections.length === 0 || projections.every((item) => item.collectionState === 'not-collected')) return 'not-collected';
  return projections.every((item) => item.collectionState === 'collected') ? 'collected' : 'partial';
}

function reduceBankruptcy(states) {
  if (states.length === 0) return 'unknown';
  for (const state of ['ambiguous', 'stale', 'found', 'schema-changed', 'blocked-rate-limited', 'timeout', 'unavailable']) {
    if (states.includes(state)) return state;
  }
  return states.every((state) => state === 'no-data') ? 'no-data' : 'unknown';
}

function timelinePresentation(actual) {
  return ({
    found: 'found', 'no-case-card': 'unknown', 'no-electronic-case-data': 'unknown',
    'captcha-blocked': 'blocked', 'rate-limited': 'blocked', 'source-unavailable': 'unavailable',
    timeout: 'timeout', 'schema-changed': 'schema-changed',
  })[actual];
}

function validateSubject(value) {
  return exactRecord(value, ['subjectReference', 'subjectType', 'inn', 'ogrn', 'displayName', 'identityConfidence', 'identityProvenance']) &&
    nGuid(value.subjectReference) && value.subjectType === 'organization' &&
    nullable(value.inn, (item) => /^[0-9]{10}$/u.test(item)) && nullable(value.ogrn, (item) => /^[0-9]{13}$/u.test(item)) &&
    text(value.displayName, 1000) && text(value.identityConfidence, 64) && text(value.identityProvenance, 64);
}

function validateEvidence(value) {
  return exactRecord(value, ['evidenceReference', 'source', 'messageType', 'publicationDateUtc', 'fetchedAtUtc', 'confidence', 'sourceReference', 'normalizedCaseNumber']) &&
    nGuid(value.evidenceReference) && value.source === 'fedresurs' && text(value.messageType, 128) &&
    utc(value.publicationDateUtc) && utc(value.fetchedAtUtc) && text(value.confidence, 64) &&
    nullable(value.sourceReference, (item) => safeSourceReference(item) === item) && text(value.normalizedCaseNumber, 128);
}

function validateAuthorityMember(value) {
  if (!exactRecord(value, ['memberOrdinal', 'actualSourceStatus', 'retryable', 'safeCode', 'confidence', 'sourceFetchedAtUtc', 'linkedAtUtc', 'canonicalCaseCount', 'canonicalEvidenceCount', 'evidence', 'caseEvidenceTotal', 'caseEvidenceReturned', 'caseEvidenceTruncated', 'otherCaseEvidenceCount']) ||
      !(
    integer(value.memberOrdinal, 1, 200) && oneOf(value.actualSourceStatus, enums.bankruptcyActual) &&
    typeof value.retryable === 'boolean' && text(value.safeCode, 64) && text(value.confidence, 64) &&
    utc(value.sourceFetchedAtUtc) && utc(value.linkedAtUtc) && atOrAfter(value.linkedAtUtc, value.sourceFetchedAtUtc) &&
    integer(value.canonicalCaseCount) &&
    integer(value.canonicalEvidenceCount) && integer(value.otherCaseEvidenceCount) &&
    boundedArray(value.evidence, value.caseEvidenceTotal, value.caseEvidenceReturned,
      value.caseEvidenceTruncated, 50, validateEvidence))) return false;
  return value.canonicalCaseCount <= value.canonicalEvidenceCount &&
    value.caseEvidenceTotal <= value.canonicalEvidenceCount &&
    value.otherCaseEvidenceCount === value.canonicalEvidenceCount - value.caseEvidenceTotal &&
    new Set(value.evidence.map((item) => item.evidenceReference)).size === value.evidence.length;
}

function validateMemberList(members) {
  return members.every((member, index) => member.memberOrdinal === index + 1);
}

function presentationMatchesMembers(presentation, members, truncated) {
  if (presentation === 'no-data') {
    return !truncated && members.length > 0 && members.every((member) =>
      member.actualSourceStatus === 'no-bankruptcy-data' && member.canonicalEvidenceCount === 0 &&
      member.caseEvidenceTotal === 0);
  }
  if (presentation === 'ambiguous') return members.length >= 2 || truncated;
  return members.every((member) => ({
    found: member.actualSourceStatus === 'found',
    unavailable: member.actualSourceStatus === 'unavailable',
    'blocked-rate-limited': member.actualSourceStatus === 'rate-limited-captcha',
    timeout: member.actualSourceStatus === 'timeout',
    'schema-changed': member.actualSourceStatus === 'schema-changed',
    stale: member.actualSourceStatus !== 'found',
  })[presentation] === true);
}

function validatePrior(value, currentAuthorityAtUtc) {
  return exactRecord(value, ['presentationState', 'authorityAtUtc', 'authorityMembers', 'authorityMembersTotal', 'authorityMembersReturned', 'authorityMembersTruncated']) &&
    ['found', 'ambiguous'].includes(value.presentationState) && utc(value.authorityAtUtc) &&
    before(value.authorityAtUtc, currentAuthorityAtUtc) &&
    boundedArray(value.authorityMembers, value.authorityMembersTotal,
      value.authorityMembersReturned, value.authorityMembersTruncated, 40, validateAuthorityMember, 1, 200) &&
    validateMemberList(value.authorityMembers) &&
    presentationMatchesMembers(value.presentationState, value.authorityMembers, value.authorityMembersTruncated);
}

function validateProjection(value) {
  if (!exactRecord(value, ['subjectReference', 'collectionState', 'presentationState', 'authorityAtUtc', 'updatedAtUtc', 'authorityMembers', 'authorityMembersTotal', 'authorityMembersReturned', 'authorityMembersTruncated', 'priorAuthority']) ||
      !nGuid(value.subjectReference) || !oneOf(value.collectionState, enums.projectionCollection) ||
      !oneOf(value.presentationState, enums.bankruptcyPresentation) ||
      !boundedArray(value.authorityMembers, value.authorityMembersTotal, value.authorityMembersReturned,
        value.authorityMembersTruncated, 40, validateAuthorityMember, 0, 200)) return false;
  if (value.collectionState === 'not-collected') {
    return value.presentationState === 'unknown' && value.authorityAtUtc === null && value.updatedAtUtc === null &&
      value.authorityMembers.length === 0 && value.authorityMembersTotal === 0 && value.priorAuthority === null;
  }
  if (value.presentationState === 'unknown' || !utc(value.authorityAtUtc) || !utc(value.updatedAtUtc) ||
      !atOrAfter(value.updatedAtUtc, value.authorityAtUtc) || value.authorityMembersTotal < 1 ||
      !validateMemberList(value.authorityMembers) ||
      !presentationMatchesMembers(value.presentationState, value.authorityMembers, value.authorityMembersTruncated)) return false;
  if (value.presentationState === 'stale') {
    return value.priorAuthority !== null && validatePrior(value.priorAuthority, value.authorityAtUtc);
  }
  return value.priorAuthority === null;
}

function validateBankruptcy(value) {
  if (!(exactRecord(value, ['collectionState', 'presentationState', 'projections', 'projectionsTotal', 'projectionsReturned', 'projectionsTruncated', 'authorityMembersTotal', 'authorityMembersReturned', 'authorityMembersTruncated', 'caseEvidenceTotal', 'caseEvidenceReturned', 'caseEvidenceTruncated']) &&
    oneOf(value.collectionState, enums.collection) && oneOf(value.presentationState, enums.bankruptcyPresentation) &&
    boundedArray(value.projections, value.projectionsTotal, value.projectionsReturned, value.projectionsTruncated, 20, validateProjection) &&
    integer(value.authorityMembersTotal) && integer(value.authorityMembersReturned, 0, 40) &&
    value.authorityMembersTruncated === (value.authorityMembersTotal > value.authorityMembersReturned) &&
    integer(value.caseEvidenceTotal) && integer(value.caseEvidenceReturned, 0, 50) &&
    value.caseEvidenceTruncated === (value.caseEvidenceTotal > value.caseEvidenceReturned))) return false;
  if (new Set(value.projections.map((item) => item.subjectReference)).size !== value.projections.length) return false;
  if (!value.projectionsTruncated &&
      (value.collectionState !== reduceCollection(value.projections) ||
        value.presentationState !== reduceBankruptcy(value.projections.map((item) => item.presentationState)))) return false;
  return true;
}

function validateDocument(value) {
  return exactRecord(value, ['documentDate', 'documentType', 'name', 'summary', 'sourceReference']) &&
    nullable(value.documentDate, dateOnly) && text(value.documentType, 64) && text(value.name, 256) &&
    nullable(value.summary, (item) => text(item, 2000)) &&
    nullable(value.sourceReference, (item) => safeSourceReference(item) === item);
}

function validateEvent(value) {
  return exactRecord(value, ['occurredAtUtc', 'sourceUpdatedAtUtc', 'eventType', 'title', 'summary', 'revision', 'documents', 'documentCount', 'returnedDocumentCount', 'documentsTruncated']) &&
    utc(value.occurredAtUtc) && nullable(value.sourceUpdatedAtUtc, utc) && text(value.eventType, 64) &&
    text(value.title, 256) && nullable(value.summary, (item) => text(item, 2000)) && integer(value.revision, 1) &&
    boundedArray(value.documents, value.documentCount, value.returnedDocumentCount, value.documentsTruncated, 20, validateDocument);
}

function validateTimeline(value) {
  if (!exactRecord(value, ['collectionState', 'authorityState', 'actualStatus', 'presentationStatus', 'safeCode', 'retryable', 'freshness', 'confidence', 'authorityAtUtc', 'sourceUpdatedAtUtc', 'locallyUpdatedAtUtc', 'latestEvent', 'events', 'eventsTotal', 'eventsReturned', 'eventsTruncatedBefore', 'documentsTotal', 'documentsReturned', 'documentsTruncated']) ||
      !oneOf(value.collectionState, enums.collection) || !nullable(value.authorityState, (item) => oneOf(item, enums.timelineAuthority)) ||
      !nullable(value.actualStatus, (item) => oneOf(item, enums.timelineActual)) ||
      !oneOf(value.presentationStatus, enums.timelinePresentation) || !text(value.safeCode, 64) ||
      typeof value.retryable !== 'boolean' || !oneOf(value.freshness, enums.freshness) || !text(value.confidence, 64) ||
      !nullable(value.authorityAtUtc, utc) || !nullable(value.sourceUpdatedAtUtc, utc) || !nullable(value.locallyUpdatedAtUtc, utc) ||
      !nullable(value.latestEvent, validateEvent) ||
      !boundedArray(value.events, value.eventsTotal, value.eventsReturned, value.eventsTruncatedBefore, 100, validateEvent) ||
      !integer(value.documentsTotal) || !integer(value.documentsReturned, 0, 200) ||
      value.documentsTruncated !== (value.documentsTotal > value.documentsReturned)) return false;
  if (value.collectionState === 'not-collected') {
    return value.authorityState === null && value.actualStatus === null && value.presentationStatus === 'unknown' &&
      value.safeCode === 'not-collected-locally' && value.retryable === false && value.freshness === 'unknown' &&
      value.confidence === 'unknown' && value.authorityAtUtc === null && value.sourceUpdatedAtUtc === null &&
      value.locallyUpdatedAtUtc === null && value.latestEvent === null && value.events.length === 0 &&
      value.eventsTotal === 0 && value.documentsTotal === 0 && value.documentsReturned === 0;
  }
  if (value.collectionState !== 'collected' || value.authorityState === null || value.freshness === 'unknown' ||
      value.confidence !== 'operator-asserted-unverified' || !utc(value.authorityAtUtc) ||
      !utc(value.locallyUpdatedAtUtc)) return false;
  if (value.authorityState === 'equal-time-conflict') {
    if (value.actualStatus !== null || value.presentationStatus !== 'ambiguous') return false;
  } else {
    if (value.actualStatus === null) return false;
    if (value.presentationStatus !== 'stale' && value.presentationStatus !== timelinePresentation(value.actualStatus)) return false;
  }
  for (let index = 1; index < value.events.length; index += 1) {
    if (!atOrAfter(value.events[index].occurredAtUtc, value.events[index - 1].occurredAtUtc)) return false;
  }
  return value.latestEvent === null ? value.events.length === 0 :
    value.events.length > 0 && JSON.stringify(value.latestEvent) === JSON.stringify(value.events.at(-1));
}

function validateDirectWatch(value) {
  return exactRecord(value, ['id', 'enabled', 'alertOptIn', 'displayLabel', 'version', 'createdAtUtc', 'updatedAtUtc', 'disabledAtUtc']) &&
    nGuid(value.id) && typeof value.enabled === 'boolean' && typeof value.alertOptIn === 'boolean' &&
    nullable(value.displayLabel, (item) => text(item, 160)) && integer(value.version, 1) &&
    utc(value.createdAtUtc) && utc(value.updatedAtUtc) && atOrAfter(value.updatedAtUtc, value.createdAtUtc) &&
    nullable(value.disabledAtUtc, (item) => utc(item) && atOrAfter(item, value.createdAtUtc) && atOrAfter(value.updatedAtUtc, item)) &&
    value.enabled === (value.disabledAtUtc === null);
}

function validateIssue(value) {
  if (!exactRecord(value, ['source', 'section', 'presentationState', 'safeCode', 'retryable', 'subjectReference', 'authorityMemberOrdinal', 'observedAtUtc', 'omittedSubjectCount']) ||
      !oneOf(value.source, enums.source) || !oneOf(value.section, enums.section) ||
      !oneOf(value.presentationState, enums.issue) || !text(value.safeCode, 64) || typeof value.retryable !== 'boolean' ||
      !nullable(value.subjectReference, nGuid) || !nullable(value.authorityMemberOrdinal, (item) => integer(item, 1, 200)) ||
      !nullable(value.observedAtUtc, utc) || !nullable(value.omittedSubjectCount, (item) => integer(item, 1))) return false;
  const aggregateTuples = Object.freeze({
    'omitted-subject-ambiguous': ['ambiguous', false],
    'omitted-subject-stale': ['stale', false],
    'omitted-subject-schema-changed': ['schema-changed', false],
    'omitted-subject-blocked-rate-limited': ['blocked-rate-limited', true],
    'omitted-subject-timeout': ['timeout', true],
    'omitted-subject-unavailable': ['unavailable', true],
    'omitted-subject-not-collected': ['unknown', false],
  });
  const aggregate = aggregateTuples[value.safeCode];
  if (aggregate) {
    return value.source === 'fedresurs' && value.section === 'bankruptcy' &&
      value.presentationState === aggregate[0] && value.retryable === aggregate[1] &&
      value.subjectReference === null && value.authorityMemberOrdinal === null &&
      value.observedAtUtc === null && value.omittedSubjectCount !== null;
  }
  if (value.omittedSubjectCount !== null) return false;
  if (value.source === 'local') {
    return value.presentationState === 'unknown' && value.safeCode === 'not-collected-locally' &&
      value.retryable === false && value.authorityMemberOrdinal === null && value.observedAtUtc === null &&
      ((value.section === 'bankruptcy' && value.subjectReference !== null) ||
        (value.section === 'timeline' && value.subjectReference === null));
  }
  if (value.source === 'fedresurs') {
    return value.section === 'bankruptcy' && value.subjectReference !== null &&
      value.authorityMemberOrdinal !== null && value.observedAtUtc !== null &&
      ['ambiguous', 'stale', 'unavailable', 'blocked-rate-limited', 'timeout', 'schema-changed']
        .includes(value.presentationState);
  }
  return value.source === 'kad-arbitr' && value.section === 'timeline' &&
    value.subjectReference === null && value.authorityMemberOrdinal === null &&
    value.safeCode !== 'not-collected-locally' && !['blocked-rate-limited'].includes(value.presentationState);
}

function expectedState(bankruptcy, timeline) {
  if (bankruptcy === 'ambiguous' || timeline === 'ambiguous') return 'ambiguous';
  if (bankruptcy === 'stale' || timeline === 'stale') return 'stale';
  if (bankruptcy === 'found' || timeline === 'found') return 'found';
  if (bankruptcy === 'schema-changed' || timeline === 'schema-changed') return 'schema-changed';
  if (bankruptcy === 'blocked-rate-limited' || timeline === 'blocked') return 'blocked-rate-limited';
  if (bankruptcy === 'timeout' || timeline === 'timeout') return 'timeout';
  if (bankruptcy === 'unavailable' || timeline === 'unavailable' || bankruptcy === 'unknown' || timeline === 'unknown') return 'source-unavailable';
  return 'not-found';
}

function toIssuePresentation(value) {
  return value === 'blocked-rate-limited' ? 'blocked-rate-limited' : value;
}

function roundRobin(lanes) {
  const result = [];
  const maximum = Math.max(0, ...lanes.map((lane) => lane.length));
  for (let index = 0; index < maximum; index += 1) {
    for (const lane of lanes) if (index < lane.length) result.push(lane[index]);
  }
  return result;
}

function issueKey(value) {
  return JSON.stringify(value);
}

function validateIssues(issues, total, truncated, bankruptcy, timeline) {
  const aggregateOrder = [
    'omitted-subject-ambiguous', 'omitted-subject-stale', 'omitted-subject-schema-changed',
    'omitted-subject-blocked-rate-limited', 'omitted-subject-timeout',
    'omitted-subject-unavailable', 'omitted-subject-not-collected',
  ];
  const bankruptcyIssues = [];
  const omittedIssues = [];
  const timelineIssues = [];
  for (const issue of issues) {
    if (aggregateOrder.includes(issue.safeCode)) {
      omittedIssues.push(issue);
      continue;
    }
    if (issue.section === 'timeline') {
      if (timeline.collectionState === 'not-collected') {
        if (issue.source !== 'local' || issue.presentationState !== 'unknown' ||
            issue.safeCode !== 'not-collected-locally' || issue.retryable || issue.observedAtUtc !== null) return false;
      } else if (issue.source !== 'kad-arbitr' || issue.presentationState !== toIssuePresentation(timeline.presentationStatus) ||
          issue.safeCode !== timeline.safeCode || issue.retryable !== timeline.retryable ||
          issue.observedAtUtc !== timeline.sourceUpdatedAtUtc) return false;
      timelineIssues.push(issue);
      continue;
    }
    const projection = bankruptcy.projections.find((item) => item.subjectReference === issue.subjectReference);
    if (!projection) return false;
    if (issue.presentationState === 'unknown') {
      if (projection.collectionState !== 'not-collected' || issue.source !== 'local' ||
          issue.safeCode !== 'not-collected-locally' || issue.retryable ||
          issue.authorityMemberOrdinal !== null || issue.observedAtUtc !== null) return false;
    } else {
      const member = projection.authorityMembers.find((item) => item.memberOrdinal === issue.authorityMemberOrdinal);
      if (projection.collectionState !== 'collected' || issue.source !== 'fedresurs' ||
          issue.presentationState !== toIssuePresentation(projection.presentationState)) return false;
      if (member) {
        if (issue.safeCode !== member.safeCode || issue.retryable !== member.retryable ||
            issue.observedAtUtc !== member.sourceFetchedAtUtc) return false;
      } else if (!projection.authorityMembersTruncated ||
          issue.authorityMemberOrdinal <= projection.authorityMembersReturned ||
          issue.authorityMemberOrdinal > projection.authorityMembersTotal) return false;
    }
    bankruptcyIssues.push(issue);
  }
  const omittedIndexes = omittedIssues.map((item) => aggregateOrder.indexOf(item.safeCode));
  if (omittedIndexes.some((item, index) => index > 0 && item <= omittedIndexes[index - 1]) ||
      new Set(omittedIndexes).size !== omittedIndexes.length) return false;
  if ((timeline.presentationStatus === 'found' && timelineIssues.length !== 0) ||
      (timeline.presentationStatus !== 'found' && timelineIssues.length !== 1)) return false;
  const expectedPrefix = roundRobin([bankruptcyIssues, omittedIssues, timelineIssues]).slice(0, issues.length);
  if (expectedPrefix.map(issueKey).join('\n') !== issues.map(issueKey).join('\n')) return false;
  if ((!truncated && total !== issues.length) || (truncated && (total <= issues.length || issues.length !== 40))) return false;
  const subjectOrder = new Map(bankruptcy.projections.map((projection, index) => [projection.subjectReference, index]));
  let previousSubject = -1;
  let previousOrdinal = 0;
  for (const issue of bankruptcyIssues) {
    const currentSubject = subjectOrder.get(issue.subjectReference);
    if (currentSubject < previousSubject) return false;
    if (currentSubject !== previousSubject) previousOrdinal = 0;
    if (issue.authorityMemberOrdinal !== null && issue.authorityMemberOrdinal <= previousOrdinal) return false;
    previousSubject = currentSubject;
    previousOrdinal = issue.authorityMemberOrdinal ?? 0;
  }
  return true;
}

export function validateCaseDossier(value) {
  if (!exactRecord(value, ['contractVersion', 'generatedAtUtc', 'audience', 'state', 'case', 'subjects', 'subjectsTotal', 'subjectsReturned', 'subjectsTruncated', 'bankruptcy', 'timeline', 'watch', 'sourceIssues', 'sourceIssuesTotal', 'sourceIssuesReturned', 'sourceIssuesTruncated', 'allowedActions', 'caveats']) ||
      value.contractVersion !== 'case-dossier-v1' || !utc(value.generatedAtUtc) ||
      !exactRecord(value.audience, ['scope', 'accountReference']) || value.audience.scope !== 'current-account' || !nGuid(value.audience.accountReference) ||
      !oneOf(value.state, enums.dossier) || !exactRecord(value.case, ['caseId', 'caseNumber', 'courtDiscriminator']) ||
      !nGuid(value.case.caseId) || !text(value.case.caseNumber, 128) || !text(value.case.courtDiscriminator, 128) ||
      !boundedArray(value.subjects, value.subjectsTotal, value.subjectsReturned, value.subjectsTruncated, 20, validateSubject) ||
      !validateBankruptcy(value.bankruptcy) || !validateTimeline(value.timeline) ||
      !exactRecord(value.watch, ['directWatch', 'indirectWatchCount']) || !nullable(value.watch.directWatch, validateDirectWatch) ||
      !integer(value.watch.indirectWatchCount) ||
      !boundedArray(value.sourceIssues, value.sourceIssuesTotal, value.sourceIssuesReturned, value.sourceIssuesTruncated, 40, validateIssue) ||
      !Array.isArray(value.allowedActions) || !integer(value.allowedActions.length, 3, 5) ||
      new Set(value.allowedActions).size !== value.allowedActions.length ||
      !value.allowedActions.every((item) => oneOf(item, enums.action)) ||
      !Array.isArray(value.caveats) || !integer(value.caveats.length, 4, 8) ||
      new Set(value.caveats).size !== value.caveats.length ||
      !value.caveats.every((item) => oneOf(item, enums.caveat)) ||
      value.state !== expectedState(value.bankruptcy.presentationState, value.timeline.presentationStatus)) return false;

  const subjectKeys = value.subjects.map((item) => item.subjectReference);
  if (new Set(subjectKeys).size !== subjectKeys.length) return false;
  for (let index = 1; index < value.subjects.length; index += 1) {
    const previous = value.subjects[index - 1];
    const current = value.subjects[index];
    if (previous.displayName > current.displayName ||
        (previous.displayName === current.displayName && previous.subjectReference >= current.subjectReference)) return false;
  }

  if (value.bankruptcy.projectionsReturned !== value.subjectsReturned ||
      value.bankruptcy.projectionsTotal !== value.subjectsTotal) return false;
  const returnedMembers = value.bankruptcy.projections.flatMap((projection) => [
    ...projection.authorityMembers,
    ...(projection.priorAuthority?.authorityMembers ?? []),
  ]);
  const memberTotals = value.bankruptcy.projections.reduce((sum, projection) =>
    sum + projection.authorityMembersTotal + (projection.priorAuthority?.authorityMembersTotal ?? 0), 0);
  if (value.bankruptcy.authorityMembersTotal !== memberTotals ||
      value.bankruptcy.authorityMembersReturned !== returnedMembers.length ||
      value.bankruptcy.caseEvidenceReturned !== returnedMembers.reduce((sum, member) => sum + member.evidence.length, 0)) return false;
  if (!value.bankruptcy.authorityMembersTruncated &&
      value.bankruptcy.caseEvidenceTotal !== returnedMembers.reduce((sum, member) => sum + member.caseEvidenceTotal, 0)) return false;
  const returnedDocuments = value.timeline.events.reduce((sum, event) => sum + event.documents.length, 0);
  if (value.timeline.documentsReturned !== returnedDocuments ||
      (!value.timeline.eventsTruncatedBefore &&
        value.timeline.documentsTotal !== value.timeline.events.reduce((sum, event) => sum + event.documentCount, 0))) return false;
  if (!validateIssues(value.sourceIssues, value.sourceIssuesTotal, value.sourceIssuesTruncated,
    value.bankruptcy, value.timeline)) return false;

  const expectedActions = value.watch.directWatch === null
    ? ['export-json', 'print', 'create-direct-watch']
    : ['export-json', 'print', 'update-direct-watch', value.watch.directWatch.enabled ? 'disable-direct-watch' : 'enable-direct-watch', 'set-alert-opt-in'];
  if (JSON.stringify(value.allowedActions) !== JSON.stringify(expectedActions)) return false;
  const expectedCaveats = ['decision-support-not-legal-advice', 'local-evidence-only',
    'source-freshness-must-be-reviewed', 'snapshot-generated-for-current-account'];
  if (value.timeline.collectionState !== 'not-collected') expectedCaveats.push('operator-asserted-unverified');
  if (value.sourceIssuesTotal > 0) expectedCaveats.push('partial-source-failure');
  if (value.caveats.includes('unsafe-reference-suppressed')) expectedCaveats.push('unsafe-reference-suppressed');
  const nestedBankruptcyTruncated = value.bankruptcy.projections.some((projection) =>
    projection.authorityMembersTruncated || projection.authorityMembers.some((member) => member.caseEvidenceTruncated) ||
    projection.priorAuthority?.authorityMembersTruncated ||
    projection.priorAuthority?.authorityMembers.some((member) => member.caseEvidenceTruncated));
  const nestedTimelineTruncated = value.timeline.events.some((event) => event.documentsTruncated);
  const truncated = value.subjectsTruncated || value.bankruptcy.projectionsTruncated ||
    value.bankruptcy.authorityMembersTruncated || value.bankruptcy.caseEvidenceTruncated ||
    nestedBankruptcyTruncated || value.timeline.eventsTruncatedBefore || value.timeline.documentsTruncated ||
    nestedTimelineTruncated || value.sourceIssuesTruncated;
  if (truncated) expectedCaveats.push('response-truncated');
  if (JSON.stringify(value.caveats) !== JSON.stringify(expectedCaveats)) return false;

  const subjectReferences = value.subjects.map((item) => item.subjectReference);
  const projectionReferences = value.bankruptcy.projections.map((item) => item.subjectReference);
  return JSON.stringify(subjectReferences) === JSON.stringify(projectionReferences);
}
