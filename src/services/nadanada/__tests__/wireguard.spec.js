/**
 * nadanada WireGuard helpers — keygen + config assembly tests.
 *
 * Coverage focus:
 *   - generated keys are valid 32-byte Curve25519 keys, base64-encoded
 *   - keypairs are unique per call (random scalar)
 *   - assembleWireGuardConfig splices the private key into [Interface]
 *     whether or not a placeholder line exists
 *   - the preshared key is added under [Peer] only when missing
 *   - guards reject empty / keyless input
 *
 * Run directly with Node:
 *   node src/services/nadanada/__tests__/wireguard.spec.js
 */

import { strict as assert } from 'node:assert'
import { Buffer } from 'node:buffer'
import {
  generateWireGuardKeypair,
  generatePresharedKey,
  assembleWireGuardConfig,
} from '../wireguard.js'

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

const b64Len = (s) => Buffer.from(s, 'base64').length

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

test('generateWireGuardKeypair returns 32-byte base64 keys', () => {
  const { privateKey, publicKey } = generateWireGuardKeypair()
  assert.equal(typeof privateKey, 'string')
  assert.equal(typeof publicKey, 'string')
  assert.equal(privateKey.length, 44, 'private key is 44 base64 chars')
  assert.equal(publicKey.length, 44, 'public key is 44 base64 chars')
  assert.equal(b64Len(privateKey), 32)
  assert.equal(b64Len(publicKey), 32)
})

test('keypairs are unique across calls', () => {
  const a = generateWireGuardKeypair()
  const b = generateWireGuardKeypair()
  assert.notEqual(a.privateKey, b.privateKey)
  assert.notEqual(a.publicKey, b.publicKey)
})

test('generatePresharedKey returns a 32-byte base64 key', () => {
  const psk = generatePresharedKey()
  assert.equal(psk.length, 44)
  assert.equal(b64Len(psk), 32)
})

// ---------------------------------------------------------------------------
// Config assembly
// ---------------------------------------------------------------------------

const SERVER_NO_PRIV = `[Interface]
Address = 10.64.0.2/32
DNS = 10.64.0.1

[Peer]
PublicKey = SERVERPUBKEY
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0`

test('injects PrivateKey as first [Interface] line when absent', () => {
  const out = assembleWireGuardConfig(SERVER_NO_PRIV, { privateKey: 'MYPRIV' })
  const lines = out.split('\n')
  assert.equal(lines[0], '[Interface]')
  assert.equal(lines[1], 'PrivateKey = MYPRIV')
  // original content preserved
  assert.ok(out.includes('Endpoint = vpn.example.com:51820'))
})

test('replaces an existing PrivateKey placeholder', () => {
  const withPlaceholder = SERVER_NO_PRIV.replace(
    '[Interface]',
    '[Interface]\nPrivateKey = REPLACE_ME',
  )
  const out = assembleWireGuardConfig(withPlaceholder, { privateKey: 'REAL' })
  assert.ok(out.includes('PrivateKey = REAL'))
  assert.ok(!out.includes('REPLACE_ME'))
  // exactly one PrivateKey line
  assert.equal((out.match(/PrivateKey =/g) || []).length, 1)
})

test('adds PresharedKey under [Peer] when missing', () => {
  const out = assembleWireGuardConfig(SERVER_NO_PRIV, {
    privateKey: 'MYPRIV',
    presharedKey: 'MYPSK',
  })
  assert.ok(out.includes('PresharedKey = MYPSK'))
  // it lives in the peer block, after the server public key
  const peerIdx = out.indexOf('[Peer]')
  assert.ok(out.indexOf('PresharedKey = MYPSK') > peerIdx)
})

test('does not duplicate an existing PresharedKey', () => {
  const withPsk = `${SERVER_NO_PRIV}\nPresharedKey = SERVERPSK`
  const out = assembleWireGuardConfig(withPsk, {
    privateKey: 'MYPRIV',
    presharedKey: 'MYPSK',
  })
  assert.equal((out.match(/PresharedKey =/g) || []).length, 1)
  assert.ok(out.includes('SERVERPSK'))
  assert.ok(!out.includes('MYPSK'))
})

test('rejects empty config and missing private key', () => {
  assert.throws(() => assembleWireGuardConfig('', { privateKey: 'X' }))
  assert.throws(() => assembleWireGuardConfig(SERVER_NO_PRIV, {}))
})

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
