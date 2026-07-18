export const CASE_BATCH_SMOKE_USER = Object.freeze({
  id: '14500000-0000-4000-8000-000000000001',
  email: 'case-batch-smoke@example.test',
  password: 'case-batch-smoke-password',
  name: 'Case Batch Smoke',
  isAdmin: false,
  isSubscriptionActive: true,
  isOnTrial: false,
  createdAt: '2026-07-16T00:00:00Z',
});

export const CASE_BATCH_PRIVATE = Object.freeze({
  inn: '7707083893',
  caseNumber: 'A40-145000/2026',
  label: 'PRIVATE-CASE-BATCH-LABEL',
  token: 'PRIVATE-CASE-BATCH-PREVIEW-TOKEN',
  idempotencyKey: 'PRIVATE-CASE-BATCH-IDEMPOTENCY-KEY-0001',
  targetHash: 'PRIVATE-CASE-BATCH-TARGET-HASH',
});

export const caseBatchCsv = Buffer.from([
  'inn,case_number,display_label',
  `${CASE_BATCH_PRIVATE.inn},,${CASE_BATCH_PRIVATE.label}`,
  `,${CASE_BATCH_PRIVATE.caseNumber},`,
  `${CASE_BATCH_PRIVATE.inn},,duplicate`,
  'invalid,,,',
].join('\n'), 'utf8');

export const previewFixture = Object.freeze({
  contractVersion: 'case-batch-preview/v1',
  previewToken: CASE_BATCH_PRIVATE.token,
  expiresAtUtc: '2026-07-16T00:15:00Z',
  totalRows: 4,
  validRows: 2,
  invalidRows: 1,
  duplicateRows: 1,
  alreadyKnownRows: 2,
  wouldCheckRows: 2,
  skippedRows: 2,
  rows: [
    { rowNumber: 2, targetKind: 'inn', classification: 'would-check', maskedTarget: 'ИНН ••••••3893', issueCodes: [] },
    { rowNumber: 3, targetKind: 'case-number', classification: 'would-check', maskedTarget: 'Дело A40-••••••/2026', issueCodes: [] },
    { rowNumber: 4, targetKind: 'inn', classification: 'duplicate', maskedTarget: 'ИНН ••••••3893', issueCodes: ['duplicate-target'] },
    { rowNumber: 5, targetKind: 'invalid', classification: 'invalid', maskedTarget: 'Недопустимая строка', issueCodes: ['row-shape-invalid'] },
  ],
});

export const jobId = '14500000-0000-4000-8000-000000000010';
export const CASE_BATCH_LATER_PAGE_MASKED = 'Дело A40-••••••/113';

const primaryCaseBatchItems = [
  {
    id: '14500000-0000-4000-8000-000000000011', rowNumber: 2, targetKind: 'inn',
    maskedDisplay: 'ИНН ••••••3893', status: 'found-local', evidenceKind: 'fedresurs-kad-link',
    confidenceCode: 'source-validated', provenanceCode: 'fedresurs-local', caveatCode: 'local-evidence-only',
  },
  {
    id: '14500000-0000-4000-8000-000000000012', rowNumber: 3, targetKind: 'case-number',
    maskedDisplay: 'Дело A40-••••••/2026', status: 'failed', evidenceKind: null,
    confidenceCode: 'unknown', provenanceCode: null, caveatCode: 'local-evidence-only',
  },
];

const paginatedCaseBatchItems = Array.from({ length: 110 }, (_, index) => {
  const rowNumber = index + 4;
  return {
    id: `14500000-0000-4000-8000-${String(index + 13).padStart(12, '0')}`,
    rowNumber,
    targetKind: 'case-number',
    maskedDisplay: rowNumber === 113 ? CASE_BATCH_LATER_PAGE_MASKED : `Дело A40-••••••/${rowNumber}`,
    status: 'not-found-local',
    evidenceKind: null,
    confidenceCode: 'unknown',
    provenanceCode: null,
    caveatCode: 'local-evidence-only',
  };
});

export const caseBatchItems = Object.freeze([...primaryCaseBatchItems, ...paginatedCaseBatchItems]);

export function caseBatchJob(status = 'processing') {
  return {
    id: jobId,
    status,
    createdAtUtc: '2026-07-16T00:00:00Z',
    updatedAtUtc: '2026-07-16T00:01:00Z',
    totalItems: caseBatchItems.length,
    pendingItems: status === 'processing' ? caseBatchItems.length - 1 : 0,
    processingItems: 0,
    completedItems: status === 'processing' ? 1 : caseBatchItems.length,
    failedItems: status === 'completed-with-failures' ? 1 : 0,
    canCancel: status === 'processing',
    canResume: status === 'canceled',
    canRetryFailed: status === 'completed-with-failures',
  };
}
