<template>
  <q-dialog
    v-model="open"
    persistent
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @hide="onDialogHidden"
  >
    <q-card
      class="nostr-dialog"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Header -->
      <q-card-section class="nostr-dialog-header">
        <div
          class="nostr-dialog-title"
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

      <!-- Overview step: public profile address (mainstream framing) + actions.
           The bech32 value still carries the `npub1…` prefix so power
           users recognise the underlying protocol; the label stays plain. -->
      <template v-if="step === 'overview'">
        <q-card-section class="nostr-step-body overview-body">
          <div class="overview-illustration">
            <img
              src="/nostr/nostr.png"
              alt=""
              class="nostr-logo nostr-logo--lg"
            />
          </div>
          <h2
            class="overview-heading"
            :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'"
          >
            {{ $t('Your public profile') }}
          </h2>
          <p
            class="overview-lede"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ $t('Derived from your BuhoGO recovery phrase. Backing up the phrase backs up your profile too.') }}
          </p>

          <div
            class="key-card"
            :class="$q.dark.isActive ? 'key-card-dark' : 'key-card-light'"
          >
            <div class="key-card-label">
              {{ $t('Profile address') }}
            </div>
            <div class="key-card-value">
              <code class="key-card-code">{{ identity.nostrNpub || '…' }}</code>
              <q-btn
                flat
                dense
                round
                :disable="!identity.nostrNpub"
                :aria-label="$t('Copy profile address')"
                @click="copyNpub"
              >
                <Icon
                  :icon="copiedNpub ? 'tabler:check' : 'tabler:copy'"
                  width="16"
                  height="16"
                />
              </q-btn>
            </div>
          </div>

          <div
            class="nostr-callout"
            :class="$q.dark.isActive ? 'nostr-callout-dark' : 'nostr-callout-light'"
          >
            <div class="nostr-callout-icon">
              <Icon icon="tabler:info-circle" width="18" height="18" />
            </div>
            <div class="nostr-callout-body">
              <div class="nostr-callout-text">
                {{ $t('Share this address. Friends can find you on compatible apps.') }}
              </div>
            </div>
          </div>
        </q-card-section>

        <q-card-actions class="nostr-dialog-actions nostr-dialog-actions--stack">
          <q-btn
            unelevated
            no-caps
            class="nostr-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="$t('Show private key')"
            :loading="isAuthenticating || isLoadingSecret"
            @click="onRevealRequested"
          />
          <!-- WIP_PLAN: nostr-identity-recovery
               Rotation is hidden until we can publish the active account
               index to relays. Re-enable per
               WIP_plans/nostr_identity_recovery.md.
          <q-btn
            flat
            no-caps
            class="nostr-danger-link"
            :label="$t('Reset your profile')"
            @click="step = 'rotateConfirm'"
          />
          -->
        </q-card-actions>
      </template>

      <!-- Auth-explain step: only rendered when the app's biometric lock
           is enabled, mirroring the seed-phrase dialog. -->
      <template v-else-if="step === 'authExplain'">
        <q-card-section class="nostr-step-body overview-body">
          <div class="overview-illustration">
            <Icon :icon="isDevicePinOnly ? 'tabler:lock' : 'tabler:fingerprint'" width="76" height="76" />
          </div>
          <h2
            class="overview-heading"
            :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'"
          >
            {{ authTitle }}
          </h2>
          <p
            class="overview-lede"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ authBody }}
          </p>
          <div
            class="nostr-callout"
            :class="$q.dark.isActive ? 'nostr-callout-dark' : 'nostr-callout-light'"
          >
            <div class="nostr-callout-icon">
              <Icon :icon="isDevicePinOnly ? 'tabler:lock' : 'tabler:fingerprint'" width="18" height="18" />
            </div>
            <div class="nostr-callout-body">
              <div class="nostr-callout-text">{{ authPrivacyText }}</div>
            </div>
          </div>
        </q-card-section>

        <q-card-actions class="nostr-dialog-actions nostr-dialog-actions--stack">
          <q-btn
            unelevated
            no-caps
            class="nostr-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="$t('Continue')"
            :loading="isAuthenticating || isLoadingSecret"
            @click="onConfirmAuth"
          />
          <q-btn
            flat
            no-caps
            class="nostr-secondary-btn"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
            :label="$t('Cancel')"
            :disable="isAuthenticating || isLoadingSecret"
            @click="step = 'overview'"
          />
        </q-card-actions>
      </template>

      <!-- Private-key reveal step. The bech32 value carries an `nsec1…`
           prefix that power users will recognise; the label stays plain
           so mainstream users see "private key" instead of crypto jargon. -->
      <template v-else-if="step === 'reveal'">
        <q-card-section class="nostr-step-body reveal-body">
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
              {{ $t('Hidden again. Tap to reveal.') }}
            </span>
            <span v-else>
              {{ $t('Tap to reveal.') }}
            </span>
          </div>

          <button
            type="button"
            class="secret-card"
            :class="[
              $q.dark.isActive ? 'secret-card-dark' : 'secret-card-light',
              { 'secret-card--blurred': nsecBlurred },
            ]"
            :aria-label="nsecBlurred ? $t('Show private key') : $t('Hide private key')"
            @click="toggleNsec"
          >
            <div class="secret-card-label">
              {{ $t('Private key') }}
            </div>
            <div class="secret-card-value">
              <code class="secret-card-code">{{ revealedNsec || '…' }}</code>
            </div>
            <div v-if="nsecBlurred" class="secret-card-overlay">
              <Icon icon="tabler:eye" width="20" height="20" />
              <span>{{ $t('Tap to reveal') }}</span>
            </div>
          </button>

          <div class="secret-actions">
            <q-btn
              flat
              no-caps
              dense
              :disable="nsecBlurred"
              :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
              @click="copyNsec"
            >
              <Icon
                :icon="copiedNsec ? 'tabler:check' : 'tabler:copy'"
                width="14"
                height="14"
                style="margin-right: 4px;"
              />
              {{ copiedNsec ? $t('Copied') : $t('Copy') }}
            </q-btn>
          </div>

          <div
            class="nostr-callout nostr-callout--warn"
            :class="$q.dark.isActive ? 'nostr-callout-dark' : 'nostr-callout-light'"
          >
            <div class="nostr-callout-icon">
              <Icon icon="tabler:shield" width="18" height="18" />
            </div>
            <div class="nostr-callout-body">
              <div class="nostr-callout-text">
                {{ $t('Anyone with this key can sign and post as you on compatible apps. Treat it like your recovery phrase. Never paste it into a website.') }}
              </div>
            </div>
          </div>
        </q-card-section>

        <q-card-actions class="nostr-dialog-actions">
          <q-btn
            unelevated
            no-caps
            class="nostr-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="$t('Done')"
            @click="close"
          />
        </q-card-actions>
      </template>

      <!-- WIP_PLAN: nostr-identity-recovery
           Rotate confirmation step. Disabled until we can publish the
           rotated account index to relays so it survives restore from
           the seed phrase. Re-enable per
           WIP_plans/nostr_identity_recovery.md.

      <template v-else-if="step === 'rotateConfirm'">
        <q-card-section class="nostr-step-body rotate-body">
          <div class="danger-icon-wrapper">
            <Icon icon="tabler:user-x" width="32" height="32" class="danger-icon" />
          </div>
          <h2
            class="overview-heading"
            :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'"
          >
            {{ $t('Reset your profile?') }}
          </h2>
          <p
            class="overview-lede"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ $t('Your recovery phrase stays the same. A fresh profile replaces this one. Anything you signed before will still verify, but other apps will see you as new.') }}
          </p>

          <div class="confirm-instruction" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ $t('Type') }} <span class="confirm-phrase">"{{ confirmPhrase }}"</span> {{ $t('to confirm') }}
          </div>
          <q-input
            v-model="rotateConfirmInput"
            outlined
            dense
            :placeholder="confirmPhrase"
            class="confirm-input"
            :dark="$q.dark.isActive"
            :color="$q.dark.isActive ? 'white' : 'dark'"
            @keyup.enter="executeRotate"
          />
        </q-card-section>

        <q-card-actions class="nostr-dialog-actions">
          <q-btn
            flat
            no-caps
            :label="$t('Cancel')"
            class="nostr-secondary-btn"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
            :disable="isRotating"
            @click="cancelRotate"
          />
          <q-btn
            unelevated
            no-caps
            :label="$t('Reset profile')"
            :disable="rotateConfirmInput !== confirmPhrase"
            :loading="isRotating"
            class="danger-action-btn"
            @click="executeRotate"
          />
        </q-card-actions>
      </template>
      -->

    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useWalletStore } from '../stores/wallet';
