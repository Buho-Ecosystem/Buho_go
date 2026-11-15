import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Quick access: the Quick Settings tiles (issue #445) and the launcher
 * shortcuts (issue #446). A thin facade over the in-repo QuickAccessPlugin
 * (src-capacitor/android/.../QuickAccessPlugin.java). What to publish is
 * decided in utils/quickAccessPlan.js and kept up to date by
 * composables/useQuickAccessSync.js; this module only carries it across.
 *
 * Android only. Elsewhere every call resolves to "nothing there", so shared
 * code can call it without asking first.
 */

// Must match @CapacitorPlugin(name = "QuickAccess") in Java.
const QuickAccessPlugin = registerPlugin('QuickAccess');

/** The tiles a person can add: Send and Receive. */
export const TILE_KINDS = Object.freeze(['send', 'receive']);

export function quickAccessSupported() {
  return Capacitor.getPlatform() === 'android';
}

/**
 * The shortcuts the person pinned to their Home screen, and whether their
 * launcher lets the app offer one.
 * @returns {Promise<{ pinSupported: boolean, shortcuts: Array<{ id: string, enabled: boolean }> }>}
 */
export async function getPinnedShortcuts() {
  if (!quickAccessSupported()) return { pinSupported: false, shortcuts: [] };
  const result = await QuickAccessPlugin.getPinnedShortcuts();
  return {
    pinSupported: result?.pinSupported === true,
    shortcuts: Array.isArray(result?.shortcuts) ? result.shortcuts : [],
  };
}

/**
 * Publish a plan's shortcuts (utils/quickAccessPlan.js `shortcuts`): the
 * long-press menu, the pinned ones to bring up to date, and the pinned ones to
 * switch off with the reason the launcher shows when tapped.
 * @param {{ menu: object[], pinned: object[], disabled: Array<{ ids: string[], message: string }> }} shortcuts
 */
export async function applyShortcuts(shortcuts) {
  if (!quickAccessSupported()) return;
  await QuickAccessPlugin.applyShortcuts(shortcuts);
}

/**
 * Ask the launcher to put one shortcut on the Home screen. The launcher shows
 * its own confirmation; resolves false when it cannot.
 * @param {object} shortcut  a shortcut as utils/quickAccessPlan.js describes it
 * @returns {Promise<boolean>}
 */
export async function requestPinShortcut(shortcut) {
  if (!quickAccessSupported()) return false;
  const result = await QuickAccessPlugin.requestPinShortcut({ shortcut });
  return result?.requested === true;
}

/** Tell the launcher a shortcut was used, so it can rank it. Best effort. */
export function reportShortcutUsed(id) {
  if (!quickAccessSupported() || !id) return;
  QuickAccessPlugin.reportShortcutUsed({ id }).catch(() => { /* ranking only */ });
}

/**
 * Which tiles are in Quick Settings, and whether this Android can ask to add
 * one (13 and newer).
 * @returns {Promise<{ canRequest: boolean, added: { send: boolean, receive: boolean } }>}
 */
export async function getTiles() {
  if (!quickAccessSupported()) return { canRequest: false, added: { send: false, receive: false } };
  const result = await QuickAccessPlugin.getTiles();
  return {
    canRequest: result?.canRequest === true,
    added: { send: result?.send === true, receive: result?.receive === true },
  };
}

/**
 * Ask Android to add a tile; it shows its own dialog.
 * @param {'send'|'receive'} kind
 * @param {string} label  the tile's name, in the app's language
 * @returns {Promise<'added'|'already-added'|'not-added'|'unsupported'|'failed'>}
 */
export async function requestAddTile(kind, label) {
  if (!quickAccessSupported() || !TILE_KINDS.includes(kind)) return 'unsupported';
  const result = await QuickAccessPlugin.requestAddTile({ kind, label });
  return result?.result || 'failed';
}

/**
 * The tiles' state: usable or greyed out, and their names in the app's language.
 * @param {{ available: boolean, labels: { send: string, receive: string } }} tiles
 */
export async function setTiles(tiles) {
  if (!quickAccessSupported()) return;
  await QuickAccessPlugin.setTiles(tiles);
}
