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
      <!-- Drag handle bar -->
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <!-- Sheet header -->
      <div class="sheet-header">
        <div class="sheet-title" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ $t('Share profile') }}
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

      <div class="share-body">
        <div class="share-intro">
          <div
            class="share-headline"
            :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'"
          >
            {{ $t('Your public profile') }}
          </div>
          <div
            class="share-lede"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
          >
            {{ $t('Scan the QR code, copy your address, or send a link that opens your profile.') }}
          </div>
        </div>

        <!-- QR block. Encodes the NIP-21 `nostr:` URI so scanning in any
             registered Nostr handler on iOS/Android jumps straight to
             the profile; raw paste also works in clients that haven't
             adopted URIs yet. White card behind the QR on both themes
             — guarantees the QR is always legibly contrast-checked. -->
        <div class="qr-block">
          <div class="qr-card">
            <div class="qr-stage">
              <vue-qrcode
                v-if="nostrUri"
                :value="nostrUri"
                :options="qrOptions"
                class="qr-canvas"
              />
              <div v-else class="qr-placeholder">
                <q-spinner size="24px" color="grey-7" />
              </div>
            </div>
          </div>
        <div
          v-if="nostrUri"
          class="qr-caption"
          :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
        >
          {{ $t('Scan to open in a compatible app') }}
        </div>
        <div
          v-if="nostrUri"
          class="qr-hint"
          :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
        >
          {{ $t('Friends can scan this from their address book to add you and send money to you.') }}
        </div>
      </div>

        <!-- Public profile address. Full npub on multiple lines for
             readability, plus an explicit copy action so the affordance
             is obvious even when the address wraps. -->
        <div
          class="address-card"
          :class="$q.dark.isActive ? 'address-card-dark' : 'address-card-light'"
        >
          <div class="address-card-top">
            <div class="address-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
              {{ $t('Profile address') }}
            </div>
            <button
              type="button"
              class="copy-chip"
              :class="$q.dark.isActive ? 'copy-chip-dark' : 'copy-chip-light'"
              :disabled="!npub"
              :aria-label="$t('Copy profile address')"
              @click="onCopy"
            >
              <Icon
                :icon="copied ? 'tabler:check' : 'tabler:copy'"
                width="14"
                height="14"
              />
              <span>{{ copied ? $t('Copied') : $t('Copy') }}</span>
            </button>
          </div>

          <button
            type="button"
            class="address-text-btn"
            :disabled="!npub"
            :aria-label="$t('Copy profile address')"
            @click="onCopy"
          >
            <code class="address-value">{{ npub || '…' }}</code>
          </button>
        </div>
      </div>

      <!-- Primary CTA: native share sheet via the existing
           `shareContent` utility. The QR stays NIP-21 (`nostr:`)
           for app-to-app profile handoff; the shared payload uses
           the public `njump.me` URL so the recipient gets a link
           that opens cleanly in chat apps, browsers, and clients.
           Falls back through Capacitor → Web Share API → clipboard
           automatically. -->
      <div class="sheet-actions" :class="$q.dark.isActive ? 'sheet-actions-dark' : 'sheet-actions-light'">
        <button
          type="button"
          class="primary-cta"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :disabled="!npub"
          @click="onShare"
        >
          <Icon icon="tabler:share-2" width="16" height="16" />
          <span>{{ $t('Share') }}</span>
        </button>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { useIdentityStore } from '../stores/identity';
import { shareContent } from '../utils/share.js';

