/**
 * txNormalizer — the single canonical transaction shape shared by
 * TransactionHistory, TransactionDetails and Wallet's last-transaction
 * preview.
 *
 * Coverage focus:
 *   - per-provider amount semantics (Spark includes the fee in `amount`,
 *     LNbits/NWC exclude it, Arkade reports total only with no fee split)
 *   - LNbits fiatAtSettlement extraction straight from `extra`
 *   - LUD-12 comment extraction (explicit field only — never guessed from
 *     description)
 *   - payment hash / preimage / bolt11 passthrough
 *   - incoming vs outgoing direction resolution, including legacy
 *     'receive'/'send' raw types
 *
 * Run directly with Node:
 *   node src/services/__tests__/txNormalizer.spec.js
 */

import { strict as assert } from 'node:assert'
import { normalizeTx, computeAmounts, extractLnbitsFiatAtSettlement } from '../txNormalizer.js'

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

// ---------------------------------------------------------------------------
// Amount semantics per provider
// ---------------------------------------------------------------------------

test('Spark: amount already includes the fee, so recipientSats = amount - fee, totalSats = amount', () => {
  const tx = normalizeTx(
    { id: 'spark-1', type: 'send', amount: 502, fee: 2, settled_at: 1000 },
    { walletType: 'spark' },
  )
  assert.equal(tx.feeSats, 2)
  assert.equal(tx.recipientSats, 500)
  assert.equal(tx.totalSats, 502)
})

test('Spark: no fee -> recipientSats === totalSats === amount', () => {
  const tx = normalizeTx(
    { id: 'spark-2', type: 'receive', amount: 15, fee: 0, settled_at: 1000 },
    { walletType: 'spark' },
  )
  assert.equal(tx.feeSats, 0)
  assert.equal(tx.recipientSats, 15)
  assert.equal(tx.totalSats, 15)
})

test('LNbits: amount excludes the fee, so recipientSats = amount, totalSats = amount + fee (fixes "sent 500 shows -498")', () => {
  const tx = normalizeTx(
    { id: 'lnbits-1', type: 'send', amount: 500, fee: 2, settled_at: 1000 },
    { walletType: 'lnbits' },
  )
  assert.equal(tx.feeSats, 2)
  assert.equal(tx.recipientSats, 500)
  assert.equal(tx.totalSats, 502)
})

test('NWC: same exclusive-of-fee semantics as LNbits', () => {
  const tx = normalizeTx(
    { id: 'nwc-1', type: 'send', amount: 300, fee: 4, settled_at: 1000 },
    { walletType: 'nwc' },
  )
  assert.equal(tx.feeSats, 4)
  assert.equal(tx.recipientSats, 300)
  assert.equal(tx.totalSats, 304)
})

test('Arkade: fee is unknown, not zero — feeSats is null, recipientSats === totalSats === amount', () => {
  const tx = normalizeTx(
    { id: 'arkade-1', type: 'outgoing', amount: 350, settled_at: 1000 },
    { walletType: 'arkade' },
  )
  assert.equal(tx.feeSats, null)
  assert.equal(tx.recipientSats, 350)
  assert.equal(tx.totalSats, 350)
})

test('computeAmounts is exposed standalone and agrees with normalizeTx', () => {
  assert.deepEqual(
    computeAmounts('spark', 502, 2),
    { recipientSats: 500, feeSats: 2, totalSats: 502 },
  )
  assert.deepEqual(
    computeAmounts('lnbits', 500, 2),
    { recipientSats: 500, feeSats: 2, totalSats: 502 },
  )
  assert.deepEqual(
    computeAmounts('arkade', 350, 0),
    { recipientSats: 350, feeSats: null, totalSats: 350 },
  )
})

// ---------------------------------------------------------------------------
// LNbits fiatAtSettlement
// ---------------------------------------------------------------------------

test('LNbits: fiatAtSettlement is read straight off extra.wallet_fiat_* / wallet_btc_rate', () => {
  const tx = normalizeTx(
    {
      id: 'lnbits-2',
      type: 'receive',
      amount: 50,
      fee: 0,
      settled_at: 1000,
      extra: { wallet_fiat_currency: 'USD', wallet_fiat_amount: 0.031, wallet_btc_rate: 62268 },
    },
    { walletType: 'lnbits' },
  )
  assert.deepEqual(tx.fiatAtSettlement, { currency: 'USD', amount: 0.031, rate: 62268 })
})

test('LNbits: wallet_fiat_rate is sats-per-fiat, NOT the BTC price — invert it when it is all we have', () => {
  // Live lnbits.de record: wallet_fiat_rate 1826.46576 while the actual
  // BTC price was ~54,750 EUR. The extractor must never present the
  // sats-per-euro figure as "the BTC price".
  const result = extractLnbitsFiatAtSettlement({
    wallet_fiat_currency: 'EUR',
    wallet_fiat_amount: 0.164,
    wallet_fiat_rate: 1826.46576,
  })
  assert.equal(result.currency, 'EUR')
  assert.equal(result.amount, 0.164)
  assert.ok(Math.abs(result.rate - 100000000 / 1826.46576) < 0.01)
  assert.ok(result.rate > 50000 && result.rate < 60000)
})

