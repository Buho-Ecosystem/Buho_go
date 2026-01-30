/**
 * Clipboard composable for copy/share functionality
 * Provides consistent copy and share behavior across the app
 */

import { useQuasar } from 'quasar';
import { useI18n } from 'vue-i18n';
import { shareContent } from '../utils/share';

/**
 * Composable for clipboard and share operations
 * @returns {Object} Clipboard methods
 */
export function useClipboard() {
  const $q = useQuasar();
  const { t } = useI18n();

  /**
   * Copy text to clipboard with notification
   * @param {string} text - Text to copy
   * @param {string} successMessage - Custom success message (optional)
   * @param {string} errorMessage - Custom error message (optional)
   * @returns {Promise<boolean>} Success status
   */
  async function copyToClipboard(text, successMessage, errorMessage) {
    if (!text) return false;

    try {
      await navigator.clipboard.writeText(text);
      $q.notify({
        type: 'positive',
        message: successMessage || t('Copied'),
        actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
      });
      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      $q.notify({
        type: 'negative',
        message: errorMessage || t('Failed to copy'),
        actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
      });
      return false;
    }
  }

  /**
   * Share content with native share dialog, fallback to copy
   * @param {Object} options - Share options
   * @param {string} options.title - Share title
   * @param {string} options.text - Text to share
   * @param {string} options.url - URL to share (optional)
   * @param {Function} options.onCopyFallback - Custom copy fallback function (optional)
   * @returns {Promise<{success: boolean, method: string}>}
   */
  async function share({ title, text, url, onCopyFallback }) {
    const result = await shareContent({ title, text, url });

    if (result.success) {
      // Share was successful - native share UI provides feedback
      return { success: true, method: 'share' };
    }

    if (result.reason === 'cancelled') {
      // User cancelled - no action needed
      return { success: false, method: 'cancelled' };
    }

    // Share failed or unsupported - fallback to copy
    if (result.reason === 'error') {
      console.error('Share failed:', result.error);
    }

    // Use custom fallback or default copy
    if (onCopyFallback) {
      await onCopyFallback();
    } else {
      await copyToClipboard(text);
    }

    return { success: true, method: 'copy' };
  }

  /**
   * Copy address with appropriate message
   * @param {string} address - Address to copy
   * @param {string} type - Address type ('spark', 'bitcoin', 'lightning', 'invoice')
   * @returns {Promise<boolean>}
   */
  async function copyAddress(address, type = 'address') {
    const messages = {
      spark: t('Spark address copied'),
      bitcoin: t('Address copied'),
      lightning: t('Address copied'),
      invoice: t('Invoice copied'),
      address: t('Address copied')
    };
    return copyToClipboard(address, messages[type] || messages.address);
  }

  /**
   * Share address with appropriate title
   * @param {string} address - Address to share
   * @param {string} type - Address type ('spark', 'bitcoin', 'lightning')
   * @returns {Promise<{success: boolean, method: string}>}
   */
  async function shareAddress(address, type = 'address') {
    const titles = {
      spark: t('Spark Address'),
      bitcoin: t('Bitcoin Address'),
      lightning: t('Lightning Address'),
      address: t('Address')
    };

    return share({
      title: titles[type] || titles.address,
      text: address,
      onCopyFallback: () => copyAddress(address, type)
    });
  }

  return {
    copyToClipboard,
    share,
    copyAddress,
    shareAddress
  };
}
