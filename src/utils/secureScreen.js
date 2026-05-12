/**
 * Screen-capture protection wrapper.
 *
 * Prevents OS-level screenshots and screen recording of the current
 * screen while sensitive UI is visible. Uses Capacitor's runtime
 * plugin-availability check so this module is safe to call whether
 * or not the native plugin is installed — it degrades to a no-op.
 *
 * To activate on Android/iOS, install the companion plugin:
 *   npm install @capacitor-community/privacy-screen
 *   npx cap sync
 *
 * With the plugin installed this applies FLAG_SECURE on Android and
 * adds a privacy overlay on iOS when the app backgrounds. On web and
 * on native builds without the plugin, `enable`/`disable` are no-ops.
 * A one-time warning is logged so the missing dependency is visible
 * in development without spamming the console.
 */
import { Capacitor } from '@capacitor/core';

let missingPluginWarned = false;

function getPlugin() {
  if (!Capacitor.isNativePlatform()) return null;

  if (!Capacitor.isPluginAvailable('PrivacyScreen')) {
    if (!missingPluginWarned) {
      console.warn(
        '[secureScreen] PrivacyScreen plugin not installed. ' +
        'Install @capacitor-community/privacy-screen to enable screenshot protection.'
      );
      missingPluginWarned = true;
    }
    return null;
  }

  return Capacitor.Plugins.PrivacyScreen;
}

export const secureScreen = {
  async enable() {
    const plugin = getPlugin();
    if (!plugin) return;
    try {
      await plugin.enable();
    } catch (err) {
      console.warn('[secureScreen] enable failed', err);
    }
  },

  async disable() {
    const plugin = getPlugin();
    if (!plugin) return;
    try {
      await plugin.disable();
    } catch (err) {
      console.warn('[secureScreen] disable failed', err);
    }
  },
};
