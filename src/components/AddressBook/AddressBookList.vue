<template>
  <div class="address-book-container">
    <!-- Search Bar -->
    <div class="search-section" v-if="entries.length > 0">
      <q-input
        :model-value="searchQuery"
        @update:model-value="setSearchQuery"
        :placeholder="$t('Search contacts...')"
        borderless
        dense
        :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
        input-class="q-px-md"
        clearable
        @clear="clearSearch"
      >
        <template v-slot:prepend>
          <Icon icon="tabler:search" class="q-ml-sm" />
        </template>
      </q-input>
    </div>

    <!-- Entries List (sectioned: Favorites + Other Contacts) -->
    <div class="entries-container" v-if="filteredEntries.length > 0">
      <div class="entries-header" :class="$q.dark.isActive ? 'entries-header-dark' : 'entries-header-light'">
        <span class="entries-count">
          {{ filteredEntries.length }} {{ $t('contact') }}{{ filteredEntries.length !== 1 ? 's' : '' }}
        </span>
        <q-btn
          flat
          dense
          no-caps
          :label="$t('Clear All')"
          @click="showClearAllDialog"
          class="clear-all-btn"
          :class="$q.dark.isActive ? 'clear-all-btn-dark' : 'clear-all-btn-light'"
          size="sm"
          v-if="entries.length > 0"
        />
      </div>

      <q-scroll-area class="entries-scroll">
        <!-- Favorites Section -->
        <div v-if="filteredFavorites.length > 0">
          <div class="section-header">
            <Icon icon="tabler:star-filled" width="16" height="16" style="color: var(--color-green)" />
            <span class="section-title">{{ $t('Favorites') }}</span>
            <span class="section-count">{{ filteredFavorites.length }}</span>
          </div>
          <div class="entries-list">
            <AddressBookEntry
              v-for="entry in filteredFavorites"
              :key="entry.id"
              :entry="entry"
              @edit="editEntry"
              @delete="confirmDeleteEntry"
              @pay="payContact"
              @toggle-favorite="toggleFavorite"
              @copy-address="copyAddress"
            />
          </div>
        </div>

        <!-- Other Contacts Section -->
        <div v-if="filteredNonFavorites.length > 0">
          <div class="section-header">
            <Icon icon="tabler:star" width="16" height="16" style="color: var(--color-green)" />
            <span class="section-title">{{ $t('Other Contacts') }}</span>
            <span class="section-count">{{ filteredNonFavorites.length }}</span>
          </div>
          <div class="entries-list">
            <AddressBookEntry
              v-for="entry in filteredNonFavorites"
              :key="entry.id"
              :entry="entry"
              @edit="editEntry"
              @delete="confirmDeleteEntry"
              @pay="payContact"
              @toggle-favorite="toggleFavorite"
              @copy-address="copyAddress"
            />
          </div>
        </div>
      </q-scroll-area>
    </div>

    <!-- Empty State -->
    <div v-else-if="searchQuery && entries.length > 0" class="empty-search empty-state-surface">
      <Icon icon="tabler:search" class="empty-search-icon" />
      <div class="empty-title">
        {{ $t('No contacts found') }}
      </div>
      <div class="empty-subtitle">
        {{ $t('Try adjusting your search terms') }}
      </div>
      <q-btn
        flat
        :label="$t('Clear Search')"
        @click="clearSearch"
        class="clear-search-btn"
        no-caps
      />
    </div>

    <div v-else class="empty-state full-height empty-state-surface">
      <img
        src="/Onboarding wizard spark/storyset-online-friends-bro.svg"
        class="empty-illustration-img"
        alt=""
        aria-hidden="true"
      />
      <div class="empty-title">
        {{ $t('No contacts yet') }}
      </div>
      <div class="empty-subtitle">
        {{ $t('Save people you pay often for quick access') }}
      </div>
      <q-btn
        unelevated
        @click="$emit('add-contact')"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        no-caps
      >
        <Icon icon="tabler:plus" width="16" height="16" class="q-mr-xs" />
        {{ $t('Add Contact') }}
      </q-btn>
    </div>


    <!-- Delete Confirmation Dialog -->
    <q-dialog v-model="showDeleteDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="delete-confirm-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="delete-header">
          <div class="delete-icon-wrapper">
            <Icon icon="tabler:trash" width="32" height="32" class="delete-icon"/>
          </div>
          <div class="delete-title">{{ $t('Delete Contact') }}</div>
          <div class="delete-message" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('Are you sure you want to delete') }} <strong>{{ entryToDelete?.name }}</strong>{{ $t('?') }}
          </div>
        </q-card-section>

        <q-card-actions class="delete-actions">
          <q-btn
            flat
            no-caps
            :label="$t('Cancel')"
            @click="showDeleteDialog = false"
            class="cancel-btn"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
          />
          <q-btn
            unelevated
            no-caps
            :label="$t('Delete')"
            @click="executeDeleteEntry"
            class="delete-action-btn"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Clear All Confirmation Dialog -->
    <q-dialog v-model="showClearAllConfirmDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="delete-confirm-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="delete-header">
          <div class="delete-icon-wrapper">
            <Icon icon="tabler:alert-triangle" width="32" height="32" class="delete-icon"/>
          </div>
          <div class="delete-title">{{ $t('Clear All Contacts') }}</div>
          <div class="delete-message" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('This will permanently delete all your contacts. This action cannot be undone.') }}
          </div>
        </q-card-section>

        <q-card-actions class="delete-actions">
          <q-btn
            flat
            no-caps
            :label="$t('Cancel')"
            @click="showClearAllConfirmDialog = false"
            class="cancel-btn"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
          />
          <q-btn
            unelevated
            no-caps
            :label="$t('Clear All')"
            @click="executeClearAll"
            class="delete-action-btn"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script>
