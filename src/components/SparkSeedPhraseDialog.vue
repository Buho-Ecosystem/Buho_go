<template>
  <q-dialog
    v-model="open"
    persistent
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @hide="onDialogHidden"
  >
    <q-card class="seed-dialog" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <!-- Header -->
      <q-card-section class="seed-dialog-header">
        <div class="seed-dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
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

      <!-- Step: Context -->
      <template v-if="step === 'context'">
        <q-card-section class="seed-step-body context-body">
          <img
            :src="CONTEXT_ILLUSTRATION"
            class="context-illustration"
            alt=""
            aria-hidden="true"
          />
          <h2 class="context-heading" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
            {{ $t('Your recovery phrase') }}
          </h2>
          <p class="context-lede" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('These 12 words are the only way to restore this wallet if you lose access to your device. Anyone who sees them can move your money.') }}
          </p>

          <div class="seed-callout" :class="$q.dark.isActive ? 'seed-callout-dark' : 'seed-callout-light'">
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
            :loading="isAuthenticating"
            :disable="isLoadingMnemonic"
            @click="onReady"
          />
        </q-card-actions>
      </template>

      <!-- Step: Auth method explanation (native only) -->
      <template v-else-if="step === 'authExplain'">
        <q-card-section class="seed-step-body context-body">
          <img
            :src="authIllustration"
            class="context-illustration"
            alt=""
            aria-hidden="true"
          />
          <h2 class="context-heading" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
            {{ authTitle }}
          </h2>
          <p class="context-lede" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ authBody }}
          </p>

          <div class="seed-callout" :class="$q.dark.isActive ? 'seed-callout-dark' : 'seed-callout-light'">
            <div class="seed-callout-icon">
              <Icon :icon="isDevicePinOnly ? 'tabler:lock' : 'tabler:fingerprint'" width="18" height="18" />
            </div>
            <div class="seed-callout-body">
              <div class="seed-callout-text">
                {{ isDevicePinOnly
                  ? $t('You are seeing this because no fingerprint or face is set up on this device. Your device lock is used instead.')
                  : $t('Your biometric is processed by your phone, not by BuhoGO. We never see it.')
                }}
              </div>
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

      <!-- Step: Phrase reveal -->
      <template v-else-if="step === 'phrase'">
        <q-card-section class="seed-step-body phrase-body">
          <div
            class="phrase-countdown"
            :class="[
              $q.dark.isActive ? 'phrase-countdown-dark' : 'phrase-countdown-light',
              { 'phrase-countdown-expiring': countdownRunning && countdownSeconds <= 10 },
            ]"
            role="status"
            aria-live="polite"
          >
            <Icon :icon="countdownRunning ? 'tabler:clock' : 'tabler:eye-off'" width="14" height="14" />
            <span v-if="countdownRunning">
              {{ $t('Auto-hides in') }} {{ countdownText }}
            </span>
            <span v-else-if="timerExpired">
              {{ $t('Hidden again. Tap Show words to reveal.') }}
            </span>
            <span v-else>
              {{ $t('Tap Show words to reveal.') }}
            </span>
          </div>

          <MnemonicDisplay
            :initial-blurred="phraseBlurred"
            :words="mnemonicWords"
            :allow-blur="true"
            :show-warning="false"
            :show-copy="false"
            @update:blurred="phraseBlurred = $event"
          />

          <div class="seed-callout" :class="$q.dark.isActive ? 'seed-callout-dark' : 'seed-callout-light'">
            <div class="seed-callout-icon">
              <Icon icon="tabler:shield" width="18" height="18" />
            </div>
            <div class="seed-callout-body">
              <div class="seed-callout-text">
                {{ $t('Never type this phrase into a website. Never share it in chat, photos, or cloud notes.') }}
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
            :label="mode === 'view' ? $t('Done') : $t('I have it written down')"
            @click="onPhraseContinue"
          />
        </q-card-actions>
      </template>

      <!-- Step: Verify (backup mode only) -->
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
import MnemonicDisplay from './MnemonicDisplay.vue';
import MnemonicOrderVerify from './MnemonicOrderVerify.vue';
// Alternative lightweight verification (type 3 random words). Not wired
// into the current flow but retained for future reuse — see PR history.
// import MnemonicVerify from './MnemonicVerify.vue';
import { useWalletStore } from '../stores/wallet';
import { isBiometricAvailable, authenticate } from '../utils/biometric';
import { getBiometricMethodCopy } from '../utils/biometricCopy';
import { secureScreen } from '../utils/secureScreen';

