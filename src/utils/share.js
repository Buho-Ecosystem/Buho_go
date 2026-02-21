/**
 * Share utility for native and web share functionality
 * Uses Web Share API with native platform detection for future Capacitor support
 */

import { Capacitor } from '@capacitor/core';

/**
 * Share content using native share dialog or Web Share API
 * @param {Object} options - Share options
 * @param {string} options.title - Share title
 * @param {string} options.text - Text to share
 * @param {string} options.url - URL to share (optional)
 * @returns {Promise<{success: boolean, reason?: string, error?: Error}>}
 */
export async function shareContent({ title, text, url }) {
  try {
    // For native platforms, try to use Capacitor Share if available
    // Note: @capacitor/share must be installed separately for native builds
    if (Capacitor.isNativePlatform() && window.Capacitor?.Plugins?.Share) {
      await window.Capacitor.Plugins.Share.share({ title, text, url });
      return { success: true };
    }

    // Use Web Share API for PWA/browser
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return { success: true };
    } else {
      // No share available - return false to trigger fallback
      return { success: false, reason: 'unsupported' };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, reason: 'cancelled' };
    }
    return { success: false, reason: 'error', error };
  }
}
