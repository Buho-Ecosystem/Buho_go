<template>
  <div class="mnemonic-display">
    <!--
      Header row above the grid. Carries the consumer-supplied
      `header` slot on the left (typically a countdown chip) and the
      blur toggle on the right when `allowBlur` is true. Hidden when
      both slots are empty so we don't render a stray empty bar.
    -->
    <div
      v-if="hasHeaderSlot || allowBlur"
      class="mnemonic-display-header"
    >
      <div class="mnemonic-display-header-slot">
        <slot name="header" />
      </div>
      <button
        v-if="allowBlur"
        class="toggle-btn"
        :class="$q.dark.isActive ? 'toggle-btn-dark' : 'toggle-btn-light'"
        @click="toggleBlur"
      >
        <Icon :icon="internalBlurred ? 'tabler:eye' : 'tabler:eye-off'" width="14" height="14" />
        {{ internalBlurred ? $t('Show') : $t('Hide') }}
      </button>
    </div>

    <!--
      Optional top warning, off by default. Kept for legacy callers
      that opted into the bundled banner; new flows should add their
      own warning below the grid so wording stays in the consumer.
    -->
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
  computed: {
    /**
     * True when the consumer has supplied a `header` slot. Used to
     * decide whether to render the header bar at all — without
     * this, an empty row of padding would appear in flows that
     * only want the words grid + toggle.
     */
    hasHeaderSlot() {
      return Boolean(this.$slots.header);
    },
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

/*
  Header bar above the words grid. Slot on the left for an
  optional consumer chip (typically a countdown), toggle on the
  right when allowBlur is true. Tight one-line bar so the words
  stay the visual anchor.
*/
.mnemonic-display-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 28px;
}

.mnemonic-display-header-slot {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
}

.toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  padding: 4px 10px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  flex-shrink: 0;
  transition: background-color 0.15s ease;
}

.toggle-btn-dark {
  color: rgba(255, 255, 255, 0.85);
}

.toggle-btn-dark:hover {
  background: rgba(255, 255, 255, 0.08);
}

.toggle-btn-light {
  color: var(--text-primary);
}

.toggle-btn-light:hover {
  background: rgba(15, 23, 42, 0.06);
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
