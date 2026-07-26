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
 * This module is also where the attribution rule from utils/zaps is
 * enforced: an unverified zap (no valid signature proving who sent it)
 * resolves to no profile, no name and no picture, so it can only ever
 * render as an anonymous nostr payment. Doing it here rather than in
 * each page means no caller can attribute a zap by forgetting to check.
 * Rationale: https://nostrdesign.org/docs/how-to/impostor-prevention/
 *
 * This module is the only writer of 'buhoGO_nostr_profiles' (keyed by
 * npub). It inherited the key from an older per-page cache so already
 * cached profiles keep working, and entries written here carry
 * `fetchedAt` plus a `kind0` marker distinguishing them from the blobs
 * that cache left behind on upgrading devices.
 */

import { reactive } from 'vue'
import { nip19 } from 'nostr-core'
import { fetchProfile, fetchProfiles, parseProfileContent } from '../utils/nostrFetch.js'
import { sanitizeImageUrl } from './nostrRecipient.js'

const STORAGE_KEY = 'buhoGO_nostr_profiles'
const HEX64_RE = /^[0-9a-f]{64}$/
// How long a cached profile is served before a background refresh. Long
// enough that a zap list costs no relay traffic, short enough that a
// renamed or re-pictured zapper is not frozen for good.
const PROFILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
// How long requests accumulate before one batched query goes out. Long
// enough to collect a whole list render, short enough to be invisible.
const BATCH_WINDOW_MS = 60

/**
 * Is this zap allowed to name a person? Only a signature-verified zap
 * request proves its sender; anything else stays anonymous. Every
 * exported function funnels through here.
 *
 * @param {{ verified?: boolean }|null} zap
 * @returns {boolean}
 */
function mayAttribute(zap) {
  return zap?.verified === true
}

/**
 * The zapper's pubkey, from the caller's hex when it has one and from
 * the npub otherwise. Grouped zap streams key on npub alone, so without
 * this fallback a group title could never trigger the profile fetch its
 * individual rows do.
 *
 * @param {{ npub?: string|null, pubkey?: string|null }|null} zap
 * @returns {string} 64-char lowercase hex, or '' when neither resolves
 */
function zapperPubkey(zap) {
  const hex = typeof zap?.pubkey === 'string' ? zap.pubkey.toLowerCase() : ''
  if (HEX64_RE.test(hex)) return hex
  const npub = zap?.npub
  if (typeof npub !== 'string' || !npub.startsWith('npub1')) return ''
  try {
    const decoded = nip19.decode(npub)
    const data = decoded?.type === 'npub' && typeof decoded.data === 'string'
      ? decoded.data.toLowerCase()
      : ''
    return HEX64_RE.test(data) ? data : ''
  } catch {
    // Bad checksum — no identity to fetch.
    return ''
  }
}

// npub → profile | null (null = confirmed miss this session)
const cache = reactive({})
// npub → raw kind-0 event, session only — the address book re-verifies
// kind/author/signature itself when a zapper gets saved as a contact,
// so we keep the verifiable original around, never just the parse.
const rawEvents = new Map()
// npub → Promise, so concurrent rows share one relay round-trip
const inflight = new Map()
// npub → pubkey, waiting to ride the next batched request
const queued = new Map()
let flushTimer = null
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
 * Has a cached profile aged out? A confirmed miss never does: it is
 * session-scoped on purpose, so someone who publishes a profile today
 * appears on the next app start. Entries with no timestamp are blobs
 * from the pre-service cache and always refresh once.
 *
 * @param {object|null} profile
 * @returns {boolean}
 */
function isStale(profile) {
  if (!profile) return false
  const at = Number(profile.fetchedAt)
  if (!Number.isFinite(at)) return true
  return Date.now() - at > PROFILE_MAX_AGE_MS
}

/**
 * The stored shape for a verified kind-0.
 *
 * @param {object} event
 * @returns {object}
 */
function profileFromEvent(event) {
  const content = parseProfileContent(event)
  return {
    name: typeof content.name === 'string' ? content.name : '',
    displayName: typeof content.display_name === 'string'
      ? content.display_name
      : (typeof content.displayName === 'string' ? content.displayName : ''),
    // Relay-supplied URL: gate to http(s)/data:image the same way
    // every other Nostr picture in the app is gated, so a hostile
    // kind-0 can't put an arbitrary scheme in an <img src>.
    picture: sanitizeImageUrl(content.picture),
    about: typeof content.about === 'string' ? content.about : '',
    nip05: typeof content.nip05 === 'string' ? content.nip05 : '',
    lud16: typeof content.lud16 === 'string' ? content.lud16 : '',
    kind0: true,
    fetchedAt: Date.now(),
  }
}

