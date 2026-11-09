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
    - tone  'camera' on a camera surface (dark, glass); 'page' on a page or
            sheet (follows light and dark)

  Emits:
    - open         the picker is opening: turn the camera off
    - closed       the picker closed without a photo: turn it back on
    - read(text)   the code's text, for the scanner's own result path
    - fail({ code, message })  no code in it, or not a picture this device
                   opens; `message` is the sentence to show

  A touch anywhere while the picker counts as open means it is gone: older
  engines never say that it closed without a photo. In the app, the person is
  back when the app resumes (see utils/photoPick.js).
-->
<template>
  <span class="qpb-wrap">
    <button
      type="button"
      class="qpb"
      :class="[`qpb--${tone}`, { 'qpb--reading': reading, 'qpb--dark': tone === 'page' && $q.dark.isActive }]"
      :disabled="reading"
      :aria-busy="reading ? 'true' : 'false'"
      @click="choose"
    >
      <q-spinner v-if="reading" class="qpb-spinner" size="18px" :thickness="3" />
      <Icon v-else icon="tabler:photo" width="20" height="20" aria-hidden="true" />
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
import { browserReturn, pickPhoto } from '../utils/photoPick.js';
import { PHOTO_SCAN_ERROR, readQrFromImage } from '../utils/qrFromImage.js';
import { isNativeScannerAvailable, readQrFromPicture } from '../utils/nativeScanner.js';

/** "Back" in the app: the app resumed. As `watchReturn` for pickPhoto. */
function appReturn(callback) {
  let handle = null;
  let gone = false;
  App.addListener('resume', callback)
    .then((h) => { if (gone) h.remove(); else handle = h; })
    .catch(() => { /* no app plugin: only cancel and a touch end the trip */ });
  return () => {
    gone = true;
    handle?.remove();
  };
}

export default {
  name: 'QrPhotoButton',

  components: { Icon },

  props: {
    tone: { type: String, default: 'camera', validator: (v) => v === 'camera' || v === 'page' },
  },

  emits: ['open', 'closed', 'read', 'fail'],

  data() {
    return { reading: false };
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
      this.trip = pickPhoto(this.$refs.input, {
        onPicked: (file) => { this.stopWatchingTouch(); this.read(file); },
        onClosed: () => { this.stopWatchingTouch(); if (this.alive) this.$emit('closed'); },
        watchReturn: Capacitor.isNativePlatform() ? appReturn : browserReturn(),
      });
      document.addEventListener('pointerdown', this.onTouchWhileOpen, true);
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
.qpb:active:not(:disabled) { transform: scale(0.97); }
.qpb:disabled { cursor: default; }
.qpb:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }

/* On the camera: glass that reads over any scene. */
.qpb--camera {
  color: #fff;
  background: rgba(255, 255, 255, 0.16);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.22);
}
.qpb--camera:active:not(:disabled) { background: rgba(255, 255, 255, 0.24); }

/* On a page or sheet: a tinted secondary button. */
.qpb--page {
  color: #111;
  background: rgba(17, 17, 17, 0.06);
}
.qpb--page:active:not(:disabled) { background: rgba(17, 17, 17, 0.1); }
.qpb--page.qpb--dark {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}
.qpb--page.qpb--dark:active:not(:disabled) { background: rgba(255, 255, 255, 0.16); }

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
