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
 * ── Attribution rule ────────────────────────────────────────────
 * The description is written by whoever asked for the invoice, so the
 * sender it names is a claim, not a fact. The Nostr Design Guide's
 * impostor-prevention guidance is that nostr has no way to authenticate
 * users and that identity must never be presented as verified when it
 * is not (which is why it rejects NIP-05 as identification).
 * https://nostrdesign.org/docs/how-to/impostor-prevention/
 *
 * A signature is the one proof nostr does offer, so this module draws
 * the line there:
 *
 *   verified: true   the 9734 event's signature checks out. The sender
 *                    is proven; name, picture and note may be shown.
 *   verified: false  the row is recognizably a nostr payment but the
 *                    sender is unproven. Badge it as a zap, attribute
 *                    it to nobody.
 *
 * A description that claims to be a zap request and fails verification
 * is not a zap at all — a bad signature is evidence of forgery, not a
 * missing detail. Enforcement of the rule lives in
 * services/zapperProfiles, which refuses to resolve a profile for an
 * unverified zap, so no calling page can bypass it by accident.
 *
 * The `p`-tag recipient is parsed but deliberately NOT matched against
 * the user's own pubkey: a signed request replayed into someone else's
 * invoice still attributes to the real signer, while wallets whose
 * Lightning address is hosted under another identity would fail such a
 * check for entirely legitimate zaps.
 *
 * A legacy heuristic (bare npub inside a plain-text description) is
 * kept as a fallback — it is what the app shipped with, and dropping it
 * would un-flag zaps users already received. It carries no proof, so it
 * is always verified: false.
 *
 * Pure and synchronous — no network, no stores — so it stays
 * unit-testable under plain Node.
 */

import { nip19, verifyEvent, getEventHash } from 'nostr-core'

const HEX64_RE = /^[0-9a-f]{64}$/i
// npub1 + 58 chars of the bech32 charset (no '1', 'b', 'i', 'o').
const LEGACY_NPUB_RE = /npub1[023456789acdefghjklmnpqrstuvwxyz]{58}/

/**
 * Cheap shape gate: does this description even claim to be a zap
 * request? Keeps JSON.parse off the hot path for ordinary memos, and
 * lets zapInfoFromTx tell "not a zap request" apart from "a zap request
 * that failed verification".
 *
 * @param {string} trimmed
 * @returns {boolean}
 */
function looksLikeZapRequest(trimmed) {
  return trimmed.startsWith('{') && trimmed.includes('9734')
}

/**
 * Is this kind-9734 event actually signed by the pubkey it names?
 *
 * Servers that re-serialize the zap request sometimes drop `id`. The
 * signature commits to the event hash, so deriving the missing id and
 * verifying against that is the same proof, not a weaker one.
 *
 * @param {object} event
 * @returns {boolean}
 */
function hasValidSignature(event) {
  if (typeof event.sig !== 'string' || !event.sig) return false
  try {
    const candidate = typeof event.id === 'string' && event.id
      ? event
      : { ...event, id: getEventHash(event) }
    return verifyEvent(candidate) === true
  } catch {
    // Malformed enough to break hashing/verification — unproven.
    return false
  }
}

/**
 * Parse a bolt11 description as a NIP-57 zap request.
 *
 * Strict on everything that carries attribution (kind 9734, hex pubkey,
 * valid signature), lenient on the rest — a zap with no note or no
 * amount tag is still a zap.
 *
 * @param {unknown} description
 * @returns {{
 *   pubkey: string,           // zapper, 64-char lowercase hex
 *   npub: string|null,        // bech32 form (null only if encoding fails)
 *   note: string,             // zap comment, '' when none
 *   amountMsat: number|null,  // NIP-57 `amount` tag
 *   recipientPubkey: string|null, // `p` tag — who was zapped
 *   createdAt: number|null,
 *   verified: true,           // always: an unsigned request returns null
 * } | null}
 */
export function parseZapRequest(description) {
  if (typeof description !== 'string') return null
  const trimmed = description.trim()
  if (!looksLikeZapRequest(trimmed)) return null

  let event
  try {
    event = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!event || typeof event !== 'object' || event.kind !== 9734) return null
  if (typeof event.pubkey !== 'string' || !HEX64_RE.test(event.pubkey)) return null
  // The attribution rule: no proof, no sender.
  if (!hasValidSignature(event)) return null

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
    verified: true,
  }
}

/**
 * Zap info for a normalized transaction, or null when it isn't one.
 * Only INCOMING payments can be zaps we received; a zap we sent is an
 * ordinary outgoing payment from this wallet's perspective.
 *
 * `via` says how the zap was recognized, `verified` whether its sender
 * is proven (see the attribution rule in the module header):
 *   - 'nip57'  a signed kind-9734 zap request     → verified: true
 *   - 'legacy' a bare npub in a plain-text memo   → verified: false
 *
 * @param {object|null} tx  normalized transaction (services/txNormalizer)
 * @returns {(ReturnType<typeof parseZapRequest> & { via: 'nip57' }) |
 *           { pubkey: string, npub: string, note: '', amountMsat: null,
 *             recipientPubkey: null, createdAt: null,
 *             via: 'legacy', verified: false } | null}
 */
export function zapInfoFromTx(tx) {
  if (!tx || tx.type !== 'incoming') return null
  const description = typeof tx.description === 'string' && tx.description
    ? tx.description
    : (typeof tx.memo === 'string' ? tx.memo : '')
  if (!description) return null

  const parsed = parseZapRequest(description)
  if (parsed) return { ...parsed, via: 'nip57' }

  // A description that claimed to be a zap request and did not verify is
  // never retried as a legacy memo: an npub inside a forged request's
  // note must not become that request's attribution.
  if (looksLikeZapRequest(description.trim())) return null

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
    if (!pubkey) return null
    return {
      pubkey,
      npub: legacy[0],
      note: '',
      amountMsat: null,
      recipientPubkey: null,
      createdAt: null,
      via: 'legacy',
      verified: false,
    }
  }

  return null
}
