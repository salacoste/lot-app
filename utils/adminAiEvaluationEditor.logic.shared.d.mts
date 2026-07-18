export type EvaluationPatchOperation = 'keep' | 'set' | 'clear';
export type AdminEvaluationFieldName =
  | 'estimatedPrice'
  | 'liquidityScore'
  | 'investmentSummary'
  | 'reasoningText';
export type AdminEvaluationFieldState = {
  op: EvaluationPatchOperation;
  value: string;
};
export type AdminEvaluationFieldStates = Record<AdminEvaluationFieldName, AdminEvaluationFieldState>;
export type AdminEvaluationPatchField = {
  op: EvaluationPatchOperation;
  value?: number | string;
};
export type AdminEvaluationPatchFields = Record<AdminEvaluationFieldName, AdminEvaluationPatchField>;

export const MAX_ESTIMATED_PRICE: number;

export function buildAdminEvaluationPatchFields(fields: AdminEvaluationFieldStates): {
  fields: AdminEvaluationPatchFields | null;
  errors: Partial<Record<AdminEvaluationFieldName, string>>;
};

export function shouldApplyEvaluationFetchResult(state: {
  isControlled: boolean;
  aborted: boolean;
}): boolean;
