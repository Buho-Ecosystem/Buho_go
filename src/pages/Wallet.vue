<template>
  <!-- Loading Screen -->
  <LoadingScreen
    :show="showLoadingScreen"
    :loading-text="loadingText"
  />

  <q-page :class="$q.dark.isActive ? 'wallet-page-dark' : 'wallet-page-light'">
    <!-- Header -->
    <q-toolbar>

      <q-avatar square size="30px">
        <img src="buho_logo.svg" alt="Logo" class="app-logo">
      </q-avatar>

      <!-- Pending Bitcoin Deposits Chip (in header) -->
      <transition name="btc-banner-fade">
        <div
          v-if="isSparkWallet && pendingBitcoinDeposits.length > 0"
          class="btc-incoming-chip"
          :class="$q.dark.isActive ? 'btc-chip-dark' : 'btc-chip-light'"
          @click="openReceiveModalBitcoin"
        >
          <q-icon name="lab la-bitcoin" size="14px" class="btc-chip-icon" />
          <span class="btc-chip-text">
            {{ pendingBitcoinDeposits.some(d => d.confirmed) ? $t('Ready to claim') : $t('Incoming') }}
          </span>
        </div>
      </transition>

      <q-space/>
      <q-btn
        flat
        round
        dense
        class="float-right q-mr-sm"
        :class="$q.dark.isActive ? 'modern-menu-btn-dark' : 'modern-menu-btn-light'"
        @click="$router.push('/settings')"
        aria-label="Settings"
        icon="las la-cog"
      >
      </q-btn>
      <q-btn
        flat
        round
        class="float-right"
        :class="$q.dark.isActive ? 'dark-mode-btn-dark' : 'dark-mode-btn-light'"
        @click="$q.dark.toggle()"
        padding="sm sm"
        style="border-radius: 12px"
        aria-label="Toggle Dark Mode"
        :icon="$q.dark.isActive ? 'las la-sun' : 'las la-moon'"
      >
      </q-btn>
    </q-toolbar>
    <!-- Main Content -->
    <div class="main-content">
      <!-- Wallet Name Badge -->
      <div
        v-if="activeWallet"
        class="wallet-name-badge"
        :class="$q.dark.isActive ? 'wallet-badge-dark' : 'wallet-badge-light'"
        @click="openWalletManagement"
      >
        <q-icon name="las la-wallet" size="12px" class="wallet-badge-icon" />
        <span class="wallet-badge-text">{{ activeWallet.name }}</span>
      </div>

      <!-- Balance Display -->
      <div class="balance-section">
        <div class="balance-container" @click="toggleCurrency" :class="{ 'switching': isSwitchingCurrency }">
          <div class="balance-amount">
            <transition name="balance-fade" mode="out-in">
              <div :key="currentDisplayMode" class="amount-display">
                <span class="amount-number" :class="$q.dark.isActive ? 'amount-number-dark' : 'amount-number-light'">{{
                    formatMainBalance(walletState.balance)
                  }}</span>
                <!-- Fiat icon on the right -->
                <span v-if="currentDisplayMode === 'fiat'" class="currency-icon-right">
                  <q-icon :name="getFiatCurrencyIcon()" size="28px" :class="$q.dark.isActive ? 'amount-unit-dark' : 'amount-unit-light'" />
                </span>
              </div>
            </transition>
          </div>
          <transition name="secondary-fade" mode="out-in">
            <div :key="currentDisplayMode" class="balance-secondary"
                 :class="$q.dark.isActive ? 'balance-secondary-dark' : 'balance-secondary-light'">
              <span v-if="secondaryValue" class="secondary-amount-display">
                <span class="secondary-value">{{ secondaryValue }}</span>
              </span>
              <span v-else class="loading-secondary">{{ $t('Loading...') }}</span>
            </div>
          </transition>
        </div>
      </div>

      <!-- Transaction History Icon -->
      <div class="transaction-icon-section">
        <q-btn
          flat
          round
          size="md"
          icon="las la-history"
          @click="$router.push('/transactions')"
          :class="[$q.dark.isActive ? 'transaction-history-btn-dark' : 'transaction-history-btn-light', { 'pulse': shouldPulse }]"
          aria-label="Transaction History"
        />
      </div>
    </div>

    <!-- Bottom Action Buttons -->
    <div class="bottom-actions">
      <div class="action-buttons">
        <q-btn
          :class="$q.dark.isActive ? 'action-btn receive-btn-dark' : 'action-btn receive-btn-light'"
          @click="showReceiveModal = true"
          no-caps
          unelevated
          aria-label="Receive payment"
        >
          <q-icon name="las la-arrow-down" size="24px"/>
          <div class="btn-text">{{ $t('Receive') }}</div>
        </q-btn>
        <q-btn
          :class="$q.dark.isActive ? 'action-btn send-btn-dark' : 'action-btn send-btn-light'"
          @click="showSendModal = true"
          no-caps
          unelevated
          aria-label="Send payment"
        >
          <q-icon name="las la-arrow-up" size="24px"/>
          <div class="btn-text">{{ $t('Send') }}</div>
        </q-btn>
      </div>
    </div>

    <!-- Receive Modal -->
    <ReceiveModal
      ref="receiveModal"
      v-model="showReceiveModal"
      @invoice-created="onInvoiceCreated"
      @bitcoin-deposits-updated="handleBitcoinDepositsUpdated"
    />

    <!-- Send Modal -->
    <SendModal
      v-model="showSendModal"
      @payment-detected="onPaymentDetected"
    />

    <!-- PIN Entry Dialog for Spark Wallet -->
    <PinEntryDialog
      v-model="showPinDialog"
      :title="$t('Unlock Wallet')"
      :subtitle="$t('Enter your PIN to unlock your Spark wallet')"
      :error-message="pinError"
      @pin-complete="handlePinComplete"
      @cancel="handlePinCancel"
    />

    <!-- Wallet Switcher Dialog -->
    <q-dialog v-model="showWalletSwitcher" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="wallet-switcher-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="switcher-header">
          <div class="switcher-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Switch Wallet') }}
          </div>
          <q-btn flat round dense icon="las la-times" v-close-popup
                 class="close-btn" :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"/>
        </q-card-section>

        <q-card-section class="switcher-content">
          <div class="wallet-switch-list">
            <div
              v-for="wallet in storeWallets"
              :key="wallet.id"
              class="wallet-switch-card"
              :class="{
                'wallet-switch-card-active': wallet.id === storeActiveWalletId,
                'wallet-switch-card-dark': $q.dark.isActive,
                'wallet-switch-card-light': !$q.dark.isActive
              }"
              @click="switchToWallet(wallet.id)"
            >
              <!-- Avatar -->
              <div class="switch-avatar">
                <div class="switch-avatar-circle" :class="getWalletColorClass(wallet)">
                  <q-icon :name="wallet.type === 'spark' ? 'las la-fire' : 'las la-wallet'" size="20px" />
                </div>
                <div
                  class="switch-status-dot"
                  :class="storeConnectionStates[wallet.id]?.connected ? 'status-connected' : 'status-disconnected'"
                ></div>
              </div>

              <!-- Details -->
              <div class="switch-details">
                <div class="switch-name" :class="$q.dark.isActive ? 'switch-name-dark' : 'switch-name-light'">
                  {{ wallet.name }}
                </div>
                <div class="switch-meta-row">
                  <div class="switch-type-badge" :class="wallet.type === 'spark' ? 'type-spark' : 'type-nwc'">
                    <q-icon :name="wallet.type === 'spark' ? 'las la-fire' : 'las la-plug'" size="9px" />
                    <span>{{ wallet.type === 'spark' ? 'Spark' : 'NWC' }}</span>
                  </div>
                  <div v-if="wallet.id === storeActiveWalletId" class="switch-tag tag-active">{{ $t('Active') }}</div>
                </div>
                <div class="switch-balance" :class="$q.dark.isActive ? 'switch-balance-dark' : 'switch-balance-light'">
                  {{ formatBalance(storeBalances[wallet.id] || 0) }}
                </div>
              </div>

              <!-- Check Icon -->
              <q-icon
                v-if="wallet.id === storeActiveWalletId"
                name="las la-check-circle"
                size="20px"
                class="switch-check-icon"
              />
            </div>
          </div>
        </q-card-section>

        <q-card-section class="switcher-footer" :class="$q.dark.isActive ? 'switcher-footer-dark' : 'switcher-footer-light'">
          <q-btn
            flat
            no-caps
            class="manage-wallets-btn"
            :class="$q.dark.isActive ? 'manage-btn-dark' : 'manage-btn-light'"
            @click="goToSettings"
          >
            <q-icon name="las la-cog" class="q-mr-sm" />
            {{ $t('Manage Wallets') }}
          </q-btn>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- Payment Confirmation Dialog -->
    <q-dialog v-model="showPaymentConfirmation" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'" style="width: 500px; max-width: 95vw;">
        <q-card-section :class="$q.dark.isActive ? 'dialog_header_dark' : 'dialog_header_light'">
          <div :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ pendingPayment?.bitcoinAddress ? $t('Send Bitcoin') : $t('Confirm Payment') }}
          </div>
          <q-btn flat round dense icon="las la-times" v-close-popup
                 :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"/>
        </q-card-section>

        <!-- Bitcoin Withdrawal UI -->
        <q-card-section v-if="pendingPayment?.bitcoinAddress" class="bitcoin-withdraw-section">
          <L1BitcoinWithdraw
            :destination-address="pendingPayment.bitcoinAddress"
            :available-balance="walletState.balance"
            @withdrawal-complete="handleBitcoinWithdrawalComplete"
            @withdrawal-error="handleBitcoinWithdrawalError"
          />
        </q-card-section>

        <!-- Regular Payment Confirmation -->
        <q-card-section class="payment-content" v-else-if="pendingPayment">
          <div class="payment-info">
            <div class="payment-amount">
              <div class="amount-display" :class="$q.dark.isActive ? 'amount_display_dark' : 'amount_display_light'">
                {{ formatPaymentAmount() }}
              </div>
              <div class="amount-fiat" :class="$q.dark.isActive ? 'amount_fiat_dark' : 'amount_fiat_light'">
                <span v-if="paymentFiatValue">{{ paymentFiatValue }}</span>
                <span v-else-if="pendingPayment && (pendingPayment.amount > 0 || paymentAmount)"
                      class="loading-fiat">{{ $t('Loading...') }}</span>
              </div>
            </div>

            <div class="payment-details" :class="$q.dark.isActive ? 'payment_details_dark' : 'payment_details_light'">
              <!-- Recipient (Lightning Address or Spark Address) -->
              <div class="detail-item" v-if="pendingPayment.lightningAddress || pendingPayment.sparkAddress">
                <span class="detail-label" :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{
                    $t('To')
                  }}:</span>
                <span class="detail-value recipient-address" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">{{
                    pendingPayment.lightningAddress || pendingPayment.sparkAddress
                  }}</span>
              </div>
              <div class="detail-item" v-if="pendingPayment.description">
                <span class="detail-label" :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{
                    $t('Description')
                  }}:</span>
                <span class="detail-value" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">{{
                    pendingPayment.description
                  }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label"
                      :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{ $t('Type') }}:</span>
                <span class="detail-value" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">{{
                    getPaymentTypeLabel()
                  }}</span>
              </div>
              <!-- Fee estimate for Spark Lightning payments -->
              <div class="detail-item" v-if="showFeeEstimate">
                <span class="detail-label"
                      :class="$q.dark.isActive ? 'detail_label_dark' : 'detail_label_light'">{{ $t('Est. Fee') }}:</span>
                <span class="detail-value" :class="$q.dark.isActive ? 'detail_value_dark' : 'detail_value_light'">
                  <span v-if="isEstimatingFee" class="fee-loading">{{ $t('Estimating...') }}</span>
                  <span v-else-if="estimatedFee !== null">{{ formatAmountInline(estimatedFee) }}</span>
                  <span v-else-if="pendingPayment.sparkAddress" class="fee-free">{{ $t('Free (Spark transfer)') }}</span>
                </span>
              </div>
            </div>

            <!-- Amount input for LNURL/Lightning Address -->
            <div v-if="needsAmountInput" class="amount-input-section">
              <q-input
                v-model="paymentAmount"
                outlined
                :label="$t('Amount')"
                type="number"
                :min="pendingPayment.minSendable ? Math.floor(pendingPayment.minSendable / 1000) : 1"
                :max="pendingPayment.maxSendable ? Math.floor(pendingPayment.maxSendable / 1000) : 100000000"
                :class="$q.dark.isActive ? 'amount_input_dark' : 'amount_input_light'"
                :rules="[validatePaymentAmount]"
              />

              <q-input
                v-if="pendingPayment.commentAllowed > 0"
                v-model="paymentComment"
                outlined
                :label="$t('Comment (optional)')"
                :maxlength="pendingPayment.commentAllowed"
                :class="$q.dark.isActive ? 'comment_input_dark' : 'comment_input_light'"
              />
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right" class="payment-actions"
                        :class="$q.dark.isActive ? 'payment_actions_dark' : 'payment_actions_light'">
          <q-btn flat :label="$t('Cancel')" v-close-popup no-caps
                 :class="$q.dark.isActive ? 'cancel_btn_dark' : 'cancel_btn_light'"/>
          <q-btn
            flat
            :label="$t('Send Payment')"
            no-caps
            @click="confirmPayment"
            :loading="isSendingPayment"
            :disable="!canConfirmPayment"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Save Contact Dialog -->
    <q-dialog v-model="showSaveContactDialog" persistent class="save-contact-dialog">
      <q-card class="save-contact-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="save-contact-header" :class="$q.dark.isActive ? 'dialog_header_dark' : 'dialog_header_light'">
          <div :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Save to Contacts?') }}
          </div>
          <q-btn
            flat
            round
            dense
            icon="las la-times"
            @click="closeSaveContactDialog"
            :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          />
        </q-card-section>

        <q-card-section class="save-contact-content">
          <div class="save-contact-address" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            <q-icon
              :name="saveContactData.addressType === 'spark' ? 'las la-fire' : 'las la-bolt'"
              size="16px"
              :color="saveContactData.addressType === 'spark' ? 'green' : 'amber'"
              class="q-mr-xs"
            />
            <span class="address-preview">{{ truncateAddress(saveContactData.address) }}</span>
          </div>

          <q-input
            v-model="saveContactData.name"
            outlined
            :label="$t('Name')"
            :placeholder="$t('Enter a name for this contact')"
            class="q-mt-md"
            :class="$q.dark.isActive ? 'save-input-dark' : 'save-input-light'"
            autofocus
          />

          <q-input
            v-model="saveContactData.notes"
            outlined
            :label="$t('Notes')"
            :placeholder="$t('Optional notes')"
            type="textarea"
            rows="2"
            class="q-mt-sm"
            :class="$q.dark.isActive ? 'save-input-dark' : 'save-input-light'"
            maxlength="200"
          />
        </q-card-section>

        <q-card-actions align="right" class="save-contact-actions" :class="$q.dark.isActive ? 'actions-dark' : 'actions-light'">
          <q-btn
            flat
            :label="$t('Skip')"
            @click="closeSaveContactDialog"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          />
          <q-btn
            flat
            :label="$t('Save')"
            @click="saveRecipientAsContact"
            class="save-btn"
            :disable="!saveContactData.name?.trim()"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import { NostrWebLNProvider } from "@getalby/sdk";
