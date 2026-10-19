/**
 * Auto-Transfer: rules that move money out of a wallet once it holds more
 * than an amount. The rule itself (its shape, routes, amounts, destination
 * checks, status) lives in utils/autoTransfer.js; this store keeps the
 * rules, runs them on every network-verified balance (wallet store,
 * applyBalance) and records what happened.
 *
 * Rules run while the app runs: there is no background service. A rule
 * that could not run while the app was closed runs on the first verified
 * balance after it opens again.
 */
import { defineStore } from 'pinia'
import { useTransactionMetadataStore } from './transactionMetadata'
import { WALLET_TYPES } from '../providers/WalletFactory'
import { lnurlGetJson } from '../utils/lnurlHttp.js'
import { counterpartyError } from '../utils/errorOrigin.js'
import { migratePocketConfigKeys } from '../utils/autoWithdrawKeys.js'
import { payWithNwc } from '../services/nwcPayment.js'
import { NWC_ERROR } from '../utils/nwcErrors.js'
import { fiatRatesService } from '../utils/fiatRates.js'
import {
  DESTINATION_KIND,
  MAX_RATE_AGE_MINUTES,
  OUTCOME,
  PAUSED,
  PAUSE_AFTER_FAILURES,
  ROUTE,
  addEvent,
  amountSats,
  destinationName,
  destinationProblem,
  failureReason,
  normalizeRule,
  routeFor,
  ruleStatus,
  transferAmount,
} from '../utils/autoTransfer.js'

const STORAGE_KEY = 'buhoGO_auto_withdraw'
// Rules save the on-chain speed as low/medium/high; the Spark fee quote is
// keyed slow/medium/fast.
const FEE_SPEED_TO_QUOTE_KEY = { low: 'slow', medium: 'medium', high: 'fast' }
const COOLDOWN_MS = 60_000 // between transfers of one rule
// A failure retries sooner than the success cooldown: most are blips (a
// dropped connection, an address that did not answer once).
const FAILURE_RETRY_MS = 15_000
// A payment whose outcome is unknown (services/nwcPayment) may have gone
// out. Retrying would pay again, so the rule rests long enough for the
// balance to show what happened.
const UNCONFIRMED_HOLD_MS = 10 * 60_000

// Outside Pinia state on purpose: bookkeeping, not something to render.
const _running = new Set()
const _lastTriggerTime = new Map()

