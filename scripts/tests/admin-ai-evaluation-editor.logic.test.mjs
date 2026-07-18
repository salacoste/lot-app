import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAdminEvaluationPatchFields,
  shouldApplyEvaluationFetchResult,
} from '../../utils/adminAiEvaluationEditor.logic.shared.mjs';

const fieldsWithPrice = (value) => ({
  estimatedPrice: { op: 'set', value },
  liquidityScore: { op: 'keep', value: '' },
  investmentSummary: { op: 'keep', value: '' },
  reasoningText: { op: 'keep', value: '' },
});

const fieldsWithLiquidity = (op, value = '') => ({
  estimatedPrice: { op: 'keep', value: '' },
  liquidityScore: { op, value },
  investmentSummary: { op: 'keep', value: '' },
  reasoningText: { op: 'keep', value: '' },
});

test('estimatedPrice set rejects empty, non-finite and backend-out-of-range values', () => {
  for (const value of ['', '   ', 'not-a-number', '1e309', '-1', '1000000000000001']) {
    const result = buildAdminEvaluationPatchFields(fieldsWithPrice(value));
    assert.equal(result.fields, null, `expected ${JSON.stringify(value)} to be rejected`);
    assert.ok(result.errors.estimatedPrice);
  }
});

test('estimatedPrice set preserves valid zero and upper-bound values', () => {
  const zero = buildAdminEvaluationPatchFields(fieldsWithPrice(' 0 '));
  assert.deepEqual(zero.errors, {});
  assert.equal(zero.fields.estimatedPrice.value, 0);

  const upperBound = buildAdminEvaluationPatchFields(fieldsWithPrice('1000000000000000'));
  assert.deepEqual(upperBound.errors, {});
  assert.equal(upperBound.fields.estimatedPrice.value, 1_000_000_000_000_000);
});

test('liquidityScore set rejects empty, non-finite, non-integer and out-of-range values', () => {
  for (const value of ['', '   ', 'not-a-number', 'Infinity', '0', '11', '1.5']) {
    const result = buildAdminEvaluationPatchFields(fieldsWithLiquidity('set', value));
    assert.equal(result.fields, null, `expected ${JSON.stringify(value)} to be rejected`);
    assert.ok(result.errors.liquidityScore);
  }
});

test('liquidityScore set emits valid trimmed boundary values as numbers', () => {
  const lowerBound = buildAdminEvaluationPatchFields(fieldsWithLiquidity('set', ' 1 '));
  assert.deepEqual(lowerBound.errors, {});
  assert.deepEqual(lowerBound.fields.liquidityScore, { op: 'set', value: 1 });

  const upperBound = buildAdminEvaluationPatchFields(fieldsWithLiquidity('set', '\t10\n'));
  assert.deepEqual(upperBound.errors, {});
  assert.deepEqual(upperBound.fields.liquidityScore, { op: 'set', value: 10 });
});

test('liquidityScore keep and clear do not validate or emit a value', () => {
  for (const op of ['keep', 'clear']) {
    const result = buildAdminEvaluationPatchFields(fieldsWithLiquidity(op, 'invalid'));
    assert.deepEqual(result.errors, {});
    assert.deepEqual(result.fields.liquidityScore, { op });
  }
});

test('late internal evaluation response cannot replace controlled or aborted data', () => {
  assert.equal(shouldApplyEvaluationFetchResult({ isControlled: false, aborted: false }), true);
  assert.equal(shouldApplyEvaluationFetchResult({ isControlled: true, aborted: false }), false);
  assert.equal(shouldApplyEvaluationFetchResult({ isControlled: false, aborted: true }), false);
});
