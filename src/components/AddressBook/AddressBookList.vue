<template>
  <div class="address-book-container">
    <!-- Search Bar -->
    <div class="search-section" v-if="entries.length > 0">
      <q-input
        v-model="searchQuery"
        :placeholder="$t('Search contacts...')"
        borderless
        dense
        :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
        input-class="q-px-md"
        clearable
        @clear="clearSearch"
      >
        <template v-slot:prepend>
          <q-icon name="las la-search" class="q-ml-sm" />
        </template>
      </q-input>
    </div>

    <!-- Entries List -->
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

      <q-scroll-area class="entries-scroll" style="height: calc(100vh - 280px);">
        <div class="entries-list">
          <AddressBookEntry
            v-for="entry in filteredEntries"
            :key="entry.id"
            :entry="entry"
            @edit="editEntry"
            @delete="confirmDeleteEntry"
            @change-color="changeEntryColor"
            @pay="payContact"
            @toggle-favorite="toggleFavorite"
          />
        </div>
      </q-scroll-area>
    </div>

    <!-- Empty State -->
    <div v-else-if="searchQuery && entries.length > 0" class="empty-search"
         :class="$q.dark.isActive ? 'empty_state_dark' : 'empty_state_light'">
      <q-icon name="las la-search" size="3rem" :color="$q.dark.isActive ? '#B0B0B0' : '#D1D5DB'"/>
      <div class="empty-title" :class="$q.dark.isActive ? 'empty_title_dark' : 'empty_title_light'">
        {{ $t('No contacts found') }}
      </div>
      <div class="empty-subtitle" :class="$q.dark.isActive ? 'empty_subtitle_dark' : 'empty_subtitle_light'">
        {{ $t('Try adjusting your search terms') }}
      </div>
      <q-btn
        flat
        :label="$t('Clear Search')"
        @click="clearSearch"
        :class="$q.dark.isActive ? 'btn_dark' : 'btn_light'"
        no-caps
      />
    </div>

    <div v-else class="empty-state full-height" :class="$q.dark.isActive ? 'empty_state_dark' : 'empty_state_light'">
      <div class="empty-illustration">
        <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="60" cy="60" r="60" :fill="$q.dark.isActive ? '#2A342A' : '#F3F4F6'"/>
          <path d="M40 45C40 38.3726 45.3726 33 52 33H68C74.6274 33 80 38.3726 80 45V55C80 61.6274 74.6274 67 68 67H52C45.3726 67 40 61.6274 40 55V45Z" :fill="$q.dark.isActive ? '#15DE72' : '#059573'"/>
          <circle cx="52" cy="48" r="4" fill="white"/>
          <circle cx="68" cy="48" r="4" fill="white"/>
          <path d="M48 58C48 60.2091 49.7909 62 52 62H68C70.2091 62 72 60.2091 72 58V55H48V58Z" fill="white"/>
          <path d="M35 75H85C87.2091 75 89 76.7909 89 79V85C89 87.2091 87.2091 89 85 89H35C32.7909 89 31 87.2091 31 85V79C31 76.7909 32.7909 75 35 75Z" :fill="$q.dark.isActive ? '#B0B0B0' : '#9CA3AF'"/>
          <circle cx="40" cy="82" r="3" fill="white"/>
          <path d="M48 80H75V84H48V80Z" fill="white"/>
        </svg>
      </div>
      <div class="empty-title" :class="$q.dark.isActive ? 'empty_title_dark' : 'empty_title_light'">
        {{ $t('No contacts yet') }}
      </div>
      <div class="empty-subtitle" :class="$q.dark.isActive ? 'empty_subtitle_dark' : 'empty_subtitle_light'">
        {{ $t('Add Lightning or Spark contacts to get started') }}
      </div>
      <q-btn
        unelevated
        :label="$t('Add Contact')"
        @click="$emit('add-contact')"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        icon="las la-plus"
        no-caps
      />
    </div>

    <!-- Floating Add Button -->
    <q-page-sticky
      position="bottom-right"
      :offset="[18, 18]"
      v-if="entries.length > 0"
    >
      <q-btn
        fab
        icon="las la-plus"
        @click="$emit('add-contact')"
        :class="$q.dark.isActive ? 'fab_dark' : 'fab_light'"
      />
    </q-page-sticky>

    <!-- Color Picker Dialog -->
    <q-dialog v-model="showColorPicker">
      <q-card class="color-picker-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section>
          <div class="color-picker-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Choose Color for {name}', { name: selectedEntry?.name || '' }) }}
          </div>
        </q-card-section>

        <q-card-section class="color-grid">
          <div
            v-for="color in colorPalette"
            :key="color"
            class="color-option"
            :class="{ 'selected': selectedEntry?.color === color }"
            :style="{ backgroundColor: color }"
            @click="updateEntryColor(color)"
          >
            <q-icon
              v-if="selectedEntry?.color === color"
              name="las la-check"
              class="color-check"
            />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Delete Confirmation Dialog -->
    <q-dialog v-model="showDeleteDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="delete-confirm-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="delete-header">
          <div class="delete-icon-wrapper">
            <q-icon name="las la-trash-alt" size="32px" class="delete-icon"/>
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
            <q-icon name="las la-exclamation-triangle" size="32px" class="delete-icon"/>
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
      showColorPicker: false,
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
      'searchQuery',
      'colorPalette'
    ])
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
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t delete contact'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      }
    },

    changeEntryColor(entry) {
      this.selectedEntry = entry
      this.showColorPicker = true
    },

    async updateEntryColor(color) {
      if (!this.selectedEntry) return

      try {
        await this.updateEntry(this.selectedEntry.id, { color })
        this.showColorPicker = false
        this.selectedEntry = null

        this.$q.notify({
          type: 'positive',
          message: this.$t('Color updated'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t update color'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
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
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t clear contacts'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
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
}

.search-section {
  padding: 1rem;
}

.entries-container {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.entries-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
}

.entries-header-dark {
  color: #666;
}

.entries-header-light {
  color: #9CA3AF;
}

.entries-count {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.clear-all-btn {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
}

.clear-all-btn-dark {
  color: #EF4444;
}

.clear-all-btn-light {
  color: #DC2626;
}

.clear-all-btn-dark:hover {
  background: rgba(239, 68, 68, 0.1);
}

.clear-all-btn-light:hover {
  background: rgba(220, 38, 38, 0.1);
}

.entries-scroll {
  flex: 1;
}

.entries-list {
  padding: 0 1rem 1rem;
}

/* Empty States */
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

.empty_state_dark {
  background: #0C0C0C;
}

.empty_state_light {
  background: white;
}

.empty-illustration {
  margin-bottom: 2rem;
  opacity: 0.8;
}

.empty_title_dark {
  font-size: 1.25rem;
  font-weight: 600;
  color: #F6F6F6;
  margin-bottom: 0.5rem;
  font-family: Fustat, 'Inter', sans-serif;
}

.empty_title_light {
  font-size: 1.25rem;
  font-weight: 600;
  color: #212121;
  margin-bottom: 0.5rem;
  font-family: Fustat, 'Inter', sans-serif;
}

.empty_subtitle_dark {
  color: #B0B0B0;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
  font-family: Fustat, 'Inter', sans-serif;
  max-width: 280px;
  line-height: 1.4;
}

.empty_subtitle_light {
  color: #6B7280;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
  font-family: Fustat, 'Inter', sans-serif;
  max-width: 280px;
  line-height: 1.4;
}

/* Floating Action Button */
.fab_dark {
  background: linear-gradient(135deg, #15DE72, #059573) !important;
  box-shadow: 0 4px 12px rgba(21, 222, 114, 0.3) !important;
}

.fab_light {
  background: linear-gradient(135deg, #15DE72, #059573) !important;
  box-shadow: 0 4px 12px rgba(5, 149, 115, 0.3) !important;
}

.fab_dark:hover {
  background: linear-gradient(135deg, #059573, #047857) !important;
  box-shadow: 0 6px 16px rgba(21, 222, 114, 0.4) !important;
}

.fab_light:hover {
  background: linear-gradient(135deg, #059573, #047857) !important;
  box-shadow: 0 6px 16px rgba(5, 149, 115, 0.4) !important;
}

/* Color Picker */
.color-picker-card {
  width: 100%;
  max-width: 320px;
  border-radius: 16px;
}

.color-picker-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 16px;
  text-align: center;
}

.color-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  padding: 1rem;
}

.color-option {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.color-option:hover {
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.color-option.selected {
  transform: scale(1.1);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.3);
}

.color-check {
  color: white;
  font-size: 20px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

/* Secondary Buttons */
.btn_dark {
  border-radius: 20px !important;
  border: 1px solid #2A382A !important;
  background: rgba(255, 255, 255, 0.05) !important;
  color: #FFF !important;
  font-family: Fustat, 'Inter', sans-serif !important;
  font-size: 14px !important;
  font-weight: 500 !important;
}

.btn_light {
  border-radius: 20px !important;
  border: 1px solid #E8E8E8 !important;
  background: #F6F6F6 !important;
  color: #212121 !important;
  font-family: Fustat, 'Inter', sans-serif !important;
  font-size: 14px !important;
  font-weight: 500 !important;
}

/* Primary Action Buttons */
.dialog_add_btn_dark {
  border-radius: 24px !important;
  background: linear-gradient(135deg, #15DE72, #059573) !important;
  color: #0C0C0C !important;
  font-weight: 600 !important;
  box-shadow: 0px 4px 8px 0px rgba(61, 61, 61, 0.25) !important;
  font-family: Fustat, 'Inter', sans-serif !important;
}

.dialog_add_btn_light {
  border-radius: 24px !important;
  background: linear-gradient(135deg, #15DE72, #059573) !important;
  color: #0C0C0C !important;
  font-weight: 600 !important;
  box-shadow: 0px 4px 8px 0px rgba(159, 159, 159, 0.25) !important;
  font-family: Fustat, 'Inter', sans-serif !important;
}

/* Responsive Design */
@media (max-width: 480px) {
  .search-section,
  .entries-header,
  .entries-list {
    padding: 0.75rem;
  }

  .empty-state,
  .empty-search {
    padding: 1.5rem;
    height: 50vh;
  }

  .empty-illustration svg {
    width: 80px;
    height: 80px;
  }

  .empty_title_dark,
  .empty_title_light {
    font-size: 1.125rem;
  }

  .empty_subtitle_dark,
  .empty_subtitle_light {
    font-size: 0.8125rem;
    max-width: 240px;
  }

  .color-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
  }

  .color-option {
    width: 40px;
    height: 40px;
  }
}

/* Delete Confirmation Dialog */
.delete-confirm-card {
  width: 100%;
  max-width: 340px;
  border-radius: 16px;
}

.delete-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 1.5rem 1.5rem 0.5rem;
}

.delete-icon-wrapper {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(249, 115, 22, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
}

.delete-icon {
  color: #F97316;
}

.delete-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 18px;
  font-weight: 700;
  color: #F97316;
  margin-bottom: 0.5rem;
}

.delete-message {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

.delete-message strong {
  color: #F97316;
}

.delete-actions {
  padding: 0.5rem 1.5rem 1.5rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.cancel-btn {
  font-family: Fustat, 'Inter', sans-serif;
  font-weight: 500;
  border-radius: 10px;
}

.delete-action-btn {
  font-family: Fustat, 'Inter', sans-serif;
  font-weight: 600;
  border-radius: 10px;
  background: linear-gradient(135deg, #F97316, #EA580C) !important;
  color: white !important;
}

.delete-action-btn:disabled {
  opacity: 0.4;
}
</style>
