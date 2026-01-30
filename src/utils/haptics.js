/**
 * Haptic Feedback Utility
 * Provides native haptic feedback on iOS/Android via Capacitor
 */

import { Capacitor } from '@capacitor/core';

// Check if haptics are available
const isNative = Capacitor.isNativePlatform();
const HapticsPlugin = isNative ? Capacitor.Plugins?.Haptics : null;

/**
 * Haptic feedback types
 */
export const haptics = {
  /**
   * Light tap - for selections, toggles
   */
  tap: async () => {
    if (HapticsPlugin?.impact) {
      try {
        await HapticsPlugin.impact({ style: 'LIGHT' });
      } catch (e) {
        // Haptics not available
      }
    }
  },

  /**
   * Medium tap - for confirmations
   */
  medium: async () => {
    if (HapticsPlugin?.impact) {
      try {
        await HapticsPlugin.impact({ style: 'MEDIUM' });
      } catch (e) {
        // Haptics not available
      }
    }
  },

  /**
   * Success notification - for completed actions
   */
  success: async () => {
    if (HapticsPlugin?.notification) {
      try {
        await HapticsPlugin.notification({ type: 'SUCCESS' });
      } catch (e) {
        // Haptics not available
      }
    }
  },

  /**
   * Error notification - for failed actions
   */
  error: async () => {
    if (HapticsPlugin?.notification) {
      try {
        await HapticsPlugin.notification({ type: 'ERROR' });
      } catch (e) {
        // Haptics not available
      }
    }
  },

  /**
   * Warning notification
   */
  warning: async () => {
    if (HapticsPlugin?.notification) {
      try {
        await HapticsPlugin.notification({ type: 'WARNING' });
      } catch (e) {
        // Haptics not available
      }
    }
  }
};

export default haptics;
