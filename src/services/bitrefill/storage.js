/**
 * What the app keeps for the Bitrefill shop, all on this phone:
 *
 *   - the email vouchers are sent to, encrypted with the device key
 *   - whether the user was already asked for it (asked once, never nagged)
 *   - a ledger of invoices the app tried to pay, so one invoice is never
 *     paid twice: not after an error, not after a reload, not after the
 *     widget sends the same `payment_intent` again
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
  /** Paid: the wallet returned, or the widget saw the payment. */
  PAID: 'paid',
  /** The wallet refused and the widget saw no payment: safe to try again. */
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

/**
 * The invoice ledger. `canPay` is asked before every payment; `mark` records
 * each step, ATTEMPTED strictly before the invoice reaches the wallet.
 */
export function createInvoiceLedger({ storage = defaultStorage(), now = () => Date.now() } = {}) {
  const read = () => {
    if (!storage?.getItem || !storage?.setItem) throw new Error('Invoice ledger unavailable')
    const raw = storage.getItem(LEDGER_KEY)
    const list = raw === null ? [] : JSON.parse(raw)
    if (!Array.isArray(list) || list.some(e => !e || typeof e.invoiceId !== 'string' || !Object.values(PAY_STATE).includes(e.state))) {
      throw new Error('Invoice ledger unreadable')
    }
    return list
  }

  return {
    get(invoiceId) {
      return read().find((e) => e.invoiceId === invoiceId) || null
    },

    /**
     * { ok: true } or { ok: false, reason }: PAID when it was paid, IN_FLIGHT
     * when a payment was handed to a wallet and never came back (the app
     * closed mid-send). Only FAILED or unknown invoices may be paid.
     */
    canPay(invoiceId) {
      let entry
      try { entry = this.get(invoiceId) } catch { return { ok: false, reason: PAY_BLOCK.UNAVAILABLE } }
      if (!entry || entry.state === PAY_STATE.FAILED) return { ok: true }
      if (entry.state === PAY_STATE.PAID) return { ok: false, reason: PAY_BLOCK.PAID }
      return { ok: false, reason: PAY_BLOCK.IN_FLIGHT }
    },

    mark(invoiceId, state, extra = {}) {
      if (!invoiceId || !Object.values(PAY_STATE).includes(state)) return null
      const list = read()
      const at = now()
      const index = list.findIndex((e) => e.invoiceId === invoiceId)
      // A late wallet failure cannot undo an already observed payment.
      if (index >= 0 && list[index].state === PAY_STATE.PAID) return list[index]
      if (state === PAY_STATE.ATTEMPTED && (index < 0 || list[index].state !== PAY_STATE.ATTEMPTED)
        && list.filter(e => e.state === PAY_STATE.ATTEMPTED).length >= LEDGER_LIMIT) {
        throw new Error('Invoice ledger full')
      }
      const entry = { ...(index >= 0 ? list[index] : { invoiceId, createdAt: at }), ...extra, state, updatedAt: at }
      if (index >= 0) list.splice(index, 1)
      list.push(entry)
      // Pruning history must never free an unresolved payment for another send.
      const pending = list.filter(e => e.state === PAY_STATE.ATTEMPTED)
      const historySlots = Math.max(0, LEDGER_LIMIT - pending.length)
      const history = historySlots ? list.filter(e => e.state !== PAY_STATE.ATTEMPTED).slice(-historySlots) : []
      const encoded = JSON.stringify([...pending, ...history])
      storage.setItem(LEDGER_KEY, encoded)
      if (storage.getItem(LEDGER_KEY) !== encoded) throw new Error('Invoice ledger write failed')
      return entry
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