import { useAddressBookStore } from '../../stores/addressBook'
import { mapState, mapActions } from 'pinia'
import AddressBookEntry from './AddressBookEntry.vue'

export default {
  name: 'AddressBookList',
  components: {
    AddressBookEntry
  },
  emits: ['add-contact', 'edit-contact', 'pay-contact'],
  data() {
    return {
      selectedEntry: null,
      showDeleteDialog: false,
      entryToDelete: null,
      showClearAllConfirmDialog: false
    }
  },
  computed: {
    ...mapState(useAddressBookStore, [
      'entries',
      'filteredEntries',
      'searchQuery'
    ]),

    filteredFavorites() {
      return this.filteredEntries.filter(entry => entry.isFavorite)
    },

    filteredNonFavorites() {
      return this.filteredEntries.filter(entry => !entry.isFavorite)
    }
  },
  methods: {
    ...mapActions(useAddressBookStore, [
      'setSearchQuery',
      'clearSearch',
      'deleteEntry',
      'updateEntry',
      'clearAll'
    ]),

    async toggleFavorite(entry) {
      const store = useAddressBookStore()
      await store.toggleFavorite(entry.id)
    },

    editEntry(entry) {
      this.$emit('edit-contact', entry)
    },

    payContact(entry) {
      this.$emit('pay-contact', entry)
    },

    copyAddress(entry) {
      const address = entry.address || entry.lightningAddress || ''
      if (address) {
        navigator.clipboard.writeText(address).then(() => {
          this.$q.notify({
            type: 'positive',
            message: this.$t('Address copied'),
            timeout: 2000
          })
        }).catch(() => {
          this.$q.notify({
            type: 'negative',
            message: this.$t('Couldn\'t copy'),
          })
        })
      }
    },

    confirmDeleteEntry(entry) {
      this.entryToDelete = entry
      this.showDeleteDialog = true
    },

    async executeDeleteEntry() {
      if (!this.entryToDelete) return
      try {
        await this.deleteEntry(this.entryToDelete.id)
        this.showDeleteDialog = false
        this.entryToDelete = null
        this.$q.notify({
          type: 'positive',
          message: this.$t('Contact removed'),

        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t delete contact'),

        })
      }
    },


    showClearAllDialog() {
      this.showClearAllConfirmDialog = true
    },

    async executeClearAll() {
      try {
        await this.clearAll()
        this.showClearAllConfirmDialog = false
        this.$q.notify({
          type: 'positive',
          message: this.$t('Contacts cleared'),

        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t clear contacts'),

        })
      }
    }
  }
}
</script>

<style scoped>
.address-book-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.search-section {
  padding: 1rem;
  flex: 0 0 auto;
}

.entries-container {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.entries-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  flex: 0 0 auto;
}

.entries-header-dark {
  color: #666;
}

.entries-header-light {
  color: var(--text-muted);
}

.entries-count {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.clear-all-btn {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  border-radius: 20px;
  padding: 4px 12px;
}

.clear-all-btn-dark {
  color: #EF4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.clear-all-btn-light {
  color: #DC2626;
  border: 1px solid rgba(220, 38, 38, 0.3);
}

.clear-all-btn-dark:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.5);
}

.clear-all-btn-light:hover {
  background: rgba(220, 38, 38, 0.1);
  border-color: rgba(220, 38, 38, 0.5);
}

.entries-scroll {
  flex: 1 1 auto;
  min-height: 0;
}

.entries-list {
  padding: 0 1rem 0.5rem;
}

/* Section Headers */
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px 8px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
}

.section-count {
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
}

/* Empty States — single CSS-variable-driven classes replace the old
   dark/light pairs (the dark variant hardcoded #0C0C0C/#F6F6F6/#B0B0B0
   instead of using theme tokens). */
