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
// Legacy kind:30000 list — READ ONLY, for the one-time migration into
// the shared contacts doc. The old event is never written again.
import {
  fetchAddressBook,
  partitionContactPayload,
} from '../utils/nostrAddressBook.js'
import {
  fetchContactsDoc,
  fetchOwnWriteRelays,
  mergeEntriesIntoDoc,
  extractDocContacts,
  buildContactsDocEvent,
  publishContactsDoc,
  normalizeDoc,
  emptyDoc,
  collectDocContactIds,
} from '../utils/nostrContactsDoc.js'
import { DEFAULT_RELAYS } from '../utils/nostrRelays.js'

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

// Last-seen shared contacts doc: `{ eventId, createdAt, doc }`. Two
// jobs: (a) "never write blind" — with a cache we can safely republish
// when relays return nothing (relay data loss), instead of refusing or
// clobbering; (b) our own just-published doc is the freshest truth
// even before relays echo it back.
const DOC_CACHE_STORAGE_KEY = 'buhoGO_shared_contacts_doc_v1'

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
    // When the legacy kind:30000 list was folded into the shared doc.
    // Unset means the next sync still reads the old event; once set it
    // is never read again.
    legacyMigratedAt: null,
    // Which identity the sync metadata (migration latch, tombstones)
    // and the doc cache belong to. A restore or rotation changes the
    // pubkey, and the previous identity's state must never leak into
    // the new one — see _adoptSyncIdentity().
    syncMetaPubkey: null,
    // Bumped on every _markSyncDirty(). A finishing sync only clears
    // the dirty flag when the generation still matches what it
    // captured at start, so a mutation made mid-sync is never
    // silently marked clean.
    _dirtyGeneration: 0,
    // Pending delete-tombstones: [{ pubkey?, docId?, address?, deletedAt }].
    // A delete is a tombstone, never an omission — that's how a delete
    // propagates across devices instead of being "resurrected" by a
    // stale copy. Nostr entries carry their pubkey; manual entries the
    // doc contact id they were linked to (or their address as the
    // pre-link fallback).
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
            this.legacyMigratedAt = Number.isFinite(parsed.legacyMigratedAt)
              ? parsed.legacyMigratedAt
              : null
            this.syncMetaPubkey = typeof parsed.pubkey === 'string' ? parsed.pubkey : null
            this.nostrDeletions = Array.isArray(parsed.nostrDeletions)
              ? parsed.nostrDeletions.filter(
                  (d) => d && Number.isFinite(d.deletedAt) && (
                    typeof d.pubkey === 'string'
                    || typeof d.docId === 'string'
                    || typeof d.address === 'string'
                  ),
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
      // The generation bumps on EVERY mutation, even when the flag is
      // already up — a sync in flight compares generations on
      // completion so it never clears dirt it did not carry.
      this._dirtyGeneration += 1
      if (this.syncDirty) return
      this.syncDirty = true
      await this._persistSyncMeta()
    },

    async _persistSyncMeta() {
      try {
        localStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify({
          pubkey: this.syncMetaPubkey,
          lastSyncedAt: this.lastSyncedAt,
          lastRecoveryAt: this.lastRecoveryAt,
          syncDirty: this.syncDirty,
          legacyMigratedAt: this.legacyMigratedAt,
          nostrDeletions: this._prunedDeletions(),
        }))
      } catch (error) {
        console.warn('Error saving address-book sync metadata:', error)
      }
    },

    /**
     * Bind the sync metadata and doc cache to ONE identity. They
     * describe a specific pubkey's address book; after an identity
     * restore or rotation they would otherwise leak into the next
     * identity — the old doc cache force-published under the new key
     * (another identity's contacts, decrypted, republished), the old
     * migration latch suppressing the new identity's legacy import,
     * stale tombstones trashing the new identity's doc.
     *
     * On a pubkey change: drop all of it, and mark dirty when local
     * entries exist so the new identity publishes its own book. The
     * very first adoption (metadata written before this field existed)
     * is benign — that state was produced under the only identity the
     * device has seen.
     */
    async _adoptSyncIdentity(pubkey) {
      if (this.syncMetaPubkey === pubkey) return
      const firstAdoption = this.syncMetaPubkey === null
      this.syncMetaPubkey = pubkey
      if (!firstAdoption) {
        this.legacyMigratedAt = null
        this.nostrDeletions = []
        this.lastSyncedAt = null
        this.lastRecoveryAt = null
        try {
          localStorage.removeItem(DOC_CACHE_STORAGE_KEY)
        } catch { /* cache is re-creatable */ }
        // Entry links point into the PREVIOUS identity's doc. Kept,
        // they would make the new identity's first sync read the ids'
        // absence from ITS doc as remote hard deletes and drop every
        // carried-over contact. Stripped, those contacts re-append
        // into the new identity's doc like any unpublished entry.
        let unlinked = false
        for (let i = 0; i < this.entries.length; i += 1) {
          if (this.entries[i].doc_contact_id) {
            const { doc_contact_id, ...rest } = this.entries[i]
            this.entries.splice(i, 1, rest)
            unlinked = true
          }
        }
        if (unlinked) await this.persistEntries()
        if (this.entries.length > 0) {
          this._dirtyGeneration += 1
          this.syncDirty = true
        }
      }
      await this._persistSyncMeta()
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

        // A re-add supersedes any pending delete-tombstone for this
        // address, mirroring what addNostrContact does per pubkey.
        const addrLower = newEntry.address.toLowerCase()
        if (Array.isArray(this.nostrDeletions)) {
          this.nostrDeletions = this.nostrDeletions.filter(
            (d) => (d.address || '').toLowerCase() !== addrLower,
          )
        }

        this.entries.push(newEntry)
        await this.persistEntries()
        // Manual contacts live in the shared doc too — a create must
        // reach relays like any other mutation.
        await this._markSyncDirty()

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

        // Name and address are synced fields in the shared doc; notes
        // and color are device-local. Mark dirty only for the former —
        // avoids a publish round-trip for a notes-only edit.
        const nameChanged = updateData.name !== undefined
          && updatedEntry.name !== currentEntry.name
        const addressChanged = !!newAddress
          && updatedEntry.address !== currentEntry.address
        if (nameChanged || addressChanged) {
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

        // Record a tombstone, not just an omission — that's how the
        // delete propagates to other devices instead of being
        // "resurrected" by their stale copy of the list. In the shared
        // doc a tombstone lands as `trashed: true` (recoverable from
        // the other apps' trash), never as removal.
        const tombstone = { deletedAt: Date.now() }
        if (deletedEntry.source === CONTACT_SOURCES.NOSTR && deletedEntry.nostr_pubkey) {
          tombstone.pubkey = deletedEntry.nostr_pubkey
        }
        if (typeof deletedEntry.doc_contact_id === 'string' && deletedEntry.doc_contact_id) {
          tombstone.docId = deletedEntry.doc_contact_id
        }
        const address = this.getEntryAddress(deletedEntry)
        if (!tombstone.pubkey && !tombstone.docId && address) {
          tombstone.address = address.toLowerCase()
        }
        if (tombstone.pubkey || tombstone.docId || tombstone.address) {
          this.nostrDeletions = (this.nostrDeletions || []).filter((d) => (
            (!tombstone.pubkey || d.pubkey !== tombstone.pubkey)
            && (!tombstone.docId || d.docId !== tombstone.docId)
            && (!tombstone.address || (d.address || '') !== tombstone.address)
          ))
          this.nostrDeletions.push(tombstone)
          await this._markSyncDirty()
          // _markSyncDirty persists only on the clean-to-dirty flip;
          // the tombstone must hit disk even when the book was already
          // dirty, or an app kill drops the delete and the next sync
          // re-imports the contact.
          await this._persistSyncMeta()
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
     * Shared pipeline behind both `syncToNostr` and `recoverFromNostr`:
     * fetch the shared contacts doc, fold the legacy list in (first run
     * only), reconcile the doc into the local store, merge local
     * changes back into the doc, and publish when something changed.
     *
     * Safety rails, in order of importance:
     *   - NEVER write before a successful read. Every publish is a
     *     whole-document replace shared with the user's other apps; a
     *     blind write would delete their data everywhere.
     *   - "No doc exists" is only trusted when enough relays answered
     *     cleanly (2, or all of them for smaller relay sets) AND no
     *     doc cache exists. A timeout is not an absence.
     *   - A doc we cannot decrypt is never overwritten.
     *   - The replaceable clock strictly exceeds the doc we merged
     *     from, so our write wins the NIP-01 tie-break.
     *   - An over-sized doc aborts the publish — local state is kept
     *     and retried, nothing is ever truncated to fit.
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
      const fail = (reason, hadRemote = false) => ({
        ok: false, reason, hadRemote, published: false, acceptedRelay: null,
        restored: 0, removed: 0, identityOnly: 0, deferred: 0, petnameUpdated: 0,
      })

      const pubkey = identityStore?.nostrPubkeyHex
      if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
        return fail('no-pubkey')
      }

      let secretKey
      try {
        await this._adoptSyncIdentity(pubkey)
        secretKey = await identityStore.getNostrSecretKeyBytes()
        const relaySet = await this._resolveSyncRelays({ pool, relays, pubkey, timeoutMs })

        // 1. FETCH the shared doc — per-relay, so absence is provable.
        let fetched
        try {
          fetched = await fetchContactsDoc({ pool, relays: relaySet, pubkey, secretKey, timeoutMs })
        } catch (err) {
          return fail(err?.code === 'CONTACTS_DOC_DECRYPT_FAILED' ? 'decrypt-failed' : 'fetch-failed')
        }

        // 2. Establish the BASE doc. Our own cache can be fresher than
        //    what relays returned (a publish they haven't echoed yet,
        //    or relay data loss) — the newest known doc always wins.
        //    But an EMPTY fetch is only meaningful when enough relays
        //    provably answered: anything published from an unproven
        //    absence could replace a doc that merely sat out of reach.
        const cache = this._loadDocCache(pubkey)
        const absenceProven = fetched.reachedRelays >= Math.min(2, relaySet.length)
        let baseDoc
        let baseCreatedAt
        let baseEventId = ''
        let baseWasFetched = false
        let forcePublish = false
        let hadRemote = fetched.found
        if (fetched.found) {
          if (cache && cache.createdAt > fetched.event.created_at) {
            baseDoc = cache.doc
            baseCreatedAt = cache.createdAt
            baseEventId = cache.eventId
          } else {
            baseDoc = fetched.doc
            baseCreatedAt = fetched.event.created_at
            baseEventId = fetched.event.id
            baseWasFetched = true
          }
        } else if (!absenceProven) {
          return fail('fetch-failed')
        } else if (cache) {
          // Absence is proven yet we have seen the doc before: the
          // relays lost (or never got) it — recover it from the cache
          // and force a republish.
          baseDoc = cache.doc
          baseCreatedAt = cache.createdAt
          baseEventId = cache.eventId
          forcePublish = true
          hadRemote = true
        } else {
          baseDoc = emptyDoc()
          baseCreatedAt = 0
        }

        // A doc-linked entry whose record vanished from a genuinely
        // fetched doc was deleted forever in another app (emptied
        // trash, merged away). The merge below would otherwise
        // re-append it as a fresh record, resurrecting it everywhere.
        // Only a fetched base can prove this — absence from the cache
        // or an empty synthesized base proves nothing.
        let hardRemoved = 0
        if (baseWasFetched) {
          hardRemoved = this._applyDocHardDeletes(collectDocContactIds(baseDoc))
        }

        // 3. LEGACY MIGRATION (read-only): fold the old kind:30000
        //    list in exactly once. The read is conclusive when the
        //    event arrived, or when its absence is backed by the doc
        //    fetch having proven reachability for the same relay set
        //    moments earlier (fetchAddressBook alone cannot tell "no
        //    event" from "no relay answered"). An undecryptable event
        //    is permanently unreadable — nothing to migrate.
        let legacyRecords = []
        let legacyConclusive = false
        if (!this.legacyMigratedAt) {
          try {
            const legacy = await fetchAddressBook({ pool, relays: relaySet, pubkey, secretKey, timeoutMs })
            if (legacy) {
              hadRemote = true
              legacyRecords = partitionContactPayload(legacy.contacts).live
              legacyConclusive = true
            } else {
              legacyConclusive = absenceProven
            }
          } catch (err) {
            legacyConclusive = err?.code === 'ADDRESS_BOOK_DECRYPT_FAILED'
          }
        }

        // 4. RECONCILE doc (+ legacy) into the local store FIRST, so
        //    the publish below already carries everything we imported.
        const reconcile = await this._reconcileWithDoc(extractDocContacts(baseDoc), legacyRecords, {
          fetcher: typeof profileFetcher === 'function' ? profileFetcher : fetchProfile,
          pool,
          relays: relaySet,
        })

        reconcile.removed += hardRemoved

        // 5. MERGE local entries + tombstones into the doc. Legacy
        //    contacts whose kind:0 couldn't be fetched right now ride
        //    along as doc-only records — the doc is their durable
        //    home, the local import catches up on a later sync.
        let merged = mergeEntriesIntoDoc({
          doc: baseDoc,
          entries: this.entries,
          deletions: this._prunedDeletions(),
          extraNostrRecords: reconcile.legacyUnimported,
        })

        // 6. PUBLISH when the doc actually changed (or the cache
        //    recovery above demands it).
        let published = false
        let acceptedRelay = null
        let mustPublish = merged.changed || forcePublish

        // Rebase before publishing: the reconcile above can take tens
        // of seconds (kind:0 fetches), and an edit another app
        // published in that window must not be superseded by a doc
        // built from the pre-edit base. One re-fetch, no loop; on any
        // trouble we proceed with the original base, which is exactly
        // the pre-rebase behavior. A fresh doc older than our base
        // (possible when the cache won) never rebases us backwards.
        if (mustPublish) {
          try {
            const fresh = await fetchContactsDoc({ pool, relays: relaySet, pubkey, secretKey, timeoutMs })
            const isNewer = fresh.found && (
              fresh.event.created_at > baseCreatedAt
              || (fresh.event.created_at === baseCreatedAt && fresh.event.id !== baseEventId)
            )
            if (isNewer) {
              const freshRemoved = this._applyDocHardDeletes(collectDocContactIds(fresh.doc))
              if (freshRemoved > 0) {
                reconcile.removed += freshRemoved
                await this.persistEntries()
              }
              merged = mergeEntriesIntoDoc({
                doc: fresh.doc,
                entries: this.entries,
                deletions: this._prunedDeletions(),
                extraNostrRecords: reconcile.legacyUnimported,
              })
              fetched = fresh
              baseDoc = fresh.doc
              baseCreatedAt = fresh.event.created_at
              baseEventId = fresh.event.id
              baseWasFetched = true
              hadRemote = true
              // The window's edit may already contain everything we
              // were about to push — then there is nothing to publish
              // and the no-op path below caches the fresh doc.
              mustPublish = merged.changed || forcePublish
            }
          } catch (err) {
            console.warn('[addressBook] pre-publish rebase skipped:', err?.message || err)
          }
        }

        if (mustPublish) {
          const createdAt = Math.max(Math.floor(Date.now() / 1000), baseCreatedAt + 1)
          let event
          try {
            event = buildContactsDocEvent({ secretKey, pubkey, doc: merged.doc, createdAt })
          } catch (err) {
            if (err?.code === 'CONTACTS_DOC_TOO_LARGE') {
              console.warn('[addressBook] contacts doc over the size ceiling, publish deferred:', err.message)
              return fail('doc-too-large', hadRemote)
            }
            throw err
          }
          const fanout = publishContactsDoc({ pool, relays: relaySet, event, timeoutMs })
          const firstAccept = await fanout.firstAccept
          if (firstAccept) {
            published = true
            acceptedRelay = firstAccept.relay
            this._saveDocCache({ pubkey, eventId: event.id, createdAt, doc: merged.doc })
            await this._dropAppliedTombstones(merged.doc)
          } else {
            // Every relay refused — surface for diagnostics, the
            // caller keeps syncDirty set so it retries.
            const results = await fanout.allSettled
            console.warn('[addressBook] sync landed on zero relays:', results)
          }
        } else if (fetched.found && baseWasFetched) {
          // Nothing to push and the fetched doc was the base: remember
          // it. When the cache won as base it already holds newer
          // content — re-stamping it with the older fetched clock
          // would let the next sync prefer the stale relay copy (and
          // resurrect anything deleted since).
          this._saveDocCache({
            pubkey,
            eventId: fetched.event.id,
            createdAt: fetched.event.created_at,
            doc: baseDoc,
          })
        }

        // Secret key is done — the rest is pure-local bookkeeping.
        secretKey.fill(0)
        secretKey = null

        // Links are only real once the doc they point into exists
        // outside this device. After a refused publish an appended
        // record's id refers to a doc nobody has — carrying it would
        // make the next sync's hard-delete pass read the id's absence
        // from the real doc as a remote delete and drop the contact.
        // Matched links lose nothing by waiting: they re-derive on
        // every successful merge.
        if (!mustPublish || published) {
          await this._applyDocLinks(merged.links)
        }

        // The legacy list is migrated once its contacts verifiably
        // live in the doc: the read was conclusive, every legacy
        // record is represented (imported locally or folded in as a
        // doc-only record above), and any doc change was published.
        // From then on the old event is never read again (and it was
        // never written again).
        const changesLanded = mustPublish ? published : true
        if (!this.legacyMigratedAt && legacyConclusive && changesLanded) {
          this.legacyMigratedAt = Date.now()
        }

        const { legacyUnimported, ...counters } = reconcile
        return {
          ok: mustPublish ? published : true,
          hadRemote,
          published,
          acceptedRelay,
          ...counters,
        }
      } finally {
        if (secretKey) secretKey.fill(0)
      }
    },

    /**
     * Reconcile the shared doc (plus any not-yet-migrated legacy
     * records) into the local store:
     *   - a doc contact trashed with a newer clock removes the local
     *     entry — that is how a delete made in another app (or on
     *     another device) propagates here
     *   - doc contacts already local converge name/starred to the
     *     doc's last-writer-wins values and remember their doc id
     *   - Nostr doc contacts not local are rebuilt from their kind:0
     *     with bounded concurrency; manual ones are created directly
     *     from the doc's payment address
     *   - legacy records not in the doc and not local join the same
     *     import queue (that IS the migration)
     *
     * @returns {Promise<{ restored: number, removed: number,
     *   identityOnly: number, deferred: number, petnameUpdated: number,
     *   legacyUnimported: object[] }>}   // legacy records whose local
     *                                    // import deferred — the merge
     *                                    // folds them into the doc so
     *                                    // they are never lost
     */
    async _reconcileWithDoc(docContacts, legacyRecords, { fetcher, pool, relays }) {
      let removed = 0
      let restored = 0
      let identityOnly = 0
      let deferred = 0
      let petnameUpdated = 0
      const legacyUnimported = []

      // (a) Apply doc trash to local entries. `>=` on the clock: a
      //     trash always beats the entry state it was created from.
      for (let i = this.entries.length - 1; i >= 0; i -= 1) {
        const e = this.entries[i]
        let trashedMatch = null
        if (e.source === CONTACT_SOURCES.NOSTR && e.nostr_pubkey) {
          trashedMatch = docContacts.nostr.find((c) => c.trashed && c.pubkey === e.nostr_pubkey)
        } else {
          const addr = this.getEntryAddress(e).toLowerCase()
          trashedMatch = docContacts.manual.find((c) => c.trashed && (
            (c.docId && c.docId === e.doc_contact_id)
            || (addr && c.paymentAddress.toLowerCase() === addr)
          ))
        }
        if (trashedMatch && trashedMatch.updatedAtMs >= (e.updatedAt || 0)) {
          this.entries.splice(i, 1)
          removed += 1
        }
      }

      // (b) Nostr doc contacts: converge the ones we have, queue the
      //     ones we don't. A pending local tombstone blocks a
      //     re-import — our delete simply hasn't reached the doc yet.
      const localByPubkey = new Map()
      for (const e of this.entries) {
        if (e.source === CONTACT_SOURCES.NOSTR && e.nostr_pubkey) {
          localByPubkey.set(e.nostr_pubkey, e)
        }
      }

      const adoptDocValues = (entry, dc) => {
        const next = { ...entry }
        let touched = false
        if (dc.updatedAtMs > (entry.updatedAt || 0)) {
          if (dc.name && dc.name !== entry.name) {
            next.name = dc.name.slice(0, 80)
            if (entry.source === CONTACT_SOURCES.NOSTR) {
              const derived = pickDisplayNameFromProfile(entry.nostr_profile, entry.nostr_npub)
              next.name_locally_edited = next.name !== derived
            }
            touched = true
          }
          if (!!entry.isFavorite !== dc.starred) {
            next.isFavorite = dc.starred
            touched = true
          }
          if (touched) {
            // Adopt the doc's clock, not "now" — the entry must not
            // suddenly look newer than the doc value it just copied.
            next.updatedAt = dc.updatedAtMs
            petnameUpdated += 1
          }
        }
        if (dc.docId && entry.doc_contact_id !== dc.docId) {
          next.doc_contact_id = dc.docId
          touched = true
        }
        if (touched) {
          const idx = this.entries.findIndex((e) => e.id === entry.id)
          if (idx !== -1) this.entries.splice(idx, 1, next)
        }
      }

      const importQueue = []
      for (const dc of docContacts.nostr) {
        if (dc.trashed) continue
        const local = localByPubkey.get(dc.pubkey)
        if (local) {
          adoptDocValues(local, dc)
        } else if (!this._isTombstoned({ pubkey: dc.pubkey, docId: dc.docId, updatedAtMs: dc.updatedAtMs })) {
          importQueue.push({
            pubkey: dc.pubkey,
            name: dc.name,
            starred: dc.starred,
            docId: dc.docId,
            addedAt: dc.createdAtMs || undefined,
          })
        }
      }

      const docPubkeys = new Set(docContacts.nostr.map((c) => c.pubkey))
      for (const rec of legacyRecords) {
        if (localByPubkey.has(rec.pubkey) || docPubkeys.has(rec.pubkey)) continue
        if (this._isTombstoned({ pubkey: rec.pubkey, updatedAtMs: rec.updatedAt })) continue
        importQueue.push({
          pubkey: rec.pubkey,
          name: rec.petname || '',
          starred: false,
          docId: null,
          relays: rec.relays,
          addedAt: rec.addedAt,
          updatedAt: rec.updatedAt,
          legacy: true,
        })
      }

      // (c) Rebuild queued contacts from their kind:0, bounded
      //     concurrency so a 50-contact restore doesn't turn into 50
      //     serial relay round-trips.
      for (let i = 0; i < importQueue.length; i += SYNC_FETCH_CONCURRENCY) {
        const chunk = importQueue.slice(i, i + SYNC_FETCH_CONCURRENCY)
        const outcomes = await Promise.all(
          chunk.map((rec) => this._restoreOneRemoteContact(rec, { fetcher, pool, relays })),
        )
        for (let j = 0; j < outcomes.length; j += 1) {
          const outcome = outcomes[j]
          if (outcome === 'restored') restored += 1
          else if (outcome === 'identity-only') { restored += 1; identityOnly += 1 }
          else {
            deferred += 1
            if (chunk[j].legacy) legacyUnimported.push(chunk[j])
          }
        }
      }

      // (d) Manual doc contacts: link/converge the ones we have,
      //     create the ones we don't. No relay round-trip needed —
      //     the doc itself carries everything a manual entry is.
      for (const dc of docContacts.manual) {
        if (dc.trashed) continue
        const local = this.entries.find((e) => (
          e.source !== CONTACT_SOURCES.NOSTR && (
            (dc.docId && e.doc_contact_id === dc.docId)
            || this.getEntryAddress(e).toLowerCase() === dc.paymentAddress.toLowerCase()
          )
        ))
        if (local) {
          adoptDocValues(local, dc)
          continue
        }
        if (this._isTombstoned({ docId: dc.docId, address: dc.paymentAddress, updatedAtMs: dc.updatedAtMs })) continue
        // Another app may hold address formats we can't route (or a
        // Nostr entry may already own this address) — those stay
        // doc-only rather than becoming broken local entries.
        const addressType = this.detectAddressType(dc.paymentAddress)
        if (!addressType || !this.isValidAddress(dc.paymentAddress, addressType)) continue
        if (this.findContactByAddress(dc.paymentAddress)) continue
        this.entries.push({
          id: `addr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: (dc.name || dc.paymentAddress).slice(0, 80),
          address: dc.paymentAddress,
          addressType,
          lightningAddress: addressType === 'lightning' ? dc.paymentAddress : '',
          color: this.getRandomColor(),
          notes: '',
          isFavorite: dc.starred,
          lastUsedAt: null,
          createdAt: dc.createdAtMs || Date.now(),
          updatedAt: dc.updatedAtMs || Date.now(),
          doc_contact_id: dc.docId,
        })
        restored += 1
      }

      await this.persistEntries()
      await this._persistSyncMeta()
      return { restored, removed, identityOnly, deferred, petnameUpdated, legacyUnimported }
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
          isFavorite: !!rec.starred,
          // The canonical identity is the pubkey — a contact who
          // dropped their lud16 must still come back (identity-only).
          allowWithoutLightningAddress: true,
        })
        if (rec.name && rec.name !== entry.name) {
          // The doc's name wins over the profile-derived one; going
          // through updateEntry sets `name_locally_edited` correctly.
          await this.updateEntry(entry.id, { name: rec.name })
        }
        const patch = {}
        if (Number.isFinite(rec.addedAt) && rec.addedAt > 0) {
          // Preserve the original add time so the restored list keeps
          // the user's mental ordering.
          patch.createdAt = rec.addedAt
        }
        if (rec.docId) patch.doc_contact_id = rec.docId
        if (Object.keys(patch).length > 0) {
          const idx = this.entries.findIndex((e) => e.id === entry.id)
          if (idx !== -1) {
            this.entries.splice(idx, 1, { ...this.entries[idx], ...patch })
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
     * Resolve the relay set for a sync: an explicit override wins
     * (tests, targeted recovery), otherwise the defaults unioned with
     * the user's own NIP-65 write relays — the doc must land where
     * their other apps look for it.
     */
    async _resolveSyncRelays({ pool, relays, pubkey, timeoutMs }) {
      if (Array.isArray(relays) && relays.length > 0) return [...relays]
      const own = await fetchOwnWriteRelays({
        pool,
        pubkey,
        timeoutMs: Math.min(Number.isFinite(timeoutMs) ? timeoutMs : 4000, 4000),
      })
      return [...new Set([...DEFAULT_RELAYS, ...own])]
    },

    /**
     * True when a pending local delete matches the given identity AND
     * is not older than the incoming record's clock. A doc write newer
     * than the delete is a deliberate cross-app re-add — it must win
     * now, not after the 90-day tombstone TTL runs out.
     */
    _isTombstoned({ pubkey, docId, address, updatedAtMs = 0 }) {
      const addr = typeof address === 'string' ? address.toLowerCase() : ''
      const clock = Number.isFinite(updatedAtMs) ? updatedAtMs : 0
      return this._prunedDeletions().some((d) => (
        ((pubkey && d.pubkey === pubkey)
          || (docId && d.docId === docId)
          || (addr && (d.address || '') === addr))
        && d.deletedAt >= clock
      ))
    },

    /**
     * Remove entries whose linked doc record vanished from a genuinely
     * fetched doc: that is a hard delete made in another app (emptied
     * trash, merged away), and re-appending the entry on the next
     * merge would resurrect the contact everywhere. Entries that were
     * never doc-linked are untouched — they have not been published
     * yet, so their absence proves nothing. Callers gate on a fetched
     * base; the cache and the empty synthesized base cannot prove a
     * hard delete.
     *
     * @param {Set<string>} docIds  every contact id in the fetched doc
     * @returns {number}            entries removed
     */
    _applyDocHardDeletes(docIds) {
      let removed = 0
      for (let i = this.entries.length - 1; i >= 0; i -= 1) {
        const linkedId = this.entries[i].doc_contact_id
        if (typeof linkedId === 'string' && linkedId && !docIds.has(linkedId)) {
          this.entries.splice(i, 1)
          removed += 1
        }
      }
      return removed
    },

    /**
     * Last-seen shared doc for THIS identity, or null. A cache written
     * under a different pubkey is another identity's (decrypted)
     * address book — treating it as ours would republish it under the
     * wrong key, so it counts as absent. Also null on corrupt data;
     * the cache is re-creatable from the next successful fetch.
     */
    _loadDocCache(pubkey) {
      try {
        const raw = localStorage.getItem(DOC_CACHE_STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || !Number.isFinite(parsed.createdAt) || typeof parsed.doc !== 'object') {
          return null
        }
        if (parsed.pubkey !== pubkey) return null
        return {
          eventId: typeof parsed.eventId === 'string' ? parsed.eventId : '',
          createdAt: parsed.createdAt,
          doc: normalizeDoc(parsed.doc),
        }
      } catch {
        return null
      }
    },

    _saveDocCache({ pubkey, eventId, createdAt, doc }) {
      try {
        localStorage.setItem(DOC_CACHE_STORAGE_KEY, JSON.stringify({ pubkey, eventId, createdAt, doc }))
      } catch (error) {
        console.warn('Error saving contacts doc cache:', error)
      }
    },

    /**
     * Remember which doc contact each entry maps to. The link is what
     * keeps a rename stable: matching by id survives the address or
     * name changing on either side.
     */
    async _applyDocLinks(links) {
      if (!links || typeof links !== 'object') return
      let touched = false
      for (let i = 0; i < this.entries.length; i += 1) {
        const docId = links[this.entries[i].id]
        if (typeof docId === 'string' && docId && this.entries[i].doc_contact_id !== docId) {
          this.entries.splice(i, 1, { ...this.entries[i], doc_contact_id: docId })
          touched = true
        }
      }
      if (touched) await this.persistEntries()
    },

    /**
     * A tombstone has done its job once the published doc shows its
     * target trashed — from then on the doc itself carries the delete
     * and the local tombstone would only block a deliberate re-add
     * made in another app.
     */
    async _dropAppliedTombstones(doc) {
      const { nostr, manual } = extractDocContacts(doc)
      const trashedPubkeys = new Set(nostr.filter((c) => c.trashed).map((c) => c.pubkey))
      const trashedDocIds = new Set(
        [...nostr, ...manual].filter((c) => c.trashed && c.docId).map((c) => c.docId),
      )
      const trashedAddresses = new Set(
        manual.filter((c) => c.trashed).map((c) => c.paymentAddress.toLowerCase()),
      )
      const before = (this.nostrDeletions || []).length
      this.nostrDeletions = (this.nostrDeletions || []).filter((d) => !(
        (d.pubkey && trashedPubkeys.has(d.pubkey))
        || (d.docId && trashedDocIds.has(d.docId))
        || (d.address && trashedAddresses.has(d.address))
      ))
      if (this.nostrDeletions.length !== before) await this._persistSyncMeta()
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
      const dirtyGenAtStart = this._dirtyGeneration
      try {
        const result = await this._runSync({ identityStore, pool, relays, timeoutMs, profileFetcher })
        if (result.ok) {
          this.lastSyncedAt = Date.now()
          // Only clear dirt this run actually carried — a contact
          // added while the publish was in flight stays dirty and the
          // next trigger picks it up.
          if (this._dirtyGeneration === dirtyGenAtStart) this.syncDirty = false
          this.lastSyncError = null
        } else {
          this.lastSyncError = result.reason === 'decrypt-failed' ? 'DECRYPT_FAILED'
            : result.reason === 'fetch-failed' ? 'FETCH_FAILED'
            : result.reason === 'no-pubkey' ? 'NO_PUBKEY'
            : result.reason === 'doc-too-large' ? 'DOC_TOO_LARGE'
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
      const dirtyGenAtStart = this._dirtyGeneration
      try {
        const result = await this._runSync({ identityStore, pool, relays, timeoutMs, profileFetcher })
        if (result.ok) {
          this.lastRecoveryAt = Date.now()
          // Recovery publishes the merged union too, so when the
          // publish landed the local state is fully in sync — unless
          // a mutation slipped in while it ran (see syncToNostr).
          if (result.published) {
            this.lastSyncedAt = Date.now()
            if (this._dirtyGeneration === dirtyGenAtStart) this.syncDirty = false
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

    /**
     * Move the address book across an identity change, in the only
     * order that cannot lose data:
     *
     *   1. flush pending edits under the CURRENT identity (best
     *      effort — a failed flush must not strand the user on an
     *      identity they asked to leave; whatever did not land stays
     *      in the old identity's doc from an earlier publish, and the
     *      old identity remains reachable to retry from)
     *   2. `changeIdentity()` — the caller flips the identity store
     *      (switch or create); injected so this store never has to
     *      know which of the two it is
     *   3. keepContacts=false: drop the local book with NO tombstones
     *      (the old identity's doc must stay intact; there is simply
     *      nothing local to carry over)
     *      keepContacts=true: keep the entries — the sync below
     *      adopts the new pubkey, which unlinks every doc id and
     *      marks the book dirty, so the carried contacts publish
     *      into the new identity's doc as a union with whatever it
     *      already holds
     *   4. pull the new identity's book
     *
     * Runs under `isRecovering` for its WHOLE duration so the
     * app-level sync driver (debounce timers, background flushes)
     * cannot fire between steps and publish the old book under the
     * new key before step 3 has decided its fate.
     *
     * @param {{
     *   identityStore:  any,
     *   changeIdentity: () => Promise<unknown>,
     *   keepContacts?:  boolean,
     *   pool?: any, relays?: readonly string[], timeoutMs?: number,
     *   profileFetcher?: Function,
     * }} args
     * @returns same shape as `recoverFromNostr`, or null when another
     *          sync operation is already running
     */
    async switchContactsIdentity({
      identityStore, changeIdentity, keepContacts = false,
      pool, relays, timeoutMs, profileFetcher,
    } = {}) {
      await this.initialize()
      if (typeof changeIdentity !== 'function') {
        throw new TypeError('changeIdentity callback is required')
      }
      if (this.isSyncing || this.isRecovering) return null
      if (!identityStore || !identityStore.bootstrapped) {
        return { ok: false, reason: 'identity-not-bootstrapped' }
      }

      this.isRecovering = true
      try {
        // 1. Flush the outgoing identity. Best-effort ONLY when the
        //    entries survive the switch anyway (keepContacts): for a
        //    start-fresh switch, step 3 destroys the local book, so an
        //    unflushed dirty delta (offline adds, edits, deletes since
        //    the last publish) would be destroyed with it. That switch
        //    must not happen — abort before the identity flips and let
        //    the caller surface "sync your changes first".
        if (this.syncDirty) {
          const dirtyGenAtStart = this._dirtyGeneration
          try {
            const flushed = await this._runSync({ identityStore, pool, relays, timeoutMs, profileFetcher })
            if (flushed.ok) {
              this.lastSyncedAt = Date.now()
              if (this._dirtyGeneration === dirtyGenAtStart) this.syncDirty = false
            }
          } catch (err) {
            console.warn('[addressBook] pre-switch flush failed:', err)
          }
        }
        if (!keepContacts && this.syncDirty) {
          return { ok: false, reason: 'flush-failed', hadRemote: false, published: false,
            acceptedRelay: null, restored: 0, removed: 0, identityOnly: 0, deferred: 0, petnameUpdated: 0 }
        }

        // 2. The identity flips here.
        await changeIdentity()

        // 3. Decide what the new identity starts with.
        if (!keepContacts) {
          this.entries = []
          this.searchQuery = ''
          this.nostrDeletions = []
          this.syncDirty = false
          await this.persistEntries()
          await this._persistSyncMeta()
        }

        // 4. Pull the new identity's book (adoption runs inside
        //    _runSync and handles the keepContacts=true unlink+dirty).
        const dirtyGenAtStart = this._dirtyGeneration
        const result = await this._runSync({ identityStore, pool, relays, timeoutMs, profileFetcher })
        if (result.ok) {
          this.lastRecoveryAt = Date.now()
          if (result.published) {
            this.lastSyncedAt = Date.now()
            if (this._dirtyGeneration === dirtyGenAtStart) this.syncDirty = false
            this.lastSyncError = null
          }
        }
        await this._persistSyncMeta()
        return result
      } catch (err) {
        console.warn('[addressBook] identity switch failed:', err)
        await this._persistSyncMeta()
        return { ok: false, reason: 'unknown', hadRemote: false, published: false,
          acceptedRelay: null, restored: 0, removed: 0, identityOnly: 0, deferred: 0, petnameUpdated: 0 }
      } finally {
        this.isRecovering = false
      }
    },

    // Toggle favorite status. Favorites travel as the shared doc's
    // `starred` flag, so the flip syncs like any other edit.
    async toggleFavorite(id) {
      await this.initialize()
      const entry = this.entries.find(e => e.id === id)
      if (entry) {
        entry.isFavorite = !entry.isFavorite
        entry.updatedAt = Date.now()
        await this.persistEntries()
        await this._markSyncDirty()
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