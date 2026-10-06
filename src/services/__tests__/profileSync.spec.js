import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { useIdentityStore } from '../../stores/identity.js';
import { useProfileStore } from '../../stores/profile.js';
import { settlePendingClaim, reconcileProfileUsername } from '../usernameClaim.js';
import { startProfileSync } from '../profileSync.js';
import { useOwnedUsername } from '../usernameClaim.js';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { parse } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import * as nip05 from '../nip05.js';
import * as claims from '../usernameClaim.js';

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const RELAYS = ['wss://test.invalid'];
const HOUR = 3_600_000;
const T = 1_800_000_000;
const remote = (content, created_at = T, id = 'b'.repeat(64)) => ({ kind: 0, content: JSON.stringify(content), created_at, id });
function poolWith(publish = async () => 'OK') {
  const events = [];
  return { events, ensureRelay: async () => ({ publish: (event) => {
    events.push(event);
    return event.kind === 0 ? publish(event) : Promise.resolve('OK');
  } }) };
}
async function env({ restart = false } = {}) {
  if (!restart) globalThis.localStorage = new MemoryStorage();
  setActivePinia(createPinia());
  const identity = useIdentityStore();
  if (restart) await identity.hydrate();
  else await identity.ensureIdentity();
  const profile = useProfileStore();
  await profile.hydrate();
  return { identity, profile };
}
function begin(identity, profile, handle = 'maria') {
  identity.setPendingNip05Claim({ handle, paymentHash: `hash-${handle}`, usernameRevision: profile.usernameRevision });
}
const ownedApi = (identity) => ({ checkPaid: async () => true, lookupOwner: async () => identity.nostrPubkeyHex });
async function purchase(identity, profile, handle = 'maria') {
  begin(identity, profile, handle);
  return settlePendingClaim({ identity, profile, api: ownedApi(identity) });
}
async function publish(profile, pool = poolWith()) {
  const result = await profile.publish({ pool, relays: RELAYS, createdAt: T });
  if (result) await result.settled;
  return result;
}
async function switchTo(identity, profile, pubkey) {
  // Switch at the same public-store boundary used by the identity actions.
  // No pointer publication or real relay calls are needed in these tests.
  identity.nostrPubkeyHex = pubkey;
  await profile.hydrate();
}

await test('restart before publication retains the exact selected username and pending edits', async () => {
  let { identity, profile } = await env();
  await purchase(identity, profile);
  ({ identity, profile } = await env({ restart: true }));
  assert.equal(profile.username, 'maria');
  assert.equal(profile.isDirty, true);
  await profile.recoverFromNostr({ identityStore: identity, fetcher: async () => remote({ name: 'Remote' }) });
  assert.equal(profile.username, 'maria');
  assert.equal(profile.name, 'Remote', 'unmodified fields can recover alongside pending edits');
  const pool = poolWith();
  await publish(profile, pool);
  assert.equal(JSON.parse(pool.events.find(e => e.kind === 0).content).nip05, 'maria@mybuho.de');
  assert.equal(profile.isDirty, false);
});

await test('accepted publication, restart, then older relay profile cannot erase username', async () => {
  let { identity, profile } = await env();
  await purchase(identity, profile);
  await publish(profile);
  ({ identity, profile } = await env({ restart: true }));
  const result = await profile.recoverFromNostr({ identityStore: identity, fetcher: async () => remote({}, T - 3600) });
  assert.equal(result.reason, 'stale-event');
  await reconcileProfileUsername({ identity, profile, api: ownedApi(identity) });
  assert.equal(profile.username, 'maria');
  assert.equal(profile.isDirty, false);
});

await test('recovery in flight cannot erase a purchase completed during its fetch', async () => {
  const { identity, profile } = await env();
  const started = deferred(), reply = deferred();
  const recovering = profile.recoverFromNostr({ identityStore: identity, fetcher: () => {
    started.resolve(); return reply.promise;
  } });
  await started.promise;
  await purchase(identity, profile);
  reply.resolve(remote({}));
  assert.equal((await recovering).reason, 'local-changed');
  assert.equal(profile.username, 'maria');
  assert.equal(profile.isDirty, true);
});

