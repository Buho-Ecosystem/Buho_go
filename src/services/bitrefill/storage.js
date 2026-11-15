/**
 * What the app keeps for the Bitrefill shop, all on this phone:
 *
 *   - the email vouchers are sent to, encrypted with the device key
 *   - whether the user was already asked for it (asked once, never nagged)
 *   - a ledger of invoices the app tried to pay, so one invoice is never
 *     paid twice: not after an error, not after a reload, not after the
 *     widget sends the same `payment_intent` again, and not when the same
 *     invoice comes back under another order id
 *
 * A ledger entry is found by the invoice's payment hash first (the invoice
 * itself) and by the widget's order id second. It keeps what a later look
 * at the paying wallet needs: the hash, the wallet and when the price ends.
 *
 * Storage and crypto are injectable so the rules run under Node.
 */

import { encryptString, decryptString } from '../../utils/deviceCrypto.js'

export const EMAIL_KEY = 'buhoGO_bitrefill_email'
export const EMAIL_ASKED_KEY = 'buhoGO_bitrefill_email_asked'
export const LEDGER_KEY = 'buhoGO_bitrefill_invoices'

/** Maximum ledger size. Unresolved attempts are never evicted for history. */
export const LEDGER_LIMIT = 100

export const PAY_STATE = Object.freeze({
  /** Handed to the wallet; the outcome is not known yet. */
  ATTEMPTED: 'attempted',
  /** Paid: the wallet settled it, or the widget saw the payment. */
  PAID: 'paid',
  /** Known not to have been paid: safe to try again. */
  FAILED: 'failed',
})

export const PAY_BLOCK = Object.freeze({
  PAID: 'paid',
  IN_FLIGHT: 'in_flight',
  UNAVAILABLE: 'unavailable',
})

function defaultStorage() {
  try { return globalThis.localStorage || null } catch { return null }
}

const isText = (value) => typeof value === 'string' && value.length > 0

/** `{ invoiceId, paymentHash }` from a key object, or from a bare order id. */
function keyOf(key) {
  if (isText(key)) return { invoiceId: key, paymentHash: null }
  return {
    invoiceId: isText(key?.invoiceId) ? key.invoiceId : null,
    paymentHash: isText(key?.paymentHash) ? key.paymentHash.toLowerCase() : null,
  }
}

/**
 * The invoice ledger. `claim` is the only way an invoice reaches a wallet:
 * it checks and records the attempt in one step. `mark` records what
 * became of it.
 */
