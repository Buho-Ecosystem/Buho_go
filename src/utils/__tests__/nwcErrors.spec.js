import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NWC_ERROR, isNoAnswer, isRelayFailure, isUncertainPaymentError, nwcError, nwcErrorText } from '../nwcErrors.js';

const t = (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, k) => String(params[k]));
// The SDK's own shapes: timeouts and network failures carry INTERNAL / OTHER.
const sdk = (message, code) => Object.assign(new Error(message), { code });

test('an unanswered payment is unknown, not failed', () => {
  assert.equal(isUncertainPaymentError(sdk('reply timeout: event abc', 'INTERNAL')), true);
  assert.equal(isUncertainPaymentError(sdk('publish timeout: abc', 'INTERNAL')), true);
  assert.equal(isUncertainPaymentError(sdk('something odd', 'INTERNAL')), true, 'a generic wallet error says nothing about the payment');
  assert.equal(isUncertainPaymentError(sdk('?', 'OTHER')), true);
});

test('a request that never left, or a clear refusal, is a plain failure', () => {
  assert.equal(isUncertainPaymentError(new Error('no info event (kind 13194) returned from relay')), false);
  assert.equal(isUncertainPaymentError(sdk('Failed to connect to wss://x', 'OTHER')), false);
  assert.equal(isUncertainPaymentError(sdk('failed to publish: x', 'INTERNAL')), false);
  for (const code of ['PAYMENT_FAILED', 'QUOTA_EXCEEDED', 'INSUFFICIENT_BALANCE', 'RESTRICTED', 'UNAUTHORIZED', 'RATE_LIMITED', 'NOT_IMPLEMENTED']) {
    assert.equal(isUncertainPaymentError(sdk('no', code)), false, code);
  }
});

test('only NWC-shaped errors are read by message', () => {
  assert.equal(isNoAnswer(new Error('reply timeout from somewhere else')), false);
  assert.equal(isRelayFailure(new Error('failed to connect to relay.damus.io')), false, 'a chat relay failure is not an NWC one');
  assert.equal(isNoAnswer(sdk('reply timeout: x', 'INTERNAL')), true);
  assert.equal(isNoAnswer(new Error('no info event (kind 13194) returned from relay')), true, 'no wallet behind the relay');
  assert.equal(isRelayFailure(sdk('Failed to connect to wss://x', 'OTHER')), true);
});

test('every NWC failure has a sentence with a next step', () => {
  const ctx = { walletName: 'Alby Hub', locale: 'en-US' };
  assert.match(nwcErrorText(sdk('', 'QUOTA_EXCEEDED'), t, ctx), /spending limit.*Alby Hub/);
  assert.match(nwcErrorText(sdk('', 'RESTRICTED'), t, ctx), /does not allow/);
  assert.match(nwcErrorText(sdk('', 'UNAUTHORIZED'), t, ctx), /removed or has expired/);
  assert.match(nwcErrorText(sdk('', 'RATE_LIMITED'), t, ctx), /Wait a moment/);
  assert.match(nwcErrorText(nwcError(NWC_ERROR.UNCONFIRMED), t, ctx), /pay twice/);
  assert.match(nwcErrorText(nwcError(NWC_ERROR.LIMIT_TOO_LOW, '', { remainingSats: 2400, renewsAt: Date.UTC(2026, 10, 1) }), t, ctx), /2,400 sats left until/);
  assert.match(nwcErrorText(sdk('reply timeout: x', 'INTERNAL'), t, ctx), /Alby Hub did not answer/);
  assert.match(nwcErrorText(sdk('Failed to connect to wss://x', 'OTHER'), t, ctx), /relay could not be reached/);
  assert.match(nwcErrorText(sdk('', 'QUOTA_EXCEEDED'), t), /your wallet app/, 'a fallback name');
});

test('errors that are not about NWC get no NWC words', () => {
  assert.equal(nwcErrorText(new Error('Network error'), t), null);
  assert.equal(nwcErrorText(sdk('route not found', 'PAYMENT_FAILED'), t), null, "the wallet's own reason passes through");
  assert.equal(nwcErrorText(sdk('boom', 'INTERNAL'), t), null);
});

test('an unconfirmed payment is never headed "Payment failed"', async () => {
  const { buildPaymentError } = await import('../userErrors.js');
  const built = buildPaymentError(nwcError(NWC_ERROR.UNCONFIRMED), { context: 'payment', walletName: 'Alby Hub' }, t);
  assert.equal(built.title, 'Payment not confirmed');
  assert.match(built.reason, /Check Alby Hub before trying again/);
});
