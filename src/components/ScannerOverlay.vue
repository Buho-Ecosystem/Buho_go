<!--
  ScannerOverlay
  Full-screen scanner for native builds (iOS/Android). One UI, two engines:

    native  MLKit's live `startScan` (utils/nativeScanner.js). The camera feed
            renders behind a transparent webview (body.barcode-scanner-active,
            see app.css); this overlay is the one element kept visible, so our
            own frame + buttons sit on top of the camera — no Google branding,
            no covered UI. Preferred: fast, and the decoder is bundled into the
            APK, so it does not need Google Play services.
    web     qr-scanner on a <video> inside this overlay, fed by getUserMedia
            (utils/qrScanner.js — the same engine the PWA uses). Used when the
            native engine cannot start on this device: GrapheneOS without
            Play services where the Google-side plumbing is missing, feature
            phones, or any device where the camera never binds. The overlay
            paints itself opaque and hosts the <video> behind the same frame,
            so callers see one component either way.

  Selection is capability-based and automatic (utils/scannerEngine.js): try
  native, and on a non-permission failure — a rejected start, a start that
  never settles, or a decoder that errors before it decodes anything — switch
  to web and remember that on this device until the next app update.
  Permission refusals are shown, never worked around: both engines need the
  same OS camera permission.

  Teleported to <body> so it overlays whatever opened it (a page or a q-dialog)
  without inheriting an opaque ancestor that would paint over the camera.

  Web/PWA does NOT use this component — call sites keep their existing
  qr-scanner (<video>) path. Only mount this when isNativeScannerAvailable().

  Props:
    - active      controls the scan lifecycle (start on true, stop on false)
    - title       header label
    - prompt      hint text shown above the action slot
    - continuous  keep scanning after a detect (multi-field capture, e.g. LNbits).
                  Default false: stop after the first code so the parent can close.

  Emits:
    - scanned(value)  a decoded QR string — identical for both engines
    - close           user dismissed the scanner (X / back / camera error)
-->
<template>
  <teleport to="body">
    <div
      class="barcode-scanner-modal scanner-overlay"
      :class="{
        'scanner-overlay--error': error,
        'scanner-overlay--web': engine === 'web',
      }"
    >
      <!-- Web engine only: the camera stream lives inside the overlay. The
           native engine paints its preview behind the (transparent) webview
           instead, so nothing renders here for it. -->
      <video
        v-if="engine === 'web' && !error"
        ref="video"
        class="so-video"
        playsinline
        muted
      />

      <!-- Top bar -->
      <div class="so-topbar">
        <button type="button" class="so-icon-btn" @click="$emit('close')">
          <Icon icon="tabler:chevron-left" width="22" height="22" />
        </button>
        <!-- Optional headline. Payment flows pass none — the bottom prompt
             carries the context, keeping the camera surface clean. -->
        <div class="so-title">{{ title }}</div>
        <button
          v-if="torchAvailable"
          type="button"
          class="so-icon-btn"
          :class="{ 'so-icon-btn--on': torchOn }"
          @click="onToggleTorch"
        >
          <Icon :icon="torchOn ? 'tabler:bolt' : 'tabler:bolt-off'" width="20" height="20" />
        </button>
        <div v-else class="so-icon-spacer"></div>
      </div>

      <!-- Error state (permission / hardware) -->
      <div v-if="error" class="so-error">
        <Icon icon="tabler:camera-off" width="44" height="44" />
        <p class="so-error-text">{{ error }}</p>
        <button type="button" class="so-error-btn" @click="$emit('close')">
          {{ $t('Close') }}
        </button>
      </div>

      <!-- Scanning frame -->
      <div v-else class="so-frame-wrap">
        <div class="so-frame">
          <span class="so-corner so-corner--tl"></span>
          <span class="so-corner so-corner--tr"></span>
          <span class="so-corner so-corner--bl"></span>
          <span class="so-corner so-corner--br"></span>
        </div>
      </div>

      <!-- Bottom: prompt + caller actions (e.g. Manual / Paste / Contacts).
           Sits on a dark scrim so it reads over any camera scene. -->
      <div class="so-bottom">
        <p v-if="!error" class="so-prompt">
          {{ prompt || $t('Point your camera at a QR code') }}
        </p>
        <div v-if="$slots.actions" class="so-actions">
          <slot name="actions" />
        </div>
      </div>
    </div>
  </teleport>
</template>

<script>
import { Icon } from '@iconify/vue';
import QrScanner from 'qr-scanner';
import { createQrScanner } from '../utils/qrScanner';
import { isNativeScannerAvailable, startLiveScan } from '../utils/nativeScanner';
import { NATIVE_ERROR, getEngineMemory, shouldFallBackToWeb } from '../utils/scannerEngine';

