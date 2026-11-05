/**
 * Wallet apps on this phone, through the native WalletApps plugin.
 *
 * Connecting: the apps that can approve a connection request
 * (nostr+walletauth), for the "Wallet app on this phone" choice. The Android
 * app asks the system (WalletAppsPlugin; the scheme is declared in the
 * manifest's <queries>). The web cannot know, so an Android browser is
 * offered the app instead: the choice explains that it works in BuhoGO for
 * Android and links the stores. Elsewhere (desktop, iPhone) it is not
 * offered.
 *
 * Paying: the apps that can pay a request, for "Pay from another wallet" on
 * Receive. Two ways to find them, by platform:
 *   system   (android) the system names every app that takes the
 *            lightning:/bitcoin: link, with its own icon; the wallets
 *            opened by a web link are asked for by package
 *   catalog  (ios) the system cannot list them, so each wallet in
 *            utils/walletAppLinks.js is asked about by its own link; a
 *            plain lightning: link is never handed over there, as the
 *            system could open any wallet with it, BuhoGO included
 * BuhoGO itself is never among them.
 *
 * The native plugin, one name on both platforms:
 *   handlers({ url, icons? }) → { apps: [{ name, packageName, icon? }] }   android
 *   installed({ urls }) → { installed: [url] }                             ios
 *   open({ url, packageName?, appOnly? }) → { opened }                     both
 * `open` takes `packageName` on android, which pins the app; `appOnly` asks
 * ios to open a web link in its app or not at all, never the browser.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { WALLET_APP_LINKS, detectionLinks, requestKind, walletAppLink } from '../utils/walletAppLinks.js';

const WalletApps = registerPlugin('WalletApps');

/** Any connection request; only its scheme matters to the system. */
const REQUEST_PROBE = 'nostr+walletauth://';

/**
 * The wallet apps installed, by name: [] when none, null when this cannot
 * be known here (the web, or a build without the native check).
 * @returns {Promise<{ name: string, packageName: string }[] | null>}
 */
export async function findWalletApps({ native = Capacitor.isNativePlatform(), plugin = WalletApps } = {}) {
  if (!native) return null;
  try {
    const { apps } = await plugin.handlers({ url: REQUEST_PROBE });
    return Array.isArray(apps) ? apps.filter((app) => app?.name) : [];
  } catch {
    return null;
  }
}

/**
 * Whether and how to offer a wallet app on this phone.
 *
 *   open     the app has found wallet apps: open them (`names` for the row)
 *   get-app  an Android browser: explain BuhoGO for Android, link the stores
 *   null     not offered
 *
 * @param {{ apps: object[] | null, native: boolean, userAgent: string }} device
 * @returns {{ mode: 'open', names: string[] } | { mode: 'get-app' } | null}
 */
export function walletAppOffer({ apps, native, userAgent }) {
  if (native) return apps?.length ? { mode: 'open', names: [...new Set(apps.map((app) => app.name))] } : null;
  return /\bAndroid\b/i.test(String(userAgent || '')) ? { mode: 'get-app' } : null;
}

/** Where the last app picked to pay is kept, on this phone only. */
export const LAST_PAYING_APP_KEY = 'buhoGO_lastPayingApp';

/**
 * A wallet app that can pay a request.
 * `appOnly`: the link is a web link that must open the app or nothing.
 * @typedef {{ id: string, name: string, icon: string, link: string, packageName?: string, appOnly?: boolean, lastUsed: boolean }} PayingApp
 */

/**
 * The wallet apps on this phone that can pay `request` (a lightning:… or
 * bitcoin:… link): the one picked last first, then by name. [] when none;
 * null when this cannot be known here (the web, or a build without the
 * native check).
 * @param {string} request
 * @returns {Promise<PayingApp[] | null>}
 */