await test('an old publication acknowledgment clears only the fields it actually published', async () => {
  const { identity, profile } = await env();
  profile.setDisplayName('Alice');
  const started = deferred(), ack = deferred();
  const pool = poolWith(() => { started.resolve(); return ack.promise; });
  const publishing = publish(profile, pool);
  await started.promise;
  await purchase(identity, profile);
  ack.resolve('OK'); await publishing;
  assert.equal(profile.pendingFields.name, undefined);
  assert.ok(profile.pendingFields.nip05);
  assert.equal(profile.isDirty, true);
  await publish(profile, poolWith());
  assert.equal(profile.isDirty, false);
});

await test('editing the same field during publication remains pending', async () => {
  const { profile } = await env();
  profile.setField('about', 'one');
  const started = deferred(), ack = deferred();
  const publishing = publish(profile, poolWith(() => { started.resolve(); return ack.promise; }));
  await started.promise;
  profile.setField('about', 'two');
  ack.resolve('OK'); await publishing;
  assert.equal(profile.about, 'two');
  assert.ok(profile.pendingFields.about);
});

await test('failed publication retries the identical signed event after restart', async () => {
  let { profile } = await env();
  profile.setUsername('maria');
  const first = poolWith(async () => { throw new Error('offline'); });
  await publish(profile, first);
  const event = first.events.find(e => e.kind === 0);
  ({ profile } = await env({ restart: true }));
  const second = poolWith();
  await publish(profile, second);
  assert.equal(JSON.stringify(second.events.find(e => e.kind === 0)), JSON.stringify(event));
  assert.equal(profile.pendingEvent, null);
  assert.equal(profile.isDirty, false);
});

await test('successive edits in the same second produce strictly newer events', async () => {
  const { profile } = await env();
  const pool = poolWith();
  profile.setUsername('one'); await publish(profile, pool);
  profile.setUsername('two'); await publish(profile, pool);
  const events = pool.events.filter(e => e.kind === 0);
  assert.ok(events[1].created_at > events[0].created_at);
});

await test('Nostr event ID resolves equal-timestamp ordering; later removal is respected', async () => {
  const { identity, profile } = await env();
  const recover = (event) => profile.recoverFromNostr({ identityStore: identity, fetcher: async () => event });
  await recover(remote({ nip05: 'first@mybuho.de' }, T, 'b'.repeat(64)));
  assert.equal((await recover(remote({}, T, 'c'.repeat(64)))).reason, 'stale-event');
  assert.equal(profile.username, 'first');
  await recover(remote({ nip05: 'second@mybuho.de' }, T, 'a'.repeat(64)));
  assert.equal(profile.username, 'second');
  identity.recordOwnedHandle({ handle: 'second' });
  await recover(remote({}, T + 1));
  await reconcileProfileUsername({ identity, profile, api: ownedApi(identity) });
  assert.equal(profile.username, '', 'a deliberate newer removal is not undone by purchase history');
});

await test('account switch during fetch never writes the other identity or its storage', async () => {
  const { identity, profile } = await env();
  const original = identity.nostrPubkeyHex;
  const started = deferred(), reply = deferred();
  const recovering = profile.recoverFromNostr({ identityStore: identity, fetcher: () => {
    started.resolve(); return reply.promise;
  } });
  await started.promise;
  await switchTo(identity, profile, 'd'.repeat(64));
  profile.setUsername('other');
  reply.resolve(remote({ nip05: 'wrong@mybuho.de' })); await recovering;
  assert.equal(profile.username, 'other');
  await switchTo(identity, profile, original);
  assert.equal(profile.username, '');
});

await test('account switch during acknowledgment preserves work in both identities', async () => {
  const { identity, profile } = await env();
  const original = identity.nostrPubkeyHex;
  profile.setUsername('maria');
  const started = deferred(), ack = deferred();
  const publishing = publish(profile, poolWith(() => { started.resolve(); return ack.promise; }));
  await started.promise;
  await switchTo(identity, profile, 'd'.repeat(64));
  profile.setUsername('other');
  ack.resolve('OK'); await publishing;
  assert.equal(profile.username, 'other');
  assert.equal(profile.isDirty, true);
  await switchTo(identity, profile, original);
  assert.equal(profile.username, 'maria');
  assert.equal(profile.isDirty, true, 'ignored acknowledgment is harmless; identical event retries');
  await publish(profile);
  assert.equal(profile.isDirty, false);
});

