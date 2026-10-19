<template>

  <!-- The route presents as a 100% bottom sheet: dimmed ground, surface
       at the large detent, grabber + glass back for chrome. The identity
       lives in the centered hero, so the bar itself stays headerless. -->
  <q-page class="iform-sheet-page">
    <div class="iform-sheet-scrim" aria-hidden="true" @click="goBack"></div>

    <div class="iform-sheet" role="dialog" aria-modal="true" :aria-label="$t('Connect NWC Wallet')">
      <div class="iform-sheet-grab" aria-hidden="true"></div>

      <!-- Connect, then the wallet's own answer: what it is (found), that
           it is already here (duplicate), or which part did not answer
           (problem). Steps of this one sheet, never dialogs on top of it. -->
      <template v-if="!showScanner">
        <NWCWalletFound
          v-if="step === 'found'"
          v-model:name="walletName"
          :probe="probe"
          :relay="relay"
          :busy="isAdding"
          @back="step = 'connect'"
          @add="addConnectedWallet"
        />
        <NWCDuplicateStep
          v-else-if="step === 'duplicate'"
          :existing="duplicate.wallet"
          :same-connection="duplicate.sameConnection"
          @back="step = 'connect'"
          @open="openExisting"
          @add-anyway="step = 'found'"
        />
        <NWCConnectProblem
          v-else-if="step === 'problem'"
          :kind="problemKind"
          :relay="relay"
          :busy="isTesting"
          @retry="testConnection"
          @edit="step = 'connect'"
        />
        <NWCConnectStep
          v-else
          v-model="nwcString"
          :error="errorMessage"
          :busy="isTesting"
          :waiting="isWaiting"
          @back="goBack"
          @paste="pasteConnection"
          @scan="openScanner"
          @continue="testConnection"
        />
      </template>

      <!-- Web QR scanner (native uses ScannerOverlay below) -->
      <template v-else>
        <header class="iform-sheet-top">
          <q-btn flat round dense class="glass-back-btn" :aria-label="$t('Back')" @click="closeScanner">
            <Icon icon="tabler:chevron-left" width="20" height="20" />
          </q-btn>
          <div class="iform-sheet-title">{{ $t('Scan QR Code') }}</div>
          <div class="iform-sheet-spacer"></div>
        </header>

        <div class="iform-sheet-scroll">
          <div class="iform-body">
            <div class="iform-scan-lede">{{ $t('Scan your NWC connection QR code') }}</div>

            <div class="qr-scanner-container" :class="$q.dark.isActive ? 'scanner-dark' : 'scanner-light'">
              <video
                v-if="!cameraError"
                ref="videoElement"
                class="qr-video"
                style="width: 100%; height: 100%; object-fit: cover; border-radius: 16px;"
                playsinline
              />

              <!-- Camera Error State -->
              <div v-if="cameraError" class="camera-error">
                <Icon icon="tabler:camera" style="font-size: 3em; color: #9CA3AF;" />
                <p class="error-text">{{ cameraErrorMessage }}</p>
                <q-btn
                  unelevated
                  :label="$t('Try Again')"
                  @click="retryCamera"
                  class="retry-btn"
                  :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
                  no-caps
                />
              </div>

              <!-- Loading State -->
              <div v-if="cameraLoading && !cameraError" class="camera-loading">
                <q-spinner-dots color="#F7931A" size="2em"/>
                <p class="loading-text">{{ $t('Starting camera...') }}</p>
              </div>

              <!-- Scanning Frame -->
              <div v-if="!cameraError && !cameraLoading" class="scanning-frame">
                <div class="frame-corner top-left"></div>
                <div class="frame-corner top-right"></div>
                <div class="frame-corner bottom-left"></div>
                <div class="frame-corner bottom-right"></div>
              </div>
            </div>
          </div>
        </div>

        <footer class="iform-sheet-footer">
          <q-btn
            unelevated
            class="full-width cancel-btn"
            :class="$q.dark.isActive ? 'more_btn_dark' : 'more_btn_light'"
            :label="$t('Cancel')"
            @click="closeScanner"
            no-caps
          />
        </footer>
      </template>
    </div>

    <!-- Native MLKit scanner (iOS/Android). Teleports to <body>. -->
    <ScannerOverlay
      v-if="nativeScannerActive"
      :active="nativeScannerActive"
      :title="$t('Scan QR Code')"
      :prompt="$t('Scan your NWC connection QR code')"
      continuous
      @scanned="handleQrScan"
      @close="closeScanner"
    />
  </q-page>
