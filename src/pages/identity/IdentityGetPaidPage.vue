<template>
  <q-page class="id-sub-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="backLabel" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Get paid') }}</h1>

      <!--
        The relationship this screen has to teach, in the user's terms:

          username  is how people find you
          address   is where the money lands

        Your username points at your address. Until an address exists, the
        username cannot be paid at all: the send path resolves a name to a
        profile and then to its `lud16`, and gives up when that is empty. An
        earlier draft of this screen showed the username itself as "your
        payment address", which was wrong in the most expensive way a wallet
        can be wrong.
      -->
      <template v-if="lud16">
        <div class="pay-qr-wrap">
          <div class="pay-qr">
            <vue-qrcode v-if="lud16" :value="lud16" :options="qrOptions" class="pay-qr-canvas" />
          </div>
          <div class="pay-qr-caption">{{ $t('Anyone can scan this to send you Bitcoin') }}</div>
        </div>

        <IdentityGroup class="pay-block" :footer="landingFooter">
          <IdentityRow
            icon="tabler:arrow-bar-to-down"
            tone="accent"
            :label="lud16"
            :caption="landingCaption"
            mono
            :chip="copied ? $t('Copied') : $t('Copy')"
            :chip-tone="copied ? 'ok' : 'mute'"
            :chevron="false"
            @click="copyAddress"
          />
          <IdentityRow
            icon="tabler:pencil"
            :label="$t('Change where money lands')"
            @click="openEditor"
          />
        </IdentityGroup>

        <button type="button" class="btn-primary" @click="shareAddress">
          <Icon icon="tabler:share-2" width="17" height="17" />
          {{ $t('Share this') }}
        </button>

        <IdentityGroup
          :title="$t('By name')"
          :footer="$t('Your username points at the address above. Change the address and your username follows it, so the name you hand out never has to change.')"
        >
          <IdentityRow
            icon="tabler:at"
            :label="username ? '@' + username : $t('Being reserved')"
            :caption="$t('People can pay you with this too')"
            :chevron="false"
            :interactive="false"
          />
        </IdentityGroup>
      </template>

      <!--
        No address yet. This is the common case: Spark wallets do not have a
        Lightning address, so most people have to bring one from a wallet
        they already use. The screen's whole job here is to say why it
        matters and take the value.
      -->
      <template v-else>
        <div class="pay-empty">
          <span class="pay-empty-mark"><Icon icon="tabler:arrow-bar-to-down" width="30" height="30" /></span>
          <h2 class="pay-empty-title">{{ $t('Nobody can pay you yet') }}</h2>
          <p class="pay-empty-body">
            {{ $t('Your username is how people find you. A Lightning address is where the money lands. You need both, and BuhoGO cannot invent the second one for you.') }}
          </p>
        </div>

        <IdentityGroup
          v-if="walletAddress"
          :title="$t('From a wallet you already use here')"
          :footer="$t('Money would arrive in that wallet, which is already connected to BuhoGO.')"
        >
          <IdentityRow
            icon="tabler:wallet"
            tone="accent"
            :label="walletAddress"
            :caption="$t('From {wallet}', { wallet: walletName })"
            mono
            :chip="$t('Use this')"
            chip-tone="ok"
            :chevron="false"
            @click="useWalletAddress"
          />
        </IdentityGroup>

        <button type="button" class="btn-primary" @click="openEditor">
          <Icon icon="tabler:plus" width="17" height="17" />
          {{ $t('Add a Lightning address') }}
        </button>

        <p class="id-foot">
          {{ $t('Most Bitcoin wallets give you one. It looks like an email address, for example you{\'@\'}your-wallet.com.') }}
        </p>

        <IdentityGroup :title="$t('Your username')" :footer="$t('It works for finding you and for saving you as a contact today. Paying by name starts working the moment you add an address.')">
          <IdentityRow
            icon="tabler:at"
            :label="username ? '@' + username : $t('Being reserved')"
            :interactive="false"
          />
        </IdentityGroup>
      </template>
    </div>

    <!-- One field, one warning, nothing else. A short focused task, which is
         what a sheet is for. -->
    <q-dialog v-model="showEditor" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="other-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <div class="sheet-grab" aria-hidden="true"><span></span></div>
        <div class="sheet-head">
          <div class="sheet-title">{{ $t('Where should money land?') }}</div>
          <q-btn flat round dense :aria-label="$t('Close')" @click="showEditor = false">
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
            <span>{{ $t('Money sent to this address arrives in that wallet. If it is not one of your BuhoGO wallets, your balance here will not change.') }}</span>
          </div>

          <button type="button" class="btn-primary" :disabled="profile.isPublishing" @click="saveAddress">
            <q-spinner v-if="profile.isPublishing" size="18px" />
            <span>{{ $t('Save') }}</span>
          </button>
          <button
            v-if="lud16"
            type="button"
            class="btn-quiet"
            :disabled="profile.isPublishing"
            @click="clearAddress"
          >
            {{ $t('Remove it') }}
          </button>
        </div>
      </q-card>
    </q-dialog>

    <SettingsHubNav />
  </q-page>