await test('switch away and back invalidates an earlier fetch even with identical revision', async () => {
  const { identity, profile } = await env();
  const original = identity.nostrPubkeyHex;
  const started = deferred(), reply = deferred();
  const recovering = profile.recoverFromNostr({ identityStore: identity, fetcher: () => {
    started.resolve(); return reply.promise;
  } });
  await started.promise;
  await switchTo(identity, profile, 'd'.repeat(64));
  await switchTo(identity, profile, original);
  reply.resolve(remote({ name: 'stale session' }));
  assert.equal((await recovering).reason, 'identity-changed');
  assert.equal(profile.name, '');
});

await test('account or revision change during signing prevents an obsolete event being sent', async () => {
  const { identity, profile } = await env();
  profile.setUsername('maria');
  const key = await identity.getNostrSecretKeyBytes();
  const started = deferred(), reply = deferred();
  identity.getNostrSecretKeyBytes = () => { started.resolve(); return reply.promise; };
  const pool = poolWith();
  const publishing = publish(profile, pool);
  await started.promise;
  profile.setUsername('newer');
  reply.resolve(key); await publishing;
  assert.equal(pool.events.length, 0);
  assert.equal(profile.isDirty, true);
  assert.ok(key.every(b => b === 0));
});

await test('pending claims survive long offline periods; only confirmed unpaid invoices expire', async () => {
  let { identity, profile } = await env();
  begin(identity, profile);
  identity.updatePendingNip05Claim({ createdAt: Date.now() - 30 * 24 * HOUR, paidAt: Date.now() - 29 * 24 * HOUR });
  ({ identity, profile } = await env({ restart: true }));
  let result = await settlePendingClaim({ identity, profile, api: { checkPaid: () => assert.fail('already paid'), lookupOwner: async () => '' } });
  assert.equal(result.status, 'waiting');
  assert.ok(identity.pendingNip05Claim);
  identity.updatePendingNip05Claim({ paidAt: null });
  result = await settlePendingClaim({ identity, profile, api: { checkPaid: async () => null } });
  assert.equal(result.status, 'waiting');
  result = await settlePendingClaim({ identity, profile, api: { checkPaid: async () => false } });
  assert.equal(result.status, 'expired');
  assert.equal(identity.pendingNip05Claim, null);
});

await test('old locally-unconfirmed invoice that actually paid is recovered, not age-discarded', async () => {
  let { identity, profile } = await env();
  begin(identity, profile);
  identity.updatePendingNip05Claim({ createdAt: Date.now() - 30 * 24 * HOUR });
  ({ identity, profile } = await env({ restart: true }));
  assert.equal((await settlePendingClaim({ identity, profile, api: ownedApi(identity) })).status, 'done');
  assert.equal(profile.username, 'maria');
});

await test('account switch during payment check cannot update or clear another claim', async () => {
  const { identity, profile } = await env();
  const original = identity.nostrPubkeyHex;
  begin(identity, profile);
  const started = deferred(), paid = deferred();
  const settling = settlePendingClaim({ identity, profile, api: {
    checkPaid: () => { started.resolve(); return paid.promise; }, lookupOwner: () => assert.fail('stale account'),
  } });
  await started.promise;
  await switchTo(identity, profile, 'd'.repeat(64));
  begin(identity, profile, 'other');
  paid.resolve(true); await settling;
  assert.equal(identity.pendingNip05Claim.handle, 'other');
  assert.equal(identity.pendingNip05Claim.paidAt, null);
  assert.equal(identity.pendingNip05Claims[original].paidAt, null);
});

await test('account switch during ownership lookup cannot assign or fail a different claim', async () => {
  const { identity, profile } = await env();
  const original = identity.nostrPubkeyHex;
  begin(identity, profile);
  const started = deferred(), owner = deferred();
  const settling = settlePendingClaim({ identity, profile, api: {
    checkPaid: async () => true, lookupOwner: () => { started.resolve(); return owner.promise; },
  } });
  await started.promise;
  await switchTo(identity, profile, 'd'.repeat(64));
  begin(identity, profile, 'other');
  owner.resolve(original); await settling;
  assert.equal(profile.username, '');
  assert.equal(identity.pendingNip05Claim.handle, 'other');
  assert.equal(identity.pendingNip05Claim.failedAt, null);
});

