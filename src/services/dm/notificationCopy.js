/**
 * The words of a chat notification.
 *
 * The runtime decides WHETHER and WHERE to notify and never owns a string;
 * this module turns a parsed `ChatMessage` into the translated body line. The
 * translator and the amount formatter are injected, so the module is plain
 * data in, string out.
 *
 * Money first: a request, a payment or an answer to a request is announced
 * with what it is (and the amount). A text shows a
 * short preview, the way every chat app does; the Settings switch for message
 * notifications is the user's way to turn that off.
 *
 * Copy keys (English text is the key, like the rest of the app):
 *   'New message'
 *   'Requested {amount}'
 *   'Sent you {amount}'
 *   'Paid your request'
 *   'Declined your request'
 *   'Withdrew a request'
 *   'Reminder: a request is still open'
 */

import { MESSAGE_TYPE, REQUEST_STATUS } from './protocol.js';

/** Longest text preview, in characters (not code units). */
export const PREVIEW_LENGTH = 100;

function preview(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > PREVIEW_LENGTH ? `${chars.slice(0, PREVIEW_LENGTH - 1).join('')}…` : flat;
}

/**
 * @param {object} options
 * @param {(key: string, params?: object) => string} options.t Translator.
 * @param {(sats: number) => string} options.formatAmount Amount in the user's preferred unit.
 * @returns {(message: import('./protocol.js').ChatMessage) => string}
 */
export function createNotificationFormatter({ t, formatAmount }) {
  return function formatNotification(message) {
    switch (message?.type) {
      case MESSAGE_TYPE.REQUEST:
        if (message.request) return t('Requested {amount}', { amount: formatAmount(message.request.amountSats) });
        break;
      case MESSAGE_TYPE.PAYMENT:
        if (message.payment) return t('Sent you {amount}', { amount: formatAmount(message.payment.amountSats) });
        break;
      case MESSAGE_TYPE.STATUS:
        switch (message.status?.value) {
          case REQUEST_STATUS.PAID: return t('Paid your request');
          case REQUEST_STATUS.DECLINED: return t('Declined your request');
          case REQUEST_STATUS.CANCELLED: return t('Withdrew a request');
          case REQUEST_STATUS.REMINDER: return t('Reminder: a request is still open');
          default: break;
        }
        break;
      case MESSAGE_TYPE.TEXT: {
        const text = preview(message.text);
        if (text) return text;
        break;
      }
      default:
        break;
    }
    return t('New message');
  };
}
