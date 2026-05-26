<template>
  <q-dialog
    v-model="open"
    persistent
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @hide="onDialogHidden"
  >
    <q-card
      class="seed-dialog"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Header -->
      <q-card-section class="seed-dialog-header">
        <div
          class="seed-dialog-title"
          :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'"
        >
          {{ headerTitle }}
        </div>
        <q-btn
          flat
          round
          dense
          @click="close"
          :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          :aria-label="$t('Close')"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </q-card-section>

      <!-- Context step -->
      <template v-if="step === 'context'">
        <q-card-section class="seed-step-body context-body">
          <div class="context-illustration-wrap">
            <Icon icon="tabler:fingerprint" width="84" height="84" />
          </div>
          <h2
            class="context-heading"
            :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'"
          >
            {{ $t('Your recovery phrase') }}
          </h2>
          <p
            class="context-lede"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ $t('These 12 words back up your profile and every site you sign in to. Without them you cannot move to a new phone. Anyone who sees them can take over your profile.') }}
          </p>

          <div
            class="seed-callout"
            :class="$q.dark.isActive ? 'seed-callout-dark' : 'seed-callout-light'"
          >
            <div class="seed-callout-icon">
              <Icon icon="tabler:shield-lock" width="18" height="18" />
            </div>
            <div class="seed-callout-body">
              <div class="seed-callout-heading">{{ $t('Keep it offline') }}</div>
              <div class="seed-callout-text">
                {{ $t("Write it on paper. Don't photograph it. Don't save it in cloud notes or a password manager you don't control.") }}
              </div>
            </div>
          </div>
        </q-card-section>

        <q-card-actions class="seed-dialog-actions">
          <q-btn
            unelevated
            no-caps
            class="seed-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="readyLabel"
            :loading="isAuthenticating || isLoadingMnemonic"
            @click="onReady"
          />
        </q-card-actions>
      </template>

      <!-- Auth-explain step (native only, when biometric lock is on) -->
      <template v-else-if="step === 'authExplain'">
        <q-card-section class="seed-step-body context-body">
          <div class="context-illustration-wrap">
            <Icon :icon="isDevicePinOnly ? 'tabler:lock' : 'tabler:fingerprint'" width="84" height="84" />
          </div>
          <h2
            class="context-heading"
            :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'"
          >
            {{ authTitle }}
          </h2>
          <p
            class="context-lede"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ authBody }}
          </p>
          <div
            class="seed-callout"
            :class="$q.dark.isActive ? 'seed-callout-dark' : 'seed-callout-light'"
          >
            <div class="seed-callout-icon">
              <Icon :icon="isDevicePinOnly ? 'tabler:lock' : 'tabler:fingerprint'" width="18" height="18" />
            </div>
            <div class="seed-callout-body">
              <div class="seed-callout-text">{{ authPrivacyText }}</div>
            </div>
          </div>
        </q-card-section>

        <q-card-actions class="seed-dialog-actions seed-dialog-actions--stack">
          <q-btn
            unelevated
            no-caps
            class="seed-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="$t('Continue')"
            :loading="isAuthenticating || isLoadingMnemonic"
            @click="onConfirmAuth"
          />
          <q-btn
            flat
            no-caps
            class="seed-secondary-btn"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
            :label="$t('Cancel')"
            :disable="isAuthenticating || isLoadingMnemonic"
            @click="backToContext"
          />
        </q-card-actions>
      </template>

      <!--
        Phrase reveal step.

        Streamlined layout: the previous standalone countdown bar +
        toggle row + double warning (one inside MnemonicDisplay, one
        outside) collapsed into:
          - one header row above the words grid (auto-hide chip on
            the left when running, Show/Hide toggle on the right)
          - the 12-word grid
          - one short safety line below
        Same information, three blocks instead of five.
      -->
      <template v-else-if="step === 'phrase'">
        <q-card-section class="seed-step-body phrase-body">
          <MnemonicDisplay
            :initial-blurred="phraseBlurred"
            :words="mnemonicWords"
            :allow-blur="true"
            :show-warning="false"
            :show-copy="false"
            @update:blurred="phraseBlurred = $event"
          >
            <template #header>
              <!--
                Countdown chip. Only renders while the words are
                visible AND the timer is running, so the header
                stays empty in idle / blurred states (no nag,
                no redundant "tap to reveal" line — the blurred
                grid + the Show button already convey that).
              -->
              <span
                v-if="countdownRunning"
                class="seed-countdown-chip"
                :class="[
                  $q.dark.isActive ? 'seed-countdown-chip-dark' : 'seed-countdown-chip-light',
                  { 'seed-countdown-chip--expiring': countdownSeconds <= 10 },
                ]"
                role="status"
                aria-live="polite"
              >
                <Icon icon="tabler:clock" width="11" height="11" />
                <span>{{ countdownText }}</span>
              </span>
            </template>
          </MnemonicDisplay>

          <div
            class="seed-warn"
            :class="$q.dark.isActive ? 'seed-warn-dark' : 'seed-warn-light'"
            role="note"
          >
            <Icon icon="tabler:shield" width="14" height="14" />
            <span>{{ $t('Never type these words into a website or save them in cloud notes.') }}</span>
          </div>
        </q-card-section>

        <q-card-actions class="seed-dialog-actions">
          <q-btn
            unelevated
            no-caps
            class="seed-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="mode === 'view' ? $t('Done') : $t('I have it written down')"
            @click="onPhraseContinue"
          />
        </q-card-actions>
      </template>

      <!-- Verify step (backup mode only) -->
      <template v-else-if="step === 'verify'">
        <q-card-section class="seed-step-body verify-body">
          <MnemonicOrderVerify
            :mnemonic="mnemonicWords"
            @verify-success="onVerifySuccess"
            @show-phrase="onBackToPhrase"
          />
        </q-card-section>
      </template>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import MnemonicDisplay from './MnemonicDisplay.vue';
