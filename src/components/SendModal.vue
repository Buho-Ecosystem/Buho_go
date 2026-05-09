<!--
  SendModal
  Camera-first scan flow opened from the wallet's Send button. Below the
  scanner sit three soft pill tiles ("Manual" / "Paste" / "Contacts") that
  cover every non-QR input path:

    - Manual:   bottom sheet with one auto-detecting input field. Friendly
                placeholder, type chip appears as the user types or pastes.
    - Paste:    reads the clipboard, fills the Manual sheet, lets the user
                verify before committing. No silent fire-and-forget.
    - Contacts: delegates to AddressBookQuickModal — same UI used from the
                wallet home, single source of truth for the contact picker.

  All payment-routing logic (BIP21 unwrap, SA-retailer QR conversion,
  Lightning/LNURL/Spark/Bitcoin detection, parent emit) is unchanged from
  the previous version — only the presentation layer was rebuilt.
-->
<template>
  <q-dialog
    v-model="show"
    maximized
    transition-show="slide-up"
    transition-hide="slide-down"
    class="send-modal"
    @before-hide="resetState"
  >
    <q-card class="send-card" :class="$q.dark.isActive ? 'send-card-dark' : 'send-card-light'">
      <!-- Header -->
      <q-card-section class="send-header">
        <div class="header-content">
          <q-btn
            flat
            round
            dense
            @click="closeModal"
            class="back-btn"
            :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
          >
            <Icon icon="tabler:chevron-left" width="20" height="20" />
          </q-btn>
          <div class="header-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
            {{ $t('Send') }}
          </div>
          <div class="header-spacer"></div>
        </div>
      </q-card-section>

      <!-- Camera View -->
      <div class="camera-container">
        <video
          v-if="showCamera && !isProcessing"
          ref="videoElement"
          class="camera-view"
          style="width: 100%; height: 100%; object-fit: cover;"
          playsinline
        />

        <!-- Processing Overlay — neutral grey, no brand accents in the
             scanner per design direction. -->
        <div v-if="isProcessing" class="processing-overlay">
          <q-spinner-dots color="grey-5" size="3rem" />
          <div class="processing-text">{{ $t('Processing payment...') }}</div>
        </div>

        <!-- Camera Error -->
        <div v-if="cameraError" class="camera-error">
          <Icon icon="tabler:camera" style="font-size: 4rem; color: #bdbdbd;" />
          <div class="error-title">{{ $t('Camera Access Required') }}</div>
          <div class="error-subtitle">{{ cameraError }}</div>
          <q-btn
            class="retry-btn"
            :class="$q.dark.isActive ? 'retry-btn-dark' : 'retry-btn-light'"
            :label="$t('Retry')"
            @click="initializeCamera"
            no-caps
            unelevated
          />
        </div>
      </div>

      <!-- Bottom Actions: three pill tiles. Same horizontal rhythm,
           softer language. -->
      <q-card-section class="send-actions" :class="$q.dark.isActive ? 'actions-dark' : 'actions-light'">
        <div class="action-buttons">
          <button
            type="button"
            class="action-tile"
            :class="$q.dark.isActive ? 'action-tile-dark' : 'action-tile-light'"
            @click="openManual"
          >
            <Icon icon="tabler:keyboard" width="22" height="22" class="tile-icon" />
            <span class="tile-label">{{ $t('Manual') }}</span>
          </button>

          <button
            type="button"
            class="action-tile"
            :class="$q.dark.isActive ? 'action-tile-dark' : 'action-tile-light'"
            @click="pasteFromClipboard"
          >
            <Icon icon="tabler:clipboard" width="22" height="22" class="tile-icon" />
            <span class="tile-label">{{ $t('Paste') }}</span>
          </button>

          <button
            type="button"
            class="action-tile"
            :class="$q.dark.isActive ? 'action-tile-dark' : 'action-tile-light'"
            @click="openContacts"
          >
            <Icon icon="tabler:address-book" width="22" height="22" class="tile-icon" />
            <span class="tile-label">{{ $t('Contacts') }}</span>
          </button>
        </div>
      </q-card-section>
    </q-card>

    <!-- ─────────────  MANUAL INPUT (bottom sheet)  ───────────── -->
    <q-dialog
      v-model="showManualDialog"
      position="bottom"
      class="manual-sheet-dialog"
    >
      <q-card class="manual-sheet" :class="$q.dark.isActive ? 'manual-sheet-dark' : 'manual-sheet-light'">
        <div class="grab-bar"></div>

        <header class="sheet-top">
          <q-btn flat round dense v-close-popup class="sheet-top-btn">
            <Icon icon="tabler:x" width="20" height="20" />
          </q-btn>
          <div class="sheet-top-title">{{ $t('Pay anyone') }}</div>
          <div class="sheet-top-spacer"></div>
        </header>

        <section class="sheet-body">
          <div class="input-label-row">
            <div class="input-label">{{ $t('Payment address or invoice') }}</div>
            <transition name="type-pill">
              <div
                v-if="detectedInputType"
                class="detected-pill"
                :class="`detected-pill--${detectedInputType}`"
              >
                <img
                  v-if="detectedInputType === 'spark'"
                  width="11" height="11"
                  :src="$q.dark.isActive ? '/Spark/Spark Asterisk White.svg' : '/Spark/Spark Asterisk Black.svg'"
                  alt="Spark"
                />
                <Icon v-else :icon="detectedInputIcon" width="12" height="12" />
                <span>{{ detectedInputLabel }}</span>
              </div>
            </transition>
          </div>

          <textarea
            v-model="manualInput"
            class="manual-textarea"
            :class="[
              $q.dark.isActive ? 'manual-textarea-dark' : 'manual-textarea-light',
              manualInputShowsError ? 'manual-textarea--error' : ''
            ]"
            :placeholder="$t('Paste an invoice or enter an address from your friend or shop')"
            rows="3"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            ref="manualTextarea"
          />

          <div class="input-helper">
            <template v-if="manualInputShowsError">
              <Icon icon="tabler:alert-circle" width="13" height="13" class="helper-icon-error" />
              <span>{{ $t("We don't recognize this format") }}</span>
            </template>
            <template v-else>
              <span>{{ $t('Works with Lightning, Spark, Bitcoin, and LNURL') }}</span>
            </template>
          </div>
        </section>

        <footer class="sheet-footer">
          <button
            type="button"
            class="primary-cta"
            :disabled="!isValidManualInput"
            @click="processManualInput"
          >
            {{ $t('Continue') }}
          </button>
        </footer>
      </q-card>
    </q-dialog>

    <!-- ─────────────  CONTACTS (delegated)  ───────────── -->
    <AddressBookQuickModal
      v-model="showQuickContacts"
      @pay-contact="onContactPicked"
    />
  </q-dialog>
