export const MAX_ESTIMATED_PRICE = 1_000_000_000_000_000;

/**
 * @param {{ op: 'keep' | 'set' | 'clear', value: string }} field
 * @returns {string | null}
 */
function validateEstimatedPrice(field) {
  if (field.op !== 'set') return null;

  const value = field.value.trim();
  if (!value) return 'Введите оценочную цену.';

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'Введите корректное конечное число.';
  if (parsed < 0 || parsed > MAX_ESTIMATED_PRICE) {
    return `Цена должна быть от 0 до ${MAX_ESTIMATED_PRICE}.`;
  }

  return null;
}

/**
 * @param {{ op: 'keep' | 'set' | 'clear', value: string }} field
 * @returns {string | null}
 */
function validateLiquidityScore(field) {
  if (field.op !== 'set') return null;

  const value = field.value.trim();
  if (!value) return 'Введите оценку ликвидности.';

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return 'Оценка ликвидности должна быть целым числом.';
  }
  if (parsed < 1 || parsed > 10) {
    return 'Оценка ликвидности должна быть от 1 до 10.';
  }

  return null;
}

/**
 * Builds the exact PATCH fields payload only when client-side validation succeeds.
 * @param {Record<'estimatedPrice' | 'liquidityScore' | 'investmentSummary' | 'reasoningText', { op: 'keep' | 'set' | 'clear', value: string }>} fields
 */
export function buildAdminEvaluationPatchFields(fields) {
  const errors = {};
  const estimatedPriceError = validateEstimatedPrice(fields.estimatedPrice);
  if (estimatedPriceError) errors.estimatedPrice = estimatedPriceError;
  const liquidityScoreError = validateLiquidityScore(fields.liquidityScore);
  if (liquidityScoreError) errors.liquidityScore = liquidityScoreError;

  if (Object.keys(errors).length > 0) {
    return { fields: null, errors };
  }

  return {
    fields: {
      estimatedPrice: fields.estimatedPrice.op === 'set'
        ? { op: 'set', value: Number(fields.estimatedPrice.value.trim()) }
        : { op: fields.estimatedPrice.op },
      liquidityScore: fields.liquidityScore.op === 'set'
        ? { op: 'set', value: Number(fields.liquidityScore.value.trim()) }
        : { op: fields.liquidityScore.op },
      investmentSummary: fields.investmentSummary.op === 'set'
        ? { op: 'set', value: fields.investmentSummary.value }
        : { op: fields.investmentSummary.op },
      reasoningText: fields.reasoningText.op === 'set'
        ? { op: 'set', value: fields.reasoningText.value }
        : { op: fields.reasoningText.op },
    },
    errors,
  };
}

/**
 * @param {{ isControlled: boolean, aborted: boolean }} state
 */
export function shouldApplyEvaluationFetchResult(state) {
  return !state.isControlled && !state.aborted;
}
