/**
 * Identity pointer — wire format tests.
 *
 * The pointer is what makes the account-index climb survive a fresh
 * restore, so the assertions center on the recovery contract: signed
 * by account 0, the active index readable without decryption, the
 * roster readable with it, and a damaged blob degrading to the public
 * tag instead of to nothing.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/nostrIdentityPointer.spec.js
 */

import { strict as assert } from 'node:assert';

const { getPublicKey, verifyEvent, nip44 } = await import('nostr-core');
const {
  POINTER_KIND,
  POINTER_D_TAG,
  buildPointerEvent,
  fetchPointer,
  sanitizeRoster,
} = await import('../nostrIdentityPointer.js');
const { deriveSelfConversationKey } = await import('../nostrAddressBook.js');

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

const SECRET0 = new Uint8Array(32).fill(0x33);
const PUBKEY0 = getPublicKey(SECRET0);

/** A pool stub whose querySync returns a fixed event list. */
function poolReturning(events) {
  return { querySync: async () => events };
}

function tagValue(event, name) {
  const tag = event.tags.find((t) => t[0] === name);
  return tag ? tag[1] : undefined;
}

console.log('nostrIdentityPointer.spec');

await test('sanitizeRoster guarantees account 0 + active, dedupes, sorts, clamps labels', () => {
  const roster = sanitizeRoster(
    [
      { i: 3, label: '  Work  ' },
      { i: 3, label: 'duplicate ignored' },
      { i: -1 },
      { i: 1.5 },
      { i: 7, label: 'x'.repeat(200), createdAt: 123 },
    ],
    5,
  );
  assert.deepEqual(roster.map((a) => a.i), [0, 3, 5, 7]);
  assert.equal(roster.find((a) => a.i === 3).label, 'Work');
  assert.equal(roster.find((a) => a.i === 7).label.length, 40);
  assert.equal(roster.find((a) => a.i === 7).createdAt, 123);
});

await test('buildPointerEvent: kind, d tag, public account tag, signed by account 0', () => {
  const event = buildPointerEvent({
    secretKey0: SECRET0,
    pubkey0: PUBKEY0,
    active: 2,
    accounts: [{ i: 0 }, { i: 1 }, { i: 2 }],
    createdAt: 1_700_000_000,
  });
  assert.equal(event.kind, POINTER_KIND);
  assert.equal(event.pubkey, PUBKEY0);
  assert.equal(tagValue(event, 'd'), POINTER_D_TAG);
  assert.equal(tagValue(event, 'account'), '2');
  assert.equal(tagValue(event, 'client'), 'buhogo');
  assert.equal(tagValue(event, 'encrypted'), 'nip44');
  assert.equal(verifyEvent(event), true);
});

await test('roster round-trips through the encrypted content', async () => {
  const event = buildPointerEvent({
    secretKey0: SECRET0,
    pubkey0: PUBKEY0,
    active: 3,
    accounts: [{ i: 0 }, { i: 3, label: 'Business' }],
  });
  const result = await fetchPointer({
    pool: poolReturning([event]),
    pubkey0: PUBKEY0,
    secretKey0: SECRET0,
  });
  assert.equal(result.active, 3);
  assert.equal(result.decrypted, true);
  assert.deepEqual(result.accounts.map((a) => a.i), [0, 3]);
  assert.equal(result.accounts.find((a) => a.i === 3).label, 'Business');
});

await test('undecryptable content falls back to the public account tag', async () => {
  const event = buildPointerEvent({
    secretKey0: SECRET0,
    pubkey0: PUBKEY0,
    active: 4,
    accounts: [{ i: 0 }, { i: 4 }],
  });
  // Same valid signature is required, so rebuild the event with garbage
  // content encrypted under a DIFFERENT key: tag says 4, content is noise.
  const otherSecret = new Uint8Array(32).fill(0x44);
  const foreignKey = deriveSelfConversationKey(otherSecret, getPublicKey(otherSecret));
  const { finalizeEvent } = await import('nostr-core');
  const damaged = finalizeEvent({
    kind: POINTER_KIND,
    created_at: event.created_at,
    tags: event.tags,
    content: nip44.encrypt('{"active":9}', foreignKey),
  }, SECRET0);

  const result = await fetchPointer({
    pool: poolReturning([damaged]),
    pubkey0: PUBKEY0,
    secretKey0: SECRET0,
  });
  assert.equal(result.active, 4);
  assert.equal(result.decrypted, false);
  assert.deepEqual(result.accounts.map((a) => a.i), [0, 4]);
});

await test('newest pointer wins; foreign and unsigned events are ignored', async () => {
  const older = buildPointerEvent({
    secretKey0: SECRET0, pubkey0: PUBKEY0, active: 1,
    accounts: [{ i: 0 }, { i: 1 }], createdAt: 1_700_000_000,
  });
  const newer = buildPointerEvent({
    secretKey0: SECRET0, pubkey0: PUBKEY0, active: 2,
    accounts: [{ i: 0 }, { i: 1 }, { i: 2 }], createdAt: 1_700_000_500,
  });
  // JSON-clone so nostr-core's symbol-keyed verification cache does
  // not ride along and vouch for the tampered event.
  const forged = { ...JSON.parse(JSON.stringify(newer)), created_at: 1_700_999_999, sig: '00'.repeat(64) };
  const result = await fetchPointer({
    pool: poolReturning([older, forged, newer]),
    pubkey0: PUBKEY0,
    secretKey0: SECRET0,
  });
  assert.equal(result.active, 2);
  assert.equal(result.eventCreatedAt, 1_700_000_500);
});

await test('no pointer published resolves to null, not an error', async () => {
  const result = await fetchPointer({
    pool: poolReturning([]),
    pubkey0: PUBKEY0,
    secretKey0: SECRET0,
  });
  assert.equal(result, null);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