test('LNbits: incomplete extra never fabricates a partial fiatAtSettlement', () => {
  assert.equal(extractLnbitsFiatAtSettlement({ wallet_fiat_currency: 'USD' }), null)
  assert.equal(extractLnbitsFiatAtSettlement({}), null)
  assert.equal(extractLnbitsFiatAtSettlement(null), null)
})

test('Non-LNbits providers never get a fabricated fiatAtSettlement, but do accept a stored snapshot', () => {
  const withoutSnapshot = normalizeTx(
    { id: 'nwc-2', type: 'receive', amount: 300, settled_at: 1000 },
    { walletType: 'nwc' },
  )
  assert.equal(withoutSnapshot.fiatAtSettlement, null)

  const stored = { currency: 'USD', amount: 0.2, rate: 63000 }
  const withSnapshot = normalizeTx(
    { id: 'nwc-3', type: 'receive', amount: 300, settled_at: 1000 },
    { walletType: 'nwc', fiatAtSettlement: stored },
  )
  assert.deepEqual(withSnapshot.fiatAtSettlement, stored)
})

// ---------------------------------------------------------------------------
// Comment extraction — explicit fields only, never guessed
// ---------------------------------------------------------------------------

test('LNbits: comment comes from extra.comment', () => {
  const tx = normalizeTx(
    { id: 'lnbits-3', type: 'receive', amount: 20, extra: { comment: 'Thank you again! :)' } },
    { walletType: 'lnbits' },
  )
  assert.equal(tx.comment, 'Thank you again! :)')
})

test('NWC: description is NOT promoted to comment, even though some backends put the lnurlp comment there', () => {
  const tx = normalizeTx(
    { id: 'nwc-4', type: 'receive', amount: 300, description: 'NWC send with comment' },
    { walletType: 'nwc' },
  )
  assert.equal(tx.comment, null)
  // The description itself is untouched and still readable as before.
  assert.equal(tx.description, 'NWC send with comment')
})

test('Arkade: no extra, no comment field -> comment stays null (no invented text)', () => {
  const tx = normalizeTx({ id: 'arkade-2', type: 'incoming', amount: 100 }, { walletType: 'arkade' })
  assert.equal(tx.comment, null)
})

// ---------------------------------------------------------------------------
// Hash / preimage / bolt11 passthrough
// ---------------------------------------------------------------------------

test('paymentHash / preimage / bolt11 pass through when the provider supplies them', () => {
  const tx = normalizeTx(
    {
      id: 'lnbits-4',
      type: 'receive',
      amount: 50,
      paymentHash: 'abc123',
      preimage: 'def456',
      bolt11: 'lnbc1...',
    },
    { walletType: 'lnbits' },
  )
  assert.equal(tx.paymentHash, 'abc123')
  assert.equal(tx.preimage, 'def456')
  assert.equal(tx.bolt11, 'lnbc1...')
})

test('snake_case payment_hash from a raw NWC/LNbits record is normalised to paymentHash', () => {
  const tx = normalizeTx(
    { id: 'nwc-5', type: 'send', amount: 300, payment_hash: 'raw-hash' },
    { walletType: 'nwc' },
  )
  assert.equal(tx.paymentHash, 'raw-hash')
})

test('Spark/Arkade transfers with no Lightning data leave paymentHash/preimage/bolt11 null (not fabricated)', () => {
  const spark = normalizeTx({ id: 'spark-3', type: 'send', amount: 3, sparkTransfer: true }, { walletType: 'spark' })
  assert.equal(spark.paymentHash, null)
  assert.equal(spark.preimage, null)
  assert.equal(spark.bolt11, null)

  const arkade = normalizeTx({ id: 'arkade-3', type: 'incoming', amount: 100 }, { walletType: 'arkade' })
  assert.equal(arkade.paymentHash, null)
  assert.equal(arkade.preimage, null)
  assert.equal(arkade.bolt11, null)
})

test('bolt11 falls back to payment_request when a provider only ever named it that', () => {
  const tx = normalizeTx(
    { id: 'nwc-6', type: 'send', amount: 300, payment_request: 'lnbc2...' },
    { walletType: 'nwc' },
  )
  assert.equal(tx.bolt11, 'lnbc2...')
  assert.equal(tx.payment_request, 'lnbc2...')
})

// ---------------------------------------------------------------------------
// Direction resolution
// ---------------------------------------------------------------------------

test('incoming vs outgoing: canonical values pass straight through', () => {
  assert.equal(normalizeTx({ id: '1', type: 'incoming', amount: 1 }).type, 'incoming')
  assert.equal(normalizeTx({ id: '2', type: 'outgoing', amount: 1 }).type, 'outgoing')
})