</template>

<script>
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import IdentityNav from '../../components/identity/IdentityNav.vue';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';
import { useWalletStore } from '../../stores/wallet';
import { getQrOptionsWithSize } from '../../utils/qrConfig.js';
import { shareContent } from '../../utils/share.js';

/** local@domain.tld, the shape every Lightning address takes. */
const ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  name: 'IdentityGetPaidPage',

  components: { Icon, VueQrcode, SettingsHubNav, IdentityNav, IdentityGroup, IdentityRow },

  setup() {
    return {
      identity: useIdentityStore(),
      profile: useProfileStore(),
      walletStore: useWalletStore(),
    };
  },

  data() {
    return {
      copied: false,
      showEditor: false,
      editorInput: '',
      editorError: '',
      _copyTimer: null,
    };
  },

  computed: {
    backLabel() {
      const from = this.$router.options.history.state?.back;
      return from === '/identity/manage' ? this.$t('Manage') : this.$t('You');
    },

    /** The username. Identity, not payment. */
    username() {
      return this.identity.nip05ActiveEntry?.handle || '';
    },

    /** The payment destination. Everything on this screen hangs off it. */
    lud16() {
      return this.profile.lud16 || '';
    },

    /**
     * A Lightning address belonging to a wallet already connected here, so
     * the common case becomes one tap instead of a copy from another app.
     * Spark returns null by design, which is exactly why the manual path
     * has to be first class.
     */
    walletAddress() {
      return this.walletStore.activeWalletLightningAddress || '';
    },

    walletName() {
      const active = this.walletStore.wallets.find((w) => w.id === this.walletStore.activeWalletId);
      return active?.name || this.$t('your wallet');
    },

    /** True when the published address is one of the wallets in this app. */
    landsHere() {
      return !!this.lud16 && this.lud16.toLowerCase() === this.walletAddress.toLowerCase();
    },

    landingCaption() {
      return this.landsHere
        ? this.$t('Money arrives in {wallet}', { wallet: this.walletName })
        : this.$t('Money arrives in that wallet');
    },

    landingFooter() {
      return this.landsHere
        ? this.$t('This is one of your BuhoGO wallets, so payments show up in your balance here.')
        : this.$t('This address belongs to another app, so payments arrive there and your BuhoGO balance does not change.');
    },

    qrOptions() {
      return getQrOptionsWithSize(172);
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.profile.hydrate();
    // The wallet's own address is one of the two ways to fill this in.
    if (!this.walletStore.isInitialized) {
      await this.walletStore.initialize().catch(() => {});
    }
  },

  beforeUnmount() {
    if (this._copyTimer) clearTimeout(this._copyTimer);
  },

  methods: {
    async copyAddress() {
      if (!this.lud16) return;
      try {
        await navigator.clipboard.writeText(this.lud16);
        this.copied = true;
        if (this._copyTimer) clearTimeout(this._copyTimer);
        this._copyTimer = setTimeout(() => { this.copied = false; }, 1600);
      } catch {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't copy"), timeout: 1800, position: 'top' });
      }
    },

    /**
     * `shareContent` reports failure through its return value rather than by
     * throwing, so an unhandled result reads as a dead button on every
     * device without a share menu.
     */
    async shareAddress() {
      if (!this.lud16) return;

      const result = await shareContent({ title: this.$t('Get paid'), text: this.lud16 });
      if (result.success || result.reason === 'cancelled') return;

      if (result.reason === 'unsupported') {
        await this.copyAddress();
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
      this.editorInput = this.lud16;
      this.editorError = '';
      this.showEditor = true;
    },

    useWalletAddress() {
      this.editorInput = this.walletAddress;
      this.editorError = '';
      this.saveAddress();
    },

    async saveAddress() {
      const value = this.editorInput.trim().toLowerCase();
      if (!value) {
        this.editorError = this.$t('Enter an address, or remove the one you have.');
        return;
      }
      if (!ADDRESS_RE.test(value)) {
        this.editorError = this.$t('That does not look like an address yet. It should read like an email address.');
        return;
      }
      this.editorError = '';
      await this.persist(value, this.$t('People can pay you now'));
    },

    async clearAddress() {
      await this.persist('', this.$t('Address removed'));
    },

    /**
     * Publishing is what makes the username work: the address only becomes
     * reachable by name once it is on the published card, so a save that
     * does not reach the relays has not finished the job and has to say so.
     */
    async persist(value, successMessage) {
      this.profile.setField('lud16', value);
      const result = await this.profile.publish();
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
.id-sub-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: 'Manrope', sans-serif;
  overflow-x: hidden;
  max-width: 100vw;
  padding-top: var(--safe-top, 0px);
}

.id-sub-body {
  flex: 1 1 auto;
  padding: 0 16px calc(104px + var(--safe-bottom, 0px));
  max-width: 720px;
  width: 100%;
  margin: 0 auto;
}

.id-large-title {
  font-size: 30px;
  font-weight: 770;
  letter-spacing: -0.035em;
  line-height: 1.12;
  color: var(--text-primary);
  margin: 2px 2px 14px;
}

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
  border-radius: 20px;
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

/* Empty state. Not an illustration and not a warning: a short explanation
   of the one thing that is missing, then the control that fixes it. */
.pay-empty { text-align: center; padding: 10px 6px 4px; }

.pay-empty-mark {
  width: 66px;
  height: 66px;
  border-radius: 22px;
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

.btn-primary,
.btn-quiet {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  font-family: 'Manrope', sans-serif;
  font-size: 15.5px;
  font-weight: 650;
  padding: 15px 18px;
  border-radius: 15px;
  min-height: 52px;
  margin-top: 16px;
  border: 0;
  cursor: pointer;
}

.btn-primary { background: var(--btn-neutral-bg); color: var(--btn-neutral-fg); }
.btn-primary:disabled { opacity: 0.45; cursor: default; }
.btn-quiet { background: transparent; color: var(--color-red); margin-top: 6px; }

.id-foot {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 10px 6px 0;
}

/* Sheet */
.other-sheet {
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

.sheet-head { display: flex; align-items: center; gap: 8px; padding: 8px 14px 4px; }

.sheet-title {
  flex: 1;
  padding-left: 4px;
  font-size: 17px;
  font-weight: 720;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.sheet-body { padding: 8px 16px 20px; }

.field { display: block; margin-bottom: 16px; }

.field-label {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0 0 6px 3px;
}

.field-input {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  border-radius: 13px;
  padding: 14px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  color: var(--text-primary);
  min-height: 50px;
}

.field-input--error { border-color: var(--color-red); }

.field-help,
.field-error {
  display: block;
  font-size: 12px;
  margin: 7px 3px 0;
  line-height: 1.45;
}

.field-help { color: var(--text-muted); }
.field-error { color: var(--color-red); }

.sheet-warn {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 13px;
  border-radius: 14px;
  background: var(--bg-input);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.sheet-warn svg { margin-top: 1px; flex: 0 0 auto; color: var(--text-muted); }
</style>
