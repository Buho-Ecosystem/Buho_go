import assert from 'node:assert/strict';
import { test } from 'node:test';
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.fetch = async () => { throw new Error('network disabled under test'); };
const { BreezSparkWalletProvider } = await import('../BreezSparkWalletProvider.js');
const { fiatRatesService } = await import('../../utils/fiatRates.js');
fiatRatesService.stopAutoUpdate();
function provider(sdk) {
  const result = new BreezSparkWalletProvider('address-test', { _testSdk: sdk });
  result.isConnected = true;
  return result;
}

test('lookup failure propagates instead of claiming there is no address', async () => {
  const failure = new Error('offline');
  const p = provider({ getLightningAddress: async () => { throw failure; } });
  await assert.rejects(() => p.getLightningAddress(), error => error === failure);
});

test('reclaim waits for durable pending state and does not mint another name after response loss', async () => {
  const requests = [];
  let marked = false;
  const p = provider({
    getLightningAddress: async () => null,
    checkLightningAddressAvailable: async ({ username }) => { assert.equal(username, 'remembered'); return true; },
    registerLightningAddress: async request => { assert.ok(marked); requests.push(request); throw new Error('response lost'); },
  });
  await assert.rejects(() => p.ensureLightningAddress({ previousAddress: 'remembered@btc.example.com', beforeRegister: async () => { marked = true; } }), /response lost/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].username, 'remembered');
});

test('a confirmed snapshot overrides a stale SDK cache during subsequent setup', async () => {
  const p = provider({ getLightningAddress: async () => ({ lightningAddress: 'stale@btc.example.com' }) });
  p.noteLightningAddress({ lightningAddress: 'verified@btc.example.com' });
  assert.equal(await p.ensureLightningAddress(), 'verified@btc.example.com');
  assert.equal((await p.getLightningAddress()).lightningAddress, 'verified@btc.example.com');
});
