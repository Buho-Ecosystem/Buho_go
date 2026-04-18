<template>
  <q-page class="spark-restore-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <div class="container">
      <q-card
        class="restore-card"
        :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
      >
        <!-- Header -->
        <q-card-section class="card-header">
          <div class="header-content">
            <q-btn
              flat
              round
              dense
              @click="handleBack"
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
            <div class="step-indicator" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
              {{ $t('Step') }} {{ displayStep }}/{{ totalSteps }}
            </div>
          </div>
        </q-card-section>

        <!-- Content -->
        <q-card-section class="restore-content">
          <!-- Step 1: Enter Seed Phrase -->
          <div v-if="currentStep === 1" class="step-content">
            <div class="step-icon">
              <div class="icon-bg">
                <Icon icon="tabler:arrow-back-up" width="32" height="32" style="color: white;" />
              </div>
            </div>
            <h2 class="step-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
              {{ $t('Restore Spark Wallet') }}
            </h2>
            <p class="step-desc" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ $t('Enter your 12-word seed phrase to restore your Spark wallet. This is only for Spark wallets.') }}
            </p>

            <!-- BIP-39 Suggestion Strip (above grid so mobile keyboard never covers it) -->
            <div
              v-if="showSuggestions"
              id="bip39-suggestion-strip"
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

            <!-- Word Inputs Grid -->
            <div class="words-input-grid">
              <div
                v-for="(word, index) in inputWords"
                :key="index"
                class="word-input-item"
              >
                <span class="word-number" :class="$q.dark.isActive ? 'number-dark' : 'number-light'">
                  {{ index + 1 }}
                </span>
                <input
                  v-model="inputWords[index]"
                  type="text"
                  autocomplete="off"
                  autocapitalize="none"
                  autocorrect="off"
                  spellcheck="false"
                  class="word-input"
                  style="width: 20%;"
                  :class="$q.dark.isActive ? 'input-dark' : 'input-light'"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="bip39-suggestion-strip"
                  :aria-expanded="showSuggestions && activeIndex === index"
                  @input="onWordInput(index)"
                  @focus="onWordFocus(index)"
                  @blur="onWordBlur"
                  @paste="handlePaste($event, index)"
                  @keydown.enter.prevent="onEnter(index)"
                  @keydown.tab="onTab($event, index)"
                  @keydown.right="onArrowRight"
                  @keydown.left="onArrowLeft"
                  @keydown.esc="closeSuggestions"
                  :ref="el => wordInputRefs[index] = el"
                />
              </div>
            </div>

            <div v-if="mnemonicError" class="mnemonic-error">
              {{ mnemonicError }}
            </div>
          </div>

          <!-- Step 2: Restoring Wallet -->
          <div v-else-if="currentStep === 2" class="step-content step-creating">
            <div class="creating-animation">
              <q-spinner-orbit size="80px" color="primary" />
            </div>
            <h2 class="step-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
              {{ $t('Restoring Spark Wallet') }}
            </h2>
            <p class="step-desc" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ restoringStatus }}
            </p>
          </div>
        </q-card-section>

        <!-- Footer -->
        <q-card-section class="restore-footer" v-if="currentStep === 1">
          <q-btn
            class="continue-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :disable="!canContinue"
            :loading="isValidating"
            @click="validateAndContinue"
            no-caps
            unelevated
          >
            {{ $t('Restore Spark Wallet') }}
          </q-btn>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script>
import { wordlist as BIP39_WORDLIST } from '@scure/bip39/wordlists/english';
import { useWalletStore } from '../stores/wallet';

// Fast membership lookups for per-word typo checks.
const BIP39_WORDSET = new Set(BIP39_WORDLIST);

const SEED_WORD_COUNT = 12;
const MAX_SUGGESTIONS = 8;
// Short delay on blur so tapping a suggestion chip registers before the
// strip disappears (mousedown.prevent alone isn't enough on touch devices).
const BLUR_DISMISS_DELAY_MS = 120;
// Hard cap on raw clipboard length accepted by the paste handler.
// A valid 24-word BIP-39 phrase is <250 chars; 4 KB leaves ample headroom
// while preventing pathological clipboard payloads from being processed.
const PASTE_MAX_CHARS = 4096;

