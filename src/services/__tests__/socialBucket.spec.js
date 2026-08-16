/**
 * Social Bucket minting contract.
 *
 * The important boundary is the mint's canonical quote: npub.cash may return
 * both locked and unlocked quotes, and sending a NUT-20 signature for the
 * latter is rejected by CDK mints.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { mintQuotes } from '../socialBucket.js';

const PRIVKEY = '01'.padStart(64, '0');

function fakeWallet(canonicalQuotes) {
  const calls = { checked: [], minted: [] };
  return {
    calls,
    async checkMintQuoteBolt11(quoteId) {
      calls.checked.push(quoteId);
      const quote = canonicalQuotes[quoteId];
      if (quote instanceof Error) throw quote;
      return quote;
    },
    async mintProofsBolt11(amount, quote, config) {
      calls.minted.push({ amount, quote, config });
      return [{ amount, id: `proof:${quote.quote}` }];
    },
  };
}

test('unlocked quote is re-checked and minted without a signature', async () => {
  const canonical = {
    quote: 'quote-unlocked',
    amount: 200,
    state: 'PAID',
    unit: 'sat',
    pubkey: null,
    expiry: 1,
  };
  const wallet = fakeWallet({ 'quote-unlocked': canonical });

  const result = await mintQuotes({
    quotes: [{ quoteId: 'quote-unlocked', amount: 999 }],
    privkeyHex: PRIVKEY,
    mintUrl: 'https://mint.example',
    walletFactory: async () => wallet,
  });

  assert.deepEqual(wallet.calls.checked, ['quote-unlocked']);
  assert.equal(wallet.calls.minted.length, 1);
  assert.equal(wallet.calls.minted[0].amount, 200, 'mint amount is authoritative');
  assert.equal(wallet.calls.minted[0].quote.quote, canonical.quote);
  assert.equal(
    'expiry' in wallet.calls.minted[0].quote,
    false,
    'paid quote invoice expiry must not block redemption',
  );
  assert.equal(wallet.calls.minted[0].config, undefined, 'no signature for unlocked quote');
  assert.deepEqual(result.minted, ['quote-unlocked']);
  assert.equal(result.proofs[0].amount, 200);
  assert.deepEqual(result.failed, []);
});

test('locked quote receives signing key candidates for compressed-key parity', async () => {
  const pubkey = Buffer.from(
    secp256k1.getPublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? 1 : 0)), true),
  ).toString('hex');
  const canonical = {
    quote: 'quote-locked',
    amount: 500,
    state: 'PAID',
    unit: 'sat',
    pubkey,
  };
  const wallet = fakeWallet({ 'quote-locked': canonical });

  const result = await mintQuotes({
    quotes: [{ quoteId: 'quote-locked', amount: 500 }],
    privkeyHex: PRIVKEY,
    mintUrl: 'https://mint.example',
    walletFactory: async () => wallet,
  });

  const keys = wallet.calls.minted[0].config?.privkey;
  assert.ok(Array.isArray(keys));
  assert.ok(keys.includes(PRIVKEY));
  assert.equal(keys.length, 2);
  assert.deepEqual(result.minted, ['quote-locked']);
});

test('one unready or unreachable quote does not block the rest of the batch', async () => {
  const wallet = fakeWallet({
    pending: { quote: 'pending', amount: 10, state: 'UNPAID', unit: 'sat' },
    broken: new Error('network down'),
    paid: { quote: 'paid', amount: 20, state: 'PAID', unit: 'sat' },
  });

  const result = await mintQuotes({
    quotes: [
      { quoteId: 'pending', amount: 10 },
      { quoteId: 'broken', amount: 10 },
      { quoteId: 'paid', amount: 20 },
    ],
    privkeyHex: PRIVKEY,
    mintUrl: 'https://mint.example',
    walletFactory: async () => wallet,
  });

  assert.deepEqual(result.minted, ['paid']);
  assert.equal(result.proofs.length, 1);
  assert.deepEqual(result.failed.map((failure) => failure.quoteId), ['pending', 'broken']);
});
