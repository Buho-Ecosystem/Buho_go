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
          <div class="lock-icon-bg" :class="[
            hasError ? 'lock-error' : '',
            loading ? 'lock-unlocking' : ''
          ]">
            <Icon
              :icon="loading ? 'tabler:lock-open' : (mode === 'confirm' ? 'tabler:refresh' : 'tabler:lock')"
              :style="{ fontSize: '36px', color: 'white' }"
            />
          </div>
        </div>

        <!-- Loading state — shown after PIN submitted while wallet unlocks -->
        <transition name="fade" mode="out-in">
          <div v-if="loading" key="loading" class="unlock-loading">
            <!-- PIN dots stay filled -->
            <div class="pin-dots-container">
              <div
                v-for="i in pinLength"
                :key="i"
                class="pin-dot"
                :class="[$q.dark.isActive ? 'pin-dot-dark' : 'pin-dot-light', 'filled']"
              ></div>
            </div>

            <q-spinner-dots size="40px" color="brand-green" />
            <div class="unlock-loading-text" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ $t('Unlocking your wallet...') }}
            </div>
          </div>

          <!-- Normal PIN entry UI -->
          <div v-else key="numpad" class="pin-entry-ui">
            <!-- Subtitle -->
            <div class="pin-subtitle" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ subtitle }}
            </div>

            <!-- PIN Dots Display -->
            <div class="pin-dots-container" :class="{ 'dots-shake': hasError }">
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
            <div class="error-message-slot" :class="{ 'has-error': errorMessage }">
              <span v-if="errorMessage" class="error-message">{{ errorMessage }}</span>
            </div>

            <!-- Numpad -->
            <div class="numpad-grid">
              <template v-for="key in numpadKeys" :key="key || 'empty'">
                <!-- Empty spacer (enter mode — no OK button) -->
                <div v-if="key === ''" class="numpad-spacer"></div>
                <!-- Key button -->
                <button
                  v-else
                  class="numpad-key"
                  :class="[
                    $q.dark.isActive ? 'numpad-key-dark' : 'numpad-key-light',
                    key === 'del' || key === 'ok' ? 'numpad-key-action' : 'numpad-key-digit',
                    key === 'ok' && pin.length < pinLength ? 'numpad-key-disabled' : '',
                    pressedKey === key ? 'numpad-key-pressed' : ''
                  ]"
                  :disabled="key === 'ok' && pin.length < pinLength"
                  @touchstart.prevent="onTouchStart(key, $event)"
                  @touchend.prevent="onTouchEnd(key)"
                  @touchcancel="onTouchCancel"
                  @click="onClickFallback(key)"
                >
                  <template v-if="key === 'del'">
                    <Icon icon="tabler:backspace" width="22" height="22" />
                  </template>
                  <template v-else-if="key === 'ok'">
                    <Icon icon="tabler:check" width="22" height="22" />
                  </template>
                  <template v-else>
                    {{ key }}
                  </template>
                </button>
              </template>
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
          </div>
        </transition>
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
    },
    loading: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue', 'pin-complete', 'cancel', 'forgot-pin'],
  data() {
    return {
      pin: '',
      hasError: false,
      pressedKey: null,
      touchHandled: false
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
    },
    numpadKeys() {
      return [
        '1', '2', '3',
        '4', '5', '6',
        '7', '8', '9',
        'del', '0', this.mode === 'enter' ? '' : 'ok'
      ]
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
    onTouchStart(key, event) {
      if (key === 'ok' && this.pin.length < this.pinLength) return;
      this.pressedKey = key;
      this.touchHandled = true;
    },

    onTouchEnd(key) {
      if (this.pressedKey !== key) {
        this.pressedKey = null;
        return;
      }
      this.pressedKey = null;
      this.handleKeyPress(key);
      this.haptic();
    },

    onTouchCancel() {
      this.pressedKey = null;
    },

    onClickFallback(key) {
      // Only handle click if touch didn't fire (desktop/mouse)
      if (this.touchHandled) {
        this.touchHandled = false;
        return;
      }
      this.handleKeyPress(key);
    },

    haptic() {
      if (navigator.vibrate) {
        navigator.vibrate(8);
      }
    },

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
          setTimeout(() => this.submitPin(), 50);
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
      this.pressedKey = null;
    },

    shakeAndClear() {
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
  padding-top: calc(var(--safe-top, 0px) + 0.75rem);
  flex-shrink: 0;
}

.header-dark {
  border-bottom-color: var(--border-card);
}

.header-light {
  border-bottom-color: var(--border-card);
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
  font-family: 'Manrope', sans-serif;
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
  padding-bottom: max(2rem, env(safe-area-inset-bottom, 0px));
  gap: 1rem;
}

/* Lock Icon */
.lock-icon-container {
  margin-bottom: 0.25rem;
}

.lock-icon-bg {
  width: 72px;
  height: 72px;
  background: var(--gradient-green);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(21, 222, 114, 0.25);
  transition: all 0.3s ease;
}

.lock-icon-bg.lock-error {
  background: var(--color-red);
  box-shadow: 0 4px 16px rgba(255, 68, 68, 0.3);
}

.lock-icon-bg.lock-unlocking {
  box-shadow: 0 4px 24px rgba(21, 222, 114, 0.4);
}

/* Fade transition between numpad and loading */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Subtitle */
.pin-subtitle {
  font-family: 'Manrope', sans-serif;
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

/* PIN entry UI wrapper */
.pin-entry-ui {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  width: 100%;
}

/* Unlock Loading */
.unlock-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  padding-top: 1rem;
}

.unlock-loading-text {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 500;
  text-align: center;
}

/* PIN Dots */
.pin-dots-container {
  display: flex;
  gap: 14px;
  padding: 0.75rem 0;
}

.dots-shake {
  animation: shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}

.pin-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid;
  transition: background 0.12s ease, border-color 0.12s ease, transform 0.12s ease;
}

