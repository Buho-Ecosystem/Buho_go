<template>
  <q-dialog
    v-model="show"
    maximized
    transition-show="slide-up"
    transition-hide="slide-down"
    class="receive-modal"
    @before-hide="stopPaymentMonitor"
  >
    <q-card class="receive-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <!-- Header -->
      <q-card-section class="receive-header" :class="$q.dark.isActive ? 'header-dark' : 'header-light'">
        <div class="header-content">
          <q-btn
            flat
            round
            dense
            @click="handleHeaderBack"
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
            {{ headerTitle }}
          </div>
          <div class="header-actions"></div>
        </div>
      </q-card-section>

      <!-- Content -->
      <q-card-section class="receive-content">
        <!-- Receive Mode Toggle (for Spark wallets) -->
        <div v-if="isSparkWallet && !showSpecificInvoiceView && !showAmountInput" class="receive-type-toggle">
          <q-btn-toggle
            v-model="receiveMode"
            :options="receiveModeOptions"
            class="type-toggle"
            :class="$q.dark.isActive ? 'toggle-dark' : 'toggle-light'"
            :toggle-text-color="$q.dark.isActive ? 'white' : 'dark'"
            no-caps
            unelevated
            spread
          />
          <div class="mode-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            <template v-if="receiveMode === 'spark'">
              {{ $t('Spark-to-Spark only, zero fees') }}
            </template>
            <template v-else-if="receiveMode === 'bitcoin'">
              {{ $t('From any Bitcoin wallet (takes ~10-60 min)') }}
            </template>
            <template v-else>
              {{ $t('One-time request with amount') }}
            </template>
          </div>
        </div>

        <!-- Spark Address View -->
        <div v-if="showSparkAddressView && sparkAddress" class="spark-address-view">
          <!-- QR Code Section -->
          <div class="qr-section">
            <div class="qr-card" @click="copySparkAddress">
              <div class="qr-frame">
                <vue-qrcode
                  ref="sparkQr"
                  :value="sparkAddress"
                  :options="sparkQrOptions"
                  class="qr-code"
                />
              </div>
            </div>
            <div class="qr-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ $t('Tap QR to copy address') }}
            </div>
          </div>

          <!-- Address Display - Compact Pill -->
          <div
            class="address-pill"
            :class="$q.dark.isActive ? 'pill-dark' : 'pill-light'"
            @click="copySparkAddress"
          >
            <img :src="sparkPillIcon" class="pill-icon-img" />
            <span class="pill-address">{{ truncateSparkAddress(sparkAddress) }}</span>
            <Icon icon="tabler:copy" width="14" height="14" class="pill-copy" />
          </div>

          <!-- Action Buttons -->
          <div class="action-buttons">
            <button
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="copySparkAddress"
            >
              <Icon icon="tabler:copy" width="18" height="18" />
              <span>{{ $t('Copy Request') }}</span>
            </button>
            <button
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="shareSparkAddress"
            >
              <Icon icon="tabler:share" width="18" height="18" />
              <span>{{ $t('Share Invoice') }}</span>
            </button>
          </div>

          <!-- User Hint -->
          <div class="address-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ $t('Share this address to receive zero-fee payments from other Spark wallets.') }}
          </div>
        </div>

        <!-- Bitcoin (L1) Receive View -->
        <L1BitcoinReceive
          v-if="showBitcoinReceiveView"
          :qr-options="qrOptions"
          @deposit-claimed="handleBitcoinDepositClaimed"
          @deposits-updated="handleBitcoinDepositsUpdated"
        />

        <!-- Loading: minting default zero-amount Spark invoice -->
        <div v-if="showDefaultZeroLoading" class="default-zero-loading">
          <q-spinner-dots size="40px" :color="$q.dark.isActive ? 'white' : 'grey-7'" />
          <div class="default-zero-loading-text" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ $t('Preparing invoice...') }}
          </div>
        </div>

        <!-- Specific-amount Lightning Invoice Display -->
        <div class="lightning-receive" v-else-if="showSpecificInvoiceView">
          <!-- Amount Section -->
          <div class="ln-amount-section">
            <span class="ln-amount" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">
              {{ formatInvoiceAmount(generatedInvoice.amount) }}
            </span>
            <span class="ln-fiat" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ formatInvoiceFiat(generatedInvoice.amount) }}
            </span>
            <span v-if="generatedInvoice.description && generatedInvoice.description !== 'BuhoGO Payment'"
                  class="ln-memo" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ generatedInvoice.description }}
            </span>
          </div>

          <!-- QR Code - Same structure as Spark/Bitcoin -->
          <div class="qr-section">
            <div class="qr-card" @click="copyInvoice">
              <div class="qr-frame">
                <vue-qrcode
                  ref="invoiceQr"
                  :value="'lightning:' + generatedInvoice.payment_request.toUpperCase()"
                  :options="invoiceQrOptions"
                  class="qr-code"
                />
              </div>
            </div>
            <!-- Status -->
            <div class="ln-status" :class="paymentStatusClass">
              <div class="ln-status-dot"></div>
              <span>{{ paymentStatusMessage || $t('Waiting for payment...') }}</span>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="action-buttons">
            <button
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="copyInvoice"
            >
              <Icon icon="tabler:copy" width="18" height="18" />
              <span>{{ $t('Copy Request') }}</span>
            </button>
            <button
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="shareInvoice"
            >
              <Icon icon="tabler:share" width="18" height="18" />
              <span>{{ $t('Share Invoice') }}</span>
            </button>
          </div>
        </div>

        <!-- Default Zero-amount Spark Lightning Invoice -->
        <div class="lightning-receive" v-else-if="showDefaultZeroInvoiceView">
          <div class="qr-section">
            <div class="qr-card" @click="copyInvoice">
              <div class="qr-frame">
                <vue-qrcode
                  ref="invoiceQr"
                  :value="'lightning:' + generatedInvoice.payment_request.toUpperCase()"
                  :options="invoiceQrOptions"
                  class="qr-code"
                />
              </div>
            </div>
            <div class="qr-hint" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
              {{ $t('Any amount · tap QR to copy') }}
            </div>
            <div class="ln-status" :class="paymentStatusClass">
              <div class="ln-status-dot"></div>
              <span>{{ paymentStatusMessage || $t('Waiting for payment...') }}</span>
            </div>
          </div>

          <div class="action-buttons action-buttons-three">
            <button
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="$emit('scan-withdraw')"
            >
              <Icon icon="tabler:download" width="18" height="18" />
              <span>{{ $t('Redeem') }}</span>
            </button>
            <button
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="shareInvoice"
            >
              <Icon icon="tabler:share" width="18" height="18" />
              <span>{{ $t('Share') }}</span>
            </button>
            <button
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="tapAmountButton"
            >
              <Icon icon="tabler:edit" width="18" height="18" />
              <span>{{ $t('Amount') }}</span>
            </button>
          </div>
        </div>

        <!-- Lightning Address View (default for NWC/LNbits with LN address) -->
        <div v-else-if="showLightningAddressView" class="address-view">
          <!-- Centered QR Section -->
          <div class="address-qr-section">
            <div class="qr-container" @click="copyLightningAddress">
              <div class="qr-wrapper">
                <vue-qrcode
                  ref="lightningAddressQr"
                  :value="'lightning:' + lightningAddress"
                  :options="qrOptions"
                  class="qr-code"
                />
              </div>
            </div>

            <!-- Address Display -->
            <div
              class="address-display-box"
              :class="$q.dark.isActive ? 'address-box-dark' : 'address-box-light'"
              @click="copyLightningAddress"
            >
              <Icon icon="tabler:at" width="18" height="18" class="address-icon" />
              <span class="address-text-value">{{ lightningAddress }}</span>
              <Icon icon="tabler:copy" width="14" height="14" class="copy-icon" />
            </div>
          </div>

          <div class="action-buttons action-buttons-three">
            <button
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="$emit('scan-withdraw')"
            >
              <Icon icon="tabler:download" width="18" height="18" />
              <span>{{ $t('Redeem') }}</span>
            </button>
            <button
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="shareLightningAddress"
            >
              <Icon icon="tabler:share" width="18" height="18" />
              <span>{{ $t('Share') }}</span>
            </button>
            <button
              class="action-btn"
              :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
              @click="tapAmountButton"
            >
              <Icon icon="tabler:edit" width="18" height="18" />
              <span>{{ $t('Amount') }}</span>
            </button>
          </div>
        </div>

        <!-- Keypad View: amount display + description link + numeric grid -->
        <div class="keypad-view" v-else-if="showAmountKeypadView">
          <!-- Amount display: primary on top, secondary (with swap) below -->
          <div class="keypad-amount">
            <div
              class="keypad-amount-primary"
              :class="[
                $q.dark.isActive ? 'text-white' : 'text-grey-9',
                amountInSats === 0 ? 'keypad-amount-empty' : ''
              ]"
            >
              {{ primaryDisplay }}<span v-if="!isFiatMode" class="keypad-amount-suffix">sats</span>
            </div>
            <div
              class="keypad-amount-secondary"
              :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
              @click="swapKeypadMode"
            >
              <span>{{ secondaryDisplay }}</span>
              <Icon v-if="fiatRate" icon="tabler:arrows-up-down" width="16" height="16" class="keypad-swap-icon" />
            </div>
          </div>

          <!-- Description: link if empty, chip if set. Both open the sheet. -->
          <button
            v-if="!description"
            type="button"
            class="keypad-desc-link"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
            @click="openDescriptionSheet"
          >
            <Icon icon="tabler:notes" width="18" height="18" />
            <span>{{ $t('Add Description') }}</span>
          </button>
          <button
            v-else
            type="button"
            class="keypad-desc-chip"
            :class="$q.dark.isActive ? 'desc-chip-dark' : 'desc-chip-light'"
            @click="openDescriptionSheet"
          >
            <Icon icon="tabler:notes" width="14" height="14" />
            <span class="keypad-desc-chip-text">{{ description }}</span>
            <Icon icon="tabler:edit" width="14" height="14" />
          </button>

          <!-- Numeric keypad grid -->
          <div class="keypad-grid">
            <button
              v-for="key in keypadKeys"
              :key="key"
              type="button"
              class="keypad-key"
              :class="$q.dark.isActive ? 'keypad-key-dark' : 'keypad-key-light'"
              @click="keypadTap(key)"
            >
              <Icon v-if="key === 'del'" icon="tabler:backspace" width="22" height="22" />
              <template v-else>{{ key }}</template>
            </button>
          </div>
        </div>
      </q-card-section>

      <!-- Footer (only on the keypad) -->
      <q-card-section class="receive-footer" v-if="showAmountKeypadView">
        <div class="receive-footer-buttons">
          <q-btn
            flat
            round
            dense
            class="scan-withdraw-btn"
            :class="$q.dark.isActive ? 'scan-btn-dark' : 'scan-btn-light'"
            @click="$emit('scan-withdraw')"
          >
            <Icon icon="tabler:qrcode" width="20" height="20" />
            <q-tooltip>{{ $t('Scan to redeem') }}</q-tooltip>
          </q-btn>
          <q-btn
            class="create-invoice-btn"
            :class="$q.dark.isActive ? 'create-invoice-btn-dark' : 'create-invoice-btn-light'"
            :loading="isCreatingInvoice"
            @click="createInvoice"
            :disable="!isValidAmount || !hasActiveWallet"
            no-caps
            unelevated
          >
            <span v-if="!isCreatingInvoice">{{ $t('Create Invoice') }}</span>
            <template v-slot:loading>
              <q-spinner-dots class="q-mr-sm"/>
              {{ $t('Creating...') }}
            </template>
          </q-btn>
        </div>
      </q-card-section>
    </q-card>

    <!-- Description bottom sheet (opens on top of the receive modal). -->
    <q-dialog v-model="showDescriptionSheet" position="bottom">
      <q-card class="desc-sheet" :class="$q.dark.isActive ? 'desc-sheet-dark' : 'desc-sheet-light'">
        <q-card-section class="desc-sheet-section">
          <div class="desc-sheet-header">
            <span class="desc-sheet-title" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">
              {{ $t('Add Description') }}
            </span>
            <q-btn flat round dense @click="closeDescriptionSheet" class="desc-sheet-close">
              <Icon icon="tabler:x" width="20" height="20" />
            </q-btn>
          </div>
          <input
            v-model="description"
            type="text"
            :placeholder="$t('What is this payment for?')"
            class="desc-sheet-input"
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            maxlength="100"
            @keyup.enter="closeDescriptionSheet"
          />
          <q-btn
            class="desc-sheet-save"
            :class="$q.dark.isActive ? 'create-invoice-btn-dark' : 'create-invoice-btn-light'"
            @click="closeDescriptionSheet"
            no-caps
            unelevated
          >
            {{ $t('Save') }}
          </q-btn>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-dialog>

  <!-- Payment Confirmation Screen -->
  <PaymentConfirmation
    v-model="showPaymentConfirmation"
    :amount="confirmedAmount"
    :fiat-amount="confirmedFiatAmount"
    :description="generatedInvoice?.description"
    :auto-close-delay="5"
    @closed="handleConfirmationClosed"
  />
