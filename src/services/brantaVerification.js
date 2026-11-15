/**
 * Merchant verification (Branta) for the payment on the confirm sheet.
 *
 * Two layers, both free of the page:
 *   - createBrantaVerification: one lookup session for one payment request.
 *   - createBrantaReview: what the sheet needs around that session: which
 *     destination is actually being paid, the check shown for it, the
 *     business the person accepted when they confirmed, and the guard that
 *     stops a send whose prepared route no longer is that destination.
 *
 * The page supplies live facts through a small `host` and reads the result
 * from `payment.branta`; it holds no verification state of its own.
 */
import {
  BRANTA_ENVIRONMENT, BRANTA_STATUS, BRANTA_HOLD_MS, BRANTA_LOOKUP_TIMEOUT_MS, BRANTA_MAX_AGE_MS,
  brantaIdentityKey, brantaLookupText, brantaReceiptOf, checkWithBranta, normalizeBrantaResult, sameBrantaDestination,
} from '../utils/branta.js'
import { parseBip21 } from '../utils/bip21.js'
import { shallowRef } from 'vue'

/** A send stopped before any debit so the person can look at the sheet again. */
export const PAYMENT_REVIEW_REQUIRED = 'PAYMENT_REVIEW_REQUIRED'

/** The one key a shown check belongs to: what was asked, and the destination it was bound to. */
export const brantaBindingKey = (context, target) => JSON.stringify([context, target?.kind || '', target?.value || ''])

/** One original payment request; changing its selected route never clears a tamper result. */
export function createBrantaVerification({
  verify = checkWithBranta, environment = BRANTA_ENVIRONMENT, now = Date.now,
  holdMs = BRANTA_HOLD_MS, timeoutMs = BRANTA_LOOKUP_TIMEOUT_MS, onChange = () => {},
} = {}) {
  let generation = 0, binding = 0, original = '', startedAt = 0, controller, deadline, releaseCancel, task
  let raw = null, pending = false, tampered = false, settledKey = null, settledView = null, invalidated = false
  let view = { status: BRANTA_STATUS.NONE }
  const publish = value => { view = value; onChange(value); return value }
  function stop() {
    generation += 1; binding += 1
    controller?.abort(); clearTimeout(deadline); releaseCancel?.()
    controller = null; task = null; releaseCancel = null; pending = false
  }
  function start(input, fresh = false) {
    if (original === input && tampered) return
    stop(); original = input; startedAt = now(); raw = null; settledKey = null; settledView = null; invalidated = false
    if (!original) return
    controller = new AbortController()
    const signal = controller.signal, ticket = generation, request = original
    pending = true
    const lookup = Promise.resolve().then(() => verify({ qrText: request, signal, environment, fresh })).then(result => {
      if (ticket !== generation || signal.aborted) return
      raw = { ...result, checkedAt: Number.isFinite(result?.checkedAt) ? result.checkedAt : now() }
      if (result?.status === 'tampered') { tampered = true; publish({ status: BRANTA_STATUS.TAMPERED }) }
    }).catch(() => { if (ticket === generation) raw = { status: 'unknown' } })
    const timeout = new Promise(resolve => {
      deadline = setTimeout(() => {
        if (ticket === generation) { raw = { status: 'unknown' }; controller?.abort() }
        resolve()
      }, timeoutMs)
    })
    const cancelled = new Promise(resolve => { releaseCancel = resolve })
    task = Promise.race([lookup, timeout, cancelled]).then(() => {
      if (ticket === generation) { pending = false; clearTimeout(deadline); releaseCancel = null }
    })
  }
  return {
    start(input) { if (input !== original) { tampered = false; start(input) } },
    cancel() { stop(); original = ''; raw = null; tampered = false; settledKey = null; settledView = null },
    stale() { invalidated = true },
    get tampered() { return tampered },
    get original() { return original },
    async bind(target, context, { refresh = false } = {}) {
      if (tampered) return publish({ status: BRANTA_STATUS.TAMPERED })
      if (!original) return publish({ status: BRANTA_STATUS.NONE })
      const key = brantaBindingKey(context, target)
      const expired = view.verification?.expiresAt && view.verification.expiresAt <= now()
      // What this binding already shows. A recheck keeps it on screen until it knows better.
      const shown = key === settledKey ? settledView : null
      const kept = shown && !expired ? shown : null
      if (refresh && (invalidated || now() - (raw?.checkedAt ?? startedAt) >= BRANTA_MAX_AGE_MS || expired)) start(original, true)
      const ticket = generation, selected = ++binding
      // A late normal response cannot replace the identity already shown for this binding.
      // Returning to a settled route also invalidates any intervening wait.
      if (shown && !refresh) return publish(shown)
      if (pending) {
        if (!kept) publish({ status: BRANTA_STATUS.CHECKING })
        let foreground
        try { await Promise.race([task, new Promise(resolve => { foreground = setTimeout(resolve, holdMs) })]) }
        finally { clearTimeout(foreground) }
      }
      if (ticket !== generation || selected !== binding) return { status: BRANTA_STATUS.NONE }
      settledKey = key
      if (tampered) return publish({ status: BRANTA_STATUS.TAMPERED })
      if (pending) {
        // Still unanswered: a recheck on a slow link is not a lost business.
        settledView = kept || { status: BRANTA_STATUS.NONE }
      } else {
        const verification = normalizeBrantaResult(raw, target, { environment, now: now(), checkedAt: raw?.checkedAt ?? now() })
        settledView = verification ? { status: BRANTA_STATUS.VERIFIED, verification } : { status: BRANTA_STATUS.NONE }
      }
      return publish(settledView)
    },
  }
}