const CONTEXT_ILLUSTRATION = '/Learn and Earn/Question_pictures/safe.svg';
const REVEAL_DURATION_SECONDS = 120;
const COUNTDOWN_TICK_MS = 1000;

export default {
  name: 'SparkSeedPhraseDialog',

  components: {
    MnemonicDisplay,
    MnemonicOrderVerify,
  },

  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
    /**
     * 'view'   — post-backup. Reveal phrase, close on Done.
     * 'backup' — first-time backup. Reveal phrase, then verify by
     *             tapping all 12 words in order. On success marks the
     *             wallet as backed up and emits 'verified'.
     */
    mode: {
      type: String,
      required: true,
      validator: (v) => v === 'view' || v === 'backup',
    },
    /**
     * Optional specific Spark wallet id. Defaults to the active Spark
     * wallet inside the store.
     */
    walletId: {
      type: String,
      default: null,
    },
  },

  emits: ['update:modelValue', 'verified'],

  setup() {
    const walletStore = useWalletStore();
    return { walletStore, CONTEXT_ILLUSTRATION };
  },

  data() {
    return {
      step: 'context',              // 'context' | 'authExplain' | 'phrase' | 'verify'
      mnemonicWords: [],
      isAuthenticating: false,
      isLoadingMnemonic: false,
      phraseBlurred: true,
      countdownSeconds: REVEAL_DURATION_SECONDS,
      countdownInterval: null,
      timerExpired: false,
      secureScreenActive: false,

      // Detected authentication method for the explanation screen.
      // Set by onReady() after isBiometricAvailable() resolves.
      // Values: 'fingerprint' | 'face' | 'iris' | 'multiple' | 'device-pin'
      authBiometryType: 'none',
    };
  },

  computed: {
    open: {
      get() {
        return this.modelValue;
      },
      set(v) {
        this.$emit('update:modelValue', v);
      },
    },

    headerTitle() {
      if (this.step === 'verify') return this.$t('Verify your backup');
      if (this.step === 'phrase') return this.$t('Your recovery phrase');
      if (this.step === 'authExplain') return this.$t('Verify it is you');
      return this.mode === 'backup' ? this.$t('Back up your wallet') : this.$t('View recovery phrase');
    },

    /**
     * Resolved copy for the auth-explain screen. Delegates to the shared
     * biometricCopy util so platform-specific labels (iOS Touch ID vs
     * Android Fingerprint) stay consistent with any other flow that
     * explains the upcoming system sheet.
     */
    authMethodCopy() {
      return getBiometricMethodCopy(this.authBiometryType, this.$t.bind(this));
    },

    isDevicePinOnly() {
      return this.authMethodCopy.isDevicePinOnly;
    },

    authIllustration() {
      return this.authMethodCopy.illustration;
    },

    authTitle() {
      // The "multiple" case has "Biometrics" as the method label, which
      // reads awkwardly with a singular verb ("Biometrics is required").
      // Use a neutral title instead; the illustration + body already
      // communicate the method clearly.
      if (this.authBiometryType === 'multiple') {
        return this.$t('Verify it is you');
      }
      // Concatenated rather than interpolated because vue-i18n returns
      // missing keys verbatim and does not run interpolation on fallback.
      return `${this.authMethodCopy.methodLabel} ${this.$t('is required')}`;
    },

    authBody() {
      return `${this.authMethodCopy.actionPhrase} ${this.$t('so nobody else can see your recovery phrase, even if they have your unlocked phone.')}`;
    },

    countdownText() {
      const total = Math.max(0, this.countdownSeconds);
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    },

    /**
     * True while the auto-hide interval is actively ticking. The pill's
     * copy and icon key off this so we never display "Auto-hides in 2:00"
     * when nothing is actually being timed (e.g. before the user has
     * first revealed the phrase).
     */
    countdownRunning() {
      return this.countdownInterval !== null;
    },

    readyLabel() {
      return this.$t("I'm ready");
    },
  },

  watch: {
    /**
     * Reset the dialog on every open. Guarantees clean state between
     * entries and prevents stale mnemonic data from persisting.
     */
    modelValue(isOpen) {
      if (isOpen) {
        this.resetToContext();
      }
    },

    /**
     * Whenever the user unblurs the phrase (including after a timeout),
     * (re)start the 120-second countdown. This gives them a fresh window
     * each time they actively reveal the words.
     */
    phraseBlurred(isBlurred) {
      if (this.step !== 'phrase') return;
      if (isBlurred) {
        this.stopCountdown();
      } else {
        this.startCountdown();
      }
    },
  },

  beforeUnmount() {
    this.stopCountdown();
    this.wipeMnemonic();
    if (this.secureScreenActive) {
      secureScreen.disable();
      this.secureScreenActive = false;
    }
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

      // Keep the button in a loading state for the whole probe so a slow
      // plugin response (100-300ms on Android cold calls) doesn't invite
      // a double-tap.
      this.isAuthenticating = true;
      try {
        const { available, biometryType } = await isBiometricAvailable();
        // Defensive: the parent may have programmatically closed the
        // dialog while we were awaiting. Don't mutate / decrypt behind
        // the user's back.
        if (!this.modelValue) return;

        if (!available) {
          // Web or devices without any lock — no system prompt exists,
          // go straight to the reveal. The user approved via "I'm ready".
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
        // Same defensive check: dialog may have been closed during the
        // native prompt. Do not decrypt the mnemonic into a component
        // that the user is no longer looking at.
        if (!this.modelValue) return;

        if (!ok) {
          // Cancelled or failed. Stay on authExplain so retry is one tap
          // away — going all the way back to context punishes the user
          // for a mis-tap on the system sheet.
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
        const mnemonic = await this.walletStore.getSparkMnemonic(this.walletId || undefined);
        // Dialog may have been closed while waiting for decryption. Wipe
        // what we just produced and bail — never stash a mnemonic in a
        // component the user isn't looking at.
        if (!this.modelValue) {
          const words = mnemonic.split(' ');
          for (let i = 0; i < words.length; i += 1) words[i] = '';
          return;
        }

        this.mnemonicWords = mnemonic.split(' ');

        // Turn on screenshot protection only once the words are about
        // to hit the screen, and leave it on for the verify step too.
        await secureScreen.enable();
        this.secureScreenActive = true;

        this.step = 'phrase';
        this.phraseBlurred = true;
        this.timerExpired = false;
      } catch (error) {
        console.error('Failed to load recovery phrase', error);
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
        if (this.countdownSeconds <= 0) {
          this.onTimerExpire();
        }
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
      // Returning to phrase view shows the blurred state; the user can
      // re-reveal to restart the countdown. This is deliberate: if they
      // came back it's to double-check, not passively display.
      this.phraseBlurred = true;
      this.timerExpired = false;
      this.countdownSeconds = REVEAL_DURATION_SECONDS;
    },

    async onVerifySuccess() {
      try {
        await this.walletStore.confirmBackup(this.walletId || undefined);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Backup confirmed'),
          caption: this.$t('Your recovery phrase is safe if you stored it somewhere secure.'),
        });
        this.$emit('verified');
      } catch (error) {
        console.error('Failed to confirm backup', error);
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
      // Fires after the dialog transition completes, regardless of how
      // it was dismissed. Final cleanup happens here so state is always
      // torn down even if the dialog is closed via persistent-backdrop
      // (shouldn't be, but defensively safe) or programmatically.
      this.stopCountdown();
      this.wipeMnemonic();
      if (this.secureScreenActive) {
        await secureScreen.disable();
        this.secureScreenActive = false;
      }
    },

    wipeMnemonic() {
      // Overwrite in place before dropping the reference so the slot
      // doesn't linger in the component instance. JS engines may still
      // keep copies internally, but this shrinks the obvious surface.
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

/* ──────────── Context step ──────────── */

.context-body {
  align-items: center;
  text-align: center;
}

.context-illustration {
  width: 100%;
  max-width: 180px;
  height: auto;
  margin: 4px auto 8px;
  user-select: none;
  pointer-events: none;
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

/* ──────────── Phrase step ──────────── */

.phrase-countdown {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: center;
  padding: 6px 12px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  transition: background 0.2s ease, color 0.2s ease;
}

.phrase-countdown-light {
  background: #f1f5f9;
  color: #475569;
}

.phrase-countdown-dark {
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
}

.phrase-countdown-expiring {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

/* ──────────── Quiet callout (replaces the yellow alert) ──────────── */

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

/* ──────────── Actions ──────────── */

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

/* ──────────── Responsive ──────────── */

@media (max-width: 480px) {
  .seed-step-body {
    padding: 12px 16px 16px;
  }
  .context-illustration {
    max-width: 150px;
  }
  .context-heading {
    font-size: 18px;
  }
  .context-lede {
    font-size: 13px;
  }
}
</style>
