import { defineStore } from 'pinia'
import {
  ORDER_STATE, ORDER_KIND, newOrderId, isRedeemable, needsAttention, isDefinitivelyUnpaid,
} from '../services/nadanada/orders.js'

/**
 * nadanada order ledger.
 *
 * nadanada sells with no accounts, so this device-local record is the ONLY
 * proof a user has of anything they bought: the redemption keys, the eSIM
 * install codes, and the WireGuard config including its locally generated
 * private key.
 *
 * The ledger holds ORDERS, not products, and an order is written the moment an
 * invoice is created — before any money moves. That ordering is the whole
 * point: everything after "create invoice" (paying, polling, the app being
 * killed, the phone dying) can then fail without stranding a payment, because
 * the keys that redeem it are already on disk.
 *
 * A finished product is simply an order in the `fulfilled` state carrying its
 * payload, so one list covers "my eSIMs" and "the one I paid for that hasn't
 * arrived" without a second bookkeeping system to drift out of sync.
 *
 * Persisted synchronously to localStorage, matching the other lightweight
 * stores (mapFavorites, bitcoinPreferences). Survives across sessions; lost on
 * uninstall — which is why the receipt is also surfaced in the UI for copying.
 */
const STORAGE_KEY = 'buhoGO_nadanada_orders_v2'
const LEGACY_KEY = 'buhoGO_nadanada_purchases_v1'
const MIGRATED_FLAG = 'buhoGO_nadanada_migrated_v2'

/**
 * Import the pre-ledger store shape, where only completed products were kept.
 * Those records have no payment keys (that was the bug), so they come across
 * as already-fulfilled orders and can never be re-redeemed — which is correct,
 * they already were. The legacy key is left in place rather than deleted; it
 * costs nothing and is the only backstop if this migration is ever wrong.
 */
function migrateLegacy() {
  const out = []
  try {
    if (localStorage.getItem(MIGRATED_FLAG) === '1') return out
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return out
    const obj = JSON.parse(raw)
    for (const e of Array.isArray(obj?.esims) ? obj.esims : []) {
      if (!e?.iccid) continue
      out.push({
        id: newOrderId(),
        kind: ORDER_KIND.ESIM,
        state: ORDER_STATE.FULFILLED,
        createdAt: e.purchasedAt || Date.now(),
        paidAt: e.purchasedAt || null,
        fulfilledAt: e.purchasedAt || null,
        paymentHash: null,
        checkoutId: null,
        title: [e.flag, e.countryName].filter(Boolean).join(' ').trim(),
        meta: e.planLabel || '',
        countryName: e.countryName || '',
        flag: e.flag || '',
        slug: e.slug || '',
        bundleName: e.bundleName || '',
        dataInGB: e.dataInGB ?? null,
        durationInDays: e.durationInDays ?? null,
        priceUsd: e.priceUsd ?? null,
        priceSats: null,
        iccid: e.iccid,
        orderReference: e.orderReference || '',
        installation: e.installation || {},
      })
    }
    for (const v of Array.isArray(obj?.vpns) ? obj.vpns : []) {
      if (!v?.publicKey) continue
      out.push({
        id: newOrderId(),
        kind: ORDER_KIND.VPN,
        state: ORDER_STATE.FULFILLED,
        createdAt: v.purchasedAt || Date.now(),
        paidAt: v.purchasedAt || null,
        fulfilledAt: v.purchasedAt || null,
        paymentHash: null,
        checkoutId: null,
        title: [v.flag, v.countryName].filter(Boolean).join(' ').trim(),
        meta: v.durationLabel || '',
        countryName: v.countryName || '',
        flag: v.flag || '',
        country: v.country != null ? String(v.country) : '',
        durationLabel: v.durationLabel || '',
        priceUsd: v.priceUsd ?? null,
        priceSats: null,
        publicKey: v.publicKey,
        privateKey: v.privateKey || '',
        presharedKey: v.presharedKey || '',
        config: v.config || '',
      })
    }
    localStorage.setItem(MIGRATED_FLAG, '1')
  } catch {
    // A malformed legacy blob must never block the store from loading.
  }
  return out
}

