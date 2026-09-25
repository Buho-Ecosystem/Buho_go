/**
 * Username claim flows against the real identity and profile stores.
 *
 * Run directly with Node:
 *   node src/services/__tests__/usernameClaim.spec.js
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
const { useIdentityStore } = await import('../../stores/identity.js');
const { useProfileStore } = await import('../../stores/profile.js');
const { settlePendingClaim, reconcileProfileUsername, adoptOwnedUsername, CLAIM_STATUS } = await import('../usernameClaim.js');

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
    failed += 1;
  }
}

async function env() {
  globalThis.localStorage = new MemoryStorage();
  setActivePinia(createPinia());
  const identity = useIdentityStore();
  await identity.ensureIdentity();
  const profile = useProfileStore();
  await profile.hydrate();
  return { identity, profile, me: identity.nostrPubkeyHex };
}

/** Fake name-server answers: queue of checkPaid results and a fixed owner. */
function api({ paid = [true], owner = null } = {}) {
  const paidQueue = [...paid];
  return {
    checkPaid: async () => (paidQueue.length ? paidQueue.shift() : null),
    lookupOwner: async () => (typeof owner === 'function' ? owner() : owner),
  };
}

const HOUR = 60 * 60 * 1000;

console.log('username claims');

await test('no claim: nothing to do', async () => {
  const { identity, profile } = await env();
  const r = await settlePendingClaim({ identity, profile, api: api() });
  assert.equal(r.status, CLAIM_STATUS.NONE);
});

await test('paid and ours: the name lands on the profile and the record', async () => {
  const { identity, profile, me } = await env();
  identity.setPendingNip05Claim({ handle: 'maria', paymentHash: 'h', rotationSecret: 'rot', addressId: 'aid', years: 2 });
  const now = 1_800_000_000_000;
  const r = await settlePendingClaim({ identity, profile, now, api: api({ paid: [true], owner: me }) });
  assert.equal(r.status, CLAIM_STATUS.DONE);
  assert.equal(profile.username, 'maria');
  assert.equal(profile.nip05, 'maria@mybuho.de');
  assert.equal(profile.isDirty, true, 'the background sync publishes it');
  assert.equal(identity.nip05ActiveEntry.handle, 'maria');
  assert.equal(identity.nip05ActiveEntry.rotationSecret, 'rot');
  assert.equal(identity.nip05ActiveEntry.expiresAt, now + 730 * 24 * HOUR, 'two years from the payment');
  assert.equal(identity.usernameExpiresAt('maria'), now + 730 * 24 * HOUR);
  assert.equal(identity.pendingNip05Claim, null);
});

await test('not paid yet: keeps waiting, nothing written', async () => {
  const { identity, profile } = await env();
  identity.setPendingNip05Claim({ handle: 'maria', paymentHash: 'h' });
  const r = await settlePendingClaim({ identity, profile, api: api({ paid: [false] }) });
  assert.equal(r.status, CLAIM_STATUS.WAITING);
  assert.equal(r.paid, false);
  assert.equal(profile.username, '');
  assert.ok(identity.pendingNip05Claim);
});

await test('never paid after a day: the claim is forgotten', async () => {
  const { identity, profile } = await env();
  identity.setPendingNip05Claim({ handle: 'maria', paymentHash: 'h' });
  const later = Date.now() + 25 * HOUR;
  const r = await settlePendingClaim({ identity, profile, now: later, api: api({ paid: [false] }) });
  assert.equal(r.status, CLAIM_STATUS.EXPIRED);
  assert.equal(identity.pendingNip05Claim, null);
});

await test('server unreachable: waits, never gives up on a claim it cannot check', async () => {
  const { identity, profile } = await env();
  identity.setPendingNip05Claim({ handle: 'maria', paymentHash: 'h' });
  const later = Date.now() + 25 * HOUR;
  const r = await settlePendingClaim({ identity, profile, now: later, api: api({ paid: [null] }) });
  assert.equal(r.status, CLAIM_STATUS.WAITING);
  assert.ok(identity.pendingNip05Claim);
});