</template>

<script>
import { isAddressRequest } from '../utils/lud23.js';
import QrScanner from 'qr-scanner'
import { createQrScanner } from '../utils/qrScanner'
import { isNativeScannerAvailable } from '../utils/nativeScanner'
import ScannerOverlay from '../components/ScannerOverlay.vue'
import NWCConnectStep from '../components/nwc/NWCConnectStep.vue'
import NWCWalletFound from '../components/nwc/NWCWalletFound.vue'
import NWCDuplicateStep from '../components/nwc/NWCDuplicateStep.vue'
import NWCConnectProblem from '../components/nwc/NWCConnectProblem.vue'
import { useWalletStore } from '../stores/wallet'
import { mapActions, mapState } from 'pinia'
import { getUserFriendlyErrorMessage, translateErrorCode } from '../utils/userErrors'
import { parseNwcConnection, NWC_REASON_I18N_KEYS } from '../utils/nwcConnection'
import { findSameWallet, relayHost, suggestedWalletName } from '../utils/nwcWallet.js'
import { NWC_ERROR } from '../utils/nwcErrors.js'
import { probeNwcConnection } from '../services/nwcProbe.js'
import { readClipboardCrossPlatform } from '../utils/shopClipboard.js'
import { listenForNwcConnection, takeNwcConnection } from '../services/nwcConnectionIntake.js'

/**
 * Connect a wallet over Nostr Wallet Connect, test first and name second:
 *
 *   connect   — paste or scan; the secret stays hidden
 *   found     — the wallet answered: its name, balance, address, what this
 *               connection may do and its spending limit; then Add wallet
 *   duplicate — it is a wallet that is already here
 *   problem   — the relay or the wallet did not answer, and which one
 *
 * Nothing is saved until Add wallet; the store reuses the test result.
 */
