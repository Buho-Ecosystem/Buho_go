<template>
  <q-dialog
    v-model="open"
    persistent
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @hide="onDialogHidden"
  >
    <q-card
      class="restore-dialog"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Header -->
      <q-card-section class="restore-header">
        <div
          class="restore-title"
          :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'"
        >
          {{ headerTitle }}
        </div>
        <q-btn
          flat
          round
          dense
          :disable="isApplying"
          @click="close"
          :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          :aria-label="$t('Close')"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </q-card-section>

      <!-- Step: Warning (only if an identity already exists) -->
      <template v-if="step === 'warn'">
        <q-card-section class="restore-body restore-body--center">
          <div class="warning-mark">
            <Icon icon="tabler:alert-triangle" width="48" height="48" />
          </div>
          <h2
            class="restore-headline"
            :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'"
          >
            {{ $t('Replace your current identity?') }}
          </h2>
          <p
            class="restore-lede"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ $t('Your current sign-in keys and profile are replaced by the ones derived from the seed phrase you enter. Your wallets are not affected.') }}
          </p>
          <div
            class="restore-bullets"
            :class="$q.dark.isActive ? 'restore-bullets-dark' : 'restore-bullets-light'"
          >
            <div class="restore-bullet">
              <Icon icon="tabler:check" width="14" height="14" class="bullet-ok" />
              <span>{{ $t('Your Spark, NWC and LNBits wallets stay untouched.') }}</span>
            </div>
            <div class="restore-bullet">
              <Icon icon="tabler:check" width="14" height="14" class="bullet-ok" />
              <span>{{ $t('You can return to the previous identity by restoring its seed phrase again later.') }}</span>
            </div>
            <div class="restore-bullet">
              <Icon icon="tabler:x" width="14" height="14" class="bullet-warn" />
              <span>{{ $t('Sites you logged into with the old identity, and your old profile, are forgotten on this device.') }}</span>
            </div>
          </div>
        </q-card-section>

        <q-card-actions class="restore-actions restore-actions--stack">
          <q-btn
            unelevated
            no-caps
            class="restore-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="$t('I understand, continue')"
            @click="step = 'enter'"
          />
          <q-btn
            flat
            no-caps
            class="restore-secondary-btn"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
            :label="$t('Cancel')"
            @click="close"
          />
        </q-card-actions>
      </template>

      <!-- Step: Enter 12 words -->
      <template v-else-if="step === 'enter'">
        <q-card-section class="restore-body">
          <p
            class="restore-lede restore-lede--top"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          >
            {{ $t('Type, or paste your 12-word identity seed phrase. Order matters.') }}
          </p>

          <!-- BIP-39 suggestion strip. Pinned above the grid so the
               mobile keyboard never covers it; one shared strip
               reflects whichever input has focus. -->
          <div
            v-if="showSuggestions"
            id="identity-bip39-suggestion-strip"
            class="suggestion-strip"
            :class="$q.dark.isActive ? 'suggestion-strip-dark' : 'suggestion-strip-light'"
            role="listbox"
          >
            <button
              v-for="(suggestion, sIdx) in activeSuggestions"
              :key="suggestion"
              type="button"
              class="suggestion-chip"
              :class="[
                $q.dark.isActive ? 'suggestion-chip-dark' : 'suggestion-chip-light',
                { 'suggestion-chip--highlighted': sIdx === highlightedIndex }
              ]"
              role="option"
              :aria-selected="sIdx === highlightedIndex"
              @mousedown.prevent
              @click="pickSuggestion(suggestion)"
            >
              {{ suggestion }}
            </button>
          </div>

          <div class="words-grid">
            <div
              v-for="(_, index) in inputWords"
              :key="index"
              class="word-cell"
              :class="$q.dark.isActive ? 'word-cell-dark' : 'word-cell-light'"
            >
              <span class="word-index">{{ index + 1 }}</span>
              <input
                v-model="inputWords[index]"
                type="text"
                autocomplete="off"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                class="word-input"
                :class="$q.dark.isActive ? 'word-input-dark' : 'word-input-light'"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="identity-bip39-suggestion-strip"
                :aria-expanded="showSuggestions && activeIndex === index"
                @paste="onWordPaste($event, index)"
                @input="onMnemonicInput(index)"
                @focus="onWordFocus(index)"
                @blur="onWordBlur"
                @keydown.enter.prevent="onWordEnter(index)"
                @keydown.tab="onWordTab($event, index)"
                @keydown.right="onWordArrowRight"
                @keydown.left="onWordArrowLeft"
                @keydown.esc="closeSuggestions"
                :ref="el => setWordInputRef(index, el)"
              />
            </div>
          </div>

          <div v-if="errorText" class="restore-error" role="alert">
            <Icon icon="tabler:alert-circle" width="14" height="14" />
            <span>{{ errorText }}</span>
          </div>

          <!-- Fingerprint preview when valid -->
          <div
            v-if="previewFingerprint"
            class="preview-strip"
            :class="$q.dark.isActive ? 'preview-strip-dark' : 'preview-strip-light'"
          >
            <Icon icon="tabler:fingerprint" width="16" height="16" class="preview-icon" />
            <div class="preview-text">
              <div class="preview-label">{{ $t('This will become your identity:') }}</div>
              <div class="preview-fp">{{ formattedFingerprint }}</div>
            </div>
          </div>
        </q-card-section>

        <q-card-actions class="restore-actions restore-actions--stack">
          <q-btn
            unelevated
            no-caps
            class="restore-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="$t('Restore identity')"
            :loading="isApplying"
            :disable="!canSubmit"
            @click="apply"
          />
          <q-btn
            flat
            no-caps
            class="restore-secondary-btn"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
            :label="$t('Cancel')"
            :disable="isApplying"
            @click="close"
          />
        </q-card-actions>
      </template>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useIdentityStore } from '../stores/identity';
