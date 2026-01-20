<template>
  <q-dialog
    v-model="show"
    persistent
    maximized
    transition-show="slide-up"
    transition-hide="slide-down"
    class="payment-modal"
  >
    <q-card class="payment-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <!-- Header -->
      <q-card-section class="payment-header" :class="$q.dark.isActive ? 'header-dark' : 'header-light'">
        <div class="header-content">
          <q-btn
            flat
            round
            dense
            @click="closeModal"
            class="back-btn"
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
            {{ $t('Send Payment') }}
          </div>
          <div class="header-spacer"></div>
        </div>
      </q-card-section>

      <!-- Contact Info -->
      <q-card-section class="contact-section" :class="$q.dark.isActive ? 'contact-section-dark' : 'contact-section-light'">
        <div class="contact-card" :class="$q.dark.isActive ? 'contact-card-dark' : 'contact-card-light'">
          <div class="contact-avatar">
            <div 
              class="avatar-circle"
              :style="{ backgroundColor: contact?.color || '#3B82F6' }"
            >
              <span class="avatar-initial">{{ getContactInitial() }}</span>
            </div>
          </div>
          <div class="contact-details">
            <div class="contact-name-row">
              <div class="contact-name" :class="$q.dark.isActive ? 'contact-name-dark' : 'contact-name-light'">
                {{ contact?.name || 'Contact' }}
              </div>
              <div class="contact-type-badge" :class="contactTypeBadgeClass">
                <q-icon :name="contactTypeIcon" size="10px" />
                <span>{{ contactTypeLabel }}</span>
              </div>
            </div>
            <div class="contact-address" :class="$q.dark.isActive ? 'contact-address-dark' : 'contact-address-light'">
              {{ contactAddress }}
            </div>
          </div>
        </div>
      </q-card-section>

      <!-- Wallet Mismatch Warning -->
      <q-card-section v-if="!canPayContact" class="warning-section">
        <div class="warning-banner" :class="$q.dark.isActive ? 'warning-dark' : 'warning-light'">
          <q-icon name="las la-exclamation-triangle" class="warning-icon" />
          <div class="warning-content">
            <div class="warning-title">{{ $t('Spark wallet required') }}</div>
            <div class="warning-text">
              {{ $t('Switch to your Spark wallet to pay this Spark address') }}
            </div>
          </div>
        </div>
      </q-card-section>

      <!-- Amount Section -->
      <q-card-section class="amount-section">
        <!-- Currency Toggle -->
        <div class="currency-toggle" @click="toggleCurrency"
             :class="$q.dark.isActive ? 'currency-toggle-dark' : 'currency-toggle-light'">
          <span class="currency-label">{{ currentCurrency }}</span>
          <q-icon name="las la-redo-alt" class="toggle-icon"/>
        </div>

        <!-- Amount Input -->
        <div class="amount-input-container">
          <div class="amount-display">
            <input
              v-model="displayAmount"
              @input="onAmountChange"
              @focus="onAmountFocus"
              @blur="onAmountBlur"
              type="text"
              inputmode="decimal"
              class="amount-input"
              :class="$q.dark.isActive ? 'amount-input-dark' : 'amount-input-light'"
              :placeholder="getAmountPlaceholder()"
              autofocus
            />
          </div>
        </div>

        <!-- Fiat Equivalent -->
        <div class="fiat-equivalent" :class="$q.dark.isActive ? 'fiat-equivalent-dark' : 'fiat-equivalent-light'">
          {{ getFiatEquivalent() }}
        </div>
      </q-card-section>

      <!-- Comment Section -->
      <q-card-section class="comment-section">
        <div class="comment-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
          {{ $t('Comment (optional)') }}
        </div>
        <div class="comment-input-container">
          <input
            v-model="comment"
            type="text"
            :placeholder="$t('Add a note for this payment')"
            class="comment-input"
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            maxlength="100"
          />
        </div>
      </q-card-section>

      <!-- Footer -->
      <q-card-section class="payment-footer">
        <q-btn
          class="send-payment-btn"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :loading="isSending"
          @click="sendPayment"
          :disable="!isValidAmount || !canPayContact"
          no-caps
          unelevated
        >
          <span v-if="!isSending">{{ $t('Send Payment') }}</span>
          <template v-slot:loading>
            <q-spinner-dots class="q-mr-sm"/>
            {{ $t('Sending...') }}
          </template>
        </q-btn>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script>
