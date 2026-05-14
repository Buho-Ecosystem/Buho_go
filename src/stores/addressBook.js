import { defineStore } from 'pinia'
import { verifyEvent } from 'nostr-core'
import {
  isSparkAddress,
  isBitcoinAddress,
  isLightningAddress,
} from '../utils/addressUtils.js'
import { fetchProfile, parseProfileContent } from '../utils/nostrFetch.js'
import {
  buildAddressBookEvent,
  fetchAddressBook,
  publishAddressBook,
  serializeContactPayload,
} from '../utils/nostrAddressBook.js'

// Address type constants
export const ADDRESS_TYPES = {
  LIGHTNING: 'lightning',
  SPARK: 'spark',
  BITCOIN: 'bitcoin'
}

// Contact source — undefined on legacy entries; treat any
// missing value as 'manual' so the schema upgrade is backward
// compatible without a migration step.
export const CONTACT_SOURCES = Object.freeze({
  MANUAL: 'manual',
  NOSTR: 'nostr',
})

// A kind:0 profile is metadata — a name, a bio, a couple of URLs.
// Anything past this ceiling is either a hostile payload trying to
// bloat localStorage or a broken client; we reject it at the
// persistence boundary rather than trusting the fetch layer caught it.
const MAX_NOSTR_EVENT_CONTENT_BYTES = 64 * 1024

// Per-field length caps for the stored profile snapshot. Generous
// enough for any genuine profile, tight enough that a malicious
// kind:0 can't wreck the address-book UI or storage budget. Fields
// not in this list are dropped from the cached snapshot entirely —
// the address book only ever renders this known set, and the full
// raw payload still lives verbatim in `nostr_event.content` for the
// detail view, so nothing is actually lost.
const PROFILE_FIELD_LIMITS = Object.freeze({
  name: 256,
  display_name: 256,
  displayName: 256,
  about: 2048,
  picture: 2048,
  banner: 2048,
  nip05: 256,
  lud16: 256,
  lud06: 256,
  website: 512,
})

/**
 * Clamp a parsed kind:0 profile to safe bounds before it is persisted.
 * Known fields are length-capped; unknown fields are dropped. The
 * un-clamped truth still lives in `nostr_event.content`, so this only
 * trims the *render cache* — never the source of record.
 *
 * @param {Record<string, unknown> | null | undefined} profile
 * @returns {Record<string, string>}
 */
function sanitizeProfileForStorage(profile) {
  if (!profile || typeof profile !== 'object') return {}
  const clean = {}
  for (const [key, limit] of Object.entries(PROFILE_FIELD_LIMITS)) {
    const value = profile[key]
    if (typeof value === 'string' && value) {
      clean[key] = value.slice(0, limit)
    }
  }
  return clean
}

/**
 * The persistence boundary's correctness gate for an incoming kind:0
 * event. Throws a typed-message Error on the first failure so the
 * caller (search / scan / recovery / any future call site) gets a
 * consistent rejection regardless of which check tripped.
 *
 *   - kind must be 0 and author must match the claimed pubkey
 *   - signature must verify — we do NOT assume the fetch layer did it
 *   - content must be within the size ceiling
 *
 * @param {import('nostr-core').NostrEvent} event
 * @param {string} pubkey  expected 64-char lowercase hex author
 */
function assertValidProfileEvent(event, pubkey) {
  if (!event || event.kind !== 0 || event.pubkey?.toLowerCase() !== pubkey) {
    throw new Error('Profile event is missing or invalid')
  }
  let signatureOk = false
  try {
    signatureOk = verifyEvent(event) === true
  } catch {
    signatureOk = false
  }
  if (!signatureOk) {
    throw new Error('Profile event signature is invalid')
  }
  if (
    typeof event.content === 'string'
    && event.content.length > MAX_NOSTR_EVENT_CONTENT_BYTES
  ) {
    throw new Error('Profile event is too large')
  }
}

/**
 * Pick a display name from a parsed kind:0 profile, falling back
 * through the chain real Nostr clients use:
 *   1. `display_name` / `displayName` (NIP-24 ish — most-preferred)
 *   2. `name`                          (NIP-01 baseline)
 *   3. `nip05`                         (last-resort handle)
 *   4. shortened npub                  (so the list row is never blank)
 *
 * Clamped to 80 chars: a hostile profile could otherwise push a
 * multi-kilobyte string into the contact list. We never persist
 * the un-clamped value, but we still keep the full payload in
 * `nostr_profile` for the detail view.
 */
function pickDisplayNameFromProfile(profile, fallbackNpub) {
  const candidates = [
    profile?.display_name,
    profile?.displayName,
    profile?.name,
    profile?.nip05,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().slice(0, 80)
    }
  }
  if (typeof fallbackNpub === 'string' && fallbackNpub) {
    return `${fallbackNpub.slice(0, 12)}…`
  }
  return 'Nostr Contact'
}

