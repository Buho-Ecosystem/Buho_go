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
 * Factory for a deterministic fake `RelayPool` that matches the
 * shape `publishToRelaysEager` consumes: `ensureRelay(url)` returns
 * a Relay-like object with `publish(event)`. The behaviour map
 * picks the per-relay decision; `delays` adds an artificial latency
 * so tests can assert eager-success timing.
 *
 * `calls` records every per-relay publish attempt (one entry per
 * URL per event) so the spec can assert exactly what hit the wire.
 *
 *   behaviour: { [url]: 'ok' | 'reject' | 'hang' }      (default 'ok')
 *   options:   { delays?: { [url]: ms }, ensureRelayFails?: boolean }
 */
function fakePool(behaviour = {}, options = {}) {
  const calls = [];
  return {
    calls,
    ensureRelay(url) {
      if (options.ensureRelayFails === true || options.ensureRelayFails === url) {
        return Promise.reject(new Error('connection refused'));
      }
      return Promise.resolve({
        url,
        publish(event) {
          const decision = behaviour[url] ?? 'ok';
          const delay = (options.delays && options.delays[url]) || 0;
          calls.push({ url, event, kind: event.kind });
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              if (decision === 'ok') resolve('OK');
              else if (decision === 'reject') reject(new Error('Relay did not accept'));
              else if (decision === 'hang') { /* never resolves */ }
              else reject(new Error(`unknown decision: ${decision}`));
            }, delay);
          });
        },
      });
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
    'displayName', 'name', 'about', 'website', 'picture', 'banner', 'lud16', 'nip05',
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

await test('publish: fires one kind:0 attempt and one kind:10002 attempt per relay', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi', about: 'Hi there' });
  const pool = fakePool();
  const result = await profile.publish({ pool, relays: TEST_RELAYS });
  // Wait for both events' full settle so the relay-list calls land
  // before we count them.
  await result.settled;

  // Total calls = 2 events × 3 relays = 6 per-relay publish attempts.
  assert.equal(pool.calls.length, TEST_RELAYS.length * 2);
  const kinds = pool.calls.map((c) => c.kind).sort();
  assert.deepEqual(kinds, [0, 0, 0, 10002, 10002, 10002]);
  // Every URL got both kinds.
  for (const url of TEST_RELAYS) {
    const sent = pool.calls.filter((c) => c.url === url).map((c) => c.kind).sort();
    assert.deepEqual(sent, [0, 10002], `${url} should receive both event kinds`);
  }
});

await test('publish: kind:0 content is the profile payload as JSON', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi', lud16: 'sat@example.com' });
  const pool = fakePool();
  const r = await profile.publish({ pool, relays: TEST_RELAYS });
  await r.settled;
  const kind0 = pool.calls.find((c) => c.kind === 0).event;
  assert.deepEqual(JSON.parse(kind0.content), {
    display_name: 'Satoshi',
    lud16: 'sat@example.com',
  });
});

await test('publish: kind:10002 carries an r tag per relay in input order', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  const pool = fakePool();
  const r = await profile.publish({ pool, relays: TEST_RELAYS });
  await r.settled;
  const kind10002 = pool.calls.find((c) => c.kind === 10002).event;
  assert.equal(kind10002.tags.length, TEST_RELAYS.length);
  for (let i = 0; i < TEST_RELAYS.length; i += 1) {
    assert.equal(kind10002.tags[i][0], 'r');
    assert.ok(typeof kind10002.tags[i][1] === 'string');
  }
});

await test('publish: signed events verify under nostr-core verifyEvent', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  const pool = fakePool();
  const r = await profile.publish({ pool, relays: TEST_RELAYS });
  await r.settled;
  for (const call of pool.calls) {
    assert.equal(verifyEvent(call.event), true);
  }
});