export default {
  name: 'NWCSetupPage',
  components: {
    ScannerOverlay,
    NWCConnectStep,
    NWCWalletFound,
    NWCDuplicateStep,
    NWCConnectProblem,
  },
  data() {
    return {
      step: 'connect',
      nwcString: '',
      walletName: '',
      errorMessage: '',
      isTesting: false,
      isWaiting: false,
      isAdding: false,
      // services/nwcProbe result for the connection being added.
      probe: null,
      problemKind: 'no-answer',
      duplicate: { wallet: null, sameConnection: false },
      showScanner: false,
      nativeScannerActive: false,
      cameraError: false,
      cameraErrorMessage: '',
      cameraLoading: true,
      qrScanner: null,
    }
  },
  computed: {
    ...mapState(useWalletStore, ['wallets']),
    relay() {
      return relayHost(this.probe?.normalized || parseNwcConnection(this.nwcString).normalized || '');
    },
  },
  watch: {
    nwcString() {
      this.errorMessage = '';
    },
  },
  // A connection opened from another app, or scanned or pasted on Home,
  // arrives here and is tested at once; while the sheet is open, a new one
  // replaces it.
  mounted() {
    this.stopListening = listenForNwcConnection((connection) => this.useHandedConnection(connection));
    const handed = takeNwcConnection();
    if (handed) this.useHandedConnection(handed);
  },
  beforeUnmount() {
    this.stopListening?.();
    this.stopQrScanner();
  },
  methods: {
    ...mapActions(useWalletStore, ['addWallet', 'switchActiveWallet']),

    goBack() {
      if (window.history.length > 1) {
        this.$router.back();
      } else {
        this.$router.push('/');
      }
    },

    /** Why a connection string cannot be used, or '' when it can. */
    connectionProblem(raw) {
      const result = parseNwcConnection(raw);
      if (result.ok) return '';
      return this.$t(NWC_REASON_I18N_KEYS[result.reason] || 'Invalid connection string format');
    },

    useHandedConnection(connection) {
      if (this.isTesting || this.isAdding) return;
      this.closeScanner();
      this.nwcString = connection;
      this.testConnection();
    },

    async pasteConnection() {
      const text = (await readClipboardCrossPlatform()) || '';
      if (!text.trim()) {
        this.errorMessage = this.$t('The clipboard is empty.');
        return;
      }
      this.nwcString = text.trim();
      this.errorMessage = this.connectionProblem(this.nwcString);
    },

    /**
     * Ask the wallet before saving anything. Its answer decides the next
     * step: found, duplicate, or which part did not answer.
     */
    async testConnection() {
      const problem = this.connectionProblem(this.nwcString);
      if (problem) {
        this.errorMessage = problem;
        this.step = 'connect';
        return;
      }
      this.isTesting = true;
      this.isWaiting = false;
      this.errorMessage = '';
      try {
        const probe = await this.probeConnection(this.nwcString, { onWaiting: () => { this.isWaiting = true; } });
        this.probe = probe;
        this.walletName = suggestedWalletName(probe, this.$t('Lightning wallet'));
        const existing = findSameWallet(this.wallets, probe);
        if (existing) {
          const sameConnection = parseNwcConnection(existing.nwcUrl).pubkey === probe.connectionPubkey;
          this.duplicate = { wallet: existing, sameConnection };
          this.step = 'duplicate';
        } else {
          this.step = 'found';
        }
      } catch (error) {
        console.warn('NWC connection test failed:', error?.message || error);
        if (error?.code === NWC_ERROR.NO_ANSWER || error?.code === NWC_ERROR.RELAY_UNREACHABLE) {
          this.problemKind = error.code === NWC_ERROR.RELAY_UNREACHABLE ? 'relay' : 'no-answer';
          this.step = 'problem';
        } else {
          const t = this.$t.bind(this);
          this.errorMessage = translateErrorCode(error, t) || getUserFriendlyErrorMessage(error, 'connect', t);
          this.step = 'connect';
        }
      } finally {
        this.isTesting = false;
        this.isWaiting = false;
      }
    },

    /** The connection test (services/nwcProbe), one method so a test harness can stand in for a wallet. */
    probeConnection(url, options) {
      return probeNwcConnection(url, options);
    },

    async addConnectedWallet() {
      if (!this.probe || this.isAdding) return;
      this.isAdding = true;
      try {
        await this.addWallet({ name: this.walletName, nwcUrl: this.probe.normalized, probe: this.probe });
        // Straight into the wallet; the tour waits in About > Onboarding Guide.
        this.$router.replace('/wallet');
      } catch (error) {
        console.error('Failed to add NWC wallet:', error);
        // A reason BuhoGO knows (already added, saved wallets unavailable)
        // replaces the generic title, which would blame the connection.
        const t = this.$t.bind(this);
        this.errorMessage = translateErrorCode(error, t) || getUserFriendlyErrorMessage(error, 'connect', t);
        this.step = 'connect';
      } finally {
        this.isAdding = false;
      }
    },

    /** The wallet is already here: use it instead of adding it twice. */
    async openExisting() {
      await this.switchActiveWallet(this.duplicate.wallet.id);
      this.$router.replace('/wallet');
    },

    async openScanner() {
      // Native (iOS/Android): mount the MLKit ScannerOverlay. Web/PWA keeps the
      // in-page qr-scanner video.
      if (isNativeScannerAvailable()) {
        this.nativeScannerActive = true;
        return;
      }
      this.showScanner = true;
      this.cameraError = false;
      this.cameraLoading = true;
      this.cameraErrorMessage = '';

      await this.$nextTick();
      await this.startQrScanner();
    },

    closeScanner() {
      this.stopQrScanner();
      this.nativeScannerActive = false;
      this.showScanner = false;
      this.cameraError = false;
      this.cameraLoading = true;
      this.cameraErrorMessage = '';
    },

    async startQrScanner() {
      try {
        if (!this.$refs.videoElement) {
          throw new Error('Video element not found');
        }

        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera) {
          throw new Error('No camera found on this device.');
        }

        this.qrScanner = createQrScanner(
          this.$refs.videoElement,
          (result) => this.handleQrScan(result.data),
          {
            returnDetailedScanResult: false,
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: 'environment'
          }
        );

        await this.qrScanner.start();
        this.cameraLoading = false;
        this.cameraError = false;

      } catch (error) {
        console.error('Error starting QR scanner:', error);
        this.onCameraError(error);
      }
    },

    stopQrScanner() {
      if (this.qrScanner) {
        this.qrScanner.stop();
        this.qrScanner.destroy();
        this.qrScanner = null;
      }
    },

    handleQrScan(qrData) {
      if (isAddressRequest(qrData)) {
        this.closeScanner();
        this.$q.notify({ type: 'info', message: this.$t('This code asks for your Lightning address. Scan it from Home after setting up your wallet.') });
        return;
      }
      if (!qrData) return;

      // Use the same parser as the manual-input path so the two flows
      // never diverge on what counts as valid. The parser accepts every
      // known prefix variant and rejects bunker:// (NIP-46) with a
      // tailored message — users routinely confuse the two.
      const result = parseNwcConnection(qrData);
      if (result.ok) {
        // The canonical form (every relay kept), then straight on to the test.
        this.nwcString = result.normalized;
        this.closeScanner();
        this.testConnection();
        return;
      }

      const reasonKey = NWC_REASON_I18N_KEYS[result.reason] || 'Expected a NWC connection string';
      this.$q.notify({
        type: 'warning',
        message: this.$t('Invalid QR code'),
        caption: this.$t(reasonKey),
      });
    },

    onCameraError(error) {
      this.cameraError = true;
      this.cameraLoading = false;

      if (error.name === 'NotAllowedError') {
        this.cameraErrorMessage = this.$t('Camera access denied. Please allow camera permissions.');
      } else if (error.name === 'NotFoundError') {
        this.cameraErrorMessage = this.$t('No camera found on this device.');
      } else {
        this.cameraErrorMessage = this.$t('Unable to access camera.');
      }
    },

    async retryCamera() {
      this.cameraError = false;
      this.cameraLoading = true;
      this.cameraErrorMessage = '';
      await this.startQrScanner();
    },
  }
}
</script>

