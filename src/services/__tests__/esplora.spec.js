import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEsploraClient, isAlreadyKnownMessage, EsploraError } from '../esplora.js';

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    const handler = routes.find(([match]) => url.includes(match));
    if (!handler) throw new Error(`network down: ${url}`);
    const { status = 200, body = '' } = typeof handler[1] === 'function' ? handler[1](url, init) : handler[1];
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { fetchImpl, calls };
}
const endpoints = ['https://a.example/api', 'https://b.example/api'];

test('reads fail over to the next endpoint on outages and server errors', async () => {
  const { fetchImpl, calls } = fakeFetch([['a.example/api/blocks', { status: 503, body: 'down' }], ['b.example/api/blocks', { body: '912345' }]]);
  const client = createEsploraClient({ endpoints, fetchImpl });
  assert.equal(await client.tipHeight(), 912345);
  assert.deepEqual(calls.map(c => c.url), ['https://a.example/api/blocks/tip/height', 'https://b.example/api/blocks/tip/height']);
});

test('a tx the network never saw is reported as unknown, not as an error', async () => {
  const { fetchImpl } = fakeFetch([
    ['/tx/known/status', { body: JSON.stringify({ confirmed: true, block_height: 900000 }) }],
    ['/tx/fresh/status', { status: 404, body: 'Transaction not found' }],
  ]);
  const client = createEsploraClient({ endpoints, fetchImpl });
  assert.deepEqual(await client.txStatus('known'), { known: true, confirmed: true, blockHeight: 900000 });
  assert.deepEqual(await client.txStatus('fresh'), { known: false, confirmed: false });
});

test('utxos and fee tiers are normalised across the two API shapes', async () => {
  const { fetchImpl } = fakeFetch([
    ['/address/bc1qfee/utxo', { body: JSON.stringify([{ txid: 't', vout: 1, value: 9100, status: { confirmed: true, block_height: 5 } }]) }],
    ['a.example/api/v1/fees/recommended', { status: 404, body: '' }],
    ['b.example/api/v1/fees/recommended', { status: 404, body: '' }],
    ['/fee-estimates', { body: JSON.stringify({ 1: 12.4, 3: 8.1, 6: 4.2 }) }],
  ]);
  const client = createEsploraClient({ endpoints, fetchImpl });
  assert.deepEqual(await client.utxos('bc1qfee'), [{ txid: 't', vout: 1, value: 9100, confirmed: true, blockHeight: 5 }]);
  assert.deepEqual(await client.recommendedFees(), { fast: 13, medium: 9, slow: 5, minimum: 1 });
});

test('package broadcast sends both transactions and treats an already-known reply as success', async () => {
  const { fetchImpl, calls } = fakeFetch([['a.example/api/txs/package', { body: JSON.stringify({ package_msg: 'success' }) }]]);
  const client = createEsploraClient({ endpoints, fetchImpl });
  assert.deepEqual(await client.broadcastPackage(['aa', 'bb']), { package_msg: 'success' });
  assert.deepEqual(JSON.parse(calls[0].body), ['aa', 'bb']);
  const known = createEsploraClient({ endpoints, fetchImpl: fakeFetch([['txs/package', { status: 400, body: 'txn-already-known' }]]).fetchImpl });
  assert.deepEqual(await known.broadcastPackage(['aa', 'bb']), { alreadyKnown: true });
  assert.equal(isAlreadyKnownMessage('Transaction already in block chain'), true);
});

test('a rejected package is surfaced, not retried on another node', async () => {
  const { fetchImpl, calls } = fakeFetch([['a.example/api/txs/package', { status: 400, body: 'TRUC-violation' }], ['b.example/api/txs/package', { body: '{}' }]]);
  const client = createEsploraClient({ endpoints, fetchImpl });
  await assert.rejects(() => client.broadcastPackage(['aa', 'bb']), error => error instanceof EsploraError && error.code === 'REJECTED' && /TRUC/.test(error.message));
  assert.equal(calls.length, 1);
  await assert.rejects(() => client.broadcastPackage([]), /1 to 25/);
});

test('a node without the package route is skipped, and single-tx broadcasts fail over too', async () => {
  const missing = fakeFetch([['a.example/api/txs/package', { status: 404, body: 'not found' }], ['b.example/api/txs/package', { body: '{"ok":true}' }]]);
  assert.deepEqual(await createEsploraClient({ endpoints, fetchImpl: missing.fetchImpl }).broadcastPackage(['aa', 'bb']), { ok: true });
  assert.equal(missing.calls.length, 2);
  const single = fakeFetch([['a.example/api/tx', { status: 503, body: 'busy' }], ['b.example/api/tx', { body: 'txid-b' }]]);
  assert.equal(await createEsploraClient({ endpoints, fetchImpl: single.fetchImpl }).broadcastTx('aa'), 'txid-b');
  const rejected = fakeFetch([['a.example/api/tx', { status: 400, body: 'bad-txns-inputs-missingorspent' }], ['b.example/api/tx', { body: 'txid-b' }]]);
  await assert.rejects(() => createEsploraClient({ endpoints, fetchImpl: rejected.fetchImpl }).broadcastTx('aa'), error => error.code === 'REJECTED');
  assert.equal(rejected.calls.length, 1);
});
