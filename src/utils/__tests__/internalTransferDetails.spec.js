import assert from 'node:assert/strict';
import { test } from 'node:test';
import { internalTransferTransactionId, internalTransferDetailsRoute } from '../internalTransferDetails.js';

test('Spark links to the SDK payment, never its Lightning hash or preimage', () => {
  assert.equal(internalTransferTransactionId('spark', { id: 'sdk-payment', paymentHash: 'hash', preimage: 'proof' }), 'sdk-payment');
  assert.equal(internalTransferTransactionId('spark', { preimage: 'proof' }), null);
});

test('Lightning results use their hash, including snake-case NWC fields', () => {
  assert.equal(internalTransferTransactionId('lnbits', { paymentHash: 'hash', id: 'checking-id' }), 'hash');
  assert.equal(internalTransferTransactionId('nwc', { payment_hash: 'hash', preimage: 'proof' }), 'hash');
});

test('WebLN preimage-only results resolve the exact paid invoice hash offline', () => {
  // Decoder fixture only; never submitted to a provider.
  const invoice = 'lnbcrt45190n1p42dta6pp5g4ncw5dxn8qc4q5py4xwehshxfvfqqm5fl85rp5yef4act4x03lsdzu2pskjepqw3hjq3zf2dgycs2eyp2y2565ypz9y56gf9r9ggpgfaexgetjypy5gw3qgdfj6v3sxgmrqwf3xvknqvps8y5scqzzsxqzuysp5esvpf02e8wlpsttednes9nl4p30k30adw3mu8a63q3yvhyfjqayq9qxpqysgqq8mwenpwd8t07qu9y5ev0ngh98xhxssxfxyp89qupqnu47tgf8gqk2zvd8n3jf4fv922jceyqc5uzefxry0lvnp7xcckzxar8l8uxlqpht6qxr';
  assert.equal(internalTransferTransactionId('nwc', { preimage: 'proof' }, invoice), '45678751a699c18a8281254cecde1732589003744fcf418684ca6bdc2ea67c7f');
});

test('missing or malformed optional details never make a successful transfer fail', () => {
  assert.equal(internalTransferTransactionId('nwc', { preimage: 'proof' }, 'invalid'), null);
  assert.equal(internalTransferDetailsRoute(null, 'source'), null);
});

test('direct routes encode payment IDs and carry the source wallet without changing it', () => {
  assert.deepEqual(internalTransferDetailsRoute('payment/a?b#c', 'source wallet'), {
    path: '/transaction/payment%2Fa%3Fb%23c', query: { wallet: 'source wallet' },
  });
});
