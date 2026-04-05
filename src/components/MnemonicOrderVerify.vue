<template>
  <div class="mnemonic-order-verify">
    <!-- Status Message -->
    <div class="verify-status">
      <div v-if="isComplete" class="status-success">
        <div class="status-icon-wrap status-icon-success">
          <Icon icon="tabler:circle-check" width="24" height="24" />
        </div>
        <div class="status-text-wrap">
          <span class="status-title" :class="$q.dark.isActive ? 'status-title-success-dark' : 'status-title-success-light'">
            {{ $t('Backup verified') }}
          </span>
          <span class="status-desc" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">
            {{ $t('Store your recovery phrase safely offline.') }}
          </span>
        </div>
      </div>
      <div v-else-if="errorMessage" class="status-error">
        <div class="status-icon-wrap status-icon-error">
          <Icon icon="tabler:x" width="18" height="18" />
        </div>
        <span class="status-error-text">{{ errorMessage }}</span>
      </div>
      <div v-else class="status-default" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
        <Icon icon="tabler:hand-click" width="18" height="18" class="q-mr-xs" />
        {{ $t('Tap the words in order') }} — {{ selectedOrder.length }}/{{ mnemonic.length }}
      </div>
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
        <span
          v-if="getWordPosition(index) !== null"
          class="word-badge"
          :class="errorIndex === index ? 'badge-error' : 'badge-success'"
        >
          {{ getWordPosition(index) }}
        </span>
        <span class="word-label">{{ item.word }}</span>
      </button>
    </div>

    <!-- Action Buttons -->
    <div class="verify-actions">
      <button
        class="show-again-btn"
        :class="$q.dark.isActive ? 'btn-outline-dark' : 'btn-outline-light'"
        @click="$emit('show-phrase')"
      >
        <Icon icon="tabler:arrow-back" width="16" height="16" class="q-mr-xs" />
        {{ $t('Show phrase again') }}
      </button>

      <button
        v-if="isComplete"
        class="confirm-btn"
        @click="$emit('verify-success')"
      >
        {{ $t('Complete Backup') }}
      </button>
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
      selectedOrder: [],
      errorIndex: null,
      errorMessage: '',
      isComplete: false
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
      const wordsWithIndex = this.mnemonic.map((word, index) => ({
        word,
        originalIndex: index
      }))
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
      this.errorIndex = null
      this.errorMessage = ''

      const tappedWord = this.shuffledWords[shuffledIndex]
      const expectedPosition = this.selectedOrder.length
      const expectedWord = this.mnemonic[expectedPosition]

      // Match by word text, not original index — handles duplicate words gracefully
      if (tappedWord.word === expectedWord) {
        this.selectedOrder.push({
          shuffledIndex,
          position: expectedPosition + 1
        })
        if (this.selectedOrder.length === this.mnemonic.length) {
          this.isComplete = true
        }
      } else {
        this.errorIndex = shuffledIndex
        const ordinal = this.getOrdinal(expectedPosition + 1)
        this.errorMessage = this.$t('Wrong — expected the {ordinal} word', { ordinal })

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
        1: this.$t('1st'), 2: this.$t('2nd'), 3: this.$t('3rd'),
        4: this.$t('4th'), 5: this.$t('5th'), 6: this.$t('6th'),
        7: this.$t('7th'), 8: this.$t('8th'), 9: this.$t('9th'),
        10: this.$t('10th'), 11: this.$t('11th'), 12: this.$t('12th')
      }
      return ordinals[n] || `${n}th`
    },

    isWordSelected(shuffledIndex) {
      return this.selectedOrder.some(item => item.shuffledIndex === shuffledIndex)
    },

    getWordPosition(shuffledIndex) {
      if (this.errorIndex === shuffledIndex) {
        return this.selectedOrder.length + 1
      }
      const selected = this.selectedOrder.find(item => item.shuffledIndex === shuffledIndex)
      return selected ? selected.position : null
    },

    getWordState(shuffledIndex) {
      if (this.errorIndex === shuffledIndex) return 'chip-error'
      if (this.isWordSelected(shuffledIndex)) return 'chip-selected'
      return ''
    },

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
  gap: 1.25rem;
  width: 100%;
}