.empty-state,
.empty-search {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  text-align: center;
  padding: 2rem;
}

.empty-state-surface {
  background: var(--bg-primary);
}

.empty-illustration-img {
  width: 100%;
  max-width: 180px;
  height: auto;
  margin-bottom: 1.25rem;
  user-select: none;
  pointer-events: none;
}

.empty-search-icon {
  font-size: 3rem;
  color: var(--text-muted);
}

.empty-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
  font-family: 'Manrope', sans-serif;
}

.empty-subtitle {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
  font-family: 'Manrope', sans-serif;
  max-width: 280px;
  line-height: 1.4;
}

/* Secondary Button — "Clear Search" */
.clear-search-btn {
  border-radius: 20px !important;
  border: 1px solid var(--border-card) !important;
  background: var(--bg-input) !important;
  color: var(--text-primary) !important;
  font-family: 'Manrope', sans-serif !important;
  font-size: 14px !important;
  font-weight: 500 !important;
}

/* Empty-state Add Contact — unified neutral translucent treatment,
   identical to the header Add Contact pill and the Copy/Share
   buttons in the receive flow. No greens; the plus icon carries
   the intent. */
.dialog_add_btn_dark,
.dialog_add_btn_light {
  border-radius: 10px !important;
  padding: 10px 18px !important;
  font-family: 'Manrope', sans-serif !important;
  font-size: 14px !important;
  font-weight: 500 !important;
  letter-spacing: -0.005em !important;
  transition: background-color 0.18s ease, color 0.18s ease !important;
}

.dialog_add_btn_dark {
  background: rgba(255, 255, 255, 0.08) !important;
  color: rgba(255, 255, 255, 0.85) !important;
}

.dialog_add_btn_dark:hover {
  background: rgba(255, 255, 255, 0.12) !important;
}

.dialog_add_btn_light {
  background: rgba(0, 0, 0, 0.05) !important;
  color: rgba(0, 0, 0, 0.75) !important;
}

.dialog_add_btn_light:hover {
  background: rgba(0, 0, 0, 0.08) !important;
}

/* Responsive Design */
@media (max-width: 480px) {
  .search-section,
  .entries-header {
    padding: 0.75rem;
  }

  .entries-list {
    padding: 0 0.75rem 0.5rem;
  }

  .empty-state,
  .empty-search {
    padding: 1.5rem;
    height: 50vh;
  }

  .empty-illustration-img {
    max-width: 140px;
  }

  .empty-title {
    font-size: 1.125rem;
  }

  .empty-subtitle {
    font-size: 0.8125rem;
    max-width: 240px;
  }

  .section-header {
    padding: 10px 12px 6px;
  }
}


/* Delete / Clear-All Confirmation Dialog
   Surface language: rounded card (--radius-xl), layered shadow, generous
   padding. Destructive accent moves from orange-warning to red-destructive
   so the dialog reads as "this deletes" rather than "heads up". The name
   stays in primary text color — the action button carries the red, the
   copy doesn't need to. */
.delete-confirm-card {
  width: 100%;
  max-width: 380px;
  border-radius: var(--radius-xl);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35),
              0 4px 12px rgba(0, 0, 0, 0.18);
}

.body--light .delete-confirm-card {
  box-shadow: 0 20px 40px rgba(17, 24, 39, 0.14),
              0 4px 12px rgba(17, 24, 39, 0.06);
}

.delete-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 1.75rem 1.5rem 0.5rem;
}

.delete-icon-wrapper {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.1rem;
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.18);
}

.delete-icon {
  color: #EF4444;
}

.delete-title {
  font-family: 'Manrope', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
  letter-spacing: -0.01em;
}

.delete-message {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  line-height: 1.55;
  max-width: 280px;
}

.delete-message strong {
  color: var(--text-primary);
  font-weight: 600;
}

.delete-actions {
  padding: 1.25rem 1.5rem 1.5rem;
  display: flex;
  gap: 0.6rem;
}

.delete-actions .cancel-btn,
.delete-actions .delete-action-btn {
  flex: 1;
  height: 44px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  border-radius: var(--radius-xl);
}

.cancel-btn {
  font-weight: 500;
  background: var(--bg-input);
}

.body--light .cancel-btn {
  background: rgba(17, 24, 39, 0.05);
}

.delete-action-btn {
  font-weight: 600;
  background: #EF4444 !important;
  color: #fff !important;
  transition: background 0.15s ease, transform 0.08s ease;
}

.delete-action-btn:hover {
  background: #DC2626 !important;
}

.delete-action-btn:active {
  transform: scale(0.98);
}

.delete-action-btn:disabled {
  opacity: 0.4;
}
</style>
