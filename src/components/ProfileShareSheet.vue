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
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

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
        <!-- "Scan to add me" — the single most important line on this
             sheet: it's the one thing that tells a first-time user what
             this QR actually DOES (adds them as a contact), not just
             that it exists. TikTok/Snapchat-style: the profile picture
             sits cut into the center of the code itself, so the code
             visually reads as "this person's code" at a glance. -->
        <div class="qr-heading" :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'">
          {{ $t('Scan to add me') }}
        </div>

        <div class="qr-block">
          <button
            type="button"
            class="qr-card"
            :class="$q.dark.isActive ? 'qr-card-dark' : 'qr-card-light'"
            :disabled="!npub"
            :aria-label="$t('Copy profile address')"
            @click="onCopy"
          >
            <div class="qr-stage">
              <vue-qrcode
                v-if="nip21ProfileUri"
                :value="nip21ProfileUri"
                :options="qrOptions"
                class="qr-canvas"
              />
              <div v-else class="qr-placeholder">
                <q-spinner size="24px" color="grey-7" />
              </div>

              <!-- Avatar cut into the QR's center. Safe at this size
                   (~20% of the code, well under the ~25-30% a
                   high-error-correction QR can lose and still scan —
                   see errorCorrectionLevel: 'H' in qrOptions below)
                   and center occlusion avoids the three corner finder
                   patterns scanners rely on most. -->
              <div
                v-if="nip21ProfileUri"
                class="qr-avatar-overlay"
                :style="{ width: avatarOverlaySize + 'px', height: avatarOverlaySize + 'px' }"
              >
                <img
                  v-if="avatarUrl"
                  :src="avatarUrl"
                  :alt="$t('Profile picture')"
                  class="qr-avatar-img"
                  @error="onAvatarError"
                />
                <div v-else class="qr-avatar-fallback">
                  <img
                    src="/buho_logo.svg"
                    alt=""
                    width="60%"
                    height="60%"
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>
          </button>

          <div
            class="qr-name"
            :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'"
          >
            {{ profileName }}
          </div>

          <div
            v-if="nip21ProfileUri"
            class="qr-caption"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ copied ? $t('Copied') : $t('Scan this to add me as a contact and pay me') }}
          </div>
        </div>

      </div>

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
import { useProfileStore } from '../stores/profile';
import { getQrOptionsWithSize } from '../utils/qrConfig.js';
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
    const profile = useProfileStore();
    return { identity, profile };
  },

  data() {
    return {
      copied: false,
      _copyTimer: null,
      avatarBroken: false,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    npub() {
      return this.identity.nostrNpub || '';
    },

    profileName() {
      return this.profile.displayName
        || this.profile.name
        || this.$t('Your profile');
    },

    avatarUrl() {
      if (!this.profile.picture || this.avatarBroken) return '';
      return this.profile.picture;
    },

    nip21ProfileUri() {
      if (!this.npub) return '';
      return `nostr:${this.npub}`;
    },

    njumpUrl() {
      if (!this.npub) return '';
      return `https://njump.me/${this.npub}`;
    },

    qrSize() {
      return this.$q.screen.width <= 380 ? 184 : 208;
    },

    qrOptions() {
      return {
        ...getQrOptionsWithSize(this.qrSize),
        margin: 2,
        // High error correction (~30% recoverable) is required once a
        // logo sits on top of the code — without this the avatar
        // overlay below could make the QR unreadable.
        errorCorrectionLevel: 'H',
      };
    },

    // ~20% of the code's width, comfortably under what level-H error
    // correction can lose and still decode, with margin for real-world
    // scan conditions (camera glare, small screens).
    avatarOverlaySize() {
      return Math.round(this.qrSize * 0.2);
    },
  },

  methods: {
    onShow() {
      this.copied = false;
      this.avatarBroken = false;
      this.clearCopyTimer();
    },

    clearCopyTimer() {
      if (this._copyTimer) {
        clearTimeout(this._copyTimer);
        this._copyTimer = null;
      }
    },

    onAvatarError() {
      this.avatarBroken = true;
    },

    async onCopy() {
      if (!this.npub) return;
      try {
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

    async onShare() {
      if (!this.njumpUrl) return;
      const result = await shareContent({
        title: this.$t('Share profile'),
        text: this.njumpUrl,
        url: this.njumpUrl,
      });
      if (result.success || result.reason === 'cancelled') return;
      if (result.reason === 'unsupported') {
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

.sheet-close-btn {
  flex: 0 0 auto;
}

.share-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 16px 20px;
}

.qr-heading {
  font-family: 'Manrope', sans-serif;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
  text-align: center;
}

.qr-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.qr-card {
  width: min(100%, 248px);
  border-radius: 22px;
  background: #ffffff;
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.12);
  cursor: pointer;
  transition: transform 0.1s ease, box-shadow 0.18s ease, opacity 0.18s ease;
}

.qr-card:disabled {
  cursor: default;
  opacity: 0.7;
}

.qr-card:not(:disabled):active {
  transform: scale(0.985);
}

.qr-card-light:hover:not(:disabled),
.qr-card-dark:hover:not(:disabled) {
  box-shadow: 0 22px 48px rgba(15, 23, 42, 0.14);
}

.qr-stage {
  position: relative;
  width: fit-content;
  max-width: 100%;
  border-radius: 16px;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.qr-canvas {
  width: auto;
  max-width: 100%;
  height: auto;
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

/* Avatar cut into the QR's center — see the template comment for why
   this stays scannable (errorCorrectionLevel: 'H' + ~20% sizing). The
   white ring (padding + white background) gives the decoder a clean
   boundary instead of the avatar touching QR modules directly. */
.qr-avatar-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: #ffffff;
  padding: 3px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.18);
}

.qr-avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  display: block;
  object-fit: cover;
}

/* White rather than the old green gradient: the logo mark is itself
   multi-tone green, and a saturated green backing washed it out. */
.qr-avatar-fallback {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qr-name {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
  text-align: center;
}

.qr-caption {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  text-align: center;
  max-width: 280px;
}

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

.primary-cta:not(:disabled):hover {
  filter: brightness(1.05);
}

.primary-cta:not(:disabled):active {
  transform: scale(0.98);
}

.item-label-light { color: #0f172a; }
.item-label-dark  { color: #f8fafc; }

@media (max-width: 380px) {
  .share-body {
    padding-left: 14px;
    padding-right: 14px;
  }

  .qr-card {
    width: min(100%, 224px);
    padding: 10px;
    border-radius: 18px;
  }
}
</style>
