import { computed, onScopeDispose, ref, watch } from 'vue';
import { fetchWithdrawRequest } from '../services/lnurlWithdraw.js';
import { withdrawRecipient } from '../utils/lnurlWithdraw.js';
import { lnurlToUrl } from '../utils/addressUtils.js';

const CARD_LIFETIME_MS = 120000;

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
 */
export function useKioskCardPayment({ sale, authorize, onError, t = text => text, resolve = fetchWithdrawRequest }) {
  const phase = ref('empty');
  const request = ref(null);
  /** The card's service, shown on the card face from the tap on. */
  const host = ref('');
  let input = null;
  let controller = null;
  let expiryTimer = null;

  function reset() {
    controller?.abort();
    controller = null;
    clearTimeout(expiryTimer);
    input = null;
    request.value = null;
    host.value = '';
    phase.value = 'empty';
  }

  async function prepare() {
    if (!input || !sale.value || phase.value !== 'ready') return;
    if (Date.now() - input.receivedAt > CARD_LIFETIME_MS) { reset(); return; }
    clearTimeout(expiryTimer);
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
    try { host.value = new URL(lnurlToUrl(payment.data) || '').host; } catch { host.value = ''; }
    phase.value = 'ready';
    expiryTimer = setTimeout(reset, Math.max(0, CARD_LIFETIME_MS - (Date.now() - receivedAt)));
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
    } catch (error) {
      if (attempt.signal.aborted) return;
      reset();
      if (error?.name !== 'AbortError') onError(error);
    }
  }

  watch(sale, (current, previous) => {
    if (previous) reset();
    if (current) void prepare();
  }, { flush: 'sync' });
  onScopeDispose(reset);

  const payment = computed(() => request.value && sale.value ? {
    recipient: withdrawRecipient(request.value, t),
    amount: { mode: 'fixed', fixedSats: sale.value.amountSats },
    description: '', commentAllowed: false,
  } : null);
  return { phase, payment, host, accept, confirm, reset };
}
