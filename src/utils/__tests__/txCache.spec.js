import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TX_CACHE_KEY,
  readCachedTransactions,
  writeCachedTransactions,
  mergeCachedTransactions,
  clearCachedTransactions,
} from '../txCache.js';

function memoryStore() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    raw: () => data.get(TX_CACHE_KEY),
  };
}

const tx = (id, at) => ({ id, settled_at: at, amount: 1 });

test('nothing cached reads as an empty list', () => {
  const store = memoryStore();
  assert.deepEqual(readCachedTransactions('w1', { store }), []);
  assert.deepEqual(readCachedTransactions(null, { store }), []);
});

test('write keeps wallets apart and bounds the list', () => {
  const store = memoryStore();
  writeCachedTransactions('w1', [tx('a', 3), tx('b', 2), tx('c', 1)], { store, limit: 2 });
  writeCachedTransactions('w2', [tx('z', 9)], { store });
  assert.deepEqual(readCachedTransactions('w1', { store }).map((t) => t.id), ['a', 'b']);
  assert.deepEqual(readCachedTransactions('w2', { store }).map((t) => t.id), ['z']);
});

test('BigInt amounts are stored as numbers instead of failing the write', () => {
  const store = memoryStore();
  assert.equal(writeCachedTransactions('w1', [{ id: 'a', settled_at: 1, amount: 2100n }], { store }), true);
  assert.equal(readCachedTransactions('w1', { store })[0].amount, 2100);
});

test('a short fresh page keeps older cached rows and drops replaced ones', () => {
  const store = memoryStore();
  writeCachedTransactions('w1', [tx('c', 30), tx('b', 20), tx('a', 10)], { store });
  // The home card reads only the newest rows: a new payment plus c.
  mergeCachedTransactions('w1', [tx('d', 40), tx('c', 30)], { store });
  assert.deepEqual(readCachedTransactions('w1', { store }).map((t) => t.id), ['d', 'c', 'b', 'a']);
});

test('a cached row inside the fresh page range that the provider no longer returns is dropped', () => {
  const store = memoryStore();
  writeCachedTransactions('w1', [tx('c', 30), tx('gone', 25), tx('b', 20)], { store });
  mergeCachedTransactions('w1', [tx('c', 30), tx('b', 20)], { store });
  assert.deepEqual(readCachedTransactions('w1', { store }).map((t) => t.id), ['c', 'b']);
});

test('an empty fresh page empties the cache', () => {
  const store = memoryStore();
  writeCachedTransactions('w1', [tx('a', 1)], { store });
  mergeCachedTransactions('w1', [], { store });
  assert.deepEqual(readCachedTransactions('w1', { store }), []);
});

test('clear forgets one wallet only', () => {
  const store = memoryStore();
  writeCachedTransactions('w1', [tx('a', 1)], { store });
  writeCachedTransactions('w2', [tx('b', 1)], { store });
  clearCachedTransactions('w1', { store });
  assert.deepEqual(readCachedTransactions('w1', { store }), []);
  assert.deepEqual(readCachedTransactions('w2', { store }).map((t) => t.id), ['b']);
});

test('a corrupt cache reads as empty and is replaced on the next write', () => {
  const store = memoryStore();
  store.setItem(TX_CACHE_KEY, '{not json');
  assert.deepEqual(readCachedTransactions('w1', { store }), []);
  assert.equal(writeCachedTransactions('w1', [tx('a', 1)], { store }), true);
  assert.deepEqual(readCachedTransactions('w1', { store }).map((t) => t.id), ['a']);
});