export default {
  name: 'SparkRestorePage',
  setup() {
    const walletStore = useWalletStore();
    return { walletStore };
  },
  data() {
    return {
      currentStep: 1,
      isValidating: false,
      inputWords: Array(SEED_WORD_COUNT).fill(''),
      wordInputRefs: [],
      mnemonicError: '',
      restoringStatus: 'Initializing...',

      // BIP-39 suggestion strip state
      activeIndex: -1,
      highlightedIndex: 0,
      blurTimer: null,
    }
  },
  beforeUnmount() {
    if (this.blurTimer) clearTimeout(this.blurTimer);
    // Defense-in-depth: overwrite the in-memory seed words so they don't
    // linger in the component instance until GC. Not a hard guarantee
    // (engines may keep copies), but shrinks the obvious surface.
    this.inputWords = Array(SEED_WORD_COUNT).fill('');
    this.wordInputRefs = [];
  },
  computed: {
    canContinue() {
      return this.inputWords.every(word => word.trim().length > 0);
    },
    mnemonic() {
      return this.inputWords.map(w => w.trim().toLowerCase()).join(' ');
    },
    totalSteps() {
      return 2; // Seed → Restoring
    },
    displayStep() {
      return this.currentStep;
    },
    activeSuggestions() {
      if (this.activeIndex < 0) return [];
      return this.suggestionsFor(this.activeIndex);
    },
    showSuggestions() {
      if (this.activeIndex < 0) return false;
      const current = (this.inputWords[this.activeIndex] || '').trim().toLowerCase();
      if (!current) return false;
      const matches = this.activeSuggestions;
      if (matches.length === 0) return false;
      // Typed value is already the sole exact match — user is done with this slot.
      if (matches.length === 1 && matches[0] === current) return false;
      return true;
    },
  },
  methods: {
    suggestionsFor(index) {
      const prefix = (this.inputWords[index] || '').trim().toLowerCase();
      if (!prefix) return [];
      return BIP39_WORDLIST
        .filter(word => word.startsWith(prefix))
        .slice(0, MAX_SUGGESTIONS);
    },

    onWordInput(index) {
      this.inputWords[index] = (this.inputWords[index] || '').toLowerCase();
      this.highlightedIndex = 0;
      this.mnemonicError = '';
    },

    onWordFocus(index) {
      if (this.blurTimer) {
        clearTimeout(this.blurTimer);
        this.blurTimer = null;
      }
      this.activeIndex = index;
      this.highlightedIndex = 0;
    },

    onWordBlur() {
      this.blurTimer = setTimeout(() => {
        this.activeIndex = -1;
        this.blurTimer = null;
      }, BLUR_DISMISS_DELAY_MS);
    },

    closeSuggestions() {
      this.activeIndex = -1;
    },

    pickSuggestion(word) {
      const idx = this.activeIndex;
      if (idx < 0) return;
      this.inputWords[idx] = word;
      this.highlightedIndex = 0;
      this.focusNext(idx);
    },

    onEnter(index) {
      if (this.showSuggestions) {
        const pick = this.activeSuggestions[this.highlightedIndex];
        if (pick) {
          this.pickSuggestion(pick);
          return;
        }
      }
      this.focusNext(index);
    },

    onTab(event, index) {
      // Shift+Tab preserves native reverse-focus behavior.
      if (this.showSuggestions && !event.shiftKey) {
        const pick = this.activeSuggestions[this.highlightedIndex];
        if (pick) {
          event.preventDefault();
          this.pickSuggestion(pick);
        }
      }
    },

    onArrowRight(event) {
      if (!this.showSuggestions) return;
      event.preventDefault();
      const len = this.activeSuggestions.length;
      this.highlightedIndex = (this.highlightedIndex + 1) % len;
    },

    onArrowLeft(event) {
      if (!this.showSuggestions) return;
      event.preventDefault();
      const len = this.activeSuggestions.length;
      this.highlightedIndex = (this.highlightedIndex - 1 + len) % len;
    },

    focusNext(index) {
      const next = index + 1;
      if (next < SEED_WORD_COUNT && this.wordInputRefs[next]) {
        this.wordInputRefs[next].focus();
      } else if (this.wordInputRefs[index]) {
        this.wordInputRefs[index].blur();
      }
    },

    handlePaste(event, startIndex) {
      const text = event.clipboardData?.getData('text') || '';
      // Cap the raw paste length so pathological clipboard payloads can't
      // blow out memory before we reduce to at most SEED_WORD_COUNT tokens.
      const bounded = text.slice(0, PASTE_MAX_CHARS).trim().toLowerCase();
      const tokens = bounded.split(/\s+/).filter(Boolean).slice(0, SEED_WORD_COUNT);
      if (tokens.length <= 1) return; // allow native single-word paste

      event.preventDefault();
      // A full 12-word phrase pasted anywhere fills the grid from slot 0.
      const base = tokens.length >= SEED_WORD_COUNT ? 0 : startIndex;
      const limit = Math.min(tokens.length, SEED_WORD_COUNT - base);
      for (let i = 0; i < limit; i++) {
        this.inputWords[base + i] = tokens[i];
      }
      this.mnemonicError = '';
      this.activeIndex = -1;
    },

    handleBack() {
      this.$router.push('/');
    },

    async validateAndContinue() {
      this.mnemonicError = '';

      // Client-side: only verify each word exists in the official BIP-39
      // recovery word list. This catches typos with precise feedback
      // ("word 7 doesn't look right") without blocking valid phrases on
      // checksum edge cases. The Spark SDK performs the authoritative
      // checksum check and will reject genuinely invalid phrases.
      const badPositions = [];
      this.inputWords.forEach((raw, idx) => {
        const word = (raw || '').trim().toLowerCase();
        if (!word || !BIP39_WORDSET.has(word)) {
          badPositions.push(idx + 1);
        }
      });

      if (badPositions.length > 0) {
        const positions = badPositions.join(', ');
        // Resolve the placeholder after translation so it works whether or
        // not the locale file contains the key. vue-i18n falls back to the
        // key itself on miss, and does not interpolate the fallback.
        const template = badPositions.length === 1
          ? this.$t("Word {n} doesn't match the official recovery word list. Check the spelling and try again.")
          : this.$t("Words {n} don't match the official recovery word list. Check the spelling and try again.");
        this.mnemonicError = template.replace('{n}', positions);

        this.$q.notify({
          type: 'negative',
          message: this.$t("Some words don't look right"),
          caption: this.$t('Please review each word carefully and try again.'),
        });
        return;
      }

      this.isValidating = true;
      try {
        await this.restoreWallet();
      } finally {
        this.isValidating = false;
      }
    },

    async restoreWallet() {
      this.currentStep = 2;
      this.restoringStatus = this.$t('Encrypting wallet...');

      try {
        await this.walletStore.addSparkWallet({
          mnemonic: this.mnemonic,
          network: 'MAINNET',
          isRestore: true,
          onProgress: (step) => {
            const messages = {
              legacyCheck: this.$t('Checking for an existing wallet...'),
              encrypting: this.$t('Encrypting wallet...'),
              business: this.$t('Setting up Business wallet...'),
              personal: this.$t('Setting up Personal wallet...'),
              done: this.$t('Almost done...'),
            };
            this.restoringStatus = messages[step] || this.restoringStatus;
          }
        });

        this.restoringStatus = this.$t('Wallet restored!');
        await new Promise(resolve => setTimeout(resolve, 800));

        this.$router.replace('/spark-success');
      } catch (error) {
        console.error('Failed to restore wallet:', error);
        const { message, caption } = this._userFacingRestoreError(error);
        this.$q.notify({ type: 'negative', message, caption });
        this.currentStep = 1;
      }
    },

    /**
     * Map store / SDK errors to plain-language messages for the user.
     * Technical details are logged; the user sees what they can act on.
     */
    _userFacingRestoreError(error) {
      if (error?.code === 'SPARK_WALLET_EXISTS') {
        return {
          message: this.$t('Your Spark wallets are already set up'),
          caption: this.$t(
            'Your Business and Personal Spark wallets are already on this device. Remove them from Settings before restoring a different recovery phrase.'
          ),
        };
      }

      // Phrase-shaped errors from the Spark SDK when the checksum or seed
      // decoding fails. The SDK's message wording varies by version, so we
      // match on a small set of stable keywords rather than exact strings.
      const rawMessage = (error?.message || '').toLowerCase();
      const isPhraseError = /mnemonic|seed|invalid hex|checksum/.test(rawMessage);
      if (isPhraseError) {
        return {
          message: this.$t("Your recovery phrase wasn't accepted"),
          caption: this.$t(
            "One or more words don't add up. Please double-check each word, including the last one, and try again."
          ),
        };
      }

      // Otherwise: network / service errors during SDK initialization.
      // Rollback has already cleaned up partial state, so the user can
      // safely retry.
      return {
        message: this.$t("We couldn't restore your wallet"),
        caption: this.$t(
          'Please check your internet connection and try again. Your recovery words are still safe.'
        ),
      };
    }
  }
}
</script>