/**
 * Issue one batched request for everything queued, and settle every
 * npub in it. Runs off a short timer so a list that renders fifty zap
 * rows in the same frame costs one REQ per relay, not fifty.
 */
function flushQueue() {
  // Callable directly, not just off the timer, so cancel any pending one
  // rather than leaving it to fire on an empty queue.
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (queued.size === 0) return

  const batch = [...queued]
  queued.clear()

  const promise = (async () => {
    try {
      const events = await fetchProfiles(batch.map(([, pubkey]) => pubkey))
      for (const [npub, pubkey] of batch) {
        const event = events.get(pubkey)
        if (event) {
          rawEvents.set(npub, event)
          const profile = profileFromEvent(event)
          cache[npub] = profile
          persist(npub, profile)
        } else if (!(npub in cache)) {
          // Confirmed miss — remembered for the session only. Never
          // downgrade a profile we already hold: a relay that answers
          // nothing on a refresh is silence, not a deletion.
          cache[npub] = null
        }
      }
    } catch {
      for (const [npub] of batch) {
        if (!(npub in cache)) cache[npub] = null
      }
    } finally {
      for (const [npub] of batch) inflight.delete(npub)
    }
  })()

  // Safe to register after starting the promise: nothing else can run
  // between here and its first await (single-threaded, and flushQueue
  // itself never awaits).
  for (const [npub] of batch) inflight.set(npub, promise)
}

/**
 * Queue one zapper for the next batch, unless it is already queued or
 * already in flight. Writes land in the reactive cache, so rows
 * re-render when the batch returns.
 *
 * @param {string} npub
 * @param {string} pubkey
 */
function enqueueFetch(npub, pubkey) {
  if (inflight.has(npub) || queued.has(npub)) return
  queued.set(npub, pubkey)
  if (flushTimer === null) flushTimer = setTimeout(flushQueue, BATCH_WINDOW_MS)
}

/**
 * The cached profile for a zap's sender, triggering a background fetch
 * on first sight and a background refresh once the cached copy ages
 * out. Reactive: callers using this inside computeds/render re-run when
 * the profile arrives.
 *
 * Returns null for an unverified zap — see the attribution rule in the
 * module header.
 *
 * @param {{ npub?: string|null, pubkey?: string|null, verified?: boolean }|null} zap
 * @returns {{ name?: string, displayName?: string, picture?: string,
 *             about?: string, nip05?: string, lud16?: string } | null}
 */
export function zapperProfile(zap) {
  if (!mayAttribute(zap)) return null
  const npub = zap?.npub
  if (!npub) return null
  loadStorageOnce()

  const cached = npub in cache ? cache[npub] : undefined
  if (cached !== undefined && !isStale(cached)) return cached

  const pubkey = zapperPubkey(zap)
  if (!pubkey) return cached ?? null

  // Stale-while-revalidate: serve the old copy this render, swap in the
  // fresh one when the batch lands.
  enqueueFetch(npub, pubkey)
  return cached ?? null
}

/**
 * The raw kind-0 event for a zapper — required by the address book,
 * which re-verifies it before saving a contact. Served from the
 * session cache when the list already fetched it, otherwise one fresh
 * relay round-trip. null when the zapper never published a profile.
 *
 * null for an unverified zap: saving a contact is attribution that
 * outlives the row, so it needs the same proof the row does.
 *
 * @param {{ npub?: string|null, pubkey?: string|null, verified?: boolean }|null} zap
 * @returns {Promise<object|null>}
 */
export async function zapperProfileEvent(zap) {
  if (!mayAttribute(zap)) return null
  const npub = zap?.npub
  if (npub && rawEvents.has(npub)) return rawEvents.get(npub)
  // This zapper may already be queued for the next batch or waiting on
  // one. Either way, ride it instead of opening a second request: send
  // the pending batch now rather than after its window, then wait.
  if (npub && queued.has(npub)) flushQueue()
  if (npub && inflight.has(npub)) {
    // The batch promise handles its own errors and never rejects.
    await inflight.get(npub)
    if (rawEvents.has(npub)) return rawEvents.get(npub)
  }
  const pubkey = zapperPubkey(zap)
  if (!pubkey) return null
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
 * '' for an unverified zap, including the npub form: a shortened npub is
 * still an attribution, and the sender is not proven. Callers fall back
 * to their own generic label ("Zap received").
 *
 * @param {{ npub?: string|null, pubkey?: string|null, verified?: boolean }|null} zap
 * @returns {string}
 */
export function zapperDisplayName(zap) {
  if (!mayAttribute(zap)) return ''
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
  // Sanitized again on the way out: entries cached by older builds went
  // to storage without the scheme gate.
  return sanitizeImageUrl(profile?.picture)
}
