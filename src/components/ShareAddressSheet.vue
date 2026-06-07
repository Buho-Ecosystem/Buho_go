<template>
  <q-dialog
    v-model="open"
    position="bottom"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @show="onShow"
  >
    <q-card
      class="share-sheet"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Drag handle -->
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <!-- Header -->
      <div class="sheet-header">
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ $t('Share') }}
        </div>
        <q-btn
          flat
          round
          dense
          :aria-label="$t('Close')"
          class="sheet-close-btn"
          :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
          @click="open = false"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sheet-scroll">
        <!-- Segmented switcher. Only renders when the user actually
             has both addresses; otherwise the sheet shows the single
             one without the switcher noise. -->
        <div
          v-if="hasBoth"
          class="switcher"
          :class="$q.dark.isActive ? 'switcher-dark' : 'switcher-light'"
          role="tablist"
        >
          <button
            type="button"
            class="switcher-seg"
            :class="{ 'switcher-seg--active': selected === 'nip05' }"
            role="tab"
            :aria-selected="selected === 'nip05'"
            @click="selected = 'nip05'"
          >
            <Icon icon="tabler:rosette-discount-check-filled" width="14" height="14" class="switcher-icon switcher-icon--check" />
            <span>{{ $t('Profile') }}</span>
          </button>
          <button
            type="button"
            class="switcher-seg"
            :class="{ 'switcher-seg--active': selected === 'lud16' }"
            role="tab"
            :aria-selected="selected === 'lud16'"
            @click="selected = 'lud16'"
          >
            <Icon icon="tabler:bolt-filled" width="14" height="14" class="switcher-icon switcher-icon--bolt" />
            <span>{{ $t('Lightning') }}</span>
          </button>
        </div>

        <!-- QR stage. Tap-to-copy on the QR itself feels natural on
             mobile (a thumb is already there) and gives a second copy
             path beyond the explicit address row below. -->
        <button
          type="button"
          class="qr-stage"
          :class="$q.dark.isActive ? 'qr-stage-dark' : 'qr-stage-light'"
          :aria-label="$t('Copy')"
          @click="copyCurrent"
        >
          <vue-qrcode
            v-if="displayValue"
            :value="qrValue"
            :options="qrOptions"
            class="qr-canvas"
          />
        </button>

        <!-- Address row below the QR. Tap to copy too — the QR icon-
             swap + the row's own icon swap both reflect the copied
             state, so the affordance is unambiguous from any angle. -->
        <button
          type="button"
          class="address-row"
          :class="$q.dark.isActive ? 'address-row-dark' : 'address-row-light'"
          :aria-label="$t('Copy')"
          @click="copyCurrent"
        >
          <span class="address-text">{{ displayValue }}</span>
          <Icon
            :icon="copied ? 'tabler:check' : 'tabler:copy'"
            width="16"
            height="16"
            class="address-row-icon"
          />
        </button>

        <p
          class="caption"
          :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
        >
          {{ caption }}
        </p>
      </div>

      <div
        class="sheet-actions"
        :class="$q.dark.isActive ? 'sheet-actions-dark' : 'sheet-actions-light'"
      >
        <button
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          @click="open = false"
        >
          {{ $t('Done') }}
        </button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';

export default {
  name: 'ShareAddressSheet',

  components: { Icon, VueQrcode },

  props: {
    modelValue: { type: Boolean, default: false },
    /** Which address to show first when the sheet opens. */
    initialAddress: {
      type: String,
      default: 'nip05',
      validator: (v) => v === 'nip05' || v === 'lud16',
    },
    /** Full `name@mybuho.de` address. Required when the sheet opens. */
    nip05: { type: String, default: '' },
    /** Optional `name@host.tld` lud16 address. Empty hides the segment. */
    lud16: { type: String, default: '' },
    /**
     * Bech32 npub for the active Nostr key. Used to encode the NIP-05
     * QR with the NIP-21 `nostr:` URI scheme so scanning apps recognise
     * it as a Nostr profile rather than misreading the bare email-shaped
     * NIP-05 string as a Lightning address or an email.
     */
    npub: { type: String, default: '' },
  },

  emits: ['update:modelValue'],

  data() {
    return {
      selected: 'nip05',
      copied: false,
      copiedTimer: null,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    hasBoth() {
      return !!(this.nip05 && this.lud16);
    },

    /** What the user sees in the address row beneath the QR. */
    displayValue() {
      if (this.selected === 'lud16') return this.lud16;
      return this.nip05;
    },

    /**
     * What the QR actually encodes — distinct from the display value.
     *
     *   - Lightning: `lightning:<addr>` so a camera scan deep-links a
     *     Lightning Address-aware wallet straight into the send flow.
     *   - NIP-05: `nostr:npub1...` (NIP-21 URI scheme) so Nostr-aware
     *     clients recognise it as a profile and don't misread the
     *     bare `name@host` shape as an email or a lud16. Fallback to
     *     the bare NIP-05 string only if no npub was provided — better
     *     to ship _something_ than render an empty QR.
     */
    qrValue() {
      if (this.selected === 'lud16') return `lightning:${this.lud16}`;
      if (this.npub) return `nostr:${this.npub}`;
      return this.nip05;
    },

    caption() {
      if (this.selected === 'lud16') {
        return this.$t('Scan in any wallet to pay this address.');
      }
      return this.$t('Scan in any Nostr app to find this profile.');
    },

    qrOptions() {
      const dark = this.$q.dark.isActive;
      return {
        // Higher EC level so the QR survives small print/zoom and the
        // brand-coloured "logo" we may overlay in a future round.
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 6,
        color: {
          dark: dark ? '#f8fafc' : '#0f172a',
          light: dark ? '#0b0f17' : '#ffffff',
        },
      };
    },
  },

  watch: {
    open(isOpen) {
      if (!isOpen) this.clearTimers();
    },
    /**
     * If the parent changes the initial address while the sheet is
     * open (rare), or it was bound to a different value before opening,
     * realign the selection to whatever was requested. The `onShow`
     * hook handles the open-time case.
     */
    initialAddress(v) {
      if (v === 'nip05' || v === 'lud16') this.selected = v;
    },
  },

  beforeUnmount() {
    this.clearTimers();
  },

  methods: {
    onShow() {
      // Reset the segment + transient copied flag on every open so a
      // second-time open doesn't land on stale state.
      const initial = this.hasBoth ? this.initialAddress : 'nip05';
      this.selected = this.lud16 && initial === 'lud16' ? 'lud16' : 'nip05';
      this.copied = false;
    },

    clearTimers() {
      if (this.copiedTimer) {
        clearTimeout(this.copiedTimer);
        this.copiedTimer = null;
      }
    },

    async copyCurrent() {
      // Copy the bare address (without the `lightning:` prefix) — that's
      // the form users paste into other apps' send/search fields. The
      // prefix is only useful inside the QR for camera-scan deep links.
      const value = this.displayValue;
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        this.copied = true;
        this.clearTimers();
        this.copiedTimer = setTimeout(() => { this.copied = false; }, 1400);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Copied'),
          timeout: 1400,
          position: 'top',
        });
      } catch {
        this.$q.notify({
          type: 'warning',
          message: this.$t("Couldn't copy"),
          timeout: 1800,
          position: 'top',
        });
      }
    },
  },
};
</script>

