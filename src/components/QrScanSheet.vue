<!--
  QrScanSheet
  Single-shot QR scan surface, shared by every flow that needs "open a
  scanner, hand me the decoded string" (Send sheet, Receive → Redeem).

  Platform split, hidden from callers:
    - iOS/Android: ScannerOverlay (MLKit live camera behind a transparent
      webview). body.barcode-scanner-active hides every other surface
      while it runs, so exactly one UI is on screen at a time. When the
      native engine cannot start (no usable MLKit on the device, e.g.
      GrapheneOS without Play services) the overlay falls back to the
      qr-scanner web engine by itself — see docs/QR_SCANNER_FALLBACK.md.
    - Web/PWA: fullscreen dialog with a qr-scanner <video>, including the
      camera-permission error state and retry.

  Both offer Choose photo (QrPhotoButton): the code in a picked picture
  takes the same path as a scanned one. The camera is off while the picker
  is open; without a camera, the button is the way left to read a code.

  Contract:
    - v-model         open/close
    - title           optional headline; payment flows pass none so the
                      camera surface stays clean (design direction)
    - prompt          bottom hint; defaults to the generic scan prompt
    - @scanned        fires ONCE per open with the decoded string; the
                      sheet closes itself before emitting, so the caller
                      only ever handles the value.

  Deliberately dumb: no payment parsing, no routing — classification
  belongs to the caller (parsePaymentDestination / processPaymentData),
  so this stays reusable for any QR content.
-->
<template>
  <div>
    <!-- Native scanner (iOS/Android) -->
    <ScannerOverlay
      v-if="isNativeScanner && show"
      :active="show"
      :title="title"
      :prompt="prompt || $t('Point your camera at a QR code')"
      @scanned="onScanned"
      @close="close"
    />

    <!-- Web scanner (PWA/desktop) -->
    <q-dialog
      v-if="!isNativeScanner"
      v-model="show"
      maximized
      transition-show="fade"
      transition-hide="fade"
      class="web-scan-dialog"
      @show="initializeCamera"
      @before-hide="teardownCamera"
    >
      <div class="web-scan-surface">
        <header class="ws-top">
          <q-btn flat round dense class="ws-btn" :aria-label="$t('Back')" @click="close">
            <Icon icon="tabler:chevron-left" width="22" height="22" />
          </q-btn>
          <!-- Optional headline. Payment flows pass none — the bottom prompt
               carries the context, keeping the camera surface clean. -->
          <div class="ws-title">{{ title }}</div>
          <div class="ws-spacer"></div>
        </header>

        <div class="ws-camera">
          <video
            v-if="showCamera"
            ref="videoElement"
            class="camera-view"
            playsinline
          />
          <div v-if="cameraError" class="camera-error">
            <Icon icon="tabler:camera" style="font-size: 4rem; color: #bdbdbd;" />
            <div class="error-title">{{ $t('Camera Access Required') }}</div>
            <div class="error-subtitle">{{ cameraError }}</div>
            <q-btn
              class="retry-btn"
              :label="$t('Retry')"
              @click="initializeCamera"
              no-caps
              unelevated
            />
          </div>
          <div class="ws-bottom">
            <!-- Always there, so a note that appears is announced. -->
            <p class="ws-prompt" :class="{ 'ws-prompt--empty': !promptText }" aria-live="polite">{{ promptText }}</p>
            <QrPhotoButton
              tone="camera"
              @open="onPhotoOpen"
              @closed="onPhotoClosed"
              @read="onScanned"
              @fail="onPhotoFail"
            />
          </div>
        </div>
      </div>
    </q-dialog>
  </div>
</template>

<script>
import QrScanner from 'qr-scanner';
import { createQrScanner, pauseForPhoto } from '../utils/qrScanner';
import { isNativeScannerAvailable } from '../utils/nativeScanner';
import ScannerOverlay from './ScannerOverlay.vue';
import QrPhotoButton from './QrPhotoButton.vue';

