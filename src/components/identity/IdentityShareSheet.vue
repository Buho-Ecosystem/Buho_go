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
    <q-card class="identity-surface share-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-grab" aria-hidden="true"><span></span></div>

      <div class="sheet-head">
        <div class="sheet-title">{{ $t('Share your card') }}</div>
        <q-btn flat round class="sheet-close" :aria-label="$t('Close')" @click="open = false">
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
          <!-- Same QR as the card's back, so it says the same thing. It
               used to promise a payment unconditionally, including for cards
               with nothing to pay to. -->
          <div class="share-qr-caption">{{ qrCaption }}</div>
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

        <p v-if="shareUrl" class="share-foot">
          {{ $t('Your link opens a page with your name, your photo and a way to pay you, even for someone who does not have BuhoGO yet.') }}
          <span class="share-url">{{ shareUrlDisplay }}</span>
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
import { buildProfileLink } from '../../utils/profileLink.js';

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

    /**
     * The same code as the back of the card, and the same job: scanning it
     * saves the person. Payment has its own screen and its own code.
     */
    qrCaption() {
      return this.$t('Someone can scan this to save you as a contact');
    },

    /**
     * What gets sent or copied.
     *
     * Deliberately NOT the `nostr:` URI: whoever opens a shared link most
     * likely has no BuhoGO and no Nostr client, and a custom scheme is a
     * dead end for them as well as being rejected by some share targets.
     * This points at BuhoGO's own profile page, which can show the card,
     * take a payment, and offer the app. Prefers the username, so the link
     * reads as something a person could say out loud.
     */
    shareUrl() {
      return buildProfileLink({
        username: this.identity.nip05ActiveEntry?.handle,
        nip05: this.profile.nip05 || this.identity.nip05Address,
        npub: this.npub,
      });
    },

    /**
     * The readable half of the link, for showing in the sheet. The key that
     * rides along as a fallback is machinery: it doubles the length, it is
     * not something anyone reads, and putting it on screen would make the
     * link look far more complicated than it is. What gets copied and shared
     * is always the whole thing.
     */
    shareUrlDisplay() {
      return this.shareUrl.replace(/^https:\/\//, '').split('?')[0];
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
      if (!this.shareUrl) return;
      try {
        await navigator.clipboard.writeText(this.shareUrl);
        this.copied = true;
        if (this._copyTimer) clearTimeout(this._copyTimer);
        this._copyTimer = setTimeout(() => { this.copied = false; }, 1600);
      } catch {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't copy"), timeout: 1800, position: 'top' });
      }
    },

    /**
     * `shareContent` resolves with a result instead of throwing, so an
     * ignored return value looks exactly like a dead button: every desktop
     * browser and a few WebViews have no share sheet at all and come back
     * with `unsupported`. Each outcome gets an answer, and the one that
     * cannot be fixed here falls back to the clipboard so the user still
     * leaves with their link.
     */
    async onShare() {
      if (!this.shareUrl) return;

      const result = await shareContent({
        title: this.profileName,
        text: this.$t('Add me on BuhoGO'),
        url: this.shareUrl,
      });

      if (result.success || result.reason === 'cancelled') return;

      if (result.reason === 'unsupported') {
        await this.onCopy();
        this.$q.notify({
          type: 'positive',
          message: this.$t('Link copied'),
          caption: this.$t('This device has no share menu, so we copied it instead.'),
          timeout: 3000,
        });
        return;
      }

      console.warn('[identity-share] share failed:', result.error);
      this.$q.notify({ type: 'negative', message: this.$t("Couldn't share"), timeout: 2500 });
    },
  },
};
</script>

<style scoped>
.share-sheet {
  width: 100%;
  max-width: 520px;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}

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
  border-radius: var(--radius-lg);
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
  border-radius: var(--radius-ms);
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

.share-url {
  display: block;
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-secondary);
  word-break: break-all;
}
</style>
