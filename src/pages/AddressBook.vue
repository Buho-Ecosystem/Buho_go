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
      <q-btn no-caps unelevated class="add-contact-pill-btn" @click="showAddModal">
        {{ $t('Add Contact') }}
      </q-btn>
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
import { mapActions } from 'pinia'
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
      showBatchSend: false
    }
  },
  async created() {
    await this.initializeAddressBook()
  },
  methods: {
    ...mapActions(useAddressBookStore, ['initialize']),

    async initializeAddressBook() {
      try {
        await this.initialize()
      } catch (error) {
        console.error('Error initializing address book:', error)
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t load contacts'),

          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      }
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
      // Bitcoin contacts need the L1 withdrawal flow - navigate directly to Wallet
      if (contact.addressType === 'bitcoin') {
        this.navigateToBitcoinWithdrawal(contact)
        return
      }

      // Lightning and Spark contacts use PaymentModal
      this.selectedContact = contact
      this.showPayment = true
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

    handlePaymentSent() {
      this.selectedContact = null
      this.$q.notify({
        type: 'positive',
        message: this.$t('Sent'),

        actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
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
  top: 0;
  z-index: 100;
}

.page_header_light {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: white;
  border-bottom: 1px solid #E5E7EB;
  position: sticky;
  top: 0;
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
  color: #6B7280;
}

.back_btn_dark:hover {
  background: var(--border-card);
}

.back_btn_light:hover {
  background: #F1F5F9;
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

/* Add Contact Pill Button */
.add-contact-pill-btn {
  background: var(--gradient-green);
  color: #FFF;
  border-radius: 999px;
  padding: 6px 18px;
  font-size: 13px;
  font-weight: 500;
  font-family: 'Manrope', sans-serif;
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

  .add-contact-pill-btn {
    padding: 5px 14px;
    font-size: 12px;
  }
}
</style>
