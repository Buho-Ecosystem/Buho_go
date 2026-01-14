<template>
  <div class="mnemonic-order-verify" :class="$q.dark.isActive ? 'verify-dark' : 'verify-light'">
    <!-- Header -->
    <div class="verify-header">
      <h3
        class="verify-title"
        :class="[
          $q.dark.isActive ? 'text-white' : 'text-dark',
          isComplete ? 'success-title' : '',
          errorMessage ? 'error-title' : ''
        ]"
      >
        {{ headerMessage }}
      </h3>
      <!-- Security reminder shown when complete -->
      <p v-if="isComplete" class="security-reminder" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">
        {{ $t('We cannot recover your phrase if you lose it. Store it safely offline.') }}
      </p>
    </div>

    <!-- Words Grid -->
    <div class="words-grid">
      <button
        v-for="(item, index) in shuffledWords"
        :key="index"
        class="word-chip"
        :class="[
          $q.dark.isActive ? 'chip-dark' : 'chip-light',
          getWordState(index),
          getWordPosition(index) !== null ? 'has-badge' : ''
        ]"
        :disabled="isWordSelected(index) || isComplete"
        @click="handleWordTap(index)"
      >
        <!-- Badge inside chip on the left -->
        <span
          v-if="getWordPosition(index) !== null"
          class="word-badge"
          :class="errorIndex === index ? 'badge-error' : 'badge-success'"
        >
          {{ getWordPosition(index) }}
        </span>
        <span class="word-text">{{ item.word }}</span>
      </button>
    </div>

    <!-- Action Buttons -->
    <div class="verify-actions">
      <button
        class="show-again-btn"
        :class="$q.dark.isActive ? 'btn-outline-dark' : 'btn-outline-light'"
        @click="$emit('show-phrase')"
      >
        {{ $t('Show me again') }}
      </button>

      <q-btn
        class="continue-btn"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        :disable="!isComplete"
        @click="$emit('verify-success')"
        no-caps
        unelevated
      >
        {{ $t('Continue') }}
      </q-btn>
    </div>
  </div>
</template>

<script>
export default {
  name: 'MnemonicOrderVerify',
  props: {
    mnemonic: {
      type: Array,
      required: true,
      validator: (value) => value.length === 12 || value.length === 24
    }
  },
  emits: ['verify-success', 'show-phrase'],
  data() {
    return {
      shuffledWords: [],
      selectedOrder: [], // Array of { shuffledIndex, position }
      errorIndex: null,
      errorMessage: '',
      isComplete: false
    }
  },
  computed: {
    headerMessage() {
      if (this.isComplete) {
        return this.$t('Perfect. Make sure to securely store your recovery phrase.')
      }
      if (this.errorMessage) {
        return this.errorMessage
      }
      return this.$t('Tap the words in the correct order.')
    }
  },
  watch: {
    mnemonic: {
      immediate: true,
      handler() {
        this.initializeComponent()
      }
    }
  },
  methods: {
    initializeComponent() {
      // Create array with word and original index
      const wordsWithIndex = this.mnemonic.map((word, index) => ({
        word,
        originalIndex: index
      }))

      // Shuffle the array using Fisher-Yates algorithm
      this.shuffledWords = this.shuffleArray([...wordsWithIndex])
      this.selectedOrder = []
      this.errorIndex = null
      this.errorMessage = ''
      this.isComplete = false
    },

    shuffleArray(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]]
      }
      return array
    },

    handleWordTap(shuffledIndex) {
      // Clear previous error
      this.errorIndex = null
      this.errorMessage = ''

      const tappedWord = this.shuffledWords[shuffledIndex]
      const expectedPosition = this.selectedOrder.length // 0-indexed expected original index

      if (tappedWord.originalIndex === expectedPosition) {
        // Correct word!
        this.selectedOrder.push({
          shuffledIndex,
          position: expectedPosition + 1 // 1-indexed for display
        })

        if (this.selectedOrder.length === this.mnemonic.length) {
          this.isComplete = true
        }
      } else {
        // Wrong word!
        this.errorIndex = shuffledIndex
        const ordinal = this.getOrdinal(expectedPosition + 1)
        this.errorMessage = this.$t('Sorry, that\'s not the correct {ordinal} word. Give it another try.', { ordinal })

        // Clear error after delay
        setTimeout(() => {
          if (this.errorIndex === shuffledIndex) {
            this.errorIndex = null
            this.errorMessage = ''
          }
        }, 2000)
      }
    },

    getOrdinal(n) {
      const ordinals = {
        1: this.$t('1st'),
        2: this.$t('2nd'),
        3: this.$t('3rd'),
        4: this.$t('4th'),
        5: this.$t('5th'),
        6: this.$t('6th'),
        7: this.$t('7th'),
        8: this.$t('8th'),
        9: this.$t('9th'),
        10: this.$t('10th'),
        11: this.$t('11th'),
        12: this.$t('12th')
      }
      return ordinals[n] || `${n}th`
    },

    isWordSelected(shuffledIndex) {
      return this.selectedOrder.some(item => item.shuffledIndex === shuffledIndex)
    },

    getWordPosition(shuffledIndex) {
      // Check if this is the error word
      if (this.errorIndex === shuffledIndex) {
        return this.selectedOrder.length + 1
      }

      const selected = this.selectedOrder.find(item => item.shuffledIndex === shuffledIndex)
      return selected ? selected.position : null
    },

    getWordState(shuffledIndex) {
      if (this.errorIndex === shuffledIndex) {
        return 'chip-error'
      }
      if (this.isWordSelected(shuffledIndex)) {
        return 'chip-selected'
      }
      return ''
    },

    // Public method for parent to reset
    reset() {
      this.initializeComponent()
    }
  }
}
</script>

