import { defineStore } from 'pinia'

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
      if (!state.searchQuery.trim()) {
        return state.entries.sort((a, b) => a.name.localeCompare(b.name))
      }
      
      const query = state.searchQuery.toLowerCase()
      return state.entries
        .filter(entry => 
          entry.name.toLowerCase().includes(query) ||
          entry.lightningAddress.toLowerCase().includes(query)
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    getEntryById: (state) => (id) => {
      return state.entries.find(entry => entry.id === id)
    },

    getRandomColor: (state) => () => {
      return state.colorPalette[Math.floor(Math.random() * state.colorPalette.length)]
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
        const newEntry = {
          id: `addr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: entryData.name.trim(),
          lightningAddress: entryData.lightningAddress.trim(),
          color: entryData.color || this.getRandomColor(),
          createdAt: Date.now(),
          updatedAt: Date.now()
        }

        // Validate lightning address format
        if (!this.isValidLightningAddress(newEntry.lightningAddress)) {
          throw new Error('Invalid Lightning address format')
        }

        // Check for duplicates
        const existingEntry = this.entries.find(
          entry => entry.lightningAddress.toLowerCase() === newEntry.lightningAddress.toLowerCase()
        )
        
        if (existingEntry) {
          throw new Error('This Lightning address already exists in your address book')
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

        const updatedEntry = {
          ...this.entries[entryIndex],
          ...updateData,
          updatedAt: Date.now()
        }

        // Validate lightning address format if it's being updated
        if (updateData.lightningAddress && !this.isValidLightningAddress(updatedEntry.lightningAddress)) {
          throw new Error('Invalid Lightning address format')
        }

        // Check for duplicates if lightning address is being updated
        if (updateData.lightningAddress) {
          const existingEntry = this.entries.find(
            entry => entry.id !== id && 
            entry.lightningAddress.toLowerCase() === updatedEntry.lightningAddress.toLowerCase()
          )
          
          if (existingEntry) {
            throw new Error('This Lightning address already exists in your address book')
          }
        }

        this.entries[entryIndex] = updatedEntry
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

    // Update search query
    setSearchQuery(query) {
      this.searchQuery = query
    },

    // Clear search
    clearSearch() {
      this.searchQuery = ''
    },

    // Validate lightning address format
    isValidLightningAddress(address) {
      // Basic validation for Lightning address format (user@domain.com)
      const lightningAddressRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
      return lightningAddressRegex.test(address)
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

    // Import entries (for future use)
    async importEntries(entries) {
      try {
        const validEntries = entries.filter(entry => 
          entry.name && 
          entry.lightningAddress && 
          this.isValidLightningAddress(entry.lightningAddress)
        )

        for (const entry of validEntries) {
          const existingEntry = this.entries.find(
            existing => existing.lightningAddress.toLowerCase() === entry.lightningAddress.toLowerCase()
          )
          
          if (!existingEntry) {
            await this.addEntry({
              name: entry.name,
              lightningAddress: entry.lightningAddress,
              color: entry.color || this.getRandomColor()
            })
          }
        }

        return validEntries.length
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