</template>

<script>
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { NostrWebLNProvider } from "@getalby/sdk";
import { Invoice } from "@getalby/lightning-tools";
import { formatAmount } from '../utils/amountFormatting.js';
import { useWalletStore } from '../stores/wallet';
import { createPaymentMonitor, PaymentStatus, checkNWCPaymentStatus } from '../utils/paymentMonitor';
import { shareContent } from '../utils/share';
import { qrBlobFromRef } from '../utils/qrShare';
import { truncateAddress } from '../utils/addressUtils';
import { getQrOptions } from '../utils/qrConfig';
import PaymentConfirmation from './PaymentConfirmation.vue';
import L1BitcoinReceive from './L1BitcoinReceive.vue';

export default {
  name: 'ReceiveModal',
  components: {
    VueQrcode,
    PaymentConfirmation,
    L1BitcoinReceive
  },
  setup() {
    const walletStore = useWalletStore();
    return { walletStore };
  },
  props: {
    modelValue: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue', 'invoice-created', 'bitcoin-deposits-updated', 'scan-withdraw'],
  data() {
    return {
      // In-app keypad state. `keypadValue` is the raw string the user has
      // typed in the *current* mode (digits + optional `.` in fiat mode;
      // digits only in sats mode). The actual sats amount is computed.
      keypadValue: '',
      isFiatMode: false,
      showDescriptionSheet: false,
      description: '',
      isCreatingInvoice: false,
      generatedInvoice: null,
      walletState: {},
      // True after the user taps the "Amount" button to override the default
      // QR view (LN address or zero-amount BOLT11) and enter the keypad.
      // Stays false for wallets that have no default view — those land on
      // the keypad directly because nothing else makes sense.
      showAmountInput: false,
      // Guard so we don't fire two parallel mints if the modal-open and
      // tab-change paths both trigger.
      isMintingDefaultZero: false,
      receiveMode: 'lightning', // 'lightning', 'spark', or 'bitcoin'
      // Payment monitoring
      paymentMonitor: null,
      sparkEventUnsubscribe: null, // For Spark event-based monitoring
      nwcNotificationUnsubscribe: null, // For NWC notification-based monitoring
      sparkPollState: null, // { cancelled: boolean } cancellation token for Spark invoice polling
      sparkVisibilityHandler: null, // visibilitychange listener for mobile resume catch-up
      paymentStatus: PaymentStatus.PENDING,
      paymentStatusMessage: '',
      isPaymentConfirmed: false,
      // Payment confirmation screen
      showPaymentConfirmation: false,
      confirmedAmount: 0,
      confirmedFiatAmount: '',
      // Screen width for responsive QR sizing
      screenWidth: typeof window !== 'undefined' ? window.innerWidth : 375
    }
  },
  computed: {
    show: {
      get() {
        return this.modelValue;
      },
      set(value) {
        this.$emit('update:modelValue', value);
      }
    },
    isValidAmount() {
      return this.amountInSats > 0;
    },
    /**
     * True when the Pinia wallet store has an active wallet that exists.
     * Used to short-circuit createInvoice and disable the button when the
     * store is empty (fresh install, HMR state wipe, etc.) instead of
     * letting `activeWalletType` crash inside `inferWalletType(undefined)`.
     */
    hasActiveWallet() {
      const id = this.walletStore.activeWalletId;
      const wallets = this.walletStore.wallets || [];
      return !!id && wallets.some((w) => w.id === id);
    },
    /**
     * Source of truth for invoice amount. Derived from the keypad input
     * + current mode. Fiat mode converts via the live exchange rate; sats
     * mode parses the integer directly.
     */
    amountInSats() {
      if (this.isFiatMode) {
        const fiat = parseFloat(this.keypadValue) || 0;
        return this.fiatToSats(fiat);
      }
      return parseInt(this.keypadValue, 10) || 0;
    },
    /**
     * Active fiat currency for the keypad's secondary display + fiat-mode
     * conversion. Falls back to USD if the user hasn't picked one.
     */
    fiatCode() {
      return (this.walletState.preferredFiatCurrency || 'USD').toLowerCase();
    },
    fiatRate() {
      return this.walletState.exchangeRates?.[this.fiatCode] || 0;
    },
    fiatSymbol() {
      switch (this.fiatCode) {
        case 'usd': return '$';
        case 'eur': return '€';
        case 'gbp': return '£';
        case 'jpy': return '¥';
        default: return this.fiatCode.toUpperCase() + ' ';
      }
    },
    /**
     * Keys for the 3x4 keypad grid. The bottom-left key swaps between
     * `000` (sats mode — fast PoS-style entry) and `.` (fiat mode — for
     * cents). Bottom-right is always backspace.
     */
    keypadKeys() {
      return [
        '1', '2', '3',
        '4', '5', '6',
        '7', '8', '9',
        this.isFiatMode ? '.' : '000',
        '0',
        'del',
      ];
    },
    /**
     * Primary display: what the user is actively typing.
     * Sats mode: "1,000 sats". Fiat mode: "$ 0.00".
     */
    primaryDisplay() {
      if (this.isFiatMode) {
        return `${this.fiatSymbol}${this.keypadValue || '0'}`;
      }
      const formatted = this.keypadValue
        ? Number(this.keypadValue).toLocaleString('en-US')
        : '0';
      return formatted;
    },
    /**
     * Secondary display: the *other* unit's value, derived from the
     * primary input. Tapping the swap icon promotes this to primary.
     */
    secondaryDisplay() {
      if (this.isFiatMode) {
        const sats = this.amountInSats;
        return sats > 0 ? `${sats.toLocaleString('en-US')} sats` : '0 sats';
      }
      if (!this.fiatRate) return `${this.fiatSymbol}0.00`;
      const fiat = this.satsToFiat(this.amountInSats);
      return `${this.fiatSymbol}${fiat.toFixed(2)}`;
    },
    hasLightningAddress() {
      return !!this.walletStore.activeWalletLightningAddress;
    },
    lightningAddress() {
      return this.walletStore.activeWalletLightningAddress;
    },
    isSparkWallet() {
      return this.walletStore.isActiveWalletSpark;
    },
    isLNBitsWallet() {
      return this.walletStore.isActiveWalletLNBits;
    },
    sparkAddress() {
      return this.walletStore.activeSparkAddress;
    },
    showSparkAddressView() {
      return this.isSparkWallet && this.receiveMode === 'spark' && !this.generatedInvoice;
    },
    showBitcoinReceiveView() {
      return this.isSparkWallet && this.receiveMode === 'bitcoin' && !this.generatedInvoice;
    },
    // The user-created specific-amount invoice screen. Distinct from the
    // default zero-amount view, which also lives in `generatedInvoice` but
    // with `amount === 0`.
    showSpecificInvoiceView() {
      return !!this.generatedInvoice && this.generatedInvoice.amount > 0;
    },
    // Spark Lightning tab default: a zero-amount BOLT11 we mint lazily so
    // the user can be paid without typing anything. Re-uses `generatedInvoice`
    // as storage so the existing payment monitor wiring works unchanged.
    showDefaultZeroInvoiceView() {
      return !!this.generatedInvoice
        && this.generatedInvoice.amount === 0
        && this.isSparkWallet
        && this.receiveMode === 'lightning'
        && !this.showAmountInput;
    },
    // LN-address-capable wallets (NWC/LNbits with an address attached) open
    // straight to this view. Spark is excluded because it has its own zero-
    // amount default and a separate Spark-address tab.
    showLightningAddressView() {
      return !this.showAmountInput
        && !this.generatedInvoice
        && !this.isSparkWallet
        && this.hasLightningAddress;
    },
    // True when the wallet has any default QR view to fall back to. Drives
    // back-arrow behavior: with a default view, back returns there; without
    // one, back closes the modal.
    hasDefaultView() {
      return this.showLightningAddressView
        || this.showDefaultZeroInvoiceView
        || (this.showAmountInput && (
          this.hasLightningAddress
          || (this.isSparkWallet && this.receiveMode === 'lightning')
        ));
    },
    headerTitle() {
      if (this.showSpecificInvoiceView || this.showAmountKeypadView) {
        return this.$t('Invoice');
      }
      return this.$t('Receive');
    },
    // The keypad view is the catch-all when no other view matches. Wallets
    // without a LN address (and that aren't on Spark Lightning) land here
    // by default; users with a default view land here only after tapping
    // the "Amount" button.
    showAmountKeypadView() {
      if (this.showDefaultZeroLoading) return false;
      return !this.showSparkAddressView
        && !this.showBitcoinReceiveView
        && !this.showSpecificInvoiceView
        && !this.showDefaultZeroInvoiceView
        && !this.showLightningAddressView;
    },
    // Brief loading state while we mint the Spark zero-amount default. Without
    // this, the user would see the keypad flash before the QR appears.
    showDefaultZeroLoading() {
      return this.isSparkWallet
        && this.receiveMode === 'lightning'
        && this.isMintingDefaultZero
        && !this.generatedInvoice
        && !this.showAmountInput;
    },
    paymentStatusClass() {
      switch (this.paymentStatus) {
        case PaymentStatus.CONFIRMED:
          return 'status-confirmed';
        case PaymentStatus.EXPIRED:
          return 'status-expired';
        case PaymentStatus.ERROR:
          return 'status-error';
        default:
          return 'status-pending';
      }
    },
    paymentStatusDotClass() {
      switch (this.paymentStatus) {
        case PaymentStatus.CONFIRMED:
          return 'dot-confirmed';
        case PaymentStatus.EXPIRED:
          return 'dot-expired';
        case PaymentStatus.ERROR:
          return 'dot-error';
        default:
          return 'dot-pending';
      }
    },
    /**
     * Dynamic QR code options based on screen width
     * Ensures QR codes always fit within the viewport
     */
    qrOptions() {
      let qrSize;

      if (this.screenWidth <= 320) {
        // Extra small phones (iPhone SE 1st gen)
        qrSize = Math.min(this.screenWidth - 80, 200);
      } else if (this.screenWidth <= 375) {
        // Small phones (iPhone SE, iPhone 8)
        qrSize = Math.min(this.screenWidth - 70, 240);
      } else if (this.screenWidth <= 414) {
        // Medium phones (iPhone Plus, most Android)
        qrSize = Math.min(this.screenWidth - 60, 270);
      } else {
        // Larger screens
        qrSize = 280;
      }

      return {
        width: qrSize,
        margin: 0,
        color: { dark: '#000000', light: '#ffffff' }
      };
    },
    receiveModeOptions() {
      const sparkIcon = this.$q.dark.isActive
        ? 'img:/Spark/Spark Asterisk White.svg'
        : 'img:/Spark/Spark Asterisk Black.svg';
      return [
        { label: this.$t('Lightning'), value: 'lightning', icon: 'bolt' },
        { label: this.$t('Spark'), value: 'spark', icon: sparkIcon },
        { label: this.$t('Bitcoin'), value: 'bitcoin', icon: 'currency_bitcoin' }
      ];
    },
    sparkPillIcon() {
      return this.$q.dark.isActive
        ? '/Spark/Spark Asterisk White.svg'
        : '/Spark/Spark Asterisk Black.svg';
    },
    sparkQrOptions() {
      return getQrOptions();
    },
    invoiceQrOptions() {
      return getQrOptions();
    }
  },
  watch: {
    show(newVal) {
      if (newVal) {
        this.loadWalletState();
        this.resetForm();
        // Mint the default zero-amount Spark Lightning invoice on open so
        // the user lands on a scannable QR with no taps. Skipped for
        // non-Spark wallets and for Spark when the active tab is Spark or
        // Bitcoin (the receiveMode watcher handles tab-driven mints).
        this.$nextTick(() => {
          if (this.isSparkWallet && this.receiveMode === 'lightning') {
            this.mintDefaultZeroInvoice();
          }
        });
      } else {
        this.stopPaymentMonitor();
      }
    },
    // Spark wallets have a tab toggle. Mint when entering Lightning, tear
    // down when leaving — but only for the *default zero-amount* invoice.
    // A user-created specific-amount invoice (`amount > 0`) is left alone
    // so switching tabs while waiting for a fixed-amount payment doesn't
    // silently kill the monitor.
    receiveMode(newMode, oldMode) {
      if (newMode === oldMode) return;
      const isDefaultZero = !!this.generatedInvoice && this.generatedInvoice.amount === 0;
      if (oldMode === 'lightning' && newMode !== 'lightning' && isDefaultZero) {
        this.stopPaymentMonitor();
        this.generatedInvoice = null;
        this.paymentStatus = PaymentStatus.PENDING;
        this.paymentStatusMessage = '';
      } else if (newMode === 'lightning' && oldMode !== 'lightning') {
        if (this.isSparkWallet && !this.generatedInvoice && !this.showAmountInput) {
          this.mintDefaultZeroInvoice();
        }
      }
    }
  },
  mounted() {
    // Listen for window resize to update QR size
    window.addEventListener('resize', this.handleResize);
  },
  beforeUnmount() {
    // Cleanup on component destroy
    this.stopPaymentMonitor();
    window.removeEventListener('resize', this.handleResize);
  },
  methods: {
    // ... (keeping all existing methods from the original component)
    loadWalletState() {
      const savedState = localStorage.getItem('buhoGO_wallet_state');
      if (savedState) {
        this.walletState = JSON.parse(savedState);
      }
    },

    /**
     * Handle window resize for responsive QR sizing
     */
    handleResize() {
      this.screenWidth = window.innerWidth;
    },

    resetForm() {
      this.stopPaymentMonitor();
      this.keypadValue = '';
      this.isFiatMode = false;
      this.showDescriptionSheet = false;
      this.description = '';
      this.generatedInvoice = null;
      this.showAmountInput = false;
      this.isMintingDefaultZero = false;
      this.receiveMode = 'lightning';
      this.paymentStatus = PaymentStatus.PENDING;
      this.paymentStatusMessage = '';
      this.isPaymentConfirmed = false;
      // Reset confirmation data
      this.confirmedAmount = 0;
      this.confirmedFiatAmount = '';
    },

    closeModal() {
      this.stopPaymentMonitor();
      this.show = false;
    },

    /**
     * Header back-arrow handler. Context-aware:
     * - Specific-amount invoice → return to default view (or close).
     * - Keypad after tapping Amount → return to default view.
     * - No default view → close the modal.
     */
    handleHeaderBack() {
      if (this.showSpecificInvoiceView) {
        this.backFromInvoice();
        return;
      }
      const canReturnToDefault = this.hasLightningAddress
        || (this.isSparkWallet && this.receiveMode === 'lightning');
      if (this.showAmountInput && canReturnToDefault) {
        this.showAmountInput = false;
        this.keypadValue = '';
        if (this.isSparkWallet
            && this.receiveMode === 'lightning'
            && !this.generatedInvoice) {
          this.mintDefaultZeroInvoice();
        }
        return;
      }
      this.closeModal();
    },

    /**
     * Tap "Amount" on a default QR view. Tear down the default zero-amount
     * monitor (if running), clear the default invoice, and switch to the
     * keypad.
     */
    tapAmountButton() {
      const wasDefaultZero = !!this.generatedInvoice
        && this.generatedInvoice.amount === 0;
      if (wasDefaultZero) {
        this.stopPaymentMonitor();
        this.generatedInvoice = null;
        this.paymentStatus = PaymentStatus.PENDING;
        this.paymentStatusMessage = '';
      }
      this.showAmountInput = true;
      this.keypadValue = '';
    },

    /**
     * Back from a specific-amount invoice. Returns to whatever default view
     * the wallet has — LN address, or a freshly minted Spark zero-amount.
     * Closes the modal if there is no default view to return to.
     */
    backFromInvoice() {
      this.stopPaymentMonitor();
      this.generatedInvoice = null;
      this.paymentStatus = PaymentStatus.PENDING;
      this.paymentStatusMessage = '';
      this.isPaymentConfirmed = false;
      this.keypadValue = '';
      this.description = '';

      if (this.isSparkWallet && this.receiveMode === 'lightning') {
        this.showAmountInput = false;
        this.mintDefaultZeroInvoice();
      } else if (!this.isSparkWallet && this.hasLightningAddress) {
        this.showAmountInput = false;
      } else {
        // No default view — close out.
        this.closeModal();
      }
    },

    /**
     * Mint a zero-amount BOLT11 for the Spark Lightning tab and start the
     * payment monitor. No-op on non-Spark wallets, on non-Lightning tabs, or
     * if a mint is already in flight / cached.
     *
     * The invoice is stored in `generatedInvoice` (with `amount === 0`) so
     * the existing Spark monitor wiring in `startSparkEventMonitor()` works
     * unchanged. Views distinguish between this default and a user-created
     * specific-amount invoice via the `amount > 0` check.
     */
    async mintDefaultZeroInvoice() {
      if (this.isMintingDefaultZero) return;
      if (this.generatedInvoice) return;
      if (!this.isSparkWallet || this.receiveMode !== 'lightning') return;
      if (this.showAmountInput) return;

      this.isMintingDefaultZero = true;
      try {
        const provider = this.walletStore.getActiveProvider();
        if (!provider) {
          // Wallet locked or unavailable. The user can still tap Amount to
          // create a fixed-amount invoice (which will prompt for unlock).
          return;
        }

        const result = await provider.createInvoice({
          amount: 0,
          description: 'BuhoGO Payment',
        });

        // Race guard: the user may have switched tabs, tapped Amount, or
        // closed the modal while the mint was in flight (e.g.
        // openReceiveModalBitcoin sets the tab via $nextTick). Drop the
        // result silently in those cases — we'd otherwise leak an orphaned
        // invoice + monitor.
        if (!this.show
            || this.receiveMode !== 'lightning'
            || this.showAmountInput
            || this.generatedInvoice) {
          return;
        }

        const paymentRequest = result.paymentRequest;
        if (!paymentRequest) {
          console.warn('Zero-amount mint returned no paymentRequest');
          return;
        }

        let paymentHash = result.paymentHash;
        if (!paymentHash) {
          paymentHash = this._extractPaymentHashFromBolt11(paymentRequest);
        }

        this.generatedInvoice = {
          payment_request: paymentRequest,
          payment_hash: paymentHash,
          invoice_id: result.id || null,
          amount: 0,
          description: 'BuhoGO Payment',
          expires_at: result.expiresAt,
          created_at: Math.floor(Date.now() / 1000),
        };

        this.startPaymentMonitor();
      } catch (error) {
        // Non-fatal — the user can still tap Amount to create a fixed-
        // amount invoice. Network blips, wallet relocked, etc.
        console.warn('Failed to mint default zero-amount invoice:', error?.message || error);
      } finally {
        this.isMintingDefaultZero = false;
      }
    },

    /**
     * Set receive mode programmatically (for parent component access)
     * @param {string} mode - 'lightning', 'spark', or 'bitcoin'
     */
    setReceiveMode(mode) {
      if (['lightning', 'spark', 'bitcoin'].includes(mode)) {
        this.receiveMode = mode;
      }
    },

    /**
     * Handle Bitcoin deposit claimed - show confirmation
     */
    handleBitcoinDepositClaimed(result) {
      // Show success confirmation similar to Lightning payments
      this.confirmedAmount = result.amount;
      this.confirmedFiatAmount = this.calculateFiatAmount(result.amount);
      this.showPaymentConfirmation = true;
    },

    /**
     * Handle Bitcoin deposits list updated
     */
    handleBitcoinDepositsUpdated(deposits) {
      // Emit event for parent components (Wallet.vue) to update banner
      this.$emit('bitcoin-deposits-updated', deposits);
    },

    /**
     * Calculate fiat amount for confirmation display
     */
    calculateFiatAmount(sats) {
      const rate = this.walletState.exchangeRates?.['usd'];
      if (!rate) return '--';
      const btc = sats / 100000000;
      const fiat = btc * rate;
      return `$${fiat.toFixed(2)}`;
    },

    /**
     * Stop the payment monitor if running
     */
    stopPaymentMonitor() {
      // Stop polling-based monitor (NWC)
      if (this.paymentMonitor) {
        this.paymentMonitor.stop();
        this.paymentMonitor = null;
      }
      // Unsubscribe from Spark events
      if (this.sparkEventUnsubscribe) {
        this.sparkEventUnsubscribe();
        this.sparkEventUnsubscribe = null;
      }
      // Unsubscribe from NWC notifications
      if (this.nwcNotificationUnsubscribe) {
        this.nwcNotificationUnsubscribe();
        this.nwcNotificationUnsubscribe = null;
      }
      // Cancel Spark invoice polling
      if (this.sparkPollState) {
        this.sparkPollState.cancelled = true;
        this.sparkPollState = null;
      }
      // Remove visibility-change listener
      if (this.sparkVisibilityHandler) {
        document.removeEventListener('visibilitychange', this.sparkVisibilityHandler);
        this.sparkVisibilityHandler = null;
      }
    },

    /**
     * Start monitoring for payment confirmation
     * Uses event-based for Spark (instant), polling for LNbits/NWC
     */
    async startPaymentMonitor() {
      if (!this.generatedInvoice?.payment_hash) {
        console.warn('Cannot start payment monitor: no invoice payment_hash');
        return;
      }

      this.paymentStatus = PaymentStatus.PENDING;
      this.paymentStatusMessage = this.$t('Waiting for payment...');

      if (this.isSparkWallet) {
        await this.startSparkEventMonitor();
      } else if (this.isLNBitsWallet) {
        await this.startLNBitsPollingMonitor();
      } else {
        await this.startNWCPollingMonitor();
      }
    },

    /**
     * Start Spark payment monitoring.
     *
     * Uses two independent paths so a stuck event or stalled poll cannot
     * block confirmation:
     *   1. SDK `transfer:claimed` event — instant for Spark-to-Spark
     *      transfers, but unreliable for Lightning invoice receives.
     *   2. `getLightningReceiveRequest(id)` polling — ground truth for any
     *      receive path (Spark address, Spark invoice, or BOLT11).
     *
     * Whichever path detects payment first wins; the second is a no-op via
     * the `isPaymentConfirmed` idempotency guard in handlePaymentStatus.
     * On mobile resume we run an immediate catch-up check because JS timers
     * stall while the app is backgrounded.
     */
    async startSparkEventMonitor() {
      let provider;
      try {
        provider = await this.walletStore.ensureSparkConnected();
      } catch (error) {
        console.warn('Could not connect Spark provider for monitoring:', error);
        return;
      }

      // Fast path: SDK event (best-effort — may not fire for Lightning)
      try {
        this.sparkEventUnsubscribe = provider.onPaymentReceived((transferId, newBalance) => {
          this.handlePaymentStatus(PaymentStatus.CONFIRMED, {
            transferId,
            amount: this.generatedInvoice?.amount,
            newBalance
          });
        });
      } catch (error) {
        console.warn('Could not subscribe to Spark transfer:claimed event:', error);
      }

      // Ground-truth poll
      const invoiceId = this.generatedInvoice?.invoice_id;
      if (invoiceId && typeof provider.getLightningReceiveStatus === 'function') {
        this.startSparkInvoicePolling(provider, invoiceId);

        this.sparkVisibilityHandler = () => {
          if (document.visibilityState === 'visible') {
            this.checkSparkInvoiceOnce(provider, this.generatedInvoice?.invoice_id);
          }
        };
        document.addEventListener('visibilitychange', this.sparkVisibilityHandler);
      }
    },

    /**
     * Poll Spark `getLightningReceiveRequest(id)` until paid, expired, or
     * cancelled. Runs alongside the SDK event subscription; the first to
     * detect a settled payment wins (idempotency is enforced in
     * handlePaymentStatus).
     */
    startSparkInvoicePolling(provider, invoiceId) {
      const intervalMs = 3000;
      this.sparkPollState = { cancelled: false };
      const state = this.sparkPollState;

      const tick = async () => {
        if (state.cancelled || this.isPaymentConfirmed) return;
        try {
          const status = await provider.getLightningReceiveStatus(invoiceId);
          if (state.cancelled || this.isPaymentConfirmed) return;
          if (status.isPaid) {
            // `amountReceived` is the actual paid amount — required for
            // zero-amount invoices where `status.amount` is 0.
            this.handlePaymentStatus(PaymentStatus.CONFIRMED, {
              amount: status.amountReceived
                || status.amount
                || this.generatedInvoice?.amount,
              preimage: status.preimage
            });
            return;
          }
          if (status.isExpired) {
            this.handlePaymentStatus(PaymentStatus.EXPIRED, {});
            return;
          }
        } catch (e) {
          // Transient error (wallet relocked, network blip) — keep polling.
        }
        if (!state.cancelled && !this.isPaymentConfirmed) {
          setTimeout(tick, intervalMs);
        }
      };
      setTimeout(tick, intervalMs);
    },

    async checkSparkInvoiceOnce(provider, invoiceId) {
      if (!invoiceId || this.isPaymentConfirmed) return;
      try {
        const status = await provider.getLightningReceiveStatus(invoiceId);
        if (this.isPaymentConfirmed) return;
        if (status.isPaid) {
          this.handlePaymentStatus(PaymentStatus.CONFIRMED, {
            amount: status.amountReceived
              || status.amount
              || this.generatedInvoice?.amount,
            preimage: status.preimage
          });
        }
      } catch (e) {
        // Catch-up check is best-effort; the polling tick will retry.
      }
    },

    /**
     * Start NWC payment monitoring using polling
     * Falls back to listTransactions if lookupInvoice is not supported
     */
    async startNWCPollingMonitor() {
      let rawProvider = null;
      let wrappedProvider = null;

      try {
        rawProvider = this.walletStore.getActiveProvider();

        if (!rawProvider) {
          // Create NWC provider on-the-fly
          const activeWallet = this.walletState.connectedWallets?.find(
            w => w.id === this.walletState.activeWalletId
          );

          if (activeWallet?.nwcString) {
            rawProvider = new NostrWebLNProvider({
              nostrWalletConnectUrl: activeWallet.nwcString,
            });
            await rawProvider.enable();
          }
        }
      } catch (error) {
        console.warn('Could not get provider for payment monitoring:', error.message);
        return;
      }

      if (!rawProvider) {
        console.warn('No provider available for payment monitoring');
        return;
      }

      // Per-session capability flag for `lookup_invoice`.
      //
      // Some NWC wallets either don't implement lookup_invoice or only
      // index invoices once they've been paid — both surface as
      // "invoice not found" rejections when we poll. The Alby SDK logs
      // each failure to console.error *before* rejecting the promise,
      // so a multi-minute receive window can produce 30+ noisy log
      // lines for a flow that's actually working (via the
      // listTransactions fallback below).
      //
      // After the first failure we mark lookup_invoice unavailable for
      // the rest of this monitor session and skip straight to the
      // fallback. The flag is intentionally per-session (closure-scoped)
      // rather than memoised across sessions — wallet capabilities can
      // change between connections, so the next receive should re-probe.
      let lookupInvoiceAvailable = true;

      wrappedProvider = {
        lookupInvoice: async (hash) => {
          if (lookupInvoiceAvailable) {
            try {
              const invoice = await rawProvider.lookupInvoice({ payment_hash: hash });
              if (invoice && checkNWCPaymentStatus(invoice)) {
                return { paid: true, preimage: invoice?.preimage, amount: invoice?.amount };
              }
            } catch {
              // Sticky-flag the wallet's lookup_invoice as unreliable
              // for the rest of this monitor session — see comment
              // above. The fallback below takes over from here.
              lookupInvoiceAvailable = false;
            }
          }

          // Fallback: scan recent incoming transactions for our
          // payment_hash. Used when lookup_invoice isn't available, or
          // when it returned an unpaid result and the transaction list
          // might already reflect a payment the invoice index hasn't.
          try {
            const txResponse = await rawProvider.listTransactions({
              limit: 50,
              unpaid: false,
              type: 'incoming'
            });

            if (txResponse?.transactions) {
              const found = txResponse.transactions.find(tx =>
                tx.payment_hash === hash || tx.paymentHash === hash
              );

              if (found && checkNWCPaymentStatus(found)) {
                return {
                  paid: true,
                  preimage: found.preimage,
                  amount: Math.abs(found.amount || 0)
                };
              }
            }
          } catch {
            // listTransactions also failed — return not paid; the
            // monitor accumulates consecutive errors and stops after
            // the configured threshold.
          }

          return { paid: false };
        }
      };

      // Start polling for payment confirmation
      this.paymentMonitor = createPaymentMonitor();

      this.paymentMonitor.start({
        invoice: {
          payment_hash: this.generatedInvoice.payment_hash,
          expires_at: this.generatedInvoice.expires_at,
          amount: this.generatedInvoice.amount
        },
        provider: wrappedProvider,
        onStatusChange: (status, data) => {
          if (!this.isPaymentConfirmed) {
            this.handlePaymentStatus(status, data);
          }
        }
      });
    },

    /**
     * Start LNbits payment monitoring using polling
     * Uses the LNbits API to check payment status
     */
    async startLNBitsPollingMonitor() {
      let rawProvider = null;

      try {
        rawProvider = this.walletStore.getActiveProvider();
      } catch (error) {
        console.warn('Could not get LNbits provider for payment monitoring:', error.message);
        return;
      }

      if (!rawProvider) {
        console.warn('No LNbits provider available for payment monitoring');
        return;
      }

      // Wrap the LNbits provider with the expected interface
      const wrappedProvider = {
        lookupInvoice: async (hash) => {
          try {
            // LNbits lookupInvoice expects a string payment hash
            const result = await rawProvider.lookupInvoice(hash);
            return result;
          } catch (error) {
            console.warn('LNbits lookupInvoice error:', error.message);
            return { paid: false };
          }
        }
      };

      // Start polling for payment confirmation
      this.paymentMonitor = createPaymentMonitor();

      this.paymentMonitor.start({
        invoice: {
          payment_hash: this.generatedInvoice.payment_hash,
          expires_at: this.generatedInvoice.expires_at,
          amount: this.generatedInvoice.amount
        },
        provider: wrappedProvider,
        onStatusChange: (status, data) => {
          if (!this.isPaymentConfirmed) {
            this.handlePaymentStatus(status, data);
          }
        }
      });
    },

    /**
     * Handle payment status updates from monitor
     */
    handlePaymentStatus(status, data) {
      this.paymentStatus = status;

      switch (status) {
        case PaymentStatus.CONFIRMED:
          // Idempotency guard — event and poll can both fire for the same payment.
          if (this.isPaymentConfirmed) return;
          this.isPaymentConfirmed = true;
          this.paymentStatusMessage = this.$t('Payment received!');

          // Stop monitoring
          this.stopPaymentMonitor();

          // Set confirmed amount for confirmation screen
          this.confirmedAmount = data.amount || this.generatedInvoice?.amount || 0;
          this.confirmedFiatAmount = this.formatInvoiceFiat(this.confirmedAmount);

          // Close the receive modal and show confirmation screen
          this.show = false;
          this.$nextTick(() => {
            this.showPaymentConfirmation = true;
          });

          // Refresh wallet balance in background
          if (this.walletStore.activeWalletId) {
            this.walletStore.refreshWalletData(this.walletStore.activeWalletId);
          }
          break;

        case PaymentStatus.EXPIRED:
          this.paymentStatusMessage = this.$t('Invoice expired');
          this.$q.notify({
            type: 'warning',
            message: this.$t('Invoice expired'),
            caption: this.$t('Please create a new invoice'),
            
            timeout: 4000,
          });
          break;

        case PaymentStatus.ERROR:
          this.paymentStatusMessage = data.message || this.$t('Error checking payment');
          break;

        case PaymentStatus.PENDING:
        default:
          this.paymentStatusMessage = this.$t('Waiting for payment...');
          break;
      }
    },

    /**
     * Handle a key press from the in-app keypad.
     * - digits: append, collapsing leading zeros (so '0' + '5' = '5', not '05')
     * - '0': allowed as a stable single-zero state
     * - '000' (sats mode): append three zeros
     * - '.' (fiat mode): append decimal if not already present; cap to 2 places
     * - 'del': pop last char
     */
    keypadTap(key) {
      if (key === 'del') {
        this.keypadValue = this.keypadValue.slice(0, -1);
        return;
      }
      if (key === '.') {
        if (this.keypadValue.includes('.')) return;
        this.keypadValue = (this.keypadValue || '0') + '.';
        return;
      }
      // Cap input length to keep the display readable.
      if (this.keypadValue.length >= 12) return;

      // Fiat mode: enforce 2 decimal places max.
      if (this.isFiatMode && this.keypadValue.includes('.')) {
        const decimals = this.keypadValue.split('.')[1] || '';
        if (decimals.length >= 2) return;
      }

      let next = this.keypadValue + key;
      // Collapse leading zeros (e.g. '00' → '0', '05' → '5'), but keep
      // '0.' / '0.5' intact for fiat decimal entry.
      while (next.length > 1 && next.startsWith('0') && !next.startsWith('0.')) {
        next = next.slice(1);
      }
      // Re-cap after the 000 expansion may have pushed us over.
      if (next.length > 12) next = next.slice(0, 12);
      this.keypadValue = next;
    },

    /**
     * Swap the primary input mode (sats ↔ fiat) and convert the current
     * value so the displayed amount stays roughly the same. Conversions
     * are floor-rounded for sats and 2-decimal for fiat.
     */
    swapKeypadMode() {
      if (!this.fiatRate) return; // Can't swap without an exchange rate.
      if (this.isFiatMode) {
        const sats = this.amountInSats;
        this.keypadValue = sats > 0 ? String(sats) : '';
        this.isFiatMode = false;
      } else {
        const fiat = this.satsToFiat(this.amountInSats);
        this.keypadValue = fiat > 0 ? fiat.toFixed(2) : '';
        this.isFiatMode = true;
      }
    },

    /** Convert a fiat amount (in fiatCode) to integer sats. */
    fiatToSats(fiat) {
      if (!this.fiatRate || fiat <= 0) return 0;
      const btc = fiat / this.fiatRate;
      return Math.floor(btc * 100000000);
    },

    /** Convert integer sats to fiat (in fiatCode). */
    satsToFiat(sats) {
      if (!this.fiatRate || sats <= 0) return 0;
      return (sats / 100000000) * this.fiatRate;
    },

    openDescriptionSheet() {
      this.showDescriptionSheet = true;
    },

    closeDescriptionSheet() {
      this.showDescriptionSheet = false;
    },

    async createInvoice() {
      if (!this.isValidAmount) return;

      // Guard against missing active wallet — the activeWalletType getter
      // crashes inside inferWalletType(undefined) and surfaces an opaque
      // TypeError. Catch it here with a clear message instead.
      if (!this.hasActiveWallet) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('No active wallet. Please connect a wallet first.'),
        });
        return;
      }

      this.isCreatingInvoice = true;
      try {
        const invoiceParams = {
          amount: this.amountInSats,
          description: this.description || 'BuhoGO Payment',
          expiry: 3600
        };

        let invoice;

        const walletType = this.walletStore.activeWalletType;

        // Check wallet type and use appropriate provider
        if (walletType === 'spark') {
          // Use Spark wallet provider
          const provider = this.walletStore.getActiveProvider();
          if (!provider) {
            throw new Error('Spark wallet not unlocked. Please enter your PIN.');
          }

          const result = await provider.createInvoice(invoiceParams);
          invoice = {
            paymentRequest: result.paymentRequest,
            payment_hash: result.paymentHash,
            invoice_id: result.id,
            amount: this.amountInSats,
            description: invoiceParams.description,
            expires_at: result.expiresAt
          };
        } else if (walletType === 'lnbits') {
          // Use LNbits wallet provider
          const provider = this.walletStore.getActiveProvider();
          if (!provider) {
            throw new Error('LNbits wallet not connected');
          }

          const result = await provider.createInvoice(invoiceParams);
          invoice = {
            paymentRequest: result.paymentRequest,
            payment_hash: result.paymentHash,
            amount: this.amountInSats,
            description: invoiceParams.description,
            expires_at: result.expiresAt
          };
        } else {
          // Use NWC for NWC wallets
          const activeWallet = this.walletState.connectedWallets?.find(
            w => w.id === this.walletState.activeWalletId
          );

          if (!activeWallet || !activeWallet.nwcString) {
            throw new Error('No active wallet found');
          }

          const nwc = new NostrWebLNProvider({
            nostrWalletConnectUrl: activeWallet.nwcString,
          });

          await nwc.enable();
          invoice = await nwc.makeInvoice(invoiceParams);
        }

        const paymentRequest = invoice.paymentRequest || invoice.payment_request;
        if (!paymentRequest) {
          throw new Error('Invalid invoice: missing payment request');
        }

        // Extract payment_hash - try multiple field names used by different wallets
        let paymentHash = invoice.payment_hash || invoice.paymentHash || invoice.rHash || invoice.r_hash;

        // If payment_hash is not in response, decode it from the bolt11 invoice
        if (!paymentHash) {
          paymentHash = this._extractPaymentHashFromBolt11(paymentRequest);
        }

        const processedInvoice = {
          payment_request: paymentRequest,
          payment_hash: paymentHash,
          invoice_id: invoice.invoice_id || invoice.id || null,
          amount: invoice.amount || this.amountInSats,
          description: invoice.description || this.description || 'BuhoGO Payment',
          expires_at: invoice.expires_at || invoice.expiresAt,
          created_at: Math.floor(Date.now() / 1000)
        };

        this.generatedInvoice = processedInvoice;
        this.$emit('invoice-created', processedInvoice);

        this.$q.notify({
          type: 'positive',
          message: this.$t('Invoice ready'),
          
        });

        // Start monitoring for payment confirmation
        this.startPaymentMonitor();

      } catch (error) {
        console.error('Error creating invoice:', error);

        // Funnel into the global payment-error dialog so the upstream
        // prose (NWC Nip47WalletError message, LNbits detail, Spark SDK
        // error) reaches the user verbatim instead of being swallowed by
        // a generic "Please try again" toast. See utils/userErrors.js
        // and stores/wallet.js → showPaymentError for the contract.
        this.walletStore.showPaymentError(error, {
          context: 'receive',
          walletType: this.walletStore.activeWalletType,
          route: 'Invoice creation',
          amountSats: this.amountInSats,
          t: this.$t.bind(this),
        });

        this.generatedInvoice = null;
      } finally {
        this.isCreatingInvoice = false;
      }
    },

    async copyInvoice() {
      if (!this.generatedInvoice) return;

      try {
        await navigator.clipboard.writeText(this.generatedInvoice.payment_request);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Invoice copied'),
          
        });
      } catch (error) {
        console.error('Failed to copy invoice:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          
        });
      }
    },

    async shareLightningAddress() {
      if (!this.lightningAddress) return;

      const qrBlob = await qrBlobFromRef(this.$refs.lightningAddressQr);
      const result = await shareContent({
        title: this.$t('Lightning Address'),
        text: this.lightningAddress,
        files: qrBlob ? [{ blob: qrBlob, name: 'lightning-address.png', mimeType: 'image/png' }] : undefined,
      });

      if (result.success) {
        this.$q.notify({ type: 'positive', message: this.$t('Shared') });
      } else if (result.reason === 'unsupported') {
        await this.copyLightningAddress();
      } else if (result.reason === 'error') {
        console.error('Failed to share Lightning address:', result.error);
        await this.copyLightningAddress();
      }
    },

    async copyLightningAddress() {
      if (!this.lightningAddress) return;

      try {
        await navigator.clipboard.writeText(this.lightningAddress);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Address copied'),
          
        });
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          
        });
      }
    },

    async copySparkAddress() {
      if (!this.sparkAddress) return;

      try {
        await navigator.clipboard.writeText(this.sparkAddress);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Spark address copied'),
          
        });
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          
        });
      }
    },

    async shareSparkAddress() {
      if (!this.sparkAddress) return;

      const qrBlob = await qrBlobFromRef(this.$refs.sparkQr);
      const result = await shareContent({
        title: this.$t('Spark Address'),
        // Pure address so recipients can copy-paste cleanly. The
        // BuhoGO wordmark is baked into the QR image by qrShare.
        text: this.sparkAddress,
        files: qrBlob ? [{ blob: qrBlob, name: 'spark-address.png', mimeType: 'image/png' }] : undefined,
      });

      if (result.success) {
        this.$q.notify({
          type: 'positive',
          message: this.$t('Shared'),
        });
      } else if (result.reason === 'unsupported') {
        // Fallback: copy to clipboard
        await this.copySparkAddress();
      } else if (result.reason === 'error') {
        console.error('Failed to share Spark address:', result.error);
        await this.copySparkAddress();
      }
      // 'cancelled' → user closed the dialog, no action needed.
    },

    truncateSparkAddress(address) {
      return truncateAddress(address);
    },

    formatInvoiceAmount(sats) {
      if (!sats) return formatAmount(0, this.walletStore.useBip177Format);
      return formatAmount(sats, this.walletStore.useBip177Format);
    },

    formatInvoiceFiat(sats) {
      if (!sats || !this.walletState.exchangeRates) return '';

      const fiatCurrency = this.walletState.preferredFiatCurrency || 'USD';
      const rate = this.walletState.exchangeRates?.[fiatCurrency.toLowerCase()];
      if (!rate) return '';
      const btcAmount = sats / 100000000;
      const fiatAmount = btcAmount * rate;

      return `≈ $${fiatAmount.toFixed(2)} ${fiatCurrency}`;
    },

    async shareInvoice() {
      if (!this.generatedInvoice) return;

      // Lightning URI so every wallet we share to can open it directly.
      const lightningUri = `lightning:${this.generatedInvoice.payment_request}`;

      const qrBlob = await qrBlobFromRef(this.$refs.invoiceQr);
      const result = await shareContent({
        title: this.$t('Lightning Invoice'),
        // Pure invoice URI so recipients can copy-paste cleanly. The
        // BuhoGO wordmark is baked into the QR image by qrShare.
        text: lightningUri,
        files: qrBlob ? [{ blob: qrBlob, name: 'lightning-invoice.png', mimeType: 'image/png' }] : undefined,
      });

      if (result.success) {
        this.$q.notify({
          type: 'positive',
          message: this.$t('Shared'),
        });
      } else if (result.reason === 'unsupported' || result.reason === 'error') {
        if (result.reason === 'error') {
          console.error('Failed to share invoice:', result.error);
        }
        // Fallback: copy the raw invoice so the user still has something.
        try {
          await navigator.clipboard.writeText(this.generatedInvoice.payment_request);
          this.$q.notify({
            type: 'positive',
            message: this.$t('Invoice copied'),
          });
        } catch (copyError) {
          this.$q.notify({
            type: 'negative',
            message: this.$t('Couldn\'t share'),
          });
        }
      }
      // 'cancelled' → user closed the dialog, no action needed.
    },


    /**
     * Handle when the payment confirmation screen is closed
     * Redirects to home/wallet page
     */
    handleConfirmationClosed() {
      this.showPaymentConfirmation = false;
      this.resetForm();

      // Navigate to home/wallet page
      if (this.$router.currentRoute.value.path !== '/wallet') {
        this.$router.push('/wallet');
      }
    },

    /**
     * Extract payment hash from a bolt11 invoice string
     * Uses @getalby/lightning-tools Invoice decoder
     * @param {string} bolt11 - The bolt11 invoice string
     * @returns {string|null} The payment hash in hex format, or null if extraction fails
     */
    _extractPaymentHashFromBolt11(bolt11) {
      try {
        const invoice = new Invoice({ pr: bolt11 });
        // The Invoice class provides paymentHash property
        return invoice.paymentHash || null;
      } catch (error) {
        console.warn('[_extractPaymentHashFromBolt11] Failed to decode bolt11:', error.message);
        return null;
      }
    },

  }
}
</script>