<style scoped>
.mnemonic-order-verify {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
}

/* Header */
.verify-header {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.verify-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.4;
  margin: 0;
  max-width: 320px;
  transition: color 0.3s ease;
}

.success-title {
  color: #059573 !important;
}

.verify-dark .success-title {
  color: #15DE72 !important;
}

.error-title {
  color: #E53935 !important;
}

.security-reminder {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  margin: 0.5rem 0 0;
  max-width: 280px;
}

/* Words Grid */
.words-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

/* Word Chip - pill shape */
.word-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 50px;
  border: 1.5px solid;
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: all 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  min-height: 44px;
}

/* When chip has badge, align content to left */
.word-chip.has-badge {
  justify-content: flex-start;
  padding-left: 6px;
  padding-right: 16px;
}

.chip-dark {
  background: #171717;
  border-color: #333333;
  color: #FFFFFF;
}

.chip-dark:hover:not(:disabled) {
  border-color: #444444;
  background: #1E1E1E;
}

.chip-dark:active:not(:disabled) {
  transform: scale(0.98);
}

.chip-light {
  background: #FFFFFF;
  border-color: #D0D0D0;
  color: #212121;
}

.chip-light:hover:not(:disabled) {
  border-color: #BDBDBD;
  background: #FAFAFA;
}

.chip-light:active:not(:disabled) {
  transform: scale(0.98);
}

/* Selected State */
.chip-selected {
  border-color: #4CAF50 !important;
}