await test('a late ownership reconciliation cannot hide a newer selection', async () => {
  const { identity, profile } = await env();
  profile.setUsername('first');
  const owner = deferred();
  const reconciling = reconcileProfileUsername({ identity, profile, api: { lookupOwner: () => owner.promise } });
  profile.setUsername('second');
  owner.resolve('d'.repeat(64)); await reconciling;
  assert.equal(profile.username, 'second');
});

await test('interrupted profile handoff retries without replaying over a later choice', async () => {
  let { identity, profile } = await env();
  begin(identity, profile);
  const clear = identity.clearPendingNip05Claim;
  identity.clearPendingNip05Claim = () => { throw new Error('interrupted after profile save'); };
  await assert.rejects(settlePendingClaim({ identity, profile, api: ownedApi(identity) }));
  identity.clearPendingNip05Claim = clear;
  profile.setUsername('chosen-later');
  ({ identity, profile } = await env({ restart: true }));
  await settlePendingClaim({ identity, profile, api: { checkPaid: () => assert.fail('receipt already saved') } });
  assert.equal(profile.username, 'chosen-later');
  assert.equal(identity.pendingNip05Claim, null);
  assert.equal(profile.isDirty, true);
});

await test('failed profile persistence retains the paid claim for an idempotent retry', async () => {
  let { identity, profile } = await env();
  begin(identity, profile);
  const save = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => {
    if (key.startsWith('buhoGO_profile_v1')) throw new Error('storage full');
    save(key, value);
  };
  await assert.rejects(settlePendingClaim({ identity, profile, api: ownedApi(identity) }));
  assert.ok(identity.pendingNip05Claim.paidAt);
  localStorage.setItem = save;
  ({ identity, profile } = await env({ restart: true }));
  await settlePendingClaim({ identity, profile, api: ownedApi(identity) });
  assert.equal(profile.username, 'maria');
  assert.equal(profile.isDirty, true);
});

await test('a deliberate profile choice during activation wins over the pending purchase', async () => {
  const { identity, profile } = await env();
  profile.setUsername('original');
  begin(identity, profile);
  profile.setField('nip05', '');
  await settlePendingClaim({ identity, profile, api: ownedApi(identity) });
  assert.equal(profile.nip05, '');
  assert.ok(identity.nip05Handles.some(h => h.handle === 'maria'));
});

await test('legacy owned-name evidence never silently overrides newer remote choices', async () => {
  const { identity, profile } = await env();
  identity.recordOwnedHandle({ handle: 'old-name' });
  await profile.recoverFromNostr({ identityStore: identity, fetcher: async () => remote({ nip05: 'new-name@other.test' }) });
  await reconcileProfileUsername({ identity, profile, api: ownedApi(identity) });
  assert.equal(profile.nip05, 'new-name@other.test');
});

await test('explicit legacy recovery verifies ownership and creates durable work without payment', async () => {
  let { identity, profile } = await env();
  identity.recordOwnedHandle({ handle: 'maria' });
  assert.equal(profile.username, '');
  assert.equal(await useOwnedUsername({ identity, profile, handle: 'maria', api: { lookupOwner: async () => null } }), false);
  assert.equal(profile.username, '');
  assert.equal(await useOwnedUsername({ identity, profile, handle: 'maria', api: ownedApi(identity) }), true);
  ({ identity, profile } = await env({ restart: true }));
  assert.equal(profile.username, 'maria');
  assert.equal(profile.isDirty, true);
  assert.equal(identity.pendingNip05Claim, null, 'recovery creates no invoice');
});

await test('explicit recovery cannot overwrite edits made during its ownership check', async () => {
  const { identity, profile } = await env();
  const reply = deferred();
  const choosing = useOwnedUsername({ identity, profile, handle: 'maria', api: { lookupOwner: () => reply.promise } });
  profile.setUsername('newer');
  reply.resolve(identity.nostrPubkeyHex);
  assert.equal(await choosing, null);
  assert.equal(profile.username, 'newer');
});