/** A payment's verified business; null while checking, for a miss and when stopped. */
export function brantaVerificationOf(payment) {
  return payment?.branta?.status === BRANTA_STATUS.VERIFIED ? payment.branta.verification : null
}

/**
 * The destination the selected wallet will actually pay, as Branta records it.
 * Spark picks its rail when it prepares the send, so only the `route` it
 * prepared for this payment, wallet, request and amount counts.
 */
export function brantaTargetFor(payment, { walletId = '', walletType = '', amount = 0, route = null } = {}) {
  if (!payment) return null
  if (payment.bitcoinAddress) {
    const bip21 = parseBip21(payment.bitcoinAddress)
    return { kind: 'bitcoin', value: bip21?.address || payment.bitcoinAddress }
  }
  if (payment.arkadeAddress) return { kind: 'arkade', value: payment.arkadeAddress }
  const request = payment.sparkInvoice || payment.sparkAddress || payment.invoice
  if (!request) return null
  if (walletType === 'spark') {
    const prepared = route && route.payment === payment && route.walletId === walletId && route.request === request && route.amount === amount
    return prepared ? route.target : null
  }
  return payment.invoice ? { kind: 'lightning', value: payment.invoice.replace(/^lightning:/i, '') } : null
}

/**
 * The merchant check of the payment on the confirm sheet.
 *
 * `host` gives the live facts, each read when needed:
 *   payment()        the payment on the sheet
 *   busy()           it is being sent, or the page is gone
 *   gone()           the page is gone
 *   enabled()        the person's setting
 *   excluded(p)      payments that are never looked up (own users, till codes)
 *   walletId() / walletType() / amount()   who pays and how much
 *   confirming(v)    told while the check at confirm runs
 *
 * The result lives on the payment: `payment.branta` ({ status, verification })
 * and `payment.brantaMismatch` once a changed code was found. Nothing else
 * is written to it.
 */
