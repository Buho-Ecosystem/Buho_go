<template>
  <q-page class="id-sub-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t('You')" to="/identity" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Get paid') }}</h1>

      <!--
        The verb people came for. It used to be spread over a hero chip, a
        13px icon, a switcher sheet and a field hidden inside an editor.
        One screen: the code, the address under it, one share button.
      -->
      <div class="pay-qr-wrap">
        <div class="pay-qr">
          <vue-qrcode v-if="qrValue" :value="qrValue" :options="qrOptions" class="pay-qr-canvas" />
          <div v-else class="pay-qr-empty"><q-spinner size="24px" color="grey-7" /></div>
        </div>
        <div class="pay-qr-caption">{{ $t('Anyone can scan this to send you Bitcoin') }}</div>
      </div>

      <IdentityGroup
        class="pay-block"
        :footer="$t('This is your username written in full. Other apps need the whole thing, so this is the one place BuhoGO shows it.')"
      >
        <IdentityRow
          icon="tabler:at"
          tone="accent"
          :label="payAddress || $t('Being reserved')"
          :caption="$t('Money arrives in BuhoGO')"
          mono
          :chip="copied ? $t('Copied') : $t('Copy')"
          :chip-tone="copied ? 'ok' : 'mute'"
          :chevron="false"
          @click="copyAddress"
        />
      </IdentityGroup>

      <button type="button" class="btn-primary" :disabled="!payAddress" @click="shareAddress">
        <Icon icon="tabler:share-2" width="17" height="17" />
        {{ $t('Share this') }}
      </button>

      <!--
        An address from another wallet is an option, not a peer of the Buho
        username and not a setup step, so it is demoted to its own section
        with the one warning it has always needed.
      -->
      <IdentityGroup
        :title="$t('If you use another wallet')"
        :footer="$t('People will see that address on your card instead. Money sent to it lands in that wallet, not in BuhoGO.')"
      >
        <IdentityRow
          icon="tabler:wallet"
          :label="lud16 ? $t('Address from another wallet') : $t('Add an address from another wallet')"
          :caption="lud16 || $t('Optional')"
          :mono="!!lud16"
          @click="openOther"
        />
      </IdentityGroup>
    </div>

    <!-- Editing the outside address. A short focused task, so a sheet is the
         right container: it is one field and it never opens anything else. -->
    <q-dialog v-model="showOther" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
      <q-card class="other-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <div class="sheet-grab" aria-hidden="true"><span></span></div>
        <div class="sheet-head">
          <div class="sheet-title">{{ $t('Another wallet') }}</div>
          <q-btn flat round dense :aria-label="$t('Close')" @click="showOther = false">
            <Icon icon="tabler:x" width="18" height="18" />
          </q-btn>
        </div>
        <div class="sheet-body">
          <p class="sheet-lede">
            {{ $t('If another app already gives you an address people can pay, put it here and your card will show it.') }}
          </p>
          <label class="field">
            <span class="field-label">{{ $t('Address') }}</span>
            <input
              v-model="otherInput"
              type="text"
              class="field-input"
              :class="{ 'field-input--error': otherError }"
              placeholder="you@another-wallet.com"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="none"
              maxlength="200"
            />
            <span v-if="otherError" class="field-error">{{ otherError }}</span>
            <span v-else class="field-help">
              {{ $t('Looks like an email address. Leave it empty if you do not have one.') }}
            </span>
          </label>
          <div class="sheet-warn">
            <Icon icon="tabler:alert-triangle" width="17" height="17" />
            <span>{{ $t('Money sent to this address goes to that app, not to BuhoGO. Your balance here will not change.') }}</span>
          </div>
          <button type="button" class="btn-primary" :disabled="profile.isPublishing" @click="saveOther">
            <q-spinner v-if="profile.isPublishing" size="18px" />
            <span>{{ $t('Save') }}</span>
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
import { getQrOptionsWithSize } from '../../utils/qrConfig.js';
import { shareContent } from '../../utils/share.js';

/** Same shape the profile editor validated: local@domain, no spaces. */
const ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default {
  name: 'IdentityGetPaidPage',

  components: { Icon, VueQrcode, SettingsHubNav, IdentityNav, IdentityGroup, IdentityRow },

  setup() {
    return { identity: useIdentityStore(), profile: useProfileStore() };
  },

  data() {
    return {
      copied: false,
      showOther: false,
      otherInput: '',
      otherError: '',
      _copyTimer: null,
    };
  },

  computed: {
    /** The full `name@mybuho.de`, the one place the domain is ever shown. */
    payAddress() {
      return this.profile.nip05 || this.identity.nip05Address || '';
    },

    lud16() {
      return this.profile.lud16 || '';
    },

    /**
     * A bare address rather than a bip21 or lnurl string: any wallet can
     * read it, and it is the same value the row below shows, so the code
     * and the text can never disagree.
     */
    qrValue() {
      return this.payAddress;
    },

    qrOptions() {
      return getQrOptionsWithSize(172);
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.profile.hydrate();
  },

  beforeUnmount() {
    if (this._copyTimer) clearTimeout(this._copyTimer);
  },

  methods: {
    async copyAddress() {
      if (!this.payAddress) return;
      try {
        await navigator.clipboard.writeText(this.payAddress);
        this.copied = true;
        if (this._copyTimer) clearTimeout(this._copyTimer);
        this._copyTimer = setTimeout(() => { this.copied = false; }, 1600);
      } catch {
        this.$q.notify({ type: 'warning', message: this.$t("Couldn't copy"), timeout: 1800, position: 'top' });
      }
    },

    async shareAddress() {
      if (!this.payAddress) return;
      await shareContent({
        title: this.$t('Get paid'),
        text: this.payAddress,
      });
    },

    openOther() {
      this.otherInput = this.lud16;
      this.otherError = '';
      this.showOther = true;
    },

    async saveOther() {
      const value = this.otherInput.trim();
      if (value && !ADDRESS_RE.test(value)) {
        this.otherError = this.$t('That does not look like an address yet. It should read like an email address.');
        return;
      }
      this.otherError = '';
      this.profile.setField('lud16', value);
      const result = await this.profile.publish();
      this.showOther = false;
      if (result && result.ok) {
        this.$q.notify({ type: 'positive', message: this.$t('Saved'), timeout: 2000 });
      }
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
.pay-qr-empty { width: 100%; height: 100%; display: grid; place-items: center; }

.pay-qr-caption {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  max-width: 250px;
  line-height: 1.4;
}

.pay-block { margin-top: 16px; }

.btn-primary {
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
  background: var(--btn-neutral-bg);
  color: var(--btn-neutral-fg);
  border: 0;
  cursor: pointer;
}

.btn-primary:disabled { opacity: 0.45; cursor: default; }

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

.sheet-lede {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 16px;
}

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
  background: rgba(154, 107, 0, 0.10);
  color: #9A6B00;
  font-size: 13px;
  line-height: 1.5;
}

.sheet-warn svg { margin-top: 1px; flex: 0 0 auto; }

body.body--dark .sheet-warn { background: rgba(232, 196, 104, 0.12); color: #E8C468; }
</style>
