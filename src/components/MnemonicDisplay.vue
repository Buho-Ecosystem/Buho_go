<template>
  <div class="mnemonic-display">
    <!-- Warning Banner -->
    <div v-if="showWarning" class="display-warning">
      <div class="display-warning-icon">
        <Icon icon="tabler:alert-triangle" width="18" height="18" />
      </div>
      <div class="display-warning-text">
        {{ $t('Write these words down and store them safely. Never share them with anyone.') }}
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
        <span class="word-number">{{ index + 1 }}</span>
        <span class="word-text" :class="[internalBlurred ? 'blurred' : '', $q.dark.isActive ? 'word-text-dark' : 'word-text-light']">
          {{ word }}
        </span>
      </div>
    </div>

    <!-- Blur Toggle -->
    <div v-if="allowBlur" class="blur-toggle">
      <button
        class="toggle-btn"
        :class="$q.dark.isActive ? 'toggle-btn-dark' : 'toggle-btn-light'"
        @click="toggleBlur"
      >
        <Icon :icon="internalBlurred ? 'tabler:eye' : 'tabler:eye-off'" width="16" height="16" />
        {{ internalBlurred ? $t('Show words') : $t('Hide words') }}
      </button>
    </div>

    <!-- Bottom Warning -->
    <div class="display-bottom-warning">
      <Icon icon="tabler:shield-lock" width="16" height="16" />
      <span>{{ $t('Store in a safe place. Never share online.') }}</span>
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
    // Seed value for the blur state. When the parent updates this prop
    // reactively (e.g. after a timeout), the component re-syncs its
    // internal blur state via the watcher below. Combined with the
    // `update:blurred` emit, this gives parents full control without
    // the footguns of a nullable controlled prop.
    initialBlurred: {
      type: Boolean,
      default: false
    },
  },
  emits: ['copied', 'update:blurred'],
  data() {
    return {
      internalBlurred: this.initialBlurred,
      copied: false
    }
  },
  watch: {
    initialBlurred(next) {
      // Parent drove the blur state externally (e.g. auto-hide timer
      // re-blurring the phrase). Mirror it locally so the user's own
      // toggle keeps working from whatever the new baseline is.
      this.internalBlurred = next;
    },
  },
  methods: {
    toggleBlur() {
      const next = !this.internalBlurred;
      this.internalBlurred = next;
      this.$emit('update:blurred', next);
    },
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
        });

        setTimeout(() => {
          this.copied = false;
        }, 3000);
      } catch (error) {
        console.error('Failed to copy:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
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

/* Warning Banner — compact, matches verify error/success style */
.display-warning {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.75rem 1rem;
  border-radius: 10px;
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.15);
}

.display-warning-icon {
  flex-shrink: 0;
  color: #F59E0B;
}

.display-warning-text {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  line-height: 1.4;
  color: #F59E0B;
}

/* Words Grid — matches verify grid */
.words-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.word-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1.5px solid;
}

.word-item-dark {
  background: #171717;
  border-color: rgba(255, 255, 255, 0.08);
}

.word-item-light {
  background: var(--bg-card);
  border-color: var(--border-card);
}

.word-number {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: #6B7280;
  min-width: 16px;
}

.word-text {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  transition: filter 0.3s ease;
}

.word-text-dark {
  color: #FFFFFF;
}

.word-text-light {
  color: var(--text-primary);
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
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  padding: 6px 12px;
  border-radius: 8px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.toggle-btn-dark {
  color: rgba(255, 255, 255, 0.5);
}

.toggle-btn-light {
  color: var(--text-secondary);
}

/* Bottom Warning — matches verify bottom warning */
.display-bottom-warning {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.06);
  color: #EF4444;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
}

/* Responsive */
@media (max-width: 480px) {
  .words-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }

  .word-item {
    padding: 8px 10px;
  }

  .word-number {
    font-size: 10px;
  }

  .word-text {
    font-size: 12px;
  }

  .display-warning-text {
    font-size: 11px;
  }
}
</style>
