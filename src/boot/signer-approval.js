import { boot } from 'quasar/wrappers';
import { Notify } from 'quasar';
import { i18n } from './i18n.js';
import { useWalletStore } from '../stores/wallet.js';
import { BUNKER_REQUEST_TIMEOUT_MS, onSignerApproval } from '../services/identitySigners.js';
import { openInAppBrowser } from '../utils/inAppBrowser.js';
import { readPersistedWalletState } from '../utils/walletHydration.js';

/**
 * A remote signer can ask the person to approve a request on its own page
 * (NIP-46 `auth_url`). The request keeps waiting, so the app offers the page
 * instead of failing: one toast naming the host, with Open.
 *
 * Never opened on its own. The request rarely follows a tap (pairing waits on
 * relays first; chat, profile and contacts sign in the background), so a
 * browser would block it, and on a phone it would pull the person out of the
 * app without warning. The toast's Open is a tap of its own.
 *
 * Several requests can wait at once, so one toast at most: the same page again
 * restarts its countdown (the signer restarted the request's), a new page
 * replaces it. Nothing shows while a kiosk faces customers.
 */
export default boot(() => {
  const wallet = useWalletStore();
  // A kiosk device boots into the cashier; the wallet store hydrates lazily,
  // so the persisted snapshot answers until it has (like boot/dm-inbox.js).
  const cashierShowing = () => (wallet.kioskEnabled
    ? !wallet.kioskOwnerAccess
    : readPersistedWalletState()?.kioskEnabled === true);
  let shown = null;

  const stop = onSignerApproval((url) => {
    if (cashierShowing()) return;
    // Notify.create's handle: called with changes it updates the toast (and
    // restarts its countdown), called without it dismisses it.
    if (shown?.url === url) {
      shown.handle({});
      return;
    }
    shown?.handle();
    const { t } = i18n.global;
    const entry = { url };
    entry.handle = Notify.create({
      type: 'info',
      group: false,
      timeout: BUNKER_REQUEST_TIMEOUT_MS,
      message: t('Your signer app asks you to approve'),
      caption: t('Open {host} to approve, then come back.', { host: new URL(url).host }),
      actions: [{ label: t('Open'), color: 'white', handler: () => openInAppBrowser(url) }],
      onDismiss: () => {
        if (shown === entry) shown = null;
      },
    });
    shown = entry;
  });
  if (import.meta.hot) import.meta.hot.dispose(stop);
});
