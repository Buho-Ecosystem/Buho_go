/**
 * zaps — NIP-57 zap recognition for incoming payments.
 *
 * Per NIP-57, the bolt11 invoice a zap pays carries the serialized
 * kind-9734 "zap request" event as its description (that is how the
 * receipt later proves who zapped). So an incoming payment whose
 * description parses as a valid 9734 event IS a zap — no relay
 * subscription needed, works identically across LNbits / NWC / any
 * provider that surfaces the invoice memo.
 *
 * What we extract is exactly what the product needs: who zapped
 * (pubkey/npub → profile → potential contact), what they said
 * (content = the zap note), and what they committed to pay
 * (amount tag, msat).
 *
 * A legacy heuristic (bare npub inside a plain-text description) is
 * kept as a fallback — it is what the app shipped with, and dropping
 * it would un-flag zaps users already received.
 *
 * Pure and synchronous — no network, no stores — so it stays
 * unit-testable under plain Node.
 */

import { nip19 } from 'nostr-core'

const HEX64_RE = /^[0-9a-f]{64}$/i
// npub1 + 58 chars of the bech32 charset (no '1', 'b', 'i', 'o').
const LEGACY_NPUB_RE = /npub1[023456789acdefghjklmnpqrstuvwxyz]{58}/

/**
 * Parse a bolt11 description as a NIP-57 zap request.
 *
 * Strict on the fields that identify a zap (kind 9734, hex pubkey),
 * lenient on everything optional — a zap with no note or no amount
 * tag is still a zap.
 *
 * @param {unknown} description
 * @returns {{
 *   pubkey: string,           // zapper, 64-char lowercase hex
 *   npub: string|null,        // bech32 form (null only if encoding fails)
 *   note: string,             // zap comment, '' when none
 *   amountMsat: number|null,  // NIP-57 `amount` tag
 *   recipientPubkey: string|null, // `p` tag — who was zapped
 *   createdAt: number|null,
 * } | null}
 */
export function parseZapRequest(description) {
  if (typeof description !== 'string') return null
  const trimmed = description.trim()
  // Cheap gate before JSON.parse — descriptions are usually plain memos.
  if (!trimmed.startsWith('{') || !trimmed.includes('9734')) return null

  let event
  try {
    event = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!event || typeof event !== 'object' || event.kind !== 9734) return null
  if (typeof event.pubkey !== 'string' || !HEX64_RE.test(event.pubkey)) return null

  const tags = Array.isArray(event.tags) ? event.tags : []
  const tagValue = (name) => {
    const tag = tags.find((t) => Array.isArray(t) && t[0] === name && typeof t[1] === 'string')
    return tag ? tag[1] : null
  }

  const pubkey = event.pubkey.toLowerCase()
  let npub = null
  try {
    npub = nip19.npubEncode(pubkey)
  } catch {
    // Malformed despite the hex check — keep the hex, drop the bech32.
  }

  const rawAmount = Number(tagValue('amount'))
  const recipient = tagValue('p')

  return {
    pubkey,
    npub,
    note: typeof event.content === 'string' ? event.content.trim() : '',
    amountMsat: Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : null,
    recipientPubkey: recipient && HEX64_RE.test(recipient) ? recipient.toLowerCase() : null,
    createdAt: Number.isFinite(Number(event.created_at)) ? Number(event.created_at) : null,
  }
}

/**
 * Zap info for a normalized transaction, or null when it isn't one.
 * Only INCOMING payments can be zaps we received; a zap we sent is an
 * ordinary outgoing payment from this wallet's perspective.
 *
 * `via` says how the zap was recognized:
 *   - 'nip57'  the description is a valid kind-9734 zap request
 *   - 'legacy' a bare npub found in a plain-text description (the
 *              app's original heuristic, kept for old rows)
 *
 * @param {object|null} tx  normalized transaction (services/txNormalizer)
 * @returns {(ReturnType<typeof parseZapRequest> & { via: 'nip57'|'legacy' }) | null}
 */
export function zapInfoFromTx(tx) {
  if (!tx || tx.type !== 'incoming') return null
  const description = typeof tx.description === 'string' && tx.description
    ? tx.description
    : (typeof tx.memo === 'string' ? tx.memo : '')
  if (!description) return null

  const parsed = parseZapRequest(description)
  if (parsed) return { ...parsed, via: 'nip57' }

  const legacy = description.match(LEGACY_NPUB_RE)
  if (legacy) {
    let pubkey = null
    try {
      const decoded = nip19.decode(legacy[0])
      if (decoded?.type === 'npub' && typeof decoded.data === 'string') {
        pubkey = decoded.data.toLowerCase()
      }
    } catch {
      // Invalid checksum — treat as not-a-zap rather than half-a-zap.
      return null
    }
    return {
      pubkey,
      npub: legacy[0],
      note: '',
      amountMsat: null,
      recipientPubkey: null,
      createdAt: null,
      via: 'legacy',
    }
  }

  return null
}