await test('selection then removal during activation remains intentional even after acknowledgment', async () => {
  const { identity, profile } = await env();
  begin(identity, profile);
  profile.setUsername('different');
  profile.setField('nip05', '');
  await publish(profile);
  await settlePendingClaim({ identity, profile, api: ownedApi(identity) });
  assert.equal(profile.nip05, '');
  assert.equal(profile.isDirty, false);
  assert.ok(identity.nip05Handles.some(h => h.handle === 'maria'));
});

await test('a stale unpaid response cannot expire a payment confirmed by the wallet meanwhile', async () => {
  const { identity, profile } = await env();
  begin(identity, profile);
  identity.updatePendingNip05Claim({ createdAt: Date.now() - 48 * HOUR });
  const reply = deferred();
  const settling = settlePendingClaim({ identity, profile, api: {
    checkPaid: () => reply.promise, lookupOwner: async () => identity.nostrPubkeyHex,
  } });
  identity.updatePendingNip05Claim({ paidAt: Date.now() });
  reply.resolve(false);
  assert.equal((await settling).status, 'done');
  assert.equal(profile.username, 'maria');
});

await test('concurrent claim checks share a result without sharing across identities', async () => {
  const { identity, profile } = await env();
  begin(identity, profile);
  let calls = 0;
  const reply = deferred();
  const api = { checkPaid: () => { calls++; return reply.promise; }, lookupOwner: async () => identity.nostrPubkeyHex };
  const a = settlePendingClaim({ identity, profile, api });
  const b = settlePendingClaim({ identity, profile, api });
  assert.equal(a, b);
  reply.resolve(true);
  await a;
  assert.equal(calls, 1);
});

await test('historical relay metadata arriving after checkout cannot cancel the new selection', async () => {
  const { identity, profile } = await env();
  begin(identity, profile);
  const earlier = Math.floor(identity.pendingNip05Claim.createdAt / 1000) - 100;
  await profile.recoverFromNostr({ identityStore: identity, fetcher: async () => remote({ nip05: 'old-name@mybuho.de' }, earlier) });
  await settlePendingClaim({ identity, profile, api: ownedApi(identity) });
  assert.equal(profile.username, 'maria');
});

await test('publishing another field after historical recovery cannot cancel the purchased name', async () => {
  let { identity, profile } = await env();
  begin(identity, profile);
  const earlier = Math.floor(identity.pendingNip05Claim.createdAt / 1000) - 100;
  await profile.recoverFromNostr({ identityStore: identity, fetcher: async () => remote({ nip05: 'old-name@mybuho.de' }, earlier) });
  profile.setField('lud16', 'pay@example.test');
  await publish(profile);
  ({ identity, profile } = await env({ restart: true }));
  await settlePendingClaim({ identity, profile, api: ownedApi(identity) });
  assert.equal(profile.username, 'maria');
  assert.equal(profile.isDirty, true);
});

await test('a newer remote username choice during activation is retained', async () => {
  const { identity, profile } = await env();
  begin(identity, profile);
  const later = Math.floor(identity.pendingNip05Claim.createdAt / 1000) + 100;
  await profile.recoverFromNostr({ identityStore: identity, fetcher: async () => remote({ nip05: 'chosen-elsewhere@mybuho.de' }, later) });
  await settlePendingClaim({ identity, profile, api: ownedApi(identity) });
  assert.equal(profile.username, 'chosen-elsewhere');
  assert.equal(profile.isDirty, false);
});

await test('a repeated invoice registration never resets payment progress', async () => {
  const { identity, profile } = await env();
  begin(identity, profile);
  identity.updatePendingNip05Claim({ paidAt: 123, createdAt: 100 });
  begin(identity, profile);
  assert.equal(identity.pendingNip05Claim.paidAt, 123);
  assert.equal(identity.pendingNip05Claim.createdAt, 100);
  assert.throws(() => begin(identity, profile, 'another'), /still pending/);
});