import {
  isValidIdentityMnemonic,
  computeIdentityFingerprint,
} from '../utils/identityCrypto';
import { useBip39Mnemonic } from '../composables/useBip39Mnemonic';

const SEED_WORD_COUNT = 12;

export default {
  name: 'IdentityRestoreDialog',

  components: { Icon },

  props: {
    modelValue: {
      type: Boolean,
      required: true,
    },
  },

  emits: ['update:modelValue', 'restored'],

  setup() {
    const identity = useIdentityStore();
    const seed = useBip39Mnemonic({ wordCount: SEED_WORD_COUNT });
    return { identity, ...seed };
  },

  data() {
    return {
      step: 'warn', // 'warn' (if existing identity) | 'enter'
      isApplying: false,
      errorText: '',
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    headerTitle() {
      if (this.step === 'warn') return this.$t('Restore identity');
      return this.$t('Enter your seed phrase');
    },

    isValid() {
      return this.mnemonicIsComplete && isValidIdentityMnemonic(this.normalisedMnemonic);
    },

    canSubmit() {
      return this.isValid && !this.isApplying;
    },

    /**
     * Only compute the fingerprint preview when the user has a syntactically
     * valid mnemonic — re-computing on every keystroke would be wasteful
     * and the in-progress value is misleading.
     */
    previewFingerprint() {
      if (!this.isValid) return null;
      try {
        return computeIdentityFingerprint(this.normalisedMnemonic);
      } catch {
        return null;
      }
    },

    formattedFingerprint() {
      const fp = this.previewFingerprint;
      if (!fp) return '';
      return fp.match(/.{1,4}/g)?.join(' ') ?? fp;
    },
  },

  watch: {
    modelValue(isOpen) {
      if (isOpen) {
        this.resetState();
        // Skip the warning step if there's no existing identity to lose.
        this.step = this.identity.bootstrapped ? 'warn' : 'enter';
      }
    },
  },

  methods: {
    resetState() {
      this.resetMnemonic();
      this.errorText = '';
      this.isApplying = false;
    },

    /**
     * Per-input handler wrapping the composable's normaliser with the
     * dialog-local concern of clearing the inline error banner the
     * moment the user starts editing again. The fingerprint preview
     * replaces any further inline feedback.
     */
    onMnemonicInput(index) {
      this.normalizeWordInput(index);
      if (this.errorText) this.errorText = '';
    },

    async apply() {
      this.errorText = '';
      const phrase = this.normalisedMnemonic;

      if (!isValidIdentityMnemonic(phrase)) {
        this.errorText = this.$t('That phrase is not a valid BIP-39 seed. Double-check each word.');
        return;
      }

      this.isApplying = true;
      try {
        await this.identity.importMnemonic(phrase, true);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Identity restored'),
          caption: this.$t('Your sign-in keys and profile are back.'),
          timeout: 4000,
        });
        this.$emit('restored');
        this.close();
      } catch (err) {
        console.error('[IdentityRestore] importMnemonic failed', err);
        this.errorText = err?.message || this.$t('Could not restore identity.');
      } finally {
        this.isApplying = false;
        // Best-effort wipe so the visible inputs (and the in-memory
        // ref the composable holds) don't outlive the apply call.
        this.resetMnemonic();
      }
    },

    close() {
      this.open = false;
    },

    onDialogHidden() {
      this.resetState();
    },
  },
};
</script>

