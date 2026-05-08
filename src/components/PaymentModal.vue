<!--
  PaymentModal
  Contact-flow adapter around PaymentConfirmSheet. When a user taps a
  contact (from the address book, the wallet's quick-contacts sheet, or
  the send scanner), this component:

    1. Translates the contact + active-wallet capabilities into the
       normalized `payment` payload that PaymentConfirmSheet expects.
    2. Delegates the entire UI (recipient hero, amount stage with quick
       chips, optional comment, slide-to-send for ≥ 20k sats, etc.) to
       the shared sheet.
    3. Owns the send pipeline — Spark / LNBits / NWC routing, LNURL
       resolution, error mapping — and runs it on the sheet's `confirm`
       event.

  Why split this way: keeping the sheet strictly presentational means
  Wallet.vue's scanner flow and this contact flow share the same UX and
  styles without any duplication, while each call site owns the pieces
  it actually needs (provider selection, post-send cleanup, contact
  metadata, etc.).
-->
<template>
  <PaymentConfirmSheet
    ref="sheetRef"
    v-model="show"
    :payment="sheetPayment"
    :wallet-can-pay="canPayContact"
    :wallet-hint="walletHint"
    :is-sending="isSending"
    @confirm="handleConfirm"
    @cancel="closeModal"
  />
</template>

<script>
import { useWalletStore } from '../stores/wallet'
import LightningPaymentService, { resolveLUD17URL } from '../utils/lightning.js'
import {
  isLightningInvoice as isLightningInvoiceShared,
  isLnurl as isLnurlShared,
} from '../utils/addressUtils.js'
import PaymentConfirmSheet from './PaymentConfirmSheet.vue'

