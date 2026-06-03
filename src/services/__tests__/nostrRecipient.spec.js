/**
 * nostrRecipient — resolving the person behind a Nostr-native Lightning
 * Address (npub.cash & co., where the local part is a bech32 npub).
 *
 * Coverage focus:
 *   - npub local part decodes to the right pubkey + canonical npub
 *   - ordinary addresses (usernames, phone numbers) and junk miss (null)
 *   - npub display truncation keeps the marker + a tail
 *   - profile name precedence (display_name -> name -> nip05)
 *   - avatar URL gating to safe schemes
 *
 * Run directly with Node:
 *   node src/services/__tests__/nostrRecipient.spec.js
 */

import { strict as assert } from 'node:assert'
import { nip19 } from 'nostr-core'
import {
  npubFromLightningAddress,
  shortenNpub,
  profileDisplayName,
  sanitizeImageUrl,
} from '../nostrRecipient.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed += 1
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    failed += 1
  }
}

// A real, valid npub built from a known pubkey so the assertions don't depend
// on a hand-copied bech32 string.
const PUBKEY = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'
const NPUB = nip19.npubEncode(PUBKEY)

test('npub.cash address: local part decodes to the pubkey + npub', () => {
  const r = npubFromLightningAddress(`${NPUB}@npub.cash`)
  assert.equal(r.pubkey, PUBKEY)
  assert.equal(r.npub, NPUB)
})

test('npub local part works regardless of the host domain', () => {
  assert.equal(npubFromLightningAddress(`${NPUB}@minibits.cash`).pubkey, PUBKEY)
})

test('ordinary addresses and junk miss (null)', () => {
  assert.equal(npubFromLightningAddress('feudaltribe162@walletofsatoshi.com'), null)
  assert.equal(npubFromLightningAddress('0777491011@bitzed.xyz'), null)
  assert.equal(npubFromLightningAddress(`${NPUB}`), null) // no domain, not an address
  assert.equal(npubFromLightningAddress('@npub.cash'), null) // empty local
  assert.equal(npubFromLightningAddress('npub1notvalid@npub.cash'), null) // bad bech32
  assert.equal(npubFromLightningAddress(null), null)
  assert.equal(npubFromLightningAddress(42), null)
})

test('shortenNpub middle-truncates and keeps the marker + tail', () => {
  const short = shortenNpub(NPUB)
  assert.ok(short.startsWith('npub1'), 'keeps the npub1 marker')
  assert.ok(short.includes('…'), 'has an ellipsis')
  assert.equal(short.slice(-5), NPUB.slice(-5), 'keeps the tail')
  assert.ok(short.length < NPUB.length, 'is shorter than the full npub')
  // already short / non-string
  assert.equal(shortenNpub('npub1abc'), 'npub1abc')
  assert.equal(shortenNpub(null), '')
})

test('profileDisplayName prefers display_name, then name, then nip05', () => {
  assert.equal(profileDisplayName({ display_name: 'Alice', name: 'al', nip05: 'a@b.c' }), 'Alice')
  assert.equal(profileDisplayName({ name: 'al', nip05: 'a@b.c' }), 'al')
  assert.equal(profileDisplayName({ nip05: 'a@b.c' }), 'a@b.c')
  assert.equal(profileDisplayName({ display_name: '   ' }), '') // blank ignored
  assert.equal(profileDisplayName({}), '')
  assert.equal(profileDisplayName(null), '')
})

test('sanitizeImageUrl gates to safe schemes', () => {
  assert.equal(sanitizeImageUrl('https://example.com/a.png'), 'https://example.com/a.png')
  assert.equal(sanitizeImageUrl('  http://example.com/a.png  '), 'http://example.com/a.png')
  assert.equal(sanitizeImageUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
  assert.equal(sanitizeImageUrl('javascript:alert(1)'), '')
  assert.equal(sanitizeImageUrl('ftp://example.com/a.png'), '')
  assert.equal(sanitizeImageUrl(''), '')
  assert.equal(sanitizeImageUrl(null), '')
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