</template>

<script>
import QrScanner from 'qr-scanner';
import { useAddressBookStore } from '../stores/addressBook';
import { useWalletStore } from '../stores/wallet';
import { isSARetailerQR, convertToLightningAddress, getMerchantInfo, SA_RETAIL_SOURCE } from '../utils/merchantQR';
import { parseBip21, selectBip21Destination } from '../utils/bip21';
import {
  isSparkAddress,
  isLightningInvoice,
  isLnurl,
  isBitcoinAddress,
  isLightningAddress,
} from '../utils/addressUtils';
import AddressBookQuickModal from './AddressBookQuickModal.vue';

export default {
  name: 'SendModal',
  components: { AddressBookQuickModal },
  props: {
    modelValue: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue', 'payment-detected'],
  setup() {
    const addressBookStore = useAddressBookStore();
    const walletStore = useWalletStore();
    return { addressBookStore, walletStore };
  },
  data() {
    return {
      showCamera: false,
      isProcessing: false,
      cameraError: null,
      showManualDialog: false,
      showQuickContacts: false,
      manualInput: '',
      qrScanner: null,
      videoElement: null
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

    isActiveWalletSpark() {
      return this.walletStore.isActiveWalletSpark;
    },

    // Live detection mirrors AddressBookModal's pattern. We strip URI
    // wrappers (lightning:, bitcoin:) so a paste like
    // "lightning:lnbc1..." resolves to lightning_invoice rather than
    // the raw scheme.
    detectedInputType() {
      const raw = (this.manualInput || '').trim();
      if (!raw) return null;
      const lower = raw.toLowerCase();

      // BIP21 first — bitcoin:<addr>?... is structurally distinct and
      // we want the "Bitcoin (BIP21)" label even when the inner is an
      // on-chain address that would also pass isBitcoinAddress.
      if (lower.startsWith('bitcoin:')) {
        const parsed = parseBip21(raw);
        if (parsed) return 'bip21';
      }

      const cleaned = lower.startsWith('lightning:')
        ? raw.substring(10).trim()
        : raw;

      if (isSparkAddress(cleaned)) return 'spark';
      if (isLightningInvoice(cleaned)) return 'lightning_invoice';
      if (isLightningAddress(cleaned)) return 'lightning_address';
      if (isLnurl(cleaned)) return 'lnurl';
      if (isBitcoinAddress(cleaned)) return 'bitcoin_address';
      return null;
    },

    detectedInputLabel() {
      const labels = {
        spark: this.$t('Spark'),
        lightning_invoice: this.$t('Lightning Invoice'),
        lightning_address: this.$t('Lightning Address'),
        lnurl: this.$t('LNURL'),
        bitcoin_address: this.$t('Bitcoin'),
        bip21: this.$t('Bitcoin (BIP21)')
      };
      return labels[this.detectedInputType] || '';
    },

    detectedInputIcon() {
      const icons = {
        lightning_invoice: 'tabler:bolt',
        lightning_address: 'tabler:bolt',
        lnurl: 'tabler:link',
        bitcoin_address: 'tabler:currency-bitcoin',
        bip21: 'tabler:currency-bitcoin'
      };
      return icons[this.detectedInputType] || '';
    },

    manualInputShowsError() {
      return this.manualInput.trim().length > 0 && !this.detectedInputType;
    },

    isValidManualInput() {
      return !!this.detectedInputType;
    }
  },
  watch: {
    show(newVal) {
      if (newVal) {
        this.initializeCamera();
      } else {
        this.stopQrScanner();
        this.showCamera = false;
        this.resetState();
      }
    }
  },
  beforeUnmount() {
    this.stopQrScanner();
  },
  methods: {
    async initializeCamera() {
      this.cameraError = null;
      try {
        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera) {
          throw new Error('No camera found on this device.');
        }

        this.showCamera = true;
        await this.$nextTick();
        await this.startQrScanner();
      } catch (error) {
        console.error('Camera initialization error:', error);
        this.handleCameraError(error);
      }
    },

    async startQrScanner() {
      try {
        if (!this.$refs.videoElement) {
          throw new Error('Video element not found');
        }

        this.videoElement = this.$refs.videoElement;

        this.qrScanner = new QrScanner(
          this.videoElement,
          (result) => {
            const data = typeof result === 'string' ? result : (result?.data || result?.text || '');
            this.onQRDetect(data);
          },
          {
            returnDetailedScanResult: true,
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: 'environment'
          }
        );

        await this.qrScanner.start();
      } catch (error) {
        console.error('Error starting QR scanner:', error);
        this.handleCameraError(error);
      }
    },

    stopQrScanner() {
      if (this.qrScanner) {
        this.qrScanner.stop();
        this.qrScanner.destroy();
        this.qrScanner = null;
      }
    },

    handleCameraError(error) {
      if (error.name === 'NotAllowedError') {
        this.cameraError = this.$t('Camera permission denied. Please allow camera access and try again.');
      } else if (error.name === 'NotFoundError') {
        this.cameraError = this.$t('No camera found on this device.');
      } else if (error.name === 'NotSupportedError') {
        this.cameraError = this.$t('Camera not supported in this browser.');
      } else {
        this.cameraError = this.$t('Failed to access camera. Please try again.');
      }
    },

    async onQRDetect(qrContent) {
      if (this.isProcessing || !qrContent) return;

      this.isProcessing = true;

      try {
        await this.processPaymentData(qrContent);
      } catch (error) {
        console.error('QR processing error:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Invalid QR code'),
          caption: this.$t('Please try a different code'),
        });
        this.isProcessing = false;
      }
    },

    async processPaymentData(paymentData) {
      try {
        const inputData = typeof paymentData === 'string'
          ? paymentData
          : (paymentData?.data || paymentData?.text || String(paymentData || ''));

        if (!inputData || inputData.trim().length === 0) {
          throw new Error(this.$t('Invalid payment data'));
        }

        let trimmedData = inputData.trim();

        // Check for SA retailer QR codes (PnP, Checkers, Woolworths, etc.)
        if (isSARetailerQR(trimmedData)) {
          const result = convertToLightningAddress(trimmedData);
          if (result) {
            this.$emit('payment-detected', {
              data: result.lightningAddress,
              type: 'lightning_address',
              source: SA_RETAIL_SOURCE,
              merchant: result.merchant,
            });
            this.closeModal();
            return;
          }
          const merchant = getMerchantInfo(trimmedData);
          this.$q.notify({
            type: 'warning',
            message: this.$t('SA Retailer QR detected'),
            caption: merchant
              ? `${merchant.displayName} - ${this.$t('not yet supported')}`
              : this.$t('This retailer is not yet supported'),
            timeout: 4000,
          });
          this.isProcessing = false;
          return;
        }

        // Resolve URI wrappers: strip `lightning:`, and for BIP21
        // (`bitcoin:<addr>?amount=...&lightning=lnbc...`) prefer the embedded
        // BOLT11 invoice over the on-chain address.
        const { cleaned: resolved, bip21 } = this.normalizePaymentInput(trimmedData);
        let cleanData = resolved;

        if (cleanData.includes('@') && cleanData.includes('.')) {
          cleanData = cleanData.toLowerCase();
        }

        const paymentType = this.determinePaymentType(cleanData);

        if (paymentType === 'spark_address' && !this.isActiveWalletSpark) {
          this.$q.notify({
            type: 'warning',
            message: this.$t('Spark address detected'),
            caption: this.$t('Switch to Spark wallet to pay this address'),
            timeout: 4000,
          });
        }

        if (paymentType === 'bitcoin_address' && !this.isActiveWalletSpark) {
          this.$q.notify({
            type: 'warning',
            message: this.$t('Bitcoin address detected'),
            caption: this.$t('Switch to Spark wallet to send to Bitcoin addresses'),
            timeout: 4000,
          });
        }

        this.$emit('payment-detected', {
          data: cleanData,
          type: paymentType,
          ...(bip21 ? { bip21 } : {})
        });

        this.closeModal();

      } catch (error) {
        throw error;
      }
    },

    /**
     * Unwrap URI schemes to the inner payment destination.
     *
     * - `lightning:<...>`      → strip prefix
     * - `bitcoin:<addr>?...`   → parse BIP21, prefer embedded `lightning=`
     *                            invoice over on-chain address
     */
    normalizePaymentInput(input) {
      const trimmed = (input || '').trim();

      const bip21 = parseBip21(trimmed);
      if (bip21) {
        const destination = selectBip21Destination(bip21);
        return { cleaned: destination ? destination.value : '', bip21 };
      }

      if (trimmed.toLowerCase().startsWith('lightning:')) {
        return { cleaned: trimmed.substring(10), bip21: null };
      }

      return { cleaned: trimmed, bip21: null };
    },

    determinePaymentType(data) {
      const { cleaned } = this.normalizePaymentInput(data);
      if (!cleaned) return 'unknown';

      if (isSparkAddress(cleaned)) return 'spark_address';
      if (isLightningInvoice(cleaned)) return 'lightning_invoice';
      if (isLightningAddress(cleaned)) return 'lightning_address';
      if (isLnurl(cleaned)) return 'lnurl';
      if (isBitcoinAddress(cleaned)) return 'bitcoin_address';
      return 'unknown';
    },

    openManual() {
      this.manualInput = '';
      this.showManualDialog = true;
      this.$nextTick(() => {
        this.$refs.manualTextarea?.focus();
      });
    },

    async pasteFromClipboard() {
      let clipboardText = '';

      // Modern Clipboard API
      if (navigator.clipboard && navigator.clipboard.readText) {
        try {
          clipboardText = await navigator.clipboard.readText();
        } catch (e) {
          console.warn('clipboard.readText() failed:', e);
        }
      }

      // Some Android WebViews block readText() but allow read()
      if (!clipboardText && navigator.clipboard && navigator.clipboard.read) {
        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            if (item.types.includes('text/plain')) {
              const blob = await item.getType('text/plain');
              clipboardText = await blob.text();
              break;
            }
          }
        } catch (e) {
          console.warn('clipboard.read() failed:', e);
        }
      }

      // Always pre-fill the Manual sheet for the user to verify before
      // committing. No silent auto-process from the clipboard — too easy
      // to send to a stale or wrong address otherwise.
      this.manualInput = (clipboardText || '').trim();
      this.showManualDialog = true;
      this.$nextTick(() => {
        this.$refs.manualTextarea?.focus();
      });

      if (!clipboardText) {
        this.$q.notify({
          type: 'info',
          message: this.$t('Paste into the input field'),
          caption: this.$t('Long-press the text field and tap Paste'),
          timeout: 4000,
        });
      }
    },

    async openContacts() {
      // The quick-contacts modal calls store.initialize() on its own
      // @show hook, so we don't pre-init here.
      this.showQuickContacts = true;
    },

    async onContactPicked(contact) {
      // Defensive — block payment paths the active wallet can't satisfy.
      if (!this.canPayContact(contact)) {
        this.$q.notify({
          type: 'warning',
          message: this.$t('Cannot pay this contact'),
          caption: this.getContactDisabledReason(contact),
          timeout: 3500,
        });
        return;
      }

      const address = this.getContactAddress(contact);
      const addressType = this.getContactAddressType(contact);

      const paymentTypeMap = {
        spark: 'spark_address',
        bitcoin: 'bitcoin_address',
        lightning: 'lightning_address'
      };
      const paymentType = paymentTypeMap[addressType] || 'lightning_address';

      this.$emit('payment-detected', {
        data: address,
        type: paymentType
      });
      this.showQuickContacts = false;
      this.closeModal();
    },

    // Contact helpers (used by the contact-picker handler above).
    getContactAddress(contact) {
      return this.addressBookStore.getEntryAddress(contact);
    },

    getContactAddressType(contact) {
      return this.addressBookStore.getEntryAddressType(contact);
    },

    canPayContact(contact) {
      const type = this.getContactAddressType(contact);
      if (type === 'spark' || type === 'bitcoin') {
        return this.isActiveWalletSpark;
      }
      return true;
    },

    getContactDisabledReason(contact) {
      if (!this.canPayContact(contact)) {
        const type = this.getContactAddressType(contact);
        if (type === 'bitcoin') {
          return this.$t('Switch to Spark wallet to send Bitcoin');
        }
        return this.$t('Switch to Spark wallet to pay this contact');
      }
      return '';
    },

    async processManualInput() {
      if (!this.isValidManualInput) return;

      this.showManualDialog = false;
      this.isProcessing = true;

      try {
        await this.processPaymentData(this.manualInput.trim());
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Invalid payment request'),
          caption: this.$t('Please check the format and try again'),
        });
        this.isProcessing = false;
      }
    },

    closeModal() {
      this.show = false;
    },

    resetState() {
      this.isProcessing = false;
      this.cameraError = null;
      this.manualInput = '';
      this.showManualDialog = false;
      this.showQuickContacts = false;
    }
  }
}
</script>