await test('publish: all relays accept → ok=true, acceptedRelay set, blob updated', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  assert.equal(profile.isDirty, true);

  const before = Date.now();
  const result = await profile.publish({ pool: fakePool(), relays: TEST_RELAYS });
  const after = Date.now();

  assert.equal(result.ok, true);
  assert.ok(TEST_RELAYS.includes(result.acceptedRelay));
  assert.equal(profile.isDirty, false);
  assert.ok(profile.lastPublishedAt >= before && profile.lastPublishedAt <= after);

  const settled = await result.settled;
  assert.equal(settled.length, TEST_RELAYS.length);
  for (const r of settled) assert.equal(r.ok, true);

  // lastPublishResult lands once the settle promise resolves.
  assert.deepEqual(
    JSON.parse(JSON.stringify(profile.lastPublishResult)),
    settled,
  );
  // Persisted blob picks up the new timestamp.
  assert.equal(readPersisted().lastPublishedAt, profile.lastPublishedAt);
});

await test('publish: one relay accepts → eager success (the other relays still pending)', async () => {
  // Eager-success contract: the moment one relay accepts kind:0, the
  // publish action resolves with `ok: true`. The other relays may
  // still be in-flight (mid-WebSocket) when this fires; the spec
  // uses non-zero delays so the difference is observable.
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  const pool = fakePool({}, {
    delays: {
      'wss://relay-a.test': 0,
      'wss://relay-b.test': 80,
      'wss://relay-c.test': 80,
    },
  });

  const t0 = Date.now();
  const result = await profile.publish({ pool, relays: TEST_RELAYS, timeoutMs: 500 });
  const elapsed = Date.now() - t0;
  assert.equal(result.ok, true);
  assert.ok(elapsed < 60, `publish should resolve eagerly, took ${elapsed}ms`);

  // Full settle still has to wait for the slow ones.
  await result.settled;
  const elapsedFull = Date.now() - t0;
  assert.ok(elapsedFull >= 80, `full settle takes longer, observed ${elapsedFull}ms`);
});

await test('publish: only ONE relay accepts → still ok=true (success-if-one rule)', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  const pool = fakePool({
    'wss://relay-a.test': 'reject',
    'wss://relay-b.test': 'ok',
    'wss://relay-c.test': 'reject',
  });
  const result = await profile.publish({ pool, relays: TEST_RELAYS, timeoutMs: 500 });
  assert.equal(result.ok, true);
  assert.equal(result.acceptedRelay, 'wss://relay-b.test');
  assert.equal(profile.isDirty, false);
  assert.ok(profile.lastPublishedAt > 0);
  // Per-relay detail eventually lands.
  const settled = await result.settled;
  assert.equal(settled.find((r) => r.relay === 'wss://relay-a.test').ok, false);
  assert.equal(settled.find((r) => r.relay === 'wss://relay-b.test').ok, true);
  assert.equal(settled.find((r) => r.relay === 'wss://relay-c.test').ok, false);
});

await test('publish: every relay refuses kind:0 → ok=false, results populated, isDirty stays true', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  const pool = fakePool({
    'wss://relay-a.test': 'reject',
    'wss://relay-b.test': 'reject',
    'wss://relay-c.test': 'reject',
  });
  const result = await profile.publish({ pool, relays: TEST_RELAYS, timeoutMs: 500 });
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.results));
  assert.equal(result.results.length, TEST_RELAYS.length);
  for (const r of result.results) {
    assert.equal(r.ok, false);
    assert.match(r.error, /did not accept/);
  }
  assert.equal(profile.isDirty, true);
  assert.equal(profile.lastPublishedAt, null);
});

await test('publish: ensureRelay failure on every relay collapses to ok=false', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  const pool = fakePool({}, { ensureRelayFails: true });
  const result = await profile.publish({ pool, relays: TEST_RELAYS, timeoutMs: 500 });
  assert.equal(result.ok, false);
  for (const r of result.results) {
    assert.equal(r.ok, false);
    assert.match(r.error, /connection refused/);
  }
});

await test('publish: relay rejects kind:0 but other relay accepts → still ok=true (kind:10002 doesn\'t gate)', async () => {
  // Mixed-kind acceptance was a hard merge rule before. Eager
  // semantics: only kind:0 success matters; kind:10002 is background.
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });

  const calls = [];
  const pool = {
    calls,
    ensureRelay(url) {
      return Promise.resolve({
        url,
        publish(event) {
          calls.push({ url, event, kind: event.kind });
          // relay-a takes kind:0 only; others take kind:10002 only.
          if (url === 'wss://relay-a.test') {
            return event.kind === 0 ? Promise.resolve('OK') : Promise.reject(new Error('no'));
          }
          return event.kind === 0 ? Promise.reject(new Error('no')) : Promise.resolve('OK');
        },
      });
    },
  };
  const result = await profile.publish({ pool, relays: TEST_RELAYS });
  assert.equal(result.ok, true, 'kind:0 acceptance alone makes publish ok');
  assert.equal(result.acceptedRelay, 'wss://relay-a.test');
  assert.equal(profile.isDirty, false);
});

