<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @hide="onHide"
  >
    <q-card
      class="add-site-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Drag handle -->
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <!-- Header -->
      <q-card-section class="add-site-header">
        <div
          class="add-site-title"
          :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'"
        >
          {{ $t('Sign in to a site') }}
        </div>
        <q-btn
          flat
          round
          dense
          @click="close"
          :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          :aria-label="$t('Close')"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </q-card-section>

      <!-- SCAN mode (default) — camera preview, auto-submit on detect -->
      <template v-if="mode === 'scan'">
        <q-card-section class="add-site-body">
          <p
            class="add-site-lede"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ $t('Point your camera at the "Login with Bitcoin" QR code.') }}
          </p>

          <div
            class="scan-frame"
            :class="$q.dark.isActive ? 'scan-frame-dark' : 'scan-frame-light'"
          >
            <!-- Mounted via v-if (not v-show) — same as SendModal. The
                 element is in the DOM only when we actually want the
                 stream playing, so qr-scanner never has to override a
                 `display: none` style we set. -->
            <video
              v-if="showCamera && !cameraError"
              ref="videoEl"
              class="scan-video"
              playsinline
            />

            <!-- Loading state — replaces the video while the camera is
                 negotiating permission / spinning up. -->
            <div
              v-if="!showCamera && !cameraError"
              class="scan-overlay"
              :class="$q.dark.isActive ? 'scan-overlay-dark' : 'scan-overlay-light'"
            >
              <q-spinner-dots size="36px" color="grey-6" />
            </div>

            <!-- Permission / hardware / secure-context failure -->
            <div
              v-if="cameraError"
              class="scan-overlay scan-error"
              :class="[
                $q.dark.isActive ? 'scan-overlay-dark' : 'scan-overlay-light',
                $q.dark.isActive ? 'text-grey-4' : 'text-grey-7',
              ]"
            >
              <Icon icon="tabler:camera-off" width="28" height="28" />
              <p>{{ cameraError }}</p>
            </div>
          </div>

          <button
            type="button"
            class="add-site-switch"
            :class="$q.dark.isActive ? 'add-site-switch-dark' : 'add-site-switch-light'"
            @click="switchTo('paste')"
          >
            <Icon icon="tabler:clipboard" width="14" height="14" />
            <span>{{ $t('Or paste a link instead') }}</span>
          </button>
        </q-card-section>
      </template>

      <!-- PASTE mode — same input we had before, plus a way back to scan -->
      <template v-else>
        <q-card-section class="add-site-body">
          <p
            class="add-site-lede"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ $t('Open a site that supports Lightning login, tap "Login with Bitcoin", then copy the link and paste it here.') }}
          </p>

          <div
            class="add-site-input-wrap"
            :class="[
              $q.dark.isActive ? 'add-site-input-wrap-dark' : 'add-site-input-wrap-light',
              { 'add-site-input-wrap--error': errorText },
            ]"
          >
            <Icon icon="tabler:link" width="18" height="18" class="add-site-input-icon" />
            <input
              ref="inputEl"
              v-model="rawInput"
              type="text"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="none"
              autocorrect="off"
              class="add-site-input"
              :class="$q.dark.isActive ? 'add-site-input-dark' : 'add-site-input-light'"
              :placeholder="$t('Paste login link')"
              @input="onInput"
              @keyup.enter="submit"
            />
            <button
              v-if="rawInput"
              type="button"
              class="add-site-clear"
              :aria-label="$t('Clear')"
              @click="clearInput"
            >
              <Icon icon="tabler:x" width="14" height="14" />
            </button>
            <button
              v-else
              type="button"
              class="add-site-clear"
              :aria-label="$t('Paste')"
              @click="pasteFromClipboard"
            >
              <Icon icon="tabler:clipboard" width="14" height="14" />
            </button>
          </div>

          <div v-if="errorText" class="add-site-error" role="alert">
            <Icon icon="tabler:alert-circle" width="14" height="14" />
            <span>{{ errorText }}</span>
          </div>

          <button
            type="button"
            class="add-site-switch"
            :class="$q.dark.isActive ? 'add-site-switch-dark' : 'add-site-switch-light'"
            @click="switchTo('scan')"
          >
            <Icon icon="tabler:camera" width="14" height="14" />
            <span>{{ $t('Or scan with camera') }}</span>
          </button>
        </q-card-section>

        <!-- Submit only exists in paste mode — scan mode auto-submits -->
        <q-card-actions class="add-site-actions">
          <q-btn
            unelevated
            no-caps
            class="add-site-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="$t('Continue')"
            :disable="!canSubmit"
            @click="submit"
          />
        </q-card-actions>
      </template>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import QrScanner from 'qr-scanner';
