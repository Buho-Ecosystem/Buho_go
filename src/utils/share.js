/**
 * Share utility for native and web share functionality.
 * Uses @capacitor/share on native platforms, falls back to Web Share API.
 */

import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'

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
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title, text, url, dialogTitle: title })
      return { success: true }
    }

    if (navigator.share) {
      await navigator.share({ title, text, url })
      return { success: true }
    }

    return { success: false, reason: 'unsupported' }
  } catch (error) {
    // User cancelled the share dialog (iOS throws, Android resolves silently)
    if (
      error.name === 'AbortError' ||
      error.message?.toLowerCase().includes('cancel') ||
      error.message?.toLowerCase().includes('abort')
    ) {
      return { success: false, reason: 'cancelled' }
    }

    // Capacitor "UNAVAILABLE" when Share API is missing on web fallback
    if (error.code === 'UNAVAILABLE') {
      return { success: false, reason: 'unsupported' }
    }

    return { success: false, reason: 'error', error }
  }
}