export default {
  name: 'ScannerOverlay',

  components: { Icon },

  props: {
    active: { type: Boolean, default: false },
    title: { type: String, default: '' },
    prompt: { type: String, default: '' },
    continuous: { type: Boolean, default: false },
  },

  emits: ['scanned', 'close'],

  data() {
    return {
      // Which engine is running: '' | 'native' | 'web'.
      engine: '',
      // Native controller (startLiveScan) — set only while engine === 'native'.
      controller: null,
      // Web engine instance (qr-scanner) — set only while engine === 'web'.
      qrScanner: null,
      // Bumped on every start() and stop(). Every `await` in a start path
      // re-checks it so an open→close→open burst, or an unmount mid-start,
      // can never leave a stale camera running or a late error on screen.
      startSeq: 0,
      torchAvailable: false,
      torchOn: false,
      error: '',
      detected: false,
      lastValue: '',
      lastAt: 0,
    };
  },

  watch: {
    active(now) {
      if (now) this.start();
      else this.stop();
    },
  },

  mounted() {
    if (this.active) this.start();
  },

  beforeUnmount() {
    this.stop();
  },

  methods: {
    async start() {
      const seq = ++this.startSeq;
      this.error = '';
      this.detected = false;
      this.engine = '';

      if (isNativeScannerAvailable() && !getEngineMemory().isNativeDemoted()) {
        const settled = await this.startNative(seq);
        if (settled || seq !== this.startSeq) return;
      }
      await this.startWeb(seq);
    },

    /**
     * Try the native engine. Resolves true when the matter is settled — the
     * scan is running, a terminal error is on screen, or this start was
     * superseded — and false when the caller should fall back to web.
     */
    async startNative(seq) {
      let controller;
      try {
        controller = await startLiveScan({
          onResult: (value) => this.onResult(value),
          onEngineFailure: (err) => this.onNativeEngineFailure(seq, err),
        });
      } catch (err) {
        if (seq !== this.startSeq) return true;
        if (!shouldFallBackToWeb(err)) {
          console.error('[ScannerOverlay] native scanner start failed:', err);
          this.showError(err);
          return true;
        }
        console.warn(
          '[ScannerOverlay] native scanner unavailable, falling back to web engine:',
          err?.code, err?.message,
        );
        getEngineMemory().demoteNative(err?.code || 'unknown');
        return false;
      }

      if (seq !== this.startSeq) {
        // Closed while the camera was binding — release it.
        controller.stop().catch(() => { /* noop */ });
        return true;
      }

      this.controller = controller;
      this.engine = 'native';
      // Native came up: any earlier demotion is stale.
      getEngineMemory().restoreNative();
      this.torchAvailable = await controller.isTorchAvailable();
      return true;
    },

    /**
     * The native decoder gave up after the preview was already running (the
     * wrapper has torn it down). Switch engines in place, as long as this
     * scan session is still the current one.
     */
    async onNativeEngineFailure(seq, err) {
      if (seq !== this.startSeq) return;
      console.warn('[ScannerOverlay] native decoder failed, switching to web engine:', err?.message);
      this.controller = null;
      this.torchAvailable = false;
      this.torchOn = false;
      getEngineMemory().demoteNative(err?.code || NATIVE_ERROR.DECODER_FAILED);
      await this.startWeb(seq);
    },

    /** Start the in-webview qr-scanner engine on the overlay's own <video>. */
    async startWeb(seq) {
      if (this.qrScanner) return;
      this.engine = 'web';
      // Let the <video> mount before we hand it to the scanner.
      await this.$nextTick();
      if (seq !== this.startSeq) return;

      try {
        if (!(await QrScanner.hasCamera())) {
          const err = new Error('No camera found on this device.');
          err.name = 'NotFoundError';
          throw err;
        }
        if (seq !== this.startSeq) return;

        const video = this.$refs.video;
        if (!video) throw new Error('Video element not found');

        const scanner = createQrScanner(
          video,
          (result) => {
            const value = typeof result === 'string' ? result : (result?.data || result?.text || '');
            this.onResult(value);
          },
          {
            returnDetailedScanResult: true,
            // Our own corner frame is the scan-region affordance; the library's
            // highlight boxes would double it up.
            highlightScanRegion: false,
            highlightCodeOutline: false,
            preferredCamera: 'environment',
          },
        );
        // Assign before awaiting start() so stop() can reach an in-flight start.
        this.qrScanner = scanner;
        await scanner.start();
        if (seq !== this.startSeq) return;

        this.torchAvailable = await scanner.hasFlash().catch(() => false);
      } catch (err) {
        if (seq !== this.startSeq) return;
        console.error('[ScannerOverlay] web scanner start failed:', err);
        this.destroyWebScanner();
        this.showError(err);
      }
    },

    async stop() {
      // Abort any start still in flight.
      this.startSeq += 1;
      this.torchOn = false;
      this.torchAvailable = false;
      if (this.controller) {
        const c = this.controller;
        this.controller = null;
        try { await c.stop(); } catch { /* noop */ }
      }
      this.destroyWebScanner();
      this.engine = '';
    },

    destroyWebScanner() {
      const s = this.qrScanner;
      if (!s) return;
      this.qrScanner = null;
      try { s.stop(); } catch { /* noop */ }
      try { s.destroy(); } catch { /* noop */ }
    },

    showError(err) {
      const code = err?.code;
      const name = err?.name;
      const text = typeof err === 'string' ? err : (err?.message || '');
      if (code === NATIVE_ERROR.PERMISSION_DENIED || name === 'NotAllowedError') {
        this.error = this.$t('Camera permission denied. Please allow camera access and try again.');
      } else if (name === 'NotFoundError' || /camera not found|no camera/i.test(text)) {
        this.error = this.$t('No camera found on this device.');
      } else {
        this.error = this.$t('Unable to access the camera.');
      }
    },

    onResult(value) {
      if (!value) return;

      if (!this.continuous) {
        // One-shot: ignore everything after the first hit so a code lingering
        // in frame can't fire twice before the parent closes us.
        if (this.detected) return;
        this.detected = true;
        this.$emit('scanned', value);
        return;
      }

      // Continuous: de-dupe the same code held in view, but allow a different
      // code (or the same one after a beat) so multi-field capture keeps going.
      const now = Date.now();
      if (value === this.lastValue && now - this.lastAt < 2000) return;
      this.lastValue = value;
      this.lastAt = now;
      this.$emit('scanned', value);
    },

    async onToggleTorch() {
      if (this.controller) {
        this.torchOn = await this.controller.toggleTorch();
        return;
      }
      if (this.qrScanner) {
        try {
          await this.qrScanner.toggleFlash();
          this.torchOn = this.qrScanner.isFlashOn();
        } catch (err) {
          console.warn('[ScannerOverlay] torch toggle failed:', err);
        }
      }
    },
  },
};
</script>