export async function findPayingApps(request, {
  platform = Capacitor.getPlatform(),
  plugin = WalletApps,
  storage = safeStorage(),
} = {}) {
  const kind = requestKind(request);
  if (!kind) return [];
  const wallets = WALLET_APP_LINKS.filter((wallet) => wallet.pays.includes(kind));
  let apps;
  try {
    if (platform === 'android') apps = await systemPayingApps(request, wallets, plugin);
    else if (platform === 'ios') apps = await catalogPayingApps(request, wallets, plugin);
    else return null;
  } catch {
    return null;
  }
  const last = readLast(storage);
  return apps
    .map((app) => ({ ...app, lastUsed: app.id === last }))
    .sort((a, b) => Number(b.lastUsed) - Number(a.lastUsed) || a.name.localeCompare(b.name));
}

/** The apps the system names for the request, then the web-link wallets by package. */
async function systemPayingApps(request, wallets, plugin) {
  const named = async (url) => {
    const { apps } = await plugin.handlers({ url, icons: true });
    return (Array.isArray(apps) ? apps : []).filter((app) => app?.name && app?.packageName);
  };
  const toApp = (app, link, appOnly = false) => ({
    id: app.packageName, name: app.name, icon: app.icon || '', link, packageName: app.packageName, ...(appOnly ? { appOnly } : {}),
  });
  const apps = (await named(request)).map((app) => toApp(app, request));
  for (const wallet of wallets.filter((entry) => entry.androidPackage)) {
    if (apps.some((app) => app.packageName === wallet.androidPackage)) continue;
    const link = walletAppLink(wallet, request);
    const found = (await named(link)).find((app) => app.packageName === wallet.androidPackage);
    if (found) apps.push(toApp(found, link, true));
  }
  return apps;
}

/** Each catalog wallet, found by the links that reveal it. */
async function catalogPayingApps(request, wallets, plugin) {
  const candidates = wallets.map((wallet) => ({ wallet, probes: detectionLinks(wallet, request) }));
  const { installed } = await plugin.installed({ urls: [...new Set(candidates.flatMap((candidate) => candidate.probes))] });
  const open = new Set(Array.isArray(installed) ? installed : []);
  return candidates
    .filter((candidate) => candidate.probes.some((probe) => open.has(probe)))
    .map(({ wallet }) => ({
      id: wallet.id, name: wallet.name, icon: wallet.logo, link: walletAppLink(wallet, request), ...(wallet.web ? { appOnly: true } : {}),
    }));
}

/**
 * Opens `app` with its request and remembers it as the one picked last.
 * Resolves whether the app opened.
 * @param {PayingApp} app
 */
export async function openPayingApp(app, { plugin = WalletApps, storage = safeStorage() } = {}) {
  let opened = false;
  try {
    const result = await plugin.open({
      url: app.link,
      ...(app.packageName ? { packageName: app.packageName } : {}),
      ...(app.appOnly ? { appOnly: true } : {}),
    });
    opened = result?.opened === true;
  } catch {
    opened = false;
  }
  if (opened) {
    try { storage?.setItem(LAST_PAYING_APP_KEY, app.id); } catch { /* a preference, not state */ }
  }
  return opened;
}

/**
 * Whether the sheet opens by itself once Receive has the amount it asked
 * for. On ios it waits for a tap on the row instead, so the person sees the
 * new invoice first (a product decision; the sheet opening over it there
 * read as abrupt).
 */
export function sheetFollowsAmount(platform = Capacitor.getPlatform()) {
  return platform !== 'ios';
}

/**
 * The row's wait for an amount. Tapped without one, the row sends the
 * person to the amount (`ask`); when the request then carries it, `arrived`
 * says whether the sheet opens now. Back from the keypad without an amount,
 * `rowShown` drops the wait.
 */
export function createAmountWait(follows = sheetFollowsAmount()) {
  let waiting = false;
  return {
    ask() { waiting = follows; },
    arrived(request) {
      if (!request) return false;
      const opens = waiting;
      waiting = false;
      return opens;
    },
    rowShown(request) { if (!request) waiting = false; },
  };
}

function readLast(storage) {
  try { return storage?.getItem(LAST_PAYING_APP_KEY) || ''; } catch { return ''; }
}

function safeStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
