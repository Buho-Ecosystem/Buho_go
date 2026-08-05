<template>
  <q-page class="address-book-page">
    <!-- Header — same grid-centered, inset-owning visual language as
         SettingsHubHeader (Identity/Spend/Settings), adapted for a
         drill-down page: a back chevron instead of the hub's Home icon,
         since Address Book is reached via push from several places, not
         a hub tab on the bottom nav. -->
    <div class="page-header">
      <q-btn
        flat
        round
        dense
        class="header-side-btn back-btn"
        :aria-label="$t('Back')"
        @click="$router.back()"
      >
        <Icon icon="tabler:chevron-left" width="20" height="20" />
      </q-btn>

      <div class="header-title">
        {{ $t('Address Book') }}
      </div>

      <div class="header-actions">
        <!-- Power-user overflow. The only thing here is "restore from
             Nostr" — every other sync action is automatic (publish on
             change, recover on identity restore). Rarely tapped, so it
             sits in the quiet slot next to the title rather than
             competing with Add Contact for attention. -->
        <q-btn
          flat
          round
          dense
          class="header-side-btn overflow-btn"
          :aria-label="$t('More options')"
        >
          <Icon icon="tabler:dots-vertical" width="18" height="18" />
          <q-menu
            anchor="bottom right"
            self="top right"
            :class="$q.dark.isActive ? 'overflow-menu-dark' : 'overflow-menu-light'"
          >
            <q-list style="min-width: 220px">
              <q-item clickable v-close-popup @click="runRecovery" :disable="isRecovering">
                <q-item-section avatar style="min-width: 32px;">
                  <Icon
                    :icon="isRecovering ? 'tabler:loader-2' : 'tabler:cloud-download'"
                    width="16"
                    height="16"
                    :class="{ 'ab-spin': isRecovering }"
                    style="color: var(--text-secondary)"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label :class="$q.dark.isActive ? 'menu-label-dark' : 'menu-label-light'">
                    {{ $t('Restore contacts from Nostr') }}
                  </q-item-label>
                  <q-item-label caption>
                    {{ $t('Pull contacts you saved on another device') }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>

        <!-- Add Contact — the primary action on this page, so it gets
             its own visual presence (tinted brand-green circle) instead
             of matching the neutral overflow button. Placed last/right
             so it lands in the more reachable, more prominent slot. -->
        <q-btn
          flat
          round
          dense
          class="add-contact-btn"
          :aria-label="$t('Add Contact')"
          @click="showAddModal"
        >
          <Icon icon="tabler:plus" width="20" height="20" />
        </q-btn>
      </div>
    </div>

    <!-- Content -->
    <div class="page-content full">
      <AddressBookList
        @add-contact="showAddModal"
        @edit-contact="showEditModal"
        @pay-contact="payContact"
      />
    </div>

    <!-- Add/Edit Modal -->
    <AddressBookModal
      v-model="showModal"
      :entry="selectedEntry"
      @saved="handleEntrySaved"
      @open-existing="handleOpenExisting"
    />

    <!-- Batch Send Modal -->
    <BatchSendModal
      v-model="showBatchSend"
      @batch-completed="handleBatchCompleted"
    />
  </q-page>
</template>

<script>
import { useAddressBookStore } from '../stores/addressBook'
import { useIdentityStore } from '../stores/identity'
import { mapActions, mapState } from 'pinia'

// Nostr contacts get a quiet re-sync the moment the user reaches for
// them. Locked decision #2: only on tap, never periodic, so a stale
// avatar / lud16 corrects itself the next time the user opens the
// payment flow without ever blocking the tap on a network call.
const RESYNC_COOLDOWN_MS = 60 * 1000

import AddressBookList from '../components/AddressBook/AddressBookList.vue'
import AddressBookModal from '../components/AddressBook/AddressBookModal.vue'
import BatchSendModal from '../components/BatchSendModal.vue'

export default {
  name: 'AddressBookPage',
  components: {
    AddressBookList,
    AddressBookModal,
    BatchSendModal
  },
  data() {
    return {
      showModal: false,
      selectedEntry: null,
      showBatchSend: false,
    }
  },
  computed: {
    // Surfaced for the kebab's disabled state. `isSyncing` is read by
    // the status component directly off the store.
    ...mapState(useAddressBookStore, ['isRecovering', 'syncDirty']),
  },
  // Automatic publishing is owned by the app-level driver
  // (useAddressBookSync) so contacts added from ANY surface sync,
  // not only while this page is mounted. This page keeps just the
  // explicit actions: manual sync and kebab restore.
  async created() {
    await this.initializeAddressBook()
  },
  methods: {
    ...mapActions(useAddressBookStore, ['initialize', 'syncToNostr', 'recoverFromNostr', 'isEntryPayable']),

    async initializeAddressBook() {
      try {
        await this.initialize()
      } catch (error) {
        console.error('Error initializing address book:', error)
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t load contacts'),

        })
      }
    },

    /**
     * Publish the contact list to the user's private NIP-51 event.
     * `silent` distinguishes the automatic debounced path (no toast)
     * from the explicit status-row tap (toast on hard failure so the
     * user knows their deliberate action didn't land).
     */
    async runSync({ silent = false } = {}) {
      const identityStore = useIdentityStore()
      if (!identityStore.bootstrapped) return
      const result = await this.syncToNostr({ identityStore })
      if (!silent && result && result.ok === false) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t sync contacts'),
          caption: this.$t('Check your connection and try again.'),
          timeout: 4000,
        })
      }
    },

    /**
     * Pull the user's private address book from Nostr and merge.
     * Always an explicit action (kebab tap), so it always reports a
     * result — including the calm "nothing to restore" case so the
     * user isn't left wondering whether the tap did anything.
     */
    async runRecovery() {
      const identityStore = useIdentityStore()
      if (!identityStore.bootstrapped) {
        this.$q.notify({
          type: 'warning',
          message: this.$t('No identity yet'),
          caption: this.$t('Set up or restore your BuhoGO identity first.'),
          timeout: 4000,
        })
        return
      }
      const result = await this.recoverFromNostr({ identityStore })
      if (!result || result.ok === false) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t restore contacts'),
          caption: this.$t('Check your connection and try again.'),
          timeout: 4000,
        })
        return
      }
      if (!result.hadRemote) {
        this.$q.notify({
          type: 'info',
          message: this.$t('Nothing to restore'),
          caption: this.$t('No contacts have been synced from this identity yet.'),
          timeout: 3500,
        })
        return
      }
      if (result.restored === 0) {
        this.$q.notify({
          type: 'positive',
          message: this.$t('Contacts already up to date'),
          timeout: 3000,
        })
        return
      }
      const caption = result.identityOnly > 0
        ? this.$t('{n} couldn\'t be restored. They have no Lightning address right now.', { n: result.identityOnly })
        : undefined
      this.$q.notify({
        type: 'positive',
        message: this.$t('Restored {n} contacts', { n: result.restored }),
        caption,
        timeout: 4500,
      })
    },

    showAddModal() {
      this.selectedEntry = null
      this.showModal = true
    },

    showEditModal(entry) {
      this.selectedEntry = entry
      this.showModal = true
    },

    payContact(contact) {
      // Kick off a silent profile re-sync before we even decide the
      // routing — fire-and-forget so it never blocks the tap. The
      // refresh updates the avatar / lud16 in place; if it errors,
      // the user still pays with the last-known data.
      this.maybeRefreshContact(contact)

      // Identity-only Nostr contact — restored (or saved) without a
      // current Lightning address. We don't route into a payment flow
      // it can't finish; instead we explain, and the silent refresh
      // fired above will promote them to payable the moment they
      // publish a lud16.
      if (contact.source === 'nostr' && !this.isEntryPayable(contact)) {
        this.$q.notify({
          type: 'info',
          message: this.$t('No Lightning address yet'),
          caption: this.$t(
            "{name} hasn't published a Lightning address. We'll use it automatically once they do.",
            { name: contact.name },
          ),
          timeout: 4500,
        })
        return
      }

      // Hand the contact to the wallet page — its dispatcher is the one
      // send pipeline (LNURL metadata, Branta, branding, fee estimates,
      // capability gate), so a contact paid from here behaves exactly
      // like one paid from the Send sheet.
      this.navigateToWalletPayment(contact)
    },

    /**
     * Silent re-sync hook for Nostr-sourced contacts. Skips:
     *   - manual contacts (nothing to sync against)
     *   - contacts we've re-synced within the cooldown window
     *     (defends a rage-tap from hammering the relays)
     *
     * Errors are swallowed by `refreshContact` itself (it returns a
     * typed result, never throws) so this stays fire-and-forget.
     */
    maybeRefreshContact(contact) {
      if (!contact || contact.source !== 'nostr' || !contact.nostr_pubkey) return
      const last = Number(contact.last_synced_at) || 0
      if (Date.now() - last < RESYNC_COOLDOWN_MS) return
      const store = useAddressBookStore()
      store.refreshContact(contact.id).catch((err) => {
        // refreshContact never throws — this is purely defensive in
        // case a future change drops that invariant.
        console.warn('[addressBook] silent refresh threw:', err)
      })
    },

    navigateToWalletPayment(contact) {
      const address = contact.address || contact.lightningAddress
      this.$router.push({
        path: '/wallet',
        query: {
          action: 'pay_contact',
          address: address,
          addressType: contact.addressType || 'lightning',
          contactName: contact.name
        }
      })
    },

    handleEntrySaved() {
      this.selectedEntry = null
      // Modal will close automatically
    },

    /**
     * The search/scan flow surfaced an "Open contact" affordance for
     * a Nostr profile already in the address book. The modal closes
     * itself before bubbling this up, so we just need to surface the
     * existing entry — payment is the most useful next action.
     */
    handleOpenExisting(entry) {
      if (!entry) return
      this.payContact(entry)
    },

    handleBatchCompleted(results) {
      const succeeded = results.filter(r => r.status === 'success').length
      const failed = results.filter(r => r.status === 'failed' || r.status === 'skipped').length

      this.$q.notify({
        type: failed === 0 ? 'positive' : 'warning',
        message: failed === 0
          ? this.$t('{count} payments sent', { count: succeeded })
          : this.$t('{sent} sent, {failed} failed', { sent: succeeded, failed }),
        timeout: 3000
      })
    }
  }
}
</script>

