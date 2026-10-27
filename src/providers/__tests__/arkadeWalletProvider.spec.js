/**
 * Arkade history and live hints: a boarding deposit keeps one id from the
 * mempool to spendable, outputs of one transaction are one row, and only a
 * new output on the wallet's own addresses asks to look.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';

function loadModule() {
  const load = (file, deps) => {
    const { code } = transformSync(readFileSync(new URL(file, import.meta.url), 'utf8'), { format: 'cjs' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)((name) => deps[name] || {}, module, module.exports);
    return module.exports;
  };
  const base = load('../WalletProvider.js', {});
  return load('../ArkadeWalletProvider.js', {
    './WalletProvider': base,
    // The SDK's own guard: an event without a contract is a watch-only script.
    '@arkade-os/sdk': { isContractVtxoEvent: (event) => !!event.contract },
  });
}

const { ArkadeWalletProvider, arkadeTransactionRow } = loadModule();

function provider(history = [], manager = null) {
  const p = new ArkadeWalletProvider('ark-1', {});
  p.isConnected = true;
  p.wallet = {
    getTransactionHistory: async () => history,
    getContractManager: async () => manager,
  };
  return p;
}

const BOARD = 'b'.repeat(64);
const COMMIT = 'c'.repeat(64);

test('a boarding deposit keeps its on-chain id from the mempool until it is spendable', () => {
  const unconfirmed = arkadeTransactionRow({ key: { boardingTxid: BOARD }, type: 'RECEIVED', amount: 50000, settled: false, createdAt: 0 });
  const boarded = arkadeTransactionRow({ key: { boardingTxid: BOARD, commitmentTxid: COMMIT }, type: 'RECEIVED', amount: 50000, settled: true, createdAt: 1_790_000_000_000 });
  assert.deepEqual([unconfirmed.id, unconfirmed.status], [BOARD, 'pending']);
  assert.deepEqual([boarded.id, boarded.status, boarded.timestamp], [BOARD, 'completed', 1_790_000_000]);
});

test('offchain and batch rows keep the ids they had', () => {
  assert.equal(arkadeTransactionRow({ key: { arkTxid: 'a1' }, type: 'RECEIVED', amount: 1 }).id, 'a1');
  assert.equal(arkadeTransactionRow({ key: { commitmentTxid: COMMIT }, type: 'SENT', amount: 1, settled: true }).id, COMMIT);
});

test('outputs of one transaction are one row; history pages newest first', async () => {
  const history = [
    { key: { arkTxid: 'two-outputs' }, type: 'RECEIVED', amount: 300, createdAt: 3000 },
    { key: { arkTxid: 'two-outputs' }, type: 'RECEIVED', amount: 200, createdAt: 3000 },
    { key: { arkTxid: 'paid-out' }, type: 'SENT', amount: 100, createdAt: 2000 },
    { key: { arkTxid: 'older' }, type: 'RECEIVED', amount: 7, createdAt: 1000 },
  ];
  const p = provider(history);
  const all = await p.getTransactions();
  assert.deepEqual(all.map((r) => [r.id, r.type, r.amount]), [['two-outputs', 'incoming', 500], ['paid-out', 'outgoing', 100], ['older', 'incoming', 7]]);
  assert.deepEqual((await p.getTransactions({ offset: 1, limit: 1 })).map((r) => r.id), ['paid-out']);
  assert.deepEqual(await p.getTransactions({ offset: 5, limit: 2 }), []);
});

test('only a new output on the wallet\'s own addresses asks to look', async () => {
  let listener = null;
  let unsubscribed = 0;
  const manager = { onContractEvent: (fn) => { listener = fn; return () => { unsubscribed += 1; }; } };
  const p = provider([], manager);
  const hints = [];
  const watch = await p.watchPayments((hint) => hints.push(hint));
  listener({ type: 'vtxo_received', contract: { type: 'default' }, vtxos: [{ value: 10 }] });
  listener({ type: 'vtxo_spent', contract: { type: 'default' }, vtxos: [] });
  listener({ type: 'vtxo_received', vtxos: [] }); // a watch-only script, not ours
  listener({ type: 'connection_reset', timestamp: 1 });
  assert.deepEqual(hints, [{}]);
  await p.disconnect();
  assert.equal(unsubscribed, 1, 'disconnect stops every watch');
  listener({ type: 'vtxo_received', contract: { type: 'default' }, vtxos: [] });
  assert.equal(hints.length, 1);
  watch.stop();
  assert.equal(unsubscribed, 1, 'stopping twice is harmless');
});
