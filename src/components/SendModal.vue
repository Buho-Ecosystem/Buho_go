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
          v-if="showCamera && !ctaBusy"
          ref="videoElement"
          class="camera-view"
          style="width: 100%; height: 100%; object-fit: cover;"
          playsinline
        />

        <!-- Processing Overlay — neutral grey, no brand accents in the
             scanner per design direction. Stays up through the parent's
             address fetch (ctaBusy), not just our local decode. -->
        <div v-if="ctaBusy" class="processing-overlay">
          <q-spinner-dots color="grey-5" size="48px" />
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
      :persistent="ctaBusy"
    >
      <q-card class="manual-sheet" :class="$q.dark.isActive ? 'manual-sheet-dark' : 'manual-sheet-light'">
        <div class="grab-bar"></div>

        <header class="sheet-top">
          <!-- Always present so the user is never trapped mid-resolve. While
               busy it cancels the whole Send flow (closing only the inner sheet
               would strand the parent fetch + spinner); otherwise it just backs
               out of the manual sheet. -->
          <q-btn flat round dense class="sheet-top-btn" @click="onManualClose">
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
              (manualInputShowsError || resolveError) ? 'manual-textarea--error' : ''
            ]"
            :placeholder="$t('Paste an invoice or enter an address from your friend or shop')"
            rows="3"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            :disabled="ctaBusy"
            ref="manualTextarea"
            @paste="onTextareaPaste"
          />

          <div class="input-helper" :class="{ 'input-helper--error': resolveError || manualInputShowsError }">
            <template v-if="resolveError">
              <Icon icon="tabler:alert-circle" width="13" height="13" class="helper-icon-error" />
              <span>{{ resolveError }}</span>
            </template>
            <template v-else-if="manualInputShowsError">
              <Icon icon="tabler:alert-circle" width="13" height="13" class="helper-icon-error" />
              <span>{{ $t("We don't recognize this format") }}</span>
            </template>
            <template v-else>
              <span>{{ $t('Works with Lightning, Spark, Bitcoin, and LNURL') }}</span>
            </template>
          </div>
        </section>

        <footer class="sheet-footer">
          <!-- While we fetch + validate the destination, the CTA becomes the
               shared filling loading-button (same one the send/commit flow
               uses), so the wait reads as "we're resolving this", not a frozen
               button. The parent closes the sheet on success or pushes an
               inline error above on failure. -->
          <ProgressCta v-if="ctaBusy" :label="$t('Fetching…')" />
          <!-- 075-078 are valid mobile prefixes in BOTH Kenya and Zambia.
               Rather than silently guess (and risk paying the wrong country),
               let the user pick. Unambiguous numbers and +CC input skip
               straight to Continue / auto-advance. -->
          <div v-else-if="phoneNeedsCountryChoice" class="country-choice">
            <div class="country-choice-label">{{ $t('Which country?') }}</div>
            <div class="country-choice-row">
              <button
                v-for="c in recognizedPhone.candidates"
                :key="c.country.code"
                type="button"
                class="country-choice-btn"
                @click="selectPhoneCountry(c)"
              >
                <span class="country-choice-name">{{ countryName(c.country.code) }}</span>
                <span class="country-choice-number">{{ c.display }}</span>
              </button>
            </div>
          </div>
          <button
            v-else
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
import { createQrScanner } from '../utils/qrScanner';
import { useAddressBookStore } from '../stores/addressBook';
import { useWalletStore } from '../stores/wallet';
import { isSARetailerQR, convertToLightningAddress, getMerchantInfo, SA_RETAIL_SOURCE } from '../utils/merchantQR';
import { parseBip21, selectBip21Destination } from '../utils/bip21';
import {
  isSparkAddress,
  isArkadeAddress,
  isLightningInvoice,
  isLnurl,
  isBitcoinAddress,
  isLightningAddress,
} from '../utils/addressUtils';
import { recognizePhoneNumber } from '../services/lnAddressServices';
import { classifyIdentifier, LOOKUP_ERROR } from '../utils/nostrLookup';
import { resolveNostrLightningTarget, NOSTR_TARGET_ERROR } from '../services/nostrPaymentTarget';
import AddressBookQuickModal from './AddressBookQuickModal.vue';
import ProgressCta from './ProgressCta.vue';

