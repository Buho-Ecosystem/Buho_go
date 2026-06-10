<template>
  <q-page
    class="restore-page"
    :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'"
    :style="{ '--accent': accent, '--accent-strong': accentStrong }"
  >
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
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z" :fill="$q.dark.isActive ? 'white' : '#6D6D6D'"/>
              </svg>
            </q-btn>
            <div class="step-indicator" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'">
              {{ $t('Step') }} {{ currentStep }}/{{ totalSteps }}
            </div>
          </div>
        </q-card-section>

        <!-- Content -->
        <q-card-section class="restore-content">
          <!-- Step 1: Enter Seed Phrase -->
          <div v-if="currentStep === 1" class="step-content">
            <h2 class="step-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
              {{ titleCopy }}
            </h2>
            <p class="step-desc" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ descCopy }}
            </p>

            <!--
              Wallet-type selector. A bare recovery phrase can't reveal whether
              it's a Spark or Arkade seed (both are 12-word BIP-39), so the user
              tells us — a deliberate choice, not an easy-to-miss toggle. Only
              the types not already on this device are offered.
            -->
            <div v-if="showTypeSwitch" class="type-switch" role="tablist">
              <button
                v-for="t in availableTypes"
                :key="t"
                type="button"
                role="tab"
                :aria-selected="selectedType === t"
                class="type-seg"
                :class="{ 'type-seg--active': selectedType === t }"
                @click="selectType(t)"
              >
                {{ typeLabel(t) }}
              </button>
            </div>
            <p
              v-if="showTypeSwitch"
              class="type-hint"
              :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'"
            >
              {{ $t("Not sure? We'll confirm the right one from the blockchain before restoring.") }}
            </p>

            <!-- BIP-39 suggestion strip (above the grid so the keyboard never covers it) -->
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

            <!-- Word inputs grid -->
            <div class="words-input-grid">
              <div
                v-for="(word, index) in inputWords"
                :key="index"
                class="word-input-item"
                :class="$q.dark.isActive ? 'word-input-item-dark' : 'word-input-item-light'"
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
                  :class="$q.dark.isActive ? 'input-dark' : 'input-light'"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-controls="bip39-suggestion-strip"
                  :aria-expanded="showSuggestions && activeIndex === index"
                  @input="onMnemonicInput(index)"
                  @focus="onWordFocus(index)"
                  @blur="onWordBlur"
                  @paste="onWordPaste($event, index)"
                  @keydown.enter.prevent="onWordEnter(index)"
                  @keydown.tab="onWordTab($event, index)"
                  @keydown.right="onWordArrowRight"
                  @keydown.left="onWordArrowLeft"
                  @keydown.esc="closeSuggestions"
                  :ref="el => setWordInputRef(index, el)"
                />
              </div>
            </div>

            <div v-if="mnemonicError" class="mnemonic-error">
              {{ mnemonicError }}
            </div>
          </div>

          <!-- Step 2: Restoring -->
          <div v-else-if="currentStep === 2" class="step-content step-creating">
            <div class="creating-animation">
              <q-spinner-orbit size="80px" :style="{ color: accentStrong }" />
            </div>
            <h2 class="step-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
              {{ restoringTitleCopy }}
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
            :disable="!canContinue"
            :loading="isValidating"
            @click="validateAndContinue"
            no-caps
            unelevated
          >
            {{ continueCopy }}
          </q-btn>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script>
import { useWalletStore } from '../stores/wallet';
import { useBip39Mnemonic } from '../composables/useBip39Mnemonic';
import { SparkWalletProvider } from '../providers/SparkWalletProvider';
import { ArkadeWalletProvider } from '../providers/ArkadeWalletProvider';

const SEED_WORD_COUNT = 12;

// Per-backend accent so the whole screen adopts the brand of the wallet being
// restored. Arkade orange replaces the official mark until those assets land.
const ACCENTS = {
  spark: { accent: '#15DE72', strong: '#059573' },
  arkade: { accent: '#F14317', strong: '#C0360F' },
};

