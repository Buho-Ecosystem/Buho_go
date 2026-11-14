/** Real provider and SDK response shapes; preparation never sends funds. */
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => { throw new Error('network disabled under test'); };
const { BreezSparkWalletProvider } = await import('../BreezSparkWalletProvider.js');
const { getWithdrawQuote } = await import('../../services/breezSdk.js');
const ADDRESS = 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uc489gg2';
// Reference Spark codec fixtures: 500-sat invoice and amountless invoice.
const FIXED = 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uczgvssqgjzrv7pelw7h7yxz53rq0jvtf58dpzyqcg7spsu6khyg';
const AMOUNTLESS = 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uczgvqsqgjzrv7pelw7h7yxz53rq0jvtf58dpzyqsgqqvcylnd';
function harness(method = { type: 'sparkAddress', address: ADDRESS, fee: '0' }) {
  const requests = [], sends = [];
  const sdk = {
    async prepareSendPayment(request) { requests.push(request); return { amount: request.amount || 500n, paymentMethod: method, feePolicy: 'feesExcluded' }; },
    async sendPayment(request) { sends.push(request); return { payment: { id: 'paid', status: 'completed' } }; },
  };
  const provider = new BreezSparkWalletProvider('test', { name: 'Test', _testSdk: sdk });
  provider.isConnected = true;
  return { provider, sdk, requests, sends };
}
let passed = 0, failed = 0;
async function test(name, run) {
  try { await run(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (error) { failed += 1; console.error(`  ✗ ${name}\n    ${error.stack}`); }
}

await test('address quotes use explicit SDK fee and the actual selected amount without sending', async () => {
  const { provider, requests, sends } = harness();
  assert.deepEqual(await provider.getSparkSendFeeEstimate(ADDRESS, 1250), { estimatedFeeSats: 0, isEstimated: false, request: ADDRESS });
  assert.deepEqual(requests[0], { paymentRequest: { type: 'input', input: ADDRESS }, amount: 1250n });
  assert.equal(sends.length, 0);
  assert.equal(provider.isConnected, true);
});
await test('fixed invoice prepares without an amount override, even if the preview supplies one', async () => {
  const { provider, requests } = harness({ type: 'sparkInvoice', sparkInvoiceDetails: { amount: '500' }, fee: '0' });
  assert.equal((await provider.getSparkSendFeeEstimate(FIXED, 900)).estimatedFeeSats, 0);
  assert.equal(requests[0].paymentRequest.input, FIXED);
  assert.equal(requests[0].amount, undefined);
});
await test('amountless invoice quotes the selected amount and rejects missing or invalid amounts', async () => {
  const { provider, requests } = harness({ type: 'sparkInvoice', sparkInvoiceDetails: { amount: null }, fee: '0' });
  await provider.getSparkSendFeeEstimate(AMOUNTLESS, 2500);
  assert.equal(requests[0].amount, 2500n);
  for (const amount of [null, 0, -1, '2500', 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(provider.getSparkSendFeeEstimate(AMOUNTLESS, amount), /positive whole number/);
  }
  assert.equal(requests.length, 1);
});
await test('missing, nonnumeric, nonfinite, negative and fractional SDK fees never invent Free', async () => {
  for (const fee of [undefined, null, '', false, 'no fee', NaN, Infinity, -1, '-1', '0.5', .5]) {
    const { provider, sends } = harness({ type: 'sparkAddress', fee });
    await assert.rejects(provider.getSparkSendFeeEstimate(ADDRESS, 100), /No Spark fee quote/);
    assert.equal(sends.length, 0);
  }
});
await test('a nonzero native SDK fee is rejected by the existing zero-fee contract', async () => {
  for (const [request, type] of [[ADDRESS, 'sparkAddress'], [FIXED, 'sparkInvoice']]) {
    const { provider, sends } = harness({ type, fee: '7' });
    await assert.rejects(provider.getSparkSendFeeEstimate(request, 100), /7 sat fee.*fee-free/);
    assert.equal(sends.length, 0);
    assert.equal(provider.isConnected, true, 'a quote refusal does not disconnect a healthy provider');
  }
});
await test('another SDK payment method cannot be passed off as a native fee quote', async () => {
  const { provider } = harness({ type: 'bolt11Invoice', fee: '0' });
  await assert.rejects(provider.getSparkSendFeeEstimate(ADDRESS, 100), /No Spark fee quote/);
});
await test('SDK preparation failure stays unavailable without percentage or zero fallback', async () => {
  const { provider, sdk, sends } = harness();
  sdk.prepareSendPayment = async () => { throw new Error('no route'); };
  await assert.rejects(provider.getSparkSendFeeEstimate(ADDRESS, 100), /no route/);
  assert.equal(sends.length, 0);
});
await test('quote caching is amount-bound and actual native send still makes a fresh prepare', async () => {
  const { provider, sdk, requests, sends } = harness();
  await provider.getSparkSendFeeEstimate(ADDRESS, 100);
  await provider.getSparkSendFeeEstimate(ADDRESS, 100);
  assert.equal(requests.length, 1);
  await provider.getSparkSendFeeEstimate(ADDRESS, 200);
  assert.equal(requests.length, 2);
  sdk.prepareSendPayment = async request => { requests.push(request); return { paymentMethod: { type: 'sparkAddress', fee: '2' } }; };
  await assert.rejects(provider.transferToSparkAddress(ADDRESS, 100), /2 sat fee/);
  assert.equal(requests.length, 3, 'execution retains its fresh:true safety policy');
  assert.equal(sends.length, 0);
});

const BITCOIN_ADDRESS = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
function onchainQuote(id = 'complete') {
  return { id, expiresAt: 2000000000, isEstimate: false,
    speedSlow: { userFeeSat: 10, l1BroadcastFeeSat: 20 },
    speedMedium: { userFeeSat: 20, l1BroadcastFeeSat: 30 },
    speedFast: { userFeeSat: 30, l1BroadcastFeeSat: 40 },
  };
}
await test('only a complete explicit SDK on-chain quote is mapped and remembered', async () => {
  const raw = onchainQuote('valid-raw');
  const { provider, sends } = harness({ type: 'bitcoinAddress', feeQuote: raw });
  const tiers = await provider.getWithdrawalFeeQuote(1000, BITCOIN_ADDRESS);
  assert.equal(tiers.slow.totalFee, 30);
  assert.equal(tiers.medium.totalFee, 50);
  assert.equal(tiers.fast.totalFee, 70);
  assert.equal(getWithdrawQuote(provider.walletId, raw.id).prepareResponse.paymentMethod.feeQuote, raw);
  assert.equal(sends.length, 0);
});
await test('missing or invalid on-chain quote IDs never reach the cache or zero-filling mapper', async () => {
  for (const id of [undefined, null, '', '   ', 42]) {
    const { provider } = harness({ type: 'bitcoinAddress', feeQuote: { ...onchainQuote(), id } });
    await assert.rejects(provider.getWithdrawalFeeQuote(1000, BITCOIN_ADDRESS), /No withdrawal fee quote/);
    assert.equal(getWithdrawQuote(provider.walletId, id), null);
  }
});
await test('missing, string, negative, fractional and nonfinite SDK on-chain fee legs are unavailable', async () => {
  let sequence = 0;
  for (const speed of ['speedSlow', 'speedMedium', 'speedFast']) {
    for (const field of ['userFeeSat', 'l1BroadcastFeeSat']) {
      for (const value of [undefined, null, '0', -1, NaN, Infinity, .5]) {
        const raw = onchainQuote(`invalid-leg-${++sequence}`);
        raw[speed][field] = value;
        const { provider } = harness({ type: 'bitcoinAddress', feeQuote: raw });
        await assert.rejects(provider.getWithdrawalFeeQuote(1000, BITCOIN_ADDRESS), /No withdrawal fee quote/);
        assert.equal(getWithdrawQuote(provider.walletId, raw.id), null);
      }
    }
    const raw = onchainQuote(`missing-speed-${speed}`);
    delete raw[speed];
    const { provider } = harness({ type: 'bitcoinAddress', feeQuote: raw });
    await assert.rejects(provider.getWithdrawalFeeQuote(1000, BITCOIN_ADDRESS), /No withdrawal fee quote/);
  }
});
await test('explicit SDK zero on all on-chain speed legs remains a valid fee-free quote', async () => {
  const raw = onchainQuote('explicit-zero');
  for (const speed of ['speedSlow', 'speedMedium', 'speedFast']) raw[speed] = { userFeeSat: 0, l1BroadcastFeeSat: 0 };
  const { provider } = harness({ type: 'bitcoinAddress', feeQuote: raw });
  const tiers = await provider.getWithdrawalFeeQuote(1000, BITCOIN_ADDRESS);
  assert.equal(tiers.slow.totalFee, 0);
  assert.equal(tiers.medium.totalFee, 0);
  assert.equal(tiers.fast.totalFee, 0);
  assert.notEqual(getWithdrawQuote(provider.walletId, raw.id), null);
});
console.log(`\n${passed} passed, ${failed} failed`);
// Existing provider import graph owns a fiat-rate timer; keep this offline script finite.
process.exit(failed > 0 ? 1 : 0);
