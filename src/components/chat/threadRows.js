/**
 * View-model of the Messages sheet: stored threads in, display rows out.
 *
 * Pure: no Vue, no stores, no i18n instance. The translator, the amount
 * formatter and the contact lookup are injected, so the same function serves
 * the sheet and its tests. Strings are English keys, like the rest of the app.
 */

import { contactChatRoute, contactPageRoute, unknownChatRoute } from '../../services/dm/routes.js'
import { createNotificationFormatter, PREVIEW_LENGTH } from '../../services/dm/notificationCopy.js'
import { MESSAGE_TYPE, REQUEST_STATUS } from '../../services/dm/protocol.js'
import { isSameDay, shortNpub } from './chatFormat.js'

const MAX_BADGE = 99

/** "3", or "99+" past the cap. Empty for nothing unread. */
export function badgeText(count) {
  if (!(count > 0)) return ''
  return count > MAX_BADGE ? `${MAX_BADGE}+` : String(count)
}

function flatten(text) {
  const chars = Array.from(String(text ?? '').replace(/\s+/g, ' ').trim())
  return chars.length > PREVIEW_LENGTH ? `${chars.slice(0, PREVIEW_LENGTH - 1).join('')}…` : chars.join('')
}

/**
 * One line for the last message of a thread. Money is spelled out ("Requested
 * 5,000 sats"); the user's own messages are phrased from their side.
 * @param {import('../../services/dm/protocol.js').ChatMessage} message
 * @param {{ t: Function, formatAmount: (sats: number) => string }} env
 */
export function previewLine(message, { t, formatAmount }) {
  if (!message) return ''
  if (!message.outgoing) return createNotificationFormatter({ t, formatAmount })(message)

  switch (message.type) {
    case MESSAGE_TYPE.REQUEST:
      if (message.request) return t('You requested {amount}', { amount: formatAmount(message.request.amountSats) })
      break
    case MESSAGE_TYPE.PAYMENT:
      if (message.payment) return t('You sent {amount}', { amount: formatAmount(message.payment.amountSats) })
      break
    case MESSAGE_TYPE.STATUS:
      switch (message.status?.value) {
        case REQUEST_STATUS.PAID: return t('You paid the request')
        case REQUEST_STATUS.DECLINED: return t('You declined the request')
        case REQUEST_STATUS.CANCELLED: return t('You cancelled a request')
        case REQUEST_STATUS.REMINDER: return t('You sent a reminder')
        default: break
      }
      break
    case MESSAGE_TYPE.TEXT: {
      const text = flatten(message.text)
      if (text) return `${t('You')}: ${text}`
      break
    }
    default:
      break
  }
  return t('New message')
}

/**
 * "14:05" today, "Yesterday", otherwise a short date. Unix seconds in.
 * @param {number} ts
 * @param {{ t: Function, nowMs?: number, locale?: string }} env
 */
export function threadTime(ts, { t, nowMs = Date.now(), locale } = {}) {
  if (!Number.isFinite(ts)) return ''
  const nowSec = nowMs / 1000
  if (isSameDay(ts, nowSec)) {
    return new Date(ts * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  }
  if (isSameDay(ts, nowSec - 86400)) return t('Yesterday')
  return new Date(ts * 1000).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

/**
 * Display rows for a list of store threads.
 * @param {Array<{ partner: string, lastMessage: object, lastActivityAt: number, unread: number, muted: boolean }>} threads
 * @param {object} env
 * @param {(pubkey: string) => ({ id: string|number, name: string } & object) | null} env.findContact
 * @param {(pubkey: string) => string} env.toNpub Bech32 form of a hex key.
 * @param {Function} env.t
 * @param {(sats: number) => string} env.formatAmount
 * @param {number} [env.nowMs]
 * @returns {Array<{ key: string, partner: string, known: boolean, name: string, avatarEntry: object,
 *   preview: string, time: string, unread: number, badge: string, muted: boolean, to: string }>}
 */
export function buildThreadRows(threads, env) {
  return threads.map((thread) => {
    const contact = env.findContact(thread.partner)
    const known = Boolean(contact)
    return {
      key: thread.partner,
      partner: thread.partner,
      known,
      name: known ? contact.name : shortNpub(env.toNpub(thread.partner)),
      avatarEntry: known ? contact : {},
      preview: previewLine(thread.lastMessage, env),
      time: threadTime(thread.lastActivityAt, env),
      unread: thread.unread,
      badge: badgeText(thread.unread),
      muted: Boolean(thread.muted),
      to: known ? contactChatRoute(contact.id) : unknownChatRoute(thread.partner),
    }
  })
}

/**
 * Where tapping an address-book contact leads: the chat for a contact with a
 * Nostr identity while the chat runs, the contact page otherwise (as before).
 * @param {{ id: string|number, nostr_pubkey?: string }} entry
 * @param {boolean} chatAvailable
 */
export function contactTapPath(entry, chatAvailable) {
  return chatAvailable && entry?.nostr_pubkey ? contactChatRoute(entry.id) : contactPageRoute(entry.id)
}
