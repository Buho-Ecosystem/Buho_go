<template>
  <q-dialog
    v-model="open"
    persistent
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="auth-dialog" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <!-- Header -->
      <q-card-section class="auth-dialog-header">
        <div class="auth-dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
          {{ $t('Turn on app lock') }}
        </div>
        <q-btn
          flat
          round
          dense
          :disable="isAuthenticating"
          @click="close"
          :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          :aria-label="$t('Close')"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </q-card-section>

      <!-- Body -->
      <q-card-section class="auth-step-body">
        <img
          :src="copy.illustration"
          class="auth-illustration"
          alt=""
          aria-hidden="true"
        />

        <h2 class="auth-heading" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
          {{ heading }}
        </h2>

        <p class="auth-lede" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
          {{ lede }}
        </p>

        <div class="auth-callout" :class="$q.dark.isActive ? 'auth-callout-dark' : 'auth-callout-light'">
          <div class="auth-callout-icon">
            <Icon :icon="copy.isDevicePinOnly ? 'tabler:lock' : 'tabler:shield-check'" width="18" height="18" />
          </div>
          <div class="auth-callout-body">
            <div class="auth-callout-heading">{{ privacyHeading }}</div>
            <div class="auth-callout-text">{{ privacyText }}</div>
          </div>
        </div>
      </q-card-section>

      <!-- Actions -->
      <q-card-actions class="auth-dialog-actions">
        <q-btn
          unelevated
          no-caps
          class="auth-primary-btn"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :label="$t('Turn on app lock')"
          :loading="isAuthenticating"
          @click="onConfirm"
        />
        <q-btn
          flat
          no-caps
          class="auth-secondary-btn"
          :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          :label="$t('Cancel')"
          :disable="isAuthenticating"
          @click="close"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script>
import { authenticate } from '../utils/biometric';
import { getBiometricMethodCopy } from '../utils/biometricCopy';

export default {
  name: 'BiometricEnableDialog',

  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
    /**
     * Pre-detected biometry type from the parent. The parent already
     * ran isBiometricAvailable() before opening the dialog, so we don't
     * re-probe here — keeping the dialog a pure view over a known state.
     *
     * Values: 'fingerprint' | 'face' | 'iris' | 'multiple' | 'device-pin'
     */
    biometryType: {
      type: String,
      required: true,
    },
  },

  emits: ['update:modelValue', 'confirmed'],

  data() {
    return {
      isAuthenticating: false,
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    copy() {
      return getBiometricMethodCopy(this.biometryType, this.$t.bind(this));
    },

    heading() {
      // "Lock BuhoGO with Touch ID" / "Lock BuhoGO with your fingerprint" etc.
      // Concatenated rather than interpolated via vue-i18n because missing
      // translation keys are returned verbatim and interpolation is not run
      // on the fallback (see the project's i18n hygiene rules).
      return `${this.$t('Lock BuhoGO with')} ${this.copy.methodLabel}`;
    },

    lede() {
      // "Use Touch ID every time you open BuhoGO..." — same concatenation
      // pattern so the leading phrase flexes per method/platform.
      return `${this.copy.actionPhrase} ${this.$t('every time you open BuhoGO. Only someone who can unlock your phone can open your wallet.')}`;
    },

    privacyHeading() {
      return this.copy.isDevicePinOnly
        ? this.$t('Your device lock is used')
        : this.$t('Private by design');
    },

    privacyText() {
      return this.copy.isDevicePinOnly
        ? this.$t('You are seeing this because no fingerprint or face is set up on this device. Your phone will ask for your PIN, pattern, or password when the app opens.')
        : this.$t('Your biometric is processed by your phone, not by BuhoGO. We never see it.');
    },
  },

  methods: {
    async onConfirm() {
      if (this.isAuthenticating) return;

      this.isAuthenticating = true;
      try {
        const ok = await authenticate({
          reason: this.$t('Verify to turn on app lock'),
          title: 'BuhoGO',
          subtitle: this.$t('App lock'),
          useFallback: true,
        });
        // Defensive: dialog may have been closed while awaiting the
        // native sheet (e.g. programmatic close). Do not emit success
        // for a dialog the user is no longer looking at.
        if (!this.modelValue) return;
        if (!ok) {
          // Cancelled or failed — stay on the explanation screen so the
          // user can retry or explicitly cancel.
          return;
        }
        this.$emit('confirmed');
        this.open = false;
      } finally {
        this.isAuthenticating = false;
      }
    },

    close() {
      if (this.isAuthenticating) return;
      this.open = false;
    },
  },
};
</script>

<style scoped>
.auth-dialog {
  width: 100%;
  max-width: 460px;
  border-radius: 20px;
  overflow: hidden;
}

.auth-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 8px;
}

.auth-dialog-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

.auth-step-body {
  padding: 12px 20px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
}

.auth-illustration {
  width: 100%;
  max-width: 180px;
  height: auto;
  margin: 4px auto 8px;
  user-select: none;
  pointer-events: none;
}

.auth-heading {
  font-family: 'Manrope', sans-serif;
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}

.auth-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  margin: 0;
  max-width: 380px;
}

.auth-callout {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 4px;
  padding: 12px 14px;
  border-radius: 10px;
  border-left: 2px solid #15DE72;
  font-family: 'Manrope', sans-serif;
  text-align: left;
  width: 100%;
}

.auth-callout-light {
  background: rgba(21, 222, 114, 0.06);
  color: #0f172a;
}

.auth-callout-dark {
  background: rgba(255, 255, 255, 0.04);
  color: #e2e8f0;
}

.auth-callout-icon {
  flex: 0 0 auto;
  margin-top: 1px;
  color: #15DE72;
}

.auth-callout-body {
  flex: 1 1 auto;
  font-size: 13px;
  line-height: 1.5;
}

.auth-callout-heading {
  font-weight: 600;
  margin-bottom: 2px;
}

.auth-callout-text {
  font-weight: 400;
  opacity: 0.92;
}

.auth-dialog-actions {
  padding: 0 20px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.auth-primary-btn {
  width: 100%;
  max-width: 320px;
  height: 48px;
  border-radius: 24px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.auth-secondary-btn {
  width: 100%;
  max-width: 320px;
  height: 40px;
  border-radius: 20px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

@media (max-width: 480px) {
  .auth-step-body {
    padding: 12px 16px 16px;
  }
  .auth-illustration {
    max-width: 150px;
  }
  .auth-heading {
    font-size: 18px;
  }
  .auth-lede {
    font-size: 13px;
  }
}
</style>
