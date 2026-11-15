import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  UNSEEN_RECEIPTS_KEY,
  UNSEEN_MAX_AGE_MS,
  isUnseenReceipt,
  addUnseenReceipt,
  clearUnseenReceipts,
  pruneUnseenReceipts,
  readUnseenReceipts,
  writeUnseenReceipts,
} from '../unseenReceipts.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

const receipt = (walletId, amountSats, extra = {}) => ({ walletId, amountSats, at: 1_000, ...extra });

test('a receipt is unseen only for a wallet other than the active one, and only when no screen confirmed it', () => {
  assert.equal(isUnseenReceipt(receipt('w2', 13), { activeWalletId: 'w1' }), true);
  assert.equal(isUnseenReceipt(receipt('w1', 13), { activeWalletId: 'w1' }), false);
  assert.equal(isUnseenReceipt(receipt('w2', 13), { activeWalletId: 'w1', confirmedOnScreen: true }), false);
  assert.equal(isUnseenReceipt(receipt('w2', 0), { activeWalletId: 'w1' }), false);
  assert.equal(isUnseenReceipt(null, { activeWalletId: 'w1' }), false);
});

test('receipts to the same wallet add up; the first one sets since', () => {
  let entries = addUnseenReceipt({}, receipt('w2', 13, { at: 500 }), 999);
  entries = addUnseenReceipt(entries, receipt('w2', 7, { at: 800 }), 999);
  entries = addUnseenReceipt(entries, { walletId: 'w3', amountSats: 1 }, 2_000);
  assert.deepEqual(entries, {
    w2: { sats: 20, count: 2, since: 500 },
    w3: { sats: 1, count: 1, since: 2_000 },
  });
});

test('clearing a wallet drops only its entry and leaves an untouched map identical', () => {
  const entries = { w2: { sats: 20, count: 2, since: 500 }, w3: { sats: 1, count: 1, since: 600 } };
  assert.deepEqual(clearUnseenReceipts(entries, 'w2'), { w3: { sats: 1, count: 1, since: 600 } });
  assert.equal(clearUnseenReceipts(entries, 'w9'), entries);
});

test('pruning forgets old entries and wallets that left the phone', () => {
  const now = 10_000_000_000;
  const entries = {
    old: { sats: 5, count: 1, since: now - UNSEEN_MAX_AGE_MS - 1 },
    gone: { sats: 5, count: 1, since: now - 10 },
    kept: { sats: 5, count: 1, since: now - 10 },
  };
  assert.deepEqual(pruneUnseenReceipts(entries, { now, walletIds: ['kept', 'old'] }), { kept: entries.kept });
  const untouched = { kept: entries.kept };
  assert.equal(pruneUnseenReceipts(untouched, { now }), untouched);
});

test('what is written is read back; garbage and empty maps are not', () => {
  const storage = new MemoryStorage();
  const now = 5_000_000;
  const entries = { w2: { sats: 13, count: 1, since: now - 1 } };
  writeUnseenReceipts(entries, storage);
  assert.deepEqual(readUnseenReceipts(storage, now), entries);

  writeUnseenReceipts({}, storage);
  assert.equal(storage.getItem(UNSEEN_RECEIPTS_KEY), null);

  storage.setItem(UNSEEN_RECEIPTS_KEY, '{not json');
  assert.deepEqual(readUnseenReceipts(storage, now), {});
  storage.setItem(UNSEEN_RECEIPTS_KEY, JSON.stringify({ w2: { sats: 'x' }, w3: { sats: 2, count: 1, since: now - 5 } }));
  assert.deepEqual(readUnseenReceipts(storage, now), { w3: { sats: 2, count: 1, since: now - 5 } });
  assert.deepEqual(readUnseenReceipts(undefined, now), {});
});