<style scoped>
.receive-modal :deep(.q-dialog__inner) {
  padding: 0;
}

.receive-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* Header */
.receive-header {
  border-bottom: 1px solid;
  padding: 0.75rem 1rem;
  padding-top: calc(var(--safe-top, 0px) + 0.75rem);
  flex-shrink: 0;
}

.header-dark {
  border-bottom-color: #2A342A;
}

.header-light {
  border-bottom-color: var(--border-card);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
}

.back-btn-dark {
  color: #FFF;
}

.back-btn-light {
  color: #212121;
}

.header-title {
  flex: 1;
  text-align: center;
  margin: 0 1rem;
}

/* Phantom right-side spacer that mirrors the back button's footprint, so
   the centered title is visually centered on screen rather than centered
   between the back button and the right edge. */
.header-actions {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.address-btn {
  width: 40px;
  height: 40px;
}

/* Content */
.receive-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 1rem;
  overflow-y: auto;
  justify-content: space-between;
  min-height: 0;
}

/* Amount Icon Section */
.amount-icon-section {
  display: flex;
  justify-content: center;
  margin-bottom: 2rem;
  align-items: center;
}

.amount-icon {
  opacity: 0.3;
}

/* ===========================================
   Shared QR Code Styles - Used by Lightning, Spark, Bitcoin
   =========================================== */
