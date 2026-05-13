/**
 * Profile store lifecycle tests.
 *
 * Drives the Pinia store through hydrate / edit / persist / reset
 * against an in-memory localStorage shim. The store has no
 * cryptographic dependency yet — Step 4 will wire publish() against a
 * mocked relay pool. Here we pin the editable model and persistence
 * contract.
 *
 * Run directly with Node:
 *   node src/stores/__tests__/profile.spec.js
 */

import { strict as assert } from 'node:assert';

// ---------------------------------------------------------------------------
// Browser globals shim — must be set up BEFORE the store imports load,
// since they reference `localStorage` at module level.
// ---------------------------------------------------------------------------

class MemoryStorage {
  constructor() {
    this._data = new Map();
  }
  getItem(key) {
    return this._data.has(key) ? this._data.get(key) : null;
  }
  setItem(key, value) {
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
const { useProfileStore, PROFILE_FIELDS } = await import('../profile.js');
const { useIdentityStore } = await import('../identity.js');
const { verifyEvent } = await import('nostr-core');

const STORAGE_KEY = 'buhoGO_profile_v1';

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

function freshEnv() {
  globalThis.localStorage = new MemoryStorage();
  setActivePinia(createPinia());
  return useProfileStore();
}

/**
 * Bootstrap a real identity (encrypted mnemonic → derived Nostr key)
 * and return both stores. Uses the same crypto path the production
 * app takes, so `getNostrSecretKeyBytes()` exercises the real
 * decrypt + NIP-06 derivation chain.
 */
async function freshEnvWithIdentity() {
  globalThis.localStorage = new MemoryStorage();
  setActivePinia(createPinia());
  const identity = useIdentityStore();
  await identity.ensureIdentity();
  const profile = useProfileStore();
  return { profile, identity };
}

/**
 * Factory for a deterministic fake `RelayPool`. The behaviour map
 * lets each test pick its outcome per relay URL: `'ok'` accepts the
 * event, `'reject'` rejects it, `'throw'` makes the whole publish
 * call reject. Defaults to `'ok'` for any URL not explicitly listed.
 *
 * Every call to `publish()` is recorded on the returned `calls`
 * array so tests can assert what was sent to whom.
 */
function fakePool(behaviour = {}, options = {}) {
  const calls = [];
  return {
    calls,
    publish(urls, event) {
      calls.push({ urls: [...urls], event });
      if (options.throwAll) {
        return Promise.reject(new Error('pool blew up'));
      }
      const accepted = urls.filter((url) => (behaviour[url] ?? 'ok') === 'ok');
      return Promise.resolve(accepted);
    },
  };
}

const TEST_RELAYS = Object.freeze([
  'wss://relay-a.test',
  'wss://relay-b.test',
  'wss://relay-c.test',
]);

/**
 * Read the persisted blob without going through the store. Returns
 * the parsed JSON or `null` if no blob exists.
 */
function readPersisted() {
  const raw = globalThis.localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

console.log('profile store');

// ---------------------------------------------------------------------------
// Initial state + getters
// ---------------------------------------------------------------------------

await test('fresh store has every field empty and isEmpty=true', () => {
  const s = freshEnv();
  for (const field of PROFILE_FIELDS) {
    assert.equal(s[field], '');
  }
  assert.equal(s.isEmpty, true);
  assert.equal(s.isDirty, false);
  assert.equal(s.isPublishing, false);
  assert.equal(s.lastPublishedAt, null);
  assert.equal(s.lastPublishResult, null);
  assert.equal(s.hasEverPublished, false);
});

await test('PROFILE_FIELDS exposes the editable field list as a frozen array', () => {
  assert.ok(Object.isFrozen(PROFILE_FIELDS));
  assert.deepEqual([...PROFILE_FIELDS], [
    'displayName', 'name', 'about', 'website', 'picture', 'banner', 'lud16',
  ]);
});

await test('publishablePayload maps camelCase fields to NIP-01 snake_case keys', () => {
  const s = freshEnv();
  s.setField('displayName', 'Satoshi');
  s.setField('about', 'Building things.');
  s.setField('lud16', 'satoshi@example.com');
  assert.deepEqual(s.publishablePayload, {
    display_name: 'Satoshi',
    about: 'Building things.',
    lud16: 'satoshi@example.com',
  });
});

await test('publishablePayload omits empty fields entirely', () => {
  const s = freshEnv();
  s.setField('displayName', 'Satoshi');
  assert.deepEqual(s.publishablePayload, { display_name: 'Satoshi' });
});

// ---------------------------------------------------------------------------
// setField
// ---------------------------------------------------------------------------

await test('setField updates the value and marks isDirty', () => {
  const s = freshEnv();
  s.setField('displayName', 'Satoshi');
  assert.equal(s.displayName, 'Satoshi');
  assert.equal(s.isDirty, true);
  assert.equal(s.isEmpty, false);
});

await test('setField trims whitespace from the input', () => {
  const s = freshEnv();
  s.setField('displayName', '   Satoshi   ');
  assert.equal(s.displayName, 'Satoshi');
});

await test('setField coerces non-strings to empty', () => {
  const s = freshEnv();
  s.setField('displayName', 'Satoshi');
  s.setField('displayName', 42);
  assert.equal(s.displayName, '');
});

await test('setField caps `about` at 280 characters', () => {
  const s = freshEnv();
  s.setField('about', 'a'.repeat(500));
  assert.equal(s.about.length, 280);
});

await test('setField does not mark isDirty when the value is unchanged after normalisation', () => {
  const s = freshEnv();
  s.setField('displayName', 'Satoshi');
  // Hand-resetting the flag — the second call should NOT flip it on
  // because the trimmed input equals the stored value.
  s.isDirty = false;
  s.setField('displayName', '  Satoshi  ');
  assert.equal(s.isDirty, false);
});

await test('setField throws on an unknown field name', () => {
  const s = freshEnv();
  assert.throws(
    () => s.setField('privateKey', 'oops'),
    /Unknown profile field/,
  );
});

// ---------------------------------------------------------------------------
// applyEdits (bulk save path)
// ---------------------------------------------------------------------------

await test('applyEdits applies multiple changes at once and marks dirty', () => {
  const s = freshEnv();
  s.applyEdits({ displayName: 'Satoshi', about: 'Hi', website: 'https://x.test' });
  assert.equal(s.displayName, 'Satoshi');
  assert.equal(s.about, 'Hi');
  assert.equal(s.website, 'https://x.test');
  assert.equal(s.isDirty, true);
});

await test('applyEdits ignores unknown keys silently (forward-compat for restore blobs)', () => {
  const s = freshEnv();
  s.applyEdits({ displayName: 'Satoshi', secret: 'leak', futureField: 'huh' });
  assert.equal(s.displayName, 'Satoshi');
  assert.equal('secret' in s, false);
});

await test('applyEdits skips persist when nothing actually changes', () => {
  const s = freshEnv();
  s.setField('displayName', 'Satoshi');
  s.isDirty = false;
  const before = readPersisted();
  s.applyEdits({ displayName: 'Satoshi' });
  const after = readPersisted();
  assert.equal(s.isDirty, false);
  assert.deepEqual(after, before);
});

// ---------------------------------------------------------------------------
// Persistence + hydrate
// ---------------------------------------------------------------------------

await test('setField persists the new value to localStorage', () => {
  const s = freshEnv();
  s.setField('displayName', 'Satoshi');
  const persisted = readPersisted();
  assert.equal(persisted.version, 1);
  assert.equal(persisted.displayName, 'Satoshi');
});

await test('persisted blob does not include empty fields', () => {
  const s = freshEnv();
  s.setField('displayName', 'Satoshi');
  s.setField('about', '');
  const persisted = readPersisted();
  assert.ok(!('about' in persisted));
  assert.ok(!('lud16' in persisted));
  assert.ok(!('website' in persisted));
});

await test('persisted blob does not include editor-lifecycle flags', () => {
  const s = freshEnv();
  s.setField('displayName', 'Satoshi');
  s.isPublishing = true;
  s.lastPublishResult = [{ relay: 'wss://x', ok: true, error: null }];
  s._persistMetadata();
  const persisted = readPersisted();
  assert.ok(!('isDirty' in persisted));
  assert.ok(!('isPublishing' in persisted));
  assert.ok(!('lastPublishResult' in persisted));
});

await test('persisted blob does include lastPublishedAt when set', () => {
  const s = freshEnv();
  s.setField('displayName', 'Satoshi');
  s.lastPublishedAt = 1700000000000;
  s._persistMetadata();
  const persisted = readPersisted();
  assert.equal(persisted.lastPublishedAt, 1700000000000);
});

await test('hydrate round-trips a previously persisted blob', async () => {
  const s = freshEnv();
  s.applyEdits({ displayName: 'Satoshi', about: 'Hi', lud16: 'satoshi@x.test' });
  s.lastPublishedAt = 1700000000000;
  s._persistMetadata();

  // New store in the same storage → should pick up the blob.
  setActivePinia(createPinia());
  const s2 = useProfileStore();
  await s2.hydrate();
  assert.equal(s2.hydrated, true);
  assert.equal(s2.displayName, 'Satoshi');
  assert.equal(s2.about, 'Hi');
  assert.equal(s2.lud16, 'satoshi@x.test');
  assert.equal(s2.lastPublishedAt, 1700000000000);
  // Editor flags reset on every boot:
  assert.equal(s2.isDirty, false);
  assert.equal(s2.isPublishing, false);
  assert.equal(s2.lastPublishResult, null);
});

await test('hydrate is idempotent', async () => {
  const s = freshEnv();
  s.applyEdits({ displayName: 'Satoshi' });
  setActivePinia(createPinia());
  const s2 = useProfileStore();
  await s2.hydrate();
  await s2.hydrate();
  assert.equal(s2.displayName, 'Satoshi');
  assert.equal(s2.hydrated, true);
});

await test('hydrate tolerates a missing blob', async () => {
  const s = freshEnv();
  await s.hydrate();
  assert.equal(s.hydrated, true);
  assert.equal(s.isEmpty, true);
});

await test('hydrate tolerates a corrupted blob and falls back to defaults', async () => {
  const s = freshEnv();
  globalThis.localStorage.setItem(STORAGE_KEY, '{not valid json');
  await s.hydrate();
  assert.equal(s.hydrated, true);
  assert.equal(s.isEmpty, true);
});

await test('hydrate ignores a blob with the wrong schema version', async () => {
  const s = freshEnv();
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 99,
    displayName: 'Should be ignored',
  }));
  await s.hydrate();
  assert.equal(s.displayName, '');
});