import MnemonicOrderVerify from './MnemonicOrderVerify.vue';
import { useWalletStore } from '../stores/wallet';
import { useIdentityStore } from '../stores/identity';
import { isBiometricAvailable, authenticate } from '../utils/biometric';
import { getBiometricMethodCopy } from '../utils/biometricCopy';

const REVEAL_DURATION_SECONDS = 120;
const COUNTDOWN_TICK_MS = 1000;

export default {
  name: 'IdentitySeedPhraseDialog',

  components: { Icon, MnemonicDisplay, MnemonicOrderVerify },

  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
    /**
     * 'view'   — already backed up. Reveal phrase, close on Done.
     * 'backup' — first-time backup. Reveal then verify ordering.
     */
    mode: {
      type: String,
      required: true,
      validator: v => v === 'view' || v === 'backup',
    },
  },

  emits: ['update:modelValue', 'verified'],

  setup() {
    const walletStore = useWalletStore();
    const identity = useIdentityStore();
    return { walletStore, identity };
  },

  data() {
    return {
      step: 'context',
      mnemonicWords: [],
      isAuthenticating: false,
      isLoadingMnemonic: false,
      phraseBlurred: true,
      countdownSeconds: REVEAL_DURATION_SECONDS,
      countdownInterval: null,
      timerExpired: false,
      authBiometryType: 'none',
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    headerTitle() {
      if (this.step === 'verify') return this.$t('Verify your backup');
      if (this.step === 'phrase') return this.$t('Your recovery phrase');
      if (this.step === 'authExplain') return this.$t('Verify it is you');
      return this.mode === 'backup'
        ? this.$t('Back up your profile')
        : this.$t('View recovery phrase');
    },

    authMethodCopy() {
      return getBiometricMethodCopy(this.authBiometryType, this.$t.bind(this));
    },

    isDevicePinOnly() {
      return this.authMethodCopy.isDevicePinOnly;
    },

    authTitle() {
      if (this.authBiometryType === 'multiple') {
        return this.$t('Verify it is you');
      }
      return `${this.authMethodCopy.methodLabel} ${this.$t('is required')}`;
    },

    authBody() {
      return `${this.authMethodCopy.actionPhrase} ${this.$t('so nobody else can see your recovery phrase, even if they have your unlocked phone.')}`;
    },

    authPrivacyText() {
      if (this.isDevicePinOnly) {
        return this.$t('You are seeing this because no fingerprint or face is set up on this device. Your device lock is used instead.');
      }
      return `${this.$t('Your biometric is processed by your phone, not by BuhoGO. We never see it.')} ${this.$t("Your phone's PIN, pattern, or password also works.")}`;
    },

    countdownText() {
      const total = Math.max(0, this.countdownSeconds);
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    countdownRunning() {
      return this.countdownInterval !== null;
    },

    readyLabel() {
      return this.$t("I'm ready");
    },
  },

  watch: {
    modelValue(isOpen) {
      if (isOpen) {
        this.resetToContext();
      }
    },
    phraseBlurred(isBlurred) {
      if (this.step !== 'phrase') return;
      if (isBlurred) this.stopCountdown();
      else this.startCountdown();
    },
  },

  beforeUnmount() {
    this.stopCountdown();
    this.wipeMnemonic();
  },

  methods: {
    resetToContext() {
      this.step = 'context';
      this.wipeMnemonic();
      this.isAuthenticating = false;
      this.isLoadingMnemonic = false;
      this.phraseBlurred = true;
      this.timerExpired = false;
      this.countdownSeconds = REVEAL_DURATION_SECONDS;
      this.stopCountdown();
      this.authBiometryType = 'none';
    },

    async onReady() {
      if (this.isAuthenticating || this.isLoadingMnemonic) return;

      // Only re-prompt biometrics when App Lock is on. Same gate as
      // SparkSeedPhraseDialog so behavior is consistent.
      if (!this.walletStore.biometricsEnabled) {
        await this.loadMnemonicAndReveal();
        return;
      }

      this.isAuthenticating = true;
      try {
        const { available, biometryType } = await isBiometricAvailable();
        if (!this.modelValue) return;

        if (!available) {
          await this.loadMnemonicAndReveal();
          return;
        }

        this.authBiometryType = biometryType;
        this.step = 'authExplain';
      } finally {
        this.isAuthenticating = false;
      }
    },

    async onConfirmAuth() {
      if (this.isAuthenticating || this.isLoadingMnemonic) return;

      this.isAuthenticating = true;
      try {
        const ok = await authenticate({
          reason: this.$t('Verify it is you to reveal your recovery phrase'),
          title: 'BuhoGO',
          subtitle: this.$t('Recovery phrase'),
          useFallback: true,
        });
        if (!this.modelValue) return;

        if (!ok) {
          this.$q.notify({
            type: 'warning',
            message: this.$t('Verification was not completed'),
            caption: this.$t('Try again, or check that your phone has a screen lock set up.'),
            timeout: 3500,
          });
          return;
        }

        await this.loadMnemonicAndReveal();
      } finally {
        this.isAuthenticating = false;
      }
    },

    backToContext() {
      this.step = 'context';
      this.authBiometryType = 'none';
    },

    async loadMnemonicAndReveal() {
      this.isLoadingMnemonic = true;
      try {
        // Make sure an identity exists before trying to reveal it. For
        // first-time backup, this generates one on the spot.
        await this.identity.ensureIdentity();
        const mnemonic = await this.identity.getMnemonic();

        if (!this.modelValue) {
          // Dialog was dismissed while we were decrypting — drop the
          // mnemonic without letting it touch component state.
          const words = mnemonic.split(' ');
          for (let i = 0; i < words.length; i += 1) words[i] = '';
          return;
        }

        this.mnemonicWords = mnemonic.split(' ');

        this.step = 'phrase';
        this.phraseBlurred = true;
        this.timerExpired = false;
      } catch (error) {
        console.error('Failed to load identity seed phrase', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t("We couldn't show your recovery phrase"),
          caption: this.$t('Please try again.'),
        });
        this.close();
      } finally {
        this.isLoadingMnemonic = false;
      }
    },

    startCountdown() {
      this.stopCountdown();
      this.countdownSeconds = REVEAL_DURATION_SECONDS;
      this.timerExpired = false;
      this.countdownInterval = setInterval(() => {
        this.countdownSeconds -= 1;
        if (this.countdownSeconds <= 0) this.onTimerExpire();
      }, COUNTDOWN_TICK_MS);
    },

    stopCountdown() {
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
    },

    onTimerExpire() {
      this.stopCountdown();
      this.countdownSeconds = 0;
      this.timerExpired = true;
      this.phraseBlurred = true;
    },

    onPhraseContinue() {
      if (this.mode === 'view') {
        this.close();
        return;
      }
      this.step = 'verify';
      this.stopCountdown();
    },

    onBackToPhrase() {
      this.step = 'phrase';
      this.phraseBlurred = true;
      this.timerExpired = false;
      this.countdownSeconds = REVEAL_DURATION_SECONDS;
    },

    async onVerifySuccess() {
      try {
        await this.identity.confirmBackup();
        this.$q.notify({
          type: 'positive',
          message: this.$t('Backup confirmed'),
          caption: this.$t('Your recovery phrase is safe as long as you stored it somewhere secure.'),
        });
        this.$emit('verified');
      } catch (error) {
        console.error('Failed to confirm identity backup', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t("We couldn't save your backup status"),
          caption: this.$t('Please try again.'),
        });
      } finally {
        this.close();
      }
    },

    close() {
      this.open = false;
    },

    async onDialogHidden() {
      this.stopCountdown();
      this.wipeMnemonic();
    },

    wipeMnemonic() {
      for (let i = 0; i < this.mnemonicWords.length; i += 1) {
        this.mnemonicWords[i] = '';
      }
      this.mnemonicWords = [];
    },
  },
};
</script>