<style scoped>
.restore-dialog {
  width: 100%;
  max-width: 480px;
  border-radius: 20px;
  overflow: hidden;
}

.restore-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 4px;
}

.restore-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

.restore-body {
  padding: 8px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.restore-body--center {
  align-items: center;
  text-align: center;
  padding-top: 12px;
}

.restore-headline {
  font-family: 'Manrope', sans-serif;
  font-size: 19px;
  font-weight: 700;
  margin: 4px 0 0;
}

.restore-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.55;
  margin: 0;
}

.restore-lede--top {
  margin-bottom: 2px;
}

.warning-mark {
  color: #f59e0b;
}

.restore-bullets {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 12px;
  text-align: left;
}

.restore-bullets-light {
  background: #f8fafc;
}

.restore-bullets-dark {
  background: rgba(255, 255, 255, 0.04);
}

.restore-bullet {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.45;
}

.bullet-ok {
  color: #15DE72;
  margin-top: 2px;
  flex: 0 0 auto;
}

.bullet-warn {
  color: #f59e0b;
  margin-top: 2px;
  flex: 0 0 auto;
}

/* BIP-39 suggestion strip.
   Mirrors the look in SparkRestorePage so users get the same UI in
   every spot we ask them to type a recovery phrase. Pinned above the
   word grid so the mobile keyboard never covers it. */
.suggestion-strip {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  width: 100%;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid;
  box-shadow: 0 4px 12px -4px rgba(15, 23, 42, 0.18);
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x proximity;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.suggestion-strip::-webkit-scrollbar {
  display: none;
}

.suggestion-strip-light {
  background: #ffffff;
  border-color: #e2e8f0;
}

.suggestion-strip-dark {
  background: var(--bg-input);
  border-color: var(--border-card);
}

.suggestion-chip {
  flex: 0 0 auto;
  min-height: 36px;
  padding: 6px 12px;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
  scroll-snap-align: start;
  touch-action: manipulation;
  white-space: nowrap;
}

.suggestion-chip-light {
  color: #1e293b;
  background: #f1f5f9;
}

.suggestion-chip-light:hover {
  background: rgba(21, 222, 114, 0.12);
  color: #059573;
}

.suggestion-chip-dark {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.06);
}

.suggestion-chip-dark:hover {
  background: rgba(21, 222, 114, 0.18);
  color: #15DE72;
}

.suggestion-chip--highlighted,
.suggestion-chip--highlighted:hover {
  background: linear-gradient(135deg, #059573, #15DE72);
  color: #ffffff;
  border-color: #15DE72;
}

.suggestion-chip:active {
  transform: scale(0.97);
}

/* 12-word grid */
.words-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

@media (min-width: 480px) {
  .words-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.word-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
}

.word-cell-light {
  background: #f1f5f9;
}

.word-cell-dark {
  background: rgba(255, 255, 255, 0.04);
}

.word-index {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-size: 11px;
  opacity: 0.55;
  width: 18px;
  text-align: right;
  user-select: none;
}

.word-input {
  flex: 1 1 auto;
  background: transparent;
  border: none;
  outline: none;
  font-family: 'Manrope', sans-serif;
  font-size: 13.5px;
  width: 100%;
  min-width: 0;
}

.word-input-light {
  color: #0f172a;
}

.word-input-dark {
  color: #f8fafc;
  caret-color: #15DE72;
}

.word-input:focus {
  outline: none;
}

/* Error */
.restore-error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: #ef4444;
  font-family: 'Manrope', sans-serif;
}

/* Fingerprint preview */
.preview-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(21, 222, 114, 0.2);
}

.preview-strip-light {
  background: rgba(21, 222, 114, 0.06);
}

.preview-strip-dark {
  background: rgba(21, 222, 114, 0.04);
}

.preview-icon {
  color: #15DE72;
  flex: 0 0 auto;
}

.preview-text {
  flex: 1 1 auto;
  min-width: 0;
}

.preview-label {
  font-size: 11px;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.preview-fp {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-size: 13px;
  font-weight: 500;
  margin-top: 2px;
}

/* Actions */
.restore-actions {
  padding: 0 20px 20px;
  display: flex;
  justify-content: center;
}

.restore-actions--stack {
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.restore-primary-btn {
  width: 100%;
  max-width: 340px;
  height: 48px;
  border-radius: 24px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.restore-secondary-btn {
  width: 100%;
  max-width: 340px;
  height: 40px;
  border-radius: 20px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

@media (max-width: 480px) {
  .restore-body {
    padding: 8px 16px 18px;
  }
}
</style>
