import { defineStore } from 'pinia'
import { useTransactionMetadataStore } from './transactionMetadata'
import { WALLET_TYPES } from '../providers/WalletFactory'
import { LightningAddress } from '@getalby/lightning-tools'
import { getUserFriendlyErrorMessage } from '../utils/userErrors'

const STORAGE_KEY = 'buhoGO_auto_withdraw'
const SPEED_LABELS = { low: 'Economy', medium: 'Standard', high: 'Priority' }
// Settings persists feeSpeed as low/medium/high. The Spark provider's
// fee quote is keyed by slow/medium/fast. Translate at the boundary so
// Settings UX stays stable while the provider speaks the SDK's language.
const FEE_SPEED_TO_QUOTE_KEY = { low: 'slow', medium: 'medium', high: 'fast' }
const COOLDOWN_MS = 60_000 // 60s between triggers per wallet
const MIN_SEND_SATS = 10   // Don't send dust

// Module-level lock — not in Pinia state, avoids reactivity issues
const _activeWithdrawals = new Set()
// Cooldown timestamps — walletId → last trigger time
const _lastTriggerTime = new Map()

export const useAutoWithdrawStore = defineStore('autoWithdraw', {
  state: () => ({
    // walletId → { enabled, thresholdSats, payoutType, lightningAddress, bitcoinAddress, feeSpeed, lastTriggeredAt }
    configs: {},
    // Last result for UI toasts — { type: 'success'|'error', message, destination, amount }
    lastResult: null
  }),

  getters: {
    getConfig: (state) => (walletId) => {
      return state.configs[walletId] || null
    },

    hasConfig: (state) => (walletId) => {
      return !!state.configs[walletId]
    },

    enabledConfigs: (state) => {
      return Object.entries(state.configs)
        .filter(([, config]) => config.enabled)
        .map(([walletId, config]) => ({ walletId, ...config }))
    },

    isProcessing: () => (walletId) => {
      return _activeWithdrawals.has(walletId)
    }
  },

  actions: {
    async initialize() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
          const parsed = JSON.parse(saved)
          this.configs = parsed.configs || {}
        }
      } catch (error) {
        console.error('[Auto-withdraw] Init error:', error)
        this.configs = {}
      }
    },

    async saveConfig(walletId, config) {
      this.configs[walletId] = {
        enabled: config.enabled ?? false,
        thresholdSats: Number(config.thresholdSats) || 0,
        payoutType: config.payoutType ?? 'lightning',
        lightningAddress: config.lightningAddress ?? '',
        bitcoinAddress: config.bitcoinAddress ?? '',
        sparkAddress: config.sparkAddress ?? '',
        feeSpeed: config.feeSpeed ?? 'medium',
        lastTriggeredAt: config.lastTriggeredAt ?? null
      }
      await this.persistConfigs()
    },

    async removeConfig(walletId) {
      delete this.configs[walletId]
      _activeWithdrawals.delete(walletId)
      _lastTriggerTime.delete(walletId)
      await this.persistConfigs()
    },

    async clearAll() {
      this.configs = {}
      _activeWithdrawals.clear()
      _lastTriggerTime.clear()
      localStorage.removeItem(STORAGE_KEY)
    },

    async persistConfigs() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          configs: this.configs
        }))
      } catch (error) {
        console.error('[Auto-withdraw] Persist error:', error)
      }
    },

    /**
     * Check if auto-withdraw should trigger and execute it.
     * Called after every balance update.
     */
    async checkAndExecute(configKey, balanceSats, walletStore) {
      const config = this.configs[configKey]
      if (!config?.enabled) return

      const threshold = Number(config.thresholdSats)
      if (!threshold || threshold <= 0) return

      const balance = Number(balanceSats)
      if (balance <= threshold) return

      // Lock guard — prevent concurrent execution for same config
      if (_activeWithdrawals.has(configKey)) return

      // Cooldown guard — prevent rapid re-triggers
      const lastTrigger = _lastTriggerTime.get(configKey) || 0
      if (Date.now() - lastTrigger < COOLDOWN_MS) return

      // Lock + set cooldown immediately (before any await)
      _activeWithdrawals.add(configKey)
      _lastTriggerTime.set(configKey, Date.now())

      // Resolve base walletId from composite key (e.g. 'walletId:2' → 'walletId')
      const baseWalletId = configKey.includes(':') ? configKey.split(':').slice(0, -1).join(':') : configKey

      try {
        const wallet = walletStore.wallets.find(w => w.id === baseWalletId)
        if (!wallet) return

        const sendAmount = Math.floor(balance * 0.97)
        if (sendAmount < MIN_SEND_SATS) return

        const walletType = wallet.type?.toLowerCase() || 'nwc'
        let result = null
        let destination = ''

        if (walletType === WALLET_TYPES.SPARK) {
          result = await this._executeSparkPayout(configKey, sendAmount, config, walletStore)
          if (config.payoutType === 'spark') destination = config.sparkAddress
          else if (config.payoutType === 'onchain') destination = config.bitcoinAddress
          else destination = config.lightningAddress
        } else {
          result = await this._executeLightningPayout(configKey, sendAmount, config, walletStore, walletType)
          destination = config.lightningAddress
        }

        // Tag the transaction
        if (result?.id) {
          const metaStore = useTransactionMetadataStore()
          const feeLabel = config.payoutType === 'onchain' ? ` (${SPEED_LABELS[config.feeSpeed] || 'Standard'} fee)` : ''
          const note = `Automatic transfer \u00b7 ${sendAmount.toLocaleString()} sats sent to ${this._truncateDestination(destination)}${feeLabel}`

          try {
            await metaStore.addTagToTransaction(result.id, 'auto-withdraw')
            await metaStore.setNoteForTransaction(result.id, note)
          } catch {
            // Non-critical — tagging failure doesn't affect the transfer
          }
        }

        // Persist last triggered timestamp
        this.configs[configKey].lastTriggeredAt = Date.now()
        await this.persistConfigs()

        // Notify UI — success
        this.lastResult = {
          type: 'success',
          amount: sendAmount,
          destination: this._truncateDestination(destination),
          walletName: wallet.name
        }
      } catch (error) {
        console.error('[Auto-withdraw] Failed:', error.message)

        // Notify UI — error
        const baseId = configKey.includes(':') ? configKey.split(':').slice(0, -1).join(':') : configKey
        this.lastResult = {
          type: 'error',
          // The store has no $t (Pinia stores run outside the Vue component
          // tree); the utility falls back to its English keys, which the UI
          // layer can re-translate if it ever surfaces this message.
          message: getUserFriendlyErrorMessage(error, 'withdraw'),
          walletName: walletStore.wallets.find(w => w.id === baseId)?.name || 'Wallet'
        }
      } finally {
        _activeWithdrawals.delete(configKey)
      }
    },

    /**
     * Execute payout from Spark wallet (lightning or on-chain)
     * @param {string} configKey - walletId or walletId:accountNumber for pockets
     */
    async _executeSparkPayout(configKey, sendAmount, config, walletStore) {
      // For composite keys (pockets), get provider directly; for plain walletIds, use getProvider
      const provider = configKey.includes(':')
        ? walletStore.providers[configKey]
        : walletStore.getProvider(configKey)
      if (!provider) throw new Error('Wallet provider not available')

      if (config.payoutType === 'spark') {
        if (!config.sparkAddress) throw new Error('No Spark address configured')

        const result = await provider.transferToSparkAddress(config.sparkAddress, sendAmount)
        return { id: result.id, status: result.status }
      } else if (config.payoutType === 'onchain') {
        if (!config.bitcoinAddress) throw new Error('No Bitcoin address configured')

        const feeQuote = await provider.getWithdrawalFeeQuote(sendAmount, config.bitcoinAddress)
        const quoteKey = FEE_SPEED_TO_QUOTE_KEY[config.feeSpeed] || 'medium'
        const quote = feeQuote[quoteKey] || feeQuote.medium

        const result = await provider.withdrawToL1({
          amountSats: sendAmount,
          destinationAddress: config.bitcoinAddress,
          speed: quoteKey,
          feeQuoteId: quote.feeQuoteId,
          feeAmountSats: quote.totalFee,
          deductFeeFromWithdrawalAmount: false
        })

        return { id: result.requestId, status: result.status }
      } else {
        if (!config.lightningAddress) throw new Error('No Lightning address configured')

        const result = await provider.payLightningAddress(config.lightningAddress, sendAmount)
        return { id: result.id, status: result.status }
      }
    },

    /**
     * Execute lightning address payout from NWC or LNBits wallet
     */
    async _executeLightningPayout(walletId, sendAmount, config, walletStore, walletType) {
      if (!config.lightningAddress) throw new Error('No Lightning address configured')

      // Resolve lightning address
      const ln = new LightningAddress(config.lightningAddress)
      await ln.fetch()
      const lnurlpData = ln.lnurlpData
      if (!lnurlpData?.callback) throw new Error('Could not resolve Lightning address')

      // Request invoice
      const amountMs = sendAmount * 1000
      const separator = lnurlpData.callback.includes('?') ? '&' : '?'
      const callbackUrl = `${lnurlpData.callback}${separator}amount=${amountMs}`
      const invoiceResponse = await fetch(callbackUrl)

      if (!invoiceResponse.ok) {
        throw new Error('Failed to get invoice from Lightning address')
      }

      const invoiceData = await invoiceResponse.json()
      if (invoiceData.status === 'ERROR') {
        throw new Error(invoiceData.reason || 'Invoice request failed')
      }

      const invoice = invoiceData.pr
      if (!invoice) throw new Error('No invoice returned')

      // Pay via wallet-specific provider
      if (walletType === WALLET_TYPES.LNBITS) {
        const provider = walletStore.getProvider(walletId)
        if (!provider) throw new Error('LNBits provider not available')
        const result = await provider.payInvoice({ invoice })
        return { id: result.payment_hash || result.id || null, status: 'completed' }
      } else {
        const nwc = walletStore.connectionStates[walletId]?.nwcInstance
        if (!nwc) throw new Error('NWC not connected')
        const result = await nwc.sendPayment(invoice)
        return { id: result.payment_hash || result.paymentHash || result.preimage || null, status: 'completed' }
      }
    },

    _truncateDestination(dest) {
      if (!dest) return 'unknown'
      if (dest.includes('@')) return dest
      if (dest.length > 20) return `${dest.slice(0, 8)}...${dest.slice(-6)}`
      return dest
    }
  }
})
