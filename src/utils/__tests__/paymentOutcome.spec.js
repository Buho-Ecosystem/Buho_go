/**
 * How a send ends when nobody answers (utils/paymentOutcome.js).
 *
 * Before a payment is handed to a wallet a silence is a plain failure:
 * nothing left, and trying again is safe. After it, a silence is an unknown
 * outcome: the payment may have gone through, and is never offered again.
 *
 * Run: node --test src/utils/__tests__/paymentOutcome.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PAYMENT_NOT_STARTED, PAYMENT_OUTCOME, PAYMENT_UNCONFIRMED,
  beforePaymentLeaves, outcomeOfError, withinPaymentDeadline,
} from '../paymentOutcome.js';

const never = () => new Promise(() => {});

test('no answer before the payment leaves is a failure; no answer after it is unknown', async () => {
  assert.equal(await beforePaymentLeaves(Promise.resolve('connected'), 5), 'connected');
  const early = await beforePaymentLeaves(never(), 5).catch((error) => error);
  assert.equal(early.code, PAYMENT_NOT_STARTED);
  assert.equal(outcomeOfError(early), PAYMENT_OUTCOME.FAILED, 'nothing was sent, so it can be tried again');

  const late = await withinPaymentDeadline(never(), 5).catch((error) => error);
  assert.equal(late.code, PAYMENT_UNCONFIRMED);
  assert.equal(outcomeOfError(late), PAYMENT_OUTCOME.UNKNOWN, 'it may have gone through, so it is not offered again');

  // A step that fails for its own reason keeps that reason.
  const refused = await beforePaymentLeaves(Promise.reject(new Error('wrong PIN')), 5).catch((error) => error);
  assert.equal(refused.message, 'wrong PIN');
});