export default {
  name: 'RestorePage',
  setup() {
    const walletStore = useWalletStore();
    const seed = useBip39Mnemonic({ wordCount: SEED_WORD_COUNT });
    return { walletStore, ...seed };
  },
  data() {
    return {
      currentStep: 1,
      isValidating: false,
      detecting: false,
      mnemonicError: '',
      restoringStatus: this.$t('Getting things ready...'),
      selectedType: 'spark',
    };
  },
  computed: {
    /**
     * A route can pin the wallet type (`/spark-restore`, `/arkade-restore`) so
     * the type-specific entries (Settings "restore Spark", a direct Arkade
     * link) skip the chooser. The neutral `/restore` lets the user pick.
     */
    lockedType() {
      const path = this.$route.path || '';
      if (path.includes('arkade-restore')) return 'arkade';
      if (path.includes('spark-restore')) return 'spark';
      return null;
    },
    /** Wallet types the user could plausibly restore on this device. */
    availableTypes() {
      if (this.lockedType) return [this.lockedType];
      const types = [];
      if (!this.walletStore.hasSparkWallet) types.push('spark');
      if (!this.walletStore.hasArkadeWallet) types.push('arkade');
      // Both already present (unusual): still let the user try either so they're
      // never dead-ended — the store rejects a duplicate with a clear message.
      return types.length ? types : ['spark', 'arkade'];
    },
    showTypeSwitch() {
      return !this.lockedType && this.availableTypes.length > 1;
    },
    accent() {
      return (ACCENTS[this.selectedType] || ACCENTS.spark).accent;
    },
    accentStrong() {
      return (ACCENTS[this.selectedType] || ACCENTS.spark).strong;
    },
    titleCopy() {
      return this.selectedType === 'arkade'
        ? this.$t('Restore your Arkade wallet')
        : this.$t('Restore your Spark wallet');
    },
    descCopy() {
      return this.selectedType === 'arkade'
        ? this.$t('Enter your 12-word recovery phrase to restore your Arkade wallet.')
        : this.$t('Enter your 12-word recovery phrase to restore your Spark wallet.');
    },
    continueCopy() {
      return this.selectedType === 'arkade'
        ? this.$t('Restore Arkade wallet')
        : this.$t('Restore Spark wallet');
    },
    restoringTitleCopy() {
      // Stay type-neutral until the chain check resolves, so we never flash a
      // wallet type that detection is about to correct.
      if (this.detecting) return this.$t('Restoring your wallet');
      return this.selectedType === 'arkade'
        ? this.$t('Restoring your Arkade wallet')
        : this.$t('Restoring your Spark wallet');
    },
    canContinue() {
      return this.mnemonicIsComplete;
    },
    mnemonic() {
      return this.normalisedMnemonic;
    },
    totalSteps() {
      return 2; // Seed → Restoring
    },
  },
  created() {
    // Default to the locked type, else the first available (Spark when both are
    // free, matching the "keep Spark default" onboarding choice).
    this.selectedType = this.lockedType || this.availableTypes[0] || 'spark';
  },
  methods: {
    selectType(type) {
      this.selectedType = type;
      this.mnemonicError = '';
    },
    typeLabel(type) {
      return type === 'arkade' ? 'Arkade' : 'Spark';
    },

    /**
     * Per-input handler that wraps the composable's normaliser with the
     * page-local concern of clearing the error banner once the user edits.
     */
    onMnemonicInput(index) {
      this.normalizeWordInput(index);
      if (this.mnemonicError) this.mnemonicError = '';
    },

    handleBack() {
      this.$router.push('/');
    },

    async validateAndContinue() {
      this.mnemonicError = '';

      // Client-side: only verify each word exists in the official BIP-39 list.
      // This catches typos with precise feedback ("word 7 doesn't look right")
      // without blocking valid phrases on checksum edge cases. The store + SDK
      // perform the authoritative checksum check and reject genuinely invalid
      // phrases (handled in restoreWallet's catch).
      const badPositions = [];
      this.inputWords.forEach((raw, idx) => {
        if (!this.isValidBip39Word(raw)) {
          badPositions.push(idx + 1);
        }
      });

      if (badPositions.length > 0) {
        const positions = badPositions.join(', ');
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

      // ── Safety net: confirm the wallet type against the chain ──
      // A 12-word phrase can't reveal Spark vs Arkade on its own (both are
      // BIP-39), so before committing we derive BOTH wallets and ask which one
      // actually holds funds/history. This makes it impossible to silently
      // restore a funded seed as the wrong (empty) backend. When both are
      // unused there's nothing to lose, so we honour the user's explicit pick.
      this.restoringStatus = this.$t('Checking your recovery phrase...');
      this.detecting = true;
      let resolvedType = this.selectedType;
      try {
        const detected = await this._detectFundedType(this.mnemonic);
        if (detected) {
          resolvedType = detected;
          if (detected !== this.selectedType) {
            this.selectedType = detected; // reflect in the spinner title + accent
            this.$q.notify({
              type: 'positive',
              message: this.$t('We found your funds'),
              caption: detected === 'arkade'
                ? this.$t('This is an Arkade recovery phrase, so we are restoring your Arkade wallet.')
                : this.$t('This is a Spark recovery phrase, so we are restoring your Spark wallet.'),
              timeout: 4500,
            });
          }
        }
      } catch (error) {
        // Detection is best-effort (e.g. offline). Fall back to the chosen
        // type — the restore itself needs the network too, so a real outage
        // surfaces a clear error below rather than a wrong-type wallet.
        console.warn('Wallet-type detection failed, using selected type:', error?.message || error);
      } finally {
        this.detecting = false;
      }

      this.restoringStatus = this.$t('Securing your wallet...');
      const onProgress = (step) => {
        const messages = {
          legacyCheck: this.$t('Checking for an existing wallet...'),
          encrypting: this.$t('Securing your wallet...'),
          connecting: this.$t('Connecting...'),
          business: this.$t('Setting up Business wallet...'),
          personal: this.$t('Setting up Personal wallet...'),
          done: this.$t('Almost done...'),
        };
        this.restoringStatus = messages[step] || this.restoringStatus;
      };

      try {
        if (resolvedType === 'arkade') {
          await this.walletStore.addArkadeWallet({
            mnemonic: this.mnemonic,
            isRestore: true,
            onProgress,
          });
        } else {
          await this.walletStore.addSparkWallet({
            mnemonic: this.mnemonic,
            network: 'MAINNET',
            isRestore: true,
            onProgress,
          });
        }

        this.restoringStatus = this.$t('Wallet restored!');
        await new Promise((resolve) => setTimeout(resolve, 800));

        this.$router.replace(
          resolvedType === 'arkade' ? '/spark-success?mode=arkade' : '/spark-success'
        );
      } catch (error) {
        console.error('Failed to restore wallet:', error);
        const { message, caption } = this._userFacingRestoreError(error);
        this.walletStore.showPaymentError(error, {
          context: 'connect',
          route: `${resolvedType} wallet restore`,
          title: message,
          reason: caption,
          t: this.$t.bind(this),
        });
        this.currentStep = 1;
      }
    },

    /**
     * Ask the chains which backend this recovery phrase belongs to, by deriving
     * each wallet and checking for real activity (balance or transaction
     * history). Probes run concurrently; Spark covers both the modern (account
     * 1) and legacy (account 0) derivations.
     *
     * Returns 'spark' | 'arkade' when exactly one shows activity. Returns null
     * when both are unused (nothing to lose — honour the manual pick), when
     * both somehow show activity, or when the probes fail (offline) — the
     * caller then keeps the user's selected type.
     */
    async _detectFundedType(mnemonic) {
      const [sparkModern, sparkLegacy, arkade] = await Promise.allSettled([
        SparkWalletProvider.probeAccountActivity(mnemonic, 'MAINNET', 1),
        SparkWalletProvider.probeAccountActivity(mnemonic, 'MAINNET', 0),
        ArkadeWalletProvider.probeActivity(mnemonic, { network: 'bitcoin' }),
      ]);
      const sparkActive = !!(sparkModern.value?.hasActivity || sparkLegacy.value?.hasActivity);
      const arkadeActive = !!arkade.value?.hasActivity;
      if (arkadeActive && !sparkActive) return 'arkade';
      if (sparkActive && !arkadeActive) return 'spark';
      return null;
    },

    /**
     * Map store / SDK errors to plain-language messages. Technical details are
     * logged; the user sees only what they can act on.
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

      if (error?.code === 'ARKADE_WALLET_EXISTS') {
        return {
          message: this.$t('Your Arkade wallet is already set up'),
          caption: this.$t(
            'An Arkade wallet is already on this device. Remove it from Settings before restoring a different recovery phrase.'
          ),
        };
      }

      // Phrase-shaped errors (checksum / decoding) from either backend. SDK
      // wording varies by version, so match a small set of stable keywords.
      const rawMessage = (error?.message || '').toLowerCase();
      const isPhraseError = error?.code === 'ARKADE_INVALID_MNEMONIC'
        || /mnemonic|seed|recovery phrase|invalid hex|checksum/.test(rawMessage);
      if (isPhraseError) {
        return {
          message: this.$t("Your recovery phrase wasn't accepted"),
          caption: this.$t(
            "One or more words don't add up. Please double-check each word, including the last one, and try again."
          ),
        };
      }

      // Otherwise: network / service errors during initialization. Rollback has
      // already cleaned up partial state, so the user can safely retry.
      return {
        message: this.$t("We couldn't restore your wallet"),
        caption: this.$t(
          'Please check your internet connection and try again. Your recovery words are still safe.'
        ),
      };
    },
  },
};
</script>

<style scoped>
.restore-page {
  min-height: 100vh;
  padding: 1rem;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

@media (min-height: 700px) {
  .restore-page {
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
  margin: 0 0 1.25rem;
  line-height: 1.5;
}

.view_title_dark {
  color: #B0B0B0;
}

.view_title {
  color: #6B7280;
}

/* ── Wallet-type selector ── */
.type-switch {
  display: inline-flex;
  padding: 4px;
  margin: 0 0 1.25rem;
  border-radius: 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-card);
  gap: 4px;
}

.type-seg {
  appearance: none;
  border: none;
  background: transparent;
  cursor: pointer;
  min-width: 92px;
  padding: 8px 16px;
  border-radius: 9px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  transition: background 0.18s ease, color 0.18s ease;
  -webkit-tap-highlight-color: transparent;
}

.type-seg--active {
  background: var(--accent);
  color: #ffffff;
  box-shadow: 0 4px 12px -4px var(--accent);
}

.type-hint {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  text-align: center;
  max-width: 330px;
  margin: -0.25rem 0 1.25rem;
  line-height: 1.45;
}

/* ── BIP-39 suggestion strip ── */
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

.suggestion-chip-dark {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.06);
}

.suggestion-chip--highlighted,
.suggestion-chip--highlighted:hover {
  background: var(--accent);
  color: #ffffff;
  border-color: var(--accent);
}

.suggestion-chip:active {
  transform: scale(0.97);
}

/* ── Words input grid ── */
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
  border: 1px solid var(--border-card);
  background: var(--bg-input);
}