<style scoped>
.scanner-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  /* Transparent so the native camera feed shows through; only the UI below
     paints. */
  background: transparent;
  display: flex;
  flex-direction: column;
  color: #fff;
}

/* Web engine: the stream is our own <video>, so paint an opaque backdrop
   (nothing should bleed through from the page underneath) and stack the UI
   above the video. */
.scanner-overlay--web {
  background: #000;
}

.so-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
}

.so-topbar,
.so-frame-wrap,
.so-bottom,
.so-error {
  position: relative;
  z-index: 1;
}

/* When the camera can't start the feed is absent, so paint an opaque backdrop
   instead of leaving the error floating over a transparent webview. */
.scanner-overlay--error {
  background: #0c0c0c;
}

/* Top bar */
.so-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px 28px;
  padding-top: calc(env(safe-area-inset-top, 0px) + 12px);
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.5) 0%,
    rgba(0, 0, 0, 0) 100%
  );
}

.so-title {
  flex: 1;
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
}

.so-icon-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.so-icon-btn:active { transform: scale(0.94); }
.so-icon-btn--on { background: #15DE72; color: #07130c; }
.so-icon-spacer { width: 40px; height: 40px; }

/* Frame */
.so-frame-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.so-frame {
  position: relative;
  width: 70vw;
  max-width: 280px;
  aspect-ratio: 1 / 1;
}

.so-corner {
  position: absolute;
  width: 38px;
  height: 38px;
  border: 4px solid #15DE72;
}
.so-corner--tl { top: 0; left: 0; border-right: none; border-bottom: none; border-top-left-radius: 18px; }
.so-corner--tr { top: 0; right: 0; border-left: none; border-bottom: none; border-top-right-radius: 18px; }
.so-corner--bl { bottom: 0; left: 0; border-right: none; border-top: none; border-bottom-left-radius: 18px; }
.so-corner--br { bottom: 0; right: 0; border-left: none; border-top: none; border-bottom-right-radius: 18px; }

/* Bottom: dark scrim so the prompt + tiles read against a bright camera. */
.so-bottom {
  padding: 40px 16px calc(env(safe-area-inset-bottom, 0px) + 28px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.72) 0%,
    rgba(0, 0, 0, 0.45) 55%,
    rgba(0, 0, 0, 0) 100%
  );
}

/* Block so the slotted action row (a flex container) spans the full width
   instead of shrinking to its content. */
.so-actions {
  display: block;
}

.so-prompt {
  margin: 0;
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7);
}

/* Error */
.so-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 32px;
  text-align: center;
  color: rgba(255, 255, 255, 0.92);
}
.so-error-text {
  margin: 0;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  max-width: 280px;
}
.so-error-btn {
  border: none;
  border-radius: 14px;
  padding: 10px 22px;
  background: #fff;
  color: #111;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
</style>
