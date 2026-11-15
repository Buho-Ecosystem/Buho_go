/** Spark chain lookups: several servers, asked in order, the one that answers kept. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SPARK_CHAIN_SERVERS, createFallbackChainService, sparkChainService } from '../sparkChainService.js';
import { DEFAULT_ESPLORA_ENDPOINTS } from '../esplora.js';

const never = () => new Promise(() => {});

// The SDK's own servers fail with text, never an Error object.
const statusError = (status, body) => `Service connectivity: Status error: ${status} - ${body}`;

function server(name, { fail = false, hang = false, broadcastError = null } = {}) {
  const calls = [];
  const answer = (method, value) => (...args) => {
    calls.push([method, ...args]);
    if (hang) return never();
    if (fail) return Promise.reject(typeof fail === 'string' ? fail : `Service connectivity: ${name} is down`);
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
      if (hang) return never();
      return broadcastError ? Promise.reject(statusError(400, broadcastError)) : Promise.resolve();
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

test('when every server fails, the SDK gets text, and a server\'s own answer beats a later silence', async () => {
  const both = createFallbackChainService([server('a', { fail: true }), server('b', { fail: true })]);
  await assert.rejects(both.recommendedFees(), (error) => error === 'Service connectivity: b is down');

  const busy = statusError(503, 'Service Unavailable');
  const busyThenSilence = createFallbackChainService(
    [server('a', { fail: busy }), server('b', { hang: true })], { timeoutMs: 20 });
  await assert.rejects(busyThenSilence.getTransactionStatus('tx'), (error) => error === busy);

  const silent = createFallbackChainService([server('a', { hang: true })], { timeoutMs: 20 });
  await assert.rejects(silent.tipHeight(), (error) => typeof error === 'string' && /did not answer in time/.test(error));
});

test('a server\'s verdict is the answer: the next server is not asked to repeat it', async () => {
  const notFound = `Not found: ${statusError(404, 'Transaction not found')}`;
  const answering = server('answering', { fail: notFound });
  const dead = server('dead', { hang: true });
  const chain = createFallbackChainService([answering, dead], { timeoutMs: 20 });
  await assert.rejects(chain.getTransactionStatus('tx'), (error) => error === notFound);
  assert.equal(dead.calls.length, 0);

  for (const status of [429, 403, 451, 401, 502]) {
    const blocked = server('blocked', { fail: statusError(status, 'no') });
    const other = server('other');
    assert.equal(await createFallbackChainService([blocked, other]).tipHeight(), 900_000, `${status} asks the next`);
  }
});

test('an Error object from a server reaches the SDK as its message', async () => {
  const thrower = { ...server('x'), tipHeight: () => Promise.reject(new Error('socket hang up')) };
  await assert.rejects(createFallbackChainService([thrower]).tipHeight(), (error) => error === 'socket hang up');
});

test('a broadcast a server already has counts as sent; a refusal is final; a server in trouble passes it on', async () => {
  const known = server('known', { broadcastError: 'sendrawtransaction RPC error: txn-already-in-mempool' });
  const next = server('next');
  assert.equal(await createFallbackChainService([known, next]).broadcastTransaction('tx'), undefined);
  assert.equal(next.calls.length, 0);

  const confirmed = server('confirmed', { broadcastError: 'sendrawtransaction RPC error: Transaction outputs already in utxo set' });
  assert.equal(await createFallbackChainService([confirmed, next]).broadcastTransaction('tx'), undefined, 'already confirmed');
  assert.equal(next.calls.length, 0);

  // A refusal is the network's verdict: the SDK reads it, no server is asked again.
  const refusal = statusError(400, 'bad-txns-inputs-missingorspent');
  await assert.rejects(
    createFallbackChainService([server('r', { broadcastError: 'bad-txns-inputs-missingorspent' }), next]).broadcastTransaction('tx'),
    (error) => error === refusal,
  );
  assert.equal(next.calls.length, 0);

  // A server in trouble passes the broadcast on.
  const down = { ...server('down'), broadcastTransaction: () => Promise.reject(statusError(502, 'Bad Gateway')) };
  await createFallbackChainService([down, next]).broadcastTransaction('tx');
  assert.deepEqual(next.calls, [['broadcastTransaction', 'tx']]);
});

test('every Spark wallet on mainnet shares one chain service over the exit servers', async () => {
  const built = [];
  const mod = { newRestChainService: async (url, network, api) => { built.push([url, network, api]); return server(url); } };
  const [a, b] = await Promise.all([sparkChainService(mod, 'mainnet'), sparkChainService(mod, 'mainnet')]);
  assert.equal(a, b);
  assert.deepEqual(built, [
    ['https://mempool.space/api', 'mainnet', 'mempoolSpace'],
    ['https://blockstream.info/api', 'mainnet', 'esplora'],
    ['https://mempool.emzy.de/api', 'mainnet', 'mempoolSpace'],
  ]);
  assert.deepEqual(SPARK_CHAIN_SERVERS.map(({ url }) => url), [...DEFAULT_ESPLORA_ENDPOINTS], 'the emergency exit\'s servers, in its order');
  assert.equal(await sparkChainService(mod, 'regtest'), null, 'other networks keep the SDK default');
  assert.equal(await sparkChainService({}, 'mainnet'), null, 'an SDK without the factory keeps its default');
});