/**
 * Deep-clone a kind:0 event so the persisted snapshot is a true
 * value-copy (no shared references with the relay pool's in-memory
 * objects, and no carry-over of nostr-core's symbol-keyed verification
 * cache).
 */
function cloneEvent(event) {
  return event ? JSON.parse(JSON.stringify(event)) : null
}

// Persistence key for the small metadata blob the sync layer keeps
// alongside the entry list. We don't co-mingle it with the entries
// key to keep the migration story for older builds zero-touch — they
// still read `buhoGO_address_book` and ignore this sibling.
const SYNC_META_STORAGE_KEY = 'buhoGO_address_book_sync_v1'

export const useAddressBookStore = defineStore('addressBook', {
  state: () => ({
    entries: [],
    _initialized: false,
    searchQuery: '',
    // Nostr sync state — populated lazily by initialize()
    isSyncing: false,
    isRecovering: false,
    lastSyncedAt: null,
    lastSyncError: null,
    lastRecoveryAt: null,
    syncDirty: false,
    colorPalette: [
      '#3B82F6', // Blue
      '#10B981', // Emerald
      '#F59E0B', // Amber
      '#EF4444', // Red
      '#8B5CF6', // Violet
      '#F97316', // Orange
      '#06B6D4', // Cyan
      '#84CC16', // Lime
      '#EC4899', // Pink
      '#6366F1', // Indigo
      '#14B8A6', // Teal
      '#F43F5E', // Rose
    ]
  }),

  getters: {
    filteredEntries: (state) => {
      const sorted = [...state.entries].sort((a, b) => a.name.localeCompare(b.name))

      if (!state.searchQuery.trim()) {
        return sorted
      }

      const query = state.searchQuery.toLowerCase()
      return sorted.filter(entry => {
        const address = entry.address || entry.lightningAddress || ''
        const notes = entry.notes || ''
        return entry.name.toLowerCase().includes(query) ||
          address.toLowerCase().includes(query) ||
          notes.toLowerCase().includes(query)
      })
    },

    // Get favorite contacts sorted by name
    favoriteEntries: (state) => {
      return state.entries
        .filter(entry => entry.isFavorite)
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    // Get recently used contacts (last 5, used within 30 days, excluding favorites)
    recentEntries: (state) => {
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000)
      return state.entries
        .filter(entry => entry.lastUsedAt && entry.lastUsedAt > thirtyDaysAgo && !entry.isFavorite)
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
        .slice(0, 5)
    },

    getEntryById: (state) => (id) => {
      return state.entries.find(entry => entry.id === id)
    },

    getRandomColor: (state) => () => {
      return state.colorPalette[Math.floor(Math.random() * state.colorPalette.length)]
    },

    lightningEntries: (state) => {
      return state.entries.filter(entry =>
        (entry.addressType || 'lightning') === 'lightning'
      )
    },

    sparkEntries: (state) => {
      return state.entries.filter(entry => entry.addressType === 'spark')
    },

    bitcoinEntries: (state) => {
      return state.entries.filter(entry => entry.addressType === 'bitcoin')
    },

    nostrEntries: (state) => {
      return state.entries.filter(entry => entry.source === CONTACT_SOURCES.NOSTR)
    }
  },

  actions: {
    // Initialize store from localStorage (safe to call multiple times)
    async initialize() {
      if (this._initialized) return

      try {
        const savedEntries = localStorage.getItem('buhoGO_address_book')
        if (savedEntries) {
          const parsed = JSON.parse(savedEntries)
          this.entries = Array.isArray(parsed) ? parsed : []
        }
      } catch (error) {
        console.error('Error loading address book:', error)
        this.entries = []
      }
      try {
        const savedMeta = localStorage.getItem(SYNC_META_STORAGE_KEY)
        if (savedMeta) {
          const parsed = JSON.parse(savedMeta)
          if (parsed && typeof parsed === 'object') {
            this.lastSyncedAt = Number.isFinite(parsed.lastSyncedAt) ? parsed.lastSyncedAt : null
            this.lastRecoveryAt = Number.isFinite(parsed.lastRecoveryAt) ? parsed.lastRecoveryAt : null
            this.syncDirty = !!parsed.syncDirty
          }
        }
      } catch (error) {
        console.warn('Error loading address-book sync metadata:', error)
      }
      this._initialized = true
    },

    // Mark there are local nostr-contact changes not yet pushed to
    // the user's private NIP-51 list. Cheap to call from every
    // mutation path; the sync layer reads this when deciding whether
    // a publish is actually necessary.
    async _markSyncDirty() {
      if (this.syncDirty) return
      this.syncDirty = true
      await this._persistSyncMeta()
    },

    async _persistSyncMeta() {
      try {
        localStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify({
          lastSyncedAt: this.lastSyncedAt,
          lastRecoveryAt: this.lastRecoveryAt,
          syncDirty: this.syncDirty,
        }))
      } catch (error) {
        console.warn('Error saving address-book sync metadata:', error)
      }
    },

    // Add new entry
    async addEntry(entryData) {
      await this.initialize()
      try {
        const addressType = entryData.addressType || 'lightning'
        const address = entryData.address || entryData.lightningAddress || ''

        const newEntry = {
          id: `addr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: entryData.name.trim(),
          address: address.trim(),
          addressType: addressType,
          // Keep lightningAddress for backward compatibility
          lightningAddress: addressType === 'lightning' ? address.trim() : '',
          color: entryData.color || this.getRandomColor(),
          // New fields for enhanced contacts
          notes: entryData.notes?.trim() || '',
          isFavorite: entryData.isFavorite || false,
          lastUsedAt: entryData.lastUsedAt || null,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }

        // Validate address format based on type
        if (!this.isValidAddress(newEntry.address, newEntry.addressType)) {
          const errorMessages = {
            spark: 'Invalid Spark address format',
            bitcoin: 'Invalid Bitcoin address format',
            lightning: 'Invalid Lightning address format'
          }
          throw new Error(errorMessages[addressType] || 'Invalid address format')
        }

        // Check for duplicates
        const existingEntry = this.entries.find(
          entry => this.getEntryAddress(entry).toLowerCase() === newEntry.address.toLowerCase()
        )

        if (existingEntry) {
          throw new Error('This address already exists in your address book')
        }

        this.entries.push(newEntry)
        await this.persistEntries()

        return newEntry
      } catch (error) {
        throw error
      }
    },

    // Update existing entry
    async updateEntry(id, updateData) {
      await this.initialize()
      try {
        const entryIndex = this.entries.findIndex(entry => entry.id === id)
        if (entryIndex === -1) {
          throw new Error('Entry not found')
        }

        const currentEntry = this.entries[entryIndex]
        const updatedEntry = {
          ...currentEntry,
          // Explicitly update all editable fields
          name: updateData.name !== undefined ? updateData.name : currentEntry.name,
          color: updateData.color !== undefined ? updateData.color : currentEntry.color,
          notes: updateData.notes !== undefined ? updateData.notes : (currentEntry.notes || ''),
          isFavorite: updateData.isFavorite !== undefined ? updateData.isFavorite : (currentEntry.isFavorite || false),
          updatedAt: Date.now()
        }

        // If this is a Nostr contact and the user changed the name to
        // something other than what the kind:0 profile would currently
        // produce, mark it as locally overridden. `refreshContact()` then
        // never overwrites it on a silent re-sync (locked decision #4:
        // user's local edit always wins).
        if (currentEntry.source === CONTACT_SOURCES.NOSTR && updateData.name !== undefined) {
          const derivedName = pickDisplayNameFromProfile(
            currentEntry.nostr_profile,
            currentEntry.nostr_npub,
          )
          updatedEntry.name_locally_edited = updatedEntry.name.trim() !== derivedName
        }

        // If address is being updated, validate it
        const newAddress = updateData.address || updateData.lightningAddress
        if (newAddress) {
          const addressType = updateData.addressType || updatedEntry.addressType || 'lightning'
          updatedEntry.address = newAddress.trim()
          updatedEntry.addressType = addressType
          updatedEntry.lightningAddress = addressType === 'lightning' ? newAddress.trim() : ''

          if (!this.isValidAddress(updatedEntry.address, addressType)) {
            const errorMessages = {
              spark: 'Invalid Spark address format',
              bitcoin: 'Invalid Bitcoin address format',
              lightning: 'Invalid Lightning address format'
            }
            throw new Error(errorMessages[addressType] || 'Invalid address format')
          }

          // Check for duplicates
          const existingEntry = this.entries.find(
            entry => entry.id !== id &&
            this.getEntryAddress(entry).toLowerCase() === updatedEntry.address.toLowerCase()
          )

          if (existingEntry) {
            throw new Error('This address already exists in your address book')
          }
        }

        // Use splice for proper Vue reactivity
        this.entries.splice(entryIndex, 1, updatedEntry)
        await this.persistEntries()

        // The petname is the only syncable field updateEntry can
        // touch on a Nostr contact (the address always comes from
        // lud16). Mark dirty only when that flipped — avoids a
        // publish round-trip for a notes-only edit.
        if (
          currentEntry.source === CONTACT_SOURCES.NOSTR
          && updatedEntry.name_locally_edited !== currentEntry.name_locally_edited
        ) {
          await this._markSyncDirty()
        }

        return updatedEntry
      } catch (error) {
        throw error
      }
    },

    // Delete entry
    async deleteEntry(id) {
      await this.initialize()
      try {
        const entryIndex = this.entries.findIndex(entry => entry.id === id)
        if (entryIndex === -1) {
          throw new Error('Entry not found')
        }

        const deletedEntry = this.entries[entryIndex]
        this.entries.splice(entryIndex, 1)
        await this.persistEntries()

        if (deletedEntry.source === CONTACT_SOURCES.NOSTR) {
          await this._markSyncDirty()
        }

        return deletedEntry
      } catch (error) {
        throw error
      }
    },

    /**
     * Add a contact backed by a Nostr kind:0 profile.
     *
     * Unlike `addEntry`, the payment address (Lightning) is derived
     * strictly from the kind:0 `lud16` field (locked decision #6) — the
     * caller has no manual override. This is the whole point of a
     * Nostr-sourced contact: the payable identity travels with the
     * profile, so when the user updates their lud16 the address book
     * automatically follows on the next silent re-sync.
     *
     * The full kind:0 event is persisted verbatim (locked decision #1)
     * so the detail view can show the latest snapshot and the
     * re-sync logic has a `created_at` baseline for the NIP-01
     * replaceable-event tie-break.
     *
     * @param {{
     *   pubkey:     string,                       // 64-char lowercase hex
     *   npub:       string,                       // bech32-encoded npub
     *   event:      import('nostr-core').NostrEvent, // verified kind:0 event
     *   relayHints?: readonly string[],           // from NIP-05 / kind:10002
     *   color?:     string,
     *   isFavorite?: boolean,
     *   notes?:     string,
     * }} input
     * @returns {Promise<object>} the newly stored entry
     *
     * @throws Error('Invalid Nostr pubkey')                 — bad hex
     * @throws Error('Invalid Nostr identifier (npub)')      — bad bech32
     * @throws Error('Profile event is missing or invalid')  — event mismatch
     * @throws Error('This Nostr profile does not have a Lightning address (lud16) yet')
     * @throws Error('This Nostr contact is already in your address book')
     * @throws Error('A contact with this Lightning address already exists')
     */
    async addNostrContact(input) {
      await this.initialize()

      const pubkey = typeof input?.pubkey === 'string' ? input.pubkey.toLowerCase() : ''
      const npub = typeof input?.npub === 'string' ? input.npub : ''
      const event = input?.event
      const relayHints = Array.isArray(input?.relayHints) ? input.relayHints : []

      if (!/^[0-9a-f]{64}$/.test(pubkey)) {
        throw new Error('Invalid Nostr pubkey')
      }
      if (!/^npub1[0-9a-z]+$/i.test(npub)) {
        throw new Error('Invalid Nostr identifier (npub)')
      }
      // Trust boundary: verify kind / author / signature / size here
      // rather than assuming the caller's fetch path did it.
      assertValidProfileEvent(event, pubkey)

      const profile = parseProfileContent(event)
      const lud16Raw = typeof profile.lud16 === 'string' ? profile.lud16.trim() : ''
      if (!lud16Raw || !isLightningAddress(lud16Raw)) {
        throw new Error('This Nostr profile does not have a Lightning address (lud16) yet')
      }

      // Dedupe — first by pubkey (the canonical identity), then by
      // Lightning address (so a manual contact with the same lud16
      // doesn't end up shadowed by a Nostr duplicate).
      if (this.entries.some(entry => entry.nostr_pubkey === pubkey)) {
        throw new Error('This Nostr contact is already in your address book')
      }
      if (this.entries.some(
        entry => this.getEntryAddress(entry).toLowerCase() === lud16Raw.toLowerCase(),
      )) {
        throw new Error('A contact with this Lightning address already exists')
      }

      const now = Date.now()
      const sanitizedHints = relayHints
        .filter((url) => typeof url === 'string' && /^wss?:\/\//i.test(url))
        .map((url) => url.trim())

      const newEntry = {
        id: `addr-${now}-${Math.random().toString(36).substr(2, 9)}`,
        name: pickDisplayNameFromProfile(profile, npub),
        address: lud16Raw,
        addressType: 'lightning',
        lightningAddress: lud16Raw,
        color: input?.color || this.getRandomColor(),
        notes: typeof input?.notes === 'string' ? input.notes.trim() : '',
        isFavorite: !!input?.isFavorite,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
        // Nostr-sourced metadata
        source: CONTACT_SOURCES.NOSTR,
        nostr_pubkey: pubkey,
        nostr_npub: npub,
        nostr_event: cloneEvent(event),
        nostr_profile: sanitizeProfileForStorage(profile),
        nostr_relay_hints: sanitizedHints,
        last_synced_at: now,
        name_locally_edited: false,
      }

      this.entries.push(newEntry)
      await this.persistEntries()
      await this._markSyncDirty()
      return newEntry
    },

    /**
     * Silently refresh a Nostr-sourced contact against its origin
     * relays (locked decision #2: sync triggered on contact tap, no
     * background polling).
     *
     * Semantics:
     *   - No-op for manual contacts (returns `{updated:false, reason}`).
     *   - Network/fetch errors collapse to a non-throwing result; the
     *     caller can choose whether to surface the failure or stay
     *     silent. UI callers tend to stay silent so a flaky relay
     *     never blocks a payment.
     *   - When a newer kind:0 arrives:
     *       * `nostr_event` + `nostr_profile` replaced
     *       * `address` refreshed from the new lud16 (kept if missing)
     *       * `name` refreshed only when `name_locally_edited` is false
     *       * `last_synced_at` + `updatedAt` bumped
     *   - When the fetched event is not newer, only `last_synced_at`
     *     is bumped so the UI can show a "checked X seconds ago" hint.
     *
     * @param {string} id
     * @param {{
     *   fetcher?:   typeof fetchProfile,
     *   pool?:      any,
     *   relays?:    readonly string[],
     *   timeoutMs?: number,
     * }} [opts]
     * @returns {Promise<{
     *   updated: boolean,
     *   reason:  'synced' | 'not-newer' | 'no-event' | 'fetch-error' | 'not-a-nostr-contact',
     *   error?:  Error,
     *   entry?:  object,
     * }>}
     */
    async refreshContact(id, opts = {}) {
      await this.initialize()
      const entryIndex = this.entries.findIndex(entry => entry.id === id)
      if (entryIndex === -1) {
        throw new Error('Entry not found')
      }
      const entry = this.entries[entryIndex]

      if (entry.source !== CONTACT_SOURCES.NOSTR || !entry.nostr_pubkey) {
        return { updated: false, reason: 'not-a-nostr-contact' }
      }

      const fetcher = typeof opts.fetcher === 'function' ? opts.fetcher : fetchProfile
      const fetchOpts = {}
      if (opts.pool) fetchOpts.pool = opts.pool
      if (Number.isFinite(opts.timeoutMs)) fetchOpts.timeoutMs = opts.timeoutMs
      // Prefer the relay hints we stored at add time — they're the
      // authoritative source for where this user posts. Caller-supplied
      // relays are a fallback for contacts we added before hints were
      // captured.
      if (Array.isArray(entry.nostr_relay_hints) && entry.nostr_relay_hints.length > 0) {
        fetchOpts.relays = entry.nostr_relay_hints
      } else if (Array.isArray(opts.relays) && opts.relays.length > 0) {
        fetchOpts.relays = opts.relays
      }

      let event = null
      try {
        event = await fetcher(entry.nostr_pubkey, fetchOpts)
      } catch (err) {
        return { updated: false, reason: 'fetch-error', error: err }
      }

      if (!event) {
        return { updated: false, reason: 'no-event' }
      }

      // Trust boundary: the default fetcher (`fetchProfile`) verifies,
      // but a caller-injected fetcher might not. Reject anything that
      // isn't a correctly-signed kind:0 for this exact pubkey before
      // it touches the persisted snapshot.
      try {
        assertValidProfileEvent(event, entry.nostr_pubkey)
      } catch (err) {
        return { updated: false, reason: 'invalid-event', error: err }
      }

      const storedCreatedAt = entry.nostr_event?.created_at || 0
      const now = Date.now()

      // Not newer — still bump last_synced_at so the UI knows we tried.
      if (event.created_at <= storedCreatedAt) {
        const touched = { ...entry, last_synced_at: now }
        this.entries.splice(entryIndex, 1, touched)
        await this.persistEntries()
        return { updated: false, reason: 'not-newer', entry: touched }
      }

      const profile = parseProfileContent(event)
      const updated = { ...entry }
      updated.nostr_event = cloneEvent(event)
      updated.nostr_profile = sanitizeProfileForStorage(profile)
      updated.last_synced_at = now
      updated.updatedAt = now

      // Always-derive the payment address from the latest lud16.
      // If the new event has no lud16, keep the previous one so the
      // contact stays payable from the last-known address instead of
      // silently disappearing from send flows.
      const newLud16 = typeof profile.lud16 === 'string' ? profile.lud16.trim() : ''
      if (newLud16 && isLightningAddress(newLud16)) {
        updated.address = newLud16
        updated.lightningAddress = newLud16
      }

      // Preserve user's local name override on every re-sync.
      if (!entry.name_locally_edited) {
        updated.name = pickDisplayNameFromProfile(profile, entry.nostr_npub)
      }

      this.entries.splice(entryIndex, 1, updated)
      await this.persistEntries()
      return { updated: true, reason: 'synced', entry: updated }
    },

    /**
     * Push the current Nostr-sourced contact list to the user's
     * private NIP-51 kind:30000 event. Wraps the eager fan-out from
     * `publishAddressBook` in the same UX-facing shape `profileStore.publish`
     * returns so the UI can surface success / failure identically.
     *
     * Skip cases (return shape includes `skipped: true`):
     *   - identity not bootstrapped (caller will prompt unlock)
     *   - no nostr-sourced contacts to publish
     *
     * The secret-key buffer is wiped immediately after signing — same
     * pattern as `profileStore.publish` — so the unlocked-mnemonic
     * exposure window stays narrow.
     *
     * @param {{
     *   identityStore: any,        // useIdentityStore() instance
     *   pool?:    any,
     *   relays?:  readonly string[],
     *   timeoutMs?: number,
     * }} args
     * @returns {Promise<
     *   | { ok: true,  acceptedRelay: string, contactsPublished: number, settled: Promise<any[]> }
     *   | { ok: false, contactsPublished: number, results: any[], settled: Promise<any[]> }
     *   | { skipped: true, reason: 'identity-not-bootstrapped' | 'no-nostr-contacts' }
     *   | null  // re-entrant call ignored
     * >}
     */
    async syncToNostr({ identityStore, pool, relays, timeoutMs } = {}) {
      await this.initialize()
      if (this.isSyncing) return null
      if (!identityStore || !identityStore.bootstrapped) {
        return { skipped: true, reason: 'identity-not-bootstrapped' }
      }

      const payload = serializeContactPayload(this.entries)
      if (payload.length === 0) {
        // Nothing to publish — but treat this as a successful "synced"
        // moment so the dirty flag clears (e.g. user deleted their
        // only nostr contact: we want the next open to not retry).
        this.syncDirty = false
        this.lastSyncedAt = Date.now()
        this.lastSyncError = null
        await this._persistSyncMeta()
        return { skipped: true, reason: 'no-nostr-contacts' }
      }

      this.isSyncing = true
      this.lastSyncError = null
      try {
        const pubkey = identityStore.nostrPubkeyHex
        if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
          this.lastSyncError = 'NO_PUBKEY'
          return { ok: false, contactsPublished: 0, results: [], settled: Promise.resolve([]) }
        }

        let secretKey
        let event
        try {
          secretKey = await identityStore.getNostrSecretKeyBytes()
          event = buildAddressBookEvent({ secretKey, pubkey, payload })
        } finally {
          if (secretKey) secretKey.fill(0)
        }

        const fanout = publishAddressBook({ pool, relays, event, timeoutMs })
        const settled = fanout.allSettled
        const firstAccept = await fanout.firstAccept

        if (firstAccept) {
          this.lastSyncedAt = Date.now()
          this.syncDirty = false
          await this._persistSyncMeta()
          return {
            ok: true,
            acceptedRelay: firstAccept.relay,
            contactsPublished: payload.length,
            settled,
          }
        }

        const results = await settled
        this.lastSyncError = 'ALL_RELAYS_REJECTED'
        console.warn('[addressBook] sync landed on zero relays:', results)
        return { ok: false, contactsPublished: payload.length, results, settled: Promise.resolve(results) }
      } catch (err) {
        this.lastSyncError = err?.code || err?.message || 'UNKNOWN'
        console.warn('[addressBook] sync failed:', err)
        return { ok: false, contactsPublished: 0, results: [], settled: Promise.resolve([]) }
      } finally {
        this.isSyncing = false
      }
    },

    /**
     * Pull the user's private NIP-51 address book from relays and
     * merge into the local store. Designed to be called after
     * identity restore — but safe to call any time as a "refresh
     * from cloud" affordance.
     *
     * Conflict policy (from the recovery-plan doc):
     *   - Local entry with the same pubkey wins, BUT we still pick
     *     up a synced petname if the user hasn't locally edited the
     *     name on this device.
     *   - Remote-only entries are added by fetching their current
     *     kind:0 to rebuild the snapshot. Contacts whose current
     *     kind:0 lacks a lud16 are recorded under `unpayable` so the
     *     UI can show "couldn't restore N (no Lightning address)".
     *
     * Network and decryption failures collapse to a typed result so
     * the recovery wizard never has to wrap this in try/catch.
     */
    async recoverFromNostr({ identityStore, pool, relays, timeoutMs, profileFetcher } = {}) {
      await this.initialize()
      if (this.isRecovering) return null
      if (!identityStore || !identityStore.bootstrapped) {
        return { ok: false, reason: 'identity-not-bootstrapped' }
      }
      const pubkey = identityStore.nostrPubkeyHex
      if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
        return { ok: false, reason: 'no-pubkey' }
      }

      this.isRecovering = true
      try {
        let remote
        let secretKey
        try {
          secretKey = await identityStore.getNostrSecretKeyBytes()
          remote = await fetchAddressBook({ pool, relays, pubkey, secretKey, timeoutMs })
        } catch (err) {
          if (err?.code === 'ADDRESS_BOOK_DECRYPT_FAILED') {
            return { ok: false, reason: 'decrypt-failed', error: err }
          }
          return { ok: false, reason: 'fetch-failed', error: err }
        } finally {
          if (secretKey) secretKey.fill(0)
        }

        if (!remote) {
          this.lastRecoveryAt = Date.now()
          await this._persistSyncMeta()
          return { ok: true, hadRemote: false, restored: 0, skipped: 0, unpayable: 0 }
        }

        const fetcher = typeof profileFetcher === 'function' ? profileFetcher : fetchProfile
        let restored = 0
        let skipped = 0
        let unpayable = 0

        for (const remoteContact of remote.contacts) {
          const localExisting = this.entries.find(
            (e) => e.nostr_pubkey === remoteContact.pubkey,
          )
          if (localExisting) {
            // Light-touch merge: adopt the synced petname when this
            // device hasn't locally edited the name and the remote
            // has a petname. Otherwise leave the local entry alone —
            // local always wins on this device.
            if (remoteContact.petname && !localExisting.name_locally_edited) {
              const updated = {
                ...localExisting,
                name: remoteContact.petname.slice(0, 80),
                name_locally_edited: true,
                updatedAt: Date.now(),
              }
              const idx = this.entries.findIndex((e) => e.id === localExisting.id)
              if (idx !== -1) {
                this.entries.splice(idx, 1, updated)
              }
            }
            skipped += 1
            continue
          }

          // Rebuild from the contact's latest kind:0.
          let event = null
          try {
            const fetchOpts = {}
            if (Array.isArray(remoteContact.relays) && remoteContact.relays.length > 0) {
              fetchOpts.relays = remoteContact.relays
            } else if (Array.isArray(relays) && relays.length > 0) {
              fetchOpts.relays = relays
            }
            if (pool) fetchOpts.pool = pool
            event = await fetcher(remoteContact.pubkey, fetchOpts)
          } catch (err) {
            console.warn('[addressBook] recovery: fetchProfile failed for', remoteContact.pubkey, err)
          }

          if (!event) {
            unpayable += 1
            continue
          }

          const profile = parseProfileContent(event)
          const lud16Raw = typeof profile.lud16 === 'string' ? profile.lud16.trim() : ''
          if (!lud16Raw || !isLightningAddress(lud16Raw)) {
            unpayable += 1
            continue
          }

          // Compute npub from pubkey hex. We could lift this into a
          // util but for the recovery hot-path it stays inline so
          // each contact restored is a self-contained transaction.
          let npub = ''
          try {
            const { nip19 } = await import('nostr-core')
            npub = nip19.npubEncode(remoteContact.pubkey)
          } catch {
            unpayable += 1
            continue
          }

          try {
            const newEntry = await this.addNostrContact({
              pubkey: remoteContact.pubkey,
              npub,
              event,
              relayHints: remoteContact.relays || [],
            })
            // Apply the synced petname after the add so the regular
            // `addNostrContact` validation runs unaltered.
            if (remoteContact.petname) {
              await this.updateEntry(newEntry.id, { name: remoteContact.petname })
            }
            if (Number.isFinite(remoteContact.addedAt)) {
              // Best-effort: preserve original-add timestamp so the
              // restored list keeps the user's mental ordering.
              const idx = this.entries.findIndex((e) => e.id === newEntry.id)
              if (idx !== -1) {
                const restored = { ...this.entries[idx], createdAt: remoteContact.addedAt }
                this.entries.splice(idx, 1, restored)
                await this.persistEntries()
              }
            }
            restored += 1
          } catch (err) {
            // `addNostrContact` throws on dedupe or schema issues —
            // not fatal for the rest of the restore.
            console.warn('[addressBook] recovery: addNostrContact failed for', remoteContact.pubkey, err)
            unpayable += 1
          }
        }

        // Recovery DOESN'T clear `syncDirty` automatically — if a
        // petname-merge happened, those changes should be pushed back
        // on next sync so the snapshot stays consistent across
        // devices. We DO record the timestamp.
        this.lastRecoveryAt = Date.now()
        await this._persistSyncMeta()
        return { ok: true, hadRemote: true, restored, skipped, unpayable }
      } finally {
        this.isRecovering = false
      }
    },

    // Toggle favorite status
    async toggleFavorite(id) {
      await this.initialize()
      const entry = this.entries.find(e => e.id === id)
      if (entry) {
        entry.isFavorite = !entry.isFavorite
        entry.updatedAt = Date.now()
        await this.persistEntries()
      }
      return entry
    },

    // Update last used timestamp (called when paying a contact)
    async updateLastUsed(id) {
      await this.initialize()
      const entry = this.entries.find(e => e.id === id)
      if (entry) {
        entry.lastUsedAt = Date.now()
        await this.persistEntries()
      }
      return entry
    },

    // Find contact by address (for save-to-contacts check)
    findContactByAddress(address) {
      if (!address) return null
      const normalizedAddress = address.toLowerCase().trim()
      return this.entries.find(entry => {
        const entryAddress = (entry.address || entry.lightningAddress || '').toLowerCase().trim()
        return entryAddress === normalizedAddress
      }) || null
    },

    // Find contact by Nostr pubkey (for the search/scan flow's "already
    // in your address book" detection — npub lookup goes through the
    // same code path because both are derived from the same hex).
    findContactByPubkey(pubkey) {
      if (typeof pubkey !== 'string') return null
      const hex = pubkey.toLowerCase().trim()
      if (!/^[0-9a-f]{64}$/.test(hex)) return null
      return this.entries.find(entry => entry.nostr_pubkey === hex) || null
    },

    // Update search query
    setSearchQuery(query) {
      this.searchQuery = query
    },

    // Clear search
    clearSearch() {
      this.searchQuery = ''
    },

    // Validate address based on type
    isValidAddress(address, type = 'lightning') {
      if (!address || !address.trim()) return false

      if (type === 'spark') {
        return this.isValidSparkAddress(address)
      }
      if (type === 'bitcoin') {
        return this.isValidBitcoinAddress(address)
      }
      return this.isValidLightningAddress(address)
    },

    // Validation predicates — delegated to the shared addressUtils module so
    // every part of the app recognizes the same set of identifiers.
    isValidLightningAddress(address) {
      return isLightningAddress(address)
    },

    isValidSparkAddress(address) {
      return isSparkAddress(address)
    },

    isValidBitcoinAddress(address) {
      return isBitcoinAddress(address)
    },

    // Detect address type from input. Order matters: Spark addresses can look
    // vaguely like base58 if misread, so we check them first.
    detectAddressType(address) {
      if (!address) return null
      if (isSparkAddress(address)) return 'spark'
      if (isBitcoinAddress(address)) return 'bitcoin'
      if (isLightningAddress(address)) return 'lightning'
      return null
    },

    // Get address from entry (handles backward compatibility)
    getEntryAddress(entry) {
      return entry?.address || entry?.lightningAddress || ''
    },

    // Get address type from entry (with auto-detection fallback)
    getEntryAddressType(entry) {
      if (entry?.addressType) {
        return entry.addressType
      }
      // Fallback: detect type from address
      const address = this.getEntryAddress(entry)
      return this.detectAddressType(address) || 'lightning'
    },

    // Persist entries to localStorage
    async persistEntries() {
      try {
        localStorage.setItem('buhoGO_address_book', JSON.stringify(this.entries))
      } catch (error) {
        console.error('Error saving address book:', error)
        throw new Error('Failed to save address book')
      }
    },

    // Clear all entries
    async clearAll() {
      this.entries = []
      this.searchQuery = ''
      localStorage.removeItem('buhoGO_address_book')
    },

    // Import entries (supports both Lightning and Spark addresses)
    async importEntries(entries) {
      await this.initialize()
      try {
        let importedCount = 0

        for (const entry of entries) {
          if (!entry.name) continue

          // Get address from either new or old field
          const address = entry.address || entry.lightningAddress
          if (!address) continue

          // Detect or use provided address type
          const addressType = entry.addressType || this.detectAddressType(address)
          if (!addressType) continue

          // Validate address format
          if (!this.isValidAddress(address, addressType)) continue

          // Check for duplicates
          const existingEntry = this.entries.find(
            existing => this.getEntryAddress(existing).toLowerCase() === address.toLowerCase()
          )

          if (!existingEntry) {
            await this.addEntry({
              name: entry.name,
              address: address,
              addressType: addressType,
              color: entry.color || this.getRandomColor()
            })
            importedCount++
          }
        }

        return importedCount
      } catch (error) {
        throw error
      }
    },

    // Export entries (for future use)
    exportEntries() {
      return JSON.parse(JSON.stringify(this.entries))
    }
  }
})