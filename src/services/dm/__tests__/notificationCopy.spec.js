/**
 * Notification copy: what each kind of message says.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/notificationCopy.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PREVIEW_LENGTH, createNotificationFormatter } from '../notificationCopy.js';

const t = (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, name) => params[name]);
const format = createNotificationFormatter({ t, formatAmount: (sats) => `${sats} sats` });

test('texts show a flattened preview, long ones are cut on a character boundary', () => {
  assert.equal(format({ type: 'text', text: '  hello\n\n  there ' }), 'hello there');
  const long = '😀'.repeat(PREVIEW_LENGTH + 20);
  const out = format({ type: 'text', text: long });
  assert.equal(Array.from(out).length, PREVIEW_LENGTH);
  assert.ok(out.endsWith('…'));
});

test('money messages say what they are, with the amount, never the invoice', () => {
  assert.equal(format({ type: 'request', request: { amountSats: 12_000, bolt11: 'lnbc1secret' } }), 'Requested 12000 sats');
  // Only the sender's word until the wallet shows it: the lock screen never confirms money.
  assert.equal(format({ type: 'payment', payment: { amountSats: 500 } }), 'Says they sent you 500 sats');
});

test('answers to a request', () => {
  const status = (value) => format({ type: 'status', status: { value } });
  assert.equal(status('paid'), 'Says they paid your request');
  assert.equal(status('declined'), 'Declined your request');
  assert.equal(status('cancelled'), 'Withdrew a request');
  assert.equal(status('reminder'), 'Reminder: a request is still open');
});

test('anything else falls back to a generic line', () => {
  assert.equal(format({ type: 'text', text: '   ' }), 'New message');
  assert.equal(format({ type: 'request' }), 'New message');
  assert.equal(format({ type: 'status', status: { value: 'weird' } }), 'New message');
  assert.equal(format(null), 'New message');
});

test('someone outside the address book gets no preview, whatever they sent', () => {
  for (const message of [
    { type: 'text', text: 'Hi, support here' },
    { type: 'payment', payment: { amountSats: 1_000_000 } },
    { type: 'request', request: { amountSats: 900_000 } },
  ]) {
    assert.equal(format(message, { known: false }), 'New message request');
  }
});
