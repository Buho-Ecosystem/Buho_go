<template>
  <div class="mnemonic-verify" :class="$q.dark.isActive ? 'verify-dark' : 'verify-light'">
    <!-- Instructions -->
    <div class="verify-instructions" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
      {{ $t('Enter the following words from your seed phrase to verify you\'ve saved it correctly.') }}
    </div>

    <!-- Word Inputs -->
    <div class="word-inputs">
      <div
        v-for="(wordIndex, i) in computedWordIndices"
        :key="wordIndex"
        class="word-input-group"
      >
        <label
          class="word-label"
          :class="$q.dark.isActive ? 'label-dark' : 'label-light'"
        >
          {{ $t('Word') }} #{{ wordIndex + 1 }}
        </label>
        <input
          v-model="userInputs[i]"
          type="text"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          class="word-input"
          :class="[
            $q.dark.isActive ? 'input-dark' : 'input-light',
            getInputState(i)
          ]"
          :placeholder="$t('Enter word')"
          @input="onInputChange(i)"
          @keydown.enter="focusNext(i)"
          :ref="el => inputRefs[i] = el"
        />
        <div v-if="showErrors && !isWordCorrect(i)" class="input-error">
          {{ $t('Incorrect word') }}
        </div>
      </div>
    </div>

    <!-- Verify Button (optional, can be external) -->
    <div class="verify-action" v-if="showButton">
      <q-btn
        class="verify-btn"
        :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
        :loading="isVerifying"
        :disable="!allInputsFilled"
        @click="verify"
        no-caps
        unelevated
      >
        {{ $t('Verify') }}
      </q-btn>
    </div>
  </div>
</template>

<script>
export default {
  name: 'MnemonicVerify',
  props: {
    mnemonic: {
      type: Array,
      required: true,
      validator: (value) => value.length === 12 || value.length === 24
    },
    wordIndices: {
      type: Array,
      default: null // Will be randomly generated if not provided
    },
    wordCount: {
      type: Number,
      default: 3
    },
    showButton: {
      type: Boolean,
      default: true
    },
    showErrors: {
      type: Boolean,
      default: true
    }
  },
  emits: ['verify-success', 'verify-failed', 'input-change'],
  data() {
    return {
      userInputs: [],
      inputRefs: [],
      computedWordIndices: [],
      isVerifying: false,
      hasAttempted: false
    }
  },
  computed: {
    allInputsFilled() {
      return this.userInputs.every(input => input && input.trim().length > 0);
    }
  },
  watch: {
    mnemonic: {
      immediate: true,
      handler() {
        this.initializeComponent();
      }
    }
  },
  methods: {
    initializeComponent() {
      // Generate random word indices if not provided
      if (this.wordIndices && this.wordIndices.length > 0) {
        this.computedWordIndices = this.wordIndices;
      } else {
        this.computedWordIndices = this.generateRandomIndices();
      }

      // Initialize inputs
      this.userInputs = new Array(this.computedWordIndices.length).fill('');
      this.inputRefs = [];
      this.hasAttempted = false;
    },

    generateRandomIndices() {
      const indices = [];
      const usedIndices = new Set();

      while (indices.length < this.wordCount) {
        const randomIndex = Math.floor(Math.random() * this.mnemonic.length);
        if (!usedIndices.has(randomIndex)) {
          usedIndices.add(randomIndex);
          indices.push(randomIndex);
        }
      }

      // Sort indices so they appear in order
      return indices.sort((a, b) => a - b);
    },

    onInputChange(index) {
      // Normalize input to lowercase
      this.userInputs[index] = this.userInputs[index].toLowerCase().trim();
      this.$emit('input-change', {
        inputs: this.userInputs,
        allFilled: this.allInputsFilled,
        allCorrect: this.areAllWordsCorrect()
      });
    },

    focusNext(index) {
      if (index < this.computedWordIndices.length - 1 && this.inputRefs[index + 1]) {
        this.inputRefs[index + 1].focus();
      } else if (this.allInputsFilled && this.showButton) {
        this.verify();
      }
    },

    isWordCorrect(index) {
      const wordIndex = this.computedWordIndices[index];
      const expectedWord = this.mnemonic[wordIndex].toLowerCase();
      const userWord = (this.userInputs[index] || '').toLowerCase().trim();
      return userWord === expectedWord;
    },

    areAllWordsCorrect() {
      return this.computedWordIndices.every((_, index) => this.isWordCorrect(index));
    },

    getInputState(index) {
      if (!this.hasAttempted || !this.userInputs[index]) return '';
      return this.isWordCorrect(index) ? 'input-success' : 'input-error-state';
    },

    verify() {
      this.hasAttempted = true;
      this.isVerifying = true;

      setTimeout(() => {
        this.isVerifying = false;

        if (this.areAllWordsCorrect()) {
          this.$emit('verify-success');
        } else {
          this.$emit('verify-failed', {
            incorrectIndices: this.computedWordIndices.filter((_, i) => !this.isWordCorrect(i))
          });
        }
      }, 300);
    },

    // Public methods for parent component access
    reset() {
      this.initializeComponent();
    },

    getVerificationState() {
      return {
        allFilled: this.allInputsFilled,
        allCorrect: this.areAllWordsCorrect(),
        hasAttempted: this.hasAttempted
      };
    }
  }
}
</script>

<style scoped>
.mnemonic-verify {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
}

/* Instructions */
.verify-instructions {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  text-align: center;
  max-width: 320px;
  margin: 0 auto;
}

/* Word Inputs */
.word-inputs {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.word-input-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.word-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 600;
}

.label-dark {
  color: #B0B0B0;
}

.label-light {
  color: #6B7280;
}

.word-input {
  width: 100%;
  padding: 14px 16px;
  border-radius: 16px;
  border: 2px solid;
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 15px;
  font-weight: 500;
  outline: none;
  transition: all 0.2s ease;
}

.input-dark {
  background: #171717;
  border-color: #2A342A;
  color: #FFFFFF;
}

.input-dark:focus {
  border-color: #15DE72;
}

.input-dark::placeholder {
  color: #6B7280;
}

.input-light {
  background: #F8F8F8;
  border-color: #EBEBEB;
  color: #212121;
}

.input-light:focus {
  border-color: #059573;
}

.input-light::placeholder {
  color: #9CA3AF;
}

/* Input States */
.input-success {
  border-color: #15DE72 !important;
}

.input-error-state {
  border-color: #ff4444 !important;
}

.input-error {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  color: #ff4444;
  padding-left: 4px;
}

/* Verify Action */
.verify-action {
  margin-top: 0.5rem;
}

.verify-btn {
  width: 100%;
  height: 52px;
  border-radius: 24px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* Responsive Design */
@media (max-width: 480px) {
  .verify-instructions {
    font-size: 13px;
    max-width: 280px;
  }

  .word-input {
    padding: 12px 14px;
    font-size: 14px;
  }

  .verify-btn {
    height: 48px;
  }
}
</style>
