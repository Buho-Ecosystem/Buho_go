/**
 * zapperProfiles — the attribution gate.
 *
 * utils/zaps decides whether a zap's sender is proven; this module is
 * where that decision is enforced for every surface. These tests lock
 * the guarantee that matters: an unverified zap can never produce a
 * name, a picture, a profile or a saveable contact, no matter which
 * exported function a page reaches for.
 *
 * The gate runs before any storage or relay access, so no stubbing is
 * needed. Anything that reaches the network would be a gate failure,
 * which is exactly what the negative assertions below catch.
 *
 * Rationale for the rule:
 * https://nostrdesign.org/docs/how-to/impostor-prevention/
 *
 * Run directly with Node:
 *   node src/services/__tests__/zapperProfiles.spec.js
 */

import { strict as assert } from 'node:assert';
import { nip19, generateSecretKey, getPublicKey } from 'nostr-core';
import {
  zapperProfile,
  zapperDisplayName,
  zapperPicture,
  zapperProfileEvent,
} from '../zapperProfiles.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed += 1;
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed += 1;
    });
}

const PUBKEY = getPublicKey(generateSecretKey());
const NPUB = nip19.npubEncode(PUBKEY);

const unverified = (extra = {}) => ({ npub: NPUB, pubkey: PUBKEY, verified: false, ...extra });

await test('an unverified zap resolves no profile', () => {
  assert.equal(zapperProfile(unverified()), null);
});

await test('an unverified zap gets no display name, not even a short npub', () => {
  // A shortened npub is still an attribution — the caller must fall back
  // to its own generic label instead.
  assert.equal(zapperDisplayName(unverified()), '');
});

await test('an unverified zap gets no picture', () => {
  assert.equal(zapperPicture(unverified()), '');
});

await test('an unverified zap cannot be saved as a contact', async () => {
  assert.equal(await zapperProfileEvent(unverified()), null);
});

await test('a missing or malformed verified flag is treated as unproven', () => {
  for (const zap of [
    { npub: NPUB, pubkey: PUBKEY },
    { npub: NPUB, pubkey: PUBKEY, verified: 'true' },
    { npub: NPUB, pubkey: PUBKEY, verified: 1 },
    null,
    undefined,
  ]) {
    assert.equal(zapperProfile(zap), null);
    assert.equal(zapperDisplayName(zap), '');
    assert.equal(zapperPicture(zap), '');
  }
});

await test('a verified zap with no resolvable identity stays empty rather than inventing one', () => {
  // Nothing cached and no relay reachable under Node: the honest answer
  // is absence, never a placeholder.
  assert.equal(zapperProfile({ npub: NPUB, pubkey: PUBKEY, verified: true }), null);
  assert.equal(zapperPicture({ npub: NPUB, pubkey: PUBKEY, verified: true }), '');
});

await test('a verified zap may be attributed by its npub before the profile lands', () => {
  const name = zapperDisplayName({ npub: NPUB, pubkey: PUBKEY, verified: true });
  assert.equal(name, `${NPUB.slice(0, 9)}…${NPUB.slice(-4)}`);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
// Unlike the other specs, this one exits explicitly. Resolving a
// verified zapper starts a relay fetch by design, and those sockets keep
// Node's event loop alive long after the assertions are done — without
// this the whole && -chained suite would hang here.
process.exit(failed > 0 ? 1 : 0);