await test('publish: isPublishing flips true during the call and false after', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });

  let observed = null;
  const pool = {
    ensureRelay(url) {
      return Promise.resolve({
        url,
        publish() {
          if (observed === null) observed = profile.isPublishing;
          return Promise.resolve('OK');
        },
      });
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
  profile.isPublishing = true;
  const result = await profile.publish({ pool: fakePool(), relays: TEST_RELAYS });
  assert.equal(result, null);
  profile.isPublishing = false;
});

await test('publish: never lands secret material on the persisted blob', async () => {
  const { profile, identity } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi', about: 'Building things.' });
  const r = await profile.publish({ pool: fakePool(), relays: TEST_RELAYS });
  await r.settled;

  const persistedRaw = globalThis.localStorage.getItem(STORAGE_KEY);
  assert.ok(persistedRaw, 'profile blob should exist after publish');

  const sk = await identity.getNostrSecretKeyBytes();
  const skHex = Buffer.from(sk).toString('hex');
  sk.fill(0);
  assert.ok(!persistedRaw.includes(skHex), 'profile blob must not contain secret key hex');
  assert.ok(!persistedRaw.includes('nsec1'), 'profile blob must not contain nsec bech32');

  const identityRaw = globalThis.localStorage.getItem('buhoGO_identity_v1');
  assert.ok(identityRaw && !identityRaw.includes(skHex));
});

await test('publish: opts.createdAt threads through to both kind:0 and kind:10002', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.applyEdits({ displayName: 'Satoshi' });
  const pool = fakePool();
  const r = await profile.publish({
    pool, relays: TEST_RELAYS, createdAt: 1700000000,
  });
  await r.settled;
  for (const call of pool.calls) {
    assert.equal(call.event.created_at, 1700000000);
  }
});

// ---------------------------------------------------------------------------
// uploadAvatar()
// ---------------------------------------------------------------------------

function fakeFile(bytes = new Uint8Array([1, 2, 3]), type = 'image/png') {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    size: buf.byteLength,
    type,
    arrayBuffer() {
      const copy = new ArrayBuffer(buf.byteLength);
      new Uint8Array(copy).set(buf);
      return Promise.resolve(copy);
    },
  };
}

/**
 * Fake Blossom uploader. Records every call and returns either the
 * configured success payload or rejects with the configured error.
 */
function fakeUploader(behaviour = {}) {
  const calls = [];
  const fn = (file, secretKey, opts) => {
    calls.push({ file, secretKey, opts });
    if (behaviour.throwError) return Promise.reject(behaviour.throwError);
    return Promise.resolve(behaviour.result ?? {
      url: 'https://blossom.test/avatar.png',
      hash: 'a'.repeat(64),
      mime: 'image/png',
      size: 3,
      server: 'https://blossom.test',
    });
  };
  return Object.assign(fn, { calls });
}

await test('uploadAvatar reports IDENTITY_NOT_BOOTSTRAPPED when no identity exists', async () => {
  const s = freshEnv();
  const uploader = fakeUploader();
  const r = await s.uploadAvatar(fakeFile(), { uploader });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'IDENTITY_NOT_BOOTSTRAPPED');
  assert.equal(uploader.calls.length, 0, 'uploader should not be called');
});

await test('uploadAvatar happy path: sets picture, marks dirty, persists, returns ok=true result', async () => {
  const { profile } = await freshEnvWithIdentity();
  const uploader = fakeUploader();
  const r = await profile.uploadAvatar(fakeFile(), { uploader });
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://blossom.test/avatar.png');
  assert.equal(profile.picture, 'https://blossom.test/avatar.png');
  assert.equal(profile.isDirty, true);
  const persisted = readPersisted();
  assert.equal(persisted.picture, 'https://blossom.test/avatar.png');
});

