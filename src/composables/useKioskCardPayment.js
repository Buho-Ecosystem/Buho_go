import { onScopeDispose, ref, watch } from 'vue';
import { fetchWithdrawRequest } from '../services/lnurlWithdraw.js';
import { withdrawLinkHost } from '../utils/lnurlWithdraw.js';

/** How long a tapped card stays usable before it is put to work. */
const CARD_LIFETIME_MS = 120000;

/**
 * How long a card waits for its payment once its service has answered OK.
 * That answer only accepts the request: the service pays afterwards (LUD-03),
 * and one whose wallet has no funds or no route never pays (#460). Letting go
 * then costs nothing: the sale's own watch keeps running, so a payment that
 * arrives later still completes it, and an invoice is paid only once, so a
 * second tap or a scan cannot pay twice.
 */
export const CARD_PAYMENT_WAIT_MS = 60000;

/** The `code` of the error passed to `onError` when the wait ends unpaid. */
export const CARD_NOT_PAID = 'CARD_NOT_PAID';

/** One ephemeral card attempt, bound to the kiosk's existing sale invoice.
 * The page owns the sale and settlement; this composable only handles review
 * and authorization. Neither a callback acknowledgment nor a balance change
 * is proof that the sale was paid.
 *
 * A card tapped on the pay screen pays at once, like a terminal: the amount
 * was on screen when the card touched the phone (the card's PIN, when its
 * limit asks for one, still comes first). A card tapped before there was a
 * sale is held and waits in `review` for an explicit confirm, because its
 * holder never saw the amount.
 *
 * Phases: empty → ready (held, up to CARD_LIFETIME_MS) → loading (reading
 * the card) → review → submitting → waiting (the service said OK, up to
 * `paymentWaitMs`). Every way out of a phase other than the next one goes
 * through reset(), back to empty.
 */
export function useKioskCardPayment({ sale, authorize, onError, resolve = fetchWithdrawRequest, paymentWaitMs = CARD_PAYMENT_WAIT_MS }) {
  const phase = ref('empty');
  const request = ref(null);
  /** The card's service, shown on the card face from the tap on. */
  const host = ref('');
  let input = null;
  let controller = null;
  /** The held card's lifetime, then the wait for its payment: one at a time. */
  let timer = null;

  function startTimer(ms, onEnd) {
    clearTimeout(timer);
    timer = setTimeout(onEnd, Math.max(0, ms));
  }

  function reset() {
    controller?.abort();
    controller = null;
    clearTimeout(timer);
    input = null;
    request.value = null;
    host.value = '';
    phase.value = 'empty';
  }

  async function prepare() {
    if (!input || !sale.value || phase.value !== 'ready') return;
    if (Date.now() - input.receivedAt > CARD_LIFETIME_MS) { reset(); return; }
    clearTimeout(timer);
    const currentSale = sale.value;
    const attempt = new AbortController();
    controller = attempt;
    phase.value = 'loading';
    try {
      const info = await resolve(input.data, { signal: attempt.signal });
      if (attempt.signal.aborted || sale.value !== currentSale) return;
      if (currentSale.amountSats < info.minSats || currentSale.amountSats > info.maxSats) {
        throw new Error('The sale amount is outside this card’s payment limits.');
      }
      request.value = info;
      phase.value = 'review';
      if (!input.confirmFirst) void confirm({ amountSats: currentSale.amountSats });
    } catch (error) {
      if (attempt.signal.aborted) return;
      reset();
      onError(error);
    }
  }

  function accept(payment) {
    // Repeated reader events must not replace a card already under review or
    // resubmit a one-time challenge. A new sale/cancel explicitly clears it.
    if (phase.value !== 'empty' || !payment?.data) return false;
    const receivedAt = payment.receivedAt || Date.now();
    if (Date.now() - receivedAt > CARD_LIFETIME_MS) return false;
    input = { data: payment.data, receivedAt, confirmFirst: !sale.value };
    host.value = withdrawLinkHost(payment.data);
    phase.value = 'ready';
    startTimer(CARD_LIFETIME_MS - (Date.now() - receivedAt), reset);
    void prepare();
    return true;
  }

  async function confirm({ amountSats }) {
    if (phase.value !== 'review' || !sale.value || amountSats !== sale.value.amountSats) return;
    const currentSale = sale.value;
    const attempt = controller;
    phase.value = 'submitting';
    try {
      await authorize(request.value, currentSale.paymentRequest, amountSats, { signal: attempt.signal });
      if (attempt.signal.aborted || sale.value !== currentSale) return;
      phase.value = 'waiting';
      // Discard the credential after use. Settlement remains with the page.
      input = null;
      request.value = null;
      startTimer(paymentWaitMs, giveUp);
    } catch (error) {
      if (attempt.signal.aborted) return;
      reset();
      if (error?.name !== 'AbortError') onError(error);
    }
  }

  /** The service said OK and no payment came: the sale goes back to the QR. */
  function giveUp() {
    reset();
    onError(Object.assign(new Error('No payment came from the card.'), { code: CARD_NOT_PAID }));
  }

  watch(sale, (current, previous) => {
    if (previous) reset();
    if (current) void prepare();
  }, { flush: 'sync' });
  onScopeDispose(reset);

  return { phase, host, accept, confirm, reset };
}