.pin-dot-dark {
  border-color: #333;
  background: transparent;
}

.pin-dot-light {
  border-color: #D1D5DB;
  background: transparent;
}

.pin-dot.filled {
  background: var(--color-green);
  border-color: var(--color-green);
  transform: scale(1.15);
}

.pin-dot.error {
  border-color: var(--color-red);
}

.pin-dot.error.filled {
  background: var(--color-red);
  border-color: var(--color-red);
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-6px); }
  80% { transform: translateX(6px); }
}

/* Error Message */
.error-message-slot {
  min-height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.error-message {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: var(--color-red);
  text-align: center;
  font-weight: 500;
}

/* Numpad — CSS Grid */
.numpad-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  width: 100%;
  max-width: 280px;
  margin-top: 0.5rem;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}

.numpad-key {
  aspect-ratio: 1;
  border: none;
  border-radius: 16px;
  font-family: 'Manrope', sans-serif;
  font-size: 26px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  transition: none;
}

/* Dark theme */
.numpad-key-dark.numpad-key-digit {
  background: rgba(255, 255, 255, 0.06);
  color: #F0F0F0;
}

.numpad-key-dark.numpad-key-action {
  background: rgba(255, 255, 255, 0.03);
  color: #999;
}

.numpad-key-dark.numpad-key-pressed.numpad-key-digit {
  background: rgba(21, 222, 114, 0.15);
  color: #fff;
}

.numpad-key-dark.numpad-key-pressed.numpad-key-action {
  background: rgba(255, 255, 255, 0.08);
  color: #ccc;
}

/* Light theme */
.numpad-key-light.numpad-key-digit {
  background: rgba(0, 0, 0, 0.04);
  color: #1A1A1A;
}

.numpad-key-light.numpad-key-action {
  background: rgba(0, 0, 0, 0.02);
  color: #888;
}

.numpad-key-light.numpad-key-pressed.numpad-key-digit {
  background: rgba(5, 149, 115, 0.12);
  color: #111;
}

.numpad-key-light.numpad-key-pressed.numpad-key-action {
  background: rgba(0, 0, 0, 0.08);
  color: #555;
}

/* Desktop hover */
@media (hover: hover) {
  .numpad-key-dark.numpad-key-digit:hover:not(.numpad-key-disabled) {
    background: rgba(255, 255, 255, 0.09);
  }
  .numpad-key-dark.numpad-key-action:hover:not(.numpad-key-disabled) {
    background: rgba(255, 255, 255, 0.06);
  }
  .numpad-key-light.numpad-key-digit:hover:not(.numpad-key-disabled) {
    background: rgba(0, 0, 0, 0.07);
  }
  .numpad-key-light.numpad-key-action:hover:not(.numpad-key-disabled) {
    background: rgba(0, 0, 0, 0.05);
  }
}

/* Empty spacer */
.numpad-spacer {
  aspect-ratio: 1;
}

/* Disabled state */
.numpad-key-disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

/* Forgot PIN */
.forgot-pin-container {
  margin-top: 0.75rem;
}

.forgot-pin-btn {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

/* Responsive */
@media (max-width: 480px) {
  .pin-content {
    padding: 1.5rem 1.25rem;
    padding-bottom: max(1.5rem, env(safe-area-inset-bottom, 0px));
    gap: 0.75rem;
  }

  .lock-icon-bg {
    width: 64px;
    height: 64px;
  }

  .lock-icon-bg .q-icon {
    font-size: 30px !important;
  }

  .pin-subtitle {
    font-size: 13px;
    max-width: 260px;
  }

  .numpad-grid {
    max-width: 260px;
    gap: 8px;
  }

  .numpad-key {
    font-size: 24px;
    border-radius: 14px;
  }
}

@media (max-height: 700px) {
  .pin-content {
    padding: 1rem;
    padding-bottom: max(1rem, env(safe-area-inset-bottom, 0px));
    gap: 0.5rem;
  }

  .lock-icon-container {
    margin-bottom: 0;
  }

  .lock-icon-bg {
    width: 56px;
    height: 56px;
  }

  .lock-icon-bg .q-icon {
    font-size: 26px !important;
  }

  .pin-dots-container {
    padding: 0.5rem 0;
  }

  .numpad-grid {
    max-width: 240px;
    gap: 6px;
    margin-top: 0.25rem;
  }

  .numpad-key {
    font-size: 22px;
    border-radius: 12px;
  }
}
</style>
