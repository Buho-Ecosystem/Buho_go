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
          <div class="success-circle">
            <svg class="checkmark" viewBox="0 0 52 52">
              <circle class="checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
              <path class="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
            </svg>
          </div>
          <div class="pulse-ring"></div>
          <div class="pulse-ring delay-1"></div>
          <div class="pulse-ring delay-2"></div>
        </div>

        <!-- Amount Display -->
        <div class="amount-section" :class="{ 'fade-in': showAmount }">
          <div class="amount-label" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
            {{ $t('Payment Received') }}
          </div>
          <div class="amount-value" :class="$q.dark.isActive ? 'text-white' : 'text-grey-9'">
            {{ formatAmount(amount) }}
          </div>
          <div v-if="fiatAmount" class="fiat-value" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ fiatAmount }}
          </div>
        </div>

        <!-- Description -->
        <div v-if="description" class="description-section" :class="{ 'fade-in': showAmount }">
          <div class="description-text" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'">
            {{ description }}
          </div>
        </div>

        <!-- Auto-close countdown -->
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
      </div>

      <!-- Confetti particles (optional celebration) -->
      <div class="confetti-container" v-if="showConfetti">
        <div v-for="i in 50" :key="i" class="confetti" :style="getConfettiStyle(i)"></div>
      </div>
    </div>
  </q-dialog>
</template>

<script>
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
    autoCloseDelay: {
      type: Number,
      default: 5 // seconds
    }
  },
  emits: ['update:modelValue', 'closed'],
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

      // Stagger the animations
      setTimeout(() => {
        this.showAnimation = true
        this.showConfetti = true
      }, 100)

      setTimeout(() => {
        this.showAmount = true
      }, 600)

      setTimeout(() => {
        this.showCountdown = true
        this.startCountdown()
      }, 1000)
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
      if (!sats) return '0 sats'
      return new Intl.NumberFormat('en-US').format(sats) + ' sats'
    },

    getConfettiStyle(index) {
      const colors = ['#15DE72', '#FFD43B', '#3B82F6', '#8B5CF6', '#F59E0B']
      const color = colors[index % colors.length]
      const left = Math.random() * 100
      const animDuration = 2 + Math.random() * 2
      const animDelay = Math.random() * 0.5
      const size = 6 + Math.random() * 6

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
  background: linear-gradient(180deg, #0C0C0C 0%, #0A1A0F 100%);
}

.backdrop-light {
  background: linear-gradient(180deg, #FFFFFF 0%, #F0FDF4 100%);
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
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: scale(0.5);
  transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.success-animation.animate {
  opacity: 1;
  transform: scale(1);
}

.success-circle {
  width: 100px;
  height: 100px;
  background: linear-gradient(135deg, #15DE72 0%, #059573 100%);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 32px rgba(21, 222, 114, 0.4);
}

.checkmark {
  width: 52px;
  height: 52px;
}

.checkmark-circle {
  stroke: rgba(255, 255, 255, 0.3);
  stroke-width: 2;
  stroke-dasharray: 166;
  stroke-dashoffset: 166;
  animation: stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) 0.3s forwards;
}

.checkmark-check {
  stroke: white;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 48;
  stroke-dashoffset: 48;
  animation: stroke 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.6s forwards;
}

@keyframes stroke {
  100% {
    stroke-dashoffset: 0;
  }
}

/* Pulse rings */
.pulse-ring {
  position: absolute;
  width: 100px;
  height: 100px;
  border: 2px solid rgba(21, 222, 114, 0.5);
  border-radius: 50%;
  animation: pulse-expand 2s ease-out infinite;
}

.pulse-ring.delay-1 {
  animation-delay: 0.5s;
}

.pulse-ring.delay-2 {
  animation-delay: 1s;
}

@keyframes pulse-expand {
  0% {
    transform: scale(1);
    opacity: 0.8;
  }
  100% {
    transform: scale(2);
    opacity: 0;
  }
}

/* Amount Section */
.amount-section {
  text-align: center;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.5s ease;
}

.amount-section.fade-in {
  opacity: 1;
  transform: translateY(0);
}

.amount-label {
  font-family: 'Inter', sans-serif;
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.amount-value {
  font-family: 'Inter', sans-serif;
  font-size: 3rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.fiat-value {
  font-family: 'Inter', sans-serif;
  font-size: 18px;
  font-weight: 400;
  margin-top: 0.5rem;
}

/* Description Section */
.description-section {
  text-align: center;
  max-width: 300px;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.5s ease;
  transition-delay: 0.1s;
}

.description-section.fade-in {
  opacity: 1;
  transform: translateY(0);
}

.description-text {
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  line-height: 1.4;
}

/* Countdown Section */
.countdown-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  opacity: 0;
  transform: translateY(20px);
  transition: all 0.5s ease;
}

.countdown-section.fade-in {
  opacity: 1;
  transform: translateY(0);
}

.countdown-text {
  font-family: 'Inter', sans-serif;
  font-size: 14px;
}

.close-now-btn {
  padding: 0.5rem 1.5rem;
  border-radius: 100px;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.2s ease;
}

.close-btn-dark {
  background: rgba(255, 255, 255, 0.1);
  color: #FFF;
}

.close-btn-dark:hover {
  background: rgba(255, 255, 255, 0.15);
}

.close-btn-light {
  background: rgba(0, 0, 0, 0.05);
  color: #374151;
}

.close-btn-light:hover {
  background: rgba(0, 0, 0, 0.1);
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
    transform: translateY(100vh) rotate(720deg);
    opacity: 0;
  }
}

/* Responsive */
@media (max-width: 480px) {
  .amount-value {
    font-size: 2.5rem;
  }

  .success-animation {
    width: 100px;
    height: 100px;
  }

  .success-circle {
    width: 80px;
    height: 80px;
  }

  .checkmark {
    width: 42px;
    height: 42px;
  }

  .pulse-ring {
    width: 80px;
    height: 80px;
  }
}
</style>
