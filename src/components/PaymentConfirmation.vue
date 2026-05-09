<template>
  <q-dialog
    v-model="show"
    persistent
    maximized
    transition-show="fade"
    transition-hide="fade"
    class="payment-confirmation"
  >
    <div class="confirmation-backdrop" :class="$q.dark.isActive ? 'backdrop-dark' : 'backdrop-light'">
      <div class="confirmation-content">
        <!-- Success Animation -->
        <div class="success-animation" :class="{ 'animate': showAnimation }">
          <div class="success-circle" :class="accentColor === 'orange' ? 'bitcoin-theme' : ''">
            <svg class="checkmark" viewBox="0 0 52 52">
              <path class="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
            </svg>
          </div>
          <div
            v-if="showAnimation"
            class="pulse-ring-once"
            :class="accentColor === 'orange' ? 'bitcoin-pulse' : ''"
          ></div>
        </div>

        <!-- Amount Display -->
        <div class="amount-section" :class="{ 'fade-in': showAmount }">
          <div class="amount-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
            {{ label || $t('Payment Received') }}
          </div>
          <div class="amount-value" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">
            {{ formatAmount(amount) }}
          </div>
          <div v-if="fiatAmount" class="fiat-value" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ fiatAmount }}
          </div>
        </div>
      </div>

      <!-- Bottom area: countdown + description -->
      <div class="bottom-area">
        <div class="countdown-section" :class="{ 'fade-in': showCountdown }">
          <div class="countdown-text" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ $t('Closing in {seconds}s...', { seconds: countdown }) }}
          </div>
          <q-btn
            flat
            no-caps
            class="close-now-btn"
            :class="$q.dark.isActive ? 'close-btn-dark' : 'close-btn-light'"
            @click="closeNow"
          >
            {{ $t('Close Now') }}
          </q-btn>
        </div>

        <div
          v-if="description"
          class="description-section"
          :class="[{ 'fade-in': showCountdown }, $q.dark.isActive ? 'desc-dark' : 'desc-light']"
        >
          {{ description }}
        </div>
      </div>

      <!-- Confetti particles (disabled for now — keep for future use)
      <div class="confetti-container" v-if="showConfetti">
        <div v-for="i in 24" :key="i" class="confetti" :style="getConfettiStyle(i)"></div>
      </div>
      -->

    </div>
  </q-dialog>
</template>

<script>
import { formatAmount as formatAmountUtil } from '../utils/amountFormatting.js';
import { useWalletStore } from '../stores/wallet';

export default {
  name: 'PaymentConfirmation',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    amount: {
      type: Number,
      default: 0
    },
    fiatAmount: {
      type: String,
      default: ''
    },
    description: {
      type: String,
      default: ''
    },
    label: {
      type: String,
      default: ''
    },
    autoCloseDelay: {
      type: Number,
      default: 5
    },
    accentColor: {
      type: String,
      default: 'green'
    }
  },
  emits: ['update:modelValue', 'closed'],
  setup() {
    const walletStore = useWalletStore();
    return {
      walletStore
    };
  },
  data() {
    return {
      showAnimation: false,
      showAmount: false,
      showCountdown: false,
      showConfetti: false,
      countdown: 5,
      countdownInterval: null,
      animationTimeout: null
    }
  },
  computed: {
    show: {
      get() {
        return this.modelValue
      },
      set(value) {
        this.$emit('update:modelValue', value)
      }
    }
  },
  watch: {
    modelValue(newVal) {
      if (newVal) {
        this.startAnimationSequence()
      } else {
        this.cleanup()
      }
    }
  },
  beforeUnmount() {
    this.cleanup()
  },
  methods: {
    startAnimationSequence() {
      this.countdown = this.autoCloseDelay
      this.showAnimation = false
      this.showAmount = false
      this.showCountdown = false
      this.showConfetti = false

      setTimeout(() => {
        this.showAnimation = true
        // this.showConfetti = true // confetti disabled for now
      }, 80)

      setTimeout(() => {
        this.showAmount = true
      }, 380)

      setTimeout(() => {
        this.showCountdown = true
        this.startCountdown()
      }, 700)
    },

    startCountdown() {
      this.countdownInterval = setInterval(() => {
        this.countdown--
        if (this.countdown <= 0) {
          this.closeNow()
        }
      }, 1000)
    },

    closeNow() {
      this.cleanup()
      this.show = false
      this.$emit('closed')
    },

    cleanup() {
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval)
        this.countdownInterval = null
      }
      if (this.animationTimeout) {
        clearTimeout(this.animationTimeout)
        this.animationTimeout = null
      }
    },

    formatAmount(sats) {
      if (!sats) return formatAmountUtil(0, this.walletStore.useBip177Format);
      return formatAmountUtil(sats, this.walletStore.useBip177Format);
    },

    getConfettiStyle(index) {
      const greenColors = ['#34C759', '#FFD43B', '#3B82F6', '#8B5CF6', '#F59E0B']
      const orangeColors = ['#F7931A', '#FFD43B', '#34C759', '#FF9500', '#FFCC00']
      const colors = this.accentColor === 'orange' ? orangeColors : greenColors
      const color = colors[index % colors.length]
      const left = Math.random() * 100
      const animDuration = 1.4 + Math.random() * 0.6
      const animDelay = Math.random() * 0.3
      const size = 6 + Math.random() * 5

      return {
        left: `${left}%`,
        backgroundColor: color,
        width: `${size}px`,
        height: `${size}px`,
        animationDuration: `${animDuration}s`,
        animationDelay: `${animDelay}s`
      }
    }
  }
}
</script>

