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
        <div
          class="profile-card"
          :class="$q.dark.isActive ? 'profile-card-dark' : 'profile-card-light'"
        >
          <div class="profile-card-avatar">
            <img
              v-if="avatarUrl"
              :src="avatarUrl"
              :alt="$t('Profile picture')"
              class="profile-card-avatar-img"
              @error="onAvatarError"
            />
            <Icon
              v-else
              icon="tabler:user"
              width="28"
              height="28"
              class="profile-card-avatar-glyph"
              aria-hidden="true"
            />
          </div>

          <div class="profile-card-meta">
            <div
              class="profile-card-name"
              :class="$q.dark.isActive ? 'item-label-dark' : 'item-label-light'"
            >
              {{ profileName }}
            </div>
            <div
              class="profile-card-subline"
              :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
            >
              {{ $t('Share your public profile') }}
            </div>
          </div>
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
            </div>
          </button>

          <div
            v-if="nip21ProfileUri"
            class="qr-caption"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ copied ? $t('Copied') : $t('Tap to copy. Scan to add this profile.') }}
          </div>

          <div
            v-if="nip21ProfileUri"
            class="qr-hint"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ $t('Friends can scan this to add you to their address book and pay you.') }}
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

    qrOptions() {
      const size = this.$q.screen.width <= 380 ? 184 : 208;
      return {
        ...getQrOptionsWithSize(size),
        margin: 2,
      };
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

.profile-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid transparent;
}

.profile-card-light {
  background:
    linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.68)),
    radial-gradient(circle at top left, rgba(21, 222, 114, 0.10), transparent 55%);
  border-color: rgba(15, 23, 42, 0.06);
}

.profile-card-dark {
  background:
    linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03)),
    radial-gradient(circle at top left, rgba(21, 222, 114, 0.12), transparent 55%);
  border-color: rgba(255, 255, 255, 0.08);
}

.profile-card-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  overflow: hidden;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #15DE72 0%, #0fb35e 100%);
  color: #ffffff;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16);
}

.profile-card-avatar-img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.profile-card-avatar-glyph {
  color: #ffffff;
}

.profile-card-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.profile-card-name {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.profile-card-subline {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.35;
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

.qr-caption {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
  text-align: center;
}

.qr-hint {
  max-width: 300px;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.45;
  text-align: center;
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

  .profile-card {
    padding: 12px 14px;
  }

  .qr-card {
    width: min(100%, 224px);
    padding: 10px;
    border-radius: 18px;
  }
}
</style>