test('incoming vs outgoing: legacy receive/send raw types resolve correctly', () => {
  assert.equal(normalizeTx({ id: '3', type: 'receive', amount: 1 }).type, 'incoming')
  assert.equal(normalizeTx({ id: '4', type: 'received', amount: 1 }).type, 'incoming')
  assert.equal(normalizeTx({ id: '5', type: 'send', amount: 1 }).type, 'outgoing')
  assert.equal(normalizeTx({ id: '6', type: 'sent', amount: 1 }).type, 'outgoing')
})

test('incoming vs outgoing: missing/unknown type falls back to the amount sign', () => {
  assert.equal(normalizeTx({ id: '7', type: null, amount: 5 }).type, 'incoming')
  assert.equal(normalizeTx({ id: '8', type: undefined, amount: -5 }).type, 'outgoing')
})

// ---------------------------------------------------------------------------
// Backward-compatible field passthrough
// ---------------------------------------------------------------------------

test('existing template fields survive untouched: description/memo/settled_at/status/rawType/sparkTransfer', () => {
  const tx = normalizeTx(
    {
      id: 'spark-4',
      type: 'send',
      amount: 100,
      description: 'Coffee',
      timestamp: 1700000000,
      status: 'pending',
      rawType: 'LIGHTNING_SEND',
      sparkTransfer: false,
    },
    { walletType: 'spark' },
  )
  assert.equal(tx.description, 'Coffee')
  assert.equal(tx.memo, 'Coffee')
  assert.equal(tx.settled_at, 1700000000)
  assert.equal(tx.status, 'pending')
  assert.equal(tx.rawType, 'LIGHTNING_SEND')
  assert.equal(tx.sparkTransfer, false)
})

test('created_at falls back to settled_at when the provider gives us only one timestamp', () => {
  const tx = normalizeTx({ id: 'arkade-4', type: 'incoming', amount: 1, timestamp: 500 }, { walletType: 'arkade' })
  assert.equal(tx.settled_at, 500)
  assert.equal(tx.created_at, 500)
})

test('created_at prefers an explicit created_at/time over settled_at when both are present', () => {
  const tx = normalizeTx(
    { id: 'lnbits-5', type: 'receive', amount: 1, settled_at: 2000, created_at: 1990 },
    { walletType: 'lnbits' },
  )
  assert.equal(tx.settled_at, 2000)
  assert.equal(tx.created_at, 1990)
})

test('extra provider fields (tag, lnaddress, expiry) survive on the canonical object', () => {
  const tx = normalizeTx(
    { id: 'lnbits-6', type: 'receive', amount: 1, tag: 'lnurlp', expiry: 3600, extra: { lnaddress: 'buhotest0713@lnbits.de' } },
    { walletType: 'lnbits' },
  )
  assert.equal(tx.tag, 'lnurlp')
  assert.equal(tx.expiry, 3600)
  assert.equal(tx.lnaddress, 'buhotest0713@lnbits.de')
})

// ---------------------------------------------------------------------------
// Expired invoices — a pending incoming invoice past its expiry is 'expired'
// ---------------------------------------------------------------------------

test('pending incoming invoice with a past ISO expiry (LNbits list format) resolves to expired', () => {
  const tx = normalizeTx(
    { id: 'lnbits-7', type: 'receive', amount: 100, status: 'pending', expiry: '2020-01-01T00:00:00+00:00' },
    { walletType: 'lnbits' },
  )
  assert.equal(tx.status, 'expired')
})

test('pending incoming invoice with a future expiry stays pending', () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const tx = normalizeTx(
    { id: 'lnbits-8', type: 'receive', amount: 100, status: 'pending', expiry: future },
    { walletType: 'lnbits' },
  )
  assert.equal(tx.status, 'pending')
})

test('pending incoming invoice with a past unix-seconds expires_at (NWC) resolves to expired', () => {
  const tx = normalizeTx(
    { id: 'nwc-7', type: 'receive', amount: 100, status: 'pending', expires_at: 1577836800 },
    { walletType: 'nwc' },
  )
  assert.equal(tx.status, 'expired')
})

test('completed transactions never become expired, whatever the expiry says', () => {
  const tx = normalizeTx(
    { id: 'lnbits-9', type: 'receive', amount: 100, status: 'completed', expiry: '2020-01-01T00:00:00+00:00' },
    { walletType: 'lnbits' },
  )
  assert.equal(tx.status, 'completed')
})

test('outgoing payments never become expired — the paid invoice expiring later does not unsettle the payment', () => {
  const tx = normalizeTx(
    { id: 'lnbits-10', type: 'send', amount: 100, status: 'pending', expiry: '2020-01-01T00:00:00+00:00' },
    { walletType: 'lnbits' },
  )
  assert.equal(tx.status, 'pending')
})

test('a small numeric expiry (relative seconds, not an absolute timestamp) never marks anything expired', () => {
  const tx = normalizeTx(
    { id: 'lnbits-11', type: 'receive', amount: 100, status: 'pending', expiry: 3600 },
    { walletType: 'lnbits' },
  )
  assert.equal(tx.status, 'pending')
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