import { looksLikeLud04, parseLud04Input } from '../utils/lud4';

export default {
  name: 'AddSiteSheet',

  components: { Icon },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue', 'submit'],

  data() {
    return {
      // 'scan' is the default — most LUD-04 sessions start with a QR
      // code on the desktop screen the user is looking at. Paste is
      // still one tap away for copied links / shared links.
      mode: 'scan',
      rawInput: '',
      errorText: '',
      // Camera state mirrors SendModal exactly so the lifecycle is
      // identical to the payment scanner the rest of the app uses:
      //   `showCamera` toggles the <video> element in/out of the DOM
      //   via `v-if` — qr-scanner attaches to a freshly-mounted node
      //   rather than fighting with a hidden one.
      showCamera: false,
      cameraError: '',
      // Set true after a successful detect so we don't fire `submit`
      // multiple times if the scanner keeps decoding the same QR for
      // a few frames before we stop it.
      detected: false,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    /**
     * Button enabled only when the input looks like a LUD-04 carrier.
     * `looksLikeLud04` is a cheap prefix check — full bech32 decoding
     * happens at submit time. This keeps the button calm while the
     * user is typing and avoids enabling on a half-typed string.
     */
    canSubmit() {
      return looksLikeLud04(this.rawInput.trim());
    },
  },

  watch: {
    modelValue(isOpen) {
      if (isOpen) {
        this.reset();
        // Default mode is scan — same two-step init that SendModal uses:
        // check hasCamera first, then mount the <video> via showCamera,
        // then attach qr-scanner to the newly-mounted element.
        this.initializeCamera();
      } else {
        this.stopScanner();
        this.showCamera = false;
      }
    },
  },

  beforeUnmount() {
    this.stopScanner();
  },

  methods: {
    onInput() {
      if (this.errorText) this.errorText = '';
    },

    clearInput() {
      this.rawInput = '';
      this.errorText = '';
      this.$nextTick(() => this.$refs.inputEl?.focus());
    },

    /**
     * Best-effort clipboard read. Browsers and Capacitor WebViews both
     * support `navigator.clipboard.readText()` when granted permission;
     * if the user has denied it (or the platform refuses), we fall back
     * gracefully and let them paste manually.
     */
    async pasteFromClipboard() {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          this.rawInput = text.trim();
          this.onInput();
        }
      } catch {
        // Silent fallback — the input is already focused, the user can
        // long-press to paste using the system menu.
      }
    },

    /**
     * Submit a manually-typed link. The scanner has its own auto-submit
     * path via `onQRDetect`, so this only fires from the paste mode.
     */
    submit() {
      if (!this.canSubmit) return;
      this.submitText(this.rawInput.trim());
    },

    /**
     * Shared parse + emit path used by both submit() and the scanner.
     * Centralised so the error message + close behaviour are identical
     * whether the link came from typing or from the camera.
     */
    submitText(text) {
      let challenge;
      try {
        challenge = parseLud04Input(text);
      } catch {
        this.errorText = this.$t('That link is not a Lightning login. Check the site and copy the link again.');
        if (this.mode === 'scan') {
          // Surface the error inline by flipping back to paste so the
          // user sees the bad text and can fix or replace it.
          this.detected = false;
          this.mode = 'paste';
          this.rawInput = text;
        }
        return;
      }
      this.$emit('submit', challenge);
      this.close();
    },

    /**
     * Switch between scan and paste modes. Mirrors the same init/teardown
     * the `modelValue` watcher uses.
     */
    switchTo(target) {
      if (this.mode === target) return;
      this.mode = target;
      if (target === 'scan') {
        this.initializeCamera();
      } else {
        this.stopScanner();
        this.showCamera = false;
        // Focus the paste input as soon as the user opts into typing.
        this.$nextTick(() => this.$refs.inputEl?.focus());
      }
    },

    /**
     * Two-step camera init, copy-edited from SendModal so the visible
     * behaviour matches the payment scanner the rest of the app uses.
     */
    async initializeCamera() {
      if (this.mode !== 'scan') return;
      this.cameraError = '';
      try {
        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera) {
          this.cameraError = this.$t('No camera found on this device.');
          return;
        }
        // Mount the <video> ELEMENT first, then wait one tick for the
        // ref to attach, then start the scanner. This is the exact
        // sequence SendModal uses and it sidesteps the
        // "QrScanner has overwritten the video hiding style" warning
        // entirely — there's nothing to hide because the element is
        // freshly inserted.
        this.showCamera = true;
        await this.$nextTick();
        await this.startQrScanner();
      } catch (error) {
        console.error('[AddSiteSheet] camera initialization error:', error);
        this.handleCameraError(error);
      }
    },

    async startQrScanner() {
      try {
        const videoEl = this.$refs.videoEl;
        if (!videoEl) {
          throw new Error('Video element not found');
        }

        this.qrScanner = new QrScanner(
          videoEl,
          (result) => {
            const text = typeof result === 'string' ? result : (result?.data || result?.text || '');
            this.onQRDetect(text);
          },
          {
            returnDetailedScanResult: true,
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: 'environment',
          },
        );

        await this.qrScanner.start();
      } catch (error) {
        console.error('[AddSiteSheet] error starting QR scanner:', error);
        this.handleCameraError(error);
      }
    },

    handleCameraError(error) {
      // Map the family of getUserMedia errors to one of our friendly
      // strings. Same shape as SendModal's `handleCameraError` so the
      // copy stays consistent app-wide; additionally we recognise the
      // "secure context" string qr-scanner throws on http:// origins.
      if (error?.name === 'NotAllowedError') {
        this.cameraError = this.$t('Camera permission denied. Allow access in settings or paste a link instead.');
      } else if (error?.name === 'NotFoundError') {
        this.cameraError = this.$t('No camera found on this device.');
      } else if (error?.name === 'NotSupportedError' || /secure context|https/i.test(error?.message || '')) {
        this.cameraError = this.$t("Camera needs a secure connection. Paste a link instead.");
      } else {
        this.cameraError = this.$t("Couldn't open the camera. Try pasting a link instead.");
      }
      this.showCamera = false;
    },

    stopScanner() {
      if (this.qrScanner) {
        try {
          this.qrScanner.stop();
          this.qrScanner.destroy();
        } catch {
          // The scanner may already be torn down — swallow.
        }
        this.qrScanner = null;
      }
    },

    onQRDetect(text) {
      if (this.detected || !text) return;
      // Pre-filter so a stray Lightning invoice / Bitcoin address
      // doesn't trigger our error path. Only LUD-04 carriers are
      // accepted here; payment QRs belong in the Send flow.
      if (!looksLikeLud04(text)) return;
      this.detected = true;
      // Stop scanning immediately so the camera doesn't keep firing
      // detects while we hand off to the auth dialog.
      this.stopScanner();
      this.submitText(text);
    },

    close() {
      this.open = false;
    },

    onHide() {
      // q-dialog @hide fires after the leave animation. Final cleanup
      // happens here in case `modelValue` watcher didn't catch the
      // close (e.g. dismissed via escape / backdrop).
      this.stopScanner();
      this.showCamera = false;
      this.reset();
    },

    reset() {
      this.rawInput = '';
      this.errorText = '';
      this.detected = false;
      this.mode = 'scan';
      this.cameraError = '';
    },
  },
};
</script>

