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

    <!-- The payee list: favorites as one-tap quick-pay tiles, then
         everyone as rows whose whole surface is the Pay action. The
         info glyph on each row is the door to the contact's page. -->
    <div class="entries-container" v-if="filteredEntries.length > 0">
      <q-scroll-area class="entries-scroll">
        <div class="entries-list">
          <!-- The Quick pay shelf: a swipeable strip of the last people
               actually paid. No per-bubble verb — the section title
               carries it, the way the Phone app's favorites carry
               "call". The shelf bleeds to the screen edge so the next
               bubble peeks, which is the swipe affordance. Hidden while
               searching: the search is about the list below. -->
          <template v-if="!searchQuery && recentlyPaidEntries.length > 0">
            <div class="sec-label">{{ $t('Quick pay') }}</div>
            <div class="quickpay-shelf">
              <button
                v-for="entry in recentlyPaidEntries"
                :key="'recent-' + entry.id"
                type="button"
                class="quickpay-bubble"
                :aria-label="$t('Pay {name}', { name: entry.name })"
                @click="payContact(entry)"
              >
                <ContactAvatar class="quickpay-avatar" :entry="entry" />
                <span>{{ entry.name }}</span>
              </button>
            </div>
          </template>

          <div class="sec-label">{{ $t('Contacts') }}</div>
          <div class="payee-rows">
            <AddressBookEntry
              v-for="entry in sortedEntries"
              :key="entry.id"
              :entry="entry"
              @pay="payContact"
              @open="openContact"
            />
          </div>

          <!-- One count, once — and the reminder that contact lists are
               scoped to the identity they were saved with. -->
          <div class="count-foot">
            {{ filteredEntries.length === 1
              ? $t('1 contact · saved with your identity')
              : $t('{n} contacts · saved with your identity', { n: filteredEntries.length }) }}
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
  </div>
</template>

<script>
import { useAddressBookStore } from '../../stores/addressBook'
import { mapState, mapActions } from 'pinia'
import AddressBookEntry from './AddressBookEntry.vue'
import ContactAvatar from './ContactAvatar.vue'

export default {
  name: 'AddressBookList',
  components: {
    AddressBookEntry,
    ContactAvatar
  },
  emits: ['add-contact', 'pay-contact', 'open-contact'],
  computed: {
    ...mapState(useAddressBookStore, [
      'entries',
      'filteredEntries',
      'searchQuery',
      'recentlyPaidEntries'
    ]),

    /** Favorites first, then the rest — the star keeps its meaning. */
    sortedEntries() {
      return [...this.filteredEntries].sort(
        (a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0)
      )
    }
  },
  methods: {
    ...mapActions(useAddressBookStore, [
      'setSearchQuery',
      'clearSearch'
    ]),

    payContact(entry) {
      this.$emit('pay-contact', entry)
    },

    openContact(entry) {
      this.$emit('open-contact', entry)
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
  padding: 1rem 1rem 0.25rem;
  flex: 0 0 auto;
}

.entries-container {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.entries-scroll {
  flex: 1 1 auto;
  min-height: 0;
}

.entries-list {
  padding: 0 1rem 0.5rem;
  display: flex;
  flex-direction: column;
}

.sec-label {
  font-family: 'Manrope', sans-serif;
  font-size: 10.5px;
  font-weight: 750;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin: 14px 2px 8px;
}

/* The Quick pay shelf: horizontal, snap-scrolled, scrollbarless. It
   bleeds past the content padding so a partial bubble peeks at the
   screen edge — the swipe affordance, no chrome needed. */
.quickpay-shelf {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  margin: 0 -1rem;
  padding: 2px 1rem 6px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.quickpay-shelf::-webkit-scrollbar {
  display: none;
}

.quickpay-bubble {
  scroll-snap-align: start;
  flex: 0 0 auto;
  width: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  -webkit-tap-highlight-color: transparent;
}

.quickpay-bubble:active .quickpay-avatar {
  transform: scale(0.93);
}

.quickpay-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  overflow: hidden;
  display: block;
  transition: transform 0.12s ease;
}

.quickpay-bubble span {
  font-size: 11px;
  font-weight: 650;
  max-width: 64px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.payee-rows {
  display: flex;
  flex-direction: column;
}

.count-foot {
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  color: var(--text-muted);
  padding: 16px 0 10px;
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
  .search-section {
    padding: 0.75rem 0.75rem 0.25rem;
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
}
</style>
