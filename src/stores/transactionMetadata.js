import { defineStore } from 'pinia'
import { useAddressBookStore } from './addressBook'

// How long a pending contact link survives in the queue. This must
// outlive "send now, open history days later" — the link is the only
// bridge between the send (where we know the recipient but not the
// provider-assigned tx id) and the tx list (where the id appears). A
// short TTL silently dropped these links before the user looked, which
// is exactly why old sends showed a generic icon instead of the
// contact. Matching precision does NOT come from the TTL — it comes
// from PENDING_LINK_TIME_WINDOW_MS below, which pins the link to a tx
// created within minutes of `sentAt`. So we can keep links for a long
// time cheaply; the queue is also size-capped on enqueue.
const PENDING_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Hard cap on the queue so the long TTL can't let unmatched links
// (e.g. sends whose tx never surfaced) grow without bound.
const MAX_PENDING_LINKS = 200

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

    // Get contact for a transaction (returns full contact object from
    // address book). Resolution order:
    //   1. An explicit contactId — a manual "Assign contact" choice wins.
    //   2. A manual "Remove contact" (contactCleared) — stay anonymous
    //      even if the address would otherwise resolve to a contact.
    //   3. The durable recipientAddress, resolved LIVE against the
    //      address book. This is what makes "add the contact later and
    //      every past payment to that address lights up" work, with no
    //      re-scan or re-stamp: the avatar/name simply follow the book.
    getContactForTransaction: (state) => (txId) => {
      const metadata = state.metadata[txId]
      if (!metadata) return null

      const addressBookStore = useAddressBookStore()
      if (metadata.contactId) return addressBookStore.getEntryById(metadata.contactId)
      if (metadata.contactCleared) return null
      if (metadata.recipientAddress) return addressBookStore.findContactByAddress(metadata.recipientAddress)
      return null
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

    // Get the LUD-09 successAction (the recipient's post-payment message)
    // attached to a transaction, already resolved for display.
    getSuccessActionForTransaction: (state) => (txId) => {
      const metadata = state.metadata[txId]
      return metadata?.successAction || null
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
     * Queue a pending link for an in-flight send. Called from the
     * Wallet's confirmPayment success path before we know the
     * provider-assigned tx id. `consumePendingContactLinks` resolves
     * the queue against the tx list on the next refresh.
     *
     * `recipientAddress` is required; `contactId` is optional. We queue
     * a link for EVERY saveable outgoing send, not only ones to a known
     * contact, so the recipient address gets stamped onto the tx no
     * matter what. That durable address is what later lets a contact
     * added/edited after the fact resolve live (see getContactForTransaction).
     *
     * Idempotent for the same (contactId, recipientAddress, amountSats)
     * triple within the TTL window — a rage-tap that submits twice
     * won't accidentally claim two unrelated outgoing txs.
     */
    async enqueuePendingContactLink({ contactId, recipientAddress, amountSats, successAction = null }) {
      // Queue when there's anything to stamp once the tx surfaces: a recipient
      // address (for live contact resolution) and/or a LUD-09 successAction
      // (the recipient's post-payment message we want to keep on the tx).
      if (!recipientAddress && !successAction) return
      const now = Date.now()
      const normalisedAddress = recipientAddress
        ? String(recipientAddress).toLowerCase().trim()
        : ''
      const amount = Number(amountSats) || 0

      // Drop an equivalent entry already in the queue (double-submit). We never
      // collapse a link that carries a successAction (neither an existing one
      // nor the incoming one): those messages are per-payment — especially a
      // one-time `aes` secret — and each must reach its own tx.
      this.pendingContactLinks = this.pendingContactLinks.filter((link) => !(
        !link.successAction &&
        !successAction &&
        link.contactId === contactId &&
        link.recipientAddress === normalisedAddress &&
        link.amountSats === amount
      ))
      // Also drop stale entries while we're here.
      this.pendingContactLinks = this.pendingContactLinks.filter(
        (link) => now - (link.sentAt || 0) < PENDING_LINK_TTL_MS,
      )

      this.pendingContactLinks.push({
        contactId: contactId || null,
        recipientAddress: normalisedAddress,
        amountSats: amount,
        successAction: successAction || null,
        sentAt: now,
      })
      // Bound the queue: with a long TTL, links for sends that never
      // produced a visible tx would otherwise accumulate. Keep the most
      // recent ones — the freshest sends are the ones worth resolving.
      if (this.pendingContactLinks.length > MAX_PENDING_LINKS) {
        this.pendingContactLinks = this.pendingContactLinks.slice(-MAX_PENDING_LINKS)
      }
      await this.persistPendingLinks()
      console.log(
        '[txMetadata] queued contact link',
        { contactId, recipientAddress: normalisedAddress, amountSats: amount },
        'queue size:',
        this.pendingContactLinks.length,
      )
    },

    /**
     * Drain the pending queue against a list of transactions, tagging
     * outgoing txs that fall inside the time window of a queued link.
     *
     * Matching strategy: for each pending link, pick the newest
     * unassigned outgoing tx whose timestamp is within the window.
     * Amount is used only as a *tie-breaker* when multiple txs match
     * the window — never as a hard filter — because providers report
     * the send amount inconsistently (fees included vs not, sign
     * flipped on some rails, rounding on Spark, etc.). The looser
     * match is fine in practice: a user almost never has two sends
     * in flight within five minutes that they want linked to
     * different contacts.
     *
     * Idempotent — once a link is consumed it disappears, and txs
     * that already have a contactId are skipped.
     */
    async consumePendingContactLinks(transactions) {
      if (!Array.isArray(transactions) || transactions.length === 0) return 0
      if (!this.pendingContactLinks || this.pendingContactLinks.length === 0) return 0

      const now = Date.now()
      let remaining = this.pendingContactLinks.filter(
        (link) => now - (link.sentAt || 0) < PENDING_LINK_TTL_MS,
      )

      let matched = 0
      let mutated = remaining.length !== this.pendingContactLinks.length

      // Unstamped outgoing txs, newest first. A tx is "stamped" once it
      // has a contactId, a recipientAddress, or a successAction, so a later
      // link can't re-claim a tx an earlier link already resolved.
      const candidates = transactions
        .filter((tx) => {
          if (!tx?.id) return false
          const m = this.metadata[tx.id]
          if (m?.contactId || m?.recipientAddress || m?.successAction) return false
          const t = (tx.type || '').toLowerCase()
          if (t === 'send' || t === 'sent' || t === 'outgoing') return true
          if (t === 'receive' || t === 'received' || t === 'incoming') return false
          return Number(tx.amount || 0) < 0
        })
        .map((tx) => ({ tx, timeMs: this._resolveTxTimeMs(tx) }))
        .sort((a, b) => b.timeMs - a.timeMs)

      // Track which candidate ids we've already claimed in this pass.
      const claimed = new Set()

      // Walk links newest-first too, so an older link doesn't snatch
      // the freshest tx away from a more-recent send.
      const linksByRecency = [...remaining].sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0))

      for (const link of linksByRecency) {
        const linkSentAt = link.sentAt || 0
        // In-window candidates that nobody else has claimed yet.
        const eligible = candidates.filter(({ tx, timeMs }) => {
          if (claimed.has(tx.id)) return false
          if (!timeMs) return true
          return Math.abs(timeMs - linkSentAt) <= PENDING_LINK_TIME_WINDOW_MS
        })
        if (eligible.length === 0) continue

        // Prefer the closest amount match when we have one; otherwise
        // just take the newest in-window candidate.
        let pick = eligible[0]
        if (link.amountSats) {
          const exact = eligible.find(({ tx }) => Math.abs(Number(tx.amount) || 0) === link.amountSats)
          if (exact) pick = exact
        }

        try {
          // Always stamp the durable recipient address; stamp the
          // contactId only when we knew it at send time. With the
          // address recorded, the contact resolves live thereafter even
          // if it was added/edited after this send.
          if (link.recipientAddress) {
            await this.setRecipientAddressForTransaction(pick.tx.id, link.recipientAddress)
          }
          if (link.contactId) {
            await this.setContactForTransaction(pick.tx.id, link.contactId)
          }
          if (link.successAction) {
            await this.setSuccessActionForTransaction(pick.tx.id, link.successAction)
          }
          claimed.add(pick.tx.id)
          remaining = remaining.filter((l) => l !== link)
          mutated = true
          matched += 1
        } catch (err) {
          console.warn('[txMetadata] failed to stamp tx from pending link:', err)
        }
      }

      if (mutated) {
        this.pendingContactLinks = remaining
        await this.persistPendingLinks()
      }
      if (matched > 0 || linksByRecency.length > 0) {
        console.log(
          '[txMetadata] consumePendingContactLinks:',
          { matched, remaining: remaining.length, candidates: candidates.length, txCount: transactions.length },
        )
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

        // Update contact ID. Assigning a real contact also lifts any
        // prior manual "removed" flag, so re-assigning after a removal
        // sticks instead of being suppressed by live resolution.
        this.metadata[txId].contactId = contactId
        if (contactId) this.metadata[txId].contactCleared = false
        this.metadata[txId].updatedAt = Date.now()

        await this.persistMetadata()
        return this.metadata[txId]
      } catch (error) {
        console.error('Error setting contact for transaction:', error)
        throw error
      }
    },

    /**
     * Stamp the durable recipient address on a transaction. This is the
     * fact that survives — getContactForTransaction resolves it live
     * against the address book, so a contact added later still lights
     * up past payments to the same address. Never overwrites an address
     * that's already set.
     */
    async setRecipientAddressForTransaction(txId, address) {
      try {
        if (!txId || !address) return null
        if (!this.metadata[txId]) {
          this.metadata[txId] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now(),
          }
        }
        if (this.metadata[txId].recipientAddress) return this.metadata[txId]
        this.metadata[txId].recipientAddress = String(address).toLowerCase().trim()
        this.metadata[txId].updatedAt = Date.now()
        await this.persistMetadata()
        return this.metadata[txId]
      } catch (error) {
        console.error('Error setting recipient address for transaction:', error)
        return null
      }
    },

    /**
     * Manual "Remove contact". Clears the explicit contactId AND records
     * that the user wants this tx to stay anonymous, so live address
     * resolution won't immediately re-attach the same contact.
     */
    async clearContactForTransaction(txId) {
      try {
        if (!txId) return null
        if (!this.metadata[txId]) {
          this.metadata[txId] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now(),
          }
        }
        this.metadata[txId].contactId = null
        this.metadata[txId].contactCleared = true
        this.metadata[txId].updatedAt = Date.now()
        await this.persistMetadata()
        return this.metadata[txId]
      } catch (error) {
        console.error('Error clearing contact for transaction:', error)
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

    /**
     * Persist a resolved LUD-09 successAction (the recipient's post-payment
     * message) on a transaction. Stored already-resolved — the `aes` variant
     * is decrypted at payment time, while the preimage is in hand — so Tx
     * Details can re-display it later without needing the preimage again.
     * (A decrypted `aes` secret therefore rests in localStorage — the same
     * on-device trust model as the preimage / notes this store already keeps.)
     */
    async setSuccessActionForTransaction(txId, successAction) {
      try {
        if (!txId) throw new Error('Transaction ID is required')
        if (!successAction) return this.metadata[txId] || null

        if (!this.metadata[txId]) {
          this.metadata[txId] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now()
          }
        }

        this.metadata[txId].successAction = successAction
        this.metadata[txId].updatedAt = Date.now()

        await this.persistMetadata()
        return this.metadata[txId]
      } catch (error) {
        console.error('Error setting successAction for transaction:', error)
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
