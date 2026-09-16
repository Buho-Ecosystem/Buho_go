/**
 * Order ledger — the invariants that keep a paid purchase recoverable.
 *
 * These are the rules that were missing when a paid eSIM went undelivered and
 * became unrecoverable: an order must carry a redemption key, must survive
 * anything short of an uninstall, and must never be deletable while the user is
 * still owed something.
 *
 * Run directly with Node:
 *   node src/services/nadanada/__tests__/orders.spec.js
 */

import { strict as assert } from 'node:assert'
import {
  ORDER_STATE,
  ORDER_KIND,
  newOrderId,
  isPending,
  needsAttention,
  isUnconfirmed,
  isRedeemable,
  isDefinitivelyUnpaid,
  invoiceDeadline,
  orderReference,
  orderReceiptText,
  redeemOrder,
  redeemAll,
} from '../orders.js'

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

// A minimal localStorage so the Pinia store can be exercised under Node.
function installStorage(seed = {}) {
  const data = { ...seed }
  globalThis.localStorage = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: (k) => { delete data[k] },
    clear: () => { for (const k of Object.keys(data)) delete data[k] },
  }
  return data
}

async function freshStore(seed) {
  installStorage(seed)
  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())
  // Bust the module cache so `load()` re-reads the seeded storage each time.
  const mod = await import(`../../../stores/nadanadaOrders.js?t=${newOrderId()}`)
  return mod.useNadanadaOrdersStore()
}