export default {
  name: 'ProfileShareSheet',

  components: { Icon, VueQrcode },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue'],

  setup() {
    const identity = useIdentityStore();
    return { identity };
  },

  data() {
    return {
      /** Brief visual feedback for the inline copy button. */
      copied: false,
      /** Timer handle so we can clear the visual swap on close. */
      _copyTimer: null,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    /**
     * The raw `npub1...` form. Comes from identityStore's cached
     * pubkey — populated by `created()` on the Profile page or by
     * any prior ensureIdentity() / loadNostrIdentity() call.
     */
    npub() {
      return this.identity.nostrNpub || '';
    },

    /**
     * NIP-21 URI. `nostr:` scheme is registered by every major
     * Nostr client; the OS routes scans straight to a profile
     * view in their app. Raw `npub1…` (without the scheme) works
     * for the copy / paste path which clients still also accept.
     */
    nostrUri() {
      if (!this.npub) return '';
      return `nostr:${this.npub}`;
    },

    /**
     * Public web URL for sharing in chat / email. `njump.me`
     * resolves the Nostr profile for recipients who are outside
     * a Nostr client already, which makes it the best default
     * payload for the OS share sheet.
     */
    njumpUrl() {
      if (!this.npub) return '';
      return `https://njump.me/${this.npub}`;
    },

    /**
     * QR options. Larger error-correction (`H`) keeps the QR
     * scannable when the user puts a small avatar overlay on top
     * in the future, and survives screen-glare / poor lighting
     * scans better than the default `M`. Light mode keeps the
     * default white background; dark mode renders the QR with a
     * white tile so contrast against the surrounding card never
     * fails an in-camera scan.
     */
    qrOptions() {
      return {
        errorCorrectionLevel: 'H',
        margin: 1,
        scale: 6,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      };
    },
  },

  methods: {
    onShow() {
      this.copied = false;
      this.clearCopyTimer();
    },

    clearCopyTimer() {
      if (this._copyTimer) {
        clearTimeout(this._copyTimer);
        this._copyTimer = null;
      }
    },

    async onCopy() {
      if (!this.npub) return;
      try {
        // The npub is public material — no auto-wipe needed.
        await navigator.clipboard.writeText(this.npub);
        this.copied = true;
        this.clearCopyTimer();
        this._copyTimer = setTimeout(() => { this.copied = false; }, 1500);
      } catch (err) {
        console.error('[ProfileShareSheet] copy npub failed', err);
        this.$q.notify({
          type: 'negative',
          message: this.$t("Couldn't copy"),
          timeout: 2500,
        });
      }
    },

    /**
     * Hand the public njump URL to the system share sheet.
     * `shareContent` resolves the right backend (Capacitor → Web
     * Share API → clipboard) and never throws — failures come back
     * as `{ success: false, reason }`. Cancellation is silent; an
     * actual error lands a toast.
     */
    async onShare() {
      if (!this.njumpUrl) return;
      const result = await shareContent({
        title: this.$t('Share profile'),
        text: this.njumpUrl,
        url: this.njumpUrl,
      });
      if (result.success || result.reason === 'cancelled') return;
      if (result.reason === 'unsupported') {
        // Fallback: copy and tell the user we did, so the action
        // didn't visibly fail when sharing isn't available.
        await this.onCopy();
        return;
      }
      this.$q.notify({
        type: 'negative',
        message: this.$t("Couldn't share"),
        timeout: 2500,
      });
    },
  },

  beforeUnmount() {
    this.clearCopyTimer();
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

.sheet-header {
  display: flex;
  align-items: center;
  padding: 4px 16px 8px;
  gap: 8px;
}

.sheet-title {
  flex: 1 1 auto;
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.005em;
}

.sheet-close-btn { flex: 0 0 auto; }

.share-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 16px 20px;
}

.share-intro {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: center;
}

.share-headline {
  font-family: 'Manrope', sans-serif;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.share-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  line-height: 1.5;
  max-width: 320px;
  margin: 0 auto;
}

/* QR block — centered, white card behind the canvas so QR
   readers always see crisp dark-on-light pixels regardless of
   theme. */
.qr-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.qr-card {
  width: min(100%, 296px);
  border-radius: 24px;
  background: #ffffff;
  padding: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.12);
}

.qr-stage {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 18px;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qr-canvas {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 12px;
}

.qr-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qr-caption {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.4;
  text-align: center;
}

.qr-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
  max-width: 300px;
}

.address-card {
  border-radius: 18px;
  padding: 14px;
  border: 1px solid transparent;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.address-card-light {
  background: rgba(15, 23, 42, 0.04);
  border-color: rgba(15, 23, 42, 0.06);
}

.address-card-dark {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.06);
}

.address-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.address-label {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.3;
}

.copy-chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.18s ease, transform 0.1s ease, opacity 0.18s ease;
}

.copy-chip:disabled {
  opacity: 0.55;
  cursor: default;
}

.copy-chip:not(:disabled):active {
  transform: scale(0.98);
}

.copy-chip-light {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(15, 23, 42, 0.08);
  color: #0f172a;
}

.copy-chip-dark {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.1);
  color: #f8fafc;
}

.address-text-btn {
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.address-text-btn:disabled {
  cursor: default;
}

.address-value {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  display: block;
  width: 100%;
  font-size: 12.5px;
  line-height: 1.65;
  font-weight: 500;
  word-break: break-all;
  overflow-wrap: anywhere;
  text-align: left;
  color: inherit;
}

/* Sticky bottom action bar — same explicit-background treatment
   the edit sheet uses so the band never bleeds Quasar defaults. */
.sheet-actions {
  position: sticky;
  bottom: 0;
  padding: 12px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid transparent;
}

.sheet-actions-light {
  background: var(--bg-card, #FAF7EF);
  border-top-color: rgba(15, 23, 42, 0.06);
}

.sheet-actions-dark {
  background: #0C0C0C;
  border-top-color: rgba(255, 255, 255, 0.06);
}

.primary-cta {
  width: 100%;
  height: 48px;
  border-radius: 24px;
  border: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: filter 0.18s ease, transform 0.1s ease, opacity 0.18s ease;
}

.primary-cta:disabled {
  opacity: 0.45;
  cursor: default;
}

.primary-cta:not(:disabled):hover { filter: brightness(1.05); }
.primary-cta:not(:disabled):active { transform: scale(0.98); }

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }

@media (max-width: 380px) {
  .share-body {
    padding-left: 14px;
    padding-right: 14px;
  }

  .qr-card {
    width: min(100%, 272px);
    padding: 14px;
    border-radius: 20px;
  }

  .address-card-top {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
