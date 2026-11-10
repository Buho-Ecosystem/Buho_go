<!--
  QrPhotoButton
  "Choose photo" for a scanner: reads the QR code in a picture the person
  picks instead of pointing the camera at it.

  The system photo picker opens (no access to the photo library is asked
  for), and the picture is read by utils/qrFromImage.js: the native decoder
  in the app, the web view's own looks otherwise. While it reads, the button
  shows it. The scanner around it decides what to do with each outcome; it
  keeps its camera off while the picker is open, so the camera indicator is
  not lit while someone looks through their photos.

  Props:
    - tone  'camera' on a camera surface (dark glass, legible over a bright
            scene); 'page' on a page or sheet (follows light and dark);
            'outline' and 'link' take the look of the quiet button next to
            it (Paste instead), so the two alternatives weigh the same

  Emits:
    - open         the picker is opening: turn the camera off
    - closed       the picker closed without a photo: turn it back on
    - read(text)   the code's text, for the scanner's own result path
    - fail({ code, message })  no code in it, or not a picture this device
                   opens; `message` is the sentence to show

  On older engines, which never say that the picker closed without a photo,
  a touch anywhere while it counts as open means it is gone, and on Android
  the person is back when the app resumes (see utils/photoPick.js). While it
  reads, the button stays focused and ignores taps (aria-disabled, not
  disabled, which would throw focus to the page).
-->
<template>
  <span class="qpb-wrap">
    <button
      type="button"
      class="qpb"
      :class="[`qpb--${tone}`, { 'qpb--reading': reading, 'qpb--dark': tone !== 'camera' && $q.dark.isActive }]"
      :aria-disabled="reading ? 'true' : 'false'"
      :aria-busy="reading ? 'true' : 'false'"
      @click="choose"
    >
      <q-spinner v-if="reading" class="qpb-spinner" :size="`${iconSize - 2}px`" :thickness="3" />
      <Icon v-else icon="tabler:photo" :width="iconSize" :height="iconSize" aria-hidden="true" />
      <span class="qpb-label">{{ reading ? $t('Reading photo…') : $t('Choose photo') }}</span>
    </button>
    <input
      ref="input"
      type="file"
      accept="image/*"
      class="qpb-input"
      tabindex="-1"
      aria-hidden="true"
    />
  </span>
</template>

<script>
import { Icon } from '@iconify/vue';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { appResumeReturn, browserReturn, pickPhoto } from '../utils/photoPick.js';
import { openingSystemPicker } from '../utils/appLock.js';
import { PHOTO_SCAN_ERROR, readQrFromImage } from '../utils/qrFromImage.js';
import { isNativeScannerAvailable, readQrFromPicture } from '../utils/nativeScanner.js';

export default {
  name: 'QrPhotoButton',

  components: { Icon },

  props: {
    tone: { type: String, default: 'camera', validator: (v) => ['camera', 'page', 'outline', 'link'].includes(v) },
  },

  emits: ['open', 'closed', 'read', 'fail'],

  data() {
    return { reading: false };
  },

  computed: {
    iconSize() {
      return this.tone === 'outline' || this.tone === 'link' ? 14 : 20;
    },
  },

  created() {
    // Not reactive: the trip in progress, and whether this button still shows.
    this.trip = null;
    this.alive = true;
    this.onTouchWhileOpen = () => this.trip?.back();
  },

  beforeUnmount() {
    this.alive = false;
    this.endTrip();
  },

  methods: {
    choose() {
      if (this.reading || !this.$refs.input) return;
      this.endTrip();
      const android = Capacitor.getPlatform() === 'android';
      this.trip = pickPhoto(this.$refs.input, {
        onPicked: (file) => { this.stopWatchingTouch(); this.read(file); },
        onClosed: () => { this.stopWatchingTouch(); if (this.alive) this.$emit('closed'); },
        // On Android the window gets focus back for a moment while the
        // picker is still opening: there the app resuming is the return.
        watchReturn: android ? appResumeReturn(App) : browserReturn(),
        // Only Android sends the app to the background for the picker;
        // elsewhere it is a sheet inside the app, and holding the lock back
        // there would only let other ways of leaving go unlocked.
        holdLock: android ? openingSystemPicker : undefined,
      });
      if (this.trip.guesses) document.addEventListener('pointerdown', this.onTouchWhileOpen, true);
      this.$emit('open');
    },

    endTrip() {
      this.stopWatchingTouch();
      this.trip?.stop();
      this.trip = null;
    },

    stopWatchingTouch() {
      document.removeEventListener('pointerdown', this.onTouchWhileOpen, true);
    },

    async read(file) {
      this.reading = true;
      try {
        const text = await readQrFromImage(file, {
          readNative: isNativeScannerAvailable() ? readQrFromPicture : null,
        });
        if (this.alive) this.$emit('read', text);
      } catch (err) {
        if (this.alive) this.$emit('fail', { code: err?.code, message: this.messageFor(err?.code) });
      } finally {
        this.reading = false;
      }
    },

    messageFor(code) {
      return code === PHOTO_SCAN_ERROR.UNREADABLE
        ? this.$t("This photo can't be opened. Choose another one.")
        : this.$t('No QR code in this photo. Choose one that shows the whole code.');
    },
  },
};
</script>

<style scoped>
.qpb-wrap {
  display: inline-flex;
}

.qpb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 20px;
  border: none;
  border-radius: 22px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.12s ease, background-color 0.12s ease;
}
.qpb:active:not([aria-disabled='true']) { transform: scale(0.97); }
.qpb[aria-disabled='true'] { cursor: default; }
.qpb:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }

/* On the camera: dark glass, like the scanner's other controls. White on it
   stays above 4.5:1 even over white paper. */
.qpb--camera {
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.2);
}
.qpb--camera:active:not([aria-disabled='true']) { background: rgba(0, 0, 0, 0.68); }

/* On a page or sheet: a tinted secondary button. */
.qpb--page {
  color: #111;
  background: rgba(17, 17, 17, 0.06);
}
.qpb--page:active:not([aria-disabled='true']) { background: rgba(17, 17, 17, 0.1); }
.qpb--page.qpb--dark {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.qpb--page.qpb--dark:active:not([aria-disabled='true']) { background: rgba(255, 255, 255, 0.16); }

/* Next to an outlined "Paste instead": the same outlined pill. */
.qpb--outline {
  gap: 0.4rem;
  padding: 0 0.9rem;
  border: 1px solid var(--border-card);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0;
}

/* Next to a text button ("Paste a link instead"): the same text button. */
.qpb--link {
  gap: 6px;
  padding: 0 12px;
  background: transparent;
  color: #475569;
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0;
}
.qpb--link.qpb--dark { color: #cbd5e1; }
.qpb--link:active:not([aria-disabled='true']) { background: rgba(15, 23, 42, 0.06); }
.qpb--link.qpb--dark:active:not([aria-disabled='true']) { background: rgba(255, 255, 255, 0.06); }

.qpb--reading { opacity: 0.85; }
.qpb-spinner { color: currentColor; }

/* Present for the picker, never seen or reached. */
.qpb-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