<style scoped>
.add-site-sheet {
  width: 100%;
  max-width: 520px;
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  overflow: hidden;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}

.sheet-handle {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
}

.sheet-handle-bar-light,
.sheet-handle-bar-dark {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  display: block;
}

.sheet-handle-bar-light { background: rgba(15, 23, 42, 0.18); }
.sheet-handle-bar-dark  { background: rgba(255, 255, 255, 0.22); }

.add-site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 20px 0;
}

.add-site-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

.add-site-body {
  padding: 8px 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.add-site-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.55;
  margin: 0;
}

/* Custom input wrapper rather than q-input so we can fully control the
   look — no green focus border, no Quasar-managed margins, and a clean
   slot for the paste/clear button on the right. */
.add-site-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid transparent;
  transition: border-color 0.18s ease, background-color 0.18s ease;
}

.add-site-input-wrap-light {
  background: #f1f5f9;
  border-color: rgba(15, 23, 42, 0.08);
}

.add-site-input-wrap-light:focus-within {
  border-color: rgba(15, 23, 42, 0.35);
  background: #ffffff;
}

.add-site-input-wrap-dark {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

.add-site-input-wrap-dark:focus-within {
  border-color: rgba(255, 255, 255, 0.32);
}

.add-site-input-wrap--error {
  border-color: rgba(239, 68, 68, 0.55) !important;
}

.add-site-input-icon {
  flex: 0 0 auto;
  opacity: 0.55;
}

.add-site-input {
  flex: 1 1 auto;
  background: transparent;
  border: none;
  outline: none;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  letter-spacing: -0.005em;
  min-width: 0;
}

.add-site-input-light { color: #0f172a; }
.add-site-input-dark  { color: #f8fafc; caret-color: #15DE72; }

.add-site-clear {
  background: transparent;
  border: none;
  cursor: pointer;
  color: inherit;
  opacity: 0.55;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  flex: 0 0 auto;
}

.add-site-clear:hover { opacity: 0.85; }

.add-site-error {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #ef4444;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
}

.add-site-actions {
  padding: 4px 20px 8px;
  display: flex;
  justify-content: center;
}

.add-site-primary-btn {
  width: 100%;
  max-width: 360px;
  height: 46px;
  border-radius: 24px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
}

/* ----- Scan mode ----- */

.scan-frame {
  position: relative;
  width: 100%;
  max-width: 320px;
  aspect-ratio: 1 / 1;
  margin: 8px auto 0;
  border-radius: 18px;
  overflow: hidden;
  /* Black canvas so the video has somewhere to land while the stream
     is warming up; better than the cream/neutral card colour bleeding
     through. */
  background: #000;
}

.scan-frame-light {
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}

.scan-frame-dark {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

/* The <video> is mounted via v-if (mirrors SendModal). Position it
   absolutely so it fills the frame regardless of metadata-load
   timing — Safari occasionally lays the element out at intrinsic
   320x240 before stream metadata arrives. */
.scan-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Overlays sit ON TOP of the video, fully covering the frame. */
.scan-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 0 24px;
  z-index: 2;
}

.scan-overlay-light {
  background: #f1f5f9;
}

.scan-overlay-dark {
  background: rgba(0, 0, 0, 0.6);
}

.scan-error p {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.5;
  margin: 0;
}

/* ----- Mode switch link ----- */

.add-site-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 12px auto 0;
  padding: 6px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 500;
  border-radius: 999px;
  transition: background-color 0.18s ease;
}

.add-site-switch-light {
  color: #475569;
}

.add-site-switch-light:hover {
  background: rgba(15, 23, 42, 0.06);
}

.add-site-switch-dark {
  color: #cbd5e1;
}

.add-site-switch-dark:hover {
  background: rgba(255, 255, 255, 0.06);
}
</style>
