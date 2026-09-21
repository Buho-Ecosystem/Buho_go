/**
 * withdrawVouchers store — LUD-14 voucher tracking.
 *
 * What this guards:
 *   - a withdrawRequest without balanceCheck is not trackable and is ignored
 *   - URL rotation keeps ONE voucher (the newest URL wins, old ones stay
 *     matchable so rescanning the paper QR doesn't duplicate the entry)
 *   - a re-check updates the remaining balance and retires an empty voucher
 *   - an unreachable service keeps the last known figure rather than
 *     claiming the voucher is empty
 *   - forgetting drops only our copy
 *
 * Run directly with Node:
 *   node src/stores/__tests__/withdrawVouchers.spec.js
 */

import { strict as assert } from 'node:assert';

class MemoryStorage {
  constructor() { this._data = new Map(); }
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null; }
  setItem(key, value) { this._data.set(key, String(value)); }
  removeItem(key) { this._data.delete(key); }
  clear() { this._data.clear(); }
}

globalThis.localStorage = new MemoryStorage();

const { createPinia, setActivePinia } = await import('pinia');
const { useWithdrawVouchersStore } = await import('../withdrawVouchers.js');
const { withdrawInfo } = await import('../../utils/lnurlWithdraw.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    failed += 1;
  }
}

function freshStore() {
  globalThis.localStorage = new MemoryStorage();
  setActivePinia(createPinia());
  return useWithdrawVouchersStore();
}

/** A withdrawRequest as a service returns it. */
function withdrawRequest({ balanceCheck = 'https://atm.example/balance/abc', maxSats = 25, ...rest } = {}) {
  return {
    tag: 'withdrawRequest',
    k1: 'opaque-token',
    callback: 'https://atm.example/withdraw',
    minWithdrawable: 1000,
    maxWithdrawable: maxSats * 1000,
    defaultDescription: 'ATM voucher',
    ...(balanceCheck ? { balanceCheck } : {}),
    ...rest,
  };
}

const ok = (data) => async () => ({ ok: true, data });

console.log('withdrawVouchers store');

await test('a withdrawRequest with no balanceCheck is not a voucher', async () => {
  const store = freshStore();
  assert.equal(await store.track(withdrawInfo(withdrawRequest({ balanceCheck: null }))), null);
  assert.equal(store.list.length, 0);
});

await test('a balanceCheck on another host is refused at the parse boundary', async () => {
  const store = freshStore();
  const info = withdrawInfo(withdrawRequest({ balanceCheck: 'https://evil.example/balance/abc' }));
  assert.equal(info.balanceCheck, null);
  assert.equal(await store.track(info), null);
  assert.equal(store.list.length, 0);
});

await test('a tracked voucher keeps what is left in it, and is readable by any URL it answered under', async () => {
  const store = freshStore();
  const voucher = await store.track(withdrawInfo(withdrawRequest({ maxSats: 25 })));
  assert.equal(voucher.domain, 'atm.example');
  assert.equal(voucher.maxSats, 25);
  assert.equal(voucher.exhausted, false);
  assert.equal(store.active.length, 1);
  assert.equal(store.byUrl('https://atm.example/balance/abc').id, voucher.id);
});

await test('a rotated balanceCheck updates the same voucher instead of adding one', async () => {
  const store = freshStore();
  const first = await store.track(withdrawInfo(withdrawRequest({ maxSats: 25 })));
  const rotated = await store.refresh(first.id, {
    fetchJson: ok(withdrawRequest({ balanceCheck: 'https://atm.example/balance/def', maxSats: 10 })),
  });

  assert.equal(store.list.length, 1);
  assert.equal(rotated.ok, true);
  assert.equal(rotated.sats, 10);
  assert.equal(store.byId(first.id).balanceCheck, 'https://atm.example/balance/def');
  // The paper QR's original URL still resolves to this voucher.
  assert.equal(store.byUrl('https://atm.example/balance/abc').id, first.id);
  assert.equal(store.byUrl('https://atm.example/balance/def').id, first.id);
});

await test('a voucher that comes back empty retires itself', async () => {
  const store = freshStore();
  const voucher = await store.track(withdrawInfo(withdrawRequest({ maxSats: 25 })));
  const result = await store.refresh(voucher.id, { fetchJson: ok(withdrawRequest({ maxSats: 0 })) });

  assert.equal(result.ok, true);
  assert.equal(result.sats, 0);
  assert.equal(store.byId(voucher.id).exhausted, true);
  assert.equal(store.active.length, 0);
  // Still listed: spent is a fact about the voucher, not a reason to forget it.
  assert.equal(store.list.length, 1);
});

await test('a service that answers ERROR marks the voucher spent; an unreachable one does not', async () => {
  const store = freshStore();

  const spentVoucher = await store.track(withdrawInfo(withdrawRequest({ maxSats: 25 })));
  const spent = await store.refresh(spentVoucher.id, {
    fetchJson: ok({ status: 'ERROR', reason: 'Voucher already used' }),
  });
  assert.equal(spent.ok, false);
  assert.equal(store.byId(spentVoucher.id).exhausted, true);
  assert.equal(store.byId(spentVoucher.id).lastError, 'Voucher already used');

  const offlineStore = freshStore();
  const voucher = await offlineStore.track(withdrawInfo(withdrawRequest({ maxSats: 25 })));
  const offline = await offlineStore.refresh(voucher.id, {
    fetchJson: async () => { throw new Error('network down'); },
  });
  assert.equal(offline.ok, false);
  // "We couldn't check" is not "it is empty": the last known figure stands.
  assert.equal(offline.sats, 25);
  assert.equal(offlineStore.byId(voucher.id).exhausted, false);
  assert.equal(offlineStore.byId(voucher.id).lastError, 'unreachable');
});

await test('a re-check never leaves the row spinning', async () => {
  const store = freshStore();
  const voucher = await store.track(withdrawInfo(withdrawRequest()));
  await store.refresh(voucher.id, { fetchJson: async () => { throw new Error('nope'); } });
  assert.equal(store.isChecking(voucher.id), false);
});

await test('vouchers survive a reload, and forgetting one drops only our copy', async () => {
  const store = freshStore();
  const voucher = await store.track(withdrawInfo(withdrawRequest({ maxSats: 25 })));

  setActivePinia(createPinia());
  const reloaded = useWithdrawVouchersStore();
  await reloaded.initialize();
  assert.equal(reloaded.list.length, 1);
  assert.equal(reloaded.byId(voucher.id).maxSats, 25);

  await reloaded.forget(voucher.id);
  assert.equal(reloaded.list.length, 0);

  setActivePinia(createPinia());
  const afterForget = useWithdrawVouchersStore();
  await afterForget.initialize();
  assert.equal(afterForget.list.length, 0);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
