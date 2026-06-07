/**
 * Resolve the *person* behind a Nostr-native Lightning Address.
 *
 * Hosted ecash providers like npub.cash use a bech32 npub as the local part of
 * the address (`<npub1…>@npub.cash`). That key identifies a real Nostr profile,
 * so the send sheet can show someone's name + avatar instead of a 63-char key.
 *
 * This is the pure half — detect, decode, format, sanitize — kept free of any
 * network or Vue coupling so it stays unit-testable under plain Node. The async
 * profile fetch and the reactive patching live in the caller (Wallet.vue),
 * which already owns the relay pool and the async-enrich-after-render pattern
 * (see runBrantaVerification).
 */
import { nip19 } from 'nostr-core'
import { classifyIdentifier } from '../utils/nostrLookup.js'

const HEX64_RE = /^[0-9a-f]{64}$/
const SAFE_IMAGE_RE = /^(https?:|data:image\/)/i

/**
 * Decode the npub local part of a Lightning Address to a pubkey.
 *
 * @param {string} address  a Lightning Address, "<local>@<domain>"
 * @returns {{ pubkey: string, npub: string } | null} null unless the local
 *          part is a valid npub — the overwhelming common case (usernames,
 *          phone numbers, …), where the caller just uses the address as-is.
 */
export function npubFromLightningAddress(address) {
  if (typeof address !== 'string') return null
  const at = address.indexOf('@')
  if (at < 1) return null
  const local = address.slice(0, at).trim()
  if (classifyIdentifier(local) !== 'npub') return null
  try {
    const decoded = nip19.decode(local)
    if (decoded?.type !== 'npub' || typeof decoded.data !== 'string') return null
    const pubkey = decoded.data.toLowerCase()
    if (!HEX64_RE.test(pubkey)) return null
    return { pubkey, npub: nip19.npubEncode(pubkey) }
  } catch {
    return null
  }
}

/**
 * Middle-truncate an npub for display: `npub1abcdef…wxyz`. Keeps the "npub1"
 * marker so it still reads as a key, plus a short tail for disambiguation.
 * Returned unchanged when it's already short enough.
 */
export function shortenNpub(npub, head = 12, tail = 5) {
  if (typeof npub !== 'string') return ''
  if (npub.length <= head + tail + 1) return npub
  return `${npub.slice(0, head)}…${npub.slice(-tail)}`
}

/**
 * Pick the best human name from a kind:0 profile content object, in the order
 * a Nostr client would: display_name -> name -> nip05. Empty string when the
 * profile carries no usable name (the caller then keeps the shortened npub).
 */
export function profileDisplayName(profile) {
  if (!profile || typeof profile !== 'object') return ''
  for (const key of ['display_name', 'displayName', 'name', 'nip05']) {
    const value = profile[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * Gate an avatar URL to safe schemes (https / data:image) so a malformed or
 * `javascript:` picture field from a relay can never reach an `<img src>`.
 * Empty string on miss.
 */
export function sanitizeImageUrl(url) {
  return typeof url === 'string' && SAFE_IMAGE_RE.test(url.trim()) ? url.trim() : ''
}
