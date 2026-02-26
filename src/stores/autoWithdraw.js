import { defineStore } from 'pinia'
import { useTransactionMetadataStore } from './transactionMetadata'
import { WALLET_TYPES } from '../providers/WalletFactory'
import { LightningAddress } from '@getalby/lightning-tools'

const STORAGE_KEY = 'buhoGO_auto_withdraw'
const SPEED_MAP = { low: 'SLOW', medium: 'MEDIUM', high: 'FAST' }
const SPEED_LABELS = { low: 'Economy', medium: 'Standard', high: 'Priority' }
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
    async checkAndExecute(walletId, balanceSats, walletStore) {
      const config = this.configs[walletId]
      if (!config?.enabled) return

      const threshold = Number(config.thresholdSats)
      if (!threshold || threshold <= 0) return

      const balance = Number(balanceSats)
      if (balance <= threshold) return

      // Lock guard — prevent concurrent execution for same wallet
      if (_activeWithdrawals.has(walletId)) return

      // Cooldown guard — prevent rapid re-triggers
      const lastTrigger = _lastTriggerTime.get(walletId) || 0
      if (Date.now() - lastTrigger < COOLDOWN_MS) return

      // Lock + set cooldown immediately (before any await)
      _activeWithdrawals.add(walletId)
      _lastTriggerTime.set(walletId, Date.now())

      try {
        const wallet = walletStore.wallets.find(w => w.id === walletId)
        if (!wallet) return

        const sendAmount = Math.floor(balance * 0.97)
        if (sendAmount < MIN_SEND_SATS) return

        const walletType = wallet.type?.toLowerCase() || 'nwc'
        let result = null
        let destination = ''

        if (walletType === WALLET_TYPES.SPARK) {
          result = await this._executeSparkPayout(walletId, sendAmount, config, walletStore)
          destination = config.payoutType === 'onchain'
            ? config.bitcoinAddress
            : config.lightningAddress
        } else {
          result = await this._executeLightningPayout(walletId, sendAmount, config, walletStore, walletType)
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
        this.configs[walletId].lastTriggeredAt = Date.now()
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
        this.lastResult = {
          type: 'error',
          message: error.message,
          walletName: walletStore.wallets.find(w => w.id === walletId)?.name || 'Wallet'
        }
      } finally {
        _activeWithdrawals.delete(walletId)
      }
    },

    /**
     * Execute payout from Spark wallet (lightning or on-chain)
     */
    async _executeSparkPayout(walletId, sendAmount, config, walletStore) {
      const provider = walletStore.providers[walletId]
      if (!provider) throw new Error('Wallet provider not available')

      if (config.payoutType === 'onchain') {
        if (!config.bitcoinAddress) throw new Error('No Bitcoin address configured')

        const feeQuote = await provider.getWithdrawalFeeQuote(sendAmount, config.bitcoinAddress)
        const speedKey = config.feeSpeed || 'medium'
        const quote = feeQuote[speedKey] || feeQuote.medium
        const sparkSpeed = SPEED_MAP[speedKey] || 'MEDIUM'

        const result = await provider.withdrawToL1({
          amountSats: sendAmount,
          destinationAddress: config.bitcoinAddress,
          speed: sparkSpeed,
          feeQuoteId: quote.feeQuoteId
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
        const provider = walletStore.providers[walletId]
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
