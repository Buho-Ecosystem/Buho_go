/**
 * Wallet apps on this phone that can approve a connection request
 * (nostr+walletauth), for the "Wallet app on this phone" choice.
 *
 * The Android app asks the system (WalletAppsPlugin; the scheme is declared
 * in the manifest's <queries>). The web cannot know, so an Android browser
 * is offered the app instead: the choice explains that it works in BuhoGO
 * for Android and links the stores. Elsewhere (desktop, iPhone) it is not
 * offered.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

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
