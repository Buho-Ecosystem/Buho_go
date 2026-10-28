import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArkAddress } from '@arkade-os/sdk';
import { connectedArkade } from './arkadeHarness.js';

// Public test-vector addresses and coins; settle only records an unsigned plan.
const bitcoinAddress = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const arkadeAddress = new ArkAddress(new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)).encode();
function harness({ balance = 20000, exitFee = '100.0', inputFee = '10.0', changeFee = '20.0' } = {}) {
  const plans = [];
  const fees = { intentFee: { offchainInput: inputFee, onchainOutput: exitFee, offchainOutput: changeFee } };
  const provider = connectedArkade({
    dustAmount: 330n,
    arkProvider: { getInfo: async () => ({ dust: 330n, utxoMinAmount: 330n, vtxoMinAmount: 330n, fees }) },
    getAddress: async () => arkadeAddress,
    getSpendableVtxos: async () => [{ txid: '01'.repeat(32), vout: 0, value: balance, createdAt: new Date(), commitmentTxIds: [] }],
    settle: async plan => { plans.push(plan); return 'settlement'; },
  });
  return { provider, plans, fees };
}

test('the SDK quote includes exit, input and change fees and pays the recipient exactly', async () => {
  const { provider, plans } = harness();
  const quote = await provider.getBitcoinSendFeeEstimate({ bitcoinAddress, amount: 10000 });
  assert.deepEqual(quote, { amount: 10000, fee: 130, total: 10130 });
  const result = await provider.offboardToBitcoin({ bitcoinAddress, amount: 10000, maxFee: quote.fee });
  assert.equal(result.id, 'settlement');
  assert.equal(result.fee, 130);
  assert.deepEqual(plans[0].outputs[0], { address: bitcoinAddress, amount: 10000n });
  assert.equal(plans[0].outputs[1].amount, 9870n);
});

test('amount-dependent exit fees are priced on the exact recipient output', async () => {
  const { provider, plans } = harness({ exitFee: 'double(amount) / 100.0' });
  const quote = await provider.getBitcoinSendFeeEstimate({ bitcoinAddress, amount: 10000 });
  await provider.offboardToBitcoin({ bitcoinAddress, amount: 10000, maxFee: quote.fee });
  assert.equal(plans[0].outputs[0].amount, 10000n);
  assert.equal(quote.fee, 130);
});

test('a higher fee is refused before settlement and a lower fee stays within approval', async () => {
  const { provider, plans, fees } = harness();
  const quote = await provider.getBitcoinSendFeeEstimate({ bitcoinAddress, amount: 10000 });
  fees.intentFee.onchainOutput = '200.0';
  await assert.rejects(provider.offboardToBitcoin({ bitcoinAddress, amount: 10000, maxFee: quote.fee }), { code: 'ARKADE_OFFBOARD_FEE_CHANGED' });
  assert.equal(plans.length, 0);
  fees.intentFee.onchainOutput = '50.0';
  await provider.offboardToBitcoin({ bitcoinAddress, amount: 10000, maxFee: quote.fee });
  assert.equal(plans[0].outputs[0].amount, 10000n);
});

test('insufficient funds, dust change and a missing fee approval never reduce the payout', async () => {
  for (const balance of [10000, 10200]) {
    const { provider, plans } = harness({ balance });
    await assert.rejects(provider.offboardToBitcoin({ bitcoinAddress, amount: 10000, maxFee: 1000 }));
    assert.equal(plans.length, 0);
  }
  const { provider, plans } = harness();
  await assert.rejects(provider.offboardToBitcoin({ bitcoinAddress, amount: 10000 }), { code: 'ARKADE_OFFBOARD_FEE_CHANGED' });
  assert.equal(plans.length, 0);
});

test('invalid amounts and below-minimum payouts never reach settlement', async () => {
  const { provider, plans } = harness();
  for (const amount of [0, -1, NaN, Infinity, 0.5, 329]) {
    await assert.rejects(provider.offboardToBitcoin({ bitcoinAddress, amount, maxFee: 1000 }));
  }
  assert.equal(plans.length, 0);
});