await test('uploadAvatar passes server/maxBytes opts straight through to the helper', async () => {
  const { profile } = await freshEnvWithIdentity();
  const uploader = fakeUploader();
  await profile.uploadAvatar(fakeFile(), {
    uploader,
    server: 'https://custom.test',
    maxBytes: 1024,
  });
  const [{ opts }] = uploader.calls;
  assert.equal(opts.server, 'https://custom.test');
  assert.equal(opts.maxBytes, 1024);
});

await test('uploadAvatar hands the uploader a 32-byte secret key', async () => {
  const { profile } = await freshEnvWithIdentity();
  const uploader = fakeUploader();
  await profile.uploadAvatar(fakeFile(), { uploader });
  const [{ secretKey }] = uploader.calls;
  assert.ok(secretKey instanceof Uint8Array);
  assert.equal(secretKey.length, 32);
});

await test('uploadAvatar wipes the secret-key bytes after the upload', async () => {
  const { profile } = await freshEnvWithIdentity();
  let capturedSk = null;
  const uploader = (file, sk) => {
    capturedSk = sk;
    return Promise.resolve({
      url: 'x', hash: 'h', mime: 'image/png', size: 1, server: 's',
    });
  };
  await profile.uploadAvatar(fakeFile(), { uploader });
  assert.ok(capturedSk instanceof Uint8Array);
  // Every byte zeroed after the call returned.
  for (let i = 0; i < capturedSk.length; i += 1) {
    assert.equal(capturedSk[i], 0);
  }
});

await test('uploadAvatar failure: prior picture preserved, isDirty unchanged, typed result returned', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.setField('picture', 'https://old.test/avatar.png');
  profile.isDirty = false;

  const oversize = new Error('Image too large (max 5 MB)');
  oversize.code = 'AVATAR_TOO_LARGE';
  const uploader = fakeUploader({ throwError: oversize });

  const r = await profile.uploadAvatar(fakeFile(), { uploader });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AVATAR_TOO_LARGE');
  assert.match(r.message, /too large/i);
  // Existing avatar URL stays.
  assert.equal(profile.picture, 'https://old.test/avatar.png');
  assert.equal(profile.isDirty, false);
});

await test('uploadAvatar collapses an Error without a code to AVATAR_UNKNOWN_ERROR', async () => {
  const { profile } = await freshEnvWithIdentity();
  const uploader = fakeUploader({ throwError: new Error('boom') });
  const r = await profile.uploadAvatar(fakeFile(), { uploader });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'AVATAR_UNKNOWN_ERROR');
  assert.equal(r.message, 'boom');
});

await test('uploadAvatar: isUploadingAvatar flips true mid-flight and false after', async () => {
  const { profile } = await freshEnvWithIdentity();
  let observed = null;
  const uploader = () => {
    observed = profile.isUploadingAvatar;
    return Promise.resolve({
      url: 'x', hash: 'h', mime: 'image/png', size: 1, server: 's',
    });
  };
  assert.equal(profile.isUploadingAvatar, false);
  await profile.uploadAvatar(fakeFile(), { uploader });
  assert.equal(observed, true);
  assert.equal(profile.isUploadingAvatar, false);
});

await test('uploadAvatar: re-entrancy returns the prior result without re-calling the uploader', async () => {
  const { profile } = await freshEnvWithIdentity();
  const uploader = fakeUploader();
  // First call seeds lastAvatarUploadResult.
  await profile.uploadAvatar(fakeFile(), { uploader });
  // Hold the flag to simulate an in-flight upload.
  profile.isUploadingAvatar = true;
  const r = await profile.uploadAvatar(fakeFile(), { uploader });
  assert.equal(uploader.calls.length, 1);
  assert.equal(r.ok, true); // prior result is the success result
  profile.isUploadingAvatar = false;
});

