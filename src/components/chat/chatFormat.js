/**
 * Pure display helpers shared by the chat components. No Vue, no stores, no
 * i18n: anything that needs a sentence takes it from the component.
 */

import { formatAmount } from '../../utils/amountFormatting.js'

/** Emoji offered in the message menu, in display order. */
export const REACTION_EMOJIS = Object.freeze(['👍', '❤️', '😂', '🙏', '🎉'])

/** Local-send states of an outgoing message (mirrors stores/messages.js DELIVERY). */
export const DELIVERY_STATES = Object.freeze(['queued', 'sending', 'sent', 'failed'])

/** Derived request states (mirrors stores/messages.js REQUEST_STATE). */
export const REQUEST_STATES = Object.freeze(['pending', 'paid', 'declined', 'cancelled', 'expired'])

const toMs = (unixSeconds) => unixSeconds * 1000

/** "14:05" in the device's locale. Empty for a missing or invalid time. */
export function formatClock(unixSeconds) {
  if (!Number.isFinite(unixSeconds)) return ''
  return new Date(toMs(unixSeconds)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** True when two unix-second timestamps fall on the same local calendar day. */
export function isSameDay(a, b) {
  const da = new Date(toMs(a))
  const db = new Date(toMs(b))
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
}

/**
 * "14:05" for today, "12 Oct, 14:05" otherwise. Used for "valid until".
 * @param {number} unixSeconds
 * @param {number} [nowMs]
 */
export function formatWhen(unixSeconds, nowMs = Date.now()) {
  if (!Number.isFinite(unixSeconds)) return ''
  if (isSameDay(unixSeconds, nowMs / 1000)) return formatClock(unixSeconds)
  return new Date(toMs(unixSeconds)).toLocaleString([], {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** "5,000 sats" or "₿ 5,000" (the user's BIP-177 setting). Sats are whole numbers. */
export function formatSats(amountSats, bip177 = true) {
  return formatAmount(Number.isFinite(amountSats) ? amountSats : 0, bip177)
}

/**
 * One or two capital letters for an avatar without a picture. Splits on
 * whitespace and keeps whole code points, so emoji and non-Latin names work.
 */
export function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  const first = [...words[0]][0]
  const second = words.length > 1 ? [...words[words.length - 1]][0] : ''
  return (first + second).toLocaleUpperCase()
}

/** "npub1abcdef…wxyz9": enough to tell two profiles apart, never the whole key. */
export function shortNpub(npub) {
  const value = String(npub || '')
  if (value.length <= 20) return value
  return `${value.slice(0, 11)}…${value.slice(-5)}`
}

/** Characters as a person counts them (code points), not UTF-16 units. */
export function countChars(text) {
  return [...String(text || '')].length
}

/**
 * Inserts a `day` item before the first item of every calendar day.
 * Items are `{ key, ts, ... }` in ascending time; `ts` is unix seconds.
 * Existing `day` items are dropped first, so the function is idempotent.
 * @param {Array<{ key: string, type: string, ts: number }>} items
 */
export function insertDaySeparators(items) {
  const out = []
  let lastTs = null
  for (const item of items) {
    if (item.type === 'day') continue
    if (lastTs === null || !isSameDay(lastTs, item.ts)) {
      out.push({ key: `day-${new Date(toMs(item.ts)).toDateString()}`, type: 'day', ts: item.ts })
    }
    out.push(item)
    lastTs = item.ts
  }
  return out
}
