/**
 * withdrawVouchers store — LUD-14 voucher tracking.
 *
 * What this guards, straight from LUD-14 and LUD-03:
 *   - a withdrawRequest without balanceCheck is not trackable and is ignored
 *   - identity is every URL the voucher was reached through: a rotated
 *     balanceCheck, a rescan of the paper code and a sweep from the list all
 *     land on ONE record
 *   - an answer for a known voucher that carries no balanceCheck erases it
 *   - only min = max = 0 empties a voucher; ERROR, HTTP and transport failures
 *     keep the last known figure and record why
 *   - currentBalance takes priority over maxWithdrawable for display
 *   - the title is the description, or the domain when there is none
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

const PAPER_URL = 'https://atm.example/withdraw?voucher=abc';

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

/** What Wallet.vue hands to track(): the parsed answer plus the URL fetched. */
const scanned = (request, sourceUrl = PAPER_URL) => withdrawInfo(request, { sourceUrl });
const ok = (data) => async () => ({ ok: true, data });

console.log('withdrawVouchers store');

await test('a withdrawRequest with no balanceCheck is not a voucher', async () => {
  const store = freshStore();
  assert.equal(await store.track(scanned(withdrawRequest({ balanceCheck: null }))), null);
  assert.equal(store.list.length, 0);
});

await test('a balanceCheck on another host is refused at the parse boundary', async () => {
  const store = freshStore();
  const info = scanned(withdrawRequest({ balanceCheck: 'https://evil.example/balance/abc' }));
  assert.equal(info.balanceCheck, null);
  assert.equal(await store.track(info), null);
  assert.equal(store.list.length, 0);
});

await test('a tracked voucher keeps what is left in it, and is readable by any URL it was reached through', async () => {
  const store = freshStore();
  const voucher = await store.track(scanned(withdrawRequest({ maxSats: 25 })));
  assert.equal(voucher.domain, 'atm.example');
  assert.equal(voucher.title, 'ATM voucher');
  assert.equal(voucher.maxSats, 25);
  assert.equal(store.displaySats(voucher), 25);
  assert.equal(voucher.exhausted, false);
  assert.equal(store.active.length, 1);
  assert.equal(store.byUrl('https://atm.example/balance/abc').id, voucher.id);
  // The paper code's own URL resolves to it too.
  assert.equal(store.byUrl(PAPER_URL).id, voucher.id);
});

await test('a rotated balanceCheck on re-check updates the same voucher instead of adding one', async () => {
  const store = freshStore();
  const first = await store.track(scanned(withdrawRequest({ maxSats: 25 })));
  const rotated = await store.refresh(first.id, {
    fetchJson: ok(withdrawRequest({ balanceCheck: 'https://atm.example/balance/def', maxSats: 10 })),
  });

  assert.equal(store.list.length, 1);
  assert.equal(rotated.ok, true);
  assert.equal(rotated.sats, 10);
  assert.equal(store.byId(first.id).balanceCheck, 'https://atm.example/balance/def');
  for (const url of [PAPER_URL, 'https://atm.example/balance/abc', 'https://atm.example/balance/def']) {
    assert.equal(store.byUrl(url).id, first.id, url);
  }
});

await test('sweeping a rotating voucher from the list keeps one voucher', async () => {
  const store = freshStore();
  const voucher = await store.track(scanned(withdrawRequest({ maxSats: 25 })));
  // The list row dispatches the balanceCheck URL like a scan; a rotating
  // service answers it with yet another balanceCheck.
  const swept = await store.track(scanned(
    withdrawRequest({ balanceCheck: 'https://atm.example/balance/xyz', maxSats: 10 }),
    'https://atm.example/balance/abc',
  ));
  assert.equal(store.list.length, 1);
  assert.equal(swept.id, voucher.id);
  assert.equal(swept.balanceCheck, 'https://atm.example/balance/xyz');
  assert.equal(swept.maxSats, 10);
});

await test('rescanning the paper code after rotation still lands on the same voucher', async () => {
  const store = freshStore();
  const voucher = await store.track(scanned(withdrawRequest({ maxSats: 25 })));
  await store.refresh(voucher.id, {
    fetchJson: ok(withdrawRequest({ balanceCheck: 'https://atm.example/balance/def', maxSats: 10 })),
  });
  const rescanned = await store.track(scanned(withdrawRequest({ balanceCheck: 'https://atm.example/balance/ghi', maxSats: 10 })));
  assert.equal(store.list.length, 1);
  assert.equal(rescanned.id, voucher.id);
});