async function run() {
  // ── pure helpers ─────────────────────────────────────────────────────────

  await test('order ids are unique', () => {
    const seen = new Set()
    for (let i = 0; i < 500; i += 1) seen.add(newOrderId())
    assert.equal(seen.size, 500)
  })

  await test('a paid order needs attention, a delivered one does not', () => {
    assert.equal(isPending({ state: ORDER_STATE.PAID }), true)
    assert.equal(isPending({ state: ORDER_STATE.FULFILLED }), false)
    assert.equal(needsAttention({ state: ORDER_STATE.PAID }), true)
    assert.equal(needsAttention({ state: ORDER_STATE.FAILED }), true)
    assert.equal(needsAttention({ state: ORDER_STATE.FULFILLED }), false)
    assert.equal(needsAttention({ state: ORDER_STATE.AWAITING_PAYMENT }), false)
  })

  await test('invoiceDeadline only accepts a real timestamp', () => {
    const iso = '2026-08-27T20:27:11.252Z'
    assert.equal(invoiceDeadline({ expiresAt: iso }), Date.parse(iso))
    assert.equal(invoiceDeadline({ expiresAt: 'not a date' }), undefined)
    assert.equal(invoiceDeadline({}), undefined)
    assert.equal(invoiceDeadline(null), undefined)
  })

  await test('the reference prefers the provider order id, then a payment key', () => {
    assert.equal(orderReference({ orderReference: 'NN-123', paymentHash: 'abcdef0123456789' }), 'NN-123')
    assert.equal(orderReference({ paymentHash: 'abcdef0123456789ff' }), 'abcdef012345')
    assert.equal(orderReference({ checkoutId: '5acf0e61-8e37-473d-a65b-46b328901392' }), '5acf0e61-8e3')
    assert.equal(orderReference({}), '')
  })

  await test('the receipt carries every key support could need', () => {
    const text = orderReceiptText({
      kind: ORDER_KIND.ESIM,
      title: '🇩🇪 Germany',
      paymentHash: 'a1f08e7c',
      checkoutId: '5acf0e61',
      iccid: '8944',
      priceSats: 2411,
      paidAt: 1787869631252,
    })
    assert.match(text, /Payment hash: a1f08e7c/)
    assert.match(text, /Checkout ID: 5acf0e61/)
    assert.match(text, /ICCID: 8944/)
    assert.match(text, /2411 sats/)
    assert.equal(orderReceiptText(null), '')
  })

  // ── redeem contract ──────────────────────────────────────────────────────

  await test('an order with no redemption key is terminal, not retried forever', async () => {
    const res = await redeemOrder({ kind: ORDER_KIND.ESIM })
    assert.equal(res.ok, false)
    assert.equal(res.fatal, true)
    assert.match(res.error, /payment reference/)
  })

  await test('an unknown order type fails loudly rather than hanging', async () => {
    const res = await redeemOrder({ kind: 'mystery_box', paymentHash: 'abc' })
    assert.equal(res.fatal, true)
    assert.match(res.error, /Unknown order type/)
  })

  await test('redeemAll marks terminal failures and counts the rest', async () => {
    const applied = []
    const out = await redeemAll(
      [{ id: 'a', kind: ORDER_KIND.ESIM }, { id: 'b', kind: 'mystery_box', paymentHash: 'x' }],
      (id, patch) => applied.push([id, patch.state]),
    )
    assert.equal(out.failed, 2)
    assert.equal(out.fulfilled, 0)
    assert.deepEqual(applied, [['a', ORDER_STATE.FAILED], ['b', ORDER_STATE.FAILED]])
  })

  // ── store invariants ─────────────────────────────────────────────────────

  await test('an order is on disk the moment it is created, before any payment', async () => {
    const store = await freshStore()
    const order = store.createOrder({ kind: ORDER_KIND.ESIM, paymentHash: 'hash1', title: 'Germany' })
    assert.equal(order.state, ORDER_STATE.AWAITING_PAYMENT)
    const raw = JSON.parse(globalThis.localStorage.getItem('buhoGO_nadanada_orders_v2'))
    assert.equal(raw.orders.length, 1)
    assert.equal(raw.orders[0].paymentHash, 'hash1')
  })

  await test('a paid order cannot be deleted', async () => {
    // Deleting it would destroy the only thing that can still redeem the money.
    const store = await freshStore()
    const o = store.createOrder({ kind: ORDER_KIND.ESIM, paymentHash: 'h' })
    store.markPaid(o.id, { walletId: 'w1', priceSats: 2411 })
    store.removeOrder(o.id)
    assert.equal(store.orders.length, 1, 'a paid order must survive a remove')
    assert.equal(store.orderById(o.id).priceSats, 2411)

    store.patchOrder(o.id, { state: ORDER_STATE.FULFILLED, iccid: '8944' })
    store.removeOrder(o.id)
    assert.equal(store.orders.length, 0, 'a delivered order may be removed')
  })

  await test('discardUnpaid only drops orders nothing was spent on', async () => {
    const store = await freshStore()
    const unpaid = store.createOrder({ kind: ORDER_KIND.ESIM, paymentHash: 'h1' })
    const paid = store.createOrder({ kind: ORDER_KIND.ESIM, paymentHash: 'h2' })
    store.markPaid(paid.id)

    store.discardUnpaid(unpaid.id)
    store.discardUnpaid(paid.id)
    assert.equal(store.orders.length, 1)
    assert.equal(store.orders[0].id, paid.id)
  })

  await test('anything still owed sorts above delivered products', async () => {
    const store = await freshStore()
    const done = store.createOrder({ kind: ORDER_KIND.ESIM, paymentHash: 'h1' })
    store.patchOrder(done.id, { state: ORDER_STATE.FULFILLED, iccid: '1' })
    const stuck = store.createOrder({ kind: ORDER_KIND.ESIM, paymentHash: 'h2' })
    store.markPaid(stuck.id)

    assert.equal(store.allOrders[0].id, stuck.id)
    assert.equal(store.attentionCount, 1)
    assert.equal(store.pendingOrders.length, 1)
    assert.equal(store.esims.length, 1)
  })

  await test('pre-ledger purchases migrate in as already delivered', async () => {
    const store = await freshStore({
      buhoGO_nadanada_purchases_v1: JSON.stringify({
        esims: [{ iccid: '8944', countryName: 'Germany', flag: '🇩🇪', slug: 'germany', planLabel: '1 GB · 7 days', purchasedAt: 1787000000000, installation: { qrCode: 'LPA:1$x$y' } }],
        vpns: [{ publicKey: 'PUBKEY', privateKey: 'PRIV', config: '[Interface]', countryName: 'Netherlands', purchasedAt: 1787000000000 }],
      }),
    })
    assert.equal(store.orders.length, 2)
    assert.equal(store.esims.length, 1)
    assert.equal(store.vpns.length, 1)
    assert.equal(store.attentionCount, 0, 'migrated purchases are finished, not owed')
    assert.equal(store.esims[0].installation.qrCode, 'LPA:1$x$y')
    assert.equal(store.recentDestinations[0].slug, 'germany')
  })

  await test('the migration runs once and never resurrects removed products', async () => {
    const seed = {
      buhoGO_nadanada_purchases_v1: JSON.stringify({
        esims: [{ iccid: '8944', countryName: 'Germany', purchasedAt: 1 }],
        vpns: [],
      }),
    }
    installStorage(seed)
    const { createPinia, setActivePinia } = await import('pinia')

    setActivePinia(createPinia())
    const first = (await import(`../../../stores/nadanadaOrders.js?t=${newOrderId()}`)).useNadanadaOrdersStore()
    first.removeOrder(first.orders[0].id)
    assert.equal(first.orders.length, 0)

    setActivePinia(createPinia())
    const second = (await import(`../../../stores/nadanadaOrders.js?t=${newOrderId()}`)).useNadanadaOrdersStore()
    assert.equal(second.orders.length, 0, 'the legacy blob must not re-import')
  })

  await test('a payment the wallet errored on stays a claim, not junk', async () => {
    // The wallet throwing does not prove the sats stayed put. Treating that as
    // "nothing happened" and deleting the order is how a settled-but-errored
    // payment becomes unrecoverable.
    const attempted = { state: ORDER_STATE.AWAITING_PAYMENT, paymentAttempted: true }
    assert.equal(isUnconfirmed(attempted), true)
    assert.equal(isRedeemable(attempted), true)
    assert.equal(needsAttention(attempted), true)

    const untouched = { state: ORDER_STATE.AWAITING_PAYMENT }
    assert.equal(isUnconfirmed(untouched), false)
    assert.equal(needsAttention(untouched), false)
  })

  await test('an order is only written off once its invoice has provably lapsed', () => {
    const now = Date.parse('2026-08-26T12:00:00Z')
    const future = new Date(now + 3600_000).toISOString()
    const past = new Date(now - 3600_000).toISOString()
    // Still payable: never assume.
    assert.equal(isDefinitivelyUnpaid({ state: ORDER_STATE.AWAITING_PAYMENT, expiresAt: future }, now), false)
    // No expiry to reason from: never assume either.
    assert.equal(isDefinitivelyUnpaid({ state: ORDER_STATE.AWAITING_PAYMENT }, now), false)
    // Lapsed: a Lightning invoice cannot settle after expiry, so this is safe.
    assert.equal(isDefinitivelyUnpaid({ state: ORDER_STATE.AWAITING_PAYMENT, expiresAt: past }, now), true)
    // A paid order is never written off, expired invoice or not.
    assert.equal(isDefinitivelyUnpaid({ state: ORDER_STATE.PAID, expiresAt: past }, now), false)
  })

  await test('an order whose payment is in flight cannot be discarded', async () => {
    // Dismissing the sheet mid-send must not delete the keys for a payment
    // that is about to leave the wallet.
    const store = await freshStore()
    const o = store.createOrder({ kind: ORDER_KIND.ESIM, paymentHash: 'h' })
    store.markPaymentAttempted(o.id)

    store.discardUnpaid(o.id)
    assert.equal(store.orders.length, 1, 'an attempted payment must survive a dismiss')
    assert.equal(store.attentionCount, 1, 'and must be visible to the user')
    assert.equal(store.pendingOrders.length, 1, 'and must still be retried')

    store.removeOrder(o.id)
    assert.equal(store.orders.length, 1, 'nor can it be deleted by hand')
  })

  await test('pruning clears only lapsed unpaid orders', async () => {
    const store = await freshStore()
    const lapsed = store.createOrder({ kind: ORDER_KIND.ESIM, paymentHash: 'h1', expiresAt: new Date(Date.now() - 1000).toISOString() })
    const live = store.createOrder({ kind: ORDER_KIND.ESIM, paymentHash: 'h2', expiresAt: new Date(Date.now() + 60000).toISOString() })
    const paid = store.createOrder({ kind: ORDER_KIND.ESIM, paymentHash: 'h3', expiresAt: new Date(Date.now() - 1000).toISOString() })
    store.markPaid(paid.id)

    store.pruneSettledUnpaid()
    const ids = store.orders.map((o) => o.id)
    assert.ok(!ids.includes(lapsed.id), 'a lapsed unpaid invoice is dead and goes')
    assert.ok(ids.includes(live.id), 'a still-payable invoice stays')
    assert.ok(ids.includes(paid.id), 'a paid order stays regardless of invoice expiry')
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

run()