<style scoped>
/* Sheet shell + form recipes live in app.css (.iform-*). Only the
   page-specific pieces remain here. */

.iform-scan-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-secondary);
  text-align: center;
  margin: 4px 0 14px;
}


/* Scanner Styles */
.qr-scanner-container {
  height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  overflow: hidden;
  position: relative;
  border: 2px solid;
}

.scanner-dark {
  background: var(--bg-secondary);
  border-color: var(--border-card);
}

.scanner-light {
  background: var(--bg-secondary);
  border-color: var(--border-card);
}

/*
  Overlay the camera-error / camera-loading states on top of the
  <video> element rather than rendering them as sibling flex items.
  Without `position: absolute` the <video> (100% × 100%) and the
  overlay share row-flex space, squeezing the overlay text into a
  narrow column at the right edge of the scanner box.
*/
.camera-error,
.camera-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem;
}

.error-text,
.loading-text {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  margin: 1rem 0;
  color: #666;
  line-height: 1.4;
}

.retry-btn {
  height: 40px;
  border-radius: 20px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  padding: 0 1.5rem;
  margin-top: 0.5rem;
}

.scanning-frame {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 200px;
  height: 200px;
  pointer-events: none;
  z-index: 5;
}

.frame-corner {
  position: absolute;
  width: 30px;
  height: 30px;
  border: 3px solid #F7931A;
}

.frame-corner.top-left { top: 0; left: 0; border-right: none; border-bottom: none; }
.frame-corner.top-right { top: 0; right: 0; border-left: none; border-bottom: none; }
.frame-corner.bottom-left { bottom: 0; left: 0; border-right: none; border-top: none; }
.frame-corner.bottom-right { bottom: 0; right: 0; border-left: none; border-top: none; }

.cancel-btn {
  height: 48px;
  border-radius: 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

@media (max-width: 480px) {
  .qr-scanner-container {
    height: 250px;
  }

  .scanning-frame {
    width: 180px;
    height: 180px;
  }
}
</style>