await test('an answer without balanceCheck erases a known voucher (spec: "just erase the previous")', async () => {
  const store = freshStore();
  const voucher = await store.track(scanned(withdrawRequest({ maxSats: 25 })));
  const result = await store.refresh(voucher.id, { fetchJson: ok(withdrawRequest({ balanceCheck: null, maxSats: 7 })) });
  assert.equal(result.ok, true);
  assert.equal(result.erased, true);
  assert.equal(store.list.length, 0);

  // Same rule when the paper code is rescanned and the service dropped the field.
  const again = freshStore();
  await again.track(scanned(withdrawRequest({ maxSats: 25 })));
  assert.equal(await again.track(scanned(withdrawRequest({ balanceCheck: null, maxSats: 25 }))), null);
  assert.equal(again.list.length, 0);
});

await test('a voucher that comes back at min = max = 0 retires itself', async () => {
  const store = freshStore();
  const voucher = await store.track(scanned(withdrawRequest({ maxSats: 25 })));
  const result = await store.refresh(voucher.id, { fetchJson: ok(withdrawRequest({ maxSats: 0, minWithdrawable: 0 })) });

  assert.equal(result.ok, true);
  assert.equal(result.sats, 0);
  assert.equal(store.byId(voucher.id).exhausted, true);
  assert.equal(store.active.length, 0);
  // Still on record for a while: a rescan revives the same voucher.
  assert.equal(store.list.length, 1);
  const revived = await store.track(scanned(withdrawRequest({ maxSats: 5 })));
  assert.equal(revived.id, voucher.id);
  assert.equal(revived.exhausted, false);
  assert.equal(store.active.length, 1);
});

