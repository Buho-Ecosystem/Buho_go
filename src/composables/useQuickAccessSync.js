import { computed, onUnmounted, watch } from 'vue';
import { useWalletStore } from '../stores/wallet.js';
import { useAddressBookStore } from '../stores/addressBook.js';
import { i18n } from '../boot/i18n';
import { planQuickAccess, shortcutKeysOf } from '../utils/quickAccessPlan.js';
import { applyShortcuts, getPinnedShortcuts, quickAccessSupported, setTiles } from '../services/quickAccess.js';

/**
 * Keeps the Quick Settings tiles and the launcher shortcuts in step with the
 * app (issues #445, #446): a wallet added or removed, kiosk mode, the app
 * lock, the last contact paid, a contact renamed or removed, the language.
 *
 * App-level, like useAddressBookSync: the state it follows changes on many
 * screens, and the kiosk boot path never mounts the wallet page. It waits for
 * the saved wallets before the first publish, so a cold start never greys the
 * tiles or switches the shortcuts off for the moment before they load.
 *
 * Android only. A publish happens only when the result changed, and again on
 * every return to the app: the person may have pinned or removed a shortcut
 * meanwhile.
 */

/** Collapse a burst of changes (contacts loading, a switch flipped) into one publish. */
const SYNC_DEBOUNCE_MS = 400;

/**
 * A publish that has not finished by then is given up, so the next one is
 * never held behind it (the native side bounds each contact picture, this
 * bounds the whole call). It is not marked published: the next change or
 * return to the app tries again.
 */
const PUBLISH_TIMEOUT_MS = 30 * 1000;

function withTimeout(promise, ms) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

function contactSummary(entry) {
  return {
    keys: shortcutKeysOf(entry),
    name: entry.name,
    picture: entry.nostr_profile?.picture || '',
    // The same test as the contact's avatar: a service gets the storefront.
    isService: entry.addressType === 'lnurl' || !!entry.service,
  };
}

export function useQuickAccessSync() {
  if (!quickAccessSupported()) return;

  const walletStore = useWalletStore();
  const addressBook = useAddressBookStore();
  const t = (key, values) => i18n.global.t(key, values);

  let timer = null;
  let queue = Promise.resolve();
  let published = null;
  let resumeListener = null;
  let stopped = false;

  const state = computed(() => {
    const lastPaid = addressBook.recentlyPaidEntries.find((entry) => addressBook.isEntryPayable(entry));
    return {
      hasWallet: !!walletStore.activeWallet,
      kiosk: walletStore.kioskEnabled === true,
      appLock: walletStore.biometricsEnabled === true,
      lastPaid: lastPaid ? contactSummary(lastPaid) : null,
      contacts: addressBook.entries.map(contactSummary),
      // Watched, not planned: what publishes again once they change.
      locale: i18n.global.locale,
      rebuilding: addressBook.isRecovering === true,
    };
  });

  async function publish() {
    // A failed load leaves the store empty: never switch everything off on
    // that. Nor while the address book is rebuilt (another identity's list):
    // it is empty for a moment, and the end of the rebuild publishes again.
    if (stopped || !walletStore.hydrated || !walletStore.savedStateLoaded) return;
    await addressBook.initialize();
    if (addressBook.isRecovering) return;
    const { shortcuts: pinned } = await getPinnedShortcuts();
    const plan = planQuickAccess({ ...state.value, pinned }, t);
    const signature = JSON.stringify([plan, pinned]);
    if (signature === published) return;
    await setTiles(plan.tiles);
    await applyShortcuts(plan.shortcuts);
    published = signature;
  }

  function publishBounded() {
    return withTimeout(publish(), PUBLISH_TIMEOUT_MS);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      queue = queue
        .then(publishBounded)
        .catch((err) => console.warn('[quick-access] Could not update the tiles and shortcuts:', err?.message || err));
    }, SYNC_DEBOUNCE_MS);
  }

  watch(() => JSON.stringify(state.value), schedule);
  walletStore.whenHydrated().then(schedule, () => { /* nothing loaded, nothing to publish */ });

  import('@capacitor/app')
    .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => { if (isActive) schedule(); }))
    .then((listener) => {
      if (stopped) listener.remove();
      else resumeListener = listener;
    })
    .catch(() => { /* resumes just won't re-check */ });

  onUnmounted(() => {
    stopped = true;
    clearTimeout(timer);
    resumeListener?.remove();
  });
}
