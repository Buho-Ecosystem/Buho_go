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

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
