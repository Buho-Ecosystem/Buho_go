import { defineStore } from 'pinia'
import { useAddressBookStore } from './addressBook'

// Window during which a pending contact link can be matched against a
// newly observed outgoing transaction. 30 minutes is generous: it
// accommodates Spark/LNBits/NWC settlement latency, app backgrounding,
// and even a quick reconnect, while still preventing the queue from
// growing unboundedly when a send fails silently.
const PENDING_LINK_TTL_MS = 30 * 60 * 1000

// How far apart a tx's timestamp may be from the pending link's
// `sentAt` for us to consider them the same payment. The tx list's
// `timestamp` is usually within a few seconds of the send call, but
// Spark settlement can lag, so 5 minutes catches everything in practice
// without being so wide it can swallow an unrelated next send.
const PENDING_LINK_TIME_WINDOW_MS = 5 * 60 * 1000

export const useTransactionMetadataStore = defineStore('transactionMetadata', {
  state: () => ({
    // Map of txId to metadata object
    metadata: {},
    // Queue of outgoing payments whose tx-id we don't know yet. Each
    // entry remembers the contact we sent to so when the new tx
    // appears in the list we can stamp it without having to derive
    // the id from the provider response (which varies by wallet — NWC
    // returns only `preimage`, Spark returns a payment id that isn't
    // the transfer id, etc.).
    pendingContactLinks: []
  }),

  getters: {
    // Get metadata for a specific transaction
    getMetadataForTransaction: (state) => (txId) => {
      return state.metadata[txId] || null
    },

    // Get contact for a transaction (returns full contact object from address book)
    getContactForTransaction: (state) => (txId) => {
      const metadata = state.metadata[txId]
      if (!metadata?.contactId) return null

      const addressBookStore = useAddressBookStore()
      return addressBookStore.getEntryById(metadata.contactId)
    },

    // Get tags for a transaction
    getTagsForTransaction: (state) => (txId) => {
      const metadata = state.metadata[txId]
      return metadata?.tags || []
    },

    // Get note for a transaction
    getNoteForTransaction: (state) => (txId) => {
      const metadata = state.metadata[txId]
      return metadata?.customNote || ''
    },

    // Get all transactions that have a specific tag
    getTransactionsWithTag: (state) => (tag) => {
      return Object.keys(state.metadata).filter(txId => {
        const metadata = state.metadata[txId]
        return metadata?.tags?.includes(tag)
      })
    },

    // Get all transactions linked to a specific contact
    getTransactionsForContact: (state) => (contactId) => {
      return Object.keys(state.metadata).filter(txId => {
        const metadata = state.metadata[txId]
        return metadata?.contactId === contactId
      })
    },

    // Get all used tags (for autocomplete/suggestions)
    getAllTags: (state) => {
      const tagsSet = new Set()
      Object.values(state.metadata).forEach(meta => {
        if (meta.tags) {
          meta.tags.forEach(tag => tagsSet.add(tag))
        }
      })
      return Array.from(tagsSet).sort()
    }
  },

  actions: {
    // Initialize store from localStorage
    async initialize() {
      try {
        const savedMetadata = localStorage.getItem('buhoGO_transaction_metadata')
        if (savedMetadata) {
          this.metadata = JSON.parse(savedMetadata)
        }
      } catch (error) {
        console.error('Error loading transaction metadata:', error)
        this.metadata = {}
      }
      try {
        const savedPending = localStorage.getItem('buhoGO_pending_contact_links')
        if (savedPending) {
          const parsed = JSON.parse(savedPending)
          // Drop stale entries on load so a crash mid-send can't leave
          // a zombie link hanging around forever.
          const now = Date.now()
          this.pendingContactLinks = Array.isArray(parsed)
            ? parsed.filter((link) => now - (link?.sentAt || 0) < PENDING_LINK_TTL_MS)
            : []
        }
      } catch (error) {
        console.error('Error loading pending contact links:', error)
        this.pendingContactLinks = []
      }
    },

    /**
     * Queue a contact link for an in-flight send. Called from the
     * Wallet's confirmPayment success path before we know the
     * provider-assigned tx id. `consumePendingContactLinks` resolves
     * the queue against the tx list on the next refresh.
     *
     * Idempotent for the same (contactId, recipientAddress, amountSats)
     * triple within the TTL window — a rage-tap that submits twice
     * won't accidentally claim two unrelated outgoing txs.
     */
    async enqueuePendingContactLink({ contactId, recipientAddress, amountSats }) {
      if (!contactId || !recipientAddress) return
      const now = Date.now()
      const normalisedAddress = String(recipientAddress).toLowerCase().trim()
      const amount = Number(amountSats) || 0

      // Drop any equivalent entry already in the queue (re-submission).
      this.pendingContactLinks = this.pendingContactLinks.filter((link) => !(
        link.contactId === contactId &&
        link.recipientAddress === normalisedAddress &&
        link.amountSats === amount
      ))
      // Also drop stale entries while we're here.
      this.pendingContactLinks = this.pendingContactLinks.filter(
        (link) => now - (link.sentAt || 0) < PENDING_LINK_TTL_MS,
      )

      this.pendingContactLinks.push({
        contactId,
        recipientAddress: normalisedAddress,
        amountSats: amount,
        sentAt: now,
      })
      await this.persistPendingLinks()
    },

    /**
     * Drain the pending queue against a list of transactions, tagging
     * any outgoing tx that lines up with a queued link by amount +
     * timestamp window. Idempotent — once a link is consumed it
     * disappears, and txs that already have a contactId are skipped.
     *
     * Safe to call on every list refresh; the work is O(linkCount *
     * txCount) but both are tiny in practice.
     */
    async consumePendingContactLinks(transactions) {
      if (!Array.isArray(transactions) || transactions.length === 0) return 0
      if (!this.pendingContactLinks || this.pendingContactLinks.length === 0) return 0

      const now = Date.now()
      // Start from a fresh, TTL-filtered list so stale entries never
      // get to claim anything even if the refresh wakes them up.
      let remaining = this.pendingContactLinks.filter(
        (link) => now - (link.sentAt || 0) < PENDING_LINK_TTL_MS,
      )

      let matched = 0
      let mutated = remaining.length !== this.pendingContactLinks.length

      // Iterate outgoing txs from newest to oldest — most recent send
      // is most likely the one waiting for a tag.
      const outgoing = transactions
        .filter((tx) => {
          const t = (tx?.type || '').toLowerCase()
          if (t === 'send' || t === 'sent' || t === 'outgoing') return true
          if (t === 'receive' || t === 'received' || t === 'incoming') return false
          // Sign-fallback for providers that don't normalise direction
          return Number(tx?.amount || 0) < 0
        })
        .filter((tx) => tx?.id && !this.metadata[tx.id]?.contactId)

      for (const tx of outgoing) {
        const txAmount = Math.abs(Number(tx.amount) || 0)
        const txTimeMs = this._resolveTxTimeMs(tx)
        // Find the best link match — same amount, sentAt within the
        // window. We don't require exact ms parity; Spark settlement
        // can lag a few seconds behind the send call.
        const linkIdx = remaining.findIndex((link) => {
          if (link.amountSats && txAmount && link.amountSats !== txAmount) return false
          if (!txTimeMs) return true // no timestamp — fall back to amount
          return Math.abs(txTimeMs - link.sentAt) <= PENDING_LINK_TIME_WINDOW_MS
        })
        if (linkIdx === -1) continue

        const link = remaining[linkIdx]
        try {
          await this.setContactForTransaction(tx.id, link.contactId)
          matched += 1
          remaining.splice(linkIdx, 1)
          mutated = true
        } catch (err) {
          console.warn('[txMetadata] failed to stamp tx from pending link:', err)
        }
      }

      if (mutated) {
        this.pendingContactLinks = remaining
        await this.persistPendingLinks()
      }
      return matched
    },

    /**
     * Tx timestamps come from different fields depending on the
     * provider — Spark uses `createdTime`, NWC uses `settled_at`,
     * the normalised path on TransactionHistory writes `timestamp`.
     * Returns ms since epoch, or 0 when nothing parses.
     */
    _resolveTxTimeMs(tx) {
      const raw = tx?.timestamp ?? tx?.settled_at ?? tx?.createdTime ?? tx?.created_at ?? null
      if (raw == null) return 0
      if (typeof raw === 'number') {
        // Seconds vs ms — values below 1e12 are seconds.
        return raw < 1e12 ? raw * 1000 : raw
      }
      const t = Date.parse(raw)
      return Number.isFinite(t) ? t : 0
    },

    async persistPendingLinks() {
      try {
        localStorage.setItem(
          'buhoGO_pending_contact_links',
          JSON.stringify(this.pendingContactLinks),
        )
      } catch (error) {
        console.error('Error saving pending contact links:', error)
      }
    },

    // Set contact for a transaction
    async setContactForTransaction(txId, contactId) {
      try {
        if (!txId) {
          throw new Error('Transaction ID is required')
        }

        // Initialize metadata object if it doesn't exist
        if (!this.metadata[txId]) {
          this.metadata[txId] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now()
          }
        }

        // Update contact ID
        this.metadata[txId].contactId = contactId
        this.metadata[txId].updatedAt = Date.now()

        await this.persistMetadata()
        return this.metadata[txId]
      } catch (error) {
        console.error('Error setting contact for transaction:', error)
        throw error
      }
    },

    // Set note for a transaction
    async setNoteForTransaction(txId, note) {
      try {
        if (!txId) {
          throw new Error('Transaction ID is required')
        }

        // Initialize metadata object if it doesn't exist
        if (!this.metadata[txId]) {
          this.metadata[txId] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now()
          }
        }

        // Update note (max 500 characters)
        this.metadata[txId].customNote = (note || '').trim().substring(0, 500)
        this.metadata[txId].updatedAt = Date.now()

        await this.persistMetadata()
        return this.metadata[txId]
      } catch (error) {
        console.error('Error setting note for transaction:', error)
        throw error
      }
    },

    // Set tags for a transaction
    async setTagsForTransaction(txId, tags) {
      try {
        if (!txId) {
          throw new Error('Transaction ID is required')
        }

        // Initialize metadata object if it doesn't exist
        if (!this.metadata[txId]) {
          this.metadata[txId] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now()
          }
        }

        // Validate and limit tags (max 2 tags as per user requirement)
        const validTags = Array.isArray(tags) ? tags : []
        const limitedTags = validTags.slice(0, 2).map(tag => tag.trim()).filter(tag => tag.length > 0)

        this.metadata[txId].tags = limitedTags
        this.metadata[txId].updatedAt = Date.now()

        await this.persistMetadata()
        return this.metadata[txId]
      } catch (error) {
        console.error('Error setting tags for transaction:', error)
        throw error
      }
    },

    // Add a single tag to a transaction (respects 2-tag limit)
    async addTagToTransaction(txId, tag) {
      try {
        const currentTags = this.getTagsForTransaction(txId)

        // Don't add if already exists
        if (currentTags.includes(tag)) {
          return this.metadata[txId]
        }

        // Don't add if already at limit (2 tags)
        if (currentTags.length >= 2) {
          throw new Error('Maximum 2 tags allowed per transaction')
        }

        const newTags = [...currentTags, tag]
        return await this.setTagsForTransaction(txId, newTags)
      } catch (error) {
        console.error('Error adding tag to transaction:', error)
        throw error
      }
    },

    // Remove a tag from a transaction
    async removeTagFromTransaction(txId, tag) {
      try {
        const currentTags = this.getTagsForTransaction(txId)
        const newTags = currentTags.filter(t => t !== tag)
        return await this.setTagsForTransaction(txId, newTags)
      } catch (error) {
        console.error('Error removing tag from transaction:', error)
        throw error
      }
    },

    // Update all metadata fields at once
    async updateTransactionMetadata(txId, metadata) {
      try {
        if (!txId) {
          throw new Error('Transaction ID is required')
        }

        // Initialize if doesn't exist
        if (!this.metadata[txId]) {
          this.metadata[txId] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now()
          }
        }

        // Update fields that are provided
        if (metadata.contactId !== undefined) {
          this.metadata[txId].contactId = metadata.contactId
        }
        if (metadata.customNote !== undefined) {
          this.metadata[txId].customNote = (metadata.customNote || '').trim().substring(0, 500)
        }
        if (metadata.tags !== undefined) {
          const validTags = Array.isArray(metadata.tags) ? metadata.tags : []
          this.metadata[txId].tags = validTags.slice(0, 2).map(tag => tag.trim()).filter(tag => tag.length > 0)
        }

        this.metadata[txId].updatedAt = Date.now()

        await this.persistMetadata()
        return this.metadata[txId]
      } catch (error) {
        console.error('Error updating transaction metadata:', error)
        throw error
      }
    },

    // Clear all metadata for a transaction
    async clearMetadataForTransaction(txId) {
      try {
        if (!txId) {
          throw new Error('Transaction ID is required')
        }

        delete this.metadata[txId]
        await this.persistMetadata()
      } catch (error) {
        console.error('Error clearing transaction metadata:', error)
        throw error
      }
    },

    // Clear all metadata for a specific contact (useful when contact is deleted)
    async clearMetadataForContact(contactId) {
      try {
        let changed = false
        Object.keys(this.metadata).forEach(txId => {
          if (this.metadata[txId].contactId === contactId) {
            this.metadata[txId].contactId = null
            this.metadata[txId].updatedAt = Date.now()
            changed = true
          }
        })

        if (changed) {
          await this.persistMetadata()
        }
      } catch (error) {
        console.error('Error clearing metadata for contact:', error)
        throw error
      }
    },

    // Persist metadata to localStorage
    async persistMetadata() {
      try {
        localStorage.setItem('buhoGO_transaction_metadata', JSON.stringify(this.metadata))
      } catch (error) {
        console.error('Error saving transaction metadata:', error)
        throw new Error('Failed to save transaction metadata')
      }
    },

    // Clear all metadata (for troubleshooting/reset)
    async clearAll() {
      this.metadata = {}
      localStorage.removeItem('buhoGO_transaction_metadata')
    },

    // Import metadata from backup
    async importMetadata(metadataObject) {
      try {
        if (typeof metadataObject !== 'object') {
          throw new Error('Invalid metadata format')
        }

        this.metadata = { ...this.metadata, ...metadataObject }
        await this.persistMetadata()

        return Object.keys(metadataObject).length
      } catch (error) {
        console.error('Error importing metadata:', error)
        throw error
      }
    },

    // Export metadata (for backup)
    exportMetadata() {
      return JSON.parse(JSON.stringify(this.metadata))
    }
  }
})