function scheduler() {
  let next = 0;
  const jobs = new Map();
  return {
    jobs,
    setTimer: (fn, ms) => { jobs.set(++next, { fn, ms }); return next; },
    clearTimer: (id) => jobs.delete(id),
    async tick() {
      const [id, job] = jobs.entries().next().value ?? [];
      assert.ok(job, 'expected scheduled work');
      jobs.delete(id); await job.fn(); return job.ms;
    },
  };
}
function lifecycle() {
  const window = new EventTarget();
  window.navigator = { onLine: true };
  const document = new EventTarget();
  document.visibilityState = 'visible';
  return { window, document };
}
function coordinator(identity, profile, overrides = {}) {
  const clock = scheduler(), life = lifecycle(), pool = poolWith();
  const sync = startProfileSync({ identity, profile, ...life, ...clock,
    recoveryOptions: { fetcher: async () => remote({ name: 'Existing' }, T - 100) },
    publishOptions: { pool, relays: RELAYS, createdAt: T },
    claimApi: ownedApi(identity), ...overrides,
  });
  return { ...clock, ...life, pool, sync };
}

await test('activation completes without any UI, after repeated waits, and publishes once', async () => {
  const { identity, profile } = await env();
  begin(identity, profile);
  let owner = '';
  let finished = 0;
  const c = coordinator(identity, profile, { claimApi: { checkPaid: async () => true, lookupOwner: async () => owner }, onClaim: () => finished++ });
  try {
    await c.tick();
    assert.ok(identity.pendingNip05Claim.paidAt);
    for (let i = 0; i < 10; i++) await c.tick();
    owner = identity.nostrPubkeyHex;
    await c.tick();
    assert.equal(profile.username, 'maria');
    assert.equal(profile.isDirty, false);
    assert.equal(identity.pendingNip05Claim, null);
    assert.equal(finished, 1);
    while (c.jobs.size) await c.tick();
    assert.equal(c.pool.events.filter(e => e.kind === 0).length, 1);
  } finally { c.sync.stop(); }
});

await test('reconnect and foreground resume persisted publication, with no hidden/offline polling', async () => {
  const { identity, profile } = await env();
  profile.setUsername('maria');
  const c = coordinator(identity, profile);
  try {
    c.window.navigator.onLine = false;
    c.window.dispatchEvent(new Event('offline'));
    assert.equal(c.jobs.size, 0);
    c.window.navigator.onLine = true;
    c.window.dispatchEvent(new Event('online'));
    c.document.visibilityState = 'hidden';
    c.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(c.jobs.size, 0);
    c.document.visibilityState = 'visible';
    c.document.dispatchEvent(new Event('visibilitychange'));
    await c.tick();
    assert.equal(profile.username, 'maria');
    assert.equal(profile.isDirty, false);
  } finally { c.sync.stop(); }
  assert.equal(c.jobs.size, 0);
  c.window.dispatchEvent(new Event('online'));
  assert.equal(c.jobs.size, 0, 'stop removes listeners and timers');
});

await test('failed publication retries with backoff and the same event, then stops', async () => {
  const { identity, profile } = await env();
  profile.setUsername('maria');
  let accepting = false;
  const pool = poolWith(async () => { if (!accepting) throw new Error('offline'); return 'OK'; });
  const c = coordinator(identity, profile, { publishOptions: { pool, relays: RELAYS, createdAt: T } });
  try {
    await c.tick();
    await c.tick(); // trailing recovery mutation
    assert.equal(await c.tick(), 2000);
    assert.equal(await c.tick(), 4000);
    accepting = true;
    await c.tick();
    assert.equal(profile.isDirty, false);
    assert.equal(new Set(pool.events.filter(e => e.kind === 0).map(e => e.id)).size, 1);
    assert.equal(c.jobs.size, 0);
  } finally { c.sync.stop(); }
});

await test('coordinator switches identities and resumes the original pending work on return', async () => {
  const { identity, profile } = await env();
  const original = identity.nostrPubkeyHex;
  begin(identity, profile);
  const c = coordinator(identity, profile);
  try {
    await switchTo(identity, profile, 'd'.repeat(64));
    await c.tick();
    assert.equal(profile.username, '');
    assert.ok(identity.pendingNip05Claims[original]);
    await switchTo(identity, profile, original);
    await c.tick();
    assert.equal(profile.username, 'maria');
    assert.equal(profile.isDirty, false);
  } finally { c.sync.stop(); }
});