<style scoped>
.send-modal :deep(.q-dialog__inner) {
  padding: 0;
}

.send-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.send-card-dark {
  background: #0C0C0C;
  color: #FFF;
}

.send-card-light {
  background: var(--bg-primary);
  color: var(--text-primary);
}

/* Header */
.send-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 1rem;
  padding-top: calc(var(--safe-top, 0px) + 1rem);
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.send-card-light .send-header {
  border-bottom-color: var(--border-card);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.back-btn {
  color: inherit;
}

.header-title {
  flex: 1;
  text-align: center;
}

.header-spacer {
  width: 40px;
}

/* ─────────────────────────────────────────────────────────────
   Camera Container
   QR-scanner library injects its own scan-region overlay (default
   yellow). We desaturate it via :deep so the scanner reads as a
   neutral, soft-black-on-grey treatment per design direction —
   no green or yellow accents inside the scanner surface.
   ───────────────────────────────────────────────────────────── */
.camera-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #000;
}

.camera-view {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.camera-container :deep(.scan-region-highlight) {
  border-color: rgba(255, 255, 255, 0.55) !important;
}
.camera-container :deep(.scan-region-highlight-svg) {
  stroke: rgba(255, 255, 255, 0.55) !important;
  fill: transparent !important;
}
.camera-container :deep(.code-outline-highlight) {
  stroke: #1A1A1A !important;
  fill: rgba(26, 26, 26, 0.18) !important;
}

.processing-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.78);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 5;
}

