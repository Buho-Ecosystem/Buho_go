/**
 * Orphan recovery — finding purchases that were paid for but never recorded.
 *
 * The fixture at the centre of this file is a REAL lost payment: a Germany
 * 1GB/7d eSIM, paid 2026-08-26, that the app charged for and then dropped
 * because nothing persisted the redemption key. Note `paymentHash: null` —
 * Spark reports none on a PREIMAGE_SWAP row, so the bolt11 is the only thing
 * standing between the user and their money.
 *
 * Run directly with Node:
 *   node src/services/nadanada/__tests__/recovery.spec.js
 */

import { strict as assert } from 'node:assert'
import { assertNativePurchase } from '../client.js'
import {
  parseNadanadaInvoice,
  findOrphanPayments,
  missingDetailFor,
  candidateOrderFields,
  collectOutgoingPayments,
} from '../recovery.js'
import { ORDER_KIND, ORDER_STATE } from '../orders.js'

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

// The real thing: "eSIM Purchase - Order bdb50572-880a-45fb-85ca-b6a5b96bc3a9"
const LOST_ESIM_BOLT11 =
  'lnbc24070n1p4g737jdzav4f5jnfq2p6hycmgv9ek2gpdyp8hyer9wgsxyerzx5cr2dej95ursvrp956r2enz95ur2cmp94' +
  '3rvcf4vgunvcnrxdsnjnp4qtyjfy99jhnpj8u9en49meskq8x08czk5axrh4cju64fvpcfenrfupp5dfh8f9h4pzqy8p9j9' +
  'dgtpjs7wst54n2jtxluzw8y7epn77hnfv0ssp5h7hmz6pkssf3z98y0k7kfatppdsu5nx29pwkx4w4qftw7nhrh03s9qyys' +
  'gqcqzp2xqyz5vqfhd7jf80kdwrguyaqxwjhmvs7djwlgeugtpqst5r6gwgwc40r9jxc6y7c3hf6sy56rmd28h8wv69n3h2p' +
  '92k7a3vrmesvp2kmac9hgspq8fzks'

// "nadanada VPN API day - Order cfeb5868-60a4-43a5-b07c-f990350f737c"
const VPN_BOLT11 =
  'lnbc6350n1p4g7k6ddrgdeskgctwv9jxzgzk2p8zqs2sfysxgcteyqkjqnmjv3jhygrrvejkydfcxcuz6d3svy6z6dpnvy6j' +
  '6c3sxa3j6e3e8ycrxdfsvcmnxdmrnp4qtyjfy99jhnpj8u9en49meskq8x08czk5axrh4cju64fvpcfenrfupp5mry0wp96a' +
  '3zrhg8hz9g9sa2jjcy3v3ay9rgy32pwu509mf9g0ryqsp5uc9sqgscagql5f8mxp89hfcx5ud2rj4mfdfx2czhnerzssstdt' +
  'xq9qyysgqcqzp2xqyz5vqzkrn2hnh7yxkughlthkh4gsjq5revfrs3uwcw000cawlygykw2jz7vh2ghd0y6366g62csjlggh' +
  'fr0lkqeqnx2ec9sgc0vplxhdtsmsqjztn4e'

// "eSIM Top-up - Order 3952a0e2-c735-4458-a14a-d23cdc3905f9"
const TOPUP_BOLT11 =
  'lnbc23990n1p4g7hx4dz6v4f5jnfq23hhqtt4wqsz6gz0wfjx2u3qxvun2vnpxpjnyttrxuen2tf5xs6nsttpxy6xzttyxge' +
  'kxerrxvunqdtx8ynp4qtyjfy99jhnpj8u9en49meskq8x08czk5axrh4cju64fvpcfenrfupp5us0h6nz0zg7x3j84a86u5y' +
  '84n42eqxmyvgk3w5jna2gprary983qsp5axswsddel2fa923tnv06t5pnqfacfc2fdvcf6zy0zmvyac2lddnq9qyysgqcqzp' +
  '2xqyz5vqgwzv8msnjtm65ke3edear33l5r9v5q406t9agmne5pth5r2fc6pyn78gfdu6ncwv08nnzcnlvtgs4ka2n24ffnvy' +
  'xgdzvdvu6spwwmcqx2vwrk'

const LOST_CHECKOUT_ID = 'bdb50572-880a-45fb-85ca-b6a5b96bc3a9'
const LOST_PAYMENT_HASH = '6a6e7496f508804384b22b50b0ca1e74174acd5259bfc138e4f6433f7af34b1f'

/** The transaction exactly as the wallet stored it, payment hash and all. */
const lostTx = (over = {}) => ({
  id: '01a03fb0-9267-7b62-91fd-fa3e4f4595fb',
  type: 'outgoing',
  status: 'completed',
  amount: 2418,
  timestamp: 1787774933,
  paymentHash: null,
  bolt11: LOST_ESIM_BOLT11,
  ...over,
})

