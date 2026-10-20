/**
 * Haptic feedback: a light physical answer to a moment that matters (the
 * slide arming and sending, a card read, a payment that failed), never to
 * every tap. Native apps only, through Capacitor's Haptics plugin; on the
 * web every call does nothing.
 *
 * The user can turn haptics off in Settings (on by default). The choice is
 * read once and kept here, so every call site respects it without knowing
 * about it. A phone whose own vibration or touch feedback is off stays
 * silent either way.
 */

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const STORAGE_KEY = 'buhoGO_haptics_enabled';

function readEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

let enabled = readEnabled();

/** True when haptics can play on this device: a native app. */
export function hapticsSupported() {
  return Capacitor.isNativePlatform();
}

/** The user's choice in Settings. */
export function hapticsEnabled() {
  return enabled;
}

/** @param {boolean} on */
export function setHapticsEnabled(on) {
  enabled = Boolean(on);
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Kept for this session only.
  }
}

/** One feedback, played only when it can and may; a failure is never the caller's problem. */
const feedback = (play) => async () => {
  if (!enabled || !hapticsSupported()) return;
  try {
    await play();
  } catch {
    // The device cannot play it.
  }
};

export const haptics = {
  /** Light tap: something snapped or was read (a card, a QR code, a threshold). */
  tap: feedback(() => Haptics.impact({ style: ImpactStyle.Light })),
  /** Medium tap: a commit point crossed (the slide armed, a sale parked). */
  medium: feedback(() => Haptics.impact({ style: ImpactStyle.Medium })),
  /** A completed action: sent, paid. */
  success: feedback(() => Haptics.notification({ type: NotificationType.Success })),
  /** A failed action. */
  error: feedback(() => Haptics.notification({ type: NotificationType.Error })),
  /** Something needs attention. */
  warning: feedback(() => Haptics.notification({ type: NotificationType.Warning })),
};

export default haptics;
