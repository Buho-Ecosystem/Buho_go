/**
 * Pure display helpers shared by the chat components. No Vue, no stores, no
 * i18n: anything that needs a sentence takes it from the component.
 */

import { REQUEST_STATE } from '../../services/dm/constants.js'

/** Emoji offered in the message menu, in display order. */
export const REACTION_EMOJIS = Object.freeze(['👍', '❤️', '😂', '🙏', '🎉'])

/** Every state a request card can show (one definition: services/dm/constants.js). */
export const REQUEST_STATES = Object.freeze(Object.values(REQUEST_STATE))

const toMs = (unixSeconds) => unixSeconds * 1000

/**
 * "14:05". Dates and times follow the app's language (`locale`, the
 * vue-i18n locale), not the device's: a German screen never says "Oct".
 * Empty for a missing or invalid time.
 */
export function formatClock(unixSeconds, locale) {
  if (!Number.isFinite(unixSeconds)) return ''
  return new Date(toMs(unixSeconds)).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
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
 * @param {string} [locale] the app's language
 */
export function formatWhen(unixSeconds, nowMs = Date.now(), locale) {
  if (!Number.isFinite(unixSeconds)) return ''
  if (isSameDay(unixSeconds, nowMs / 1000)) return formatClock(unixSeconds, locale)
  return new Date(toMs(unixSeconds)).toLocaleString(locale, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** "5,000 sats" or "₿ 5,000" (the user's BIP-177 setting). Sats are whole numbers. */
export function formatSats(amountSats, bip177 = true, locale) {
  const formatted = Math.abs(Number.isFinite(amountSats) ? amountSats : 0).toLocaleString(locale)
  return bip177 ? `₿ ${formatted}` : `${formatted} sats`
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