function load() {
  let orders = []
  let recoveryScannedAt = null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const obj = raw ? JSON.parse(raw) : null
    orders = Array.isArray(obj?.orders) ? obj.orders : []
    recoveryScannedAt = Number.isFinite(obj?.recoveryScannedAt) ? obj.recoveryScannedAt : null
  } catch {
    orders = []
  }
  if (!orders.length) {
    const legacy = migrateLegacy()
    if (legacy.length) orders = legacy
  }
  return { orders, recoveryScannedAt }
}

/** Newest first, but anything still owed to the user floats to the very top. */
function byUrgencyThenDate(a, b) {
  const rank = (o) => {
    if (o.state === ORDER_STATE.PAID) return 0
    if (isRedeemable(o)) return 1
    if (o.state === ORDER_STATE.FAILED) return 2
    return 3
  }
  const r = rank(a) - rank(b)
  if (r !== 0) return r
  return (b.createdAt || 0) - (a.createdAt || 0)
}

export const useNadanadaOrdersStore = defineStore('nadanadaOrders', {
  state: () => {
    const persisted = load()
    return {
      orders: persisted.orders,
      /**
       * When the wallet history was last searched for purchases made before
       * this ledger existed. Null means never: the one time it matters, the
       * app looks by itself rather than waiting for the user to discover a
       * feature they should never have needed. See services/nadanada/recovery.js.
       */
      recoveryScannedAt: persisted.recoveryScannedAt,
    }
  },

  getters: {
    /** Everything, urgent first. */
    allOrders: (state) => [...state.orders].sort(byUrgencyThenDate),

    /**
     * Worth asking the provider about again: paid-but-undelivered, plus orders
     * whose payment errored in the wallet and therefore might have gone through
     * anyway. Asking is free and idempotent; assuming is not.
     */
    pendingOrders: (state) => state.orders.filter(isRedeemable).sort(byUrgencyThenDate),

    /** Terminally failed. Not redeemable; the user needs the receipt. */
    failedOrders: (state) =>
      state.orders.filter((o) => o.state === ORDER_STATE.FAILED).sort(byUrgencyThenDate),

    /** Anything the user is still owed, or owed an explanation for. */
    attentionOrders: (state) => state.orders.filter(needsAttention).sort(byUrgencyThenDate),

    attentionCount() {
      return this.attentionOrders.length
    },

    /** Delivered eSIMs. Top-ups fold into their target eSIM, so they are not
     *  listed as products of their own. */
    esims: (state) =>
      state.orders
        .filter((o) => o.kind === ORDER_KIND.ESIM && o.state === ORDER_STATE.FULFILLED && o.iccid)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),

    /** Delivered VPN subscriptions. Extensions fold into their subscription. */
    vpns: (state) =>
      state.orders
        .filter((o) => o.kind === ORDER_KIND.VPN && o.state === ORDER_STATE.FULFILLED && o.publicKey)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),

    productCount() {
      return this.esims.length + this.vpns.length
    },

    /** What the entry-point badge counts: delivered products plus anything
     *  still owed. */
    totalCount() {
      return this.productCount + this.attentionCount
    },

    hasAnything: (state) => state.orders.length > 0,

    /** Predicate so templates can ask `hasEsim(iccid)`. */
    hasEsim: (state) => (iccid) =>
      state.orders.some((o) => o.iccid === iccid && o.state === ORDER_STATE.FULFILLED),

    orderById: (state) => (id) => state.orders.find((o) => o.id === id) || null,

    /** Destinations bought before, for the shop's "recent" row. */
    recentDestinations: (state) => {
      const seen = new Set()
      const out = []
      for (const o of state.orders) {
        if (o.kind !== ORDER_KIND.ESIM || !o.slug || seen.has(o.slug)) continue
        seen.add(o.slug)
        out.push({ slug: o.slug, name: o.countryName || o.slug, flag: o.flag || '' })
        if (out.length >= 5) break
      }
      return out
    },
  },

  actions: {
    /**
     * Record a new order. Called the instant an invoice exists and BEFORE the
     * user is given anything to pay, so no payment can outrun its own receipt.
     *
     * @param {object} fields — kind, title, meta, the invoice, and whatever
     *   product context the success screen will need later.
     * @returns {object} the stored order
     */
    createOrder(fields = {}) {
      const order = {
        id: newOrderId(),
        state: ORDER_STATE.AWAITING_PAYMENT,
        createdAt: Date.now(),
        paidAt: null,
        fulfilledAt: null,
        attempts: 0,
        lastError: null,
        lastErrorCode: null,
        lastTriedAt: null,
        ...fields,
      }
      this.orders.unshift(order)
      this._persist()
      return order
    },

    /**
     * The payment left the wallet. Recorded before fulfilment is even
     * attempted, so a crash in between leaves a recoverable record rather than
     * a hole.
     */
    markPaid(id, { walletId = null, walletName = '', priceSats = null } = {}) {
      this.patchOrder(id, {
        state: ORDER_STATE.PAID,
        paidAt: Date.now(),
        walletId,
        walletName,
        ...(Number.isFinite(priceSats) ? { priceSats } : {}),
      })
    },

    /** Merge a partial update into one order. */
    patchOrder(id, patch) {
      if (!id || !patch) return
      const i = this.orders.findIndex((o) => o.id === id)
      if (i < 0) return
      this.orders.splice(i, 1, { ...this.orders[i], ...patch })
      this._persist()
    },

    /** Terminal failure: the API told us this order can never complete. */
    markFailed(id, { error = '', code = null } = {}) {
      this.patchOrder(id, { state: ORDER_STATE.FAILED, lastError: error, lastErrorCode: code })
    },

    /** Cache the latest live status for a delivered product. */
    cacheLive(id, live) {
      this.patchOrder(id, { live, liveFetchedAt: Date.now() })
    },

    /** Record that a payment has been handed to a wallet. Set BEFORE the send,
     *  so an order can never be discarded while its payment is in flight. */
    markPaymentAttempted(id) {
      this.patchOrder(id, {
        paymentAttempted: true,
        attempts: (this.orderById(id)?.attempts || 0) + 1,
        lastTriedAt: Date.now(),
      })
    },

    /**
     * Drop an order from the ledger. Refused while the user is still owed
     * something: a paid or unconfirmed order's keys are the only claim they
     * have, and deleting them is irreversible.
     */
    removeOrder(id) {
      const i = this.orders.findIndex((o) => o.id === id)
      if (i < 0) return
      if (isRedeemable(this.orders[i])) return
      this.orders.splice(i, 1)
      this._persist()
    },

    /**
     * Abandon an order the user closed without ever attempting to pay.
     * Nothing was spent, so there is nothing to keep. An order whose payment
     * was attempted is never dropped here, however it ended: only an expired
     * invoice proves no money moved (see pruneSettledUnpaid).
     */
    discardUnpaid(id) {
      const i = this.orders.findIndex((o) => o.id === id)
      if (i < 0) return
      const o = this.orders[i]
      if (o.state !== ORDER_STATE.AWAITING_PAYMENT || o.paymentAttempted) return
      this.orders.splice(i, 1)
      this._persist()
    },

    /**
     * Clear unpaid orders whose invoice has expired. A Lightning invoice cannot
     * settle after it lapses, so at that point "we never confirmed it" becomes
     * "it definitively took no money" and the row stops being useful.
     */
    pruneSettledUnpaid() {
      const before = this.orders.length
      this.orders = this.orders.filter((o) => !isDefinitivelyUnpaid(o))
      if (this.orders.length !== before) this._persist()
    },

    /** Remember that the wallet history has been searched, so it is not
     *  re-read on every visit. */
    markRecoveryScanned() {
      this.recoveryScannedAt = Date.now()
      this._persist()
    },

    _persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          orders: this.orders,
          recoveryScannedAt: this.recoveryScannedAt,
        }))
      } catch {
        // Quota / unavailable storage: keep the in-memory copy for the session.
        // The receipt is also shown in the UI precisely for this case.
      }
    },
  },
})