<style scoped>
.spark-restore-page {
  min-height: 100vh;
  padding: 1rem;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* Center content only when viewport is tall enough */
@media (min-height: 700px) {
  .spark-restore-page {
    align-items: center;
  }
}

.bg-dark {
  background: var(--bg-primary);
}

.bg-light {
  background: var(--bg-secondary);
}

.container {
  width: 100%;
  max-width: 480px;
  margin: auto 0;
}

.restore-card {
  border-radius: 24px;
}

/* Header */
.card-header {
  padding: 1rem;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.step-indicator {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* Content */
.restore-content {
  padding: 0 1.5rem 1.5rem;
  display: flex;
  flex-direction: column;
}

.step-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}

/* Step Icon */
.step-icon {
  margin-bottom: 1.5rem;
}

.icon-bg {
  width: 72px;
  height: 72px;
  background: linear-gradient(135deg, #059573, #15DE72);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(21, 222, 114, 0.3);
}

/* Typography */
.step-title {
  font-family: 'Manrope', sans-serif;
  font-size: 22px;
  font-weight: 700;
  text-align: center;
  margin: 0 0 0.75rem;
}

.step-desc {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  text-align: center;
  max-width: 320px;
  margin: 0 0 1.5rem;
  line-height: 1.5;
}

.view_title_dark {
  color: #B0B0B0;
}

.view_title {
  color: #6B7280;
}

/* BIP-39 Suggestion Strip
 * Rendered ABOVE the word grid so the mobile keyboard (which rises from the
 * bottom) never covers it. One shared strip reflects the focused input —
 * avoids the visual chaos of per-input popups on a 12-slot grid. */
.suggestion-strip {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  width: 100%;
  max-width: 400px;
  margin-bottom: 12px;
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

/* Words Input Grid */
.words-input-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  width: 100%;
  max-width: 400px;
}

.word-input-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid;
}

.word-input-item:has(.input-dark) {
  background: var(--bg-input);
  border-color: var(--border-card);
}

.word-input-item:has(.input-light) {
  background: var(--bg-input);
  border-color: var(--border-card);
}

.word-input-item:focus-within {
  border-color: #15DE72;
}

.word-number {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  min-width: 16px;
}

.number-dark {
  color: #6B7280;
}

.number-light {
  color: #9CA3AF;
}

.word-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 500;
  min-width: 0;
}

.input-dark {
  color: #FFFFFF;
}

.input-light {
  color: #212121;
}

.word-input::placeholder {
  color: #6B7280;
}

.mnemonic-error {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: #ff4444;
  text-align: center;
  margin-top: 1rem;
}

/* Name Step */
.step-name {
  justify-content: flex-start;
  padding-top: 1rem;
}

.wallet-name-input {
  width: 100%;
  max-width: 320px;
  margin-top: 0.5rem;
}

.continue-btn {
  width: 100%;
  max-width: 320px;
  height: 52px;
  border-radius: 24px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* PIN Step */
.step-pin {
  justify-content: flex-start;
  padding-top: 1rem;
}

.pin-dots-inline {
  display: flex;
  gap: 14px;
  margin: 1.5rem 0;
}

.pin-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid;
  transition: all 0.15s ease;
}

.pin-dot-dark {
  border-color: #3A3A3A;
}

.pin-dot-light {
  border-color: #D1D5DB;
}

.pin-dot.filled {
  background: linear-gradient(135deg, #059573, #15DE72);
  border-color: #15DE72;
  transform: scale(1.1);
}

.pin-dot.error {
  border-color: #ff4444;
  animation: shake 0.5s ease-in-out;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-8px); }
  80% { transform: translateX(8px); }
}