import { useWalletStore } from '../stores/wallet'
import { mapState } from 'pinia'
import LightningPaymentService from '../utils/lightning.js'
import { fiatRatesService } from '../utils/fiatRates.js'
import { formatAmount } from '../utils/amountFormatting.js'

export default {
  name: 'PaymentModal',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    contact: {
      type: Object,
      default: null
    }
  },
  emits: ['update:modelValue', 'payment-sent'],
  data() {
    return {
      displayAmount: '',
      comment: '',
      currentCurrency: 'sats',
      isSending: false,
      amountInSats: 0,
      isAmountFocused: false,
      walletState: {},
      fiatRates: {}
    }
  },
  computed: {
    ...mapState(useWalletStore, [
      'activeWallet',
      'denominationCurrency',
      'exchangeRates',
      'preferredFiatCurrency',
      'isActiveWalletSpark',
      'useBip177Format'
    ]),

    show: {
      get() {
        return this.modelValue
      },
      set(value) {
        this.$emit('update:modelValue', value)
      }
    },

    isValidAmount() {
      return this.amountInSats > 0
    },

    // Contact address helpers
    contactAddress() {
      return this.contact?.address || this.contact?.lightningAddress || ''
    },

    contactAddressType() {
      return this.contact?.addressType || 'lightning'
    },

    isSparkContact() {
      return this.contactAddressType === 'spark'
    },

    contactTypeIcon() {
      return this.isSparkContact ? 'las la-fire' : 'las la-bolt'
    },

    contactTypeLabel() {
      return this.isSparkContact ? 'Spark' : 'Lightning'
    },

    contactTypeBadgeClass() {
      return this.isSparkContact ? 'badge-spark' : 'badge-lightning'
    },

    // Check if payment is possible with current wallet
    canPayContact() {
      if (this.isSparkContact) {
        // Spark addresses can only be paid from Spark wallets
        return this.isActiveWalletSpark
      }
      // Lightning addresses can be paid from both wallet types
      return true
    }
  },
  watch: {
    show(newVal) {
      if (newVal) {
        this.loadWalletState()
        this.loadFiatRates()
        this.resetForm()
      }
    }
  },
  methods: {
    loadWalletState() {
      const savedState = localStorage.getItem('buhoGO_wallet_state')
      if (savedState) {
        this.walletState = JSON.parse(savedState)
        this.currentCurrency = this.walletState.denominationCurrency || 'sats'
      }
    },

    async loadFiatRates() {
      try {
        await fiatRatesService.ensureRatesLoaded()
        this.fiatRates = fiatRatesService.getRates()
      } catch (error) {
        console.error('Error loading fiat rates:', error)
      }
    },

    resetForm() {
      this.displayAmount = ''
      this.comment = ''
      this.amountInSats = 0
    },

    closeModal() {
      this.show = false
    },

    getContactInitial() {
      return this.contact?.name ? this.contact.name.charAt(0).toUpperCase() : '?'
    },

    toggleCurrency() {
      const currencies = ['sats', this.walletState.preferredFiatCurrency?.toLowerCase() || 'usd']
      const currentIndex = currencies.indexOf(this.currentCurrency)
      const nextIndex = (currentIndex + 1) % currencies.length
      this.currentCurrency = currencies[nextIndex]
      this.convertAmount()
    },

    getAmountPlaceholder() {
      switch (this.currentCurrency) {
        case 'sats':
          return '0'
        case 'btc':
          return '0.00000000'
        default:
          return '0.00'
      }
    },

    onAmountChange() {
      this.convertAmount()
    },

    onAmountFocus() {
      this.isAmountFocused = true
    },

    onAmountBlur() {
      this.isAmountFocused = false
      this.formatDisplayAmount()
    },

    convertAmount() {
      const amount = parseFloat(this.displayAmount) || 0

      switch (this.currentCurrency) {
        case 'sats':
          this.amountInSats = Math.floor(amount)
          break
        case 'btc':
          this.amountInSats = Math.floor(amount * 100000000)
          break
        default:
          const rate = this.fiatRates[this.currentCurrency.toUpperCase()] || 65000
          const btcAmount = amount / rate
          this.amountInSats = Math.floor(btcAmount * 100000000)
          break
      }
    },

    formatDisplayAmount() {
      if (!this.isAmountFocused && this.displayAmount) {
        const amount = parseFloat(this.displayAmount)
        if (!isNaN(amount)) {
          switch (this.currentCurrency) {
            case 'sats':
              this.displayAmount = Math.floor(amount).toString()
              break
            case 'btc':
              this.displayAmount = amount.toFixed(8)
              break
            default:
              this.displayAmount = amount.toFixed(2)
              break
          }
        }
      }
    },

    getFiatEquivalent() {
      if (!this.amountInSats || !this.fiatRates) return ''

      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD'

        if (this.currentCurrency === currency.toLowerCase()) {
          // Show bitcoin equivalent using utility
          return `≈ ${formatAmount(this.amountInSats, this.useBip177Format)}`
        } else {
          // Show fiat equivalent
          const fiatValue = fiatRatesService.convertSatsToFiatSync(this.amountInSats, currency)

          // Handle unavailable rates
          if (fiatValue === null) {
            return ''
          }

          const symbols = {
            USD: '$',
            EUR: '€',
            GBP: '£',
            CAD: 'C$',
            CHF: 'CHF ',
            AUD: 'A$',
            JPY: '¥'
          }
          const symbol = symbols[currency] || currency + ' '
          return `≈ ${symbol}${fiatValue.toFixed(2)}`
        }
      } catch (error) {
        return ''
      }
    },

    async sendPayment() {
      if (!this.isValidAmount || !this.contact) return

      // Check if payment is possible with current wallet
      if (!this.canPayContact) {
        this.$q.notify({
          type: 'warning',
          message: this.$t('Cannot pay Spark address'),
          caption: this.$t('Switch to your Spark wallet to pay Spark addresses'),
          position: 'bottom',
          timeout: 4000,
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
        return
      }

      this.isSending = true

      try {
        const walletStore = useWalletStore()

        if (this.isSparkContact) {
          // Spark-to-Spark payment
          await this.sendSparkPayment(walletStore)
        } else {
          // Lightning payment
          await this.sendLightningPayment()
        }

        this.$emit('payment-sent', {
          contact: this.contact,
          amount: this.amountInSats,
          comment: this.comment
        })

        this.closeModal()

      } catch (error) {
        console.error('Payment error:', error)
        this.$q.notify({
          type: 'negative',
          message: this.getPaymentErrorMessage(error),
          caption: this.getPaymentErrorCaption(error),
          position: 'bottom',
          timeout: 5000,
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        })
      } finally {
        this.isSending = false
      }
    },

    async sendSparkPayment(walletStore) {
      // Get the Spark wallet provider
      const provider = walletStore.providers[walletStore.activeWalletId]

      if (!provider) {
        throw new Error('SPARK_NOT_CONNECTED')
      }

      // Transfer to Spark address
      const result = await provider.transferToSparkAddress(
        this.contactAddress,
        this.amountInSats
      )

      console.log('Spark transfer result:', result)
      return result
    },

    async sendLightningPayment() {
      const walletStore = useWalletStore()
      const address = this.contactAddress

      // Use Spark wallet if active
      if (this.isActiveWalletSpark) {
        const provider = walletStore.getActiveProvider()

        if (!provider) {
          throw new Error('SPARK_NOT_CONNECTED')
        }

        // Determine payment type and route accordingly
        if (this.isLightningInvoice(address)) {
          // Pay BOLT11 invoice
          const result = await provider.payInvoice({ invoice: address })
          console.log('Spark invoice payment result:', result)
          return result
        } else if (this.isLightningAddress(address)) {
          // Pay Lightning address via LNURL
          const result = await provider.payLightningAddress(
            address,
            this.amountInSats,
            this.comment || undefined
          )
          console.log('Spark Lightning address payment result:', result)
          return result
        } else if (this.isLNURL(address)) {
          // Handle LNURL - fetch invoice and pay
          const invoice = await this.fetchLNURLInvoice(address, this.amountInSats)
          const result = await provider.payInvoice({ invoice })
          console.log('Spark LNURL payment result:', result)
          return result
        } else {
          throw new Error('UNSUPPORTED_PAYMENT_TYPE')
        }
      }

      // NWC wallet flow
      const activeWallet = this.walletState.connectedWallets?.find(
        w => w.id === this.walletState.activeWalletId
      )

      if (!activeWallet?.nwcString) {
        throw new Error('NO_ACTIVE_WALLET')
      }

      const lightningService = new LightningPaymentService(activeWallet.nwcString)
      const paymentData = await lightningService.processPaymentInput(address)
      const result = await lightningService.sendPayment(
        paymentData,
        this.amountInSats,
        this.comment || undefined
      )
      console.log('NWC payment result:', result)
      return result
    },

    // Helper methods for payment type detection
    // Lightning invoices: lnbc (mainnet), lntb (testnet), lntbs (signet), lnbcrt (regtest)
    isLightningInvoice(input) {
      const lower = input.toLowerCase()
      return lower.startsWith('lnbc') || lower.startsWith('lntb') ||
        lower.startsWith('lntbs') || lower.startsWith('lnbcrt')
    },

    isLightningAddress(input) {
      return input.includes('@') && !input.startsWith('lnurl')
    },

    isLNURL(input) {
      const lower = input.toLowerCase()
      return lower.startsWith('lnurl')
    },

    async fetchLNURLInvoice(lnurl, amountSats) {
      // Decode LNURL (bech32) to get the URL
      const url = this.decodeLNURL(lnurl)

      // Fetch LNURL endpoint
      const response = await fetch(url)
      if (!response.ok) throw new Error('Failed to fetch LNURL')

      const data = await response.json()
      if (data.status === 'ERROR') throw new Error(data.reason || 'LNURL error')

      // Validate amount bounds
      const minSats = Math.ceil((data.minSendable || 1000) / 1000)
      const maxSats = Math.floor((data.maxSendable || 100000000000) / 1000)
      if (amountSats < minSats || amountSats > maxSats) {
        throw new Error(`Amount must be between ${minSats} and ${maxSats} sats`)
      }

      // Request invoice
      const amountMs = amountSats * 1000
      const callbackUrl = `${data.callback}?amount=${amountMs}`
      const invoiceResponse = await fetch(callbackUrl)
      if (!invoiceResponse.ok) throw new Error('Failed to get invoice')

      const invoiceData = await invoiceResponse.json()
      if (invoiceData.status === 'ERROR') throw new Error(invoiceData.reason || 'Invoice error')

      return invoiceData.pr
    },

    decodeLNURL(lnurl) {
      // Remove prefix if present
      const input = lnurl.toLowerCase().replace('lightning:', '')

      // Bech32 character set
      const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
      const hrpEnd = input.lastIndexOf('1')
      if (hrpEnd < 1) throw new Error('Invalid LNURL')

      const data = input.slice(hrpEnd + 1)
      const values = []

      for (const char of data) {
        const index = CHARSET.indexOf(char)
        if (index === -1) throw new Error('Invalid LNURL character')
        values.push(index)
      }

      // Remove checksum (last 6 chars)
      const dataValues = values.slice(0, -6)

      // Convert 5-bit to 8-bit
      let bits = 0
      let value = 0
      const bytes = []

      for (const v of dataValues) {
        value = (value << 5) | v
        bits += 5
        while (bits >= 8) {
          bits -= 8
          bytes.push((value >> bits) & 0xff)
        }
      }

      return new TextDecoder().decode(new Uint8Array(bytes))
    },

    getPaymentErrorMessage(error) {
      const errorCode = error.message || ''

      switch (errorCode) {
        case 'NO_ACTIVE_WALLET':
          return this.$t('No wallet connected')
        case 'SPARK_NOT_CONNECTED':
          return this.$t('Spark wallet not unlocked')
        case 'INSUFFICIENT_BALANCE':
          return this.$t('Insufficient balance')
        case 'PAYMENT_FAILED':
          return this.$t('Payment failed')
        case 'UNSUPPORTED_PAYMENT_TYPE':
          return this.$t('Unsupported payment format')
        default:
          if (errorCode.includes('insufficient') || errorCode.includes('balance')) {
            return this.$t('Insufficient balance')
          }
          if (errorCode.includes('timeout') || errorCode.includes('Timeout')) {
            return this.$t('Payment timed out')
          }
          if (errorCode.includes('network') || errorCode.includes('Network')) {
            return this.$t('Network error')
          }
          if (errorCode.includes('LNURL') || errorCode.includes('lnurl')) {
            return this.$t('LNURL error')
          }
          return this.$t('Payment failed')
      }
    },

    getPaymentErrorCaption(error) {
      const errorCode = error.message || ''

      switch (errorCode) {
        case 'NO_ACTIVE_WALLET':
          return this.$t('Please connect a wallet first')
        case 'SPARK_NOT_CONNECTED':
          return this.$t('Please enter your PIN to unlock')
        case 'INSUFFICIENT_BALANCE':
          return this.$t('You don\'t have enough funds for this payment')
        case 'UNSUPPORTED_PAYMENT_TYPE':
          return this.$t('Use a Lightning invoice, address, or LNURL')
        default:
          // Return the actual error message for debugging if not a known code
          if (errorCode.length < 100) {
            return errorCode
          }
          return this.$t('Please try again later')
      }
    }
  }
}
</script>