.processing-text {
  color: rgba(255, 255, 255, 0.78);
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 500;
  margin-top: 1rem;
  letter-spacing: -0.005em;
}

.camera-error {
  position: absolute;
  inset: 0;
  background: #1f2937;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  text-align: center;
}

.error-title {
  font-family: 'Manrope', sans-serif;
  font-size: 20px;
  font-weight: 600;
  color: white;
  margin: 1rem 0 0.5rem;
}

.error-subtitle {
  color: #9ca3af;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  margin-bottom: 1.5rem;
  line-height: 1.5;
}

.retry-btn {
  border-radius: 12px;
  padding: 10px 20px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.005em;
  transition: background-color 0.18s ease;
}

.retry-btn-dark {
  background: rgba(255, 255, 255, 0.08) !important;
  color: rgba(255, 255, 255, 0.85) !important;
}

.retry-btn-dark:hover {
  background: rgba(255, 255, 255, 0.12) !important;
}

.retry-btn-light {
  background: rgba(0, 0, 0, 0.05) !important;
  color: rgba(0, 0, 0, 0.75) !important;
}

.retry-btn-light:hover {
  background: rgba(0, 0, 0, 0.08) !important;
}

/* ─────────────────────────────────────────────────────────────
   Bottom Actions — three pill tiles
   ───────────────────────────────────────────────────────────── */