export default {
  name: 'QrScanSheet',
  components: { ScannerOverlay, QrPhotoButton },
  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, default: '' },
    prompt: { type: String, default: '' },
  },
  emits: ['update:modelValue', 'scanned'],
  data() {
    return {
      isNativeScanner: isNativeScannerAvailable(),
      showCamera: false,
      cameraError: null,
      qrScanner: null,
      // Single-shot latch: the web qr-scanner keeps decoding frames until
      // torn down, so without this a busy QR would emit several times
      // before the close settles.
      hasEmitted: false,
      // The photo picker is open (camera off), and what the last photo gave
      // instead of a code.
      photoOpen: false,
      photoNote: '',
    };
  },
  computed: {
    /** The line above Choose photo; nothing when the camera could not run and there is no note. */
    promptText() {
      if (this.photoNote) return this.photoNote;
      if (this.cameraError) return '';
      return this.prompt || this.$t('Point your camera at a QR code');
    },
    show: {
      get() {
        return this.modelValue;
      },
      set(value) {
        this.$emit('update:modelValue', value);
      }
    }
  },
  watch: {
    // Re-arm the single-shot latch on every open.
    modelValue(open) {
      if (open) {
        this.hasEmitted = false;
        this.photoNote = '';
        this.photoOpen = false;
      }
    }
  },
  beforeUnmount() {
    this.stopQrScanner();
  },
  methods: {
    onScanned(result) {
      const value = typeof result === 'string'
        ? result.trim()
        : (result?.data || result?.text || '');
      if (!value || this.hasEmitted) return;
      this.hasEmitted = true;
      // Close first, then hand over: by the time the caller reacts, this
      // surface is already on its way out and can't repaint over the
      // caller's next screen.
      this.close();
      this.$emit('scanned', value);
    },

    close() {
      this.show = false;
    },

    /** The picker is opening: the camera goes off until it closes. */
    onPhotoOpen() {
      this.photoNote = '';
      this.photoOpen = true;
      pauseForPhoto(this.qrScanner);
    },

    onPhotoClosed() {
      if (!this.photoOpen) return;
      this.photoOpen = false;
      this.resumeCamera();
    },

    onPhotoFail({ message }) {
      this.photoOpen = false;
      this.photoNote = message;
      this.resumeCamera();
    },

    resumeCamera() {
      if (this.cameraError || !this.show || this.hasEmitted) return;
      if (!this.qrScanner) { this.startQrScanner(); return; }
      this.qrScanner.start().catch((error) => this.handleCameraError(error));
    },

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
      // The photo picker is open: the camera starts once it closes (resumeCamera).
      if (this.photoOpen) return;
      try {
        if (!this.$refs.videoElement) {
          throw new Error('Video element not found');
        }

        this.qrScanner = createQrScanner(
          this.$refs.videoElement,
          (result) => this.onScanned(result),
          {
            returnDetailedScanResult: true,
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: 'environment'
          }
        );

        await this.qrScanner.start();
        // Choose photo was tapped while the camera was still starting.
        if (this.photoOpen) pauseForPhoto(this.qrScanner);
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

    teardownCamera() {
      this.stopQrScanner();
      this.showCamera = false;
      this.cameraError = null;
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
    }
  }
}
</script>

<style scoped>
.web-scan-dialog :deep(.q-dialog__inner) {
  padding: 0;
}

.web-scan-surface {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #000;
}

.ws-top {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  padding-top: calc(var(--safe-top, 0px) + 12px);
  flex-shrink: 0;
  z-index: 2;
}

.ws-btn {
  color: rgba(255, 255, 255, 0.85);
}

.ws-title {
  flex: 1;
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
}

.ws-spacer {
  width: 40px;
}

.ws-camera {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.camera-view {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* QR-scanner library injects its own scan-region overlay (default yellow).
   Desaturate it via :deep so the scanner reads as a neutral treatment. */
.ws-camera :deep(.scan-region-highlight) {
  border-color: rgba(255, 255, 255, 0.55) !important;
}
.ws-camera :deep(.scan-region-highlight-svg) {
  stroke: rgba(255, 255, 255, 0.55) !important;
  fill: transparent !important;
}
.ws-camera :deep(.code-outline-highlight) {
  stroke: #1A1A1A !important;
  fill: rgba(26, 26, 26, 0.18) !important;
}

/* Prompt and Choose photo, over the camera and over its error state alike. */
.ws-bottom {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 40px 16px max(28px, var(--safe-bottom, 28px));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  z-index: 3;
  /* The scrim takes no taps: only what is on it does. Dark up to the
     prompt's line, so it reads over white paper too, then a short fade. */
  pointer-events: none;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.72) 0%,
    rgba(0, 0, 0, 0.6) calc(100% - 32px),
    rgba(0, 0, 0, 0) 100%
  );
}
.ws-bottom > * {
  pointer-events: auto;
}

.ws-prompt {
  margin: 0;
  max-width: 320px;
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7);
}
.ws-prompt--empty {
  /* Nothing to say: out of sight, still in place for the next note. */
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.camera-error {
  position: absolute;
  inset: 0;
  background: #1f2937;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  /* Clear of Choose photo below, on a short screen too. */
  padding: 2rem 2rem 176px;
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
  background: rgba(255, 255, 255, 0.1) !important;
  color: rgba(255, 255, 255, 0.85) !important;
}
</style>