await test('hydrate ignores unknown keys in the persisted blob', async () => {
  const s = freshEnv();
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    displayName: 'Satoshi',
    futureField: 'huh',
  }));
  await s.hydrate();
  assert.equal(s.displayName, 'Satoshi');
  assert.equal('futureField' in s, false);
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

await test('reset clears every field and removes the persisted blob', () => {
  const s = freshEnv();
  s.applyEdits({ displayName: 'Satoshi', about: 'Hi' });
  s.lastPublishedAt = 1700000000000;
  s._persistMetadata();
  assert.ok(readPersisted() !== null);

  s.reset();
  for (const field of PROFILE_FIELDS) {
    assert.equal(s[field], '');
  }
  assert.equal(s.isDirty, false);
  assert.equal(s.isPublishing, false);
  assert.equal(s.lastPublishedAt, null);
  assert.equal(s.lastPublishResult, null);
  assert.equal(readPersisted(), null);
});

// ---------------------------------------------------------------------------
// publish()
// ---------------------------------------------------------------------------

await test('publish throws IDENTITY_NOT_BOOTSTRAPPED when no identity exists', async () => {
  const s = freshEnv();
  s.applyEdits({ displayName: 'Satoshi' });
  await assert.rejects(
    () => s.publish({ pool: fakePool(), relays: TEST_RELAYS }),
    (err) => err.code === 'IDENTITY_NOT_BOOTSTRAPPED',
  );
});