.send-actions {
  border-top: 1px solid;
  padding: 1rem;
  padding-bottom: max(1rem, var(--safe-bottom, 1rem));
  flex-shrink: 0;
}

.actions-dark { border-top-color: rgba(255, 255, 255, 0.08); }
.actions-light { border-top-color: var(--border-card); }

.action-buttons {
  display: flex;
  gap: 10px;
}

.action-tile {
  flex: 1;
  height: 84px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    transform 0.08s ease;
}

.action-tile:active {
  transform: scale(0.97);
}

.action-tile-dark {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
}

.action-tile-dark:hover {
  background: rgba(255, 255, 255, 0.10);
  color: #FFF;
}

.action-tile-light {
  background: var(--bg-input);
  color: var(--text-secondary);
  box-shadow: inset 0 0 0 1px var(--border-card);
}

.action-tile-light:hover {
  background: rgba(17, 24, 39, 0.05);
  color: var(--text-primary);
}

.tile-icon {
  opacity: 0.85;
}

.tile-label {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

/* ─────────────────────────────────────────────────────────────
   Manual sheet (bottom)
   ───────────────────────────────────────────────────────────── */
.manual-sheet-dialog :deep(.q-dialog__inner) {
  padding: 0;
}

.manual-sheet-dialog :deep(.q-dialog__backdrop) {
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.manual-sheet {
  width: 100%;
  max-width: 520px;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  font-family: 'Manrope', sans-serif;
  padding-bottom: max(1rem, var(--safe-bottom, 0px));
}

.manual-sheet-dark {
  box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.55);
}

.manual-sheet-light {
  border-top: 1px solid var(--border-card);
  box-shadow: 0 -20px 50px rgba(40, 34, 20, 0.12);
}

.grab-bar {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--text-muted);
  opacity: 0.45;
  margin: 8px auto 4px;
}