await test('uploadAvatar: same URL → no redundant persist or dirty flip', async () => {
  const { profile } = await freshEnvWithIdentity();
  profile.setField('picture', 'https://blossom.test/avatar.png');
  profile.isDirty = false;
  const uploader = fakeUploader({
    result: {
      url: 'https://blossom.test/avatar.png',
      hash: 'a'.repeat(64),
      mime: 'image/png',
      size: 3,
      server: 'https://blossom.test',
    },
  });
  await profile.uploadAvatar(fakeFile(), { uploader });
  assert.equal(profile.isDirty, false);
});

// ---------------------------------------------------------------------------
// recoverFromNostr()
// ---------------------------------------------------------------------------

/**
 * Build a fake kind:0 event the store's recovery path can consume.
 * The fetcher is the injection boundary, so we don't need a real
 * signature here — `parseProfileContent` only looks at `content`,
 * and the store only reads `created_at` on top.
 */
function fakeKind0Event(content, createdAtSec = 1_700_000_000) {
  return {
    kind: 0,
    created_at: createdAtSec,
    content: JSON.stringify(content),
    tags: [],
    pubkey: 'a'.repeat(64),
    id: 'b'.repeat(64),
    sig: 'c'.repeat(128),
  };
}

await test('recoverFromNostr: missing identity returns identity-not-bootstrapped', async () => {
  const s = freshEnv();
  const fetcher = async () => fakeKind0Event({ name: 'Satoshi' });
  const r = await s.recoverFromNostr({ identityStore: null, fetcher });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'identity-not-bootstrapped');
  assert.equal(r.hadRemote, false);
  assert.equal(r.applied, 0);
});

await test('recoverFromNostr: identity present but no remote event → hadRemote=false', async () => {
  const { profile, identity } = await freshEnvWithIdentity();
  const fetcher = async () => null;
  const r = await profile.recoverFromNostr({ identityStore: identity, fetcher });
  assert.equal(r.ok, true);
  assert.equal(r.hadRemote, false);
  assert.equal(r.applied, 0);
  assert.deepEqual(r.fields, []);
  // No remote → don't stamp a published timestamp.
  assert.equal(profile.lastPublishedAt, null);
});

await test('recoverFromNostr: applies every recognized field from the remote event', async () => {
  const { profile, identity } = await freshEnvWithIdentity();
  const fetcher = async () => fakeKind0Event({
    display_name: 'Satoshi',
    name: 'satoshi',
    about: 'Building things.',
    website: 'https://x.test',
    picture: 'https://blossom.test/sn.png',
    banner: 'https://blossom.test/banner.png',
    lud16: 'satoshi@x.test',
  });
  const r = await profile.recoverFromNostr({ identityStore: identity, fetcher });
  assert.equal(r.ok, true);
  assert.equal(r.hadRemote, true);
  assert.equal(r.applied, 7);
  assert.equal(profile.displayName, 'Satoshi');
  assert.equal(profile.name, 'satoshi');
  assert.equal(profile.about, 'Building things.');
  assert.equal(profile.website, 'https://x.test');
  assert.equal(profile.picture, 'https://blossom.test/sn.png');
  assert.equal(profile.banner, 'https://blossom.test/banner.png');
  assert.equal(profile.lud16, 'satoshi@x.test');
});

await test('recoverFromNostr: passes the identity pubkey to the fetcher', async () => {
  const { profile, identity } = await freshEnvWithIdentity();
  let seenPubkey = null;
  const fetcher = async (pk) => {
    seenPubkey = pk;
    return null;
  };
  await profile.recoverFromNostr({ identityStore: identity, fetcher });
  assert.equal(seenPubkey, identity.nostrPubkeyHex);
  assert.match(seenPubkey, /^[0-9a-f]{64}$/);
});

await test('recoverFromNostr: leaves the store clean (isDirty=false) — local matches relays', async () => {
  const { profile, identity } = await freshEnvWithIdentity();
  const fetcher = async () => fakeKind0Event({ name: 'Satoshi' });
  await profile.recoverFromNostr({ identityStore: identity, fetcher });
  assert.equal(profile.isDirty, false);
});

await test('recoverFromNostr: stamps lastPublishedAt from event.created_at (in ms)', async () => {
  const { profile, identity } = await freshEnvWithIdentity();
  const fetcher = async () => fakeKind0Event({ name: 'Satoshi' }, 1_700_000_000);
  await profile.recoverFromNostr({ identityStore: identity, fetcher });
  assert.equal(profile.lastPublishedAt, 1_700_000_000_000);
});