<style scoped>
.seed-dialog {
  width: 100%;
  max-width: 460px;
  border-radius: 20px;
  overflow: hidden;
}

.seed-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 8px;
}

.seed-dialog-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

.seed-step-body {
  padding: 12px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.context-body {
  align-items: center;
  text-align: center;
}

.context-illustration-wrap {
  width: 100%;
  display: flex;
  justify-content: center;
  color: #15DE72;
  margin: 4px auto 4px;
}

.context-heading {
  font-family: 'Manrope', sans-serif;
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}

.context-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  margin: 0;
  max-width: 380px;
}

/*
  Auto-hide countdown chip, injected into MnemonicDisplay's
  header slot. Compact, inline-aligned with the toggle on the
  right. Replaces the previous standalone `.phrase-countdown`
  bar which sat above the words and competed for attention.
*/
.seed-countdown-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  transition: background 0.2s ease, color 0.2s ease;
}

.seed-countdown-chip-light {
  background: rgba(15, 23, 42, 0.06);
  color: #475569;
}

.seed-countdown-chip-dark {
  background: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}

.seed-countdown-chip--expiring {
  background: rgba(239, 68, 68, 0.12) !important;
  color: #ef4444 !important;
}

/*
  Compact one-line warning under the words grid. Replaces the
  previous full `.seed-callout` box on this step — the words
  themselves are the focal point now, not a paragraph of safety
  guidance. The fuller "what is this" guidance still lives on
  the context step the user landed on before reaching here.
*/
.seed-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 10px;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.4;
}

