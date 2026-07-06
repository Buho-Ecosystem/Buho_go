import { defineStore } from 'pinia'
import { verifyEvent, nip19 } from 'nostr-core'
import {
  isSparkAddress,
  isArkadeAddress,
  isBitcoinAddress,
  isLightningAddress,
  isLnurl,
} from '../utils/addressUtils.js'
import { fetchProfile, parseProfileContent } from '../utils/nostrFetch.js'
import {
  buildAddressBookEvent,
  fetchAddressBook,
  publishAddressBook,
  serializeContactPayload,
  mergeContactPayloads,
  partitionContactPayload,
} from '../utils/nostrAddressBook.js'

// Address type constants
export const ADDRESS_TYPES = {
  LIGHTNING: 'lightning',
  SPARK: 'spark',
  ARKADE: 'arkade',
  BITCOIN: 'bitcoin',
  // LNURL static pay links (bech32 LNURL1… or LUD-17 lnurlp://…). Stored as
  // its own type for correct send routing, but presented as Lightning in the
  // UI since it ultimately pays over Lightning.
  LNURL: 'lnurl'
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

// How long a delete-tombstone is carried in the synced payload. After
// this window every device that's going to converge has already seen
// the delete, so the tombstone has done its job; keeping it longer
// would only bloat the encrypted event.
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

// How many remote-only contacts to rebuild (fetch kind:0 + add) in
// parallel during a sync/recovery. Bounded so a 50-contact restore
// is ~8 round-trip batches rather than 50 serial ones, without
// opening 50 sockets at once.
const SYNC_FETCH_CONCURRENCY = 6

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
    // Pending delete-tombstones: [{ pubkey, deletedAt }]. A delete is
    // a tombstone, never an omission — that's how a delete propagates
    // across devices instead of being "resurrected" by a stale copy.
    nostrDeletions: [],
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
            this.nostrDeletions = Array.isArray(parsed.nostrDeletions)
              ? parsed.nostrDeletions.filter(
                  (d) => d && typeof d.pubkey === 'string' && Number.isFinite(d.deletedAt),
                )
              : []
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
          nostrDeletions: this._prunedDeletions(),
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
            arkade: 'Invalid Arkade address format',
            bitcoin: 'Invalid Bitcoin address format',
            lightning: 'Invalid Lightning address format',
            lnurl: 'Invalid LNURL format'
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
              arkade: 'Invalid Arkade address format',
              bitcoin: 'Invalid Bitcoin address format',
              lightning: 'Invalid Lightning address format',
              lnurl: 'Invalid LNURL format'
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

        if (deletedEntry.source === CONTACT_SOURCES.NOSTR && deletedEntry.nostr_pubkey) {
          // Record a tombstone, not just an omission — that's how the
          // delete propagates to other devices instead of being
          // "resurrected" by their stale copy of the list.
          const pubkey = deletedEntry.nostr_pubkey
          this.nostrDeletions = (this.nostrDeletions || []).filter((d) => d.pubkey !== pubkey)
          this.nostrDeletions.push({ pubkey, deletedAt: Date.now() })
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
     *   allowWithoutLightningAddress?: boolean,  // see below
     * }} input
     * @returns {Promise<object>} the newly stored entry
     *
     * `allowWithoutLightningAddress` decouples the contact's durability
     * from its *current* payment metadata. The interactive add flows
     * (search / scan) leave it false: there's no point saving someone
     * you can't pay yet, so a missing lud16 is a hard error. Recovery
     * passes it true — the canonical identity is the pubkey, and a
     * contact who temporarily dropped their lud16 must still come back
     * (as an identity-only entry, address `''`). `refreshContact`
     * promotes it to payable the moment they re-publish a lud16.
     *
     * @throws Error('Invalid Nostr pubkey')                 — bad hex
     * @throws Error('Invalid Nostr identifier (npub)')      — bad bech32
     * @throws Error('Profile event is missing or invalid')  — event mismatch
     * @throws Error('Profile event signature is invalid')   — forged event
     * @throws Error('Profile event is too large')           — oversized content
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
      const allowWithoutLn = input?.allowWithoutLightningAddress === true

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
      const hasLightningAddress = !!lud16Raw && isLightningAddress(lud16Raw)
      if (!hasLightningAddress && !allowWithoutLn) {
        throw new Error('This Nostr profile does not have a Lightning address (lud16) yet')
      }
      // Identity-only contacts carry an empty address until a refresh
      // picks one up. Every downstream consumer gates on
      // `isEntryPayable` rather than assuming the address is present.
      const resolvedAddress = hasLightningAddress ? lud16Raw : ''

      // Dedupe — always by pubkey (the canonical identity). The
      // Lightning-address dedup only runs when we actually have one;
      // it stops a manual contact with the same lud16 being shadowed
      // by a Nostr duplicate.
      if (this.entries.some(entry => entry.nostr_pubkey === pubkey)) {
        throw new Error('This Nostr contact is already in your address book')
      }
      if (hasLightningAddress && this.entries.some(
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
        address: resolvedAddress,
        addressType: 'lightning',
        lightningAddress: resolvedAddress,
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

      // A re-add supersedes any pending delete-tombstone for this
      // pubkey — otherwise the next merge would resolve the (older)
      // tombstone against the (newer) live entry and the contact
      // would survive anyway, but carrying a stale tombstone is just
      // noise. Drop it here so local state stays clean.
      if (Array.isArray(this.nostrDeletions) && this.nostrDeletions.some((d) => d.pubkey === pubkey)) {
        this.nostrDeletions = this.nostrDeletions.filter((d) => d.pubkey !== pubkey)
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
     * Serialize the local Nostr-sourced contacts + pending deletions
     * into the wire payload. Single source of truth for "what does
     * this device currently believe the contact list is."
     */
    _localPayload() {
      return serializeContactPayload(this.entries, this._prunedDeletions())
    },

    /**
     * Drop tombstones older than the TTL. After ~90 days every device
     * that's going to converge has already seen the delete, so the
     * tombstone has done its job and would only bloat the payload.
     */
    _prunedDeletions() {
      const cutoff = Date.now() - TOMBSTONE_TTL_MS
      return (this.nostrDeletions || []).filter(
        (d) => d && Number.isFinite(d.deletedAt) && d.deletedAt >= cutoff,
      )
    },

    /**
     * Shared fetch → merge → publish → reconcile pipeline behind both
     * `syncToNostr` and `recoverFromNostr`. They are the *same*
     * operation — pull the remote, union-merge it with local, publish
     * the union, then reconcile the local store to it. The only
     * difference is which in-flight flag the caller manages and how
     * the result is framed for the UI.
     *
     * The union merge (see `mergeContactPayloads`) is what makes this
     * safe across devices: a contact present on *either* side
     * survives, deletes travel as tombstones, and the higher
     * `updatedAt` wins a field conflict. No device can clobber
     * another's writes.
     *
     * The secret key is wiped the moment publishing is done — the
     * reconcile step never needs it.
     *
     * @returns {Promise<{
     *   ok: boolean,
     *   reason?: string,
     *   hadRemote: boolean,
     *   published: boolean,
     *   acceptedRelay: string | null,
     *   restored: number, removed: number,
     *   identityOnly: number, deferred: number, petnameUpdated: number,
     * }>}
     */
    async _runSync({ identityStore, pool, relays, timeoutMs, profileFetcher }) {
      const pubkey = identityStore?.nostrPubkeyHex
      if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
        return { ok: false, reason: 'no-pubkey', hadRemote: false, published: false, acceptedRelay: null,
          restored: 0, removed: 0, identityOnly: 0, deferred: 0, petnameUpdated: 0 }
      }

      let secretKey
      try {
        secretKey = await identityStore.getNostrSecretKeyBytes()

        // 1. FETCH the remote list.
        let remote
        try {
          remote = await fetchAddressBook({ pool, relays, pubkey, secretKey, timeoutMs })
        } catch (err) {
          const reason = err?.code === 'ADDRESS_BOOK_DECRYPT_FAILED'
            ? 'decrypt-failed'
            : 'fetch-failed'
          return { ok: false, reason, hadRemote: false, published: false, acceptedRelay: null,
            restored: 0, removed: 0, identityOnly: 0, deferred: 0, petnameUpdated: 0 }
        }
        const hadRemote = !!remote

        // 2. MERGE local ∪ remote. This is the no-data-loss guarantee.
        const merged = mergeContactPayloads(
          this._localPayload(),
          remote ? remote.contacts : [],
        )

        // 3. PUBLISH the merged union. Skip only when there is
        //    genuinely nothing — no live records, no tombstones, and
        //    no remote event ever existed.
        let published = false
        let acceptedRelay = null
        const nothingToDo = merged.length === 0 && !hadRemote
        if (!nothingToDo) {
          const event = buildAddressBookEvent({ secretKey, pubkey, payload: merged })
          const fanout = publishAddressBook({ pool, relays, event, timeoutMs })
          const firstAccept = await fanout.firstAccept
          if (firstAccept) {
            published = true
            acceptedRelay = firstAccept.relay
          } else {
            // Every relay refused — surface for diagnostics, the
            // caller keeps syncDirty set so it retries.
            const results = await fanout.allSettled
            console.warn('[addressBook] sync landed on zero relays:', results)
          }
        }

        // Secret key is done — reconcile is pure-local.
        secretKey.fill(0)
        secretKey = null

        // 4. RECONCILE the local store to the merged truth.
        const reconcile = await this._reconcileWithMergedPayload(merged, {
          fetcher: typeof profileFetcher === 'function' ? profileFetcher : fetchProfile,
          pool,
          relays,
        })

        return {
          ok: nothingToDo || published,
          hadRemote,
          published,
          acceptedRelay,
          ...reconcile,
        }
      } finally {
        if (secretKey) secretKey.fill(0)
      }
    },

    /**
     * Reconcile the local store to a freshly-merged payload:
     *   - remove locally-live entries the merge says are tombstoned
     *   - rebuild local tombstones from the merge (mirror == canonical)
     *   - for live records already local: converge the petname to the
     *     merge's last-writer-wins value
     *   - for live records not local: fetch their kind:0 and add them,
     *     with bounded concurrency so a 50-contact restore doesn't
     *     turn into 50 serial relay round-trips
     *
     * @returns {Promise<{ restored: number, removed: number,
     *   identityOnly: number, deferred: number, petnameUpdated: number }>}
     */
    async _reconcileWithMergedPayload(merged, { fetcher, pool, relays }) {
      const { live, tombstonedPubkeys } = partitionContactPayload(merged)
      let removed = 0
      let restored = 0
      let identityOnly = 0
      let deferred = 0
      let petnameUpdated = 0

      // (a) Remove locally-live Nostr entries that are tombstoned in
      //     the merged truth — this is how a delete on one device
      //     propagates to every other.
      for (let i = this.entries.length - 1; i >= 0; i -= 1) {
        const e = this.entries[i]
        if (
          e.source === CONTACT_SOURCES.NOSTR
          && e.nostr_pubkey
          && tombstonedPubkeys.has(e.nostr_pubkey)
        ) {
          this.entries.splice(i, 1)
          removed += 1
        }
      }

      // (b) Local tombstone set now mirrors the canonical merged set,
      //     so `_localPayload()` on the next sync stays consistent.
      this.nostrDeletions = [...tombstonedPubkeys].map((pk) => {
        const rec = merged.find((m) => m.pubkey === pk && m.deleted)
        return { pubkey: pk, deletedAt: rec ? rec.updatedAt : Date.now() }
      })

      // (c) Split live records into "already local" (converge petname)
      //     and "remote-only" (fetch + add).
      const localByPubkey = new Map()
      for (const e of this.entries) {
        if (e.source === CONTACT_SOURCES.NOSTR && e.nostr_pubkey) {
          localByPubkey.set(e.nostr_pubkey, e)
        }
      }
      const remoteOnly = []
      for (const rec of live) {
        const localEntry = localByPubkey.get(rec.pubkey)
        if (!localEntry) {
          remoteOnly.push(rec)
          continue
        }
        // Converge the petname to the merge's LWW value. The merged
        // record's petname IS the authoritative answer — adopt it.
        const desiredName = rec.petname
          ? rec.petname.slice(0, 80)
          : pickDisplayNameFromProfile(localEntry.nostr_profile, localEntry.nostr_npub)
        const desiredEdited = !!rec.petname
        if (
          localEntry.name !== desiredName
          || localEntry.name_locally_edited !== desiredEdited
        ) {
          const idx = this.entries.findIndex((e) => e.id === localEntry.id)
          if (idx !== -1) {
            this.entries.splice(idx, 1, {
              ...localEntry,
              name: desiredName,
              name_locally_edited: desiredEdited,
              updatedAt: Date.now(),
            })
            petnameUpdated += 1
          }
        }
      }

      // (d) Fetch + add the remote-only contacts, bounded concurrency.
      for (let i = 0; i < remoteOnly.length; i += SYNC_FETCH_CONCURRENCY) {
        const chunk = remoteOnly.slice(i, i + SYNC_FETCH_CONCURRENCY)
        const outcomes = await Promise.all(
          chunk.map((rec) => this._restoreOneRemoteContact(rec, { fetcher, pool, relays })),
        )
        for (const outcome of outcomes) {
          if (outcome === 'restored') restored += 1
          else if (outcome === 'identity-only') { restored += 1; identityOnly += 1 }
          else deferred += 1
        }
      }

      await this.persistEntries()
      await this._persistSyncMeta()
      return { restored, removed, identityOnly, deferred, petnameUpdated }
    },

    /**
     * Rebuild one remote-only contact from its latest kind:0.
     *
     *   'restored'      — added, has a Lightning address
     *   'identity-only' — added, but no lud16 yet (still a real contact)
     *   'deferred'      — couldn't fetch / add right now; the next sync
     *                     will retry (the record is still in the
     *                     merged payload, so it isn't lost)
     */
    async _restoreOneRemoteContact(rec, { fetcher, pool, relays }) {
      let event = null
      try {
        const fetchOpts = {}
        if (Array.isArray(rec.relays) && rec.relays.length > 0) {
          fetchOpts.relays = rec.relays
        } else if (Array.isArray(relays) && relays.length > 0) {
          fetchOpts.relays = relays
        }
        if (pool) fetchOpts.pool = pool
        event = await fetcher(rec.pubkey, fetchOpts)
      } catch (err) {
        console.warn('[addressBook] recovery: fetchProfile failed for', rec.pubkey, err)
      }
      // No kind:0 right now — transient. Leave it for the next sync;
      // the record is still in the published merged payload.
      if (!event) return 'deferred'

      let npub
      try {
        npub = nip19.npubEncode(rec.pubkey)
      } catch (err) {
        console.warn('[addressBook] recovery: npubEncode failed for', rec.pubkey, err)
        return 'deferred'
      }

      try {
        const entry = await this.addNostrContact({
          pubkey: rec.pubkey,
          npub,
          event,
          relayHints: rec.relays || [],
          // The canonical identity is the pubkey — a contact who
          // dropped their lud16 must still come back (identity-only).
          allowWithoutLightningAddress: true,
        })
        if (rec.petname) {
          await this.updateEntry(entry.id, { name: rec.petname })
        }
        if (Number.isFinite(rec.addedAt)) {
          // Preserve the original add time so the restored list keeps
          // the user's mental ordering.
          const idx = this.entries.findIndex((e) => e.id === entry.id)
          if (idx !== -1) {
            this.entries.splice(idx, 1, { ...this.entries[idx], createdAt: rec.addedAt })
          }
        }
        return this.isEntryPayable(entry) ? 'restored' : 'identity-only'
      } catch (err) {
        // addNostrContact throws on dedupe / schema issues — not fatal
        // for the rest of the restore.
        console.warn('[addressBook] recovery: addNostrContact failed for', rec.pubkey, err)
        return 'deferred'
      }
    },

    /**
     * Push-and-pull the user's private NIP-51 address book: fetch the
     * remote list, union-merge with local, publish the union, and
     * reconcile the local store to it.
     *
     * Because every publish is a merge of local ∪ remote, no device
     * can ever clobber another's writes — the failure mode the plain
     * "publish my local snapshot" approach had.
     *
     * @param {{
     *   identityStore: any,
     *   pool?: any, relays?: readonly string[], timeoutMs?: number,
     *   profileFetcher?: Function,   // injected in tests
     * }} args
     * @returns {Promise<
     *   | { ok: true,  hadRemote: boolean, published: boolean, acceptedRelay: string|null,
     *       restored: number, removed: number, identityOnly: number,
     *       deferred: number, petnameUpdated: number }
     *   | { ok: false, reason: string, ... }
     *   | { skipped: true, reason: 'identity-not-bootstrapped' }
     *   | null  // re-entrant call ignored
     * >}
     */
    async syncToNostr({ identityStore, pool, relays, timeoutMs, profileFetcher } = {}) {
      await this.initialize()
      // One sync operation at a time — a sync running concurrently
      // with a recovery could publish a half-merged list.
      if (this.isSyncing || this.isRecovering) return null
      if (!identityStore || !identityStore.bootstrapped) {
        return { skipped: true, reason: 'identity-not-bootstrapped' }
      }

      this.isSyncing = true
      this.lastSyncError = null
      try {
        const result = await this._runSync({ identityStore, pool, relays, timeoutMs, profileFetcher })
        if (result.ok) {
          this.lastSyncedAt = Date.now()
          this.syncDirty = false
          this.lastSyncError = null
        } else {
          this.lastSyncError = result.reason === 'decrypt-failed' ? 'DECRYPT_FAILED'
            : result.reason === 'fetch-failed' ? 'FETCH_FAILED'
            : result.reason === 'no-pubkey' ? 'NO_PUBKEY'
            : 'ALL_RELAYS_REJECTED'
          // syncDirty stays set so the next trigger retries.
        }
        await this._persistSyncMeta()
        return result
      } catch (err) {
        this.lastSyncError = err?.code || err?.message || 'UNKNOWN'
        console.warn('[addressBook] sync failed:', err)
        await this._persistSyncMeta()
        return { ok: false, reason: 'unknown', hadRemote: false, published: false,
          acceptedRelay: null, restored: 0, removed: 0, identityOnly: 0, deferred: 0, petnameUpdated: 0 }
      } finally {
        this.isSyncing = false
      }
    },

    /**
     * Pull the user's private NIP-51 address book and reconcile it
     * into the local store. Mechanically identical to `syncToNostr`
     * (same fetch-merge-publish-reconcile core) — the distinct entry
     * point exists so the restore wizard and the kebab "Restore from
     * Nostr" action read clearly and so the UI can show a recovery-
     * specific spinner via `isRecovering`.
     *
     * @returns same shape as `syncToNostr`, plus the recovery wizard
     *          reads `hadRemote` / `restored` / `removed` / `deferred`.
     */
    async recoverFromNostr({ identityStore, pool, relays, timeoutMs, profileFetcher } = {}) {
      await this.initialize()
      if (this.isSyncing || this.isRecovering) return null
      if (!identityStore || !identityStore.bootstrapped) {
        return { ok: false, reason: 'identity-not-bootstrapped' }
      }

      this.isRecovering = true
      try {
        const result = await this._runSync({ identityStore, pool, relays, timeoutMs, profileFetcher })
        if (result.ok) {
          this.lastRecoveryAt = Date.now()
          // Recovery publishes the merged union too, so when the
          // publish landed the local state is fully in sync.
          if (result.published) {
            this.lastSyncedAt = Date.now()
            this.syncDirty = false
            this.lastSyncError = null
          }
        }
        await this._persistSyncMeta()
        return result
      } catch (err) {
        console.warn('[addressBook] recovery failed:', err)
        await this._persistSyncMeta()
        return { ok: false, reason: 'unknown', hadRemote: false, published: false,
          acceptedRelay: null, restored: 0, removed: 0, identityOnly: 0, deferred: 0, petnameUpdated: 0 }
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
      if (type === 'arkade') {
        return this.isValidArkadeAddress(address)
      }
      if (type === 'bitcoin') {
        return this.isValidBitcoinAddress(address)
      }
      if (type === 'lnurl') {
        return isLnurl(address)
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

    isValidArkadeAddress(address) {
      return isArkadeAddress(address)
    },

    isValidBitcoinAddress(address) {
      return isBitcoinAddress(address)
    },

    // Detect address type from input. Order matters: Spark addresses can look
    // vaguely like base58 if misread, so we check them first.
    detectAddressType(address) {
      if (!address) return null
      if (isSparkAddress(address)) return 'spark'
      if (isArkadeAddress(address)) return 'arkade'
      if (isBitcoinAddress(address)) return 'bitcoin'
      // LNURL before the lightning-address check: an LNURL has no `@`, so the
      // two never collide, but keeping it explicit guards future edits.
      if (isLnurl(address)) return 'lnurl'
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

    /**
     * True when an entry has a usable payment destination right now.
     * The single predicate every send surface gates on — list rows,
     * the send picker, batch send — so an identity-only Nostr contact
     * (restored without a current lud16) is shown everywhere but never
     * routed into a payment flow it can't complete.
     *
     * Manual entries are payable by construction (addEntry validates
     * the address up front); the meaningful case this guards is a
     * Nostr contact whose `address` is `''` until a refresh lands.
     */
    isEntryPayable(entry) {
      if (!entry) return false
      const address = this.getEntryAddress(entry)
      if (!address) return false
      return this.isValidAddress(address, this.getEntryAddressType(entry))
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