.word-input-item:focus-within {
  border-color: var(--accent);
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
  color: var(--text-muted);
}

.word-input {
  flex: 1;
  width: 20%;
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

/* ── Restoring step ── */
.step-creating {
  justify-content: center;
  padding: 2rem 0;
}

.creating-animation {
  margin-bottom: 2rem;
}

/* ── Footer / CTA ── */
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
  font-weight: 600;
  color: #ffffff;
  background: var(--accent-strong);
}

.continue-btn:disabled {
  opacity: 0.5;
}

/* ── Responsive ── */
@media (max-width: 480px) {
  .restore-page {
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

  .restore-footer {
    padding: 0 1rem 1rem;
  }

  .continue-btn {
    height: 48px;
  }
}

@media (max-width: 375px) {
  .restore-page {
    padding: 0.5rem;
  }

  .card-header {
    padding: 0.75rem 1rem;
  }

  .restore-content {
    padding: 0 0.875rem 1rem;
  }

  .step-title {
    font-size: 18px;
  }

  .step-desc {
    font-size: 12px;
    max-width: 260px;
    margin-bottom: 1.25rem;
  }

  .word-input-item {
    padding: 8px 10px;
    border-radius: 10px;
  }

  .word-input {
    font-size: 12px;
  }
}

@media (max-height: 700px) {
  .step-title {
    font-size: 18px;
    margin-bottom: 0.5rem;
  }

  .step-desc {
    font-size: 12px;
    margin-bottom: 1rem;
  }
}
</style>
