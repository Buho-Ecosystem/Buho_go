<template>
  <div class="mnemonic-display" :class="$q.dark.isActive ? 'mnemonic-dark' : 'mnemonic-light'">
    <!-- Warning Banner -->
    <div class="warning-banner" v-if="showWarning">
      <q-icon name="las la-exclamation-triangle" size="20px" class="warning-icon" />
      <div class="warning-text">
        {{ $t('Write these words down and store them safely. Anyone with these words can access your funds. Never share them.') }}
      </div>
    </div>

    <!-- Words Grid -->
    <div class="words-grid">
      <div
        v-for="(word, index) in words"
        :key="index"
        class="word-item"
        :class="$q.dark.isActive ? 'word-item-dark' : 'word-item-light'"
      >
        <span class="word-number" :class="$q.dark.isActive ? 'number-dark' : 'number-light'">
          {{ index + 1 }}
        </span>
        <span class="word-text" :class="blurred ? 'blurred' : ''">
          {{ word }}
        </span>
      </div>
    </div>

    <!-- Blur Toggle -->
    <div class="blur-toggle" v-if="allowBlur">
      <q-btn
        flat
        no-caps
        dense
        class="toggle-btn"
        :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
        @click="blurred = !blurred"
      >
        <q-icon :name="blurred ? 'las la-eye' : 'las la-eye-slash'" size="18px" class="q-mr-xs" />
        {{ blurred ? $t('Show words') : $t('Hide words') }}
      </q-btn>
    </div>

    <!-- Copy Button -->
    <div class="copy-section" v-if="showCopy">
      <q-btn
        flat
        no-caps
        class="copy-btn"
        :class="$q.dark.isActive ? 'copy-btn-dark' : 'copy-btn-light'"
        @click="copyWords"
      >
        <q-icon name="las la-copy" size="18px" class="q-mr-sm" />
        {{ copied ? $t('Copied!') : $t('Copy to clipboard') }}
      </q-btn>
    </div>
  </div>
</template>

<script>
export default {
  name: 'MnemonicDisplay',
  props: {
    words: {
      type: Array,
      required: true,
      validator: (value) => value.length === 12 || value.length === 24
    },
    showWarning: {
      type: Boolean,
      default: true
    },
    showCopy: {
      type: Boolean,
      default: true
    },
    allowBlur: {
      type: Boolean,
      default: false
    },
    initialBlurred: {
      type: Boolean,
      default: false
    }
  },
  emits: ['copied'],
  data() {
    return {
      blurred: this.initialBlurred,
      copied: false
    }
  },
  methods: {
    async copyWords() {
      try {
        const mnemonicString = this.words.join(' ');
        await navigator.clipboard.writeText(mnemonicString);
        this.copied = true;
        this.$emit('copied');

        this.$q.notify({
          type: 'positive',
          message: this.$t('Seed phrase copied'),
          caption: this.$t('Clear your clipboard after pasting'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });

        setTimeout(() => {
          this.copied = false;
        }, 3000);
      } catch (error) {
        console.error('Failed to copy:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          position: 'bottom',
          actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
        });
      }
    }
  }
}
</script>

<style scoped>
.mnemonic-display {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
}

/* Warning Banner */
.warning-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 12px;
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.3);
}

.warning-icon {
  color: #FFC107;
  flex-shrink: 0;
  margin-top: 2px;
}

.warning-text {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: #FFC107;
}

/* Words Grid */
.words-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.word-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid;
}

.word-item-dark {
  background: #171717;
  border-color: #2A342A;
}

.word-item-light {
  background: #F8F8F8;
  border-color: #EBEBEB;
}

.word-number {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 11px;
  font-weight: 500;
  min-width: 18px;
}

.number-dark {
  color: #6B7280;
}

.number-light {
  color: #9CA3AF;
}

.word-text {
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
  transition: filter 0.3s ease;
}

.mnemonic-dark .word-text {
  color: #FFFFFF;
}

.mnemonic-light .word-text {
  color: #212121;
}

.word-text.blurred {
  filter: blur(5px);
  user-select: none;
}

/* Blur Toggle */
.blur-toggle {
  display: flex;
  justify-content: center;
}

.toggle-btn {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

/* Copy Section */
.copy-section {
  display: flex;
  justify-content: center;
  margin-top: 0.5rem;
}

.copy-btn {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: 20px;
  transition: all 0.2s ease;
}

.copy-btn-dark {
  color: #15DE72;
  background: rgba(21, 222, 114, 0.1);
}

.copy-btn-dark:hover {
  background: rgba(21, 222, 114, 0.15);
}

.copy-btn-light {
  color: #059573;
  background: rgba(5, 149, 115, 0.1);
}

.copy-btn-light:hover {
  background: rgba(5, 149, 115, 0.15);
}

/* Responsive Design */
@media (max-width: 480px) {
  .words-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .word-item {
    padding: 10px 12px;
  }

  .word-number {
    font-size: 10px;
    min-width: 16px;
  }

  .word-text {
    font-size: 12px;
  }

  .warning-text {
    font-size: 12px;
  }

  .warning-banner {
    padding: 0.875rem;
    gap: 0.625rem;
  }
}

@media (max-width: 360px) {
  .word-item {
    padding: 8px 10px;
    gap: 6px;
  }

  .word-text {
    font-size: 11px;
  }
}
</style>
