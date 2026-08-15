<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Get paid') }}</h1>

      <!--
        Two things are true at once and the screen has to hold both without
        making the user choose:

          @maria                 what a person hands to another person
          <address>              what a wallet needs in order to send

        They reach the same place, so the code carries the address (any wallet
        can scan it) and the rows say plainly where each form works.
      -->
      <template v-if="payAddress">
        <div class="pay-qr-wrap">
          <div class="pay-qr">
            <vue-qrcode :value="payAddress" :options="qrOptions" class="pay-qr-canvas" />
          </div>
          <div class="pay-qr-caption">{{ $t('Anyone can scan this to send you Bitcoin') }}</div>
        </div>

        <IdentityGroup class="pay-block" :footer="reachFooter">
          <IdentityRow
            v-if="username"
            icon="tabler:at"
            tone="accent"
            :label="'@' + username"
            :caption="$t('In BuhoGO and other Nostr apps')"
            :chip="copied === 'name' ? $t('Copied') : $t('Copy')"
            :chip-tone="copied === 'name' ? 'ok' : 'mute'"
            :chevron="false"
            @click="copy(usernameAddress, 'name')"
          />
          <IdentityRow
            icon="tabler:wallet"
            :label="payAddressShown"
            :caption="$t('In any Bitcoin wallet')"
            mono-label
            :chip="copied === 'address' ? $t('Copied') : $t('Copy')"
            :chip-tone="copied === 'address' ? 'ok' : 'mute'"
            :chevron="false"
            @click="copy(payAddress, 'address')"
          />
        </IdentityGroup>

        <button type="button" class="btn-primary" @click="shareAddress">
          <Icon icon="tabler:share-2" width="17" height="17" />
          {{ $t('Share this') }}
        </button>

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

        <IdentityGroup
          v-if="!usingBucket"
          :title="$t('Your own address')"
          :footer="$t('Payments go straight to that wallet. Remove it and BuhoGO goes back to receiving for you.')"
        >
          <IdentityRow
            icon="tabler:pencil"
            :label="$t('Change or remove it')"
            @click="openEditor"
          />
        </IdentityGroup>

        <IdentityGroup v-else :title="$t('If you prefer another wallet')">
          <IdentityRow
            icon="tabler:pencil"
            :label="$t('Use an address from another wallet')"
            :caption="$t('Payments then skip the bucket')"
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


    username() {
      return this.identity.nip05ActiveEntry?.handle || '';
    },

    /** The full form of the username, which is what a copy has to hand over. */
    usernameAddress() {
      return this.profile.nip05 || this.identity.nip05Address || '';
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

    reachFooter() {
      return this.username
        ? this.$t('Both reach the same place. Give people your name, and the long one only when an app asks for an address.')
        : this.$t('Give this to anyone who wants to pay you.');
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
    async shareAddress() {
      if (!this.payAddress) return;

      const result = await shareContent({ title: this.$t('Get paid'), text: this.payAddress });
      if (result.success || result.reason === 'cancelled') return;

      if (result.reason === 'unsupported') {
        await this.copy(this.payAddress, 'address');
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
  max-width: 250px;
  line-height: 1.4;
}

.pay-block { margin-top: 16px; }

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