export default {
  name: 'PaymentModal',
  components: { PaymentConfirmSheet },
  props: {
    modelValue: { type: Boolean, default: false },
    contact: { type: Object, default: null }
  },
  emits: ['update:modelValue', 'payment-sent', 'bitcoin-payment-requested'],
  data() {
    return {
      isSending: false,
      // Cached snapshot of the legacy localStorage-backed wallet state.
      // The NWC send path still reads `connectedWallets`/`activeWalletId`
      // from there; switching it to read from the Pinia store is a
      // separate cleanup.
      walletState: {}
    }
  },
  computed: {
    show: {
      get() { return this.modelValue },
      set(v) { this.$emit('update:modelValue', v) }
    },

    contactAddress() {
      return this.contact?.address || this.contact?.lightningAddress || ''
    },

    contactAddressType() {
      return this.contact?.addressType || 'lightning'
    },

    isSparkContact() { return this.contactAddressType === 'spark' },
    isBitcoinContact() { return this.contactAddressType === 'bitcoin' },

    /**
     * Capability check — Spark and Bitcoin contacts can only be paid
     * from a Spark wallet; Lightning contacts work from any wallet type.
     */
    canPayContact() {
      if (this.isSparkContact || this.isBitcoinContact) {
        return useWalletStore().isActiveWalletSpark
      }
      return true
    },

    walletHint() {
      if (this.canPayContact) return ''
      return this.isBitcoinContact
        ? this.$t('Switch to your Spark wallet to send Bitcoin')
        : this.$t('Switch to your Spark wallet to send to this address')
    },

    /**
     * Adapter: contact → sheet's normalized payment shape.
     *
     * Contacts always present a free-amount payment — we don't pre-fetch
     * LNURL metadata (and therefore don't know about fixed / min-max
     * constraints) at this layer. If the user enters an out-of-range
     * amount, the LNURL endpoint rejects it and the error surfaces via
     * `getPaymentErrorMessage` below.
     */
    sheetPayment() {
      if (!this.contact) return null
      return {
        recipient: {
          name: this.contact.name,
          color: this.contact.color || '#3B82F6',
          initial: this.contact.name ? this.contact.name.charAt(0).toUpperCase() : '?',
          addressType: this.contactAddressType,
          address: this.contactAddress
        },
        amount: { mode: 'free' },
        description: '',
        // Spark transfers and on-chain Bitcoin sends don't carry comments;
        // Lightning paths (address / LNURL / invoice) do, and the LNURL
        // resolver respects `commentAllowed` server-side anyway.
        commentAllowed: !this.isSparkContact && !this.isBitcoinContact,
        commentMaxLength: 100
      }
    }
  },
  watch: {
    show(v) {
      if (v) this.loadWalletState()
    }
  },
  methods: {
    closeModal() {
      this.show = false
    },

    loadWalletState() {
      const saved = localStorage.getItem('buhoGO_wallet_state')
      if (saved) {
        try { this.walletState = JSON.parse(saved) } catch { this.walletState = {} }
      }
    },

    /**
     * PaymentConfirmSheet → confirm handler.
     * Bitcoin contacts hand off to the L1 withdrawal flow via the
     * existing `bitcoin-payment-requested` emit; everything else routes
     * through the wallet-aware send methods below.
     */
    async handleConfirm({ amountSats, comment }) {
      if (!this.contact || !amountSats) return

      if (this.isBitcoinContact) {
        this.$emit('bitcoin-payment-requested', {
          contact: this.contact,
          address: this.contactAddress,
          amount: amountSats
        })
        this.closeModal()
        return
      }

      this.isSending = true
      try {
        const walletStore = useWalletStore()
        if (this.isSparkContact) {
          await this.sendSparkPayment(walletStore, amountSats)
        } else {
          await this.sendLightningPayment(amountSats, comment)
        }

        this.$emit('payment-sent', {
          contact: this.contact,
          amount: amountSats,
          comment
        })
        this.closeModal()
      } catch (error) {
        console.error('Payment error:', error)
        this.$refs.sheetRef?.resetSlide()
        this.$q.notify({
          type: 'negative',
          message: this.getPaymentErrorMessage(error),
          caption: this.getPaymentErrorCaption(error),
          timeout: 5000
        })
      } finally {
        this.isSending = false
      }
    },

    // ─────────────────────────────────────────────────────────────
    // Send routing — preserved from the previous design.
    // ─────────────────────────────────────────────────────────────

    async sendSparkPayment(walletStore, amountSats) {
      const provider = walletStore.getActiveProvider()
      if (!provider) throw new Error('SPARK_NOT_CONNECTED')
      return await provider.transferToSparkAddress(this.contactAddress, amountSats)
    },

    async sendLightningPayment(amountSats, comment) {
      const walletStore = useWalletStore()
      const address = this.contactAddress
      const walletType = walletStore.activeWalletType

      if (walletType === 'spark') {
        const provider = walletStore.getActiveProvider()
        if (!provider) throw new Error('SPARK_NOT_CONNECTED')

        if (this.isLightningInvoice(address)) {
          return await provider.payInvoice({ invoice: address })
        }
        if (this.isLightningAddress(address)) {
          return await provider.payLightningAddress(address, amountSats, comment || undefined)
        }
        if (this.isLNURL(address)) {
          const invoice = await this.fetchLNURLInvoice(address, amountSats)
          return await provider.payInvoice({ invoice })
        }
        throw new Error('UNSUPPORTED_PAYMENT_TYPE')
      }

      if (walletType === 'lnbits') {
        const provider = walletStore.getActiveProvider()
        if (!provider) throw new Error('LNBITS_NOT_CONNECTED')

        if (this.isLightningInvoice(address)) {
          return await provider.payInvoice({ invoice: address })
        }
        if (this.isLightningAddress(address)) {
          const invoice = await this.fetchLightningAddressInvoice(address, amountSats, comment)
          return await provider.payInvoice({ invoice })
        }
        if (this.isLNURL(address)) {
          const invoice = await this.fetchLNURLInvoice(address, amountSats)
          return await provider.payInvoice({ invoice })
        }
        throw new Error('UNSUPPORTED_PAYMENT_TYPE')
      }

      // NWC fallback
      const activeWallet = this.walletState.connectedWallets?.find(
        w => w.id === this.walletState.activeWalletId
      )
      if (!activeWallet?.nwcString) throw new Error('NO_ACTIVE_WALLET')

      const lightningService = new LightningPaymentService(activeWallet.nwcString)
      const paymentData = await lightningService.processPaymentInput(address)
      return await lightningService.sendPayment(paymentData, amountSats, comment || undefined)
    },

    // Identifier predicates — LN invoice / LNURL delegate to the shared
    // module; the looser Lightning-Address predicate matches the previous
    // send-flow behaviour where any "x@y" that isn't an LNURL is treated
    // as a Lightning address (the strict format check lives upstream in
    // addressUtils).
    isLightningInvoice(input) { return isLightningInvoiceShared(input) },
    isLightningAddress(input) { return input.includes('@') && !input.startsWith('lnurl') },
    isLNURL(input) { return isLnurlShared(input) },

    async fetchLNURLInvoice(lnurl, amountSats) {
      const url = this.decodeLNURL(lnurl)
      const response = await fetch(url)
      if (!response.ok) throw new Error('Failed to fetch LNURL')

      const data = await response.json()
      if (data.status === 'ERROR') throw new Error(data.reason || 'LNURL error')

      const minSats = Math.ceil((data.minSendable || 1000) / 1000)
      const maxSats = Math.floor((data.maxSendable || 100000000000) / 1000)
      if (amountSats < minSats || amountSats > maxSats) {
        throw new Error(`Amount must be between ${minSats} and ${maxSats} sats`)
      }

      const callbackUrl = `${data.callback}?amount=${amountSats * 1000}`
      const invoiceResponse = await fetch(callbackUrl)
      if (!invoiceResponse.ok) throw new Error('Failed to get invoice')

      const invoiceData = await invoiceResponse.json()
      if (invoiceData.status === 'ERROR') throw new Error(invoiceData.reason || 'Invoice error')
      return invoiceData.pr
    },

    async fetchLightningAddressInvoice(address, amountSats, comment) {
      const [username, domain] = address.split('@')
      if (!username || !domain) throw new Error('Invalid Lightning address')

      const endpoint = `https://${domain}/.well-known/lnurlp/${username}`
      const response = await fetch(endpoint)
      if (!response.ok) throw new Error('Failed to resolve Lightning address')

      const data = await response.json()
      if (data.status === 'ERROR') throw new Error(data.reason || 'Lightning address error')

      const minSats = Math.ceil((data.minSendable || 1000) / 1000)
      const maxSats = Math.floor((data.maxSendable || 100000000000) / 1000)
      if (amountSats < minSats || amountSats > maxSats) {
        throw new Error(`Amount must be between ${minSats} and ${maxSats} sats`)
      }

      const amountMsats = amountSats * 1000
      let callbackUrl = `${data.callback}${data.callback.includes('?') ? '&' : '?'}amount=${amountMsats}`
      if (comment && data.commentAllowed && comment.length <= data.commentAllowed) {
        callbackUrl += `&comment=${encodeURIComponent(comment)}`
      }

      const invoiceResponse = await fetch(callbackUrl)
      if (!invoiceResponse.ok) throw new Error('Failed to get invoice from Lightning address')

      const invoiceData = await invoiceResponse.json()
      if (invoiceData.status === 'ERROR') throw new Error(invoiceData.reason || 'Invoice generation failed')
      return invoiceData.pr
    },

    /**
     * LNURL bech32 / LUD-17 → URL. Kept inline rather than hoisted to
     * addressUtils because the rest of the app routes LNURL resolution
     * through provider methods; this is the one place that still needs
     * a manual decode (the NWC + LNBits paths).
     */
    decodeLNURL(lnurl) {
      const clean = lnurl.trim().replace(/^lightning:/i, '')

      const lud17Url = resolveLUD17URL(clean)
      if (lud17Url) return lud17Url

      const input = clean.toLowerCase()
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
      const dataValues = values.slice(0, -6)

      let bits = 0, value = 0
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
      const code = error.message || ''
      switch (code) {
        case 'NO_ACTIVE_WALLET':       return this.$t('No wallet connected')
        case 'SPARK_NOT_CONNECTED':    return this.$t('Spark wallet not unlocked')
        case 'LNBITS_NOT_CONNECTED':   return this.$t('LNBits wallet not connected')
        case 'INSUFFICIENT_BALANCE':   return this.$t('Insufficient balance')
        case 'PAYMENT_FAILED':         return this.$t('Payment failed')
        case 'UNSUPPORTED_PAYMENT_TYPE': return this.$t('Unsupported payment format')
      }
      if (code.includes('insufficient') || code.includes('balance')) return this.$t('Insufficient balance')
      if (code.includes('timeout') || code.includes('Timeout'))     return this.$t('Payment timed out')
      if (code.includes('network') || code.includes('Network'))    return this.$t('Network error')
      if (code.includes('LNURL') || code.includes('lnurl'))        return this.$t('LNURL error')
      return this.$t('Payment failed')
    },

    getPaymentErrorCaption(error) {
      const code = error.message || ''
      switch (code) {
        case 'NO_ACTIVE_WALLET':       return this.$t('Please connect a wallet first')
        case 'SPARK_NOT_CONNECTED':    return this.$t('Spark wallet not connected. Please try again.')
        case 'INSUFFICIENT_BALANCE':   return this.$t("You don't have enough funds for this payment")
        case 'UNSUPPORTED_PAYMENT_TYPE': return this.$t('Use a Lightning invoice, address, or LNURL')
      }
      return code.length < 100 ? code : this.$t('Please try again later')
    }
  }
}
</script>
