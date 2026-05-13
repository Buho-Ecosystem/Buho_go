import { defineStore } from 'pinia'
import {
  isSparkAddress,
  isBitcoinAddress,
  isLightningAddress,
} from '../utils/addressUtils.js'
import { fetchProfile, parseProfileContent } from '../utils/nostrFetch.js'

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

export const useAddressBookStore = defineStore('addressBook', {
  state: () => ({
    entries: [],
    _initialized: false,
    searchQuery: '',
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
      this._initialized = true
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
      if (!event || event.kind !== 0 || event.pubkey?.toLowerCase() !== pubkey) {
        throw new Error('Profile event is missing or invalid')
      }

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
        nostr_profile: { ...profile },
        nostr_relay_hints: sanitizedHints,
        last_synced_at: now,
        name_locally_edited: false,
      }

      this.entries.push(newEntry)
      await this.persistEntries()
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
      updated.nostr_profile = { ...profile }
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