<style scoped>
.payment-confirmation :deep(.q-dialog__inner) {
  padding: 0;
}

.confirmation-backdrop {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
}

.backdrop-dark {
  background: #0C0C0C;
}

.backdrop-light {
  background: var(--bg-primary);
}

.confirmation-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rem;
  padding: 2rem;
  z-index: 10;
}

/* Success Animation */
.success-animation {
  position: relative;
  width: 110px;
  height: 110px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
}

.success-animation.animate {
  animation: zoom-in 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}

@keyframes zoom-in {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }
  60% {
    opacity: 1;
    transform: scale(1.06);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

.success-circle {
  width: 110px;
  height: 110px;
  background: #15DE72;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.success-circle.bitcoin-theme {
  background: #F7931A;
}

.checkmark {
  width: 52px;
  height: 52px;
}

.checkmark-check {
  stroke: white;
  stroke-width: 3.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 48;
  stroke-dashoffset: 48;
  animation: stroke 0.32s cubic-bezier(0.65, 0, 0.45, 1) 0.18s forwards;
}

@keyframes stroke {
  100% {
    stroke-dashoffset: 0;
  }
}

/* One-shot pulse ring (fires once on mount, then gone) */
.pulse-ring-once {
  position: absolute;
  width: 110px;
  height: 110px;
  border: 2px solid rgba(21, 222, 114, 0.45);
  border-radius: 50%;
  animation: pulse-once 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
  pointer-events: none;
}

.pulse-ring-once.bitcoin-pulse {
  border-color: rgba(247, 147, 26, 0.45);
}

@keyframes pulse-once {
  0% {
    transform: scale(1);
    opacity: 0.7;
  }
  100% {
    transform: scale(1.7);
    opacity: 0;
  }
}

/* Amount Section */
.amount-section {
  text-align: center;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.4s cubic-bezier(0.2, 0.7, 0.2, 1),
              transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1);
}

.amount-section.fade-in {
  opacity: 1;
  transform: translateY(0);
}

.amount-label {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.amount-value {
  font-family: 'Manrope', sans-serif;
  font-size: 3rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.fiat-value {
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 500;
  margin-top: 0.5rem;
  opacity: 0.7;
}

/* Bottom area: countdown + description, anchored toward bottom */
.bottom-area {
  position: absolute;
  left: 0;
  right: 0;
  bottom: max(2rem, env(safe-area-inset-bottom, 2rem));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
  z-index: 10;
  padding: 0 1.5rem;
}

.countdown-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.4s cubic-bezier(0.2, 0.7, 0.2, 1),
              transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1);
}

.countdown-section.fade-in {
  opacity: 1;
  transform: translateY(0);
}

.countdown-text {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
}

.close-now-btn {
  padding: 10px 28px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 600;
  transition: background-color 0.2s ease;
}

.close-btn-dark {
  background: rgba(255, 255, 255, 0.08);
  color: #FFF;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.close-btn-dark:hover {
  background: rgba(255, 255, 255, 0.12);
}

.close-btn-light {
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-primary);
  border: 1px solid var(--border-card);
}

.close-btn-light:hover {
  background: rgba(0, 0, 0, 0.08);
}

/* Description (e.g. "BuhoGO Payment") — centered footer */
.description-section {
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.4s cubic-bezier(0.2, 0.7, 0.2, 1),
              transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1);
  transition-delay: 0.08s;
  max-width: 320px;
  line-height: 1.4;
  word-break: break-word;
}

.description-section.fade-in {
  opacity: 1;
  transform: translateY(0);
}

.desc-dark {
  color: rgba(255, 255, 255, 0.45);
}

.desc-light {
  color: rgba(0, 0, 0, 0.45);
}

/* Confetti */
.confetti-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: hidden;
}

.confetti {
  position: absolute;
  top: -10px;
  border-radius: 2px;
  animation: confetti-fall linear forwards;
}

@keyframes confetti-fall {
  0% {
    transform: translateY(0) rotate(0deg);
    opacity: 1;
  }
  100% {
    transform: translateY(100vh) rotate(540deg);
    opacity: 0;
  }
}

/* Reduced motion: disable all entry/exit animation */
@media (prefers-reduced-motion: reduce) {
  .success-animation,
  .amount-section,
  .countdown-section,
  .description-section {
    transition: none !important;
    animation: none !important;
    transform: none !important;
    opacity: 1 !important;
  }
  .checkmark-check {
    animation: none !important;
    stroke-dashoffset: 0 !important;
  }
  .pulse-ring-once,
  .confetti-container {
    display: none !important;
  }
}

/* Responsive */
@media (max-width: 480px) {
  .amount-value {
    font-size: 2.5rem;
  }

  .success-animation,
  .success-circle,
  .pulse-ring-once {
    width: 96px;
    height: 96px;
  }

  .checkmark {
    width: 44px;
    height: 44px;
  }
}
</style>
