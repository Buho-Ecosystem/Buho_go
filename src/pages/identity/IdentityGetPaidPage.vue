<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Get paid') }}</h1>

      <!--
        There is exactly one thing to give a person, and this screen has to
        make that obvious.

        Underneath there are three strings: a name (@maria), an address
        (maria@…), and a link. Shown as peers they read as three ways to be
        paid and the user has to work out which one their friend needs, which
        is the complaint this screen exists to answer. Only one of them works
        for everyone regardless of what app they have, and that is the link,
        so the link is the offer and the rest is demoted.

        In person the code is faster than any of them, so the code leads and
        the link is the primary button under it. The raw address stays on
        screen, last and labelled, because some apps do ask you to paste one
        and hunting for it would be worse than seeing it.
      -->
      <template v-if="payAddress">
        <div class="pay-qr-wrap">
          <div class="pay-qr">
            <vue-qrcode :value="payQrValue" :options="qrOptions" class="pay-qr-canvas" />
          </div>
          <div class="pay-qr-caption">{{ $t('Show this to get paid in person') }}</div>
        </div>

        <button type="button" class="btn-primary" @click="shareLink">
          <Icon icon="tabler:share-2" width="17" height="17" />
          {{ $t('Send my link') }}
        </button>
        <p class="pay-link">{{ shareUrlDisplay }}</p>
        <p class="id-foot">
          {{ $t('Send this to anyone, anywhere. It works whether or not they have BuhoGO.') }}
        </p>

        <!--
          Where the money actually lands. Shown when payments route through the
          identity's own bucket, which is the default, and also whenever the
          bucket still holds something after the user has moved on to their own
          address. Hidden entirely for someone using their own wallet address
          with an empty bucket, because then it is not part of their story.
        -->
        <IdentityGroup
          v-if="usingBucket || bucket.hasBalance"
          :title="$t('Where it lands')"
          :footer="bucketFooter"
        >
          <IdentityRow
            data-audit="identity-bucket"
            icon="tabler:inbox"
            :tone="bucket.hasBalance ? 'accent' : 'neutral'"
            :label="$t('Social Bucket')"
            :caption="bucketCaption"
            :chip="bucket.hasBalance ? $t('Move') : ''"
            chip-tone="ok"
            @click="showBucket = true"
          />
        </IdentityGroup>

        <!--
          Last, and deliberately so. This is the one string an app might ask
          the user to type, and the footer names it with the words they will
          have been shown by that app, since "Lightning address" is not our
          word but it is the word on the other screen.
        -->
        <IdentityGroup
          :title="$t('If an app asks for an address')"
          :footer="addressFooter"
        >
          <IdentityRow
            icon="tabler:wallet"
            :label="payAddressShown"
            mono-label
            :chip="copied === 'address' ? $t('Copied') : $t('Copy')"
            :chip-tone="copied === 'address' ? 'ok' : 'mute'"
            :chevron="false"
            @click="copy(payAddress, 'address')"
          />
          <IdentityRow
            data-audit="identity-own-address"
            icon="tabler:pencil"
            :label="usingBucket ? $t('Use my own wallet instead') : $t('Change or remove it')"
            :caption="usingBucket ? $t('Payments then skip the bucket') : ''"
            @click="openEditor"
          />
        </IdentityGroup>
      </template>

      <!--
        No address at all. Since every identity is given one, this means the
        setup step has not finished or could not reach the network, so it says
        that rather than blaming the user for not having one.
      -->
      <div v-else class="pay-empty">
        <span class="pay-empty-mark"><q-spinner size="26px" /></span>
        <h2 class="pay-empty-title">{{ $t('Setting up your address') }}</h2>
        <p class="pay-empty-body">
          {{ $t('BuhoGO is giving your name somewhere to receive. This needs a connection and finishes on its own.') }}
        </p>
        <button type="button" class="btn-primary" @click="openEditor">
          <Icon icon="tabler:plus" width="17" height="17" />
          {{ $t('Use my own address instead') }}
        </button>
      </div>
    </div>

    <!-- One field, one warning. A short focused task, which is what a sheet
         is for. -->
    <q-dialog v-model="showEditor" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="identity-surface other-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <div class="sheet-grab" aria-hidden="true"><span></span></div>
        <div class="sheet-head">
          <div class="sheet-title">{{ $t('Your own address') }}</div>
          <q-btn flat round class="sheet-close" :aria-label="$t('Close')" @click="showEditor = false">
            <Icon icon="tabler:x" width="18" height="18" />
          </q-btn>
        </div>
        <div class="sheet-body">
          <label class="field">
            <span class="field-label">{{ $t('Lightning address') }}</span>
            <input
              v-model="editorInput"
              type="text"
              class="field-input"
              :class="{ 'field-input--error': editorError }"
              placeholder="you@your-wallet.com"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="none"
              inputmode="email"
              maxlength="200"
            />
            <span v-if="editorError" class="field-error">{{ editorError }}</span>
            <span v-else class="field-help">
              {{ $t('Copy it from the wallet you want to be paid in.') }}
            </span>
          </label>

          <div class="sheet-warn">
            <Icon icon="tabler:info-circle" width="17" height="17" />
            <span>{{ $t('Payments then arrive in that wallet instead of your bucket. If it is not one of your BuhoGO wallets, your balance here will not change.') }}</span>
          </div>

          <button type="button" class="btn-primary" :disabled="profile.isPublishing" @click="saveAddress">
            <q-spinner v-if="profile.isPublishing" size="18px" />
            <span>{{ $t('Save') }}</span>
          </button>
          <button
            v-if="!usingBucket"
            type="button"
            class="btn-quiet"
            :disabled="profile.isPublishing"
            @click="clearAddress"
          >
            {{ $t('Go back to my bucket') }}
          </button>
        </div>
      </q-card>
    </q-dialog>

    <SocialBucketSheet v-model="showBucket" />

  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import IdentityNav from '../../components/identity/IdentityNav.vue';