export const useAutoWithdrawStore = defineStore('autoWithdraw', {
  state: () => ({
    // walletId → rule (utils/autoTransfer.js normalizeRule)
    configs: {},
    // The newest transfer, for Home's toast: { walletId, amount, destinationName }
    lastResult: null,
  }),

  getters: {
    getConfig: (state) => (walletId) => state.configs[walletId] || null,

    /** Rules that need the person, oldest wallet first: Home shows the first. */
    needingAttention: (state) => Object.entries(state.configs)
      .map(([walletId, rule]) => ({ walletId, rule, status: ruleStatus(rule) }))
      .filter((entry) => entry.status.kind === 'attention'),
  },

  actions: {
    /**
     * Load the saved rules in today's shape. With the device's wallets,
     * rules saved for a former Spark "pocket" move to the wallet that holds
     * that account now (utils/autoWithdrawKeys.js).
     */
    async initialize({ wallets = null } = {}) {
      let raw = {}
      try {
        raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').configs || {}
      } catch (error) {
        console.error('[Auto-Transfer] Could not read the saved rules:', error)
      }
      let changed = false
      if (wallets) {
        const { configs, moved, dropped } = migratePocketConfigKeys(raw, wallets)
        if (moved.length || dropped.length) {
          raw = configs
          changed = true
          if (dropped.length) console.warn(`[Auto-Transfer] ${dropped.length} rule(s) for removed accounts dropped`)
        }
      }
      const configs = {}
      for (const [walletId, rule] of Object.entries(raw)) {
        configs[walletId] = normalizeRule(rule)
        if (!rule.destination || rule.payoutType !== undefined) changed = true
      }
      this.configs = configs
      if (changed) this.persistConfigs()
    },

    /**
     * Create or change a wallet's rule and switch it on. Recent activity
     * stays; a pause the app made is lifted, since the person just looked.
     */
    async saveRule(walletId, { threshold, keep = null, destination, feeSpeed = 'medium' }) {
      const previous = this.configs[walletId]
      this.configs[walletId] = normalizeRule({
        ...previous,
        threshold,
        keep,
        destination,
        feeSpeed,
        enabled: true,
        pausedReason: null,
        failureStreak: 0,
      })
      _lastTriggerTime.delete(walletId)
      await this.persistConfigs()
    },

    /** The switch on the rule's page: takes effect at once. */
    async setEnabled(walletId, enabled) {
      const rule = this.configs[walletId]
      if (!rule) return
      this.configs[walletId] = { ...rule, enabled, pausedReason: null, failureStreak: enabled ? 0 : rule.failureStreak }
      if (enabled) _lastTriggerTime.delete(walletId)
      await this.persistConfigs()
    },

    async removeConfig(walletId) {
      delete this.configs[walletId]
      _running.delete(walletId)
      _lastTriggerTime.delete(walletId)
      await this.persistConfigs()
    },

    /**
     * A wallet left this phone: its own rule goes, and rules that sent to
     * it pause and say why, rather than failing at every balance tick.
     */
    async forgetWallet(walletId) {
      delete this.configs[walletId]
      _running.delete(walletId)
      _lastTriggerTime.delete(walletId)
      for (const [id, rule] of Object.entries(this.configs)) {
        if (rule.destination?.kind === DESTINATION_KIND.WALLET && rule.destination.walletId === walletId) {
          this.configs[id] = { ...rule, enabled: false, pausedReason: PAUSED.DESTINATION_REMOVED }
        }
      }
      await this.persistConfigs()
    },

    async clearAll() {
      this.configs = {}
      this.lastResult = null
      _running.clear()
      _lastTriggerTime.clear()
      localStorage.removeItem(STORAGE_KEY)
    },

    async persistConfigs() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ configs: this.configs }))
      } catch (error) {
        console.error('[Auto-Transfer] Could not save the rules:', error)
      }
    },

    /**
     * "Try Again": run the rule now on the wallet's current balance, past
     * its cooldown. A rule paused after failures is switched back on first.
     */
    async tryNow(walletId, walletStore) {
      const rule = this.configs[walletId]
      if (!rule) return
      if (!rule.enabled) await this.setEnabled(walletId, true)
      _lastTriggerTime.delete(walletId)
      const balance = walletStore.getDisplayBalance?.(walletId)?.balance ?? walletStore.balances?.[walletId] ?? 0
      await this.checkAndExecute(walletId, balance, walletStore)
    },

    /**
     * Run a wallet's rule on a balance the network just confirmed. Called
     * after every accepted fresh balance; most calls end at the threshold.
     */
    async checkAndExecute(walletId, balanceSats, walletStore) {
      const rule = this.configs[walletId]
      if (!rule?.enabled || !rule.threshold || !rule.destination) return
      const balance = Number(balanceSats)
      if (!Number.isFinite(balance) || balance <= 0) return
      // A sats threshold can be checked before anything else; a fiat one
      // needs the rate, read below once the rule has a reason to run.
      if (rule.threshold.sats != null && balance <= rule.threshold.sats) return
      if (_running.has(walletId)) return
      if (Date.now() - (_lastTriggerTime.get(walletId) || 0) < COOLDOWN_MS) return

      _running.add(walletId)
      let amount = 0
      try {
        const wallet = walletStore.wallets.find((w) => w.id === walletId)
        if (!wallet) return
        const walletType = (wallet.type || WALLET_TYPES.NWC).toLowerCase()

        const rates = await this._ratesFor(rule)
        if (this.configs[walletId] !== rule) return
        const thresholdSats = amountSats(rule.threshold, rates)
        const keepSats = amountSats(rule.keep, rates)
        if (thresholdSats == null || keepSats == null) {
          this._skip(walletId, 'no_rate')
          return
        }
        if (balance <= thresholdSats) return

        // A Spark figure handed in may be a cached read. Money moves only on
        // a balance the network just confirmed: re-read it fresh.
        let verified = balance
        if (walletType === WALLET_TYPES.SPARK) {
          const provider = walletStore.providers?.[walletId]
          if (typeof provider?.getBalance !== 'function') return
          const epoch = walletStore.walletEpoch?.(walletId)
          let fresh
          try {
            fresh = await provider.getBalance({ requireFresh: true })
          } catch (error) {
            console.warn('[Auto-Transfer] Skipped: the balance could not be checked:', error?.message || error)
            _lastTriggerTime.set(walletId, Date.now() - COOLDOWN_MS + FAILURE_RETRY_MS)
            this._skip(walletId, 'balance_unverified')
            return
          }
          // The read can take seconds: the rule may have changed, the wallet
          // left or its connection been rebuilt meanwhile.
          if (this.configs[walletId] !== rule || !walletStore.wallets.includes(wallet)
            || walletStore.walletEpoch?.(walletId) !== epoch
            || walletStore.providers?.[walletId] !== provider) return
          verified = Number(fresh?.balance)
          if (!Number.isFinite(verified) || verified <= thresholdSats) return
        }

        const problem = destinationProblem({ source: wallet, destination: rule.destination, wallets: walletStore.wallets, rules: this.configs })
        if (problem) {
          this._skip(walletId, problem)
          return
        }
        const target = rule.destination.kind === DESTINATION_KIND.WALLET
          ? walletStore.wallets.find((w) => w.id === rule.destination.walletId)
          : null
        const route = routeFor(walletType, rule.destination, target)

        let quote = null
        if (route === ROUTE.BITCOIN) quote = await this._bitcoinQuote(walletStore, walletId, rule, verified - keepSats)
        amount = transferAmount({ balanceSats: verified, thresholdSats, keepSats, route, feeSats: quote?.totalFee ?? null })
        if (!amount) {
          this._skip(walletId, 'below_minimum')
          return
        }
        if (this.configs[walletId] !== rule || !rule.enabled) return
        // From here money moves: the cooldown starts now, not on every
        // check, so a rule just below its threshold still runs on the next
        // balance that passes it.
        _lastTriggerTime.set(walletId, Date.now())

        const name = destinationName(rule.destination, walletStore.wallets)
        const result = target
          ? await walletStore.transferBetweenWallets(walletId, target.id, amount, '', { source: 'auto-transfer', label: name })
          : await this._sendToAddress(walletStore, wallet, walletType, rule, amount, quote)
        const txId = target ? result?.transactionId : result?.id
        await this._stampTransaction(txId, walletId, name)

        this._record(walletId, { at: Date.now(), outcome: OUTCOME.SENT, amount, txId: txId || null }, { success: true })
        this.lastResult = { walletId, amount, destinationName: name }
      } catch (error) {
        console.error('[Auto-Transfer] Failed:', error?.message || error)
        const holdMs = error?.code === NWC_ERROR.UNCONFIRMED ? UNCONFIRMED_HOLD_MS : FAILURE_RETRY_MS
        _lastTriggerTime.set(walletId, Date.now() - COOLDOWN_MS + holdMs)
        this._record(walletId, { at: Date.now(), outcome: OUTCOME.FAILED, amount, reason: failureReason(error) })
      } finally {
        _running.delete(walletId)
      }
    },

    /**
     * Fiat per bitcoin for the rule's currencies, as a lookup. A rule in
     * sats needs none; a rate older than an hour counts as none, so a fiat
     * amount waits rather than converting at an old price.
     */
    async _ratesFor(rule) {
      const needed = [rule.threshold, rule.keep].some((amount) => amount?.fiat != null)
      if (!needed) return () => 0
      let rates = null
      try {
        rates = await fiatRatesService.getRates()
      } catch { /* treated as no rate */ }
      const age = fiatRatesService.getRateAge()
      const usable = rates && fiatRatesService.areRatesAvailable() && age != null && age <= MAX_RATE_AGE_MINUTES
      return (currency) => (usable ? Number(rates[currency]) || 0 : 0)
    },

    /**
     * The on-chain fee at the rule's speed. Quoting is a real prepare, which
     * refuses an amount that leaves nothing for the fee, so half of what is
     * available is quoted; the fee depends on the transaction, not the
     * amount. The withdrawal then includes its fee (see _sendToAddress).
     */
    async _bitcoinQuote(walletStore, walletId, rule, availableSats) {
      const provider = walletStore.getProvider(walletId)
      if (!provider?.getWithdrawalFeeQuote) throw new Error('Wallet provider not available')
      const tiers = await provider.getWithdrawalFeeQuote(Math.max(1, Math.floor(availableSats / 2)), rule.destination.address)
      const key = FEE_SPEED_TO_QUOTE_KEY[rule.feeSpeed] || 'medium'
      const quote = tiers[key] || tiers.medium
      return { ...quote, speed: key }
    },

    async _sendToAddress(walletStore, wallet, walletType, rule, amount, quote) {
      const { kind, address } = rule.destination
      if (walletType === WALLET_TYPES.SPARK) {
        const provider = walletStore.getProvider(wallet.id)
        if (!provider) throw new Error('Wallet provider not available')
        if (kind === DESTINATION_KIND.SPARK) return provider.transferToSparkAddress(address, amount)
        if (kind === DESTINATION_KIND.BITCOIN) {
          // `amount` is what arrives; the fee comes out of the withdrawal,
          // and is refused if it rose above the quote.
          const result = await provider.withdrawToL1({
            amountSats: amount + quote.totalFee,
            destinationAddress: address,
            speed: quote.speed,
            feeQuoteId: quote.feeQuoteId,
            feeAmountSats: quote.totalFee,
            deductFeeFromWithdrawalAmount: true,
          })
          return { id: result.requestId }
        }
        return provider.payLightningAddress(address, amount)
      }
      if (walletType === WALLET_TYPES.ARKADE) {
        const provider = await walletStore.ensureArkadeConnected(wallet.id)
        return provider.transferToArkadeAddress({ arkadeAddress: address, amount })
      }
      return this._payLightningAddress(walletStore, wallet.id, walletType, address, amount)
    },

    /** A Lightning address paid from an NWC or LNbits wallet. */
    async _payLightningAddress(walletStore, walletId, walletType, address, amount) {
      const [username, domain] = address.split('@')
      if (!username || !domain) throw new Error('Could not resolve Lightning address')
      const meta = await lnurlGetJson(`https://${domain}/.well-known/lnurlp/${username}`)
      const pay = meta.ok ? meta.data : null
      if (!pay?.callback || pay.tag !== 'payRequest' || pay.status === 'ERROR') {
        throw new Error('Could not resolve Lightning address')
      }
      const separator = pay.callback.includes('?') ? '&' : '?'
      const invoiceResponse = await lnurlGetJson(`${pay.callback}${separator}amount=${amount * 1000}`)
      if (!invoiceResponse.ok) throw new Error('Failed to get invoice from Lightning address')
      const invoiceData = invoiceResponse.data || {}
      if (invoiceData.status === 'ERROR') throw counterpartyError(invoiceData.reason, 'Invoice request failed')
      // A LUD-09 successAction is ignored: nobody is there to read it.
      const invoice = invoiceData.pr
      if (!invoice) throw new Error('No invoice returned')

      if (walletType === WALLET_TYPES.LNBITS) {
        // ensureLNBitsConnected heals a connection a 401 marked as lost.
        const provider = await walletStore.ensureLNBitsConnected(walletId)
        const result = await provider.payInvoice({ invoice })
        return { id: result.payment_hash || result.id || null }
      }
      // The wallet's one connection, rebuilt if it was dropped (#395).
      const nwc = await walletStore.nwcConnection(walletId)
      const result = await payWithNwc(nwc, invoice, { limit: walletStore.nwcLimitFor(walletId) })
      return { id: result.payment_hash || result.paymentHash || result.preimage || null }
    },

    /** History names the row after the destination ("To Savings") by this source. */
    async _stampTransaction(txId, walletId, name) {
      if (!txId) return
      try {
        const meta = useTransactionMetadataStore()
        await meta.addTagToTransaction(txId, walletId, 'auto-withdraw')
        await meta.setSourceForTransaction(txId, walletId, 'auto-transfer')
        await meta.setLabelForTransaction(txId, walletId, name)
      } catch {
        // History falls back to "Auto-Transfer"; the money moved either way.
      }
    },

    _skip(walletId, reason) {
      this._record(walletId, { at: Date.now(), outcome: OUTCOME.SKIPPED, reason })
    },

    /**
     * Add an event to the wallet's rule as it is now (it may have been
     * edited while the transfer ran). Failures in a row pause the rule.
     */
    _record(walletId, event, { success = false } = {}) {
      const rule = this.configs[walletId]
      if (!rule) return
      const next = { ...rule, events: addEvent(rule.events, event) }
      if (success) {
        next.failureStreak = 0
        next.lastTriggeredAt = event.at
      } else if (event.outcome === OUTCOME.FAILED) {
        next.failureStreak = (rule.failureStreak || 0) + 1
        if (next.failureStreak >= PAUSE_AFTER_FAILURES) {
          next.enabled = false
          next.pausedReason = PAUSED.FAILURES
        }
      }
      this.configs[walletId] = next
      this.persistConfigs()
    },
  },
})