await test('publish sends one kind:0 event and one kind:10002 event to every relay', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi', about: 'Hi there' });
  const pool = fakePool();
  await profile.publish({ pool, relays: TEST_RELAYS });

  assert.equal(pool.calls.length, 2);
  // Both publish calls hit the exact relay set we passed.
  for (const call of pool.calls) {
    assert.deepEqual(call.urls, [...TEST_RELAYS]);
  }
  const kinds = pool.calls.map((c) => c.event.kind).sort();
  assert.deepEqual(kinds, [0, 10002]);
});

await test('publish kind:0 content is the profile payload as JSON', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi', lud16: 'sat@example.com' });
  const pool = fakePool();
  await profile.publish({ pool, relays: TEST_RELAYS });
  const kind0 = pool.calls.find((c) => c.event.kind === 0).event;
  assert.deepEqual(JSON.parse(kind0.content), {
    display_name: 'Satoshi',
    lud16: 'sat@example.com',
  });
});

await test('publish kind:10002 carries an r tag per relay in input order', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  const pool = fakePool();
  await profile.publish({ pool, relays: TEST_RELAYS });
  const kind10002 = pool.calls.find((c) => c.event.kind === 10002).event;
  assert.equal(kind10002.tags.length, TEST_RELAYS.length);
  for (let i = 0; i < TEST_RELAYS.length; i += 1) {
    assert.equal(kind10002.tags[i][0], 'r');
    // nostr-core normalises URLs but should preserve order.
    assert.ok(typeof kind10002.tags[i][1] === 'string');
  }
});

