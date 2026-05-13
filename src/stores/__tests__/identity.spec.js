/**
 * Identity store lifecycle tests.
 *
 * Drives the Pinia store through create / persist / hydrate / restore /
 * rotate / reset paths against an in-memory localStorage shim. Uses
 * real AES-GCM via Node's Web Crypto so the encryption envelope is
 * exercised end-to-end — only the storage backing is faked.
 *
 * Run with the Node runtime directly:
 *   node src/stores/__tests__/identity.spec.js
 *
 * No jest/vitest dependency; matches the harness style used by
 * identityCrypto.spec.js and lud4.spec.js.
 */

import { strict as assert } from 'node:assert';

// ---------------------------------------------------------------------------
// Browser globals shim — must be set up BEFORE the store imports load,
// since they reference `localStorage` at module level.
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory localStorage. Supports the subset the identity store
 * uses (`getItem`, `setItem`, `removeItem`) and a `__throwOnWrite` test
 * hook for the persist-rollback case.
 */
class MemoryStorage {
  constructor() {
    this._data = new Map();
    this.__throwOnWrite = null; // set to a string to make setItem(key) throw
  }
  getItem(key) {
    return this._data.has(key) ? this._data.get(key) : null;
  }
  setItem(key, value) {
    if (this.__throwOnWrite === key) {
      throw new Error('quota exceeded (test)');
    }
    this._data.set(key, String(value));
  }
  removeItem(key) {
    this._data.delete(key);
  }
  clear() {
    this._data.clear();
  }
}

globalThis.localStorage = new MemoryStorage();

const { createPinia, setActivePinia } = await import('pinia');
const { useIdentityStore } = await import('../identity.js');

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

/**
 * Reset every test to a known-good baseline: empty localStorage,
 * fresh Pinia instance.
 */
function freshEnv() {
  globalThis.localStorage = new MemoryStorage();
  setActivePinia(createPinia());
  return useIdentityStore();
}

console.log('identity store');

// ---------------------------------------------------------------------------
// ensureIdentity — fresh state, idempotent
// ---------------------------------------------------------------------------

