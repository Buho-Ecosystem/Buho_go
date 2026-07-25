/**
 * zapperProfiles — small reactive directory of Nostr profiles for the
 * people who zap us.
 *
 * The transaction list needs a zapper's name + picture synchronously
 * at render time; relays are anything but synchronous. So this keeps
 * one reactive session cache, seeded from localStorage, and fetches a
 * profile at most once per session per pubkey — rows re-render the
 * moment the profile lands.
 *
 * Only REAL data is ever stored: a relay miss caches as a miss (so we
 * don't hammer relays for ghosts), and nothing is fabricated — no
 * placeholder avatars, no invented lightning addresses. The absence
 * of a profile renders as the app-wide silhouette, same as any other
 * picture-less counterparty.
 *
 * Storage key is shared with TransactionDetails' historical cache
 * ('buhoGO_nostr_profiles', keyed by npub) so previously cached
 * profiles keep working; entries this module writes carry `fetchedAt`
 * and a `kind0` marker distinguishing them from legacy blobs.
 */

import { reactive } from 'vue'
import { fetchProfile, parseProfileContent } from '../utils/nostrFetch'

const STORAGE_KEY = 'buhoGO_nostr_profiles'
const HEX64_RE = /^[0-9a-f]{64}$/

// npub → profile | null (null = confirmed miss this session)
const cache = reactive({})
// npub → raw kind-0 event, session only — the address book re-verifies
// kind/author/signature itself when a zapper gets saved as a contact,
// so we keep the verifiable original around, never just the parse.
const rawEvents = new Map()
// npub → Promise, so concurrent rows share one relay round-trip
const inflight = new Map()
let storageLoaded = false

function loadStorageOnce() {
  if (storageLoaded) return
  storageLoaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const stored = JSON.parse(raw)
    if (stored && typeof stored === 'object') {
      for (const [npub, profile] of Object.entries(stored)) {
        // Legacy fabricated entries (pre-service) carried a dicebear
        // placeholder picture — drop those on sight, keep real ones.
        if (profile && typeof profile === 'object'
            && !String(profile.picture || '').includes('dicebear')) {
          cache[npub] = profile
        }
      }
    }
  } catch {
    // Unreadable cache is a cold start, not an error.
  }
}

function persist(npub, profile) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const stored = raw ? JSON.parse(raw) : {}
    stored[npub] = profile
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Storage full/unavailable — the session cache still serves.
  }
}

/**
 * The cached profile for a zap's sender, triggering a background fetch
 * on first sight. Reactive: callers using this inside computeds/render
 * re-run when the profile arrives.
 *
 * @param {{ npub?: string|null, pubkey?: string|null }|null} zap
 * @returns {{ name?: string, displayName?: string, picture?: string,
 *             about?: string, nip05?: string, lud16?: string } | null}
 */
export function zapperProfile(zap) {
  const npub = zap?.npub
  if (!npub) return null
  loadStorageOnce()

  if (npub in cache) return cache[npub]

  const pubkey = typeof zap?.pubkey === 'string' ? zap.pubkey.toLowerCase() : ''
  if (!HEX64_RE.test(pubkey)) return null

  if (!inflight.has(npub)) {
    inflight.set(npub, (async () => {
      try {
        const event = await fetchProfile(pubkey)
        if (event) {
          rawEvents.set(npub, event)
          const content = parseProfileContent(event)
          const profile = {
            name: typeof content.name === 'string' ? content.name : '',
            displayName: typeof content.display_name === 'string'
              ? content.display_name
              : (typeof content.displayName === 'string' ? content.displayName : ''),
            picture: typeof content.picture === 'string' ? content.picture : '',
            about: typeof content.about === 'string' ? content.about : '',
            nip05: typeof content.nip05 === 'string' ? content.nip05 : '',
            lud16: typeof content.lud16 === 'string' ? content.lud16 : '',
            kind0: true,
            fetchedAt: Date.now(),
          }
          cache[npub] = profile
          persist(npub, profile)
        } else {
          // Confirmed miss — remember for the session only, so a user
          // who publishes a profile later shows up on next app start.
          cache[npub] = null
        }
      } catch {
        cache[npub] = null
      } finally {
        inflight.delete(npub)
      }
    })())
  }

  return null
}

/**
 * The raw kind-0 event for a zapper — required by the address book,
 * which re-verifies it before saving a contact. Served from the
 * session cache when the list already fetched it, otherwise one fresh
 * relay round-trip. null when the zapper never published a profile.
 *
 * @param {{ npub?: string|null, pubkey?: string|null }|null} zap
 * @returns {Promise<object|null>}
 */
export async function zapperProfileEvent(zap) {
  const npub = zap?.npub
  if (npub && rawEvents.has(npub)) return rawEvents.get(npub)
  const pubkey = typeof zap?.pubkey === 'string' ? zap.pubkey.toLowerCase() : ''
  if (!HEX64_RE.test(pubkey)) return null
  try {
    const event = await fetchProfile(pubkey)
    if (event && npub) rawEvents.set(npub, event)
    return event
  } catch {
    return null
  }
}

/**
 * Display name for a zap row: profile name when known, otherwise a
 * shortened npub — honest, never invented.
 *
 * @param {{ npub?: string|null, pubkey?: string|null }|null} zap
 * @returns {string}
 */
export function zapperDisplayName(zap) {
  const profile = zapperProfile(zap)
  const name = (profile?.displayName || profile?.name || '').trim()
  if (name) return name
  const npub = zap?.npub || ''
  return npub ? `${npub.slice(0, 9)}…${npub.slice(-4)}` : ''
}

/**
 * Profile picture URL for a zap row, '' when none is known (the row
 * falls back to the app-wide silhouette).
 *
 * @param {{ npub?: string|null, pubkey?: string|null }|null} zap
 * @returns {string}
 */
export function zapperPicture(zap) {
  const profile = zapperProfile(zap)
  return profile?.picture || ''
}