<style scoped>
.share-sheet {
  width: 100%;
  max-width: 520px;
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  overflow: hidden;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  max-height: 90dvh;
}

.sheet-handle {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
  flex-shrink: 0;
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

.sheet-header {
  display: flex;
  align-items: center;
  padding: 4px 18px 8px;
  gap: 8px;
  flex-shrink: 0;
}

.sheet-title {
  flex: 1 1 auto;
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.sheet-close-btn { flex: 0 0 auto; }

.sheet-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 18px 18px;
  align-items: center;
}

/* ---------- Segmented switcher ----------
   Pill-shaped track with two equal segments. The active segment lifts
   onto a card-coloured tile (Apple's segmented-control idiom), so the
   user reads it as a tab pair rather than a paired set of buttons. */

.switcher {
  display: inline-flex;
  align-items: center;
  padding: 4px;
  border-radius: 999px;
  width: 100%;
  max-width: 280px;
  gap: 2px;
}

.switcher-light { background: rgba(15, 23, 42, 0.06); }
.switcher-dark  { background: rgba(255, 255, 255, 0.06); }

.switcher-seg {
  all: unset;
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 999px;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: inherit;
  opacity: 0.65;
  transition: background-color 0.18s ease, opacity 0.18s ease, color 0.18s ease;
  -webkit-tap-highlight-color: transparent;
}

.switcher-light .switcher-seg { color: #334155; }
.switcher-dark  .switcher-seg { color: #cbd5e1; }

.switcher-seg--active {
  opacity: 1;
}

.switcher-light .switcher-seg--active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
}

.switcher-dark .switcher-seg--active {
  background: rgba(255, 255, 255, 0.10);
  color: #f8fafc;
}

.switcher-icon--check { color: #15a35b; }
.switcher-icon--bolt  { color: #f7931a; }

/* ---------- QR stage ---------- */

.qr-stage {
  all: unset;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  border-radius: 18px;
  -webkit-tap-highlight-color: transparent;
}

.qr-stage-light {
  background: #ffffff;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.06);
}

.qr-stage-dark {
  background: rgba(255, 255, 255, 0.04);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.qr-stage:active { transform: scale(0.99); }

.qr-canvas {
  width: 240px !important;
  height: 240px !important;
  border-radius: 8px;
  display: block;
}

/* ---------- Address row below the QR ---------- */

.address-row {
  all: unset;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 320px;
  padding: 11px 14px;
  border-radius: 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.005em;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s ease, transform 0.08s ease;
}

.address-row-light { background: rgba(15, 23, 42, 0.05); color: #334155; }
.address-row-dark  { background: rgba(255, 255, 255, 0.06); color: #cbd5e1; }

.address-row:hover { filter: brightness(0.98); }
.address-row:active { transform: scale(0.998); }

.address-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.address-row-icon { flex-shrink: 0; opacity: 0.55; }

.caption {
  margin: 0;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.4;
  text-align: center;
  max-width: 280px;
}

/* ---------- Sticky bottom action ---------- */

.sheet-actions {
  flex-shrink: 0;
  padding: 12px 18px 6px;
  border-top: 1px solid transparent;
}

.sheet-actions-light { border-top-color: rgba(15, 23, 42, 0.06); }
.sheet-actions-dark  { border-top-color: rgba(255, 255, 255, 0.06); }

.primary-cta {
  width: 100%;
  height: 48px;
  border-radius: 16px;
  border: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: filter 0.18s ease, transform 0.1s ease;
}

.primary-cta:not(:disabled):hover { filter: brightness(1.05); }
.primary-cta:not(:disabled):active { transform: scale(0.98); }
</style>
