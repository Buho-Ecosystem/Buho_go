import { defineStore } from 'pinia'

// Address type constants
export const ADDRESS_TYPES = {
  LIGHTNING: 'lightning',
  SPARK: 'spark',
  BITCOIN: 'bitcoin'
}

export const useAddressBookStore = defineStore('addressBook', {
  state: () => ({
    entries: [],
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
    }
  },

  actions: {
    // Initialize store from localStorage
    async initialize() {
      try {
        const savedEntries = localStorage.getItem('buhoGO_address_book')
        if (savedEntries) {
          this.entries = JSON.parse(savedEntries)
        }
      } catch (error) {
        console.error('Error loading address book:', error)
        this.entries = []
      }
    },

    // Add new entry
    async addEntry(entryData) {
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

    // Toggle favorite status
    async toggleFavorite(id) {
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

    // Validate lightning address format
    isValidLightningAddress(address) {
      // Basic validation for Lightning address format (user@domain.com)
      const lightningAddressRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
      return lightningAddressRegex.test(address.trim())
    },

    // Validate Spark address format
    isValidSparkAddress(address) {
      // New format: spark1 (mainnet), sparkrt1 (regtest), sparkt1 (testnet), sparks1 (signet), sparkl1 (local)
      // Legacy format: sp1 (mainnet), tsp1 (testnet), sprt1 (regtest)
      const trimmed = address.trim().toLowerCase()
      const newPrefixes = ['spark1', 'sparkrt1', 'sparkt1', 'sparks1', 'sparkl1']
      const legacyPrefixes = ['sp1', 'tsp1', 'sprt1']
      return newPrefixes.some(p => trimmed.startsWith(p)) ||
             legacyPrefixes.some(p => trimmed.startsWith(p))
    },

    // Validate Bitcoin address format (on-chain L1)
    isValidBitcoinAddress(address) {
      const trimmed = address.trim()
      // Mainnet: bc1 (bech32/bech32m native segwit), 1 (P2PKH legacy), 3 (P2SH)
      // Testnet: tb1 (bech32), m/n (P2PKH), 2 (P2SH)
      const mainnetBech32Regex = /^bc1[a-zA-HJ-NP-Z0-9]{39,62}$/i
      const mainnetLegacyRegex = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/
      const testnetBech32Regex = /^tb1[a-zA-HJ-NP-Z0-9]{39,62}$/i
      const testnetLegacyRegex = /^[mn2][a-km-zA-HJ-NP-Z1-9]{25,34}$/

      return mainnetBech32Regex.test(trimmed) ||
             mainnetLegacyRegex.test(trimmed) ||
             testnetBech32Regex.test(trimmed) ||
             testnetLegacyRegex.test(trimmed)
    },

    // Detect address type from input
    detectAddressType(address) {
      if (!address) return null
      const trimmed = address.trim().toLowerCase()

      // Check for Spark address (new and legacy formats)
      const sparkNewPrefixes = ['spark1', 'sparkrt1', 'sparkt1', 'sparks1', 'sparkl1']
      const sparkLegacyPrefixes = ['sp1', 'tsp1', 'sprt1']
      const isSpark = sparkNewPrefixes.some(p => trimmed.startsWith(p)) ||
                      sparkLegacyPrefixes.some(p => trimmed.startsWith(p))
      if (isSpark) {
        return 'spark'
      }

      // Check for Bitcoin address (on-chain L1)
      if (this.isValidBitcoinAddress(address)) {
        return 'bitcoin'
      }

      // Check for Lightning address
      if (this.isValidLightningAddress(address)) {
        return 'lightning'
      }

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