.pin-error {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  color: #ff4444;
  text-align: center;
  min-height: 20px;
  margin-bottom: 0.5rem;
}

/* Numpad Inline */
.numpad-inline {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 1rem;
}

.numpad-row {
  display: flex;
  gap: 14px;
  justify-content: center;
}

.numpad-btn {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: none;
  font-family: 'Manrope', sans-serif;
  font-size: 24px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  -webkit-tap-highlight-color: transparent;
}

.numpad-btn-dark {
  background: var(--bg-input);
  color: var(--text-primary);
}

.numpad-btn-dark:hover {
  background: #252525;
}

.numpad-btn-dark:active {
  background: var(--border-card);
  transform: scale(0.95);
}

.numpad-btn-light {
  background: #F3F4F6;
  color: #212121;
}

.numpad-btn-light:hover {
  background: #E5E7EB;
}

.numpad-btn-light:active {
  background: #D1D5DB;
  transform: scale(0.95);
}

/* Creating Step */
.step-creating {
  justify-content: center;
  padding: 2rem 0;
}

.creating-animation {
  margin-bottom: 2rem;
}

/* Footer */
.restore-footer {
  padding: 0 1.5rem 1.5rem;
  display: flex;
  justify-content: center;
}

.continue-btn {
  width: 100%;
  max-width: 320px;
  height: 52px;
  border-radius: 24px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* Responsive - Tablets and smaller */
@media (max-width: 480px) {
  .spark-restore-page {
    padding: 0.75rem;
  }

  .restore-content {
    padding: 0 1rem 1rem;
  }

  .step-title {
    font-size: 20px;
  }

  .step-desc {
    font-size: 13px;
    max-width: 280px;
  }

  .words-input-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }

  .word-input-item {
    padding: 10px 12px;
  }

  .word-input {
    font-size: 13px;
  }

  .numpad-btn {
    width: 56px;
    height: 56px;
    font-size: 22px;
  }

  .numpad-row {
    gap: 12px;
  }

  .numpad-inline {
    gap: 8px;
  }

  .restore-footer {
    padding: 0 1rem 1rem;
  }

  .continue-btn {
    height: 48px;
  }
}