import { useIdentityStore } from '../stores/identity';
import { isBiometricAvailable, authenticate } from '../utils/biometric';
import { getBiometricMethodCopy } from '../utils/biometricCopy';
import { secureScreen } from '../utils/secureScreen';

const REVEAL_DURATION_SECONDS = 120;
const COUNTDOWN_TICK_MS = 1000;
// WIP_PLAN: nostr-identity-recovery — used by the rotation confirmation
// step, which is currently disabled. Keeping the constant so the
// uncomment step is a single grep.
// const CONFIRM_PHRASE = 'I understand';

export default {
  name: 'NostrIdentityDialog',

  components: { Icon },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue'],

  setup() {
    const walletStore = useWalletStore();
    const identity = useIdentityStore();
    return { walletStore, identity };
  },

  data() {
    return {
      step: 'overview',
      isAuthenticating: false,
      isLoadingSecret: false,
      authBiometryType: 'none',

      // Reveal state. `revealedNsec` is the only place the decrypted nsec
      // is held; we wipe it on hide / dialog close. `nsecBlurred` controls
      // the visual mask, independent of whether the secret is loaded.
      revealedNsec: '',
      nsecBlurred: true,
      countdownSeconds: REVEAL_DURATION_SECONDS,
      countdownInterval: null,
      timerExpired: false,
      secureScreenActive: false,

      // Copy feedback
      copiedNpub: false,
      copiedNsec: false,

      // WIP_PLAN: nostr-identity-recovery — rotation flow state.
      // Disabled until we publish the rotated account index to relays.
      // rotateConfirmInput: '',
      // isRotating: false,
      // confirmPhrase: CONFIRM_PHRASE,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    headerTitle() {
      if (this.step === 'authExplain') return this.$t('Verify it is you');
      if (this.step === 'reveal') return this.$t('Your private key');
      // WIP_PLAN: nostr-identity-recovery — rotation step header.
      // if (this.step === 'rotateConfirm') return this.$t('Reset your profile');
      return this.$t('Your public profile');
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
      return `${this.authMethodCopy.actionPhrase} ${this.$t('so nobody else can reveal your private key, even if they have your unlocked phone.')}`;
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
  },

  watch: {
    modelValue(isOpen) {
      if (isOpen) this.resetToOverview();
    },
    nsecBlurred(isBlurred) {
      if (this.step !== 'reveal') return;
      if (isBlurred) this.stopCountdown();
      else this.startCountdown();
    },
  },

  async mounted() {
    // Make sure the cached npub is present. Cheap (single decrypt) and
    // only on first open after the Nostr feature shipped.
    try {
      await this.identity.loadNostrIdentity();
    } catch (err) {
      console.error('[NostrIdentityDialog] loadNostrIdentity failed', err);
    }
  },

  beforeUnmount() {
    this.stopCountdown();
    this.wipeSecret();
    if (this.secureScreenActive) {
      secureScreen.disable();
      this.secureScreenActive = false;
    }
  },

  methods: {
    resetToOverview() {
      this.step = 'overview';
      this.isAuthenticating = false;
      this.isLoadingSecret = false;
      this.authBiometryType = 'none';
      this.nsecBlurred = true;
      this.timerExpired = false;
      this.countdownSeconds = REVEAL_DURATION_SECONDS;
      this.copiedNpub = false;
      this.copiedNsec = false;
      // WIP_PLAN: nostr-identity-recovery — rotation state reset.
      // this.rotateConfirmInput = '';
      // this.isRotating = false;
      this.stopCountdown();
      this.wipeSecret();
    },

    async onRevealRequested() {
      if (this.isAuthenticating || this.isLoadingSecret) return;

      // Same gate as the seed-phrase reveal: only re-prompt biometrics
      // when App Lock is on, otherwise reveal directly.
      if (!this.walletStore.biometricsEnabled) {
        await this.loadSecretAndReveal();
        return;
      }

      this.isAuthenticating = true;
      try {
        const { available, biometryType } = await isBiometricAvailable();
        if (!this.modelValue) return;

        if (!available) {
          await this.loadSecretAndReveal();
          return;
        }

        this.authBiometryType = biometryType;
        this.step = 'authExplain';
      } finally {
        this.isAuthenticating = false;
      }
    },

    async onConfirmAuth() {
      if (this.isAuthenticating || this.isLoadingSecret) return;

      this.isAuthenticating = true;
      try {
        const ok = await authenticate({
          reason: this.$t('Verify it is you to reveal your private key'),
          title: 'BuhoGO',
          subtitle: this.$t('Private key'),
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

        await this.loadSecretAndReveal();
      } finally {
        this.isAuthenticating = false;
      }
    },

    async loadSecretAndReveal() {
      this.isLoadingSecret = true;
      try {
        const { nsec } = await this.identity.revealNostrSecret();

        if (!this.modelValue) {
          // Dialog was dismissed while we were decrypting — drop the
          // secret without ever surfacing it.
          return;
        }

        this.revealedNsec = nsec;

        await secureScreen.enable();
        this.secureScreenActive = true;

        this.step = 'reveal';
        this.nsecBlurred = true;
        this.timerExpired = false;
      } catch (error) {
        console.error('[NostrIdentityDialog] reveal failed', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t("We couldn't reveal your private key"),
          caption: this.$t('Please try again.'),
        });
        this.close();
      } finally {
        this.isLoadingSecret = false;
      }
    },

    toggleNsec() {
      this.nsecBlurred = !this.nsecBlurred;
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
      this.nsecBlurred = true;
    },

    async copyNpub() {
      const npub = this.identity.nostrNpub;
      if (!npub) return;
      try {
        await navigator.clipboard.writeText(npub);
        this.copiedNpub = true;
        setTimeout(() => { this.copiedNpub = false; }, 1500);
      } catch (err) {
        console.error('[NostrIdentityDialog] copy npub failed', err);
        this.$q.notify({ type: 'negative', message: this.$t("Couldn't copy") });
      }
    },

    async copyNsec() {
      if (!this.revealedNsec || this.nsecBlurred) return;
      try {
        await navigator.clipboard.writeText(this.revealedNsec);
        this.copiedNsec = true;
        setTimeout(() => { this.copiedNsec = false; }, 1500);
      } catch (err) {
        console.error('[NostrIdentityDialog] copy nsec failed', err);
        this.$q.notify({ type: 'negative', message: this.$t("Couldn't copy") });
      }
    },

    // WIP_PLAN: nostr-identity-recovery — rotation handlers.
    // Disabled until we publish the rotated account index to relays.
    // cancelRotate() {
    //   this.rotateConfirmInput = '';
    //   this.step = 'overview';
    // },
    //
    // async executeRotate() {
    //   if (this.rotateConfirmInput !== this.confirmPhrase) return;
    //   this.isRotating = true;
    //   try {
    //     await this.identity.rotateNostrIdentity();
    //     this.$q.notify({
    //       type: 'positive',
    //       message: this.$t('Profile reset'),
    //       caption: this.$t('Your old profile is forgotten on this device.'),
    //       timeout: 4000,
    //     });
    //     this.rotateConfirmInput = '';
    //     this.step = 'overview';
    //   } catch (error) {
    //     console.error('[NostrIdentityDialog] rotate failed', error);
    //     this.$q.notify({
    //       type: 'negative',
    //       message: this.$t("Couldn't reset your profile"),
    //       caption: this.$t('Please try again.'),
    //     });
    //   } finally {
    //     this.isRotating = false;
    //   }
    // },

    close() {
      this.open = false;
    },

    async onDialogHidden() {
      this.stopCountdown();
      this.wipeSecret();
      if (this.secureScreenActive) {
        await secureScreen.disable();
        this.secureScreenActive = false;
      }
    },

    wipeSecret() {
      this.revealedNsec = '';
    },
  },
};
</script>

<style scoped>
.nostr-dialog {
  width: 100%;
  max-width: 460px;
  border-radius: 20px;
  overflow: hidden;
}

.nostr-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 8px;
}

.nostr-dialog-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

.nostr-step-body {
  padding: 12px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.overview-body,
.rotate-body {
  align-items: center;
  text-align: center;
}

.overview-illustration {
  width: 100%;
  display: flex;
  justify-content: center;
  margin: 4px auto 4px;
}

/* Nostr logo — rendered as-is in its brand colour. */
.nostr-logo {
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}

.nostr-logo--lg {
  width: 64px;
  height: 64px;
}

.overview-heading {
  font-family: 'Manrope', sans-serif;
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}

.overview-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  margin: 0;
  max-width: 380px;
}

/* ---------- npub display card ---------- */

.key-card {
  width: 100%;
  border-radius: 14px;
  padding: 12px 14px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.key-card-light {
  background: #f8fafc;
  border: 1px solid rgba(15, 23, 42, 0.08);
}

.key-card-dark {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.key-card-label {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.7;
}

.key-card-value {
  display: flex;
  align-items: center;
  gap: 8px;
}

.key-card-code {
  flex: 1 1 auto;
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.4;
  word-break: break-all;
  user-select: all;
}

/* ---------- Callouts (mirrors seed-phrase dialog) ---------- */

.nostr-callout {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  text-align: left;
}

.nostr-callout-light {
  background: rgba(15, 23, 42, 0.04);
}

.nostr-callout-dark {
  background: rgba(255, 255, 255, 0.06);
}

.nostr-callout--warn.nostr-callout-light {
  background: #fffaf0;
  border: 1px solid rgba(245, 158, 11, 0.28);
}

.nostr-callout--warn.nostr-callout-dark {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.28);
}

.nostr-callout-icon {
  flex: 0 0 auto;
  color: #15DE72;
  margin-top: 1px;
}

.nostr-callout--warn .nostr-callout-icon {
  color: #b06d00;
}

.nostr-callout-body {
  flex: 1 1 auto;
  font-family: 'Manrope', sans-serif;
}

.nostr-callout-text {
  font-size: 13px;
  line-height: 1.45;
}

/* ---------- Reveal step: countdown + masked secret card ---------- */

.reveal-body {
  align-items: stretch;
}

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
  background: #fef3c7 !important;
  color: #92400e !important;
}

.secret-card {
  position: relative;
  width: 100%;
  border-radius: 14px;
  padding: 14px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
  transition: filter 0.18s ease, transform 0.12s ease;
}

.secret-card-light {
  background: #fffaf0;
  border: 1px solid rgba(245, 158, 11, 0.28);
}

.secret-card-dark {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.28);
}