/* Status Messages */
.verify-status {
  text-align: center;
}

.status-default {
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  padding: 0.5rem 0;
}

.status-success {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 10px;
  background: rgba(21, 222, 114, 0.08);
  border: 1px solid rgba(21, 222, 114, 0.15);
}

.status-icon-wrap {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-icon-success {
  background: rgba(21, 222, 114, 0.15);
  color: #15DE72;
}

.status-text-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}

.status-title {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 700;
}

.status-title-success-dark {
  color: #15DE72;
}

.status-title-success-light {
  color: #059573;
}

.status-desc {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  line-height: 1.4;
}

.status-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.15);
}

.status-icon-error {
  background: rgba(239, 68, 68, 0.15);
  color: #EF4444;
  width: 26px;
  height: 26px;
}

.status-error-text {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #EF4444;
}

/* Words Grid */
.words-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

/* Word Chip */
.word-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 10px;
  border-radius: 10px;
  border: 1.5px solid;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  min-height: 42px;
  position: relative;
}

.word-chip.has-badge {
  justify-content: flex-start;
  padding-left: 5px;
  padding-right: 10px;
}

.chip-dark {
  background: #171717;
  border-color: rgba(255, 255, 255, 0.08);
  color: #FFFFFF;
}

.chip-dark:active:not(:disabled) {
  transform: scale(0.97);
  background: #1e1e1e;
}

.chip-light {
  background: #FFFFFF;
  border-color: #E5E7EB;
  color: #1F2937;
}

.chip-light:active:not(:disabled) {
  transform: scale(0.97);
  background: #F9FAFB;
}

/* Selected */
.chip-selected.chip-dark {
  border-color: rgba(21, 222, 114, 0.3) !important;
  background: rgba(21, 222, 114, 0.06) !important;
}

.chip-selected.chip-light {
  border-color: rgba(5, 149, 115, 0.3) !important;
  background: rgba(5, 149, 115, 0.04) !important;
}

/* Error */
.chip-error {
  border-color: #EF4444 !important;
  background: rgba(239, 68, 68, 0.06) !important;
  animation: shake 0.4s ease-in-out;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}

/* Badge */
.word-badge {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 700;
  color: #FFFFFF;
}

.badge-success {
  background: #15DE72;
}

.badge-error {
  background: #EF4444;
}

.word-label {
  font-family: 'Manrope', sans-serif;
}

.word-chip:disabled {
  cursor: default;
  opacity: 1;
}

/* Action Buttons */
.verify-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 0.25rem;
}

.show-again-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 44px;
  border-radius: 12px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.btn-outline-dark {
  background: transparent;
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
}

.btn-outline-dark:active {
  transform: scale(0.98);
}

.btn-outline-light {
  background: transparent;
  border: 1.5px solid #E5E7EB;
  color: #6B7280;
}

.btn-outline-light:active {
  transform: scale(0.98);
}

.confirm-btn {
  width: 100%;
  height: 44px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(135deg, #3B82F6, #2563EB);
  color: #fff;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
}

.confirm-btn:active {
  transform: scale(0.97);
}

/* Responsive */
@media (max-width: 480px) {
  .words-grid {
    gap: 6px;
  }

  .word-chip {
    padding: 8px 8px;
    font-size: 12px;
    min-height: 38px;
  }

  .word-badge {
    width: 22px;
    height: 22px;
    font-size: 10px;
  }

  .show-again-btn,
  .confirm-btn {
    height: 40px;
    font-size: 13px;
  }
}

@media (max-height: 700px) {
  .mnemonic-order-verify {
    gap: 1rem;
  }

  .words-grid {
    gap: 6px;
  }

  .word-chip {
    padding: 7px 8px;
    font-size: 12px;
    min-height: 36px;
  }

  .word-badge {
    width: 22px;
    height: 22px;
    font-size: 10px;
  }

  .verify-actions {
    gap: 8px;
    margin-top: 0;
  }

  .show-again-btn,
  .confirm-btn {
    height: 38px;
    font-size: 12px;
  }
}
</style>