await test('recoverFromNostr: full overwrite clears stale local fields not present in remote', async () => {
  const { profile, identity } = await freshEnvWithIdentity();
  // Seed stale local data (e.g. left over from a previous identity).
  profile.applyEdits({
    displayName: 'Old Name',
    about: 'Old bio',
    lud16: 'old@example.com',
  });
  profile.isDirty = false;
  // Remote only carries `name`; everything else should be cleared.
  const fetcher = async () => fakeKind0Event({ name: 'new' });
  const r = await profile.recoverFromNostr({ identityStore: identity, fetcher });
  assert.equal(r.applied, 1);
  assert.deepEqual(r.fields, ['name']);
  assert.equal(profile.name, 'new');
  assert.equal(profile.displayName, '');
  assert.equal(profile.about, '');
  assert.equal(profile.lud16, '');
});

await test('recoverFromNostr: known keys (incl. nip05) applied, unknown ignored', async () => {
  const { profile, identity } = await freshEnvWithIdentity();
  const fetcher = async () => fakeKind0Event({
    name: 'Satoshi',
    nip05: 'satoshi@x.test',
    pronouns: 'they/them',
    custom_field: 'whatever',
  });
  const r = await profile.recoverFromNostr({ identityStore: identity, fetcher });
  assert.equal(r.applied, 2);
  assert.equal(profile.name, 'Satoshi');
  // nip05 is a recognised profile field now, so it round-trips on recovery.
  assert.equal(profile.nip05, 'satoshi@x.test');
  // Truly unknown wire keys still never leak into the store.
  assert.equal(profile.pronouns, undefined);
  assert.equal(profile.custom_field, undefined);
});

await test('recoverFromNostr: persists the recovered profile to localStorage', async () => {
  const { profile, identity } = await freshEnvWithIdentity();
  const fetcher = async () => fakeKind0Event({
    name: 'Satoshi',
    lud16: 'satoshi@x.test',
  }, 1_700_000_000);
  await profile.recoverFromNostr({ identityStore: identity, fetcher });
  const persisted = readPersisted();
  assert.equal(persisted.name, 'Satoshi');
  assert.equal(persisted.lud16, 'satoshi@x.test');
  assert.equal(persisted.lastPublishedAt, 1_700_000_000_000);
});

await test('recoverFromNostr: fetcher throwing collapses to ok=false, reason=fetch-failed', async () => {
  const { profile, identity } = await freshEnvWithIdentity();
  const fetcher = async () => { throw new Error('boom'); };
  const r = await profile.recoverFromNostr({ identityStore: identity, fetcher });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'fetch-failed');
  assert.equal(r.hadRemote, false);
  assert.equal(r.applied, 0);
});

await test('recoverFromNostr: remote event with empty content leaves the store empty', async () => {
  const { profile, identity } = await freshEnvWithIdentity();
  const fetcher = async () => fakeKind0Event({});
  const r = await profile.recoverFromNostr({ identityStore: identity, fetcher });
  assert.equal(r.ok, true);
  assert.equal(r.hadRemote, true);
  assert.equal(r.applied, 0);
  assert.deepEqual(r.fields, []);
  assert.equal(profile.isEmpty, true);
  // Still stamps lastPublishedAt — the remote event did exist.
  assert.equal(profile.lastPublishedAt, 1_700_000_000_000);
});

await test('recoverFromNostr: non-string content values are coerced to empty', async () => {
  const { profile, identity } = await freshEnvWithIdentity();
  // A malicious or buggy peer might publish numeric or array values
  // for what should be string fields. `parseProfileContent` doesn't
  // shape-check past "is it an object"; the store must defend itself.
  const fetcher = async () => fakeKind0Event({
    name: 'Satoshi',
    about: 42,
    website: ['https://x.test'],
    picture: null,
  });
  const r = await profile.recoverFromNostr({ identityStore: identity, fetcher });
  assert.equal(r.applied, 1);
  assert.equal(profile.name, 'Satoshi');
  assert.equal(profile.about, '');
  assert.equal(profile.website, '');
  assert.equal(profile.picture, '');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