async function run() {
  // ── invoice recognition ──────────────────────────────────────────────────

  await test('recovers the real lost eSIM payment from its invoice alone', () => {
    const parsed = parseNadanadaInvoice(LOST_ESIM_BOLT11)
    assert.equal(parsed.kind, ORDER_KIND.ESIM)
    assert.equal(parsed.checkoutId, LOST_CHECKOUT_ID)
    // The wallet stored no payment hash; the invoice carries it regardless.
    assert.equal(parsed.paymentHash, LOST_PAYMENT_HASH)
    assert.equal(parsed.amountSats, 2407)
    assert.equal(parsed.expiresAt, '2026-08-27T20:08:50.000Z')
  })

  await test('ignores anything that is not a nadanada purchase', () => {
    assert.equal(parseNadanadaInvoice(''), null)
    assert.equal(parseNadanadaInvoice(null), null)
    assert.equal(parseNadanadaInvoice('not-an-invoice'), null)
    assert.equal(parseNadanadaInvoice('lnbc1notrealeither'), null)
  })

  await test('a lightning: prefix does not defeat recognition', () => {
    const parsed = parseNadanadaInvoice(`lightning:${LOST_ESIM_BOLT11.toUpperCase()}`)
    assert.equal(parsed?.checkoutId, LOST_CHECKOUT_ID)
  })

  // ── which payments count ─────────────────────────────────────────────────

  await test('finds an orphan the ledger has never seen', () => {
    const found = findOrphanPayments([lostTx()], [])
    assert.equal(found.length, 1)
    assert.equal(found[0].checkoutId, LOST_CHECKOUT_ID)
    assert.equal(found[0].priceSats, 2418, 'the amount charged, fee included')
    assert.equal(found[0].paidAt, 1787774933000)
  })

  await test('never offers a purchase that is already recorded', () => {
    // Matched on either key, because a recovered order carries both.
    assert.equal(findOrphanPayments([lostTx()], [{ checkoutId: LOST_CHECKOUT_ID }]).length, 0)
    assert.equal(findOrphanPayments([lostTx()], [{ paymentHash: LOST_PAYMENT_HASH }]).length, 0)
    assert.equal(
      findOrphanPayments([lostTx()], [{ checkoutId: LOST_CHECKOUT_ID.toUpperCase() }]).length,
      0,
      'key comparison is case-insensitive',
    )
  })

  await test('the same invoice seen in two wallets is offered once', () => {
    const found = findOrphanPayments([lostTx({ id: 'a' }), lostTx({ id: 'b' })], [])
    assert.equal(found.length, 1)
  })

  await test('only settled outgoing payments are offered', () => {
    // A failed payment imported as a claim would sit on the user's list for
    // ever, because there is nothing at the provider to redeem.
    assert.equal(findOrphanPayments([lostTx({ status: 'failed' })], []).length, 0)
    assert.equal(findOrphanPayments([lostTx({ status: 'pending' })], []).length, 0)
    assert.equal(findOrphanPayments([lostTx({ type: 'incoming' })], []).length, 0)
    // Providers spell success differently; all of these mean the sats left.
    for (const status of ['completed', 'complete', 'settled', 'success', 'paid']) {
      assert.equal(findOrphanPayments([lostTx({ status })], []).length, 1, status)
    }
  })

  await test('newest first, so the payment someone is looking for is on top', () => {
    const found = findOrphanPayments([
      lostTx({ id: 'old', timestamp: 1000 }),
      lostTx({ id: 'new', timestamp: 2000, bolt11: VPN_BOLT11 }),
    ], [])
    assert.equal(found.length, 2)
    assert.equal(found[0].kind, ORDER_KIND.VPN, 'the newer payment leads')
    assert.equal(found[1].kind, ORDER_KIND.ESIM)
  })

  await test('tells the three product kinds apart by their invoice description', () => {
    // All three patterns captured live from nadanada, 2026-08-26.
    assert.equal(parseNadanadaInvoice(LOST_ESIM_BOLT11).kind, ORDER_KIND.ESIM)
    assert.equal(parseNadanadaInvoice(TOPUP_BOLT11).kind, ORDER_KIND.ESIM_TOPUP)
    assert.equal(parseNadanadaInvoice(VPN_BOLT11).kind, ORDER_KIND.VPN)

    assert.equal(parseNadanadaInvoice(TOPUP_BOLT11).checkoutId, '3952a0e2-c735-4458-a14a-d23cdc3905f9')
    assert.equal(parseNadanadaInvoice(VPN_BOLT11).checkoutId, 'cfeb5868-60a4-43a5-b07c-f990350f737c')
  })

  // ── what still needs the user ────────────────────────────────────────────

  await test('an eSIM purchase needs nothing from the user', () => {
    const [c] = findOrphanPayments([lostTx()], [])
    assert.equal(missingDetailFor(c, { esims: [] }), null)
  })

  await test('a VPN needs a location, because it never had one', () => {
    // /vpn/request takes no country: the server is only chosen at config time,
    // so this is a choice the order never made, not one the user must recall.
    assert.equal(missingDetailFor({ kind: ORDER_KIND.VPN }, { esims: [] }), 'vpn_location')
  })

  await test('a top-up only needs an eSIM named when it is ambiguous', () => {
    const one = [{ iccid: '8944' }]
    const two = [{ iccid: '8944' }, { iccid: '8945' }]
    assert.equal(missingDetailFor({ kind: ORDER_KIND.ESIM_TOPUP }, { esims: one }), null)
    assert.equal(missingDetailFor({ kind: ORDER_KIND.ESIM_TOPUP }, { esims: two }), 'esim_target')
    assert.equal(missingDetailFor({ kind: ORDER_KIND.ESIM_TOPUP }, { esims: [] }), 'esim_target')
  })

  // ── the record that gets written ─────────────────────────────────────────

  await test('a recovered order goes in paid, with both redemption keys', () => {
    const [c] = findOrphanPayments([lostTx()], [])
    const fields = candidateOrderFields(c, { title: 'Germany' })
    assert.equal(fields.state, ORDER_STATE.PAID, 'the wallet history is the proof')
    assert.equal(fields.checkoutId, LOST_CHECKOUT_ID)
    assert.equal(fields.paymentHash, LOST_PAYMENT_HASH)
    assert.equal(fields.paymentAttempted, true, 'so nothing can discard it')
    assert.equal(fields.recovered, true)
    assert.equal(fields.priceSats, 2418)
    assert.equal(fields.paidAt, 1787774933000, 'the original payment time, not now')
    assert.equal(fields.title, 'Germany')
    assert.ok(fields.id)
  })

  // ── reading the wallets ──────────────────────────────────────────────────

  await test('one broken wallet does not stop the others being searched', () => {
    // The payment could be in any of them, so a single failure must not end
    // the search.
    return collectOutgoingPayments({
      wallets: [{ id: 'a', type: 'spark' }, { id: 'b', type: 'lnbits' }, { id: 'c' }],
      providers: {
        a: { getTransactions: async () => { throw new Error('offline') } },
        b: { getTransactions: async () => [lostTx()] },
        // c has no provider at all (never connected)
      },
      normalize: (raw) => raw,
    }).then((res) => {
      assert.equal(res.scannedWallets, 1)
      assert.equal(res.failedWallets, 1)
      assert.equal(res.transactions.length, 1)
      assert.equal(res.transactions[0].walletId, 'b', 'rows are tagged with their wallet')
    })
  })

  await test('handles both provider return shapes', async () => {
    const res = await collectOutgoingPayments({
      wallets: [{ id: 'a' }, { id: 'b' }],
      providers: {
        a: { getTransactions: async () => [lostTx({ id: '1' })] },
        b: { getTransactions: async () => ({ transactions: [lostTx({ id: '2' })] }) },
      },
      normalize: (raw) => raw,
    })
    assert.equal(res.transactions.length, 2)
    assert.equal(res.scannedWallets, 2)
  })

  await test('end to end: a lost payment becomes a redeemable order', async () => {
    const { transactions } = await collectOutgoingPayments({
      wallets: [{ id: 'spark-1', type: 'spark', name: 'Personal' }],
      providers: { 'spark-1': { getTransactions: async () => [lostTx()] } },
      normalize: (raw) => raw,
    })
    const [candidate] = findOrphanPayments(transactions, [])
    const order = candidateOrderFields(candidate, { title: '🇩🇪 Germany' })

    assert.equal(order.walletId, 'spark-1')
    assert.equal(order.walletName, 'Personal')
    assert.equal(order.kind, ORDER_KIND.ESIM)
    // Everything redeemOrder needs is present.
    assert.ok(order.paymentHash || order.checkoutId)
  })

  // ── the shop is native-only ──────────────────────────────────────────────

  await test('no invoice can be created outside the app', async () => {
    // nadanada's API is unreachable from a browser (no CORS headers), so a web
    // build could only ever be a half-working shop. Every money exit refuses
    // rather than letting a user start a purchase that cannot complete.
    // Node counts as non-native, which is what this asserts against.
    const esim = await import('../esim.js')
    const vpn = await import('../vpn.js')
    const exits = [
      ['purchaseEsim', () => esim.purchaseEsim({ bundleName: 'fixed_1GB_7D_DE', slug: 'germany' })],
      ['purchaseEsimTopup', () => esim.purchaseEsimTopup({ iccid: '8944', bundleName: 'x', slug: 'y' })],
      ['requestVpn', () => vpn.requestVpn({ duration: 3 })],
      ['requestVpnExtension', () => vpn.requestVpnExtension({ publicKey: 'k', duration: 3 })],
    ]
    for (const [name, call] of exits) {
      await assert.rejects(call(), (e) => e.code === 'NATIVE_ONLY', `${name} must refuse`)
    }
    assert.throws(() => assertNativePurchase(), (e) => e.fatal === true)
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

run()
