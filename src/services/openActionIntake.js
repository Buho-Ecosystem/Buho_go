import { isOpenActionStale, isOpenActionUrl, parseOpenAction, shortcutIdForAction } from '../utils/openActions.js';
import { whenAppUnlocked } from '../utils/appLock.js';

/** The last action taken in; an older one still waiting gives way to it. */
let latest = 0;

/**
 * Take an open link (utils/openActions.js) from src/boot/deep-links.js.
 *
 * Runs after the kiosk intake, so a locked kiosk has already consumed the
 * link. Every open link is consumed here, including one that is dropped: it
 * is ours, and "BuhoGO can't open this link" would be wrong for it.
 *
 * Nothing moves until the saved wallets are read (a cold start) and the app
 * lock is passed: the page the person is on is only left for an action that
 * will open. Then Send, Receive, Scan and Pay are handed to the wallet page
 * through `store.pendingOpenAction` (Wallet.vue `openWhenUnlocked`), and the
 * settings sheet opens in Settings.
 *
 * Only the last tap counts: an action still waiting (behind the lock, say)
 * is dropped when a newer one comes in, and so is one that waited longer
 * than OPEN_ACTION_TTL_MS.
 *
 * @param {string} url
 * @param {object} store  the wallet store
 * @param {{ currentRoute: object, push: Function }} router
 * @param {{ now?: () => number, reportShortcutUsed?: (id: string) => void, unlocked?: () => Promise<void> }} [options]
 * @returns {boolean} true when the link was an open link
 */
export function offerOpenAction(url, store, router, { now = Date.now, reportShortcutUsed, unlocked = whenAppUnlocked } = {}) {
  if (!isOpenActionUrl(url)) return false;

  const parsed = parseOpenAction(url);
  if (!parsed) {
    console.warn('[open-action] Dropped an open link it could not read');
    return true;
  }

  // The launcher ranks the shortcuts people actually use.
  if (parsed.source === 'shortcut' && reportShortcutUsed) {
    const id = shortcutIdForAction(parsed);
    if (id) reportShortcutUsed(id);
  }

  const action = { ...parsed, receivedAt: now(), seq: ++latest };
  deliver(action, store, router, { now, unlocked })
    .catch((err) => console.warn('[open-action] Could not open the screen:', err?.message || err));
  return true;
}

/**
 * Whether an action handed over is still the one to open: no newer one came
 * in and it has not waited too long. Wallet.vue asks again after its own
 * waits.
 *
 * @param {{ seq?: number, receivedAt?: number }} action
 * @param {number} [now]
 */
export function isOpenActionCurrent(action, now = Date.now()) {
  return action?.seq === latest && !isOpenActionStale(action, now);
}

async function deliver(action, store, router, { now, unlocked }) {
  // A link that started the app can come before the saved wallets are read.
  await Promise.resolve(store.whenHydrated?.()).catch(() => { /* checked below */ });
  await unlocked();
  if (!isOpenActionCurrent(action, now())) return;

  if (action.kind === 'quick-access') {
    router.push({ path: '/settings', query: { section: 'quick-access' } }).catch(() => { /* navigation rejection is non-fatal */ });
    return;
  }

  // Tiles and shortcuts are switched off without a wallet and in kiosk mode
  // (useQuickAccessSync); one that still fires (a launcher that kept a stale
  // copy, another app) opens nothing.
  if (!store.activeWallet || store.kioskEnabled) {
    console.info('[open-action] Nothing to open: no wallet, or kiosk mode is on');
    return;
  }

  store.pendingOpenAction = action;
  if (router.currentRoute.value?.path !== '/wallet') {
    router.push('/wallet').catch(() => { /* navigation rejection is non-fatal */ });
  }
}