await test('a service ERROR is a failed check, not an empty voucher', async () => {
  const store = freshStore();
  const voucher = await store.track(scanned(withdrawRequest({ maxSats: 25 })));
  const result = await store.refresh(voucher.id, {
    fetchJson: async () => ({ ok: false, status: 503, data: { status: 'ERROR', reason: 'Service temporarily\nunavailable' } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'service');
  assert.equal(result.sats, 25);
  const kept = store.byId(voucher.id);
  assert.equal(kept.exhausted, false);
  assert.equal(kept.maxSats, 25);
  assert.deepEqual(kept.lastError, { kind: 'service', reason: 'Service temporarily unavailable' });
  assert.equal(store.active.length, 1);
});

await test('an unreachable service and an unexpected answer keep the last known figure', async () => {
  const offline = freshStore();
  const voucher = await offline.track(scanned(withdrawRequest({ maxSats: 25 })));
  const down = await offline.refresh(voucher.id, { fetchJson: async () => { throw new Error('network down'); } });
  assert.equal(down.ok, false);
  assert.equal(down.sats, 25);
  assert.deepEqual(offline.byId(voucher.id).lastError, { kind: 'unreachable' });

  const http = await offline.refresh(voucher.id, { fetchJson: async () => ({ ok: false, status: 500, data: null }) });
  assert.equal(http.reason, 'unreachable');

  const odd = await offline.refresh(voucher.id, { fetchJson: ok({ tag: 'payRequest', callback: 'https://atm.example/pay' }) });
  assert.equal(odd.reason, 'unexpected');
  assert.equal(offline.byId(voucher.id).exhausted, false);

  // A good answer clears the error.
  await offline.refresh(voucher.id, { fetchJson: ok(withdrawRequest({ maxSats: 20 })) });
  assert.equal(offline.byId(voucher.id).lastError, null);
});

await test('currentBalance takes priority over maxWithdrawable for display', async () => {
  const store = freshStore();
  const voucher = await store.track(scanned(withdrawRequest({ maxSats: 25, currentBalance: 30000 })));
  assert.equal(voucher.currentBalanceSats, 30);
  assert.equal(store.displaySats(voucher), 30);
  assert.equal(voucher.maxSats, 25);
  assert.equal(store.activeTotalSats, 30);
});

await test('a missing description falls back to the domain as the title', async () => {
  const store = freshStore();
  const voucher = await store.track(scanned(withdrawRequest({ defaultDescription: '' })));
  assert.equal(voucher.title, 'atm.example');
  const spaced = freshStore();
  const info = scanned(withdrawRequest({ defaultDescription: '   ' }));
  assert.equal(info.description, null);
  assert.equal((await spaced.track(info)).title, 'atm.example');
});

await test('refreshStale skips vouchers checked within the window and never leaves a row spinning', async () => {
  const store = freshStore();
  const fresh = await store.track(scanned(withdrawRequest()));
  const stale = await store.track(scanned(withdrawRequest({ balanceCheck: 'https://atm.example/balance/old' }), 'https://atm.example/withdraw?voucher=old'));
  stale.lastCheckedAt = Date.now() - 5 * 60 * 1000;
  const calls = [];
  const checked = await store.refreshStale({
    fetchJson: async (url) => { calls.push(url); throw new Error('nope'); },
  });
  assert.equal(checked, 1);
  assert.deepEqual(calls, ['https://atm.example/balance/old']);
  assert.equal(store.isChecking(fresh.id), false);
  assert.equal(store.isChecking(stale.id), false);
});

await test('vouchers survive a reload, and forgetting one drops only our copy', async () => {
  const store = freshStore();
  const voucher = await store.track(scanned(withdrawRequest({ maxSats: 25 })));

  setActivePinia(createPinia());
  const reloaded = useWithdrawVouchersStore();
  await reloaded.initialize();
  assert.equal(reloaded.list.length, 1);
  assert.equal(reloaded.byId(voucher.id).maxSats, 25);
  assert.equal(reloaded.byUrl(PAPER_URL).id, voucher.id);

  await reloaded.forget(voucher.id);
  assert.equal(reloaded.list.length, 0);

  setActivePinia(createPinia());
  const afterForget = useWithdrawVouchersStore();
  await afterForget.initialize();
  assert.equal(afterForget.list.length, 0);
});

await test('only empty vouchers are pruned; old funded vouchers survive', async () => {
  const store = freshStore();
  const live = await store.track(scanned(withdrawRequest()));
  const spent = await store.track(scanned(withdrawRequest({ balanceCheck: 'https://atm.example/balance/spent', maxSats: 0, minWithdrawable: 0 }), 'https://atm.example/withdraw?voucher=spent'));
  spent.exhaustedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
  const old = await store.track(scanned(withdrawRequest({ balanceCheck: 'https://atm.example/balance/old' }), 'https://atm.example/withdraw?voucher=old'));
  old.updatedAt = Date.now() - 181 * 24 * 60 * 60 * 1000;
  await store.persist();

  setActivePinia(createPinia());
  const reloaded = useWithdrawVouchersStore();
  await reloaded.initialize();
  assert.deepEqual(new Set(reloaded.list.map((v) => v.id)), new Set([live.id, old.id]));
});

await test('funded vouchers are never evicted by list capacity', async () => {
  const store = freshStore();
  for (let i = 0; i < 35; i++) {
    await store.track(scanned(withdrawRequest({ balanceCheck: `https://atm.example/balance/${i}` }), `https://atm.example/paper/${i}`));
  }
  assert.equal(store.list.length, 35);
  setActivePinia(createPinia());
  const restored = useWithdrawVouchersStore();
  await restored.initialize();
  assert.equal(restored.active.length, 35);
});

await test('original scan identity survives repeated rotations and restart', async () => {
  const store = freshStore();
  const voucher = await store.track(scanned(withdrawRequest()));
  for (let i = 0; i < 20; i++) {
    await store.refresh(voucher.id, { fetchJson: ok(withdrawRequest({ balanceCheck: `https://atm.example/balance/${i}` })) });
  }
  assert.ok(voucher.knownUrls.length <= 8);
  setActivePinia(createPinia());
  const restored = useWithdrawVouchersStore();
  await restored.initialize();
  const rescanned = await restored.track(scanned(withdrawRequest({ balanceCheck: 'https://atm.example/balance/latest' })));
  assert.equal(rescanned.id, voucher.id);
  assert.equal(restored.list.length, 1);
});

await test('positive currentBalance remains visible and refreshable when withdrawal is unavailable', async () => {
  const store = freshStore();
  const voucher = await store.track(scanned(withdrawRequest({ maxSats: 0, minWithdrawable: 0, currentBalance: 5000000 })));
  assert.equal(voucher.exhausted, false);
  assert.equal(store.activeTotalSats, 5000);
  voucher.lastCheckedAt = 0;
  assert.equal(await store.refreshStale({ fetchJson: ok(withdrawRequest({ maxSats: 5000 })) }), 1);
  assert.equal(voucher.maxSats, 5000);
});

await test('sub-satoshi funds and legacy false-exhausted records are preserved', async () => {
  const store = freshStore();
  const voucher = await store.track(scanned(withdrawRequest({ maxSats: 0, minWithdrawable: 0, currentBalance: 500 })));
  assert.equal(voucher.exhausted, false);
  voucher.exhausted = true;
  voucher.exhaustedAt = Date.now() - 10 * 86400000;
  await store.persist();
  setActivePinia(createPinia());
  const restored = useWithdrawVouchersStore();
  await restored.initialize();
  assert.equal(restored.active.length, 1);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
