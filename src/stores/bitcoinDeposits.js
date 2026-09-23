import { defineStore } from 'pinia';
import { useWalletStore } from './wallet';
import { useBitcoinPreferencesStore, BITCOIN_DEPOSIT_POLL_MS, CLASSIFICATION_FRESHNESS_MS, AUTO_CLAIM_THRESHOLDS } from './bitcoinPreferences';
import { classifyFromMatureQuote } from '../utils/breezPayments.js';
import { track } from '../utils/telemetry';

const keyFor = (walletId, deposit) => `${walletId}:${deposit.txId}:${deposit.outputIndex || 0}`;

/** Shared by home, Receive, History and the app-wide Spark lifecycle.
 * Unknown fees never authorize a manual action or an automatic claim.
 * Temporary failures retry on polling.
 *
 * Every deposit belongs to the wallet whose address received it, and is
 * processed for THAT wallet whether or not it is the selected one: the user
 * switching accounts or pages must not abandon a valid claim, nor route it
 * through another wallet's provider. What does invalidate work is the
 * wallet itself going away or being rebuilt (its epoch changes), the
 * output being claimed elsewhere, or the user turning auto-add off. */
export const useBitcoinDepositsStore = defineStore('bitcoinDeposits', {
  state: () => ({
    entries: {},
    // walletId -> unclaimed deposits last discovered for that wallet. The
    // lifecycle fills it for every live Spark wallet; screens read it.
    pendingByWallet: {},
  }),
  actions: {
    status(deposit, walletId = useWalletStore().activeWalletId) {
      if (!deposit) return 'confirming';
      const wallet = useWalletStore();
      const vout = deposit.outputIndex || 0;
      if (wallet.isDepositClaimed(deposit.txId, vout)) return 'accepted';
      if (wallet.isDepositClaimInFlight(deposit.txId, vout)) return 'claiming';
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

    /**
     * Discover a wallet's pending deposits and process the confirmed ones.
     * Resolves the provider by explicit wallet id. Returns the unclaimed
     * list (also published in pendingByWallet), or null when the wallet
     * could not be asked — callers keep what they had.
     */
    async discover(walletId) {
      const wallet = useWalletStore();
      if (!walletId) return null;
      const epoch = wallet.walletEpoch?.(walletId);
      let provider;
      try {
        provider = await wallet.ensureSparkConnected(walletId);
      } catch {
        return null;
      }
      if (!provider?.getPendingDeposits) return null;
      const deposits = await provider.getPendingDeposits();
      if (epoch !== wallet.walletEpoch?.(walletId) || !wallet.wallets?.some(w => w.id === walletId)) return null;
      // An instantly-claimed deposit keeps showing in the SDK's pending
      // list until its confirmations catch up. Filter it everywhere so no
      // banner, chip, or handler ever acts on an output we already swept.
      const unclaimed = deposits.filter(d => !wallet.isDepositClaimed(d.txId, d.outputIndex || 0));
      this.pendingByWallet[walletId] = unclaimed;
      void this.processDeposits(unclaimed, walletId);
      return unclaimed;
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
      const vout = deposit.outputIndex || 0;
      const owned = () => (wallet.wallets ? wallet.wallets.some(w => w.id === walletId) : true);
      if (!walletId || !owned() || !deposit.confirmed
        || wallet.isDepositClaimed(deposit.txId, vout) || wallet.isDepositClaimInFlight(deposit.txId, vout)) return;
      const key = keyFor(walletId, deposit);
      const previous = this.entries[key];
      if (previous && (['checking', 'claiming'].includes(previous.phase) || previous.retryAt > Date.now())) return;
      if (!prefs.autoAddIncomingBitcoin) return;

      // The wallet's lifetime, not the selection, bounds this work: removal,
      // teardown or a rebuild bumps the epoch and abandons it.
      const epoch = wallet.walletEpoch?.(walletId);
      const current = () => owned()
        && wallet.walletEpoch?.(walletId) === epoch
        && !wallet.isDepositClaimed(deposit.txId, vout);
      // Set before the first await: concurrent polls cannot classify/claim twice.
      this.entries[key] = { walletId, phase: 'checking' };
      let ownsClaim = false;
      try {
        const provider = await wallet.ensureSparkConnected(walletId);
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
        if (wallet.isDepositClaimInFlight(deposit.txId, vout)) return;
        wallet.markDepositClaimInFlight(deposit.txId, vout);
        ownsClaim = true;
        this.entries[key] = { walletId, phase: 'claiming' };
        const result = await provider.claimDeposit(deposit.txId, classification.quote, vout);
        wallet.markDepositClaimed(deposit.txId, vout);
        this.entries[key] = { walletId, phase: 'accepted' };
        if (Array.isArray(this.pendingByWallet[walletId])) {
          this.pendingByWallet[walletId] = this.pendingByWallet[walletId]
            .filter(d => !(d.txId === deposit.txId && (d.outputIndex || 0) === vout));
        }
        track('bitcoin.deposit.claim_succeeded', {
          source: 'auto', processing: !!result?.processing,
          amount_sats: Number(result?.amount ?? classification.quote.creditAmountSats),
          fee_sats: classification.feeSats,
        });
        wallet.signalDepositsRefresh(walletId);
        wallet.refreshWalletData?.(walletId)?.catch?.(() => {});
      } catch (error) {
        if (current()) {
          this.entries[key] = { walletId, phase: 'retrying', retryAt: Date.now() + BITCOIN_DEPOSIT_POLL_MS };
          console.warn('Bitcoin deposit will retry automatically:', error?.message || error);
        }
      } finally {
        if (ownsClaim) wallet.clearDepositClaimInFlight(deposit.txId, vout);
        // A removed wallet or preference switch must not leave a permanent busy entry.
        if (['checking', 'claiming'].includes(this.entries[key]?.phase)) delete this.entries[key];
      }
    },

    /** Forget everything for a removed wallet. */
    forgetWallet(walletId) {
      delete this.pendingByWallet[walletId];
      for (const [key, entry] of Object.entries(this.entries)) {
        if (entry.walletId === walletId) delete this.entries[key];
      }
    },
  },
});