.qr-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8px;
}

.qr-card {
  cursor: pointer;
  transition: transform 0.2s ease;
}

.qr-card:active {
  transform: scale(0.98);
}

.qr-frame {
  background: #FFFFFF;
  padding: 14px;
  border-radius: var(--radius-md);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

.qr-frame .qr-code {
  display: block;
  border-radius: 8px;
}

.qr-hint {
  font-size: 12px;
  margin-top: 8px;
  opacity: 0.5;
}

/* ===========================================
   Lightning Receive
   =========================================== */
.lightning-receive {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
}

/* Amount Section */
.ln-amount-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 8px 0 16px;
}

.ln-amount {
  font-family: 'Manrope', sans-serif;
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
}

.ln-fiat {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 400;
  margin-top: 4px;
}

.ln-memo {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 400;
  margin-top: 8px;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.1);
}

/* Status */
.ln-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 6px 12px;
  border-radius: 20px;
  background: rgba(255, 212, 59, 0.1);
}

.ln-status span {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: #FFD43B;
}

.ln-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #FFD43B;
  animation: pulse 2s ease-in-out infinite;
}

/* Status Variants */
.ln-status.status-pending { background: rgba(255, 212, 59, 0.1); }
.ln-status.status-pending span { color: #FFD43B; }
.ln-status.status-pending .ln-status-dot { background: #FFD43B; }

.ln-status.status-confirmed { background: rgba(21, 222, 114, 0.1); }
.ln-status.status-confirmed span { color: #15DE72; }
.ln-status.status-confirmed .ln-status-dot { background: #15DE72; animation: none; }

.ln-status.status-expired { background: rgba(107, 114, 128, 0.1); }
.ln-status.status-expired span { color: #6B7280; }
.ln-status.status-expired .ln-status-dot { background: #6B7280; animation: none; }

.ln-status.status-error { background: rgba(239, 68, 68, 0.1); }
.ln-status.status-error span { color: #EF4444; }
.ln-status.status-error .ln-status-dot { background: #EF4444; animation: none; }

/* Responsive - Lightning Amount */
@media (max-width: 375px) {
  .ln-amount {
    font-size: 32px;
  }

  .ln-fiat {
    font-size: 13px;
  }
}

@media (max-width: 320px) {
  .ln-amount {
    font-size: 28px;
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.9);
  }
}

/* QR Container - Used by Lightning Address View */
.qr-container {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: min(320px, calc(100vw - 48px)); /* Never exceed viewport minus padding */
  -webkit-tap-highlight-color: transparent;
}

.qr-wrapper {
  background: #FFFFFF;
  border-radius: var(--radius-md);
  padding: clamp(0.75rem, 3vw, 1.25rem); /* Responsive padding */
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  border: 1px solid rgba(0, 0, 0, 0.08);
  width: 100%;
  box-sizing: border-box;
}

.qr-container:active .qr-wrapper {
  transform: scale(0.97);
}

.qr-code {
  width: 100%;
  height: auto;
  display: block;
  border-radius: 8px;
  max-width: 100%;
}

/* Action Buttons - Shared Style */
.action-buttons {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
}

/* Default zero-amount loading state */
.default-zero-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 48px 16px;
}
.default-zero-loading-text {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* 3-button row: icon above label, equal width. Used on default-QR views
   (LN address, Spark Lightning zero-amount) for Redeem/Share/Amount.
   `margin-top: auto` anchors the row to the bottom of its flex-column
   parent so the QR sits up top and the actions live at the bottom edge. */
.action-buttons-three {
  width: 100%;
  margin-top: auto;
  padding-top: 16px;
}
.action-buttons-three .action-btn {
  flex: 1;
  flex-direction: column;
  gap: 6px;
  padding: 14px 8px;
  min-height: 68px;
  font-size: 13px;
}

/* Share Invoice gradient button */
.share-btn-gradient {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: var(--radius-pill);
  background: var(--gradient-green);
  color: #FFF;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.share-btn-gradient:hover {
  opacity: 0.9;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.005em;
  transition: background-color 0.18s ease, color 0.18s ease;
}

.action-btn-dark {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.08);
}

.action-btn-dark:hover {
  background: rgba(255, 255, 255, 0.12);
}

.action-btn-light {
  color: rgba(0, 0, 0, 0.7);
  background: rgba(0, 0, 0, 0.05);
}

.action-btn-light:hover {
  background: rgba(0, 0, 0, 0.08);
}


/* Amount Section */
.amount-section {
  margin-bottom: 2rem;
  text-align: center;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
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
  background: var(--bg-input);
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
  font-family: 'Manrope', sans-serif;
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

.amount-display {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.currency-symbol {
  font-family: 'Manrope', sans-serif;
  font-size: 2.5rem;
  font-weight: 300;
}

.amount-input {
  font-family: 'Manrope', sans-serif;
  font-size: 2.75rem;
  font-weight: 300;
  border: none;
  outline: none;
  background: transparent;
  text-align: center;
  min-width: min(200px, 60vw);
  max-width: 100%;
  /* Use the brand green for the caret so it signals interactivity
     without clashing with the numeric display. */
  caret-color: #15DE72;
}
/* Suppress the caret while the placeholder (e.g. "0") is showing
   so the vertical bar doesn't visually slice through the digit.
   As soon as the user types, the caret returns. */
.amount-input:placeholder-shown {
  caret-color: transparent;
}

.amount-input-dark {
  color: #FFF;
}

.amount-input-light {
  color: var(--text-primary);
}

.amount-input::placeholder {
  color: #B0B0B0;
}

/* Description Section */
.description-section {
  margin-bottom: 2rem;
  flex-shrink: 0;
}

.description-label {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  margin-bottom: 0.75rem;
  text-align: center;
}

.view_title_dark {
  color: #B0B0B0;
}

.description-input-container {
  max-width: 320px;
  margin: 0 auto;
}

.description-input {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.description-input:focus {
  border-color: #15DE72;
}

.description-input::placeholder {
  color: #B0B0B0;
}

/* Footer */
.receive-footer {
  padding: 1rem 1.5rem;
  /* var(--safe-bottom) so the Android boot fallback applies; env()
     returns 0 on Android WebViews and would leave the CTA flush
     against the gesture-nav bar. */
  padding-bottom: max(1.5rem, var(--safe-bottom, 1.5rem));
  flex-shrink: 0;
}

.receive-footer-buttons {
  display: flex;
  align-items: center;
  gap: 12px;
}

.scan-withdraw-btn {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  flex-shrink: 0;
}

.scan-btn-dark {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}

.scan-btn-light {
  background: rgba(0, 0, 0, 0.05);
  color: rgba(0, 0, 0, 0.5);
}

/* Primary CTA for the receive flow — tinted green fill, same
   grammar as the Receive button on the wallet and the Spark/
   Lightning/Bitcoin toggle's active state. Rounded to match the
   app's card language (16px) rather than the old pill (24px). */
.create-invoice-btn {
  width: 100%;
  height: 52px;
  border-radius: 16px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.005em;
  border: none;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s cubic-bezier(0.4, 0, 0.2, 1),
    filter 0.18s ease;
}

.create-invoice-btn-dark {
  background: rgba(21, 222, 114, 0.14) !important;
  color: #15DE72 !important;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.22);
}

.create-invoice-btn-light {
  /* Neutralise to the shared "primary action on cream" style so
     the invoice CTA carries the same weight as the wallet-home
     Receive/Send pair it follows from. Dark theme keeps the green
     tinted-wash above because it still reads as an accent there. */
  background: var(--btn-neutral-bg) !important;
  color: var(--btn-neutral-fg) !important;
  box-shadow: none;
}

.create-invoice-btn:hover:not(:disabled) {
  filter: brightness(1.06);
}

.create-invoice-btn:active:not(:disabled) {
  transform: scale(0.98);
  transition-duration: 0.08s;
  filter: brightness(0.94);
}

/* Disabled state stays muted so newbies see clearly that an amount
   is required before they can create the invoice. */
.create-invoice-btn:disabled,
.create-invoice-btn[disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Responsive Design */
@media (max-width: 480px) {
  .receive-content {
    padding: 1.5rem 1rem;
  }

  .action-buttons {
    gap: 10px;
  }

  .action-btn {
    padding: 8px 14px;
    font-size: 13px;
  }

  .invoice-actions {
    max-width: 320px;
  }

  .invoice-action-btn {
    height: 42px;
    font-size: 14px;
  }

  .amount-icon-section {
    margin-bottom: 1.5rem;
  }

  .amount-input {
    font-size: 2.25rem;
    min-width: 160px;
  }

  .currency-symbol {
    font-size: 2rem;
  }

  .amount-section {
    margin-bottom: 1.5rem;
  }

  .description-section {
    margin-bottom: 1.5rem;
  }

  .description-input-container {
    max-width: 280px;
  }

  .receive-footer {
    padding: 0.75rem 1rem;
    padding-bottom: max(1.25rem, var(--safe-bottom, 1.25rem));
  }

  .create-invoice-btn {
    height: 48px;
  }
}

/* Extra small screens (360px and below) */
@media (max-width: 360px) {
  .action-buttons {
    gap: 8px;
  }

  .action-btn {
    padding: 8px 12px;
    font-size: 13px;
  }

  .invoice-actions {
    max-width: calc(100vw - 48px);
    flex-direction: column;
  }

  .invoice-action-btn {
    width: 100%;
  }

  .amount-input {
    font-size: 2rem;
    min-width: 120px;
  }

  .currency-symbol {
    font-size: 1.75rem;
  }

  .address-qr-section {
    padding: 1rem;
  }
}

/* Spark Address View */
.spark-address-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  min-height: 0;
}

/* Address Pill - Shared by Spark */
.address-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin: 12px auto 0;
}

.address-pill:active {
  transform: scale(0.98);
}

.pill-dark {
  background: rgba(255, 255, 255, 0.08);
}

.pill-dark:hover {
  background: rgba(255, 255, 255, 0.12);
}

.pill-light {
  background: rgba(0, 0, 0, 0.04);
}

.pill-light:hover {
  background: rgba(0, 0, 0, 0.06);
}

.pill-icon-img {
  width: 16px;
  height: 16px;
}

.pill-address {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.02em;
}

.pill-copy {
  opacity: 0.4;
}

.address-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  text-align: center;
  max-width: 280px;
  line-height: 1.4;
  margin-top: 16px;
}

/* Lightning Address View */
.address-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0;
  min-height: 0;
}

.address-qr-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem 1.5rem 2rem;
  gap: 1.25rem;
}

.address-display-box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  cursor: pointer;
  width: 100%;
  max-width: 320px;
  transition: all 0.2s ease;
}

.address-box-dark {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.address-box-dark:hover {
  background: rgba(255, 255, 255, 0.08);
}

.address-box-dark:active {
  transform: scale(0.98);
}

.address-box-light {
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.address-box-light:hover {
  background: rgba(0, 0, 0, 0.05);
}

.address-box-light:active {
  transform: scale(0.98);
}

.address-icon {
  color: #15DE72;
  flex-shrink: 0;
}

.address-text-value {
  font-family: var(--font-mono);
  font-size: 13px;
  flex: 1;
  word-break: break-all;
  line-height: 1.3;
  text-align: center;
}

.copy-icon {
  opacity: 0.4;
  flex-shrink: 0;
}

.address-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  text-align: center;
  line-height: 1.5;
  max-width: 280px;
  margin-top: 0.5rem;
}

@media (max-width: 480px) {
  .address-qr-section {
    padding: 1rem;
    gap: 1rem;
  }

  .address-display-box {
    max-width: 280px;
    padding: 0.625rem 0.875rem;
  }

  .address-text-value {
    font-size: 12px;
  }

  .address-hint {
    font-size: 12px;
    max-width: 260px;
  }
}

/* Spark/Lightning Toggle */
.receive-type-toggle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

/* Spark / Lightning / Bitcoin segmented control — compact row of
   tabs matching the Wallet page's Business/Personal spark-tabs
   grammar: tight padding, icons tucked left of each label. Active
   segment keeps the green tinted fill that matches the rest of the
   receive flow. */
.type-toggle {
  border-radius: 12px;
  overflow: hidden;
  max-width: 260px;
  width: 100%;
  padding: 3px;
}

.type-toggle :deep(.q-btn) {
  position: relative;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.005em;
  padding: 0 0.875rem;
  min-height: 34px;
  border-radius: 9px;
  margin-left: 3px;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}

.type-toggle :deep(.q-btn:first-child) {
  margin-left: 0;
}

.type-toggle :deep(.q-btn__content) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.type-toggle :deep(.q-btn--active) {
  font-weight: 600;
}

/* Wipe Quasar's utility active fill so our grey pane wins */
.type-toggle :deep(.q-btn.bg-primary) {
  background: transparent !important;
}

.type-toggle :deep(.q-btn__content .q-icon) {
  margin: 0;
  font-size: 14px;
}

.type-toggle :deep(.q-btn__content img) {
  width: 12px;
  height: 12px;
}

/* Hairline dividers sit in the 3px gap between segments
   (margin-left on each btn after the first). Hidden next
   to the active segment so the grey pane reads cleanly. */
.type-toggle :deep(.q-btn + .q-btn)::before {
  content: '';
  position: absolute;
  left: -2px;
  top: 50%;
  transform: translateY(-50%);
  width: 1px;
  height: 16px;
  pointer-events: none;
  transition: opacity 0.18s ease;
}

.type-toggle :deep(.q-btn--active)::before,
.type-toggle :deep(.q-btn--active + .q-btn)::before {
  opacity: 0;
}

/* Kill Quasar's default pre-active overlay so tinted fills read
   cleanly without a darkening wash over the top. */
.type-toggle :deep(.q-btn .q-focus-helper) {
  display: none;
}

/* --- Dark --- */
.toggle-dark {
  background: #1A1A1A;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.toggle-dark :deep(.q-btn) {
  color: var(--text-muted);
  background: transparent;
}

.toggle-dark :deep(.q-btn--active) {
  background: #2A2A2A !important;
  color: #FFFFFF !important;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.18),
    0 1px 3px rgba(0, 0, 0, 0.3);
}

.toggle-dark :deep(.q-btn + .q-btn)::before {
  background: rgba(255, 255, 255, 0.12);
}

/* --- Light --- */
.toggle-light {
  /* Warm container so the pill sits inside the cream family, not a cool island. */
  background: var(--bg-input);
  border: 1px solid var(--border-card);
}

.toggle-light :deep(.q-btn) {
  color: var(--text-secondary);
  background: transparent;
}

/* Higher specificity (.q-btn.q-btn--active) beats Quasar's `.text-white`
   class, which was making the active label invisible on the pill. */
.toggle-light :deep(.q-btn.q-btn--active),
.toggle-light :deep(.q-btn.q-btn--active.text-white) {
  background: #FFFFFF !important;
  color: var(--text-primary) !important;
  box-shadow:
    inset 0 0 0 1px var(--border-card),
    0 1px 2px rgba(40, 34, 20, 0.08) !important;
}

.toggle-light :deep(.q-btn + .q-btn)::before {
  background: rgba(40, 34, 20, 0.12);
}

.mode-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  text-align: center;
}

/* Spark Address Specific */
.spark-icon {
  color: #FF6B35;
}

.spark-address-box {
  margin-top: 1rem;
}

.spark-actions {
  display: flex;
  gap: 0.75rem;
  width: 100%;
  max-width: 320px;
  margin-top: 1rem;
}

@media (max-width: 480px) {
  .type-toggle {
    max-width: 240px;
  }

  .type-toggle :deep(.q-btn) {
    font-size: 11px;
    padding: 0 0.6rem;
    min-height: 32px;
  }

  .spark-actions {
    max-width: 280px;
  }
}

/* ===========================================
   In-app Keypad (Alby-inspired)
   =========================================== */
.keypad-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding-top: 0.5rem;
  min-height: 0;
}

/* Amount display */
.keypad-amount {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 0 0.5rem;
}

.keypad-amount-primary {
  font-family: 'Manrope', sans-serif;
  font-size: 44px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}

.keypad-amount-primary.keypad-amount-empty {
  opacity: 0.35;
}

.keypad-amount-suffix {
  font-size: 18px;
  font-weight: 500;
  letter-spacing: 0;
  opacity: 0.6;
}

.keypad-amount-secondary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 500;
  padding: 0.4rem 0.8rem;
  border-radius: 999px;
  cursor: pointer;
  transition: background-color 0.15s ease;
  user-select: none;
}

.keypad-amount-secondary:active {
  background: rgba(128, 128, 128, 0.12);
}

.keypad-swap-icon {
  opacity: 0.6;
}

/* Description link / chip */
.keypad-desc-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: transparent;
  border: none;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  transition: background-color 0.15s ease;
}

.keypad-desc-link:active {
  background: rgba(128, 128, 128, 0.1);
}

.keypad-desc-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: none;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  max-width: 80%;
}