.seed-warn-light {
  background: rgba(239, 68, 68, 0.06);
  color: #b91c1c;
}

.seed-warn-dark {
  background: rgba(239, 68, 68, 0.10);
  color: #fca5a5;
}

.seed-callout {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  border-left: 2px solid #15DE72;
  font-family: 'Manrope', sans-serif;
}

.seed-callout-light {
  background: rgba(21, 222, 114, 0.06);
  color: #0f172a;
}

.seed-callout-dark {
  background: rgba(255, 255, 255, 0.04);
  color: #e2e8f0;
}

.seed-callout-icon {
  flex: 0 0 auto;
  margin-top: 1px;
  color: #15DE72;
}

.seed-callout-body {
  flex: 1 1 auto;
  font-size: 13px;
  line-height: 1.5;
}

.seed-callout-heading {
  font-weight: 600;
  margin-bottom: 2px;
}

.seed-callout-text {
  font-weight: 400;
  opacity: 0.92;
}

.seed-dialog-actions {
  padding: 0 20px 20px;
  display: flex;
  justify-content: center;
}

.seed-dialog-actions--stack {
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.seed-primary-btn {
  width: 100%;
  max-width: 320px;
  height: 48px;
  border-radius: 24px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.seed-secondary-btn {
  width: 100%;
  max-width: 320px;
  height: 40px;
  border-radius: 20px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

@media (max-width: 480px) {
  .seed-step-body {
    padding: 12px 16px 16px;
  }
  .context-heading {
    font-size: 18px;
  }
  .context-lede {
    font-size: 13px;
  }
}
</style>
