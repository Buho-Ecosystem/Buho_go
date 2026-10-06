import { computed, onScopeDispose, ref, watch } from 'vue';
import { fetchWithdrawRequest } from '../services/lnurlWithdraw.js';
import { withdrawRecipient } from '../utils/lnurlWithdraw.js';

const CARD_LIFETIME_MS = 120000;

/** One ephemeral card attempt, bound to the kiosk's existing sale invoice.
 * The page owns the sale and settlement; this composable only handles review
 * and authorization. Neither a callback acknowledgment nor a balance change
 * is proof that the sale was paid.
 */
export function useKioskCardPayment({ sale, authorize, onError, t = text => text, resolve = fetchWithdrawRequest }) {
  const phase = ref('empty');
  const request = ref(null);
  let input = null;
  let controller = null;
  let expiryTimer = null;

  function reset() {
    controller?.abort();
    controller = null;
    clearTimeout(expiryTimer);
    input = null;
    request.value = null;
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
    input = { data: payment.data, receivedAt };
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
  const message = computed(() => ({
    ready: t('Card ready. Enter the sale amount to continue.'),
    loading: t('Reading card…'),
  }[phase.value] || ''));
  return { phase, payment, message, accept, confirm, reset };
}