.sheet-top {
  display: flex;
  align-items: center;
  padding: 4px 12px 8px;
}

.sheet-top-btn {
  width: 36px;
  height: 36px;
  color: var(--text-secondary);
}

.sheet-top-title {
  flex: 1;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.005em;
}

.sheet-top-spacer {
  width: 36px;
}

.sheet-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 20px 4px;
}

.input-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 22px;
}

.input-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

/* Auto-detection chip — same vocabulary as AddressBookModal so users
   recognize the affordance across surfaces. */
.detected-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  line-height: 1;
}

.detected-pill--lightning_address,
.detected-pill--lightning_invoice,
.detected-pill--lnurl {
  background: rgba(5, 149, 115, 0.12);
  color: #059573;
  box-shadow: inset 0 0 0 1px rgba(5, 149, 115, 0.22);
}

.body--dark .detected-pill--lightning_address,
.body--dark .detected-pill--lightning_invoice,
.body--dark .detected-pill--lnurl {
  background: rgba(21, 222, 114, 0.16);
  color: #15DE72;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.28);
}

.detected-pill--spark {
  background: rgba(120, 120, 120, 0.12);
  color: var(--text-primary);
  box-shadow: inset 0 0 0 1px rgba(120, 120, 120, 0.25);
}

.detected-pill--bitcoin_address,
.detected-pill--bip21 {
  background: rgba(247, 147, 26, 0.14);
  color: #C97A0F;
  box-shadow: inset 0 0 0 1px rgba(247, 147, 26, 0.28);
}