// Execute the actual sheet's script with Vue mounting/watchers, matching the
// existing component-test pattern. Only rendering and network boundaries are stubbed.
function mountSheet(identity, profile, props = {}) {
  const clock = scheduler();
  const source = parse(readFileSync(new URL('../../components/Nip05MarketplaceSheet.vue', import.meta.url), 'utf8')).descriptor.script.content;
  const dependencies = {
    '@iconify/vue': { Icon: {} }, '@chenfengyuan/vue-qrcode': {},
    '../stores/identity': { useIdentityStore: () => identity },
    '../stores/profile': { useProfileStore: () => profile },
    '../stores/wallet': { useWalletStore: () => ({ wallets: [], providers: {} }) },
    '../stores/transactionMetadata': { useTransactionMetadataStore: () => ({}) },
    '../services/nip05': { ...nip05, searchHandle: async () => ({ available: false }), lookupOwner: async () => identity.nostrPubkeyHex },
    '../services/usernameClaim': { ...claims, useOwnedUsername: (input) => useOwnedUsername({ ...input, api: ownedApi(identity) }) },
    '../utils/addressUtils': { invoiceAmountMsat: () => 0 },
    '../utils/fiatRates': { fiatRatesService: {} },
    '../utils/timeFormatting': { formatCalendarDate: () => '' },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', transformSync(source, { format: 'cjs' }).code)(
    name => { assert.ok(name in dependencies, name); return dependencies[name]; },
    module, module.exports, clock.setTimer, clock.clearTimer,
  );
  const renderer = Vue.createRenderer({
    createElement: () => ({ children: [] }), createText: text => ({ text }), createComment: () => ({}),
    insert(node, parent) { node.parent = parent; parent.children.push(node); },
    remove(node) { node.parent.children = node.parent.children.filter(child => child !== node); },
    setElementText(node, text) { node.text = text; }, setText(node, text) { node.text = text; },
    parentNode: node => node.parent, nextSibling: () => null, patchProp() {},
  });
  const Component = { ...module.exports.default, render() { return Vue.h('div', this.step); } };
  let purchased = 0;
  const app = renderer.createApp(Component, { modelValue: true, onPurchased: () => purchased++, ...props });
  app.config.globalProperties.$t = key => key;
  const vm = app.mount({ children: [] });
  return { app, vm, clock, purchased: () => purchased };
}

await test('closing and unmounting the purchase sheet does not cancel activation or publication', async () => {
  const { identity, profile } = await env();
  begin(identity, profile);
  identity.updatePendingNip05Claim({ paidAt: Date.now() });
  let owner = '';
  const c = coordinator(identity, profile, { claimApi: { checkPaid: async () => true, lookupOwner: async () => owner } });
  const sheet = mountSheet(identity, profile);
  try {
    assert.equal(sheet.vm.step, 'activating');
    await c.tick();
    sheet.app.unmount();
    assert.equal(sheet.clock.jobs.size, 0, 'only presentation timers are disposed');
    assert.equal(claims.claimIsInView(), false);
    owner = identity.nostrPubkeyHex;
    await c.tick();
    assert.equal(profile.username, 'maria');
    assert.equal(profile.isDirty, false);
  } finally { c.sync.stop(); }
});

await test('sheet activation timeout remains observable and later completes from background work', async () => {
  const { identity, profile } = await env();
  begin(identity, profile);
  identity.updatePendingNip05Claim({ paidAt: Date.now() });
  const sheet = mountSheet(identity, profile);
  const c = coordinator(identity, profile);
  try {
    assert.equal(await sheet.clock.tick(), 90_000);
    assert.equal(sheet.vm.step, 'later');
    await c.tick(); await Vue.nextTick();
    assert.equal(sheet.vm.step, 'success');
    assert.equal(sheet.purchased(), 1);
    assert.equal(profile.isDirty, false);
  } finally { sheet.app.unmount(); c.sync.stop(); }
});

await test('owned-name recovery sheet verifies and selects the existing name without an invoice', async () => {
  const { identity, profile } = await env();
  identity.recordOwnedHandle({ handle: 'maria' });
  const sheet = mountSheet(identity, profile, { initialName: 'maria' });
  try {
    await Vue.nextTick(); await Vue.nextTick();
    assert.equal(sheet.vm.nameInput, 'maria');
    await sheet.vm.useOwnedName();
    assert.equal(profile.username, 'maria');
    assert.equal(profile.isDirty, true);
    assert.equal(sheet.vm.step, 'success');
    assert.equal(identity.pendingNip05Claim, null);
  } finally { sheet.app.unmount(); }
});
