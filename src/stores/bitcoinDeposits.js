import { defineStore } from 'pinia';
import { useWalletStore } from './wallet';
import { useBitcoinPreferencesStore, BITCOIN_DEPOSIT_POLL_MS, CLASSIFICATION_FRESHNESS_MS, AUTO_CLAIM_THRESHOLDS } from './bitcoinPreferences';
import { classifyFromMatureQuote } from '../utils/breezPayments.js';
import { track } from '../utils/telemetry';

const keyFor = (walletId, deposit) => `${walletId}:${deposit.txId}:${deposit.outputIndex || 0}`;

/** Shared by home, Receive and History. Unknown fees never authorize a
 * manual action or an automatic claim. Temporary failures retry on polling. */
export const useBitcoinDepositsStore = defineStore('bitcoinDeposits', {
  state: () => ({ entries: {} }),
  actions: {
    status(deposit, walletId = useWalletStore().activeWalletId) {
      if (!deposit) return 'confirming';
      const wallet = useWalletStore();
      if (wallet.isDepositClaimed(deposit.txId)) return 'accepted';
      if (wallet.isDepositClaimInFlight(deposit.txId)) return 'claiming';
      if (!deposit.confirmed) return 'confirming';
      if (!useBitcoinPreferencesStore().autoAddIncomingBitcoin) return 'manual';
      return this.entries[keyFor(walletId, deposit)]?.phase || 'checking';
    },

    needsManual(deposit, walletId) {
      return this.status(deposit, walletId) === 'manual';
    },

    statusText(deposit, walletId) {
      const status = this.status(deposit, walletId);
      if (status === 'manual') return 'Ready to claim';
      if (status === 'claiming') return 'Adding';
      if (status === 'retrying') return 'Retrying';
      return 'Incoming';
    },

    // A manually opened sheet fetches a fresh quote. If fees have fallen
    // back inside the limits, return to automatic handling immediately.
    reconsiderQuote(deposit, quote, walletId = useWalletStore().activeWalletId) {
      if (!useBitcoinPreferencesStore().autoAddIncomingBitcoin || deposit.amount < AUTO_CLAIM_THRESHOLDS.MIN_DEPOSIT_SATS) return;
      const { category } = classifyFromMatureQuote({ depositAmountSats: deposit.amount, quote, thresholds: AUTO_CLAIM_THRESHOLDS });
      if (category === 'eligible' && this.needsManual(deposit, walletId)) {
        delete this.entries[keyFor(walletId, deposit)];
        void this.processDeposit(deposit, walletId);
      }
    },

    async processDeposits(deposits, walletId = useWalletStore().activeWalletId) {
      const live = new Set(deposits.map(deposit => keyFor(walletId, deposit)));
      for (const [key, entry] of Object.entries(this.entries)) {
        if (entry.walletId === walletId && !live.has(key) && !['checking', 'claiming'].includes(entry.phase)) {
          delete this.entries[key];
        }
      }
      await Promise.all(deposits.filter(deposit => deposit.confirmed).map(deposit => this.processDeposit(deposit, walletId)));
    },

    async processDeposit(deposit, walletId) {
      const wallet = useWalletStore();
      const prefs = useBitcoinPreferencesStore();
      if (!walletId || wallet.activeWalletId !== walletId || !deposit.confirmed
        || wallet.isDepositClaimed(deposit.txId) || wallet.isDepositClaimInFlight(deposit.txId)) return;
      const key = keyFor(walletId, deposit);
      const previous = this.entries[key];
      if (previous && (['checking', 'claiming'].includes(previous.phase) || previous.retryAt > Date.now())) return;
      if (!prefs.autoAddIncomingBitcoin) return;

      const current = () => wallet.activeWalletId === walletId && !wallet.isDepositClaimed(deposit.txId);
      // Set before the first await: concurrent polls cannot classify/claim twice.
      this.entries[key] = { walletId, phase: 'checking' };
      let ownsClaim = false;
      try {
        const provider = await wallet.ensureSparkConnected();
        if (!current()) return;
        let classification = await provider.classifyConfirmedDeposit(deposit);
        if (!current()) return;
        if (!prefs.autoAddIncomingBitcoin) return;

        // A slow request can outlive its quote. Reclassify the new quote too:
        // retaining an old "eligible" decision could exceed the user's limits.
        if (Date.now() - classification.classifiedAt > CLASSIFICATION_FRESHNESS_MS) {
          classification = await provider.classifyConfirmedDeposit(deposit);
          if (!current() || !prefs.autoAddIncomingBitcoin) return;
        }
        if (['needs_approval', 'too_small'].includes(classification.category)) {
          this.entries[key] = { walletId, phase: 'manual', retryAt: Date.now() + BITCOIN_DEPOSIT_POLL_MS };
          return;
        }
        if (classification.category !== 'eligible' || !classification.quote
          || !Number.isFinite(classification.classifiedAt)
          || Date.now() - classification.classifiedAt > CLASSIFICATION_FRESHNESS_MS) {
          throw new Error('Deposit fee quote unavailable');
        }
        if (wallet.isDepositClaimInFlight(deposit.txId)) return;
        wallet.markDepositClaimInFlight(deposit.txId);
        ownsClaim = true;
        this.entries[key] = { walletId, phase: 'claiming' };
        const result = await provider.claimDeposit(deposit.txId, classification.quote, deposit.outputIndex || 0);
        wallet.markDepositClaimed(deposit.txId);
        this.entries[key] = { walletId, phase: 'accepted' };
        track('bitcoin.deposit.claim_succeeded', {
          source: 'auto', processing: !!result?.processing,
          amount_sats: Number(result?.amount ?? classification.quote.creditAmountSats),
          fee_sats: classification.feeSats,
        });
        wallet.signalDepositsRefresh(walletId);
      } catch (error) {
        if (current()) {
          this.entries[key] = { walletId, phase: 'retrying', retryAt: Date.now() + BITCOIN_DEPOSIT_POLL_MS };
          console.warn('Bitcoin deposit will retry automatically:', error?.message || error);
        }
      } finally {
        if (ownsClaim) wallet.clearDepositClaimInFlight(deposit.txId);
        // A wallet/preference switch must not leave a permanent busy entry.
        if (['checking', 'claiming'].includes(this.entries[key]?.phase)) delete this.entries[key];
      }
    },
  },
});
