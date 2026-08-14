<template>
  <!--
    One share surface.

    The old page had two: a profile sheet with an npub code and an address
    sheet with a switcher between two other codes, opened from two different
    unlabelled buttons. A user could not predict which one a friend needed.

    There is now exactly one code that means "me", and the caption always
    says what happens when it is scanned. Handing over only a payment address
    is a different job and lives on Get paid, which the footer points at.
  -->
  <q-dialog v-model="open" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
    <q-card class="share-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-grab" aria-hidden="true"><span></span></div>

      <div class="sheet-head">
        <div class="sheet-title">{{ $t('Share your card') }}</div>
        <q-btn flat round dense :aria-label="$t('Close')" @click="open = false">
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </div>

      <div class="sheet-body">
        <div class="share-qr-wrap">
          <div class="share-qr">
            <vue-qrcode v-if="qrValue" :value="qrValue" :options="qrOptions" class="share-qr-canvas" />
            <div v-else class="share-qr-empty"><q-spinner size="24px" color="grey-7" /></div>
            <div v-if="qrValue && avatarUrl" class="share-qr-avatar">
              <img :src="avatarUrl" alt="" @error="avatarBroken = true" />
            </div>
          </div>
          <div class="share-qr-caption">
            {{ $t('Scanning this saves you as a contact and opens a payment') }}
          </div>
        </div>

        <IdentityGroup class="share-actions">
          <IdentityRow
            icon="tabler:share-2"
            :label="$t('Send my link')"
            :caption="$t('Chat, mail, anywhere')"
            :chevron="false"
            @click="onShare"
          />
          <IdentityRow
            icon="tabler:copy"
            :label="copied ? $t('Copied') : $t('Copy my link')"
            :chevron="false"
            @click="onCopy"
          />
        </IdentityGroup>

        <p class="share-foot">
          {{ $t('If someone only needs to pay you, Get paid gives them just your payment name.') }}
        </p>
      </div>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import IdentityGroup from './IdentityGroup.vue';
import IdentityRow from './IdentityRow.vue';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';
import { getQrOptionsWithSize } from '../../utils/qrConfig.js';
import { shareContent } from '../../utils/share.js';

export default {
  name: 'IdentityShareSheet',

  components: { Icon, VueQrcode, IdentityGroup, IdentityRow },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue'],

  setup() {
    return { identity: useIdentityStore(), profile: useProfileStore() };
  },

  data() {
    return { copied: false, avatarBroken: false, _copyTimer: null };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    npub() {
      return this.identity.nostrNpub || '';
    },

    qrValue() {
      return this.npub ? `nostr:${this.npub}` : '';
    },

    qrOptions() {
      return getQrOptionsWithSize(172);
    },

    avatarUrl() {
      if (!this.profile.picture || this.avatarBroken) return '';
      return this.profile.picture;
    },

    profileName() {
      return this.profile.displayName || this.profile.name || this.$t('Your card');
    },
  },

  beforeUnmount() {
    if (this._copyTimer) clearTimeout(this._copyTimer);
  },

  methods: {
    async onCopy() {
      if (!this.qrValue) return;
      try {
        await navigator.clipboard.writeText(this.qrValue);
        this.copied = true;
        if (this._copyTimer) clearTimeout(this._copyTimer);
        this._copyTimer = setTimeout(() => { this.copied = false; }, 1600);
      } catch {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't copy"), timeout: 1800, position: 'top' });
      }
    },

    async onShare() {
      if (!this.qrValue) return;
      await shareContent({
        title: this.profileName,
        text: this.$t('Add me on BuhoGO'),
        url: this.qrValue,
      });
    },
  },
};
</script>

<style scoped>
.share-sheet {
  width: 100%;
  max-width: 520px;
  border-radius: 24px 24px 0 0;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}

.sheet-grab { display: flex; justify-content: center; padding: 9px 0 2px; }
.sheet-grab span {
  width: 36px; height: 4px; border-radius: 999px;
  background: var(--border-card); display: block;
}

.sheet-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px 4px;
}

.sheet-title {
  flex: 1;
  padding-left: 4px;
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 720;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.sheet-body { padding: 8px 16px 20px; }

.share-qr-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding-top: 4px;
}

.share-qr {
  width: 192px;
  height: 192px;
  border-radius: 20px;
  background: #fff;
  padding: 10px;
  position: relative;
  box-shadow: 0 16px 34px -22px rgba(0, 0, 0, 0.55);
}

.share-qr :deep(img),
.share-qr :deep(canvas),
.share-qr-canvas { width: 100%; height: 100%; display: block; }
.share-qr-empty { width: 100%; height: 100%; display: grid; place-items: center; }

.share-qr-avatar {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 44px;
  height: 44px;
  border-radius: 13px;
  overflow: hidden;
  border: 4px solid #fff;
}

.share-qr-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }

.share-qr-caption {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  max-width: 250px;
  line-height: 1.4;
}

.share-actions { margin-top: 16px; }

.share-foot {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 10px 6px 0;
}
</style>