<style scoped>
/* Base Page Styles — fixed-height flex column: the screen is laid out
   once and never overflows the safe viewport. Header is a fixed-size
   flex row; the content below is the single flex child that scrolls
   internally (see .page-content). This is the same pattern
   TransactionHistory.vue uses, and it's what makes the header's own
   safe-area padding (below) actually correct: a `min-height: 100vh`
   + `position: sticky` page (the old shape) lets the header grow
   without the surrounding layout ever re-measuring against that
   growth, which is exactly how a hardcoded `calc(100vh - Npx)`
   content height drifts wrong on notched Android devices. Flexbox
   fills "whatever's left" automatically, so there's no magic number
   to keep in sync with the header's real height. */
.address-book-page {
  background: var(--bg-secondary);
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: 'Manrope', sans-serif;
  max-width: 100vw;
  /* The header owns the top safe-area inset (see .page-header), so the
     global .q-page top padding is cancelled here; the bottom inset
     clears the gesture nav bar below the scrollable content. */
  padding-top: 0;
  padding-bottom: var(--safe-bottom, 0px);
}

/* Header — same grid-centered, inset-owning shell as SettingsHubHeader
   (Identity/Spend/Settings): grid instead of flex so the title stays
   truly centered regardless of how wide either side's controls end up.
   No `position: sticky` needed — the page itself doesn't scroll (see
   .address-book-page above), so the header is just the first fixed-size
   row in that column and stays put without it. */
