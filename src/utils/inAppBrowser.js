import { Capacitor } from '@capacitor/core'

/**
 * Open a URL inside the app instead of kicking the user out to the system
 * browser. On native this uses the Capacitor Browser plugin (Chrome Custom
 * Tab on Android, SFSafariViewController on iOS) — the App-Store / Play-blessed
 * way to show web content without "leaving" the app. On web it falls back to
 * a new tab.
 *
 * Use this for any merchant web link (website, social profiles) so we never
 * href users out of the Capacitor shell.
 *
 * @param {string} url absolute http(s) URL
 */
export async function openInAppBrowser(url) {
  if (!url) return
  if (Capacitor.isNativePlatform()) {
    try {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url, presentationStyle: 'popover' })
      return
    } catch {
      // Fall through to window.open if the plugin is unavailable.
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