/* Small phones (iPhone SE, small Android) */
@media (max-width: 375px) {
  .spark-restore-page {
    padding: 0.5rem;
  }

  .card-header {
    padding: 0.75rem 1rem;
  }

  .restore-content {
    padding: 0 0.875rem 1rem;
  }

  .step-icon {
    margin-bottom: 1rem;
  }

  .icon-bg {
    width: 60px;
    height: 60px;
  }

  .icon-bg .q-icon {
    font-size: 26px !important;
  }

  .step-title {
    font-size: 18px;
  }

  .step-desc {
    font-size: 12px;
    max-width: 260px;
    margin-bottom: 1.25rem;
  }

  .words-input-grid {
    gap: 6px;
  }

  .word-input-item {
    padding: 8px 10px;
    border-radius: 10px;
  }

  .word-number {
    font-size: 11px;
    min-width: 14px;
  }

  .word-input {
    font-size: 12px;
  }

  .numpad-btn {
    width: 52px;
    height: 52px;
    font-size: 20px;
  }

  .numpad-row {
    gap: 10px;
  }

  .numpad-inline {
    gap: 6px;
  }

  .pin-dots-inline {
    gap: 12px;
    margin: 1.25rem 0;
  }

  .pin-dot {
    width: 14px;
    height: 14px;
  }

  .restore-footer {
    padding: 0 0.875rem 1rem;
  }

  .continue-btn {
    height: 46px;
    border-radius: 22px;
  }
}

/* Short screens - reduce vertical spacing */
@media (max-height: 700px) {
  .step-icon {
    margin-bottom: 1rem;
  }

  .icon-bg {
    width: 56px;
    height: 56px;
  }

  .icon-bg .q-icon {
    font-size: 24px !important;
  }

  .step-title {
    font-size: 18px;
    margin-bottom: 0.5rem;
  }

  .step-desc {
    font-size: 12px;
    margin-bottom: 1rem;
  }

  .numpad-btn {
    width: 52px;
    height: 52px;
    font-size: 20px;
  }

  .numpad-row {
    gap: 10px;
  }

  .numpad-inline {
    gap: 6px;
    margin-top: 0.5rem;
  }

  .pin-dots-inline {
    margin: 1rem 0;
    gap: 12px;
  }

  .pin-dot {
    width: 14px;
    height: 14px;
  }
}

/* Very short screens (landscape or compact phones) */
@media (max-height: 600px) {
  .step-icon {
    margin-bottom: 0.75rem;
  }

  .icon-bg {
    width: 48px;
    height: 48px;
  }

  .icon-bg .q-icon {
    font-size: 22px !important;
  }

  .step-title {
    font-size: 16px;
    margin-bottom: 0.25rem;
  }

  .step-desc {
    font-size: 11px;
    margin-bottom: 0.75rem;
  }

  .words-input-grid {
    gap: 4px;
  }

  .word-input-item {
    padding: 6px 8px;
  }

  .numpad-btn {
    width: 46px;
    height: 46px;
    font-size: 18px;
  }

  .numpad-row {
    gap: 8px;
  }

  .numpad-inline {
    gap: 4px;
    margin-top: 0.25rem;
  }

  .pin-dots-inline {
    margin: 0.5rem 0;
    gap: 10px;
  }

  .pin-dot {
    width: 12px;
    height: 12px;
  }

  .step-pin {
    padding-top: 0.5rem;
  }
}
</style>