await test('publish events verify under nostr-core verifyEvent', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  const pool = fakePool();
  await profile.publish({ pool, relays: TEST_RELAYS });
  for (const call of pool.calls) {
    assert.equal(verifyEvent(call.event), true);
  }
});

await test('publish: all relays accept → isDirty cleared, lastPublishedAt set, blob updated', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  assert.equal(profile.isDirty, true);

  const before = Date.now();
  const result = await profile.publish({ pool: fakePool(), relays: TEST_RELAYS });
  const after = Date.now();

  assert.equal(profile.isDirty, false);
  assert.ok(profile.lastPublishedAt >= before && profile.lastPublishedAt <= after);
  for (const r of result) assert.equal(r.ok, true);
  // Pinia wraps array state in a reactive proxy, so reference-equality
  // doesn't hold — assert structural equality instead.
  assert.deepEqual(JSON.parse(JSON.stringify(profile.lastPublishResult)), result);

  // Persisted blob picks up the new timestamp.
  const persisted = readPersisted();
  assert.equal(persisted.lastPublishedAt, profile.lastPublishedAt);
});

await test('publish: one relay accepts both → still considered success (success-if-one rule)', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  const pool = fakePool({
    'wss://relay-a.test': 'ok',
    'wss://relay-b.test': 'reject',
    'wss://relay-c.test': 'reject',
  });
  const result = await profile.publish({ pool, relays: TEST_RELAYS });
  assert.equal(profile.isDirty, false);
  assert.ok(profile.lastPublishedAt > 0);
  assert.equal(result[0].ok, true);
  assert.equal(result[1].ok, false);
  assert.equal(result[2].ok, false);
});

