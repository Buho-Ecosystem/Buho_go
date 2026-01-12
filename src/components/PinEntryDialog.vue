<template>
  <q-dialog
    v-model="show"
    persistent
    maximized
    transition-show="slide-up"
    transition-hide="slide-down"
    class="pin-entry-dialog"
  >
    <q-card class="pin-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <!-- Header -->
      <q-card-section class="pin-header" :class="$q.dark.isActive ? 'header-dark' : 'header-light'">
        <div class="header-content">
          <q-btn
            v-if="showBackButton"
            flat
            round
            dense
            @click="cancel"
            class="back-btn"
            :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
          >
            <svg v-if="$q.dark.isActive" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z" fill="white"/>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z" fill="#6D6D6D"/>
            </svg>
          </q-btn>
          <div v-else class="header-spacer"></div>
          <div class="header-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
            {{ title }}
          </div>
          <div class="header-spacer"></div>
        </div>
      </q-card-section>

      <!-- Content -->
      <q-card-section class="pin-content">
        <!-- Lock Icon -->
        <div class="lock-icon-container">
          <div class="lock-icon-bg" :class="hasError ? 'lock-error' : ''">
            <q-icon :name="mode === 'confirm' ? 'las la-redo-alt' : 'las la-lock'" size="36px" color="white" />
          </div>
        </div>

        <!-- Subtitle -->
        <div class="pin-subtitle" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
          {{ subtitle }}
        </div>

        <!-- PIN Dots Display -->
        <div class="pin-dots-container">
          <div
            v-for="i in pinLength"
            :key="i"
            class="pin-dot"
            :class="[
              $q.dark.isActive ? 'pin-dot-dark' : 'pin-dot-light',
              pin.length >= i ? 'filled' : '',
              hasError ? 'error' : ''
            ]"
          ></div>
        </div>

        <!-- Error Message -->
        <div v-if="errorMessage" class="error-message">
          {{ errorMessage }}
        </div>

        <!-- Numpad -->
        <div class="numpad-container">
          <div class="numpad-row" v-for="row in numpadRows" :key="row.join('')">
            <button
              v-for="key in row"
              :key="key"
              class="numpad-btn"
              :class="[
                $q.dark.isActive ? 'numpad-btn-dark' : 'numpad-btn-light',
                key === 'del' || key === 'ok' ? 'numpad-action' : ''
              ]"
              @click="handleKeyPress(key)"
              :disabled="key === 'ok' && pin.length < pinLength"
            >
              <template v-if="key === 'del'">
                <q-icon name="las la-backspace" size="24px" />
              </template>
              <template v-else-if="key === 'ok'">
                <q-icon name="las la-check" size="24px" />
              </template>
              <template v-else>
                {{ key }}
              </template>
            </button>
          </div>
        </div>

        <!-- Forgot PIN link -->
        <div v-if="showForgotPin" class="forgot-pin-container">
          <q-btn
            flat
            no-caps
            dense
            class="forgot-pin-btn"
            :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
            @click="$emit('forgot-pin')"
          >
            {{ $t('Forgot PIN?') }}
          </q-btn>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script>
export default {
  name: 'PinEntryDialog',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    title: {
      type: String,
      default: 'Enter PIN'
    },
    subtitle: {
      type: String,
      default: 'Enter your 6-digit PIN'
    },
    pinLength: {
      type: Number,
      default: 6
    },
    mode: {
      type: String,
      default: 'enter', // 'enter', 'create', 'confirm'
      validator: (value) => ['enter', 'create', 'confirm'].includes(value)
    },
    showBackButton: {
      type: Boolean,
      default: true
    },
    showForgotPin: {
      type: Boolean,
      default: false
    },
    errorMessage: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue', 'pin-complete', 'cancel', 'forgot-pin'],
  data() {
    return {
      pin: '',
      hasError: false,
      numpadRows: [
        ['1', '2', '3'],
        ['4', '5', '6'],
        ['7', '8', '9'],
        ['del', '0', 'ok']
      ]
    }
  },
  computed: {
    show: {
      get() {
        return this.modelValue;
      },
      set(value) {
        this.$emit('update:modelValue', value);
      }
    }
  },
  watch: {
    modelValue(newVal) {
      if (newVal) {
        this.resetPin();
      }
    },
    errorMessage(newVal) {
      if (newVal) {
        this.hasError = true;
        this.shakeAndClear();
      }
    }
  },
  methods: {
    handleKeyPress(key) {
      if (key === 'del') {
        this.deleteDigit();
      } else if (key === 'ok') {
        this.submitPin();
      } else {
        this.addDigit(key);
      }
    },

    addDigit(digit) {
      if (this.pin.length < this.pinLength) {
        this.hasError = false;
        this.pin += digit;

        // Auto-submit when PIN is complete (for 'enter' mode only)
        if (this.pin.length === this.pinLength && this.mode === 'enter') {
          setTimeout(() => this.submitPin(), 150);
        }
      }
    },

    deleteDigit() {
      if (this.pin.length > 0) {
        this.pin = this.pin.slice(0, -1);
        this.hasError = false;
      }
    },

    submitPin() {
      if (this.pin.length === this.pinLength) {
        this.$emit('pin-complete', this.pin);
      }
    },

    resetPin() {
      this.pin = '';
      this.hasError = false;
    },

    shakeAndClear() {
      // Visual shake effect handled by CSS
      setTimeout(() => {
        this.pin = '';
        this.hasError = false;
      }, 500);
    },

    cancel() {
      this.resetPin();
      this.$emit('cancel');
      this.show = false;
    },

    // Public method to clear the PIN from parent
    clear() {
      this.resetPin();
    }
  }
}
</script>

