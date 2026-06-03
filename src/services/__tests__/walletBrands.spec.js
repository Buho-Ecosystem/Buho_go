/**
 * walletBrands — consumer-wallet recognition by Lightning Address domain.
 *
 * Coverage focus:
 *   - known domains resolve to the expected name + logo
 *   - the ecash family (Minibits, npub.cash) shares the single Cashu brand
 *   - case-insensitive, whitespace-tolerant domain matching
 *   - unknown domains and junk inputs miss (return null) so the caller
 *     cleanly falls back to the raw/generic identity
 *   - every registered logo path is an absolute /public URL
 *
 * Run directly with Node:
 *   node src/services/__tests__/walletBrands.spec.js
 */

import { strict as assert } from 'node:assert'
import { matchWalletBrand, WALLET_BRANDS } from '../walletBrands.js'

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

test('Wallet of Satoshi: resolves name + logo from walletofsatoshi.com', () => {
  const b = matchWalletBrand('walletofsatoshi.com')
  assert.equal(b.name, 'Wallet of Satoshi')
  assert.equal(b.logo, '/Social_Wallet_logos/walletofsatoshi-icon.svg')
})

test('Phoenix: resolves from phoenixwallet.me', () => {
  assert.equal(matchWalletBrand('phoenixwallet.me').name, 'Phoenix')
})

test('Blink / Alby / Primal / ZBD / Fountain / Wavlake / Wavespace / YakiHonne / zap.stream / Damus', () => {
  assert.equal(matchWalletBrand('blink.sv').name, 'Blink')
  assert.equal(matchWalletBrand('getalby.com').name, 'Alby')
  assert.equal(matchWalletBrand('primal.net').name, 'Primal')
  assert.equal(matchWalletBrand('zbd.gg').name, 'ZBD')
  assert.equal(matchWalletBrand('fountain.fm').name, 'Fountain')
  assert.equal(matchWalletBrand('wavlake.com').name, 'Wavlake')
  assert.equal(matchWalletBrand('wave.space').name, 'Wavespace')
  assert.equal(matchWalletBrand('yakihonne.com').name, 'YakiHonne')
  assert.equal(matchWalletBrand('zap.stream').name, 'zap.stream')
  assert.equal(matchWalletBrand('damus.io').name, 'Damus')
  // ZBD's white wordmark needs a dark backdrop + contain to render in the avatar.
  assert.equal(matchWalletBrand('zbd.gg').logoContain, true)
  assert.match(matchWalletBrand('zbd.gg').logoBg, /^#[0-9a-fA-F]{6}$/)
  assert.equal(matchWalletBrand('blitzwalletapp.com').name, 'Blitz Wallet')
  assert.equal(matchWalletBrand('strike.me').name, 'Strike')
  assert.equal(matchWalletBrand('strik.me').name, 'Strike')
})

test('LNbits flagship (lnbits.com) uses the bolt icon', () => {
  const com = matchWalletBrand('lnbits.com')
  assert.equal(com.name, 'LNbits')
  assert.equal(com.logo, '/LNBits/lnbits-icon.svg')
})

test('German LNbits instances carry the Business Bitcoin brand', () => {
  for (const d of ['lnbits.de', 'timecatcher.lnbits.de']) {
    const b = matchWalletBrand(d)
    assert.equal(b.name, 'Business Bitcoin', `${d} -> Business Bitcoin`)
    assert.equal(b.logo, '/Social_Wallet_logos/BusinessBitcoin.png', `${d} logo`)
  }
})

test('Buho brand domains resolve to the Buho logo', () => {
  for (const d of ['mybuho.de', 'pay.mybuho.de', 'btc.mybuho.de']) {
    const b = matchWalletBrand(d)
    assert.equal(b.name, 'Buho', `${d} -> Buho`)
    assert.equal(b.logo, '/buho_logo_grey.svg', `${d} logo`)
  }
})

test('Ecash family (npub.cash / minibits.cash / sats.contact / nutstash.app) shares the one Cashu brand + logo', () => {
  const domains = ['npub.cash', 'minibits.cash', 'sats.contact', 'nutstash.app']
  assert.equal(domains.length, 4)
  for (const d of domains) {
    const b = matchWalletBrand(d)
    assert.equal(b.name, 'Cashu', `${d} -> Cashu`)
    assert.equal(b.logo, '/cashu/cashuu.png', `${d} -> Cashu logo`)
  }
})

test('matching is case-insensitive and trims whitespace', () => {
  assert.equal(matchWalletBrand('WalletOfSatoshi.com').name, 'Wallet of Satoshi')
  assert.equal(matchWalletBrand('  blink.sv  ').name, 'Blink')
})

test('unknown domains and junk inputs miss (null)', () => {
  assert.equal(matchWalletBrand('example.com'), null)
  assert.equal(matchWalletBrand('demo.lnbits.com'), null) // self-hosted instance, intentionally unmapped
  assert.equal(matchWalletBrand(''), null)
  assert.equal(matchWalletBrand(null), null)
  assert.equal(matchWalletBrand(undefined), null)
  assert.equal(matchWalletBrand(42), null)
})

test('every registered logo is an absolute /public URL', () => {
  for (const [domain, entry] of Object.entries(WALLET_BRANDS)) {
    assert.ok(entry.name, `${domain} has a name`)
    assert.match(entry.logo, /^\/[\w./-]+\.(svg|png)$/, `${domain} logo is an absolute asset path`)
  }
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
