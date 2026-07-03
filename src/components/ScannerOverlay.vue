<!--
  ScannerOverlay
  Full-screen NATIVE scanner (iOS/Android) built on MLKit's live `startScan`.
  The camera feed renders behind a transparent webview (body.barcode-scanner-active,
  see app.css); this overlay is the one element kept visible, so our own frame +
  buttons sit on top of the camera — no Google branding, no covered UI.

  Teleported to <body> so it overlays whatever opened it (a page or a q-dialog)
  without inheriting an opaque ancestor that would paint over the camera.

  Web/PWA does NOT use this component — call sites keep their existing
  qr-scanner (<video>) path there. Only mount this when isNativeScannerAvailable().

  Props:
    - active      controls the scan lifecycle (start on true, stop on false)
    - title       header label
    - prompt      hint text shown above the action slot
    - continuous  keep scanning after a detect (multi-field capture, e.g. LNbits).
                  Default false: stop after the first code so the parent can close.

  Emits:
    - scanned(value)  a decoded QR string
    - close           user dismissed the scanner (X / back / camera error)
-->
<template>
  <teleport to="body">
    <div
      class="barcode-scanner-modal scanner-overlay"
      :class="{ 'scanner-overlay--error': error }"
    >
      <!-- Top bar -->
      <div class="so-topbar">
        <button type="button" class="so-icon-btn" @click="$emit('close')">
          <Icon icon="tabler:x" width="22" height="22" />
        </button>
        <div class="so-title">{{ title || $t('Scan QR Code') }}</div>
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
import { startLiveScan } from '../utils/nativeScanner';

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
      controller: null,
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
      this.error = '';
      this.detected = false;
      try {
        this.controller = await startLiveScan({
          onResult: (value) => this.onResult(value),
        });
        this.torchAvailable = await this.controller.isTorchAvailable();
      } catch (err) {
        console.error('[ScannerOverlay] start failed:', err);
        this.error = err?.code === 'PERMISSION_DENIED'
          ? this.$t('Camera permission denied. Please allow camera access and try again.')
          : this.$t('Unable to access the camera.');
        // Make sure any half-started scan is torn down.
        await this.stop();
      }
    },

    async stop() {
      this.torchOn = false;
      this.torchAvailable = false;
      if (this.controller) {
        const c = this.controller;
        this.controller = null;
        try { await c.stop(); } catch { /* noop */ }
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
      if (!this.controller) return;
      this.torchOn = await this.controller.toggleTorch();
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
