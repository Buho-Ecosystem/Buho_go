/**
 * nostrPaymentTarget — resolving a Nostr identifier to a payable Lightning
 * destination (lud16 / lud06) + the profile identity.
 *
 * Network is injected (fetchProfile), so these run offline. lookupIdentifier
 * decodes npub synchronously, so a real npub built from a known pubkey drives
 * the happy paths without touching relays.
 *
 * Run directly with Node:
 *   node src/services/__tests__/nostrPaymentTarget.spec.js
 */

import { strict as assert } from 'node:assert'
import { nip19 } from 'nostr-core'
import {
  resolveNostrLightningTarget,
  NOSTR_TARGET_ERROR,
} from '../nostrPaymentTarget.js'

let passed = 0
let failed = 0

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed += 1
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.stack || err.message}`)
    failed += 1
  }
}

const PUBKEY = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'
const NPUB = nip19.npubEncode(PUBKEY)

// A fake fetchProfile that returns a signed-looking kind:0 event carrying the
// given content (or null to simulate "no profile on the relays").
function fakeProfile(content) {
  return async (pubkey) => {
    assert.equal(pubkey, PUBKEY, 'fetchProfile called with the decoded pubkey')
    if (content === null) return null
    return { kind: 0, pubkey, content: JSON.stringify(content) }
  }
}

await test('lud16 -> lightning_address target + profile identity', async () => {
  const t = await resolveNostrLightningTarget(`nostr:${NPUB}`, {
    fetchProfile: fakeProfile({
      display_name: 'Alice',
      picture: 'https://example.com/alice.png',
      lud16: 'Alice@WalletOfSatoshi.com',
    }),
  })
  assert.equal(t.kind, 'lightning_address')
  assert.equal(t.address, 'alice@walletofsatoshi.com') // normalized lowercase
  assert.equal(t.pubkey, PUBKEY)
  assert.equal(t.npub, NPUB)
  assert.equal(t.profile.name, 'Alice')
  assert.equal(t.profile.picture, 'https://example.com/alice.png')
})

await test('no lud16 but lud06 -> lnurl target', async () => {
  const t = await resolveNostrLightningTarget(NPUB, {
    fetchProfile: fakeProfile({ name: 'bob', lud06: 'lnurl1dp68gurn8ghj7ctsdyh85etzv4jx2efwd9hj7' }),
  })
  assert.equal(t.kind, 'lnurl')
  assert.equal(t.address, 'lnurl1dp68gurn8ghj7ctsdyh85etzv4jx2efwd9hj7')
  assert.equal(t.profile.name, 'bob')
})

await test('lud16 wins over lud06 when both are present', async () => {
  const t = await resolveNostrLightningTarget(NPUB, {
    fetchProfile: fakeProfile({ lud16: 'a@b.com', lud06: 'lnurl1xyz' }),
  })
  assert.equal(t.kind, 'lightning_address')
  assert.equal(t.address, 'a@b.com')
})

await test('profile with no lud16/lud06 -> NO_ADDRESS', async () => {
  await assert.rejects(
    resolveNostrLightningTarget(NPUB, { fetchProfile: fakeProfile({ name: 'no wallet' }) }),
    (e) => e.code === NOSTR_TARGET_ERROR.NO_ADDRESS,
  )
})

await test('garbage lud16 (not an address) and no lud06 -> NO_ADDRESS', async () => {
  await assert.rejects(
    resolveNostrLightningTarget(NPUB, { fetchProfile: fakeProfile({ lud16: 'not-an-address' }) }),
    (e) => e.code === NOSTR_TARGET_ERROR.NO_ADDRESS,
  )
})

await test('no profile on relays -> NO_PROFILE', async () => {
  await assert.rejects(
    resolveNostrLightningTarget(NPUB, { fetchProfile: fakeProfile(null) }),
    (e) => e.code === NOSTR_TARGET_ERROR.NO_PROFILE,
  )
})

await test('not a Nostr identifier -> bubbles a typed lookup error', async () => {
  await assert.rejects(
    resolveNostrLightningTarget('definitely not nostr', { fetchProfile: fakeProfile({}) }),
    (e) => typeof e.code === 'string' && e.code.startsWith('LOOKUP_'),
  )
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