/* Error State */
.chip-error {
  border-color: #E53935 !important;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-3px); }
  40% { transform: translateX(3px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
}

.chip-error {
  animation: shake 0.4s ease-in-out;
}

/* Word Badge - inside chip on the left */
.word-badge {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #FFFFFF;
}

.badge-success {
  background: #4CAF50;
}

.badge-error {
  background: #E53935;
}

/* Word Text */
.word-text {
  transition: color 0.2s ease;
}

/* Disabled state */
.word-chip:disabled {
  cursor: default;
  opacity: 1;
}

/* Action Buttons */
.verify-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 0.5rem;
}

.show-again-btn {
  width: 100%;
  height: 48px;
  border-radius: 24px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.btn-outline-dark {
  background: transparent;
  border: 1.5px solid #333333;
  color: #FFFFFF;
}

.btn-outline-dark:hover {
  border-color: #444444;
  background: rgba(255, 255, 255, 0.05);
}

.btn-outline-light {
  background: transparent;
  border: 1.5px solid #D0D0D0;
  color: #212121;
}

.btn-outline-light:hover {
  border-color: #BDBDBD;
  background: rgba(0, 0, 0, 0.02);
}

.continue-btn {
  width: 100%;
  height: 52px;
  border-radius: 24px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* Responsive Design */
@media (max-width: 480px) {
  .mnemonic-order-verify {
    gap: 1.25rem;
  }

  .verify-title {
    font-size: 16px;
  }

  .security-reminder {
    font-size: 12px;
  }

  .words-grid {
    gap: 8px;
  }

  .word-chip {
    padding: 8px 14px;
    font-size: 12px;
    min-height: 40px;
    gap: 6px;
  }

  .word-chip.has-badge {
    padding-left: 5px;
    padding-right: 14px;
  }

  .word-badge {
    width: 28px;
    height: 28px;
    font-size: 12px;
  }

  .show-again-btn {
    height: 44px;
  }

  .continue-btn {
    height: 48px;
  }
}

@media (max-height: 750px) {
  .mnemonic-order-verify {
    gap: 1rem;
  }

  .verify-title {
    font-size: 16px;
  }

  .security-reminder {
    font-size: 11px;
    margin-top: 0.25rem;
  }

  .words-grid {
    gap: 8px;
  }

  .word-chip {
    padding: 8px 12px;
    font-size: 12px;
    min-height: 38px;
    gap: 6px;
  }

  .word-chip.has-badge {
    padding-left: 4px;
    padding-right: 12px;
  }

  .word-badge {
    width: 26px;
    height: 26px;
    font-size: 11px;
  }

  .verify-actions {
    gap: 10px;
    margin-top: 0.25rem;
  }

  .show-again-btn {
    height: 42px;
  }

  .continue-btn {
    height: 46px;
  }
}

@media (max-height: 650px) {
  .mnemonic-order-verify {
    gap: 0.75rem;
  }

  .verify-header {
    gap: 0.25rem;
  }

  .verify-title {
    font-size: 15px;
  }

  .security-reminder {
    font-size: 10px;
  }

  .words-grid {
    gap: 6px;
  }

  .word-chip {
    padding: 6px 10px;
    font-size: 11px;
    min-height: 34px;
    gap: 5px;
  }

  .word-chip.has-badge {
    padding-left: 3px;
    padding-right: 10px;
  }

  .word-badge {
    width: 24px;
    height: 24px;
    font-size: 10px;
  }

  .verify-actions {
    gap: 8px;
    margin-top: 0;
  }

  .show-again-btn {
    height: 38px;
    font-size: 13px;
  }

  .continue-btn {
    height: 42px;
    font-size: 13px;
  }
}

@media (max-height: 550px) {
  .mnemonic-order-verify {
    gap: 0.5rem;
  }

  .verify-title {
    font-size: 14px;
  }

  .security-reminder {
    font-size: 9px;
    margin-top: 0;
  }

  .words-grid {
    gap: 4px;
  }

  .word-chip {
    padding: 5px 8px;
    font-size: 10px;
    min-height: 30px;
    gap: 4px;
    border-radius: 30px;
  }

  .word-chip.has-badge {
    padding-left: 2px;
    padding-right: 8px;
  }

  .word-badge {
    width: 22px;
    height: 22px;
    font-size: 9px;
  }

  .verify-actions {
    gap: 6px;
  }

  .show-again-btn {
    height: 34px;
    font-size: 12px;
    border-radius: 20px;
  }

  .continue-btn {
    height: 38px;
    font-size: 12px;
    border-radius: 20px;
  }
}
</style>