export function createInvoiceLedger({ storage = defaultStorage(), now = () => Date.now() } = {}) {
  const read = () => {
    if (!storage?.getItem || !storage?.setItem) throw new Error('Invoice ledger unavailable')
    const raw = storage.getItem(LEDGER_KEY)
    const list = raw === null ? [] : JSON.parse(raw)
    // Entries written before the ledger knew payment hashes carry only the order id.
    if (!Array.isArray(list) || list.some(e => !e || !(isText(e.invoiceId) || isText(e.paymentHash)) || !Object.values(PAY_STATE).includes(e.state))) {
      throw new Error('Invoice ledger unreadable')
    }
    return list
  }

  const indexOf = (list, key) => {
    const { invoiceId, paymentHash } = keyOf(key)
    const byHash = paymentHash ? list.findIndex((e) => e.paymentHash === paymentHash) : -1
    if (byHash >= 0) return byHash
    return invoiceId ? list.findIndex((e) => e.invoiceId === invoiceId) : -1
  }

  const write = (list) => {
    // Pruning history must never free an unresolved payment for another send.
    const pending = list.filter(e => e.state === PAY_STATE.ATTEMPTED)
    const historySlots = Math.max(0, LEDGER_LIMIT - pending.length)
    const history = historySlots ? list.filter(e => e.state !== PAY_STATE.ATTEMPTED).slice(-historySlots) : []
    const encoded = JSON.stringify([...pending, ...history])
    storage.setItem(LEDGER_KEY, encoded)
    if (storage.getItem(LEDGER_KEY) !== encoded) throw new Error('Invoice ledger write failed')
  }

  const verdictOf = (entry) => {
    if (!entry || entry.state === PAY_STATE.FAILED) return { ok: true }
    if (entry.state === PAY_STATE.PAID) return { ok: false, reason: PAY_BLOCK.PAID }
    return { ok: false, reason: PAY_BLOCK.IN_FLIGHT }
  }

  return {
    get(key) {
      const list = read()
      const index = indexOf(list, key)
      return index >= 0 ? list[index] : null
    },

    /**
     * { ok: true } or { ok: false, reason }: PAID when it was paid, IN_FLIGHT
     * when a payment was handed to a wallet and its outcome is not known.
     * Only FAILED or unknown invoices may be paid.
     */
    canPay(key) {
      try { return verdictOf(this.get(key)) } catch { return { ok: false, reason: PAY_BLOCK.UNAVAILABLE } }
    },

    /**
     * Check and record an attempt in one step, strictly before the invoice
     * reaches the wallet. Returns the verdict; the attempt is recorded only
     * when it is `ok`. Throws when the ledger cannot be written.
     */
    claim(key, extra = {}) {
      const verdict = this.canPay(key)
      if (!verdict.ok) return verdict
      this.mark(key, PAY_STATE.ATTEMPTED, extra)
      return verdict
    },

    mark(key, state, extra = {}) {
      const { invoiceId, paymentHash } = keyOf(key)
      if (!(invoiceId || paymentHash) || !Object.values(PAY_STATE).includes(state)) return null
      const list = read()
      const at = now()
      const index = indexOf(list, key)
      // A late wallet failure cannot undo an already observed payment.
      if (index >= 0 && list[index].state === PAY_STATE.PAID) return list[index]
      if (state === PAY_STATE.ATTEMPTED && (index < 0 || list[index].state !== PAY_STATE.ATTEMPTED)
        && list.filter(e => e.state === PAY_STATE.ATTEMPTED).length >= LEDGER_LIMIT) {
        throw new Error('Invoice ledger full')
      }
      const entry = {
        ...(index >= 0 ? list[index] : { createdAt: at }),
        ...extra,
        ...(invoiceId ? { invoiceId } : {}),
        ...(paymentHash ? { paymentHash } : {}),
        state,
        updatedAt: at,
      }
      if (index >= 0) list.splice(index, 1)
      list.push(entry)
      write(list)
      return entry
    },

    /** Add facts to an entry (delivery, a refund) without touching its state. */
    annotate(key, extra = {}) {
      const list = read()
      const index = indexOf(list, key)
      if (index < 0) return null
      list[index] = { ...list[index], ...extra, state: list[index].state }
      write(list)
      return list[index]
    },

    /** Every entry the ledger holds. */
    all() {
      return read()
    },

    /** Attempts whose outcome is still unknown. */
    unresolved() {
      return read().filter((e) => e.state === PAY_STATE.ATTEMPTED)
    },
  }
}

/** True once the user saved an email or chose "Not now". */
export function wasEmailAsked(storage = defaultStorage()) {
  try { return storage?.getItem(EMAIL_ASKED_KEY) === '1' } catch { return false }
}

export function markEmailAsked(storage = defaultStorage()) {
  try { storage?.setItem(EMAIL_ASKED_KEY, '1') } catch { /* blocked */ }
}

/** The saved email, decrypted; '' when none or unreadable. */
export async function loadEmail({ storage = defaultStorage(), decrypt = decryptString } = {}) {
  let envelope = null
  try { envelope = storage?.getItem(EMAIL_KEY) } catch { envelope = null }
  if (!envelope) return ''
  try {
    return await decrypt(envelope)
  } catch {
    return ''
  }
}

export async function saveEmail(email, { storage = defaultStorage(), encrypt = encryptString } = {}) {
  const envelope = await encrypt(String(email).trim())
  storage?.setItem(EMAIL_KEY, envelope)
  markEmailAsked(storage)
}

export function clearEmail(storage = defaultStorage()) {
  try { storage?.removeItem(EMAIL_KEY) } catch { /* blocked */ }
}
