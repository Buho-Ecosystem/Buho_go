import { lnurlToUrl, stripWrapperScheme } from '../utils/addressUtils.js';

/** Route only potential incoming withdrawals into the existing transient inbox.
 * Resolving the service's tag happens in the kiosk; no outgoing/auth flow runs.
 * Returning true consumes every input while kiosk is locked, including rejected ones.
 */
export function offerKioskPayment(raw, store, router) {
  if (!store.kioskEnabled || store.kioskOwnerAccess) return false;
  const input = stripWrapperScheme(raw);
  if (!/^(lnurlp|lnurlc|keyauth):/i.test(input) && lnurlToUrl(input)) {
    store.pendingDeepLink = { type: 'lnurl', data: input, target: 'kiosk', receivedAt: Date.now() };
    if (router.currentRoute.value?.path !== '/kiosk') {
      router.push('/kiosk').catch(() => {});
    }
  }
  return true;
}