import { identityBack } from '../../composables/useIdentityBack';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import SocialBucketSheet from '../../components/identity/SocialBucketSheet.vue';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';
import { useSocialBucketStore } from '../../stores/socialBucket';
import { npubCashAddress, isNpubCashAddress } from '../../services/npubCash.js';
import { buildProfileLink } from '../../utils/profileLink.js';
import { getQrOptionsWithSize } from '../../utils/qrConfig.js';
import { shareContent } from '../../utils/share.js';
import { isLightningAddress } from '../../utils/addressUtils.js';

export default {
  name: 'IdentityGetPaidPage',

  components: {
    Icon,
    VueQrcode,
    IdentityNav,
    IdentityGroup,
    IdentityRow,
    SocialBucketSheet,
  },

  setup() {
    return {
      identity: useIdentityStore(),
      profile: useProfileStore(),
      bucket: useSocialBucketStore(),
    };
  },

  data() {
    return {
      copied: '',
      showEditor: false,
      showBucket: false,
      editorInput: '',
      editorError: '',
      _copyTimer: null,
    };
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, '/identity/manage'); },




    /**
     * The one thing to give a person. It resolves for someone with a Bitcoin
     * wallet, someone with only a browser, and someone who has never heard of
     * BuhoGO, which is the only string on this screen that can say that.
     */
    shareUrl() {
      return buildProfileLink({
        username: this.identity.nip05ActiveEntry?.handle,
        nip05: this.profile.nip05 || this.identity.nip05Address,
        npub: this.identity.nostrNpub,
      });
    },

    /** The readable half. The key rides along in the query and is machinery. */
    shareUrlDisplay() {
      return this.shareUrl.replace(/^https:\/\//, '').split('?')[0];
    },

    /**
     * What the code carries.
     *
     * `lightning:` is what turns the code from plain text into something the
     * operating system routes: a phone camera offers the installed wallets
     * instead of offering to web-search the address. Every wallet unwraps the
     * scheme, so nothing that could read the bare address stops working.
     */
    payQrValue() {
      return this.payAddress ? `lightning:${this.payAddress}` : '';
    },

    /** What any wallet can actually send to. */
    payAddress() {
      return this.profile.lud16 || '';
    },

    /** True while payments route through the identity's own bucket. */
    /**
     * The address as it is read, not as it is sent.
     *
     * A bucket address is the npub plus a domain, seventy characters that
     * wrap to three lines and tell the reader nothing. Nobody types this one:
     * it is scanned, copied or shared, and all three carry the real value.
     * Their own address is short enough to show whole.
     */
    payAddressShown() {
      const value = this.payAddress;
      if (value.length <= 30) return value;
      const [local, domain] = value.split('@');
      if (!domain) return `${value.slice(0, 12)}…${value.slice(-6)}`;
      return `${local.slice(0, 8)}…${local.slice(-5)}@${domain}`;
    },

    usingBucket() {
      return isNpubCashAddress(this.payAddress);
    },

    /**
     * Names the term the user will have been shown by whatever app sent them
     * looking. "Lightning address" is not a word this surface uses, but it is
     * the word on the other screen, and refusing to say it once here would
     * leave someone unable to match the two.
     */
    addressFooter() {
      return this.usingBucket
        ? this.$t('Some apps ask for a "Lightning address". This is yours. You never have to remember it: send your link instead.')
        : this.$t('Payments go straight to that wallet. Remove it and BuhoGO receives for you again.');
    },

    bucketCaption() {
      if (this.bucket.isSyncing && !this.bucket.hasBalance) return this.$t('Checking');
      if (!this.bucket.hasBalance) return this.$t('Nothing waiting');
      return this.$t('{n} sats waiting', { n: this.formatSats(this.bucket.balanceSats) });
    },

    bucketFooter() {
      return this.usingBucket
        ? this.$t('Payments to your name arrive here, then you move them to one of your wallets.')
        : this.$t('Money that arrived before you set your own address is still here.');
    },

    qrOptions() {
      return getQrOptionsWithSize(172);
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.profile.hydrate();
    await this.bucket.hydrate();

    // Adopting the address is a boot step, but a user can land here in the few
    // seconds before it finishes, or after it failed offline. Asking again
    // costs nothing and turns a confusing empty screen into a working one.
    if (!this.payAddress && this.identity.nostrNpub) {
      const address = npubCashAddress(this.identity.nostrNpub);
      if (address) {
        const changed = this.profile.adoptBucketAddress(address, {
          isBucketAddress: isNpubCashAddress,
        });
        if (changed) this.profile.publish().catch(() => {});
      }
    }

    this.bucket.sync({ identityStore: this.identity });
  },

  beforeUnmount() {
    if (this._copyTimer) clearTimeout(this._copyTimer);
  },

  methods: {
    formatSats(n) {
      return new Intl.NumberFormat().format(Math.max(0, Math.floor(n || 0)));
    },

    async copy(value, which) {
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        this.copied = which;
        if (this._copyTimer) clearTimeout(this._copyTimer);
        this._copyTimer = setTimeout(() => { this.copied = ''; }, 1600);
      } catch {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't copy"), timeout: 1800, position: 'top' });
      }
    },

    /**
     * `shareContent` reports failure through its return value rather than by
     * throwing, so an unhandled result reads as a dead button on every device
     * without a share menu.
     */
    async shareLink() {
      if (!this.shareUrl) return;

      const result = await shareContent({ title: this.$t('Get paid'), text: this.shareUrl });
      if (result.success || result.reason === 'cancelled') return;

      if (result.reason === 'unsupported') {
        await this.copy(this.shareUrl, 'link');
        this.$q.notify({
          type: 'positive',
          message: this.$t('Copied'),
          caption: this.$t('This device has no share menu, so we copied it instead.'),
          timeout: 3000,
        });
        return;
      }

      console.warn('[identity-get-paid] share failed:', result.error);
      this.$q.notify({ type: 'negative', message: this.$t("Couldn't share"), timeout: 2500 });
    },

    openEditor() {
      this.editorInput = this.usingBucket ? '' : this.payAddress;
      this.editorError = '';
      this.showEditor = true;
    },

    async saveAddress() {
      const value = this.editorInput.trim().toLowerCase();
      if (!value) {
        this.editorError = this.$t('Enter an address, or go back to your bucket.');
        return;
      }
      if (!isLightningAddress(value)) {
        this.editorError = this.$t('That does not look like an address yet. It should read like an email address.');
        return;
      }
      this.editorError = '';
      await this.persist(value, this.$t('Payments now go to your own wallet'));
    },

    /** Back to the bucket: clear the field and let the identity receive again. */
    async clearAddress() {
      const address = npubCashAddress(this.identity.nostrNpub);
      await this.persist(address, this.$t('Payments come back to your bucket'));
    },

    /**
     * Publishing is what makes any of this work: the address only becomes
     * reachable once it is on the published profile, so a save that did not
     * reach the network has not finished the job and has to say so.
     */
    async persist(value, successMessage) {
      this.profile.setField('lud16', value);
      let result = null;
      try {
        result = await this.profile.publish();
      } catch (err) {
        console.warn('[identity-get-paid] publish failed:', err);
      }
      this.showEditor = false;

      if (result && result.ok) {
        this.$q.notify({ type: 'positive', message: successMessage, timeout: 2500 });
        return;
      }

      this.$q.notify({
        type: 'warning',
        message: this.$t('Saved on this phone'),
        caption: this.$t('Paying you by name will start working once BuhoGO can reach the network.'),
        timeout: 4000,
      });
    },
  },
};
</script>

