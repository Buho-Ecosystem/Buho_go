<template>
  <q-page :class="$q.dark.isActive ? 'address-book-page-dark' : 'address-book-page-light'">
    <!-- Header -->
    <div class="page-header" :class="$q.dark.isActive ? 'page_header_dark' : 'page_header_light'">
      <q-btn
        flat
        round
        dense
        @click="$router.back()"
        :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
      >
        <Icon icon="tabler:chevron-left" width="18" height="18" />
      </q-btn>
      <div class="header-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
        {{ $t('Address Book') }}
      </div>
      <div class="header-actions">
        <q-btn
          flat
          round
          dense
          class="ab-icon-btn"
          :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
          :aria-label="$t('Add Contact')"
          @click="showAddModal"
        >
          <Icon icon="tabler:plus" width="20" height="20" />
        </q-btn>
        <!-- Power-user overflow. The only thing here is "restore from
             Nostr" — every other sync action is automatic (publish on
             change, recover on identity restore). Keeping it in a
             kebab keeps the normal UI uncluttered. -->
        <q-btn
          flat
          round
          dense
          class="ab-icon-btn"
          :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
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
      </div>
    </div>

    <!-- Content -->
    <div class="page-content full">
      <AddressBookList
        @add-contact="showAddModal"
        @edit-contact="showEditModal"
        @pay-contact="showPaymentModal"
      />
    </div>

    <!-- Add/Edit Modal -->
    <AddressBookModal
      v-model="showModal"
      :entry="selectedEntry"
      @saved="handleEntrySaved"
      @open-existing="handleOpenExisting"
    />

    <!-- Payment Modal -->
    <PaymentModal
      v-model="showPayment"
      :contact="selectedContact"
      @payment-sent="handlePaymentSent"
      @bitcoin-payment-requested="handleBitcoinPaymentRequested"
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

// Debounce window between a local contact mutation and the silent
// NIP-51 publish. Long enough that a burst of edits (add three
// contacts in a row) collapses to one publish; short enough that the
// backup feels current.
const AUTO_SYNC_DEBOUNCE_MS = 1500

import AddressBookList from '../components/AddressBook/AddressBookList.vue'
import AddressBookModal from '../components/AddressBook/AddressBookModal.vue'
import PaymentModal from '../components/PaymentModal.vue'
import BatchSendModal from '../components/BatchSendModal.vue'

export default {
  name: 'AddressBookPage',
  components: {
    AddressBookList,
    AddressBookModal,
    PaymentModal,
    BatchSendModal
  },
  data() {
    return {
      showModal: false,
      selectedEntry: null,
      showPayment: false,
      selectedContact: null,
      showBatchSend: false,
      _autoSyncTimer: null,
    }
  },
  computed: {
    // Surfaced for the kebab's disabled state. `isSyncing` is read by
    // the status component directly off the store.
    ...mapState(useAddressBookStore, ['isRecovering', 'syncDirty']),
  },
  watch: {
    /**
     * The store flips `syncDirty` after every nostr-contact mutation
     * — add via Search/Scan, delete, petname edit — regardless of
     * which child component triggered it. Watching the flag here is
     * the single, gap-free hook: the page never has to wire a
     * `@saved` / `@deleted` event per mutation path.
     */
    syncDirty(isDirty) {
      if (isDirty) this._scheduleAutoSync()
    },
  },
  async created() {
    await this.initializeAddressBook()
    // Catch-up: a contact added in a previous session (the dirty
    // flag persists to localStorage) syncs the moment the page opens.
    if (this.syncDirty) this._scheduleAutoSync()
  },
  beforeUnmount() {
    if (this._autoSyncTimer) {
      clearTimeout(this._autoSyncTimer)
      this._autoSyncTimer = null
    }
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
     * Debounced, silent auto-sync. Fires after the dirty flag settles.
     * `getMnemonic()` is a device-key decrypt — no biometric prompt —
     * so this is genuinely invisible in the happy path. Failures are
     * NOT toasted here: the status row already shows the error state
     * and offers a tap-to-retry. Toasting an automatic background
     * action the user didn't initiate would be noise.
     */
    _scheduleAutoSync() {
      if (this._autoSyncTimer) clearTimeout(this._autoSyncTimer)
      this._autoSyncTimer = setTimeout(() => {
        this._autoSyncTimer = null
        this.runSync({ silent: true })
      }, AUTO_SYNC_DEBOUNCE_MS)
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
      const caption = result.unpayable > 0
        ? this.$t('{n} couldn\'t be restored. They have no Lightning address right now.', { n: result.unpayable })
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

    showPaymentModal(contact) {
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

      // Bitcoin contacts need the L1 withdrawal flow - navigate directly to Wallet
      if (contact.addressType === 'bitcoin') {
        this.navigateToBitcoinWithdrawal(contact)
        return
      }

      // Lightning and Spark contacts use PaymentModal
      this.selectedContact = contact
      this.showPayment = true
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

    navigateToBitcoinWithdrawal(contact) {
      const address = contact.address || contact.lightningAddress
      this.$router.push({
        path: '/wallet',
        query: {
          action: 'bitcoin_withdrawal',
          address: address,
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
      this.showPaymentModal(entry)
    },

    handlePaymentSent() {
      this.selectedContact = null
      this.$q.notify({
        type: 'positive',
        message: this.$t('Sent'),

      })
    },

    handleBitcoinPaymentRequested(paymentData) {
      // Fallback handler if PaymentModal is opened with a Bitcoin contact
      this.selectedContact = null
      this.navigateToBitcoinWithdrawal({
        name: paymentData.contact?.name,
        address: paymentData.address
      })
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
/* Base Page Styles */
.address-book-page-dark {
  background: var(--bg-secondary);
  min-height: 100vh;
  font-family: 'Manrope', sans-serif;
  overflow-x: hidden;
  max-width: 100vw;
}

.address-book-page-light {
  background: #F6F6F6;
  min-height: 100vh;
  font-family: 'Manrope', sans-serif;
  overflow-x: hidden;
  max-width: 100vw;
}

/* Header Styles */
.page_header_dark {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-card);
  position: sticky;
  top: var(--safe-top, 0px);
  z-index: 100;
}

.page_header_light {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-card);
  position: sticky;
  top: var(--safe-top, 0px);
  z-index: 100;
}

.back_btn_dark,
.back_btn_light {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease;
}

.back_btn_dark {
  color: #F6F6F6;
}

.back_btn_light {
  color: var(--text-secondary);
}

.back_btn_dark:hover {
  background: var(--border-card);
}

.back_btn_light:hover {
  background: var(--bg-input);
}

.main_page_title_dark {
  color: #F6F6F6;
  font-size: 1.25rem;
  font-weight: 600;
  flex: 1;
  text-align: center;
  font-family: 'Manrope', sans-serif;
}

.main_page_title_light {
  color: #212121;
  font-size: 1.25rem;
  font-weight: 600;
  flex: 1;
  text-align: center;
  font-family: 'Manrope', sans-serif;
}

/* Right-side header cluster: add + overflow, both icon buttons. */
.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ab-icon-btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ab-spin {
  animation: ab-spin 0.9s linear infinite;
}

@keyframes ab-spin {
  to { transform: rotate(360deg); }
}

/* Content */
.page-content {
  height: calc(100vh - 80px);
}

/* Responsive Design */
@media (max-width: 480px) {
  .page_header_dark,
  .page_header_light {
    padding: 0.75rem 1rem;
  }

  .main_page_title_dark,
  .main_page_title_light {
    font-size: 1.125rem;
  }

  .page-content {
    height: calc(100vh - 70px);
  }
}
</style>
