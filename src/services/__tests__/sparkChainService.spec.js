/** Spark chain lookups: several servers, asked in order, the one that answers kept. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createFallbackChainService, sparkChainService } from '../sparkChainService.js';
import { DEFAULT_ESPLORA_ENDPOINTS } from '../esplora.js';

const never = () => new Promise(() => {});

function server(name, { fail = false, hang = false, broadcastError = null } = {}) {
  const calls = [];
  const answer = (method, value) => (...args) => {
    calls.push([method, ...args]);
    if (hang) return never();
    if (fail) return Promise.reject(new Error(`${name} is down`));
    return Promise.resolve(value);
  };
  return {
    calls,
    getAddressUtxos: answer('getAddressUtxos', [{ txid: name }]),
    getAddressTxos: answer('getAddressTxos', []),
    getTransactionStatus: answer('getTransactionStatus', { confirmed: true }),
    tipHeight: answer('tipHeight', 900_000),
    getTransactionHex: answer('getTransactionHex', '00'),
    getOutspend: answer('getOutspend', { spent: false }),
    recommendedFees: answer('recommendedFees', { fastestFee: 3 }),
    broadcastTransaction: (tx) => {
      calls.push(['broadcastTransaction', tx]);
      return broadcastError ? Promise.reject(new Error(broadcastError)) : Promise.resolve();
    },
  };
}

test('a server that is down or silent is passed over, and the one that answered is asked first', async () => {
  const silent = server('silent', { hang: true });
  const down = server('down', { fail: true });
  const up = server('up');
  const chain = createFallbackChainService([silent, down, up], { timeoutMs: 20 });

  assert.deepEqual(await chain.getAddressUtxos('bc1q'), [{ txid: 'up' }]);
  assert.equal(await chain.tipHeight(), 900_000);
  assert.deepEqual(silent.calls.map(([m]) => m), ['getAddressUtxos'], 'asked once, then left alone');
  assert.deepEqual(up.calls.map(([m]) => m), ['getAddressUtxos', 'tipHeight']);
});

test('the first server is tried again after a while', async () => {
  let clock = 0;
  const first = server('first', { fail: true });
  const second = server('second');
  const chain = createFallbackChainService([first, second], { keepMs: 1_000, now: () => clock });
  await chain.tipHeight();
  await chain.tipHeight();
  assert.equal(first.calls.length, 1);
  clock = 1_001;
  await chain.tipHeight();
  assert.equal(first.calls.length, 2);
});

test('when every server fails, the last error is passed on', async () => {
  const chain = createFallbackChainService([server('a', { fail: true }), server('b', { fail: true })]);
  await assert.rejects(chain.recommendedFees(), /b is down/);
});

test('a broadcast a server already has counts as sent; any other refusal tries the next', async () => {
  const known = server('known', { broadcastError: 'sendrawtransaction RPC error: txn-already-in-mempool' });
  const next = server('next');
  assert.equal(await createFallbackChainService([known, next]).broadcastTransaction('tx'), undefined);
  assert.equal(next.calls.length, 0);

  const refusing = server('refusing', { broadcastError: 'bad-txns-inputs-missingorspent' });
  await createFallbackChainService([refusing, next]).broadcastTransaction('tx');
  assert.deepEqual(next.calls, [['broadcastTransaction', 'tx']]);
});

test('every Spark wallet on mainnet shares one chain service over the exit servers', async () => {
  const built = [];
  const mod = { newRestChainService: async (url, network, api) => { built.push([url, network, api]); return server(url); } };
  const [a, b] = await Promise.all([sparkChainService(mod, 'mainnet'), sparkChainService(mod, 'mainnet')]);
  assert.equal(a, b);
  assert.deepEqual(built, DEFAULT_ESPLORA_ENDPOINTS.map((url) => [url, 'mainnet', 'esplora']));
  assert.equal(await sparkChainService(mod, 'regtest'), null, 'other networks keep the SDK default');
  assert.equal(await sparkChainService({}, 'mainnet'), null, 'an SDK without the factory keeps its default');
});
