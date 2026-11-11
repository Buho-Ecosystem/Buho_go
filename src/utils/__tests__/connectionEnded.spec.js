import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isConnectionEnded } from '../connectionEnded.js';

const lnbits404 = (message) => Object.assign(new Error(message), { status: 404 });

test('a connection the wallet no longer knows has ended', () => {
  assert.equal(isConnectionEnded('nwc', { code: 'UNAUTHORIZED', message: 'retired' }), true);
  assert.equal(isConnectionEnded('lnbits', lnbits404('LNBits API error: Wallet not found.')), true);
});

test('silence, a refusal or a missing page is not an ended connection', () => {
  assert.equal(isConnectionEnded('nwc', { code: 'INTERNAL', message: 'reply timeout' }), false);
  assert.equal(isConnectionEnded('nwc', { code: 'RESTRICTED' }), false);
  assert.equal(isConnectionEnded('lnbits', lnbits404('LNBits API error: Not Found')), false, 'an extension that is not installed');
  assert.equal(isConnectionEnded('lnbits', Object.assign(new Error('Wallet not found.'), { status: 500 })), false);
  assert.equal(isConnectionEnded('lnbits', { isNetworkError: true, message: 'Network error' }), false);
  assert.equal(isConnectionEnded('spark', { code: 'UNAUTHORIZED' }), false);
  assert.equal(isConnectionEnded('nwc', null), false);
});