<style scoped>
.pin-entry-dialog :deep(.q-dialog__inner) {
  padding: 0;
}

.pin-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* Header */
.pin-header {
  border-bottom: 1px solid;
  padding: 0.75rem 1rem;
  flex-shrink: 0;
}

.header-dark {
  border-bottom-color: #2A342A;
}

.header-light {
  border-bottom-color: #E5E7EB;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
}

.header-spacer {
  width: 40px;
  height: 40px;
}

.header-title {
  flex: 1;
  text-align: center;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 20px;
  font-weight: 700;
}

/* Content */
.pin-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.5rem;
  gap: 1.5rem;
}

/* Lock Icon */
.lock-icon-container {
  margin-bottom: 0.5rem;
}

.lock-icon-bg {
  width: 80px;
  height: 80px;
  background: linear-gradient(135deg, #059573, #15DE72, #78D53C);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(21, 222, 114, 0.3);
  transition: all 0.3s ease;
}

.lock-icon-bg.lock-error {
  background: linear-gradient(135deg, #ff4444, #ff6666);
  box-shadow: 0 4px 16px rgba(255, 68, 68, 0.3);
  animation: shake 0.5s ease-in-out;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-10px); }
  40% { transform: translateX(10px); }
  60% { transform: translateX(-10px); }
  80% { transform: translateX(10px); }
}

/* Subtitle */
.pin-subtitle {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  text-align: center;
  max-width: 280px;
}

.view_title_dark {
  color: #B0B0B0;
}

.view_title {
  color: #6B7280;
}

/* PIN Dots */
.pin-dots-container {
  display: flex;
  gap: 16px;
  margin: 1rem 0;
}

.pin-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid;
  transition: all 0.15s ease;
}

.pin-dot-dark {
  border-color: #3A3A3A;
  background: transparent;
}

.pin-dot-light {
  border-color: #D1D5DB;
  background: transparent;
}

.pin-dot.filled {
  background: linear-gradient(135deg, #059573, #15DE72);
  border-color: #15DE72;
  transform: scale(1.1);
}

.pin-dot.error {
  border-color: #ff4444;
  animation: shake 0.5s ease-in-out;
}

.pin-dot.error.filled {
  background: #ff4444;
  border-color: #ff4444;
}

/* Error Message */
.error-message {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  color: #ff4444;
  text-align: center;
  min-height: 20px;
}

/* Numpad */
.numpad-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 1rem;
}

.numpad-row {
  display: flex;
  gap: 16px;
  justify-content: center;
}

.numpad-btn {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: none;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 28px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.numpad-btn-dark {
  background: #1A1A1A;
  color: #FFFFFF;
}

.numpad-btn-dark:hover {
  background: #252525;
}

.numpad-btn-dark:active {
  background: #2A342A;
  transform: scale(0.95);
}

.numpad-btn-light {
  background: #F3F4F6;
  color: #212121;
}

.numpad-btn-light:hover {
  background: #E5E7EB;
}

.numpad-btn-light:active {
  background: #D1D5DB;
  transform: scale(0.95);
}

.numpad-btn.numpad-action {
  font-size: 24px;
}

.numpad-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.numpad-btn:disabled:active {
  transform: none;
}

/* Forgot PIN */
.forgot-pin-container {
  margin-top: 1rem;
}

.forgot-pin-btn {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

/* Responsive Design */
@media (max-width: 480px) {
  .pin-content {
    padding: 1.5rem 1rem;
    gap: 1rem;
  }

  .lock-icon-bg {
    width: 70px;
    height: 70px;
  }

  .lock-icon-bg .q-icon {
    font-size: 32px !important;
  }

  .pin-subtitle {
    font-size: 13px;
    max-width: 260px;
  }

  .pin-dots-container {
    gap: 12px;
  }

  .pin-dot {
    width: 14px;
    height: 14px;
  }

  .numpad-container {
    gap: 10px;
  }

  .numpad-row {
    gap: 12px;
  }

  .numpad-btn {
    width: 64px;
    height: 64px;
    font-size: 24px;
  }
}

@media (max-height: 700px) {
  .pin-content {
    padding: 1rem;
    gap: 0.75rem;
  }

  .lock-icon-container {
    margin-bottom: 0;
  }

  .lock-icon-bg {
    width: 60px;
    height: 60px;
  }

  .lock-icon-bg .q-icon {
    font-size: 28px !important;
  }

  .numpad-btn {
    width: 56px;
    height: 56px;
    font-size: 22px;
  }

  .numpad-row {
    gap: 10px;
  }

  .numpad-container {
    gap: 8px;
    margin-top: 0.5rem;
  }
}
</style>