export function createBrantaReview(host, { createSession = createBrantaVerification } = {}) {
  let session = null, owner = null, accepted = null, confirming = false
  // The route Spark prepared. Reactive, so the page's watch key follows it,
  // and kept off the payment object: the page re-estimates fees whenever
  // that object changes, and a fresh estimate is what sets this.
  const route = shallowRef(null)
  const { NONE, TAMPERED, VERIFIED } = BRANTA_STATUS
  const facts = () => ({
    walletId: host.walletId() || '', walletType: host.walletType() || '', amount: host.amount() || 0, route: route.value,
  })
  const setRoute = (payment, { walletId, amount, request, target: prepared }) => {
    const next = { payment, walletId: walletId || '', amount: amount || 0, request, target: prepared || null }
    const now = route.value
    const same = now && now.payment === payment && now.walletId === next.walletId && now.amount === next.amount
      && now.request === request && JSON.stringify(now.target) === JSON.stringify(next.target)
    if (!same) route.value = next
  }
  const live = payment => !!payment && payment === host.payment() && !host.busy()
  const applies = payment => !!host.enabled() && !host.excluded(payment)
  const target = payment => brantaTargetFor(payment, facts())
  const context = payment => {
    const { walletId, amount } = facts()
    return JSON.stringify([brantaLookupText(payment), walletId, amount, !!host.enabled()])
  }
  const stopped = payment => { payment.brantaMismatch = true; payment.branta = { status: TAMPERED }; return payment.branta }
  const refuse = (message, reason) => Object.assign(new Error(message), { code: PAYMENT_REVIEW_REQUIRED, reason })

  function dropSession() {
    session?.cancel()
    session = null
    owner = null
  }
  /** The payment was sent, cancelled or replaced: nothing of its check remains. */
  function cancel() {
    dropSession()
    route.value = null
  }

  /** Look the payment up, or rebind the running lookup to what is being paid now. */
  function run(payment, { refresh = false } = {}) {
    if (!live(payment)) return Promise.resolve(null)
    if (payment.brantaMismatch) return Promise.resolve(stopped(payment))
    if (!applies(payment)) {
      if (owner === payment) dropSession()
      if (payment.branta?.status !== NONE) payment.branta = { status: NONE }
      return Promise.resolve(payment.branta)
    }
    const input = brantaLookupText(payment)
    if (!input) return Promise.resolve({ status: NONE })
    if (owner !== payment || session?.original !== input) {
      // A route prepared for this payment before its first lookup still counts.
      dropSession()
      owner = payment
      session = createSession({ onChange: answer => {
        if (!live(payment)) return
        if (answer.status === TAMPERED) payment.brantaMismatch = true
        if (JSON.stringify(payment.branta) !== JSON.stringify(answer)) payment.branta = answer
      } })
      session.start(input)
    }
    return session.bind(target(payment), context(payment), { refresh })
  }

  return {
    run,
    cancel,
    /** The app left the foreground: the next confirm looks the payment up again. */
    stale() { session?.stale() },
    /**
     * Everything a shown check depends on. The page watches this one value
     * and calls run() when it changes: the single trigger for a lookup.
     */
    key(payment) { return payment ? brantaBindingKey(context(payment), target(payment)) : '' },
    /** The destination being checked right now; null when the rail is not known yet. */
    target,
    /** The route Spark prepared for this payment, wallet, request and amount. */
    prepared(payment, prepared) {
      if (payment) setRoute(payment, prepared)
    },
    /** Whether this payment is looked up at all (the setting is on and it is not excluded). */
    checks(payment) { return !!payment && applies(payment) },
    /**
     * Confirm a payment that is not looked up. Synchronous, so the page can
     * take ownership of the send in the same tick as the tap.
     */
    skip(payment) {
      accepted = { payment, verification: null }
      return { ok: true }
    },
    /**
     * The check at the moment of sending, looked up again when it is old.
     *   { ok: true }                         send; the business shown is kept for the receipt
     *   { ok: false, reason: 'changed' }     another business than the one reviewed
     *   { ok: false, reason: 'unavailable' } the reviewed business could not be confirmed again
     *   { ok: false }                        a changed code, or the payment moved on
     * A check that only now finished is no reason to stop: the destination
     * is the one the person confirmed, and the paid screen names the business.
     */
    async accept(payment) {
      if (!payment || confirming || payment.brantaMismatch) return { ok: false }
      if (!applies(payment)) return this.skip(payment)
      const before = brantaVerificationOf(payment)
      const asked = facts()
      confirming = true
      host.confirming?.(true)
      try {
        const answer = await run(payment, { refresh: true })
        const now = facts()
        const moved = payment !== host.payment() || host.gone() || asked.walletId !== now.walletId || asked.amount !== now.amount
        if (moved) return { ok: false }
        if (payment.brantaMismatch || answer?.status === TAMPERED || session?.tampered) return { ok: false }
        const after = answer?.status === VERIFIED ? answer.verification : null
        if (before && !after) return { ok: false, reason: 'unavailable' }
        if (before && brantaIdentityKey(before) !== brantaIdentityKey(after)) return { ok: false, reason: 'changed' }
        accepted = { payment, verification: after }
        return { ok: true }
      } finally {
        confirming = false
        host.confirming?.(false)
      }
    },
    /**
     * Called with the route a wallet prepared, before it debits. Throws
     * PAYMENT_REVIEW_REQUIRED when that is no longer the reviewed destination.
     */
    assertPrepared(payment, prepared) {
      if (payment !== host.payment()) throw refuse('Payment changed')
      if (payment.brantaMismatch || (owner === payment && session?.tampered)) {
        stopped(payment)
        throw refuse('Payment code changed')
      }
      const reviewed = accepted?.payment === payment ? accepted.verification : null
      const same = reviewed && reviewed.destination.kind === prepared?.kind
        && sameBrantaDestination(reviewed.destination.value, prepared.value)
      if (!reviewed || same) return
      // The actual prepared rail changed after review. Do not debit or keep
      // the earlier business claim; the next explicit confirmation reviews it.
      const { walletId, amount } = facts()
      setRoute(payment, { walletId, amount, request: payment.invoice, target: prepared })
      payment.branta = { status: NONE }
      accepted = { payment, verification: null }
      throw refuse('Review the recipient before sending', 'unavailable')
    },
    /** What a sent payment keeps of its check; null when no business was accepted. */
    receipt(payment) { return accepted?.payment === payment ? brantaReceiptOf(accepted.verification) : null },
  }
}