.secret-card:active {
  transform: scale(0.99);
}

.secret-card-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #b06d00;
}

.secret-card-value {
  display: flex;
}

.secret-card-code {
  flex: 1 1 auto;
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.4;
  word-break: break-all;
  user-select: all;
}

.secret-card--blurred .secret-card-code {
  filter: blur(7px);
  user-select: none;
  pointer-events: none;
}

.secret-card-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #b06d00;
  pointer-events: none;
}

.secret-actions {
  display: flex;
  justify-content: center;
  margin-top: -6px;
}

/* ---------- Rotate confirm step ---------- */

.rotate-body .danger-icon-wrapper {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ef4444;
}

.confirm-instruction {
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  text-align: center;
}

.confirm-phrase {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-weight: 600;
}

.confirm-input {
  width: 100%;
}

.confirm-input :deep(.q-field__control:before) {
  border-color: rgba(15, 23, 42, 0.18);
}

.confirm-input :deep(.q-field--focused .q-field__control:after) {
  border-color: #0f172a;
  border-width: 1px;
}

body.body--dark .confirm-input :deep(.q-field__control:before) {
  border-color: rgba(255, 255, 255, 0.18);
}

body.body--dark .confirm-input :deep(.q-field--focused .q-field__control:after) {
  border-color: #f8fafc;
}

/* ---------- Action bars ---------- */

.nostr-dialog-actions {
  padding: 0 20px 20px;
  display: flex;
  gap: 8px;
}

.nostr-dialog-actions--stack {
  flex-direction: column;
  align-items: stretch;
}

.nostr-primary-btn {
  width: 100%;
  height: 48px;
  border-radius: 24px;
  font-weight: 600;
}

.nostr-secondary-btn {
  width: 100%;
  height: 44px;
  border-radius: 22px;
}

.nostr-danger-link {
  color: #ef4444;
  font-weight: 500;
  font-size: 13.5px;
}

.danger-action-btn {
  background: #ef4444;
  color: #ffffff;
  border-radius: 999px;
  flex: 1 1 auto;
  height: 44px;
}
</style>