<style scoped>
.payment-modal :deep(.q-dialog__inner) {
  padding: 0;
}

.payment-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* Header */
.payment-header {
  border-bottom: 1px solid;
  padding: 0.75rem 1rem;
  flex-shrink: 0;
}

.header-dark {
  border-bottom-color: #2A342A;
}

.header-light {
  border-bottom-color: #E5E7EB;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
}

.header-title {
  flex: 1;
  text-align: center;
  margin: 0 1rem;
}

.header-spacer {
  width: 40px;
}

/* Contact Section */
.contact-section {
  padding: 1rem;
  border-bottom: 1px solid;
}

.contact-section-dark {
  border-bottom-color: #2A342A;
}

.contact-section-light {
  border-bottom-color: #E5E7EB;
}

.contact-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border-radius: 16px;
  border: 1px solid;
}

.contact-card-dark {
  background: #0C0C0C;
  border-color: #2A342A;
}

.contact-card-light {
  background: #FFF;
  border-color: #E5E7EB;
}

.contact-avatar {
  flex-shrink: 0;
}

.avatar-circle {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.avatar-initial {
  color: white;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 18px;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.contact-details {
  flex: 1;
  min-width: 0;
}

.contact-name-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.contact-name {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 16px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-type-badge {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.1rem 0.4rem;
  border-radius: 6px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.badge-lightning {
  background: linear-gradient(135deg, #F59E0B, #D97706);
  color: white;
}

.badge-spark {
  background: linear-gradient(135deg, #EF4444, #DC2626);
  color: white;
}

/* Warning Section */
.warning-section {
  padding: 0 1rem;
}

.warning-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border-radius: 12px;
}

.warning-dark {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.warning-light {
  background: #FFFBEB;
  border: 1px solid #FDE68A;
}

.warning-icon {
  color: #F59E0B;
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.warning-content {
  flex: 1;
}

.warning-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: #F59E0B;
  margin-bottom: 0.25rem;
}

.warning-text {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  color: #D97706;
  line-height: 1.4;
}

.contact-name-dark {
  color: #F6F6F6;
}

.contact-name-light {
  color: #212121;
}

.contact-address {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-address-dark {
  color: #B0B0B0;
}

.contact-address-light {
  color: #6B7280;
}

/* Amount Section */
.amount-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 2rem 1rem;
  text-align: center;
}

.currency-toggle-dark {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: #2A342A;
  padding: 0.375rem 0.75rem;
  border-radius: 16px;
  cursor: pointer;
  margin: 0 auto 1.5rem;
  transition: background-color 0.2s;
  width: fit-content;
}

.currency-toggle-light {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: #E5E7EB;
  padding: 0.375rem 0.75rem;
  border-radius: 16px;
  cursor: pointer;
  margin: 0 auto 1.5rem;
  transition: background-color 0.2s;
  width: fit-content;
}

.currency-toggle-dark:hover {
  background: #1F231F;
}

.currency-toggle-light:hover {
  background: #D1D5DB;
}

.currency-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: #B0B0B0;
  text-transform: capitalize;
  letter-spacing: 0.025em;
}

.toggle-icon {
  color: #B0B0B0;
  font-size: 12px;
}

.amount-input-container {
  display: flex;
  justify-content: center;
  margin-bottom: 1rem;
}

.amount-input {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 2.75rem;
  font-weight: 300;
  border: none;
  outline: none;
  background: transparent;
  text-align: center;
  min-width: 200px;
}

.amount-input-dark {
  color: #FFF;
}

.amount-input-light {
  color: #374151;
}

.amount-input::placeholder {
  color: #B0B0B0;
}

.fiat-equivalent {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 1.125rem;
  margin-bottom: 1rem;
}

.fiat-equivalent-dark {
  color: #B0B0B0;
}

.fiat-equivalent-light {
  color: #6B7280;
}

/* Comment Section */
.comment-section {
  padding: 1rem;
  border-bottom: 1px solid;
}

.comment-section {
  border-bottom-color: #2A342A;
}

.comment-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  margin-bottom: 0.75rem;
  text-align: center;
}

.view_title_dark {
  color: #B0B0B0;
}

.comment-input-container {
  max-width: 320px;
  margin: 0 auto;
}

.comment-input {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid transparent;
  border-radius: 20px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.comment-input:focus {
  border-color: #15DE72;
}

.comment-input::placeholder {
  color: #B0B0B0;
}

/* Footer */
.payment-footer {
  padding: 1rem 1.5rem 1.5rem;
  flex-shrink: 0;
}

.send-payment-btn {
  width: 100%;
  height: 52px;
  border-radius: 24px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 400;
  transition: all 0.2s ease;
  border: none;
  cursor: pointer;
}

/* Responsive Design */
@media (max-width: 480px) {
  .amount-section {
    padding: 1.5rem 1rem;
  }

  .amount-input {
    font-size: 2.25rem;
    min-width: 160px;
  }

  .contact-card {
    padding: 0.75rem;
  }

  .avatar-circle {
    width: 40px;
    height: 40px;
  }

  .avatar-initial {
    font-size: 16px;
  }

  .contact-name {
    font-size: 15px;
  }

  .contact-address {
    font-size: 13px;
  }

  .comment-input-container {
    max-width: 280px;
  }

  .payment-footer {
    padding: 0.75rem 1rem 1.25rem;
  }

  .send-payment-btn {
    height: 48px;
  }
}
</style>