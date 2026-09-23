import { boot } from 'quasar/wrappers';
import { Notify } from 'quasar';

/**
 * Wires the app-wide Spark lifecycle (services/sparkLifecycle.js) to the
 * stores, the SDK event registry and the app's own lifecycle signals, and
 * decides how a newly detected receipt reaches the user.
 *
 * Wake signals — any of them starts reconciliation of BOTH Spark wallets
 * immediately, without waiting for a page timer:
 *   - native resume (@capacitor/app appStateChange; on the web the same
 *     plugin raises it from `visibilitychange`),
 *   - the document becoming visible (covers a PWA or tab without the plugin),
 *   - the network coming back (`online`).
 * Overlapping signals are coalesced by the coordinator.
 *
 * Receipt delivery, defined:
 *   - App out of sight: a system notification, if the user turned
 *     notifications on and the OS permits (notifications store decides).
 *   - App on screen, payment seen live: nothing extra. The balance and the
 *     open screen already show it, and receive flows confirm their own.
 *   - App on screen, payment found after resume that settled while the app
 *     was away: an in-app toast, so a payment missed during suspension is
 *     still announced once. Same user switch as notifications; no OS
 *     permission needed for a toast.
 *   - Kiosk (locked to POS): no in-app toast — the POS screen owns the
 *     customer-facing confirmation. Background notifications behave as
 *     before.
 *   - Own transfers identified by receiving invoice hash: not announced.
 */
export default boot(async () => {
  if (typeof window !== 'undefined' && window.__AUDIT__) return;

  const [
    { useWalletStore },
    { useBitcoinDepositsStore },
    { useNotificationsStore },
    breezSdk,
    { configureSparkLifecycle },
    { createPaymentReceipts },
    { paymentHashOf },
    { exitKitService },
    { formatAmount },
    { i18n },
  ] = await Promise.all([
    import('../stores/wallet.js'),
    import('../stores/bitcoinDeposits.js'),
    import('../stores/notifications.js'),
    import('../services/breezSdk.js'),
    import('../services/sparkLifecycle.js'),
    import('../services/paymentReceipts.js'),
    import('../utils/breezPayments.js'),
    import('../services/exitKit.js'),
    import('../utils/amountFormatting.js'),
    import('./i18n.js'),
  ]);

  const wallet = useWalletStore();
  const deposits = useBitcoinDepositsStore();
  const notifications = useNotificationsStore();
  // Idempotent (App.vue calls it too); this owner must not depend on a
  // component having mounted first. Delivery awaits this OS round-trip.
  const notificationsReady = notifications.initialize().catch(() => {});

  let visibleSince = Date.now();
  let nativeActive = true;
  const isForeground = () => nativeActive && (typeof document === 'undefined' || !document.hidden);
  let wasForeground = isForeground();

  const deliver = async ({ walletId, amountSats, timestamp }) => {
    await notificationsReady;
    const w = wallet.wallets.find(x => x.id === walletId);
    const t = i18n.global.t.bind(i18n.global);
    const title = t('Payment received');
    const body = t('{amount} · {wallet}', {
      amount: formatAmount(amountSats, wallet.useBip177Format),
      wallet: w?.name || t('your wallet'),
    });

    if (!isForeground()) {
      await notifications.notifyIfEnabled({ title, body });
      return;
    }
    // A queued SDK event can win the race with history catch-up on resume.
    // The receipt's origin must not decide whether a missed payment is announced.
    const settledWhileAway = timestamp && timestamp < Math.floor(visibleSince / 1000);
    if (!settledWhileAway) return;
    if (!notifications.enabled || wallet.isKioskRestricted) return;
    Notify.create({ type: 'positive', message: title, caption: body, position: 'top', timeout: 4000 });
  };

  const receipts = createPaymentReceipts({ paymentHashOf, deliver });

  const lifecycle = configureSparkLifecycle({
    walletStore: null,
    depositsStore: () => deposits,
    receipts,
    subscribe: (walletId, handler) => breezSdk.subscribe(walletId, handler),
    refreshExitKit: (walletId, opts) => exitKitService().refresh(walletId, opts),
    isForeground,
    backgroundSyncWanted: () => notifications.canNotify,
  });
  lifecycle.attach(wallet);

  const visibilityChanged = (reason) => {
    const foreground = isForeground();
    if (foreground && !wasForeground) visibleSince = Date.now();
    wasForeground = foreground;
    if (foreground) lifecycle.onWake(reason);
    else lifecycle.onVisibilityChanged();
  };
  const onVisible = () => visibilityChanged('visible');
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', () => lifecycle.onWake('online'));
  window.addEventListener('offline', () => lifecycle.onVisibilityChanged());

  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('appStateChange', ({ isActive }) => {
      nativeActive = isActive;
      visibilityChanged('resume');
    });
  } catch {
    // No app plugin (plain browser build): visibilitychange covers it.
  }

  // Support/diagnostics: redacted lifecycle history (wallet ids shortened,
  // no amounts, no addresses) to see where time goes after a resume.
  window.__buhoSparkLifecycle = { diagnostics: () => lifecycle.diagnostics() };
});