.desc-chip-light {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.75);
}

.desc-chip-dark {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
}

.keypad-desc-chip-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 3x4 keypad grid */
.keypad-grid {
  width: 100%;
  max-width: 360px;
  margin-top: auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  padding-bottom: 0.5rem;
}

.keypad-key {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 60px;
  border: none;
  border-radius: 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: background-color 0.12s ease, transform 0.08s ease;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.keypad-key:active {
  transform: scale(0.96);
}

.keypad-key-light {
  background: rgba(0, 0, 0, 0.04);
  color: #1A1A1A;
}

.keypad-key-light:active {
  background: rgba(0, 0, 0, 0.09);
}

.keypad-key-dark {
  background: rgba(255, 255, 255, 0.06);
  color: #FFFFFF;
}

.keypad-key-dark:active {
  background: rgba(255, 255, 255, 0.12);
}

@media (max-width: 360px) {
  .keypad-amount-primary { font-size: 36px; }
  .keypad-amount-suffix { font-size: 15px; }
  .keypad-key { height: 52px; font-size: 22px; }
}

/* Description bottom sheet */
.desc-sheet {
  width: 100%;
  border-top-left-radius: 18px;
  border-top-right-radius: 18px;
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.desc-sheet-light { background: #FFFFFF; }
.desc-sheet-dark { background: #1A1A1A; }

.desc-sheet-section {
  padding: 1.25rem 1rem 1rem;
}

.desc-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.desc-sheet-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

.desc-sheet-input {
  width: 100%;
  height: 48px;
  padding: 0 0.875rem;
  border-radius: 12px;
  border: none;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 500;
  margin-bottom: 1rem;
}

.desc-sheet-input:focus {
  outline: none;
}

.desc-sheet-save {
  width: 100%;
  height: 48px;
  border-radius: 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
}
</style>
