import { Notify } from 'quasar';
import { i18n } from '../boot/i18n';
import { isAddressRequest } from '../utils/lud23.js';
import { useAddressRequestStore } from '../stores/addressRequest.js';

/** Call before payment-specific guards. Recognition is intentionally separate
 * from validation, so malformed address requests also get the right error UI. */
export function offerAddressRequest(input, { t = (key, params) => i18n.global.t(key, params), paymentOnly = false } = {}) {
  if (!isAddressRequest(input)) return false;
  if (paymentOnly) {
    Notify.create({ type: 'info', message: t('This link asks for your address. It cannot receive a payment.') });
    return true;
  }
  const result = useAddressRequestStore().open(input);
  if (result === 'busy') Notify.create({ type: 'info', message: t('Finish the current request, then open this one again.') });
  return true;
}
