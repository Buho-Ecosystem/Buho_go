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
          class="auth-close"
          :disable="isAuthenticating"
          @click="close"
          :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          :aria-label="$t('Close')"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </q-card-section>

      <!-- Body: the method, named big and shown, and one line on when it
           is asked for. The phone's own prompt explains the rest. -->
      <q-card-section class="auth-step-body">
        <img
          :src="copy.illustration"
          class="auth-illustration"
          alt=""
          aria-hidden="true"
        />

        <h2 class="auth-heading" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
          {{ copy.title }}
        </h2>

        <p class="auth-lede" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
          {{ copy.line }}
        </p>
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
  border-radius: 24px;
  overflow: hidden;
}

.auth-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 12px 4px 20px;
}

.auth-close {
  width: 44px;
  height: 44px;
}

.auth-dialog-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

.auth-step-body {
  padding: 4px 28px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
}

.auth-illustration {
  width: 200px;
  max-width: 100%;
  height: auto;
  margin-bottom: 4px;
  user-select: none;
  pointer-events: none;
}

.auth-heading {
  font-family: 'Manrope', sans-serif;
  font-size: 30px;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.01em;
  margin: 0;
  text-wrap: balance;
}

.auth-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  line-height: 1.45;
  margin: 0;
  max-width: 270px;
  text-wrap: pretty;
}

.auth-dialog-actions {
  padding: 0 20px 18px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.auth-primary-btn {
  height: 48px;
  border-radius: 24px;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
}

.auth-secondary-btn {
  height: 44px;
  border-radius: 22px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* Short phones: the picture gives way first, the words stay whole. */
@media (max-height: 640px) {
  .auth-illustration {
    width: 150px;
  }
}
</style>
