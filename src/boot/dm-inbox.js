import { boot } from 'quasar/wrappers';
import { watch } from 'vue';
import { EventBus } from '../utils/eventBus.js';
import { isAppLocked, whenAppLockKnown } from '../utils/appLock.js';
import { startChatLifecycle } from '../services/dm/lifecycle.js';

/**
 * Contact chat boot (docs/CONTACT_CHAT.md section 3).
 *
 * Starts the chat lifecycle (services/dm/lifecycle.js), which owns the rules:
 * one runtime per identity, started only while the app is unlocked, the key
 * wiped on lock and after ten minutes in the background, the outbox retried on
 * resume and when the network returns. This file only connects it to the real
 * world: the stores, the EventBus ('app:locked' / 'app:unlocked'), the
 * document and Capacitor's app state, and the UI accessor
 * (composables/useChatRuntime.js). Same shape as boot/profile-sync.js.
 *
 * Runs after 'profile-sync' and 'payment-address', whose identity and profile
 * it reads, and does nothing on a kiosk device (the owner's contacts must not
 * open relay connections on a till).
 */

/** Visibility from the DOM and, in the app, from Capacitor (the WebView alone is not reliable on every Android build). */
function visibilitySource() {
  return (listener) => {
    const cleanups = [];
    const onChange = () => listener(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    cleanups.push(() => document.removeEventListener('visibilitychange', onChange));

    let removed = false;
    import('@capacitor/app')
      .then(({ App }) => Promise.all([
        App.addListener('appStateChange', ({ isActive }) => listener(isActive !== false)),
        App.addListener('pause', () => listener(false)),
        App.addListener('resume', () => listener(true)),
      ]))
      .then((handles) => {
        if (removed) handles.forEach((handle) => handle?.remove?.());
        else cleanups.push(() => handles.forEach((handle) => handle?.remove?.()));
      })
      .catch(() => { /* the browser has no plugin: the DOM event covers it */ });

    return () => {
      removed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  };
}

function lockSource() {
  return (listener) => {
    const onLocked = () => listener(true);
    const onUnlocked = () => listener(false);
    EventBus.on('app:locked', onLocked);
    EventBus.on('app:unlocked', onUnlocked);
    return () => {
      EventBus.off('app:locked', onLocked);
      EventBus.off('app:unlocked', onUnlocked);
    };
  };
}

export default boot(async () => {
  // The screenshot harness seeds identities for rendering; it must not open relay connections.
  if (typeof window !== 'undefined' && window.__AUDIT__) return;

  const [
    { useIdentityStore }, { useMessagesStore }, { useWalletStore }, { useProfileStore },
    { useAddressBookStore }, { useNotificationsStore }, { useTransactionMetadataStore },
    { createAppRuntimeFactory }, { createNotificationFormatter }, { publishChatRuntime, useChatRuntime },
    { createPaymentAnnouncer },
    { getRelayPool }, { formatAmount }, { i18n }, { readPersistedWalletState },
    { visibilitySnapshot }, nostrCore,
  ] = await Promise.all([
    import('../stores/identity.js'), import('../stores/messages.js'), import('../stores/wallet.js'),
    import('../stores/profile.js'), import('../stores/addressBook.js'), import('../stores/notifications.js'),
    import('../stores/transactionMetadata.js'), import('../services/dm/appRuntime.js'),
    import('../services/dm/notificationCopy.js'), import('../composables/useChatRuntime.js'),
    import('../services/dm/paymentAnnouncer.js'),
    import('../utils/nostrRelays.js'), import('../utils/amountFormatting.js'), import('./i18n.js'),
    import('../utils/walletHydration.js'), import('../services/sparkLifecycleApp.js'), import('nostr-core'),
  ]);

  const identity = useIdentityStore();
  const messages = useMessagesStore();
  const wallet = useWalletStore();
  const t = i18n.global.t.bind(i18n.global);

  const createRuntime = createAppRuntimeFactory({
    identity,
    messages: () => messages,
    wallet,
    profile: useProfileStore(),
    addressBook: useAddressBookStore(),
    notifications: useNotificationsStore(),
    transactionMetadata: useTransactionMetadataStore(),
  }, {
    getRelayPool,
    lnurl: nostrCore,
    isLocked: isAppLocked,
    // "Out of sight right now", including a native pause the DOM did not report.
    isHidden: () => visibilitySnapshot().hiddenNow,
    formatNotification: createNotificationFormatter({
      t,
      formatAmount: (sats) => formatAmount(sats, wallet.useBip177Format),
    }),
    // A function: read when a notification is built, so a language change applies at once.
    channelName: () => t('Messages'),
  });

  const lifecycle = startChatLifecycle({
    identity,
    watchIdentity: (onChange) => watch(() => identity.nostrPubkeyHex, onChange, { flush: 'sync' }),
    messages,
    createRuntime,
    publish: publishChatRuntime,
    lock: { isLocked: isAppLocked, whenKnown: whenAppLockKnown },
    onLockChange: lockSource(),
    onVisibility: visibilitySource(),
    onOnline: (listener) => {
      window.addEventListener('online', listener);
      return () => window.removeEventListener('online', listener);
    },
    isHidden: () => document.visibilityState === 'hidden',
    // A kiosk device boots into the cashier; the wallet store hydrates lazily,
    // so the persisted snapshot answers until it has (like App.vue and boot/kiosk.js).
    isSuspended: () => (wallet.kioskEnabled
      ? !wallet.kioskOwnerAccess
      : readPersistedWalletState()?.kioskEnabled === true),
  });

  // Payments made from a chat are announced to the partner from here, not from
  // the chat page: the confirm sheet lives on the wallet page, so the page is
  // usually gone when the payment succeeds (services/dm/paymentAnnouncer.js).
  const announcer = createPaymentAnnouncer({
    bus: EventBus,
    runtime: useChatRuntime(),
    // A request the user paid: its own note stands in for a comment they did not type.
    noteFor: (partner, requestId) => (requestId
      ? messages.thread(partner).messages.find((entry) => entry.id === requestId)?.request?.note || undefined
      : undefined),
    // The money is gone either way; an announcement that cannot be sent is not shown to the user.
    onError: (code) => console.warn('[chat] could not announce a payment', code),
  });
  announcer.start();

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      announcer.stop();
      lifecycle.stop();
    });
  }
});