export default {
  name: 'SendModal',
  components: { AddressBookQuickModal, ProgressCta },
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    // True while the parent (Wallet.onPaymentDetected) is fetching/validating
    // the destination after we emitted it. Drives the loading CTA so the user
    // sees that we are resolving the address, not guessing it.
    resolving: {
      type: Boolean,
      default: false
    },
    // Set by the parent when resolution fails (e.g. the Lightning address
    // doesn't exist). Shown inline in the field so the user can fix it without
    // ever leaving the "Pay anyone" sheet. Cleared on edit (update:resolveError).
    resolveError: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue', 'payment-detected', 'update:resolveError'],
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
    // Loading from the moment we submit (local isProcessing, covers our own
    // npub resolve + the QR decode) through the parent's fetch (resolving prop),
    // until the parent either shows the confirm sheet (closes us) or reports an
    // error. One flag drives both the camera overlay and the manual CTA.
    ctaBusy() {
      return this.isProcessing || this.resolving;
    },

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

    isActiveWalletArkade() {
      return this.walletStore.isActiveWalletArkade;
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
      if (isArkadeAddress(cleaned)) return 'arkade';
      if (isLightningInvoice(cleaned)) return 'lightning_invoice';
      // Bare Nostr key: `npub1…` / `nprofile1…` (optionally `nostr:`-prefixed).
      // Unambiguous — nothing else looks like this — so we resolve it to the
      // person's Lightning address. NIP-05 (`name@domain`) is intentionally
      // NOT matched here: it's indistinguishable from a Lightning Address, so
      // it stays on the Lightning-address rails (and is only Nostr-resolved as
      // a fallback if that lookup misses — see Wallet.onPaymentDetected).
      const nostrKind = classifyIdentifier(cleaned);
      if (nostrKind === 'npub' || nostrKind === 'nprofile') return 'nostr_identifier';
      if (isLightningAddress(cleaned)) return 'lightning_address';
      if (isLnurl(cleaned)) return 'lnurl';
      if (isBitcoinAddress(cleaned)) return 'bitcoin_address';
      // A bare phone number we can route to a fiat-payout provider
      // (Zambia → Bitzed, Kenya → Tando). Strict: only a complete, valid
      // KE/ZM mobile number matches, so partial digits never false-positive.
      if (this.recognizedPhone) return 'phone_number';
      return null;
    },

    detectedInputLabel() {
      const labels = {
        spark: this.$t('Spark'),
        lightning_invoice: this.$t('Lightning Invoice'),
        lightning_address: this.$t('Lightning Address'),
        lnurl: this.$t('LNURL'),
        bitcoin_address: this.$t('Bitcoin'),
        bip21: this.$t('Bitcoin (BIP21)'),
        phone_number: this.$t('Phone number'),
        nostr_identifier: this.$t('Nostr profile')
      };
      return labels[this.detectedInputType] || '';
    },

    detectedInputIcon() {
      const icons = {
        lightning_invoice: 'tabler:bolt',
        lightning_address: 'tabler:bolt',
        lnurl: 'tabler:link',
        bitcoin_address: 'tabler:currency-bitcoin',
        bip21: 'tabler:currency-bitcoin',
        phone_number: 'tabler:device-mobile',
        nostr_identifier: 'tabler:user-bolt'
      };
      return icons[this.detectedInputType] || '';
    },

    manualInputShowsError() {
      return this.manualInput.trim().length > 0 && !this.detectedInputType;
    },

    isValidManualInput() {
      return !!this.detectedInputType;
    },

    // Full phone-number recognition for the current input (or null). Drives
    // the 'phone_number' chip and the ambiguous-country chooser.
    recognizedPhone() {
      const raw = (this.manualInput || '').trim();
      if (!raw) return null;
      const cleaned = raw.toLowerCase().startsWith('lightning:')
        ? raw.substring(10).trim()
        : raw;
      return recognizePhoneNumber(cleaned);
    },

    // True when the number is valid in more than one country (075-078 KE/ZM
    // overlap) and no calling code was given — the user must pick.
    phoneNeedsCountryChoice() {
      return this.detectedInputType === 'phone_number'
        && !!this.recognizedPhone
        && this.recognizedPhone.ambiguous === true;
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
    },
    // Smart fetching: a typed PHONE NUMBER auto-advances once it's complete
    // (recognizePhoneNumber only matches a full KE/ZM mobile number, so
    // partial digits never fire, and a number that's a prefix of the full
    // address resolves to the same destination anyway). Typed addresses /
    // invoices keep the explicit Continue because their detection is
    // prefix-based; pasted content auto-advances for any type (see
    // pasteFromClipboard). The confirm sheet stays the review/commit gate.
    manualInput() {
      // Editing clears a stale "couldn't resolve" error from the previous try.
      if (this.resolveError) this.$emit('update:resolveError', '');
      clearTimeout(this.phoneAdvanceTimer);
      if (this.detectedInputType === 'phone_number' && !this.phoneNeedsCountryChoice) {
        this.phoneAdvanceTimer = setTimeout(() => this.autoAdvance(), 700);
      }
    },
    // The parent flips `resolving` back to false the moment its fetch settles
    // (success OR failure, including notify-only paths) — clear the local
    // spinner so the CTA leaves "Fetching…".
    resolving(now, was) {
      if (!(was && !now)) return;
      this.isProcessing = false;
      // A scan / contact-pick FAILURE leaves the sheet open (success already set
      // show=false) but has no field to retry in — close it so the live scanner
      // can't re-detect the same code in a loop. The manual sheet stays open to
      // show its inline error.
      if (this.show && !this.showManualDialog) this.closeModal();
    },
    // A failure message arriving. Clear the spinner here too: on a synchronous
    // throw the parent sets sendResolving true->false within one tick, so the
    // `resolving` watcher above never fires and the CTA would freeze. Without a
    // manual sheet to host the inline error, toast it and close.
    resolveError(message) {
      if (!message) return;
      this.isProcessing = false;
      // Scan / contact failure on a still-open sheet: toast + close (no field to
      // retry in). `this.show` guards against toasting after the user already
      // cancelled (closeModal) while a late result arrives.
      if (this.show && !this.showManualDialog) {
        this.$q.notify({ type: 'negative', message });
        this.closeModal();
      }
    }
  },
  beforeUnmount() {
    clearTimeout(this.phoneAdvanceTimer);
    clearTimeout(this.pasteAdvanceTimer);
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

        this.qrScanner = createQrScanner(
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

        // A recognized Kenyan/Zambian phone number is a fiat-payout destination
        // — resolve it to its provider Lightning Address (Zambia → @bitzed.xyz,
        // Kenya → @bitcoin.co.ke) up front, BEFORE the SA-retail QR check, whose
        // numeric codes would otherwise swallow a 10-digit phone number. The
        // built address then flows through the normal Lightning-address rails
        // (which brand it).
        const phone = recognizePhoneNumber(trimmedData);
        if (phone) {
          this.$emit('payment-detected', {
            data: phone.lightningAddress,
            type: 'lightning_address',
            rawInput: trimmedData,
          });
          return;
        }

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

        // Bare Nostr key (npub / nprofile, optionally nostr:-prefixed): resolve
        // the person's profile to their Lightning address (lud16) or LNURL
        // (lud06) and pay that, carrying their name + avatar so the confirm
        // sheet shows who they are. The processing overlay is already up
        // (processManualInput / processQRCode set isProcessing).
        const nostrKind = classifyIdentifier(cleanData);
        if (nostrKind === 'npub' || nostrKind === 'nprofile') {
          try {
            const target = await resolveNostrLightningTarget(cleanData, { timeoutMs: 8000 });
            this.$emit('payment-detected', {
              data: target.address,
              type: target.kind, // 'lightning_address' | 'lnurl'
              rawInput: trimmedData,
              nostrPubkey: target.pubkey,
              nostrNpub: target.npub,
              nostrProfile: target.profile,
            });
          } catch (err) {
            this.isProcessing = false;
            this.notifyNostrResolveError(err);
          }
          return;
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

        if (paymentType === 'arkade_address' && !this.isActiveWalletArkade) {
          this.$q.notify({
            type: 'warning',
            message: this.$t('Arkade address detected'),
            caption: this.$t('Switch to Arkade wallet to pay this address'),
            timeout: 4000,
          });
        }

        if (paymentType === 'bitcoin_address' && !this.isActiveWalletSpark && !this.isActiveWalletArkade) {
          this.$q.notify({
            type: 'warning',
            message: this.$t('Bitcoin address detected'),
            caption: this.$t('Switch to a Spark or Arkade wallet to send Bitcoin'),
            timeout: 4000,
          });
        }

        this.$emit('payment-detected', {
          data: cleanData,
          type: paymentType,
          // Original, un-normalized input. Branta needs this for on-chain
          // verification because the ZK params (branta_id / branta_secret)
          // live in the bitcoin: URI query string, which normalization
          // strips out of `data`.
          rawInput: trimmedData,
          ...(bip21 ? { bip21 } : {})
        });
        // No closeModal here: we stay open showing the loading CTA while the
        // parent fetches/validates the destination. It closes us on success,
        // or pushes an inline error back via :resolve-error on failure.
      } catch (error) {
        throw error;
      }
    },

    /**
     * Map a Nostr-resolution failure to a friendly notification. The error's
     * `.code` distinguishes "profile has no Lightning address" from "couldn't
     * find / reach the profile" so the user knows whether to fix the npub or
     * just retry.
     */
    notifyNostrResolveError(err) {
      const code = err?.code;
      let message = this.$t("We couldn't resolve this Nostr profile");
      let caption = this.$t('Check the npub and your connection, then try again');
      if (code === NOSTR_TARGET_ERROR.NO_ADDRESS) {
        message = this.$t('This Nostr profile has no Lightning address yet');
        caption = this.$t('Ask them to set a Lightning address on their profile');
      } else if (code === NOSTR_TARGET_ERROR.NO_PROFILE) {
        message = this.$t("We couldn't find this Nostr profile");
        caption = this.$t('No profile was published to the relays we checked');
      } else if (code === LOOKUP_ERROR.INVALID_NPUB || code === LOOKUP_ERROR.INVALID_NPROFILE) {
        message = this.$t('That Nostr key looks malformed');
        caption = this.$t('Double-check the npub and try again');
      }
      this.$q.notify({ type: 'negative', message, caption });
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
      if (isArkadeAddress(cleaned)) return 'arkade_address';
      if (isLightningInvoice(cleaned)) return 'lightning_invoice';
      if (isLightningAddress(cleaned)) return 'lightning_address';
      if (isLnurl(cleaned)) return 'lnurl';
      if (isBitcoinAddress(cleaned)) return 'bitcoin_address';
      return 'unknown';
    },

    openManual() {
      this.manualInput = '';
      // Drop any inline error carried over from a prior contact/scan failure so
      // it can't show over a fresh, empty field.
      if (this.resolveError) this.$emit('update:resolveError', '');
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

      // Pasted content is complete, so fetch directly once it's recognized
      // (any type) — a short beat lets the user glimpse what was pasted.
      clearTimeout(this.pasteAdvanceTimer);
      if (this.manualInput) {
        this.pasteAdvanceTimer = setTimeout(() => this.autoAdvance(), 300);
      }

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
        arkade: 'arkade_address',
        bitcoin: 'bitcoin_address',
        lightning: 'lightning_address',
        // LNURL contacts emit the same payment type the manual/scan LNURL path
        // uses, so Wallet.onPaymentDetected resolves them via fetchLNURLInfo.
        lnurl: 'lnurl'
      };
      const paymentType = paymentTypeMap[addressType] || 'lightning_address';

      this.showQuickContacts = false;
      this.isProcessing = true; // show the scanner loading overlay while the parent resolves
      this.$emit('payment-detected', {
        data: address,
        type: paymentType
      });
      // Parent closes us on success / surfaces an error on failure.
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
      if (type === 'spark') {
        return this.isActiveWalletSpark;
      }
      // On-chain Bitcoin: Spark (L1 withdraw) or Arkade (Ramps offboard).
      if (type === 'bitcoin') {
        return this.isActiveWalletSpark || this.isActiveWalletArkade;
      }
      // ark1 can only be paid by an Arkade wallet (different network than Spark).
      if (type === 'arkade') {
        return this.isActiveWalletArkade;
      }
      return true;
    },

    getContactDisabledReason(contact) {
      if (!this.canPayContact(contact)) {
        const type = this.getContactAddressType(contact);
        if (type === 'bitcoin') {
          return this.$t('Switch to a Spark or Arkade wallet to send Bitcoin');
        }
        if (type === 'arkade') {
          return this.$t('Switch to Arkade wallet to pay this contact');
        }
        return this.$t('Switch to Spark wallet to pay this contact');
      }
      return '';
    },

    countryName(code) {
      return { KE: this.$t('Kenya'), ZM: this.$t('Zambia') }[code] || code;
    },

    // Ambiguous-number chooser: emit the picked country's constructed address
    // directly, bypassing the default-country resolution in processPaymentData.
    selectPhoneCountry(candidate) {
      if (!candidate) return;
      // Keep the sheet open with the loading CTA while the parent resolves the
      // constructed provider address; it closes us on success.
      this.isProcessing = true;
      this.$emit('payment-detected', {
        data: candidate.lightningAddress,
        type: 'lightning_address',
        rawInput: this.manualInput.trim(),
      });
    },

    // Auto-advance (smart fetching) entry point used by the typed-phone watch
    // and the paste hook. Guarded so a pending timer never fires after the
    // sheet was closed, edited to something invalid, a send is in flight, or
    // an ambiguous number still needs a KE/ZM choice.
    autoAdvance() {
      if (this.showManualDialog && !this.isProcessing && this.isValidManualInput && !this.phoneNeedsCountryChoice) {
        this.processManualInput();
      }
    },

    async processManualInput() {
      if (!this.isValidManualInput || this.ctaBusy) return;

      // Keep the manual sheet OPEN and swap its CTA for the loading button —
      // the fetch/validation happens here (and in the parent) before we ever
      // leave this field, so a bad address surfaces inline instead of failing
      // later. The parent closes the sheet once the destination is resolved.
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

    // OS paste (Cmd/Ctrl+V or long-press → Paste) straight into the field. A
    // pasted destination is complete, so once the value settles we auto-advance
    // into the fetch — same intent as the Paste button. Typed input keeps the
    // explicit Continue, since prefix detection can match a half-typed address.
    onTextareaPaste() {
      clearTimeout(this.pasteAdvanceTimer);
      this.pasteAdvanceTimer = setTimeout(() => this.autoAdvance(), 200);
    },

    // Manual sheet "X". Mid-resolve it cancels the whole Send flow (the parent
    // fetch keeps running but its result is harmless — it can only surface the
    // confirm sheet the user was already heading to); otherwise it just closes
    // the manual sheet back to the scanner.
    onManualClose() {
      if (this.ctaBusy) this.closeModal();
      else this.showManualDialog = false;
    },

    closeModal() {
      this.show = false;
    },

    resetState() {
      clearTimeout(this.phoneAdvanceTimer);
      clearTimeout(this.pasteAdvanceTimer);
      this.isProcessing = false;
      this.cameraError = null;
      this.manualInput = '';
      this.showManualDialog = false;
      this.showQuickContacts = false;
      // Clear any inline resolve error so a fresh open starts clean.
      if (this.resolveError) this.$emit('update:resolveError', '');
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
.detected-pill--lnurl,
.detected-pill--phone_number {
  background: rgba(5, 149, 115, 0.12);
  color: #059573;
  box-shadow: inset 0 0 0 1px rgba(5, 149, 115, 0.22);
}

.body--dark .detected-pill--lightning_address,
.body--dark .detected-pill--lightning_invoice,
.body--dark .detected-pill--lnurl,
.body--dark .detected-pill--phone_number {
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

/* Whole helper row turns red when showing a format / resolution error so the
   message (e.g. "We couldn't find this Lightning address") reads clearly. */
.input-helper--error {
  color: #EF4444;
}

.sheet-footer {
  padding: 14px 20px 6px;
}

/* Ambiguous KE/ZM number chooser (075-078 prefixes valid in both). */
.country-choice { display: flex; flex-direction: column; gap: 8px; }
.country-choice-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  text-align: center;
}
.country-choice-row { display: flex; gap: 10px; }
.country-choice-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 12px 8px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-card);
  background: var(--bg-input);
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  transition: filter 0.15s ease, transform 0.08s ease;
}
.country-choice-btn:active { transform: scale(0.98); }
.country-choice-name { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.country-choice-number { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }

/* Primary CTA — gradient-green on dark, neutral-dark pill on cream.
   Same language as PaymentModal, AddressBookModal, etc. */
.primary-cta {
  width: 100%;
  /* Match ProgressCta's height so the idle CTA -> loading-button morph doesn't
     jump (ProgressCta is 56px, 50px under 480px — mirrored below). */
  height: 56px;
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

  /* Mirror ProgressCta's mobile height so the CTA morph stays seamless. */
  .primary-cta {
    height: 50px;
  }

  .tile-label {
    font-size: 12.5px;
  }

  .sheet-body {
    padding: 6px 16px 2px;
  }
}
</style>