await test('paid, not active yet: waits and remembers it was paid', async () => {
  const { identity, profile } = await env();
  identity.setPendingNip05Claim({ handle: 'maria', paymentHash: 'h' });
  const r = await settlePendingClaim({ identity, profile, api: api({ paid: [true], owner: '' }) });
  assert.equal(r.status, CLAIM_STATUS.WAITING);
  assert.equal(r.paid, true);
  assert.ok(identity.pendingNip05Claim.paidAt);
  assert.equal(profile.username, '');
});

await test('paid, someone else was faster: failed, and never shown as ours', async () => {
  const { identity, profile } = await env();
  identity.setPendingNip05Claim({ handle: 'maria', paymentHash: 'h' });
  const r = await settlePendingClaim({ identity, profile, api: api({ paid: [true], owner: 'cd'.repeat(32) }) });
  assert.equal(r.status, CLAIM_STATUS.FAILED);
  assert.equal(profile.username, '');
  assert.ok(identity.pendingNip05Claim.failedAt);
  const again = await settlePendingClaim({ identity, profile, api: api() });
  assert.equal(again.status, CLAIM_STATUS.FAILED, 'stays failed until the person sees it');
});

await test('adoptOwnedUsername: profile and record together', async () => {
  const { identity, profile } = await env();
  adoptOwnedUsername({ identity, profile, handle: 'maria' });
  assert.equal(profile.username, 'maria');
  assert.equal(identity.nip05ActiveEntry.handle, 'maria');
});

await test('reconcile: a name this phone recorded needs no network', async () => {
  const { identity, profile } = await env();
  adoptOwnedUsername({ identity, profile, handle: 'maria' });
  const r = await reconcileProfileUsername({ identity, profile, api: { lookupOwner: async () => { throw new Error('no call expected'); } } });
  assert.equal(r, 'known');
});

await test('reconcile: a restored name that is ours gets recorded', async () => {
  const { identity, profile, me } = await env();
  profile.nip05 = 'maria@mybuho.de';
  const r = await reconcileProfileUsername({ identity, profile, api: { lookupOwner: async () => me } });
  assert.equal(r, 'mine');
  assert.equal(profile.username, 'maria');
  assert.equal(identity.nip05ActiveEntry.handle, 'maria');
});

await test('reconcile: someone else\'s name is hidden, the profile left alone', async () => {
  const { identity, profile } = await env();
  profile.nip05 = 'maria@mybuho.de';
  const r = await reconcileProfileUsername({ identity, profile, api: { lookupOwner: async () => 'cd'.repeat(32) } });
  assert.equal(r, 'not-mine');
  assert.equal(profile.username, '');
  assert.equal(profile.nip05, 'maria@mybuho.de');
});

await test('reconcile: unanswerable leaves everything as it is', async () => {
  const { identity, profile } = await env();
  profile.nip05 = 'maria@mybuho.de';
  const r = await reconcileProfileUsername({ identity, profile, api: { lookupOwner: async () => null } });
  assert.equal(r, 'unknown');
  assert.equal(profile.username, 'maria');
});

await test('reconcile: the name of a claim still activating is left for the claim', async () => {
  const { identity, profile } = await env();
  profile.nip05 = 'maria@mybuho.de';
  identity.setPendingNip05Claim({ handle: 'maria', paymentHash: 'h' });
  const r = await reconcileProfileUsername({ identity, profile, api: { lookupOwner: async () => '' } });
  assert.equal(r, 'pending');
  assert.equal(profile.nip05NotMine, '');
});

await test('reconcile: other domains and free handles are not ours to check', async () => {
  const { identity, profile } = await env();
  profile.nip05 = 'maria@primal.net';
  assert.equal(await reconcileProfileUsername({ identity, profile, api: { lookupOwner: async () => { throw new Error('no call'); } } }), 'none');
  profile.nip05 = 'luckyowl.482913@mybuho.de';
  assert.equal(await reconcileProfileUsername({ identity, profile, api: { lookupOwner: async () => { throw new Error('no call'); } } }), 'none');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