await test('ensureIdentity creates a new identity from scratch', async () => {
  const s = freshEnv();
  assert.equal(s.bootstrapped, false);
  await s.ensureIdentity();
  assert.equal(s.bootstrapped, true);
  assert.equal(s.backupConfirmed, false);
  assert.match(s.fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(s.nostrAccountIndex, 0);
  assert.match(s.nostrPubkeyHex, /^[0-9a-f]{64}$/);
  assert.match(s.nostrNpub, /^npub1[02-9ac-hj-np-z]+$/);
});

await test('ensureIdentity is a no-op when already bootstrapped', async () => {
  const s = freshEnv();
  await s.ensureIdentity();
  const npubBefore = s.nostrNpub;
  const fpBefore = s.fingerprint;
  await s.ensureIdentity();
  // The second call must not generate a new mnemonic.
  assert.equal(s.nostrNpub, npubBefore);
  assert.equal(s.fingerprint, fpBefore);
});

// ---------------------------------------------------------------------------
// getMnemonic — round-trips through real AES-GCM
// ---------------------------------------------------------------------------

await test('getMnemonic round-trips through the encryption envelope', async () => {
  const s = freshEnv();
  await s.ensureIdentity();
  const m1 = await s.getMnemonic();
  const m2 = await s.getMnemonic();
  assert.equal(m1, m2);
  assert.equal(m1.split(' ').length, 12);
});

await test('getMnemonic throws IDENTITY_NOT_BOOTSTRAPPED when no seed', async () => {
  const s = freshEnv();
  try {
    await s.getMnemonic();
    assert.fail('expected getMnemonic to throw');
  } catch (err) {
    assert.equal(err.code, 'IDENTITY_NOT_BOOTSTRAPPED');
  }
});

// ---------------------------------------------------------------------------
// importMnemonic — valid / invalid / state reset
// ---------------------------------------------------------------------------

const FIXED_SEED =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

await test('importMnemonic accepts a valid 12-word phrase', async () => {
  const s = freshEnv();
  await s.importMnemonic(FIXED_SEED);
  assert.equal(s.bootstrapped, true);
  assert.equal(s.backupConfirmed, true); // default
  assert.equal(s.nostrAccountIndex, 0);
  assert.match(s.nostrNpub, /^npub1/);
  assert.equal(await s.getMnemonic(), FIXED_SEED);
});

await test('importMnemonic respects markBackedUp=false', async () => {
  const s = freshEnv();
  await s.importMnemonic(FIXED_SEED, false);
  assert.equal(s.backupConfirmed, false);
});

await test('importMnemonic rejects an invalid phrase with code', async () => {
  const s = freshEnv();
  try {
    await s.importMnemonic('not a real seed phrase at all');
    assert.fail('expected importMnemonic to throw');
  } catch (err) {
    assert.equal(err.code, 'IDENTITY_INVALID_MNEMONIC');
  }
});

await test('importMnemonic resets connectedSites and rotation index', async () => {
  const s = freshEnv();
  await s.ensureIdentity();
  s.recordConnectedSite({ domain: 'example.com', action: 'login', linkingPubHex: 'aa' });
  s.nostrAccountIndex = 5; // simulate prior rotation
  s._persistMetadata();
  await s.importMnemonic(FIXED_SEED);
  assert.deepEqual(s.connectedSites, []);
  assert.equal(s.nostrAccountIndex, 0);
});

await test('importMnemonic + ensureIdentity from the same seed produce the same npub', async () => {
  const a = freshEnv();
  await a.importMnemonic(FIXED_SEED);
  const b = freshEnv();
  await b.importMnemonic(FIXED_SEED);
  assert.equal(a.nostrNpub, b.nostrNpub);
  assert.equal(a.fingerprint, b.fingerprint);
});

// ---------------------------------------------------------------------------
// hydrate — round-trip + clamping of out-of-range persisted values
// ---------------------------------------------------------------------------

await test('hydrate round-trips the metadata blob', async () => {
  const s1 = freshEnv();
  await s1.importMnemonic(FIXED_SEED);
  const fp = s1.fingerprint;
  const npub = s1.nostrNpub;

  // Re-attach a fresh Pinia against the *same* localStorage instance.
  setActivePinia(createPinia());
  const s2 = useIdentityStore();
  await s2.hydrate();
  assert.equal(s2.bootstrapped, true);
  assert.equal(s2.fingerprint, fp);
  assert.equal(s2.nostrNpub, npub);
  assert.equal(s2.nostrAccountIndex, 0);
});

await test('hydrate is idempotent', async () => {
  const s = freshEnv();
  await s.ensureIdentity();
  setActivePinia(createPinia());
  const s2 = useIdentityStore();
  await s2.hydrate();
  await s2.hydrate(); // second call is a no-op
  assert.equal(s2.hydrated, true);
});

await test('hydrate clamps a negative nostrAccountIndex to 0', async () => {
  // Hand-corrupt the persisted metadata as if a malicious devtools
  // edit had set the index out of range. Hydrate must defend itself.
  const seed = freshEnv();
  await seed.ensureIdentity();
  const raw = JSON.parse(globalThis.localStorage.getItem('buhoGO_identity_v1'));
  raw.nostrAccountIndex = -1;
  globalThis.localStorage.setItem('buhoGO_identity_v1', JSON.stringify(raw));

  setActivePinia(createPinia());
  const s = useIdentityStore();
  await s.hydrate();
  assert.equal(s.nostrAccountIndex, 0);
});

await test('hydrate clamps a >= 2^31 nostrAccountIndex to 0', async () => {
  const seed = freshEnv();
  await seed.ensureIdentity();
  const raw = JSON.parse(globalThis.localStorage.getItem('buhoGO_identity_v1'));
  raw.nostrAccountIndex = 2 ** 31; // hardened-derivation collision territory
  globalThis.localStorage.setItem('buhoGO_identity_v1', JSON.stringify(raw));

  setActivePinia(createPinia());
  const s = useIdentityStore();
  await s.hydrate();
  assert.equal(s.nostrAccountIndex, 0);
});

await test('hydrate clamps a non-integer nostrAccountIndex to 0', async () => {
  const seed = freshEnv();
  await seed.ensureIdentity();
  const raw = JSON.parse(globalThis.localStorage.getItem('buhoGO_identity_v1'));
  raw.nostrAccountIndex = 'not-a-number';
  globalThis.localStorage.setItem('buhoGO_identity_v1', JSON.stringify(raw));

  setActivePinia(createPinia());
  const s = useIdentityStore();
  await s.hydrate();
  assert.equal(s.nostrAccountIndex, 0);
});

await test('hydrate tolerates a missing metadata blob gracefully', async () => {
  // No setup at all — just an empty store.
  const s = freshEnv();
  await s.hydrate();
  assert.equal(s.bootstrapped, false);
  assert.equal(s.fingerprint, null);
  assert.equal(s.nostrNpub, null);
});

// ---------------------------------------------------------------------------
// rotateNostrIdentity — bump, cache, persist-then-commit rollback, overflow
// ---------------------------------------------------------------------------

await test('rotateNostrIdentity bumps the account index and refreshes the cache', async () => {
  const s = freshEnv();
  await s.importMnemonic(FIXED_SEED);
  const npub0 = s.nostrNpub;
  const pub0 = s.nostrPubkeyHex;

  const result = await s.rotateNostrIdentity();
  assert.equal(s.nostrAccountIndex, 1);
  assert.equal(result.account, 1);
  assert.notEqual(s.nostrNpub, npub0);
  assert.notEqual(s.nostrPubkeyHex, pub0);
  assert.equal(result.npub, s.nostrNpub);
  assert.equal(result.pubkeyHex, s.nostrPubkeyHex);
});

await test('rotateNostrIdentity rolls back in-memory state when persist throws', async () => {
  const s = freshEnv();
  await s.importMnemonic(FIXED_SEED);
  const npubBefore = s.nostrNpub;
  const acctBefore = s.nostrAccountIndex;

  // Make the next metadata persist fail. The store should restore
  // the pre-rotation state and propagate the error to the caller.
  globalThis.localStorage.__throwOnWrite = 'buhoGO_identity_v1';
  try {
    await s.rotateNostrIdentity();
    assert.fail('expected rotation to throw on persist failure');
  } catch (err) {
    assert.match(err.message, /quota exceeded/);
  }
  globalThis.localStorage.__throwOnWrite = null;

  assert.equal(s.nostrAccountIndex, acctBefore);
  assert.equal(s.nostrNpub, npubBefore);
});

await test('rotateNostrIdentity refuses to overflow past 2^31', async () => {
  const s = freshEnv();
  await s.importMnemonic(FIXED_SEED);
  // Simulate a user one rotation away from the hardened-index ceiling.
  s.nostrAccountIndex = 2 ** 31 - 1;
  s._persistMetadata();

  try {
    await s.rotateNostrIdentity();
    assert.fail('expected rotation to throw at the ceiling');
  } catch (err) {
    assert.equal(err.code, 'NOSTR_ACCOUNT_EXHAUSTED');
  }
  // State must be unchanged after the refusal.
  assert.equal(s.nostrAccountIndex, 2 ** 31 - 1);
});

await test('rotateNostrIdentity throws IDENTITY_NOT_BOOTSTRAPPED when no seed', async () => {
  const s = freshEnv();
  try {
    await s.rotateNostrIdentity();
    assert.fail('expected rotation to throw');
  } catch (err) {
    assert.equal(err.code, 'IDENTITY_NOT_BOOTSTRAPPED');
  }
});

// ---------------------------------------------------------------------------
// revealNostrSecret + loadNostrIdentity
// ---------------------------------------------------------------------------

await test('revealNostrSecret returns the nsec without persisting it', async () => {
  const s = freshEnv();
  await s.importMnemonic(FIXED_SEED);
  const { privateKeyHex, nsec } = await s.revealNostrSecret();
  assert.match(privateKeyHex, /^[0-9a-f]{64}$/);
  assert.match(nsec, /^nsec1[02-9ac-hj-np-z]+$/);
  // The persisted metadata must NOT contain the secret in any form.
  const raw = globalThis.localStorage.getItem('buhoGO_identity_v1');
  assert.equal(raw.includes(privateKeyHex), false);
  assert.equal(raw.includes(nsec), false);
});

await test('revealNostrSecret reflects the rotated account', async () => {
  const s = freshEnv();
  await s.importMnemonic(FIXED_SEED);
  const before = await s.revealNostrSecret();
  await s.rotateNostrIdentity();
  const after = await s.revealNostrSecret();
  assert.notEqual(before.nsec, after.nsec);
});

await test('loadNostrIdentity lazily backfills the cache for legacy users', async () => {
  // Simulate a user whose persisted metadata predates the Nostr feature:
  // bootstrapped=true, but nostrPubkeyHex/nostrNpub are absent.
  const seed = freshEnv();
  await seed.importMnemonic(FIXED_SEED);
  const raw = JSON.parse(globalThis.localStorage.getItem('buhoGO_identity_v1'));
  delete raw.nostrPubkeyHex;
  delete raw.nostrNpub;
  globalThis.localStorage.setItem('buhoGO_identity_v1', JSON.stringify(raw));

  setActivePinia(createPinia());
  const s = useIdentityStore();
  await s.hydrate();
  assert.equal(s.nostrPubkeyHex, null);
  assert.equal(s.nostrNpub, null);

  const result = await s.loadNostrIdentity();
  assert.ok(result?.npub?.startsWith('npub1'));
  assert.equal(result.pubkeyHex, s.nostrPubkeyHex);
  assert.equal(result.npub, s.nostrNpub);
});

await test('loadNostrIdentity returns null when no identity exists', async () => {
  const s = freshEnv();
  assert.equal(await s.loadNostrIdentity(), null);
});

// ---------------------------------------------------------------------------
// connectedSites + reset
// ---------------------------------------------------------------------------

await test('recordConnectedSite stores and bumps useCount', async () => {
  const s = freshEnv();
  await s.ensureIdentity();
  s.recordConnectedSite({ domain: 'a.example', action: 'login', linkingPubHex: 'aa' });
  s.recordConnectedSite({ domain: 'b.example', action: 'login', linkingPubHex: 'bb' });
  s.recordConnectedSite({ domain: 'a.example', action: 'login', linkingPubHex: 'aa' });
  assert.equal(s.connectedSites.length, 2);
  const a = s.connectedSites.find(x => x.domain === 'a.example');
  assert.equal(a.useCount, 2);
});

await test('reset removes both localStorage entries and zeroes state', async () => {
  const s = freshEnv();
  await s.ensureIdentity();
  await s.reset();
  assert.equal(s.bootstrapped, false);
  assert.equal(s.fingerprint, null);
  assert.equal(s.nostrPubkeyHex, null);
  assert.equal(s.nostrNpub, null);
  assert.equal(s.nostrAccountIndex, 0);
  assert.equal(globalThis.localStorage.getItem('buhoGO_identity_v1'), null);
  assert.equal(globalThis.localStorage.getItem('buhoGO_identity_seed_v1'), null);
});

await test('regenerate wipes and creates a fresh identity in one call', async () => {
  const s = freshEnv();
  await s.importMnemonic(FIXED_SEED);
  const npubBefore = s.nostrNpub;
  await s.regenerate();
  assert.equal(s.bootstrapped, true);
  assert.equal(s.backupConfirmed, false); // fresh seed, not yet backed up
  assert.notEqual(s.nostrNpub, npubBefore);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