.page-header {
  flex: 0 0 auto;
  z-index: 100;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: calc(0.875rem + var(--safe-top, 0px)) 1rem 0.875rem;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-card);
}

.header-title {
  grid-column: 2;
  justify-self: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--text-primary);
}

.back-btn {
  grid-column: 1;
  justify-self: start;
}

/* Right-side header cluster: overflow (rarely used, quiet neutral
   style) then Add Contact (primary action, its own tinted presence)
   — swapped from the old + / kebab order so the more useful action
   lands in the more reachable, more visually prominent slot. */
.header-actions {
  grid-column: 3;
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 4px;
}

.header-side-btn {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: background-color 0.15s ease, color 0.15s ease;
}

.header-side-btn:hover {
  background: var(--bg-input);
  color: var(--text-primary);
}

.overflow-btn {
  width: 36px;
  height: 36px;
}

/* Add Contact — soft brand-green tint gives the primary action its
   own visual weight instead of matching the neutral overflow button
   (same "quiet tint" language as the rest of the app: wallet-hint,
   seed-callout, quick-chip.active). */
.add-contact-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-accent-soft, rgba(21, 222, 114, 0.14));
  color: var(--brand-accent, #15DE72);
  transition: background-color 0.15s ease, transform 0.08s ease;
}

.add-contact-btn:hover {
  background: rgba(21, 222, 114, 0.22);
}

.add-contact-btn:active {
  transform: scale(0.94);
}

.ab-spin {
  animation: ab-spin 0.9s linear infinite;
}

@keyframes ab-spin {
  to { transform: rotate(360deg); }
}

/* Content — the single flex child that fills whatever space the header
   didn't use, and scrolls internally (AddressBookList owns its own
   internal q-scroll-area sizing via the same flex-fill chain). */
.page-content {
  flex: 1 1 auto;
  min-height: 0;
}

/* Responsive Design */
@media (max-width: 480px) {
  .page-header {
    padding: calc(0.75rem + var(--safe-top, 0px)) 1rem 0.75rem;
  }

  .header-title {
    font-size: 14px;
  }
}
</style>
