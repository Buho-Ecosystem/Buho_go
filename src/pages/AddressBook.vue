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
        <svg v-if="$q.dark.isActive" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"
             fill="none">
          <path
            d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z"
            fill="white"/>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z"
            fill="#6D6D6D"/>
        </svg>
      </q-btn>
      <div class="header-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
        {{ $t('Address Book') }}
      </div>
      <div class="header-spacer"></div>
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
  </q-page>
</template>

<script>
import { useAddressBookStore } from '../stores/addressBook'
import { mapActions } from 'pinia'
import AddressBookList from '../components/AddressBook/AddressBookList.vue'
import AddressBookModal from '../components/AddressBook/AddressBookModal.vue'
import PaymentModal from '../components/PaymentModal.vue'

export default {
  name: 'AddressBookPage',
  components: {
    AddressBookList,
    AddressBookModal,
    PaymentModal
  },
  data() {
    return {
      showModal: false,
      selectedEntry: null,
      showPayment: false,
      selectedContact: null
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
    }
  }
}
</script>

<style scoped>
/* Base Page Styles */
.address-book-page-dark {
  background: #171717;
  min-height: 100vh;
  font-family: Fustat, 'Inter', sans-serif;
}

.address-book-page-light {
  background: #F6F6F6;
  min-height: 100vh;
  font-family: Fustat, 'Inter', sans-serif;
}

/* Header Styles */
.page_header_dark {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: #0C0C0C;
  border-bottom: 1px solid #2A342A;
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
  background: #2A342A;
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
  font-family: Fustat, 'Inter', sans-serif;
}

.main_page_title_light {
  color: #212121;
  font-size: 1.25rem;
  font-weight: 600;
  flex: 1;
  text-align: center;
  font-family: Fustat, 'Inter', sans-serif;
}

.header-spacer {
  width: 40px;
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
