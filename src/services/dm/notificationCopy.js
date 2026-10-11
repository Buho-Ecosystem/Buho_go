/**
 * The words of a chat notification.
 *
 * The runtime decides WHETHER and WHERE to notify and never owns a string;
 * this module turns a parsed `ChatMessage` into the translated body line. The
 * translator and the amount formatter are injected, so the module is plain
 * data in, string out.
 *
 * Money first: a request, a payment or an answer to a request is announced
 * with what it is (and the amount). A payment is only the sender's word until
 * the user's own wallet shows it, so the line says that: "Says they sent you"
 * (a lock screen must never confirm money that may not exist: "I sent you
 * 1,000,000 by mistake, send it back" is a known scam). A text shows a short
 * preview, the way every chat app does; the Settings switch for message
 * notifications is the user's way to turn that off. Someone outside the
 * address book gets no preview at all: one quiet "New message request".
 *
 * Copy keys (English text is the key, like the rest of the app):
 *   'New message'
 *   'New message request'
 *   'Requested {amount}'
 *   'Says they sent you {amount}'
 *   'Says they paid your request'
 *   'Declined your request'
 *   'Cancelled a request'
 *   'Reminder: a request is still open'
 */

import { MESSAGE_TYPE, REQUEST_STATUS, isFileMessage } from './protocol.js';

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
 * @returns {(message: import('./protocol.js').ChatMessage, context?: { known?: boolean }) => string}
 *   `known`: the sender is in the address book (default true).
 */
export function createNotificationFormatter({ t, formatAmount }) {
  return function formatNotification(message, { known = true } = {}) {
    if (!known) return t('New message request');
    switch (message?.type) {
      case MESSAGE_TYPE.REQUEST:
        if (message.request) return t('Requested {amount}', { amount: formatAmount(message.request.amountSats) });
        break;
      case MESSAGE_TYPE.PAYMENT:
        if (message.payment) return t('Says they sent you {amount}', { amount: formatAmount(message.payment.amountSats) });
        break;
      case MESSAGE_TYPE.STATUS:
        switch (message.status?.value) {
          case REQUEST_STATUS.PAID: return t('Says they paid your request');
          case REQUEST_STATUS.DECLINED: return t('Declined your request');
          case REQUEST_STATUS.CANCELLED: return t('Cancelled a request');
          case REQUEST_STATUS.REMINDER: return t('Reminder: a request is still open');
          default: break;
        }
        break;
      case MESSAGE_TYPE.TEXT: {
        if (isFileMessage(message)) return t('Sent a file');
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
