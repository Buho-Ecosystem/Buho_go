/**
 * Announces payments made from the chat.
 *
 * The chat hands a payment to the app's normal send pipeline and leaves the
 * screen (the confirm sheet lives on the wallet page). When that payment
 * succeeds, Wallet.vue emits `payment:sent` on the EventBus with the context
 * string the chat attached (`paymentContext.js`). This module is the always-on
 * listener that turns such an event into `runtime.announcePayment(...)`: it is
 * registered once at boot, so the announcement happens whether or not the chat
 * page is still mounted, and for payments that finish after the user went
 * somewhere else.
 *
 * Why here and not in the page: a page-level listener would silently miss
 * every payment completed after navigation, which is the normal case (the
 * user is on /wallet while paying).
 *
 * Events without a chat context are ignored, so every other payment flow is
 * untouched. The announcement is best effort by nature (the money is already
 * gone); a failure is reported through `onError` with the error CODE only.
 * Invoices, preimages and notes are never logged.
 *
 * Pure: the bus and the runtime are injected.
 */

import { DmError } from './errors.js';
import { parseChatPaymentContext } from './paymentContext.js';

/** The EventBus event Wallet.vue emits after a completed payment. */
export const PAYMENT_SENT_EVENT = 'payment:sent';

/**
 * @typedef {object} PaymentSentEvent
 * @property {string | null} [contactId] Address book id of the recipient, when known.
 * @property {string | null} [destination] What was paid (address or invoice). Never logged.
 * @property {number} amountSats
 * @property {string | null} [preimage] Proof of payment, when the wallet returns one.
 * @property {string | null} [sendingWalletId]
 * @property {string | null} [note] The comment sent with the payment.
 * @property {string | null} [context] Opaque string of the caller (see paymentContext.js).
 */

/**
 * @param {object} deps
 * @param {{ on: Function, off: Function }} deps.bus The EventBus.
 * @param {{ announcePayment: (partner: string, payment: object) => Promise<unknown> }} deps.runtime
 *   The `useChatRuntime()` facade (always the current runtime).
 * @param {(partner: string, requestId: string | null) => string | undefined} [deps.noteFor]
 *   Note to use when the event carries none (the request's own note).
 * @param {(code: string) => void} [deps.onError] Called with a DM_ERROR code (or 'UNKNOWN').
 * @returns {{ start: () => void, stop: () => void, handle: (event: PaymentSentEvent) => Promise<boolean> }}
 */
export function createPaymentAnnouncer({ bus, runtime, noteFor, onError = () => {} }) {
  if (!bus || typeof bus.on !== 'function') throw new TypeError('announcer: a bus is required');
  if (!runtime || typeof runtime.announcePayment !== 'function') throw new TypeError('announcer: a runtime is required');

  /** @returns {Promise<boolean>} True when an announcement was sent. */
  async function handle(event) {
    const target = parseChatPaymentContext(event?.context);
    if (!target) return false;
    const amountSats = Number(event.amountSats);
    if (!Number.isSafeInteger(amountSats) || amountSats <= 0) return false;

    const note = (typeof event.note === 'string' && event.note.trim())
      ? event.note
      : noteFor?.(target.partner, target.requestId);
    try {
      await runtime.announcePayment(target.partner, {
        amountSats,
        note: note || undefined,
        preimage: event.preimage || undefined,
        requestId: target.requestId ?? undefined,
        verifyUrl: target.verifyUrl ?? undefined,
      });
      return true;
    } catch (error) {
      onError(DmError.is(error) ? error.code : 'UNKNOWN');
      return false;
    }
  }

  // One stable function so `off` finds it again and a double `start` is harmless.
  const listener = (event) => { void handle(event); };
  let running = false;

  return {
    start() {
      if (running) return;
      running = true;
      bus.on(PAYMENT_SENT_EVENT, listener);
    },
    stop() {
      if (!running) return;
      running = false;
      bus.off(PAYMENT_SENT_EVENT, listener);
    },
    handle,
  };
}