<style scoped>

.pay-qr-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 13px;
  padding: 4px 0 2px;
}

.pay-qr {
  width: 192px;
  height: 192px;
  border-radius: var(--radius-lg);
  background: #fff;
  padding: 10px;
  box-shadow: 0 16px 34px -22px rgba(0, 0, 0, 0.55);
}

.pay-qr :deep(img),
.pay-qr :deep(canvas),
.pay-qr-canvas { width: 100%; height: 100%; display: block; }

.pay-qr-caption {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  max-width: 300px;
  line-height: 1.4;
}

.pay-block { margin-top: 16px; }

/* The link under its own button: concrete enough to recognise, quiet enough
   not to compete with the button that sends it. */
.pay-link {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--text-secondary);
  text-align: center;
  margin: 10px 0 0;
  word-break: break-all;
}

.pay-empty { text-align: center; padding: 10px 6px 4px; }

.pay-empty-mark {
  width: 66px;
  height: 66px;
  border-radius: var(--radius-lg);
  background: var(--bg-input);
  color: var(--text-secondary);
  display: grid;
  place-items: center;
  margin: 0 auto 16px;
}

.pay-empty-title {
  font-size: 21px;
  font-weight: 750;
  letter-spacing: -0.028em;
  line-height: 1.2;
  color: var(--text-primary);
  margin: 0 0 8px;
}

.pay-empty-body {
  font-size: 14.5px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 6px;
}

/* Sheet */
.other-sheet {
  width: 100%;
  max-width: 520px;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}

.sheet-warn {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 13px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.sheet-warn svg { margin-top: 1px; flex: 0 0 auto; color: var(--text-muted); }
</style>