.body--dark .detected-pill--bitcoin_address,
.body--dark .detected-pill--bip21 {
  color: #F7931A;
  box-shadow: inset 0 0 0 1px rgba(247, 147, 26, 0.36);
}

.type-pill-enter-active,
.type-pill-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.type-pill-enter-from,
.type-pill-leave-to {
  opacity: 0;
  transform: translateY(-2px) scale(0.96);
}

/* Textarea — single field, same shape as AddressBook's address input. */
.manual-textarea {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  font-family: var(--font-mono), 'Manrope', sans-serif;
  font-size: 13.5px;
  line-height: 1.45;
  outline: none;
  resize: none;
  transition: border-color 0.18s ease;
  word-break: break-all;
}

.manual-textarea-dark {
  background: var(--bg-input);
  color: var(--text-primary);
}

.manual-textarea-light {
  background: var(--bg-input);
  color: var(--text-primary);
}

.manual-textarea:focus {
  border-color: var(--color-green);
}

.body--light .manual-textarea:focus {
  border-color: var(--text-primary);
}

.manual-textarea--error,
.manual-textarea--error:focus {
  border-color: rgba(239, 68, 68, 0.55);
}

.manual-textarea::placeholder {
  color: var(--text-muted);
  font-family: 'Manrope', sans-serif;
}

.input-helper {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.35;
  color: var(--text-muted);
  padding-left: 2px;
  min-height: 16px;
}

.helper-icon-error {
  color: #EF4444;
  flex-shrink: 0;
}

.sheet-footer {
  padding: 14px 20px 6px;
}

/* Primary CTA — gradient-green on dark, neutral-dark pill on cream.
   Same language as PaymentModal, AddressBookModal, etc. */
.primary-cta {
  width: 100%;
  height: 50px;
  border-radius: var(--radius-pill);
  border: none;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.005em;
  cursor: pointer;
  background: var(--gradient-green);
  color: #fff;
  transition: filter 0.15s ease, transform 0.08s ease, opacity 0.15s ease;
}

.body--light .primary-cta {
  background: var(--btn-neutral-bg);
  color: var(--btn-neutral-fg);
}

.primary-cta:hover:not(:disabled) {
  filter: brightness(1.05);
}

.primary-cta:active:not(:disabled) {
  transform: scale(0.985);
  filter: brightness(0.95);
}

.primary-cta:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Responsive */
@media (max-width: 480px) {
  .action-tile {
    height: 76px;
  }

  .tile-label {
    font-size: 12.5px;
  }

  .sheet-body {
    padding: 6px 16px 2px;
  }
}
</style>