import {LightningPaymentService} from '../utils/lightning.js';
import {fiatRatesService} from '../utils/fiatRates.js';
import {formatMainBalance as formatMainBalanceUtil, formatAmount} from '../utils/amountFormatting.js';
import {useWalletStore} from '../stores/wallet';
import {useAddressBookStore} from '../stores/addressBook';
import LoadingScreen from '../components/LoadingScreen.vue';
import ReceiveModal from '../components/ReceiveModal.vue';
import SendModal from '../components/SendModal.vue';
import PinEntryDialog from '../components/PinEntryDialog.vue';
import L1BitcoinWithdraw from '../components/L1BitcoinWithdraw.vue';

export default {
  name: 'WalletPage',
  components: {
    LoadingScreen,
    ReceiveModal,
    SendModal,
    PinEntryDialog,
    L1BitcoinWithdraw
  },
  setup() {
    const walletStore = useWalletStore();
    const addressBookStore = useAddressBookStore();
    return { walletStore, addressBookStore };
  },
  data() {
    return {
      walletState: {
        balance: 312,
        connectedWallets: [],
        activeWalletId: null,
        currency: 'sats',
        currencies: ['sats', 'btc', 'usd'],
        exchangeRates: {},
        lastRateUpdate: null,
        preferredFiatCurrency: 'USD',
        denominationCurrency: 'bitcoin',
        displayMode: 'bitcoin'
      },
      recentTransactions: [],
      showReceiveModal: false,
      showSendModal: false,
      showPaymentConfirmation: false,
      pendingPayment: null,
      paymentAmount: '',
      paymentComment: '',
      slidePosition: 0,
      slideConfirmed: false,
      isSliding: false,
      slideStartX: 0,
      maxSlideDistance: 0,
      parsedInvoice: null,
      lightningAddress: '',
      generatedInvoice: null,
      refreshInterval: null,
      pulseInterval: null,
      currentInvoicePaymentHash: null,
      invoiceCheckInterval: null,
      waitingForPayment: false,
      showLoadingScreen: true,
      loadingText: 'Loading wallet...',
      currentDisplayMode: 'bitcoin',
      isSwitchingCurrency: false,
      shouldPulse: false,
      paymentData: null,
      invoicePaid: false,
      isSendingPayment: false,
      fiatRatesLoaded: false,
      secondaryValue: '',
      paymentFiatValue: '',
      showWalletSwitcher: false,
      showPinDialog: false,
      pinError: '',
      // Fee estimation for Spark Lightning payments
      estimatedFee: null,
      isEstimatingFee: false,
      // Save-to-contacts after payment
      showSaveContactDialog: false,
      saveContactData: {
        address: '',
        addressType: 'lightning',
        name: '',
        notes: ''
      },
      // L1 Bitcoin pending deposits
      pendingBitcoinDeposits: [],
      bitcoinDepositPollingInterval: null
    };
  },
  computed: {
    activeWallet() {
      return this.walletState.connectedWallets.find(
        w => w.id === this.walletState.activeWalletId
      ) || null;
    },
    isSparkWallet() {
      return this.walletStore.isActiveWalletSpark;
    },
    needsAmountInput() {
      if (!this.pendingPayment) return false;

      // Spark addresses always need amount input (no embedded amount)
      if (this.pendingPayment.type === 'spark_address' || this.pendingPayment.sparkAddress) {
        return true;
      }

      // Lightning Address always needs amount input (no embedded amount in address)
      if (this.pendingPayment.type === 'lightning_address' || this.pendingPayment.lightningAddress) {
        // Use isFixedAmount flag if available (from NWC processing)
        if (this.pendingPayment.isFixedAmount !== undefined) {
          return !this.pendingPayment.isFixedAmount;
        }
        // For Spark wallet (no LNURL info fetched yet), always require amount
        if (!this.pendingPayment.minSendable && !this.pendingPayment.maxSendable) {
          return true;
        }
        // Check if min equals max (fixed amount from LNURL info)
        return this.pendingPayment.minSendable !== this.pendingPayment.maxSendable;
      }

      // Check for LNURL payments
      if (this.pendingPayment.type === 'lnurl' || this.pendingPayment.type === 'lnurl_pay') {
        if (this.pendingPayment.isFixedAmount !== undefined) {
          return !this.pendingPayment.isFixedAmount;
        }
        return this.pendingPayment.minSendable !== this.pendingPayment.maxSendable;
      }

      // Zero-amount invoices need amount input
      return (this.pendingPayment.type === 'lightning_invoice' && this.pendingPayment.amount === 0) ||
             (this.pendingPayment.type === 'invoice' && this.pendingPayment.amount === 0);
    },
    canConfirmPayment() {
      if (!this.pendingPayment) return false;
      if (this.needsAmountInput) {
        return this.paymentAmount && this.paymentAmount > 0 && this.validatePaymentAmount(this.paymentAmount) === true;
      }
      return true;
    },
    // Show fee estimate for Spark wallet Lightning payments (not Spark-to-Spark transfers)
    showFeeEstimate() {
      if (!this.pendingPayment) return false;
      if (!this.walletStore.isActiveWalletSpark) return false;
      // Show for Lightning invoice, Lightning address, or LNURL payments
      const paymentTypes = ['lightning_invoice', 'invoice', 'lightning_address', 'lnurl', 'lnurl_pay'];
      return paymentTypes.includes(this.pendingPayment.type) || this.pendingPayment.sparkAddress;
    },
    // Computed properties from Pinia store for wallet switcher
    storeWallets() {
      return this.walletStore.wallets || [];
    },
    storeActiveWalletId() {
      return this.walletStore.activeWalletId;
    },
    storeBalances() {
      return this.walletStore.balances || {};
    },
    storeConnectionStates() {
      return this.walletStore.connectionStates || {};
    }
  },
  async created() {
    this.initializeWallet();
    // Check for Bitcoin withdrawal from contacts
    this.handleBitcoinWithdrawalFromQuery();
  },
  beforeUnmount() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
    }
    if (this.invoiceCheckInterval) {
      clearInterval(this.invoiceCheckInterval);
    }
    if (this.qrScanner) {
      this.qrScanner.destroy();
    }
    // Stop L1 Bitcoin deposit polling
    this.stopBitcoinDepositPolling();
  },
  watch: {
    'walletState.balance': {
      handler: 'updateSecondaryValue',
      immediate: true
    },

    currentDisplayMode: {
      handler: 'updateSecondaryValue',
      immediate: true
    },

    pendingPayment: {
      handler: 'updatePaymentFiatValue',
      immediate: true,
      deep: true
    },

    paymentAmount: {
      handler: 'updatePaymentFiatValue',
      immediate: true
    }
  },
  methods: {
    async openWalletManagement() {
      // Initialize the store to ensure we have the latest wallet data
      await this.walletStore.initialize();
      this.showWalletSwitcher = true;
    },

    // ==========================================
    // L1 Bitcoin Deposit Methods
    // ==========================================

    /**
     * Open receive modal with Bitcoin tab selected
     */
    openReceiveModalBitcoin() {
      this.showReceiveModal = true;
      // The ReceiveModal will receive this via a prop or event
      this.$nextTick(() => {
        // Emit event to set bitcoin mode
        this.$refs.receiveModal?.setReceiveMode?.('bitcoin');
      });
    },

    /**
     * Check for pending Bitcoin deposits (for banner display)
     */
    async checkPendingBitcoinDeposits() {
      if (!this.isSparkWallet) return;

      try {
        const provider = await this.walletStore.ensureSparkConnected();
        if (!provider?.getPendingDeposits) return;

        const newDeposits = await provider.getPendingDeposits();

        // Detect changes and show notifications
        this.detectDepositChanges(newDeposits);

        this.pendingBitcoinDeposits = newDeposits;
      } catch (error) {
        // Silently ignore - wallet may be locked
      }
    },

    /**
     * Detect deposit changes and trigger notifications
     */
    detectDepositChanges(newDeposits) {
      const previousTxIds = new Set(this.pendingBitcoinDeposits.map(d => d.txId));
      const previousConfirmed = new Map(this.pendingBitcoinDeposits.map(d => [d.txId, d.confirmed]));

      for (const deposit of newDeposits) {
        // New deposit detected (not seen before)
        if (!previousTxIds.has(deposit.txId)) {
          this.notifyNewDeposit(deposit);
        }
        // Deposit became claimable (was not confirmed, now is)
        else if (deposit.confirmed && !previousConfirmed.get(deposit.txId)) {
          this.notifyDepositReady(deposit);
        }
      }
    },

    /**
     * Show notification for new deposit detected
     */
    notifyNewDeposit(deposit) {
      this.$q.notify({
        type: 'info',
        icon: 'lab la-bitcoin',
        message: this.$t('Bitcoin detected'),
        caption: `${deposit.amount.toLocaleString()} sats ${this.$t('confirming')}`,
        position: 'top',
        timeout: 5000,
        actions: [{
          label: this.$t('View'),
          color: 'white',
          handler: () => this.openReceiveModalBitcoin()
        }]
      });
    },

    /**
     * Show notification when deposit is ready to claim
     */
    notifyDepositReady(deposit) {
      this.$q.notify({
        type: 'positive',
        icon: 'las la-check-circle',
        message: this.$t('Ready to claim'),
        caption: `${deposit.amount.toLocaleString()} sats`,
        position: 'top',
        timeout: 8000,
        actions: [{
          label: this.$t('Claim'),
          color: 'white',
          handler: () => this.openReceiveModalBitcoin()
        }]
      });
    },

    /**
     * Start polling for pending Bitcoin deposits
     */
    startBitcoinDepositPolling() {
      if (!this.isSparkWallet) return;

      // Initial check
      this.checkPendingBitcoinDeposits();

      // Poll every 5 minutes
      this.bitcoinDepositPollingInterval = setInterval(() => {
        this.checkPendingBitcoinDeposits();
      }, 300000);
    },

    /**
     * Stop Bitcoin deposit polling
     */
    stopBitcoinDepositPolling() {
      if (this.bitcoinDepositPollingInterval) {
        clearInterval(this.bitcoinDepositPollingInterval);
        this.bitcoinDepositPollingInterval = null;
      }
    },

    /**
     * Handle deposits updated from ReceiveModal
     */
    handleBitcoinDepositsUpdated(deposits) {
      this.pendingBitcoinDeposits = deposits;
    },

    /**
     * Handle successful Bitcoin withdrawal
     */
    handleBitcoinWithdrawalComplete(result) {
      this.showPaymentConfirmation = false;
      this.pendingPayment = null;

      this.$q.notify({
        type: 'positive',
        message: this.$t('Bitcoin withdrawal initiated'),
        caption: this.$t('Your withdrawal is being processed'),
        position: 'bottom',
        timeout: 4000,
        actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
      });

      // Refresh balance
      this.updateWalletBalance();
    },

    /**
     * Handle Bitcoin withdrawal error
     */
    handleBitcoinWithdrawalError(error) {
      // Error notification is already shown by the component
      console.error('Bitcoin withdrawal error:', error);
    },

    /**
     * Handle Bitcoin withdrawal request from query params (from contacts)
     */
    handleBitcoinWithdrawalFromQuery() {
      const query = this.$route.query;
      if (query.action === 'bitcoin_withdrawal' && query.address) {
        // Wait for wallet to be loaded
        this.$nextTick(() => {
          setTimeout(() => {
            // Set up pending payment for Bitcoin withdrawal
            this.pendingPayment = {
              type: 'bitcoin_address',
              bitcoinAddress: query.address,
              contactName: query.contactName || null
            };
            this.showPaymentConfirmation = true;

            // Clear query params
            this.$router.replace({ query: {} });
          }, 500);
        });
      }
    },

    async switchToWallet(walletId) {
      if (walletId === this.storeActiveWalletId) {
        this.showWalletSwitcher = false;
        return;
      }

      try {
        // Use the wallet store to switch - this keeps Settings in sync
        await this.walletStore.switchActiveWallet(walletId);

        // Also update local walletState to stay in sync
        this.walletState.activeWalletId = walletId;

        // Get the new active wallet's balance from the store
        this.walletState.balance = this.storeBalances[walletId] || 0;

        // Save state to localStorage
        localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));

        this.showWalletSwitcher = false;

        this.$q.notify({
          type: 'positive',
          message: this.$t('Wallet switched'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });

        // Check if Spark wallet needs PIN unlock
        await this.checkSparkWalletUnlock();

        // Refresh balance in background (only if provider is available)
        this.updateWalletBalance();
      } catch (error) {
        console.error('Error switching wallet:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t switch wallet'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      }
    },

    goToSettings() {
      this.showWalletSwitcher = false;
      this.$router.push('/settings');
    },

    getWalletColorClass(wallet) {
      const colors = ['wallet-green', 'wallet-blue', 'wallet-purple', 'wallet-orange', 'wallet-red'];
      const index = wallet.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
      return colors[index];
    },
    async initializeWallet() {
      try {
        this.loadingText = 'Loading wallet state...';
        await this.loadWalletState();

        // Initialize wallet store
        await this.walletStore.initialize();

        // Start L1 Bitcoin deposit polling for banner (after wallet store is ready)
        this.startBitcoinDepositPolling();

        this.loadingText = 'Loading fiat rates...';
        await this.loadFiatRates();

        this.loadingText = 'Fetching transactions...';
        await this.loadTransactions();

        this.loadingText = 'Loading profiles...';
        await this.loadNostrProfiles();

        this.loadingText = 'Starting services...';
        this.startPeriodicRefresh();
        this.startPulseAnimation();

        this.loadingText = 'Ready!';
        await new Promise(resolve => setTimeout(resolve, 500));
        this.showLoadingScreen = false;

        // Check if Spark wallet needs unlocking
        await this.checkSparkWalletUnlock();
      } catch (error) {
        console.error('Error initializing wallet:', error);
        this.loadingText = 'Error loading wallet';
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.showLoadingScreen = false;
      }
    },

    async checkSparkWalletUnlock() {
      // Check if active wallet is Spark and needs unlocking
      if (this.walletStore.isActiveWalletSpark) {
        const provider = this.walletStore.getActiveProvider();
        if (!provider) {
          // Spark wallet exists but not unlocked - show PIN dialog
          this.pinError = '';
          this.showPinDialog = true;
        }
      }
    },

    async handlePinComplete(pin) {
      try {
        this.pinError = '';
        await this.walletStore.unlockSparkWallet(pin);
        this.showPinDialog = false;

        // Refresh balance after unlock
        await this.updateWalletBalance();

        // Check for pending Bitcoin deposits immediately after unlock
        this.checkPendingBitcoinDeposits();

        this.$q.notify({
          type: 'positive',
          message: this.$t('Wallet unlocked'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } catch (error) {
        console.error('PIN unlock failed:', error);
        this.pinError = this.$t('Incorrect PIN. Please try again.');
      }
    },

    handlePinCancel() {
      this.showPinDialog = false;
      // Optionally redirect or show warning that wallet features are limited
      this.$q.notify({
        type: 'warning',
        message: this.$t('Wallet locked'),
        caption: this.$t('Some features require PIN unlock'),
        position: 'bottom',
        actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
      });
    },

    async loadWalletState() {
      const savedState = localStorage.getItem('buhoGO_wallet_state');
      if (savedState) {
        try {
          const parsedState = JSON.parse(savedState);
          this.walletState = {...this.walletState, ...parsedState};
          await this.updateWalletBalance();
        } catch (error) {
          console.error('Failed to load wallet state:', error);
        }
      } else {
        this.walletState.balance = 312;
      }
    },

    async updateWalletBalance() {
      try {
        if (this.showLoadingScreen) {
          this.loadingText = 'Updating balance...';
        }

        // Check if active wallet is Spark
        if (this.walletStore.isActiveWalletSpark) {
          // Try to get connected provider, auto-reconnects if session PIN available
          try {
            const provider = await this.walletStore.ensureSparkConnected();
            const balanceResult = await provider.getBalance();
            this.walletState.balance = balanceResult.balance;
            localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
          } catch (err) {
            // Silently fail for background refresh - user will see locked state
            // Don't spam console with expected "PIN required" messages
            if (!err.message?.includes('PIN')) {
              console.warn('Balance refresh skipped:', err.message);
            }
          }
          return;
        }

        // NWC wallet flow
        const activeWallet = this.walletState.connectedWallets.find(
          w => w.id === this.walletState.activeWalletId
        );

        if (activeWallet && activeWallet.nwcString) {
          const nwc = new NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          const balance = await nwc.getBalance();
          this.walletState.balance = balance.balance;
          activeWallet.balance = balance.balance;

          localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));
        }
      } catch (error) {
        console.error('Failed to update balance:', error);
      }
    },

    async loadTransactions() {
      this.recentTransactions = [];
    },

    loadNostrProfiles() {
      const saved = localStorage.getItem('buhoGO_nostr_profiles');
      if (saved) {
        try {
          this.nostrProfiles = JSON.parse(saved);
        } catch (error) {
          console.error('Error loading nostr profiles:', error);
        }
      }
    },

    startPeriodicRefresh() {
      this.refreshInterval = setInterval(async () => {
        await this.updateWalletBalance();
        await this.loadTransactions();
        await this.loadFiatRates();
      }, 30000);
    },

    async loadFiatRates() {
      try {
        const rates = await fiatRatesService.getRates();
        this.walletState.exchangeRates = {
          usd: rates.USD || 100000,
          eur: rates.EUR || 85000,
          gbp: rates.GBP || 75000,
          cad: rates.CAD || 135000,
          chf: rates.CHF || 90000,
          aud: rates.AUD || 150000,
          jpy: rates.JPY || 15000000
        };
        this.walletState.lastRateUpdate = new Date();
        this.fiatRatesLoaded = true;

        // Save updated state
        localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));

        console.log('Fiat rates loaded:', this.walletState.exchangeRates);
      } catch (error) {
        console.error('Error loading fiat rates:', error);
        // Keep existing rates or use fallbacks
        if (!this.fiatRatesLoaded) {
          this.walletState.exchangeRates = {
            usd: 100000,
            eur: 85000,
            gbp: 75000,
            cad: 135000,
            chf: 90000,
            aud: 150000,
            jpy: 15000000
          };
        }
      }
    },

    startPulseAnimation() {
      this.pulseInterval = setInterval(() => {
        this.shouldPulse = true;
        setTimeout(() => {
          this.shouldPulse = false;
        }, 1000);
      }, 25000);
    },

    async toggleCurrency() {
      if (this.isSwitchingCurrency) return;

      this.isSwitchingCurrency = true;

      // BIP-177: Only 2 modes - bitcoin and fiat
      const modes = ['bitcoin', 'fiat'];
      const currentIndex = modes.indexOf(this.currentDisplayMode);
      const nextIndex = (currentIndex + 1) % modes.length;

      this.walletState.displayMode = modes[nextIndex];
      this.currentDisplayMode = modes[nextIndex];
      localStorage.setItem('buhoGO_wallet_state', JSON.stringify(this.walletState));

      setTimeout(() => {
        this.isSwitchingCurrency = false;
      }, 200);
    },

    formatMainBalance(balance) {
      switch (this.currentDisplayMode) {
        case 'bitcoin':
          // Use utility for BIP-177 or Legacy format
          return formatMainBalanceUtil(balance, this.walletStore.useBip177Format);
        case 'fiat':
          const btcAmount = balance / 100000000;
          const rate = this.walletState.exchangeRates[this.walletState.preferredFiatCurrency.toLowerCase()] || 65000;
          const fiatValue = btcAmount * rate;
          return fiatValue.toFixed(2);
        default:
          return formatMainBalanceUtil(balance, this.walletStore.useBip177Format);
      }
    },

    getFiatCurrencyIcon() {
      const currency = this.walletState.preferredFiatCurrency || 'USD';
      const iconMap = {
        'USD': 'las la-dollar-sign',
        'EUR': 'las la-euro-sign',
        'GBP': 'las la-pound-sign',
        'JPY': 'las la-yen-sign',
        'CNY': 'las la-yen-sign',
        'INR': 'las la-rupee-sign',
        'CAD': 'las la-dollar-sign',
        'AUD': 'las la-dollar-sign',
        'CHF': 'las la-dollar-sign',
        'KRW': 'las la-won-sign',
        'BRL': 'las la-dollar-sign',
        'MXN': 'las la-dollar-sign',
        'RUB': 'las la-ruble-sign',
        'TRY': 'las la-lira-sign',
      };
      return iconMap[currency.toUpperCase()] || 'las la-dollar-sign';
    },

    getSecondaryDisplayValue() {
      if (!this.secondaryValue) return '';
      // Remove "₿" prefix if present (for BIP-177)
      if (this.secondaryValue.startsWith('₿')) {
        return this.secondaryValue.replace('₿', '').trim();
      }
      // Remove "sats" suffix if present (for Legacy format)
      if (this.secondaryValue.endsWith(' sats')) {
        return this.secondaryValue.replace(' sats', '').trim();
      }
      // Otherwise it's a fiat value, return as is
      return this.secondaryValue;
    },

    getSecondaryDisplayType() {
      if (!this.secondaryValue) return '';
      // Check if it starts with ₿ symbol (BIP-177 bitcoin format)
      if (this.secondaryValue.startsWith('₿')) {
        return 'bitcoin';
      }
      // Check if it ends with "sats" (Legacy bitcoin format)
      if (this.secondaryValue.endsWith(' sats')) {
        return 'bitcoin';
      }
      // Otherwise it's fiat
      return 'fiat';
    },

    async getSecondaryValue(balance) {
      switch (this.currentDisplayMode) {
        case 'bitcoin':
          // When showing bitcoin, secondary shows fiat
          return await this.getFiatValue(balance);
        case 'fiat':
          // When showing fiat, secondary shows bitcoin using utility
          return formatMainBalanceUtil(balance, this.walletStore.useBip177Format);
        default:
          return await this.getFiatValue(balance);
      }
    },

    formatBalance(balance) {
      // Use utility for BIP-177 or Legacy format
      return formatMainBalanceUtil(balance, this.walletStore.useBip177Format);
    },

    // Helper method for inline template formatting
    formatAmountInline(amount) {
      return formatAmount(amount, this.walletStore.useBip177Format);
    },

    async getFiatValue(balance) {
      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const fiatAmount = await fiatRatesService.convertSatsToFiat(balance, currency);

        // Handle unavailable rates - return empty string instead of fake value
        if (fiatAmount === null) {
          return '--';
        }

        return fiatRatesService.formatFiatAmount(fiatAmount, currency);
      } catch (error) {
        console.error('Error getting fiat value:', error);

        // Check if we have valid stored rates (not guessed/fallback)
        if (!this.walletState.exchangeRatesAvailable) {
          return '--';
        }

        // Use stored rates only if they're valid
        const btcAmount = balance / 100000000;
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const rate = this.walletState.exchangeRates[currency.toLowerCase()];

        if (!rate) {
          return '--';
        }

        const fiatValue = btcAmount * rate;

        const symbols = {
          USD: '$',
          EUR: '€',
          GBP: '£',
          CAD: 'C$',
          CHF: 'CHF ',
          AUD: 'A$',
          JPY: '¥'
        };

        const symbol = symbols[currency] || currency;
        return currency === 'JPY' ? symbol + Math.round(fiatValue).toLocaleString() : symbol + fiatValue.toFixed(2);
      }
    },

    // Payment processing methods

    parseInvoiceManually(invoice) {
      try {
        const cleanInvoice = invoice.replace(/^lightning:/i, '');

        let amount = 0;
        const amountMatch = cleanInvoice.match(/lnbc(\d+)([munp]?)/i);
        if (amountMatch) {
          const value = parseInt(amountMatch[1]);
          const unit = amountMatch[2];

          switch (unit) {
            case 'm':
              amount = value * 100000; // milli-bitcoin
              break;
            case 'u':
              amount = value * 100; // micro-bitcoin
              break;
            case 'n':
              amount = value / 10; // nano-bitcoin
              break;
            case 'p':
              amount = value / 10000; // pico-bitcoin
              break;
            default:
              // No unit or unrecognized unit - likely variable amount invoice
              amount = 0;
          }
        }

        let description = 'Lightning Payment';
        const now = Math.floor(Date.now() / 1000);
        const expiry = now + 3600;

        return {
          amount: Math.floor(amount),
          description,
          expiry,
          invoice: cleanInvoice
        };
      } catch (error) {
        console.error('Error parsing invoice manually:', error);
        return {
          amount: 0,
          description: 'Lightning Payment',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          invoice: invoice
        };
      }
    },

    getActiveWallet() {
      return this.walletState.connectedWallets.find(
        w => w.id === this.walletState.activeWalletId
      );
    },

    getPaymentTypeLabel() {
      if (!this.paymentData && !this.pendingPayment) return '';

      const payment = this.paymentData || this.pendingPayment;

      const labels = {
        'lightning_invoice': 'Lightning Invoice',
        'lnurl_pay': 'LNURL Payment',
        'lightning_address': 'Lightning Address',
        'spark_address': 'Spark Transfer',
        'bitcoin_address': 'Bitcoin Withdrawal'
      };
      return labels[payment.type] || 'Lightning Payment';
    },

    requiresAmount() {
      if (!this.paymentData) return false;

      return this.paymentData.type === 'lnurl_pay' ||
        this.paymentData.type === 'lightning_address' ||
        (this.paymentData.type === 'lightning_invoice' && this.paymentData.requiresAmount);
    },

    getAmountLimits() {
      if (!this.paymentData) return null;

      return {
        min: Math.floor(this.paymentData.minSendable / 1000),
        max: Math.floor(this.paymentData.maxSendable / 1000)
      };
    },

    async onPaymentDetected(paymentData) {
      console.log('Payment detected:', paymentData);

      try {
        // Transform the payment data to match expected structure
        if (paymentData.type === 'lightning_invoice' && paymentData.data) {
          // Parse the invoice to get the amount
          const parsedInvoice = this.parseInvoiceManually(paymentData.data);

          this.pendingPayment = {
            ...paymentData,
            invoice: paymentData.data,
            amount: parsedInvoice.amount,
            description: parsedInvoice.description
          };
        } else if (paymentData.type === 'lnurl' && paymentData.data) {
          // For Spark wallets, just pass through - we'll process during payment
          if (this.walletStore.isActiveWalletSpark) {
            this.pendingPayment = {
              ...paymentData,
              lnurl: paymentData.data
            };
          } else {
            // Process LNURL for NWC wallets
            const activeWallet = this.getActiveWallet();
            if (!activeWallet?.nwcString) {
              throw new Error('No active wallet found');
            }
            const lightningService = new LightningPaymentService(activeWallet.nwcString);
            const processedLnurl = await lightningService.processPaymentInput(paymentData.data);
            console.log('LNURL processed:', processedLnurl);
            this.pendingPayment = processedLnurl;
          }
        } else if (paymentData.type === 'lightning_address' && paymentData.data) {
          // Fetch LNURL info for both Spark and NWC wallets
          const lnurlInfo = await this.fetchLightningAddressInfo(paymentData.data);

          if (this.walletStore.isActiveWalletSpark) {
            // For Spark wallets, include LNURL info for amount handling
            this.pendingPayment = {
              ...paymentData,
              lightningAddress: paymentData.data,
              ...lnurlInfo
            };
          } else {
            // Process Lightning Address for NWC wallets
            const activeWallet = this.getActiveWallet();
            if (!activeWallet?.nwcString) {
              throw new Error('No active wallet found');
            }
            const lightningService = new LightningPaymentService(activeWallet.nwcString);
            const processedAddress = await lightningService.processPaymentInput(paymentData.data);
            this.pendingPayment = processedAddress;
          }
        } else if (paymentData.type === 'spark_address' && paymentData.data) {
          // Spark address payment
          this.pendingPayment = {
            ...paymentData,
            sparkAddress: paymentData.data
          };
        } else if (paymentData.type === 'bitcoin_address' && paymentData.data) {
          // Bitcoin L1 withdrawal (Spark only)
          if (!this.walletStore.isActiveWalletSpark) {
            throw new Error('Bitcoin withdrawals require a Spark wallet');
          }
          this.pendingPayment = {
            ...paymentData,
            bitcoinAddress: paymentData.data
          };
        } else {
          this.pendingPayment = paymentData;
        }

        this.showPaymentConfirmation = true;
      } catch (error) {
        console.error('Error processing payment:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Payment failed'),
          caption: this.$t('Please try again'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      }
    },

    async checkInvoiceStatus() {
      if (!this.currentInvoicePaymentHash || this.invoicePaid) return;

      try {
        let isPaid = false;

        if (this.walletStore.isActiveWalletSpark) {
          // Spark wallet - ensure connected and use provider's lookupInvoice
          try {
            const provider = await this.walletStore.ensureSparkConnected();
            const result = await provider.lookupInvoice(this.currentInvoicePaymentHash);
            isPaid = result.paid;
          } catch (e) {
            // Silently fail if wallet not connected during background check
            return;
          }
        } else {
          // NWC wallet
          const activeWallet = this.getActiveWallet();
          if (!activeWallet?.nwcString) return;

          const nwc = new NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });
          await nwc.enable();

          const transactions = await nwc.getTransactions();
          const paidInvoice = transactions.find(tx =>
            tx.type === 'incoming' &&
            tx.payment_hash === this.currentInvoicePaymentHash
          );
          isPaid = !!paidInvoice;
        }

        if (isPaid) {
          console.log('Invoice paid!');
          this.invoicePaid = true;
          this.waitingForPayment = false;
          this.stopInvoiceMonitoring();

          await this.updateWalletBalance();

          this.$q.notify({
            type: 'positive',
            message: this.$t('Payment received'),
            position: 'bottom',
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
        }
      } catch (error) {
        console.error('Error checking invoice status:', error);
      }
    },

    formatPaymentAmount() {
      if (!this.pendingPayment) return '';

      // Variable amount - user needs to input
      if (this.needsAmountInput) {
        return this.paymentAmount ? formatAmount(parseInt(this.paymentAmount), this.walletStore.useBip177Format) : 'Enter amount';
      }

      // Fixed-amount LNURL/Lightning Address - use fixedAmountSats if available
      if (this.pendingPayment.type === 'lnurl' ||
          this.pendingPayment.type === 'lnurl_pay' ||
          this.pendingPayment.type === 'lightning_address') {
        // Use new fixedAmountSats property if available
        if (this.pendingPayment.fixedAmountSats) {
          return formatAmount(this.pendingPayment.fixedAmountSats, this.walletStore.useBip177Format);
        }
        // Fallback: calculate from minSendable
        if (this.pendingPayment.minSendable === this.pendingPayment.maxSendable) {
          const fixedAmount = Math.floor(this.pendingPayment.minSendable / 1000);
          return formatAmount(fixedAmount, this.walletStore.useBip177Format);
        }
      }

      // Standard invoice with amount
      return this.pendingPayment.amount ?
        formatAmount(parseInt(this.pendingPayment.amount), this.walletStore.useBip177Format) :
        'Variable amount';
    },

    async formatPaymentFiat() {
      if (!this.pendingPayment) return '';

      let amount = 0;
      if (this.needsAmountInput) {
        amount = parseInt(this.paymentAmount) || 0;
      } else if (this.pendingPayment.type === 'lnurl' ||
                 this.pendingPayment.type === 'lnurl_pay' ||
                 this.pendingPayment.type === 'lightning_address') {
        // Fixed-amount LNURL/Lightning Address - use fixedAmountSats if available
        if (this.pendingPayment.fixedAmountSats) {
          amount = this.pendingPayment.fixedAmountSats;
        } else if (this.pendingPayment.minSendable === this.pendingPayment.maxSendable) {
          amount = Math.floor(this.pendingPayment.minSendable / 1000);
        }
      } else {
        amount = this.pendingPayment.amount || 0;
      }

      if (amount === 0) return '';

      try {
        const currency = this.walletState.preferredFiatCurrency || 'USD';
        const fiatAmount = await fiatRatesService.convertSatsToFiat(amount, currency);

        // Handle unavailable rates
        if (fiatAmount === null) {
          return '';
        }

        return '≈ ' + fiatRatesService.formatFiatAmount(fiatAmount, currency);
      } catch (error) {
        console.error('Error formatting payment fiat:', error);
        return '';
      }
    },

    validatePaymentAmount(amount) {
      if (!this.pendingPayment) return 'No payment details';

      const amountNum = parseInt(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return 'Amount must be greater than 0';
      }

      // Use minSats/maxSats from lightning.js if available
      const minSats = this.pendingPayment.minSats || (this.pendingPayment.minSendable ? Math.ceil(this.pendingPayment.minSendable / 1000) : 1);
      const maxSats = this.pendingPayment.maxSats || (this.pendingPayment.maxSendable ? Math.floor(this.pendingPayment.maxSendable / 1000) : 100000000);

      if (amountNum < minSats) {
        return `Minimum amount is ${formatAmount(minSats, this.walletStore.useBip177Format)}`;
      }

      if (amountNum > maxSats) {
        return `Maximum amount is ${formatAmount(maxSats, this.walletStore.useBip177Format)}`;
      }

      return true;
    },

    async confirmPayment() {
      if (!this.canConfirmPayment) return;

      this.isSendingPayment = true;

      try {
        // Determine the amount to send
        let amount = null;
        if (this.needsAmountInput && this.paymentAmount) {
          // Variable amount - user entered value
          amount = parseInt(this.paymentAmount);
        } else if (this.pendingPayment.fixedAmountSats) {
          // Fixed-amount LNURL/Lightning Address - use fixedAmountSats from lightning.js
          amount = this.pendingPayment.fixedAmountSats;
        } else if (this.pendingPayment.amount > 0) {
          // Fixed amount invoice
          amount = this.pendingPayment.amount;
        } else if ((this.pendingPayment.type === 'lnurl' ||
                    this.pendingPayment.type === 'lnurl_pay' ||
                    this.pendingPayment.type === 'lightning_address') &&
                   this.pendingPayment.minSendable === this.pendingPayment.maxSendable) {
          // Fallback: calculate fixed amount from minSendable
          amount = Math.floor(this.pendingPayment.minSendable / 1000);
        }

        const comment = this.paymentComment || null;

        console.log('Sending payment:', this.pendingPayment);
        console.log('Amount:', amount, 'Comment:', comment);

        let result;

        // Route payment based on wallet type
        if (this.walletStore.isActiveWalletSpark) {
          result = await this.sendSparkPayment(amount, comment);
        } else {
          result = await this.sendNWCPayment(amount, comment);
        }

        console.log('Payment sent:', result);

        // Check if we should offer to save this recipient as a contact
        const recipientAddress = this.getRecipientAddress();
        const recipientAddressType = this.getRecipientAddressType();
        const shouldOfferSave = recipientAddress && !this.addressBookStore.findContactByAddress(recipientAddress);

        this.showPaymentConfirmation = false;
        const pendingPaymentBackup = this.pendingPayment; // Keep reference for save dialog
        this.pendingPayment = null;
        this.paymentAmount = '';
        this.paymentComment = '';
        this.estimatedFee = null;
        this.isEstimatingFee = false;

        await this.updateWalletBalance();

        this.$q.notify({
          type: 'positive',
          message: this.$t('Sent'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });

        // Offer to save contact if this is a new recipient
        if (shouldOfferSave) {
          this.saveContactData = {
            address: recipientAddress,
            addressType: recipientAddressType,
            name: '',
            notes: ''
          };
          // Small delay so the success notification is seen first
          setTimeout(() => {
            this.showSaveContactDialog = true;
          }, 500);
        }

      } catch (error) {
        console.error('Payment failed:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Payment failed'),
          caption: this.$t('Please try again'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } finally {
        this.isSendingPayment = false;
      }
    },

    async sendSparkPayment(amount, comment) {
      // Ensure Spark wallet is connected (auto-connects if session PIN available)
      const provider = await this.walletStore.ensureSparkConnected();

      // Spark address transfer (zero-fee)
      if (this.pendingPayment.sparkAddress) {
        return await provider.transferToSparkAddress(this.pendingPayment.sparkAddress, amount);
      }

      // Lightning invoice
      if (this.pendingPayment.invoice) {
        // For zero-amount invoices, pass user-provided amount
        const isZeroAmountInvoice = !this.pendingPayment.amount || this.pendingPayment.amount === 0;

        return await provider.payInvoice({
          invoice: this.pendingPayment.invoice,
          preferSpark: true, // Auto-use Spark transfer if recipient has Spark address
          amountSats: isZeroAmountInvoice ? amount : null // Only pass amount for zero-amount invoices
        });
      }

      // Lightning address
      if (this.pendingPayment.lightningAddress) {
        return await provider.payLightningAddress(this.pendingPayment.lightningAddress, amount, comment || '');
      }

      // LNURL - decode and fetch invoice, then pay
      // Note: LNURL invoices already have amount encoded, so don't pass amountSats
      if (this.pendingPayment.lnurl) {
        const invoice = await this.fetchLNURLInvoice(this.pendingPayment.lnurl, amount);
        return await provider.payInvoice({
          invoice,
          preferSpark: true
          // amountSats intentionally omitted - LNURL invoice has amount encoded
        });
      }

      throw new Error('Unsupported payment type for Spark wallet');
    },

    async sendNWCPayment(amount, comment) {
      const activeWallet = this.getActiveWallet();
      if (!activeWallet?.nwcString) {
        throw new Error('No active NWC wallet found');
      }

      const lightningService = new LightningPaymentService(activeWallet.nwcString);
      return await lightningService.sendPayment(this.pendingPayment, amount, comment);
    },

    // Helper: Check if input is a Lightning invoice
    isLightningInvoice(input) {
      const lower = input.toLowerCase();
      return lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('lnbcrt');
    },

    // Helper: Check if input is a Lightning address
    isLightningAddress(input) {
      return input.includes('@') && !input.startsWith('lnurl');
    },

    // Helper: Check if input is an LNURL
    isLNURL(input) {
      const lower = input.toLowerCase();
      return lower.startsWith('lnurl');
    },

    // Helper: Get recipient address from pending payment
    getRecipientAddress() {
      if (!this.pendingPayment) return null;
      // Lightning address
      if (this.pendingPayment.lightningAddress) return this.pendingPayment.lightningAddress;
      // Spark address
      if (this.pendingPayment.sparkAddress) return this.pendingPayment.sparkAddress;
      // LNURL is not saveable as a stable address
      return null;
    },

    // Helper: Get recipient address type from pending payment
    getRecipientAddressType() {
      if (!this.pendingPayment) return 'lightning';
      if (this.pendingPayment.sparkAddress) return 'spark';
      return 'lightning';
    },

    // Save recipient as contact
    async saveRecipientAsContact() {
      try {
        if (!this.saveContactData.name?.trim()) {
          this.$q.notify({
            type: 'warning',
            message: this.$t('Please enter a name'),
            position: 'bottom'
          });
          return;
        }

        await this.addressBookStore.addEntry({
          name: this.saveContactData.name.trim(),
          address: this.saveContactData.address,
          addressType: this.saveContactData.addressType,
          notes: this.saveContactData.notes?.trim() || ''
        });

        this.showSaveContactDialog = false;
        this.$q.notify({
          type: 'positive',
          message: this.$t('Contact saved'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      } catch (error) {
        console.error('Error saving contact:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to save contact'),
          caption: this.$t('Please try again'),
          position: 'bottom'
        });
      }
    },

    // Close save contact dialog
    closeSaveContactDialog() {
      this.showSaveContactDialog = false;
      this.saveContactData = {
        address: '',
        addressType: 'lightning',
        name: '',
        notes: ''
      };
    },

    // Helper: Truncate address for display
    truncateAddress(address) {
      if (!address) return '';
      if (address.length <= 30) return address;
      const start = address.slice(0, 14);
      const end = address.slice(-10);
      return `${start}...${end}`;
    },

    // Helper: Fetch invoice from LNURL
    async fetchLNURLInvoice(lnurl, amountSats) {
      const url = this.decodeLNURL(lnurl);

      // Fetch LNURL endpoint
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch LNURL');

      const data = await response.json();
      if (data.status === 'ERROR') throw new Error(data.reason || 'LNURL error');

      // Validate amount bounds
      const minSats = Math.ceil((data.minSendable || 1000) / 1000);
      const maxSats = Math.floor((data.maxSendable || 100000000000) / 1000);
      if (amountSats < minSats || amountSats > maxSats) {
        throw new Error(`Amount must be between ${formatAmount(minSats, this.walletStore.useBip177Format)} and ${formatAmount(maxSats, this.walletStore.useBip177Format)}`);
      }

      // Request invoice
      const amountMs = amountSats * 1000;
      const callbackUrl = `${data.callback}?amount=${amountMs}`;
      const invoiceResponse = await fetch(callbackUrl);
      if (!invoiceResponse.ok) throw new Error('Failed to get invoice');

      const invoiceData = await invoiceResponse.json();
      if (invoiceData.status === 'ERROR') throw new Error(invoiceData.reason || 'Invoice error');

      return invoiceData.pr;
    },

    /**
     * Fetch LNURL info from a Lightning address
     * Returns min/max amounts and whether it's a fixed amount
     */
    async fetchLightningAddressInfo(address) {
      try {
        const [username, domain] = address.split('@');
        if (!username || !domain) {
          return {};
        }

        const endpoint = `https://${domain}/.well-known/lnurlp/${username}`;
        const response = await fetch(endpoint);

        if (!response.ok) {
          return {};
        }

        const data = await response.json();

        if (data.status === 'ERROR') {
          return {};
        }

        const minSendable = data.minSendable || 1000;
        const maxSendable = data.maxSendable || 100000000000;
        const isFixedAmount = minSendable === maxSendable;

        return {
          minSendable,
          maxSendable,
          minSats: Math.ceil(minSendable / 1000),
          maxSats: Math.floor(maxSendable / 1000),
          isFixedAmount,
          fixedAmountSats: isFixedAmount ? Math.floor(minSendable / 1000) : null,
          commentAllowed: data.commentAllowed || 0,
          description: data.metadata ? this.parseLnurlMetadata(data.metadata) : null
        };
      } catch (error) {
        console.warn('Failed to fetch Lightning address info:', error.message);
        return {};
      }
    },

    /**
     * Parse LNURL metadata to extract description
     */
    parseLnurlMetadata(metadata) {
      try {
        const parsed = JSON.parse(metadata);
        const textEntry = parsed.find(entry => entry[0] === 'text/plain');
        return textEntry ? textEntry[1] : null;
      } catch {
        return null;
      }
    },

    // Helper: Decode LNURL (bech32) to URL
    decodeLNURL(lnurl) {
      const input = lnurl.toLowerCase().replace('lightning:', '');
      const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
      const hrpEnd = input.lastIndexOf('1');
      if (hrpEnd < 1) throw new Error('Invalid LNURL');

      const data = input.slice(hrpEnd + 1);
      const values = [];

      for (const char of data) {
        const index = CHARSET.indexOf(char);
        if (index === -1) throw new Error('Invalid LNURL character');
        values.push(index);
      }

      // Remove checksum (last 6 chars)
      const dataValues = values.slice(0, -6);

      // Convert 5-bit to 8-bit
      let bits = 0;
      let value = 0;
      const bytes = [];

      for (const v of dataValues) {
        value = (value << 5) | v;
        bits += 5;
        while (bits >= 8) {
          bits -= 8;
          bytes.push((value >> bits) & 0xff);
        }
      }

      return new TextDecoder().decode(new Uint8Array(bytes));
    },

    async updateSecondaryValue() {
      if (this.walletState.balance !== undefined) {
        this.secondaryValue = await this.getSecondaryValue(this.walletState.balance);
      }
    },

    async updatePaymentFiatValue() {
      this.paymentFiatValue = await this.formatPaymentFiat();
      // Also update fee estimate when payment changes
      await this.updateFeeEstimate();
    },

    async updateFeeEstimate() {
      // Only estimate fees for Spark wallet Lightning payments
      if (!this.pendingPayment || !this.walletStore.isActiveWalletSpark) {
        this.estimatedFee = null;
        this.isEstimatingFee = false;
        return;
      }

      // Spark-to-Spark transfers are free
      if (this.pendingPayment.sparkAddress) {
        this.estimatedFee = null;
        this.isEstimatingFee = false;
        return;
      }

      // Only estimate for Lightning invoices
      if (!this.pendingPayment.invoice) {
        // For LNURL/Lightning Address, calculate estimated fee based on amount
        const amount = this.getPaymentAmountForFee();
        if (amount > 0) {
          this.estimatedFee = this.calculateRecommendedFee(amount);
        } else {
          this.estimatedFee = null;
        }
        this.isEstimatingFee = false;
        return;
      }

      // Get fee estimate from Spark SDK for Lightning invoices
      this.isEstimatingFee = true;
      try {
        const provider = await this.walletStore.ensureSparkConnected();
        const estimate = await provider.getLightningSendFeeEstimate(this.pendingPayment.invoice);
        this.estimatedFee = estimate.estimatedFeeSats;
      } catch (error) {
        console.warn('Fee estimation failed:', error.message);
        // Fall back to calculated fee
        const amount = this.pendingPayment.amount || this.getPaymentAmountForFee();
        if (amount > 0) {
          this.estimatedFee = this.calculateRecommendedFee(amount);
        } else {
          this.estimatedFee = null;
        }
      } finally {
        this.isEstimatingFee = false;
      }
    },

    // Calculate recommended fee for Lightning payments (17 basis points, min 5 sats)
    calculateRecommendedFee(amountSats) {
      const minFee = 5;
      const bpsFee = Math.ceil(amountSats * 0.0017);
      return Math.max(minFee, bpsFee);
    },

    getPaymentAmountForFee() {
      if (!this.pendingPayment) return 0;
      if (this.paymentAmount && parseInt(this.paymentAmount) > 0) {
        return parseInt(this.paymentAmount);
      }
      if (this.pendingPayment.fixedAmountSats) {
        return this.pendingPayment.fixedAmountSats;
      }
      if (this.pendingPayment.amount > 0) {
        return this.pendingPayment.amount;
      }
      if (this.pendingPayment.minSendable === this.pendingPayment.maxSendable && this.pendingPayment.minSendable) {
        return Math.floor(this.pendingPayment.minSendable / 1000);
      }
      return 0;
    },

    startInvoiceMonitoring() {
      if (this.invoiceCheckInterval) {
        clearInterval(this.invoiceCheckInterval);
      }

      this.invoiceCheckInterval = setInterval(async () => {
        await this.checkInvoiceStatus();
      }, 2000);
    },

    stopInvoiceMonitoring() {
      if (this.invoiceCheckInterval) {
        clearInterval(this.invoiceCheckInterval);
        this.invoiceCheckInterval = null;
      }
    },

    onInvoiceCreated(invoice) {
      console.log('Invoice created:', invoice);
      this.generatedInvoice = invoice;
      this.currentInvoicePaymentHash = invoice.paymentHash;
      this.waitingForPayment = true;
      this.startInvoiceMonitoring();
    }
  }
};
</script>

<style scoped>
/* Base Page Styles */
.wallet-page-dark {
  background: #171717;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.wallet-page-light {
  background: #f8f9fa;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.wallet-header {
  padding: 1rem;
  flex-shrink: 0;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.logo-svg {
  filter: drop-shadow(0 2px 4px rgba(5, 149, 115, 0.15));
}

.title {
  font-size: 1.25rem;
  font-weight: 700;
  background: linear-gradient(135deg, #059573, #10b981, #34d399, #06b6d4, #0891b2, #0284c7);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  -moz-background-clip: text;
  background-size: 400% 400%;
  animation: gradientShift 6s ease-in-out infinite;
}

.title-dark {
  background: linear-gradient(135deg, #059573, #10b981, #34d399, #06b6d4, #0891b2, #0284c7);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.title-light {
  background: linear-gradient(135deg, #059573, #10b981, #34d399, #06b6d4, #0891b2, #0284c7);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

@keyframes gradientShift {
  0% {
    background-position: 0% 0%;
  }
  25% {
    background-position: 100% 0%;
  }
  50% {
    background-position: 100% 100%;
  }
  75% {
    background-position: 0% 100%;
  }
  100% {
    background-position: 0% 0%;
  }
}

.modern-menu-btn-dark,
.modern-menu-btn-light {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease, transform 0.1s ease;
  position: relative;
}

.modern-menu-btn-dark {
  color: #F6F6F6;
}

.modern-menu-btn-dark:hover {
  background: #2A342A;
}

.modern-menu-btn-light {
  color: #374151;
}

.modern-menu-btn-light:hover {
  background: #f1f5f9;
}

.menu-icon {
  display: flex;
  flex-direction: column;
  gap: 2.5px;
  width: 16px;
  height: 12px;
}

.menu-line {
  height: 1.5px;
  border-radius: 0.75px;
  transition: all 0.2s ease;
}

.menu-line-dark {
  background: #F6F6F6;
}

.menu-line-light {
  background: #374151;
}

/* Main Content */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 2rem 1rem 8rem 1rem;
}

/* Wallet Name Badge */
.wallet-name-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  border-radius: 16px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  margin-bottom: 1rem;
  border: 1px solid;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.wallet-badge-dark {
  background: rgba(38, 38, 38, 0.6);
  border-color: rgba(21, 222, 114, 0.3);
  color: #a1a1a1;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.wallet-badge-light {
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(5, 149, 115, 0.35);
  color: #6b6b6b;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.wallet-badge-dark:hover {
  background: rgba(38, 38, 38, 0.8);
  border-color: rgba(21, 222, 114, 0.6);
  color: #d4d4d4;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(21, 222, 114, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.wallet-badge-light:hover {
  background: rgba(255, 255, 255, 0.8);
  border-color: rgba(5, 149, 115, 0.55);
  color: #3f3f3f;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(5, 149, 115, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.15);
}

.wallet-badge-icon {
  opacity: 0.7;
  transition: opacity 0.3s ease;
}

.wallet-badge-dark:hover .wallet-badge-icon {
  opacity: 1;
}

.wallet-badge-light:hover .wallet-badge-icon {
  opacity: 1;
}

.wallet-badge-text {
  font-family: 'Inter', sans-serif;
  letter-spacing: -0.01em;
}

/* Balance Section */
.balance-section {
  text-align: center;
  margin-bottom: 2rem;
}

.balance-container {
  cursor: pointer;
  transition: all 0.2s;
  border-radius: 16px;
  padding: 1rem;
}

.balance-amount {
  margin-bottom: 1rem;
}

.amount-display {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.75rem;
}

.amount-number {
  font-size: 4rem;
  font-weight: 800;
  line-height: 1;
}

.amount-number-dark {
  color: #FFF;
}

.amount-number-light {
  color: #1f2937;
}

.amount-unit {
  font-size: 1.5rem;
  font-weight: 600;
}

.amount-unit-dark {
  color: #B0B0B0;
}

.amount-unit-light {
  color: #6b7280;
}

.currency-icon-left {
  display: flex;
  align-items: center;
  margin-right: 0.75rem;
}

.currency-icon-right {
  display: flex;
  align-items: center;
  margin-left: 0.5rem;
}

.balance-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.balance-icon-dark {
  filter: brightness(0) invert(1);
}

.balance-icon-light {
  filter: brightness(0);
}

.balance-secondary {
  font-size: 1.25rem;
  font-weight: 400;
}

.secondary-amount-display {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.secondary-value {
  display: inline;
}

.secondary-icon-left {
  display: inline-flex;
  align-items: center;
  margin-right: 0.4rem;
}

.secondary-icon-right {
  display: inline-flex;
  align-items: center;
  margin-left: 0.4rem;
}

.secondary-icon {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.balance-secondary-dark {
  color: #B0B0B0;
}

.balance-secondary-light {
  color: #9ca3af;
}

/* Balance Transitions */
.balance-fade-enter-active,
.balance-fade-leave-active,
.secondary-fade-enter-active,
.secondary-fade-leave-active {
  transition: all 0.2s ease;
}

.balance-fade-enter-from,
.balance-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.95);
}

.secondary-fade-enter-from,
.secondary-fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

/* Transaction History Button */
.transaction-icon-section {
  display: flex;
  justify-content: center;
  margin-bottom: 2rem;
}

.transaction-history-btn-dark,
.transaction-history-btn-light {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  transition: transform 0.1s ease;
  opacity: 0.6;
}

.transaction-history-btn-dark {
  background: #2A342A;
  color: #B0B0B0;
}

.transaction-history-btn-light {
  background: #f8f9fa;
  color: #6b7280;
}

.transaction-history-btn-dark:active,
.transaction-history-btn-light:active {
  transform: scale(0.95);
}

.transaction-history-btn-dark.pulse,
.transaction-history-btn-light.pulse {
  animation: subtle-pulse 1s ease-out;
}

@keyframes subtle-pulse {
  0% {
    opacity: 0.6;
    transform: scale(1);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.02);
  }
  100% {
    opacity: 0.6;
    transform: scale(1);
  }
}

/* Bottom Actions */
.bottom-actions {
  padding: 1rem 1.5rem 2rem 1.5rem;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
}

.action-buttons {
  display: flex;
  gap: 1rem;
  max-width: 400px;
  margin: 0 auto;
}

.action-btn {
  flex: 1;
  height: 72px;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  font-weight: 600;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
  min-height: 72px;
  min-width: 120px;
}

.action-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
}

.action-btn:active {
  transform: translateY(0) scale(0.98);
}

.receive-btn-dark,
.receive-btn-light {
  background: linear-gradient(135deg, #059573, #43B65B);
  color: white;
}

.receive-btn-dark:hover,
.receive-btn-light:hover {
  background: linear-gradient(135deg, #047857, #059573);
}

.send-btn-dark,
.send-btn-light {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
  color: white;
}

.send-btn-dark:hover,
.send-btn-light:hover {
  background: linear-gradient(135deg, #2563EB, #1D4ED8);
}

.btn-text {
  font-size: 1rem;
  font-weight: 600;
}

/* Dialog Header Styles */
.dialog_header_dark {
  background: #0C0C0C;
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #2A342A;
}

.dialog_header_light {
  background: #f8f9fa;
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e5e7eb;
}

/* Close Button Styles */
.close_btn_dark {
  color: #B0B0B0;
}

.close_btn_light {
  color: #6b7280;
}

/* Dialog Content */
.dialog-content {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Payment Input Section */
.payment-input-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.payment_input_dark :deep(.q-field__control) {
  background: #171717;
  color: #FFF;
  border: 1px solid #2A342A;
  border-radius: 12px;
}

.payment_input_light :deep(.q-field__control) {
  background: white;
  color: #1f2937;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.input-actions {
  display: flex;
  gap: 0.75rem;
}

.scan_btn_dark,
.paste_btn_dark {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: #15DE72;
  border: 1px solid #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

.scan_btn_light,
.paste_btn_light {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: #059573;
  border: 1px solid #059573;
  background: rgba(5, 149, 115, 0.05);
}

.scan_btn_dark:hover,
.paste_btn_dark:hover {
  background: rgba(21, 222, 114, 0.2);
  transform: translateY(-1px);
}

.scan_btn_light:hover,
.paste_btn_light:hover {
  background: rgba(5, 149, 115, 0.1);
  transform: translateY(-1px);
}

/* Payment Type Section */
.payment_type_dark {
  background: rgba(21, 222, 114, 0.1);
  border: 1px solid rgba(21, 222, 114, 0.3);
  border-radius: 12px;
  padding: 1rem;
}

.payment_type_light {
  background: rgba(5, 149, 115, 0.05);
  border: 1px solid rgba(5, 149, 115, 0.2);
  border-radius: 12px;
  padding: 1rem;
}

.type-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.type-icon {
  color: #15DE72;
  font-weight: 500;
}

.type_label_dark {
  color: #15DE72;
  font-weight: 500;
}

.type_label_light {
  color: #059573;
  font-weight: 500;
}

/* Amount Section */
.amount_section_dark {
  background: #171717;
  border: 1px solid #2A342A;
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.amount_section_light {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.amount_limits_dark {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #B0B0B0;
  background: #0C0C0C;
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid #2A342A;
}

.amount_limits_light {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #6b7280;
  background: white;
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}

.limits-icon {
  color: #3b82f6;
  font-size: 16px;
}

/* Payment Content */
.payment-content {
  padding: 1.5rem;
}

.payment-info {
  text-align: center;
}

.payment-amount {
  margin-bottom: 1.5rem;
}

.amount_display_dark {
  font-size: 2rem;
  font-weight: 700;
  color: #FFF;
  margin-bottom: 0.5rem;
}

.amount_display_light {
  font-size: 2rem;
  font-weight: 700;
  color: #1f2937;
  margin-bottom: 0.5rem;
}

.amount_fiat_dark {
  font-size: 1rem;
  color: #B0B0B0;
}

.amount_fiat_light {
  font-size: 1rem;
  color: #6b7280;
}

/* Payment Details */
.payment_details_dark {
  background: #171717;
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1.5rem;
  border: 1px solid #2A342A;
}

.payment_details_light {
  background: #f9fafb;
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1.5rem;
  border: 1px solid #e5e7eb;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.detail-item:last-child {
  margin-bottom: 0;
}

.detail_label_dark {
  font-weight: 500;
  color: #B0B0B0;
}

.detail_label_light {
  font-weight: 500;
  color: #6b7280;
}

.detail_value_dark {
  color: #FFF;
  word-break: break-all;
}

.detail_value_light {
  color: #1f2937;
  word-break: break-all;
}

/* Fee estimate states */
.fee-loading {
  color: #9ca3af;
  font-style: italic;
}

.fee-free {
  color: #10B981;
  font-weight: 500;
}

/* Amount Input Section */
.amount-input-section {
  text-align: left;
}

.amount_input_dark :deep(.q-field__control),
.comment_input_dark :deep(.q-field__control) {
  background: #171717;
  color: #FFF;
  border: 1px solid #2A342A;
  border-radius: 12px;
  margin-bottom: 1rem;
}

.amount_input_light :deep(.q-field__control),
.comment_input_light :deep(.q-field__control) {
  background: white;
  color: #1f2937;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  margin-bottom: 1rem;
}

/* Payment Actions */
.payment_actions_dark {
  background: #0C0C0C;
  border-top: 1px solid #2A342A;
}

.payment_actions_light {
  background: #f8f9fa;
  border-top: 1px solid #e5e7eb;
}

.cancel_btn_dark {
  color: #B0B0B0;
}

.cancel_btn_light {
  color: #6b7280;
}

/* Invoice Form */
.invoice-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.description_input_dark :deep(.q-field__control) {
  background: #171717;
  color: #FFF;
  border: 1px solid #2A342A;
  border-radius: 12px;
}

.description_input_light :deep(.q-field__control) {
  background: white;
  color: #1f2937;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.create-invoice-btn {
  width: 100%;
  height: 52px;
  border-radius: 16px;
  font-weight: 600;
  font-size: 1rem;
  transition: all 0.2s ease;
}

/* Invoice Result */
.invoice-result {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: center;
}

/* Payment Success State */
.payment_success_dark {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem 1rem;
  background: rgba(21, 222, 114, 0.1);
  border: 2px solid rgba(21, 222, 114, 0.3);
  border-radius: 16px;
  text-align: center;
}

.payment_success_light {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem 1rem;
  background: rgba(34, 197, 94, 0.05);
  border: 2px solid rgba(34, 197, 94, 0.2);
  border-radius: 16px;
  text-align: center;
}

.success-icon {
  margin-bottom: 0.5rem;
}

.success_text_dark {
  font-size: 1.5rem;
  font-weight: 700;
  color: #15DE72;
  margin-bottom: 0.5rem;
}

.success_text_light {
  font-size: 1.5rem;
  font-weight: 700;
  color: #059669;
  margin-bottom: 0.5rem;
}

.success_amount_dark {
  font-size: 1.25rem;
  font-weight: 600;
  color: #15DE72;
}

.success_amount_light {
  font-size: 1.25rem;
  font-weight: 600;
  color: #059573;
}

/* Compact Invoice */
.compact-invoice {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: center;
}

.qr_code_section_dark,
.qr_code_section_light {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1rem;
  border-radius: 16px;
  margin-bottom: 0.75rem;
  width: 100%;
  max-width: 280px;
  margin-left: auto;
  margin-right: auto;
  box-sizing: border-box;
}

.qr_code_section_dark {
  background: #FFF;
  border: 1px solid #2A342A;
}

.qr_code_section_light {
  background: white;
  border: 1px solid #e5e7eb;
}

.qr-code {
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
  height: auto;
  max-width: 240px;
}

.qr-code-section.compact .qr-code {
  max-width: 200px;
}

.invoice_info_compact_dark {
  text-align: center;
  padding: 0.75rem;
  background: #171717;
  border-radius: 12px;
  margin-bottom: 1rem;
  border: 1px solid #2A342A;
}

.invoice_info_compact_light {
  text-align: center;
  padding: 0.75rem;
  background: #f8f9fa;
  border-radius: 12px;
  margin-bottom: 1rem;
  border: 1px solid #e5e7eb;
}

.amount_compact_dark {
  font-size: 1.25rem;
  font-weight: 700;
  color: #15DE72;
  margin-bottom: 0.25rem;
}

.amount_compact_light {
  font-size: 1.25rem;
  font-weight: 700;
  color: #059573;
  margin-bottom: 0.25rem;
}

.description_compact_dark {
  color: #B0B0B0;
  font-size: 0.8rem;
  font-weight: 500;
  margin-bottom: 0.75rem;
}

.description_compact_light {
  color: #6b7280;
  font-size: 0.8rem;
  font-weight: 500;
  margin-bottom: 0.75rem;
}

.waiting_indicator_compact_dark {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.waiting_indicator_compact_light {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.waiting_text_compact_dark {
  font-size: 0.875rem;
  color: #3b82f6;
  font-weight: 500;
}

.waiting_text_compact_light {
  font-size: 0.875rem;
  color: #3b82f6;
  font-weight: 500;
}

/* Copy Invoice Button */
.copy_invoice_btn_compact_dark {
  width: 100%;
  height: 40px;
  border-radius: 8px;
  font-weight: 500;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  color: #15DE72;
  background: rgba(21, 222, 114, 0.1);
  border: 1px solid #15DE72;
}

.copy_invoice_btn_compact_light {
  width: 100%;
  height: 40px;
  border-radius: 8px;
  font-weight: 500;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  color: #059573;
  background: rgba(5, 149, 115, 0.05);
  border: 1px solid #059573;
}

.copy_invoice_btn_compact_dark:hover {
  background: #15DE72;
  color: #0C0C0C;
}

.copy_invoice_btn_compact_light:hover {
  background: #059573;
  color: white;
}

/* Static Invoice */
.static-invoice {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  text-align: center;
}

.amount-section {
  padding: 1rem;
}

.amount_value_dark {
  font-size: 1.5rem;
  font-weight: 700;
  color: #15DE72;
  margin-bottom: 0.5rem;
}

.amount_value_light {
  font-size: 1.5rem;
  font-weight: 700;
  color: #059573;
  margin-bottom: 0.5rem;
}

.description_text_dark {
  color: #B0B0B0;
  font-size: 0.875rem;
  font-weight: 500;
}

.description_text_light {
  color: #6b7280;
  font-size: 0.875rem;
  font-weight: 500;
}

.copy_invoice_btn_dark {
  width: 100%;
  height: 48px;
  border-radius: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: #15DE72;
  border: 1px solid #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

.copy_invoice_btn_light {
  width: 100%;
  height: 48px;
  border-radius: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: #059573;
  border: 1px solid #059573;
  background: rgba(5, 149, 115, 0.05);
}

.copy_invoice_btn_dark:hover {
  background: #15DE72;
  color: #0C0C0C;
}

.copy_invoice_btn_light:hover {
  background: #059573;
  color: white;
}

/* QR Scanner */
.qr_scanner_container_dark {
  height: 300px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #2A342A;
  background: #171717;
  z-index: 5000;
}

.qr_scanner_container_light {
  height: 300px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  background: #f8f9fa;
  z-index: 5000;
}

/* Responsive Design */
@media (max-width: 480px) {
  .bottom-actions {
    padding: 0.75rem 1rem 1.5rem 1rem;
  }

  .action-buttons {
    gap: 0.75rem;
  }

  .action-btn {
    height: 68px;
    min-height: 68px;
    min-width: 100px;
  }

  .main-content {
    padding: 1.5rem 1rem 7rem 1rem;
  }

  .amount-number {
    font-size: 3rem;
  }

  .amount-unit {
    font-size: 1.25rem;
  }

  .dialog-content {
    padding: 1rem;
    gap: 1rem;
  }

  .create-invoice-btn {
    height: 48px;
    font-size: 0.9rem;
  }

  .amount_display_dark,
  .amount_display_light {
    font-size: 1.5rem;
  }

  .payment-content {
    padding: 1rem;
  }

  /* QR Code responsive for mobile */
  .qr_code_section_dark,
  .qr_code_section_light {
    max-width: 240px;
    padding: 0.75rem;
  }

  .qr-code {
    max-width: 200px;
  }

  .qr-code-section.compact .qr-code {
    max-width: 160px;
  }
}

/* Extra small screens (320px and below) */
@media (max-width: 360px) {
  .qr_code_section_dark,
  .qr_code_section_light {
    max-width: 200px;
    padding: 0.5rem;
  }

  .qr-code {
    max-width: 160px;
  }

  .qr-code-section.compact .qr-code {
    max-width: 140px;
  }

  .amount_compact_dark,
  .amount_compact_light {
    font-size: 1.1rem;
  }

  .compact-invoice {
    gap: 1rem;
  }
}

/* Wallet Switcher Dialog */
.wallet-switcher-card {
  width: 100%;
  max-width: 360px;
  border-radius: 20px;
  overflow: hidden;
}

.switcher-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}

.switcher-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

.switcher-content {
  padding: 0.5rem;
  max-height: 320px;
  overflow-y: auto;
}

.wallet-switch-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

/* Wallet Switch Card - iOS style */
.wallet-switch-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0.875rem;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.wallet-switch-card-dark {
  background: transparent;
}

.wallet-switch-card-light {
  background: transparent;
}

.wallet-switch-card-dark:hover {
  background: #222;
}

.wallet-switch-card-light:hover {
  background: #F3F4F6;
}

.wallet-switch-card-active {
  box-shadow: inset 0 0 0 1px #15DE72;
  background: rgba(21, 222, 114, 0.03) !important;
}

.wallet-switch-card-active.wallet-switch-card-dark:hover {
  background: rgba(21, 222, 114, 0.06) !important;
}

.wallet-switch-card-active.wallet-switch-card-light:hover {
  background: rgba(21, 222, 114, 0.05) !important;
}

/* Switch Avatar */
.switch-avatar {
  position: relative;
  flex-shrink: 0;
}

.switch-avatar-circle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.wallet-green {
  background: linear-gradient(135deg, #15DE72, #059573);
}

.wallet-blue {
  background: linear-gradient(135deg, #3B82F6, #2563EB);
}

.wallet-purple {
  background: linear-gradient(135deg, #8B5CF6, #7C3AED);
}

.wallet-orange {
  background: linear-gradient(135deg, #F59E0B, #D97706);
}

.wallet-red {
  background: linear-gradient(135deg, #EF4444, #DC2626);
}

.switch-status-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid;
}

.wallet-switch-card-dark .switch-status-dot {
  border-color: #0C0C0C;
}

.wallet-switch-card-light .switch-status-dot {
  border-color: #FFF;
}

.status-connected {
  background: #15DE72;
}

.status-disconnected {
  background: #EF4444;
}

/* Switch Details */
.switch-details {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.switch-name {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 0.125rem;
}

.switch-name-dark {
  color: #F6F6F6;
}

.switch-name-light {
  color: #212121;
}

/* Meta Row with Badges */
.switch-meta-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-bottom: 0.25rem;
  flex-wrap: wrap;
}

.switch-type-badge {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.1rem 0.35rem;
  border-radius: 5px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 8px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: white;
}

.type-spark {
  background: linear-gradient(135deg, #15DE72, #059573);
}

.type-nwc {
  background: linear-gradient(135deg, #6B7280, #4B5563);
}

.switch-tag {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 8px;
  font-weight: 600;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  text-transform: capitalize;
  letter-spacing: 0.02em;
}

.tag-active {
  background: #D1FAE5;
  color: #065F46;
}

/* Switch Balance */
.switch-balance {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 11px;
  font-weight: 500;
}

.switch-balance-dark {
  color: #777;
}

.switch-balance-light {
  color: #9CA3AF;
}

/* Check Icon */
.switch-check-icon {
  flex-shrink: 0;
  color: #15DE72;
}

/* Switcher Footer */
.switcher-footer {
  padding: 0.75rem 1rem;
  border-top: 1px solid;
  display: flex;
  justify-content: center;
}

.switcher-footer-dark {
  border-top-color: #222;
  background: #171717;
}

.switcher-footer-light {
  border-top-color: #E5E7EB;
  background: #F8F9FA;
}

.manage-wallets-btn {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  border-radius: 10px;
  padding: 0.5rem 1rem;
  transition: all 0.15s ease;
}

.manage-btn-dark {
  color: #888;
}

.manage-btn-light {
  color: #6B7280;
}

.manage-wallets-btn:hover {
  background: rgba(107, 114, 128, 0.1);
}

.manage-btn-dark:hover {
  color: #F6F6F6;
}

.manage-btn-light:hover {
  color: #374151;
}

/* Save Contact Dialog */
.save-contact-dialog :deep(.q-dialog__backdrop) {
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.save-contact-card {
  width: 100%;
  max-width: 400px;
  border-radius: 24px;
}

.save-contact-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}

.save-contact-content {
  padding: 1.25rem;
}

.save-contact-address {
  display: flex;
  align-items: center;
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 13px;
  padding: 0.75rem;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.1);
}

.address-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.save-contact-actions {
  border-top: 1px solid rgba(128, 128, 128, 0.2);
  padding: 0.75rem 1rem;
}

.save-btn {
  color: #15DE72 !important;
  font-weight: 600;
}

.save-btn:disabled {
  color: #6b7280 !important;
  opacity: 0.5;
}

/* Save input styles - dark mode */
.save-input-dark :deep(.q-field__control) {
  border-color: rgba(255, 255, 255, 0.2) !important;
}

.save-input-dark :deep(.q-field--focused .q-field__control) {
  border-color: #15DE72 !important;
}

.save-input-dark :deep(.q-field__label) {
  color: #B0B0B0;
}

.save-input-dark :deep(.q-field--focused .q-field__label),
.save-input-dark :deep(.q-field--float .q-field__label) {
  color: #15DE72 !important;
}

.save-input-dark :deep(.q-field__native) {
  color: #FFF !important;
}

/* Save input styles - light mode */
.save-input-light :deep(.q-field__control) {
  border-color: rgba(0, 0, 0, 0.15) !important;
}

.save-input-light :deep(.q-field--focused .q-field__control) {
  border-color: #15DE72 !important;
}

.save-input-light :deep(.q-field__label) {
  color: #6B7280;
}

.save-input-light :deep(.q-field--focused .q-field__label),
.save-input-light :deep(.q-field--float .q-field__label) {
  color: #15DE72 !important;
}

.save-input-light :deep(.q-field__native) {
  color: #212121 !important;
}

/* Bitcoin Incoming Chip (Header) */
.btc-incoming-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  margin-left: 12px;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: Fustat, sans-serif;
}

.btc-incoming-chip:active {
  transform: scale(0.95);
}

.btc-chip-dark {
  background: rgba(247, 147, 26, 0.2);
  border: 1px solid rgba(247, 147, 26, 0.4);
}

.btc-chip-light {
  background: rgba(247, 147, 26, 0.12);
  border: 1px solid rgba(247, 147, 26, 0.3);
}

.btc-chip-icon {
  color: #F7931A;
}

.btc-chip-text {
  font-size: 12px;
  font-weight: 600;
  color: #F7931A;
  white-space: nowrap;
}

/* Animation for chip */
.btc-banner-fade-enter-active,
.btc-banner-fade-leave-active {
  transition: all 0.3s ease;
}

.btc-banner-fade-enter-from,
.btc-banner-fade-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}
</style>
