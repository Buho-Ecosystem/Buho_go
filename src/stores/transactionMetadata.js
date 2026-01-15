import { defineStore } from 'pinia'
import { useAddressBookStore } from './addressBook'

export const useTransactionMetadataStore = defineStore('transactionMetadata', {
  state: () => ({
    // Map of txId to metadata object
    metadata: {}
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
