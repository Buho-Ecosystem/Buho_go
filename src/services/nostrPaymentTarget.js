/**
 * Resolve a Nostr identifier to a payable Lightning destination.
 *
 * Two callers, one resolver:
 *   1. The send box, when the user pastes a bare `npub1…` / `nprofile1…`
 *      (optionally `nostr:`-prefixed). Unambiguous — only Nostr looks like
 *      that — so it's resolved up front.
 *   2. The Lightning-Address path, as a *fallback* only: when `name@domain`
 *      fails to resolve as a Lightning Address it might be a NIP-05 instead,
 *      so we resolve it via Nostr and pay the lud16 on the profile. The
 *      Lightning-Address interpretation always wins; this only rescues a miss.
 *
 * The chain is: identifier -> pubkey (lookupIdentifier; npub/nprofile/hex are
 * synchronous, NIP-05 does a `.well-known/nostr.json` round-trip) -> the
 * person's kind:0 profile (fetchProfile, signature-verified) -> their
 * `lud16` (a Lightning Address) or, failing that, `lud06` (an LNURL).
 *
 * We also hand back the profile's name + avatar so the confirm sheet can show
 * who is being paid — the identity comes free with the lookup we had to do
 * anyway, and a kind:0 is signed, so it's a strong identity.
 *
 * Network lives in lookupIdentifier / fetchProfile; both are injectable via
 * opts for unit testing. Errors carry a `.code` (this module's or the
 * underlying LOOKUP_ERROR / NIP05_ERROR) so callers can map them to copy.
 */
import { lookupIdentifier } from '../utils/nostrLookup.js'
import { fetchProfile as defaultFetchProfile, parseProfileContent } from '../utils/nostrFetch.js'
import { isLightningAddress, isLnurl } from '../utils/addressUtils.js'
import { profileDisplayName, sanitizeImageUrl } from './nostrRecipient.js'

export const NOSTR_TARGET_ERROR = Object.freeze({
  NO_PROFILE: 'NOSTR_TARGET_NO_PROFILE', // identifier resolved, but no kind:0 found on the relays
  NO_ADDRESS: 'NOSTR_TARGET_NO_ADDRESS', // profile found, but it carries no lud16 / lud06
})

function makeError(code, message, cause) {
  const err = new Error(message)
  err.code = code
  if (cause) err.cause = cause
  return err
}

/**
 * @typedef {{
 *   kind: 'lightning_address' | 'lnurl',
 *   address: string,                       // lud16 Lightning Address, or lud06 LNURL
 *   pubkey: string,
 *   npub: string,
 *   profile: { name: string, picture: string },
 * }} NostrTarget
 */

/**
 * @param {string} input  npub / nprofile / hex / NIP-05 (optionally `nostr:`-prefixed)
 * @param {{
 *   fetchProfile?: typeof defaultFetchProfile,
 *   fetch?: typeof fetch,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 * }} [opts]
 * @returns {Promise<NostrTarget>}
 * @throws Error with `.code` — NOSTR_TARGET_* here, or a bubbled LOOKUP_* / NIP05_*.
 */
export async function resolveNostrLightningTarget(input, opts = {}) {
  const fetchProfile = opts.fetchProfile || defaultFetchProfile

  // 1. identifier -> pubkey (+ relay hints). Bubbles typed LOOKUP_* / NIP05_*.
  const resolved = await lookupIdentifier(input, opts)

  // 2. pubkey -> kind:0 profile (verified inside fetchProfile; null on miss).
  const event = await fetchProfile(resolved.pubkey, {
    relays: resolved.relays,
    timeoutMs: opts.timeoutMs,
  })
  if (!event) {
    throw makeError(NOSTR_TARGET_ERROR.NO_PROFILE, `no profile found for ${resolved.npub}`)
  }

  const content = parseProfileContent(event)
  const profile = {
    name: profileDisplayName(content),
    picture: sanitizeImageUrl(content.picture),
  }

  // 3. profile -> payable target. lud16 (a Lightning Address) is preferred;
  //    lud06 (a raw LNURL) is the fallback. Both validated before handoff.
  const lud16 = typeof content.lud16 === 'string' ? content.lud16.trim().toLowerCase() : ''
  if (lud16 && isLightningAddress(lud16)) {
    return { kind: 'lightning_address', address: lud16, pubkey: resolved.pubkey, npub: resolved.npub, profile }
  }

  const lud06 = typeof content.lud06 === 'string' ? content.lud06.trim() : ''
  if (lud06 && isLnurl(lud06)) {
    return { kind: 'lnurl', address: lud06, pubkey: resolved.pubkey, npub: resolved.npub, profile }
  }

  throw makeError(NOSTR_TARGET_ERROR.NO_ADDRESS, `profile ${resolved.npub} has no Lightning address`)
}
