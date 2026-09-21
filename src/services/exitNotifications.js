/**
 * The one reminder the emergency exit sends: when the money unlocks. Talks
 * to the LocalNotifications native plugin through Capacitor's runtime
 * registry, so the web build needs no package and a device without the
 * plugin reports that reminders are unavailable; the copy then says "open
 * the app on the day" instead of promising a notification.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

const UNLOCK_ID_BASE = 74_000;

const LocalNotifications = Capacitor.isNativePlatform() ? registerPlugin('LocalNotifications') : null;

async function plugin() {
  if (!LocalNotifications) return null;
  try {
    // A plugin that is not compiled in throws here; that is the "unavailable" answer.
    await LocalNotifications.checkPermissions();
    return LocalNotifications;
  } catch {
    return null;
  }
}

export async function remindersAvailable() {
  const notifications = await plugin();
  if (!notifications) return false;
  try {
    const status = await notifications.checkPermissions();
    return status?.display === 'granted' || status?.display === 'prompt';
  } catch {
    return false;
  }
}

function idFor(walletId) {
  let hash = 0;
  for (const char of String(walletId)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return UNLOCK_ID_BASE + (hash % 100000);
}

/** Schedule (or move) the unlock reminder. Returns true when a reminder exists. */
export async function scheduleUnlockReminder({ walletId, at, title, body }) {
  const notifications = await plugin();
  if (!notifications || !at) return false;
  try {
    const permission = await notifications.requestPermissions();
    if (permission?.display !== 'granted') return false;
    const id = idFor(walletId);
    await notifications.cancel({ notifications: [{ id }] }).catch(() => {});
    await notifications.schedule({ notifications: [{ id, title, body, schedule: { at: new Date(at), allowWhileIdle: true } }] });
    return true;
  } catch {
    return false;
  }
}

export async function cancelUnlockReminder(walletId) {
  const notifications = await plugin();
  if (!notifications) return;
  await notifications.cancel({ notifications: [{ id: idFor(walletId) }] }).catch(() => {});
}
