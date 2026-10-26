/**
 * unseenReceipts store: adds, clears and survives a restart.
 *
 * Run directly with Node:
 *   node --test src/stores/__tests__/unseenReceipts.spec.js
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}
globalThis.localStorage = new MemoryStorage();

const { createPinia, setActivePinia } = await import('pinia');
const { useUnseenReceiptsStore } = await import('../unseenReceipts.js');
const { UNSEEN_RECEIPTS_KEY } = await import('../../utils/unseenReceipts.js');

const fresh = () => { setActivePinia(createPinia()); return useUnseenReceiptsStore(); };

test('receipts to a wallet add up until that wallet is seen', () => {
  const store = fresh();
  store.add({ walletId: 'w2', amountSats: 13, at: 100 });
  store.add({ walletId: 'w2', amountSats: 7, at: 200 });
  assert.deepEqual(store.forWallet('w2'), { sats: 20, count: 2, since: 100 });
  assert.equal(store.forWallet('w1'), null);

  store.markSeen('w2');
  assert.equal(store.forWallet('w2'), null);
  assert.equal(globalThis.localStorage.getItem(UNSEEN_RECEIPTS_KEY), null);
});

test('what was not seen is still there after a restart; wallets that left are forgotten', () => {
  let store = fresh();
  store.add({ walletId: 'w2', amountSats: 13, at: Date.now() });
  store.add({ walletId: 'gone', amountSats: 1, at: Date.now() });

  store = fresh();
  assert.equal(store.forWallet('w2')?.sats, 13);
  store.prune(['w1', 'w2']);
  assert.equal(store.forWallet('gone'), null);
  assert.equal(store.forWallet('w2')?.sats, 13);
  store.markSeen('w2');
});