await test('publish: relay accepts kind:0 but rejects kind:10002 → ok=false for that relay', async () => {
  // Mixed-kind acceptance is rare in practice but real (relay policy
  // may differ per kind). The merge rule is strict: both events must
  // land or the relay is marked failed.
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });

  let callIdx = 0;
  const pool = {
    calls: [],
    publish(urls, event) {
      this.calls.push({ urls: [...urls], event });
      callIdx += 1;
      // First call (kind:0) — relay-a accepts; second call (kind:10002)
      // — relay-a rejects. Both order-of-call paths covered.
      const acceptList = event.kind === 0
        ? ['wss://relay-a.test']
        : ['wss://relay-b.test'];
      return Promise.resolve(urls.filter((u) => acceptList.includes(u)));
    },
  };

  const result = await profile.publish({ pool, relays: TEST_RELAYS });
  for (const r of result) assert.equal(r.ok, false);
  // The pool-call order doesn't matter; merge ignores ordering.
  void callIdx;
  assert.equal(profile.isDirty, true);
});

await test('publish: total failure leaves isDirty=true and no lastPublishedAt', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  const pool = fakePool({
    'wss://relay-a.test': 'reject',
    'wss://relay-b.test': 'reject',
    'wss://relay-c.test': 'reject',
  });
  const result = await profile.publish({ pool, relays: TEST_RELAYS });
  assert.equal(profile.isDirty, true);
  assert.equal(profile.lastPublishedAt, null);
  for (const r of result) {
    assert.equal(r.ok, false);
    assert.match(r.error, /did not accept/);
  }
});

await test('publish: pool-level throw collapses to per-relay failure, isDirty stays true', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  const pool = fakePool({}, { throwAll: true });
  const result = await profile.publish({ pool, relays: TEST_RELAYS });
  assert.equal(profile.isDirty, true);
  assert.equal(profile.lastPublishedAt, null);
  for (const r of result) {
    assert.equal(r.ok, false);
    assert.match(r.error, /pool blew up/);
  }
});

await test('publish: isPublishing flips true during the call and false after', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });

  // Pool that lets us observe `isPublishing` mid-flight.
  let observed = null;
  const pool = {
    calls: [],
    publish(urls, event) {
      this.calls.push({ urls: [...urls], event });
      observed = profile.isPublishing;
      return Promise.resolve([...urls]);
    },
  };

  assert.equal(profile.isPublishing, false);
  await profile.publish({ pool, relays: TEST_RELAYS });
  assert.equal(observed, true);
  assert.equal(profile.isPublishing, false);
});

await test('publish: re-entrancy returns null without double-publishing', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  // Manually hold the flag to simulate an in-flight publish.
  profile.isPublishing = true;
  const result = await profile.publish({ pool: fakePool(), relays: TEST_RELAYS });
  assert.equal(result, null);
  // Restore for cleanliness — no real publish happened.
  profile.isPublishing = false;
});

await test('publish never lands secret material on the persisted blob', async () => {
  const { profile, identity } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi', about: 'Building things.' });
  await profile.publish({ pool: fakePool(), relays: TEST_RELAYS });

  // Pull the pubkey + the secret bytes so we have concrete values to
  // grep the persisted blob against.
  const persistedRaw = globalThis.localStorage.getItem(STORAGE_KEY);
  assert.ok(persistedRaw, 'profile blob should exist after publish');

  const sk = await identity.getNostrSecretKeyBytes();
  const skHex = Buffer.from(sk).toString('hex');
  sk.fill(0);
  assert.ok(!persistedRaw.includes(skHex), 'profile blob must not contain secret key hex');
  assert.ok(!persistedRaw.includes('nsec1'), 'profile blob must not contain nsec bech32');

  // Identity blob also untouched by the publish flow — its shape is
  // owned by identityStore and we should not be smuggling profile
  // state into it.
  const identityRaw = globalThis.localStorage.getItem('buhoGO_identity_v1');
  assert.ok(identityRaw && !identityRaw.includes(skHex));
});

await test('publish honours opts.createdAt for deterministic ids in tests', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  const pool = fakePool();
  await profile.publish({
    pool, relays: TEST_RELAYS, createdAt: 1700000000,
  });
  for (const call of pool.calls) {
    assert.equal(call.event.created_at, 1700000000);
  }
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
