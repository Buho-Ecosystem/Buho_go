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
              {{ $t('Step') }} {{ currentStep }}/3
            </div>
          </div>
        </q-card-section>

        <!-- Content -->
        <q-card-section class="restore-content">
          <!-- Step 1: Enter Seed Phrase -->
          <div v-if="currentStep === 1" class="step-content">
            <div class="step-icon">
              <div class="icon-bg">
                <q-icon name="las la-undo-alt" size="32px" color="white" />
              </div>
            </div>
            <h2 class="step-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
              {{ $t('Restore Spark Wallet') }}
            </h2>
            <p class="step-desc" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ $t('Enter your 12-word seed phrase to restore your Spark wallet. This is only for Spark wallets.') }}
            </p>

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
                  spellcheck="false"
                  class="word-input"
                  style="width: 20%;"
                  :class="$q.dark.isActive ? 'input-dark' : 'input-light'"
                  @input="normalizeWord(index)"
                  @keydown.enter="focusNextInput(index)"
                  @paste="handlePaste"
                  :ref="el => wordInputRefs[index] = el"
                />
              </div>
            </div>

            <div v-if="mnemonicError" class="mnemonic-error">
              {{ mnemonicError }}
            </div>
          </div>

          <!-- Step 2: Set PIN -->
          <div v-else-if="currentStep === 2" class="step-content step-pin">
            <div class="step-icon">
              <div class="icon-bg icon-lock">
                <q-icon name="las la-lock" size="32px" color="white" />
              </div>
            </div>
            <h2 class="step-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
              {{ pinMode === 'create' ? $t('Set Your PIN') : $t('Confirm Your PIN') }}
            </h2>
            <p class="step-desc" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ pinMode === 'create'
                ? $t('Create a 6-digit PIN to protect your wallet')
                : $t('Enter your PIN again to confirm')
              }}
            </p>

            <!-- PIN Dots -->
            <div class="pin-dots-inline">
              <div
                v-for="i in 6"
                :key="i"
                class="pin-dot"
                :class="[
                  $q.dark.isActive ? 'pin-dot-dark' : 'pin-dot-light',
                  currentPin.length >= i ? 'filled' : '',
                  pinError ? 'error' : ''
                ]"
              ></div>
            </div>

            <div v-if="pinError" class="pin-error">
              {{ pinError }}
            </div>

            <!-- Numpad -->
            <div class="numpad-inline">
              <div class="numpad-row" v-for="row in numpadRows" :key="row.join('')">
                <button
                  v-for="key in row"
                  :key="key"
                  class="numpad-btn"
                  :class="$q.dark.isActive ? 'numpad-btn-dark' : 'numpad-btn-light'"
                  @click="handlePinKey(key)"
                >
                  <template v-if="key === 'del'">
                    <q-icon name="las la-backspace" size="22px" />
                  </template>
                  <template v-else-if="key === ''">
                    <!-- Empty button -->
                  </template>
                  <template v-else>
                    {{ key }}
                  </template>
                </button>
              </div>
            </div>
          </div>

          <!-- Step 3: Restoring Wallet -->
          <div v-else-if="currentStep === 3" class="step-content step-creating">
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
import { useWalletStore } from '../stores/wallet';
import { SparkWalletProvider } from '../providers/SparkWalletProvider';

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
      inputWords: Array(12).fill(''),
      wordInputRefs: [],
      mnemonicError: '',

      // PIN
      pinMode: 'create',
      currentPin: '',
      firstPin: '',
      pinError: '',
      numpadRows: [
        ['1', '2', '3'],
        ['4', '5', '6'],
        ['7', '8', '9'],
        ['', '0', 'del']
      ],

      // Restoring
      restoringStatus: 'Initializing...',
    }
  },
  computed: {
    canContinue() {
      return this.inputWords.every(word => word.trim().length > 0);
    },
    mnemonic() {
      return this.inputWords.map(w => w.trim().toLowerCase()).join(' ');
    }
  },
  methods: {
    normalizeWord(index) {
      this.inputWords[index] = this.inputWords[index].toLowerCase().trim();
      this.mnemonicError = '';
    },

    focusNextInput(index) {
      if (index < 11 && this.wordInputRefs[index + 1]) {
        this.wordInputRefs[index + 1].focus();
      }
    },

    handlePaste(event) {
      event.preventDefault();
      const pastedText = event.clipboardData.getData('text');
      const words = pastedText.trim().toLowerCase().split(/\s+/);

      if (words.length >= 12) {
        for (let i = 0; i < 12; i++) {
          this.inputWords[i] = words[i] || '';
        }
        this.mnemonicError = '';
      } else if (words.length > 1) {
        // Paste multiple words starting from current position
        const currentIndex = this.inputWords.findIndex((_, i) =>
          this.wordInputRefs[i] === event.target
        );
        for (let i = 0; i < words.length && currentIndex + i < 12; i++) {
          this.inputWords[currentIndex + i] = words[i];
        }
      }
    },

    handleBack() {
      if (this.currentStep === 2) {
        if (this.pinMode === 'confirm') {
          this.pinMode = 'create';
          this.currentPin = '';
          this.firstPin = '';
          this.pinError = '';
        } else {
          this.currentStep = 1;
        }
      } else if (this.currentStep === 1) {
        this.$router.push('/');
      }
    },

    async validateAndContinue() {
      this.isValidating = true;
      this.mnemonicError = '';

      try {
        // Validate by trying to restore wallet
        const wallet = await SparkWalletProvider.restoreWallet(this.mnemonic, 'MAINNET');

        // Clean up test wallet
        wallet.cleanupConnections();

        // Move to PIN step
        this.currentStep = 2;
        this.pinMode = 'create';
        this.currentPin = '';
      } catch (error) {
        console.error('Invalid mnemonic:', error);
        this.mnemonicError = this.$t('Invalid seed phrase. Please check your words and try again.');

        this.$q.notify({
          type: 'negative',
          message: this.$t('Invalid seed phrase'),
          caption: this.$t('Please verify your words are correct'),
          
        });
      } finally {
        this.isValidating = false;
      }
    },

    handlePinKey(key) {
      this.pinError = '';

      if (key === 'del') {
        if (this.currentPin.length > 0) {
          this.currentPin = this.currentPin.slice(0, -1);
        }
      } else if (key !== '' && this.currentPin.length < 6) {
        this.currentPin += key;

        // Auto-proceed when 6 digits entered
        if (this.currentPin.length === 6) {
          this.processPinEntry();
        }
      }
    },

    processPinEntry() {
      if (this.pinMode === 'create') {
        this.firstPin = this.currentPin;
        this.currentPin = '';
        this.pinMode = 'confirm';
      } else {
        // Confirm mode
        if (this.currentPin === this.firstPin) {
          this.restoreWallet();
        } else {
          this.pinError = this.$t('PINs do not match');
          this.currentPin = '';

          setTimeout(() => {
            this.pinError = '';
          }, 2000);
        }
      }
    },

    async restoreWallet() {
      this.currentStep = 3;
      this.restoringStatus = this.$t('Encrypting wallet...');

      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        this.restoringStatus = this.$t('Connecting to Spark network...');

        await this.walletStore.addSparkWallet({
          name: 'Spark Wallet',
          mnemonic: this.mnemonic,
          pin: this.firstPin,
          network: 'MAINNET'
        });

        this.restoringStatus = this.$t('Syncing wallet...');
        await new Promise(resolve => setTimeout(resolve, 500));

        this.restoringStatus = this.$t('Wallet restored!');
        await new Promise(resolve => setTimeout(resolve, 800));

        this.$q.notify({
          type: 'positive',
          message: this.$t('Wallet restored successfully'),
          
        });

        this.$router.push('/wallet');
      } catch (error) {
        console.error('Failed to restore wallet:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to restore wallet'),
          caption: this.$t('Please check your backup phrase and try again'),
          
        });
        this.currentStep = 2;
        this.pinMode = 'create';
        this.currentPin = '';
        this.firstPin = '';
      }
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
  background: #0C0C0C;
}

.bg-light {
  background: #F8F8F8;
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
  font-family: Fustat, 'Inter', sans-serif;
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
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 22px;
  font-weight: 700;
  text-align: center;
  margin: 0 0 0.75rem;
}

.step-desc {
  font-family: Fustat, 'Inter', sans-serif;
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
  background: #171717;
  border-color: #2A342A;
}

.word-input-item:has(.input-light) {
  background: #F8F8F8;
  border-color: #EBEBEB;
}

.word-input-item:focus-within {
  border-color: #15DE72;
}

.word-number {
  font-family: 'SF Mono', 'Menlo', monospace;
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
  font-family: 'SF Mono', 'Menlo', monospace;
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
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  color: #ff4444;
  text-align: center;
  margin-top: 1rem;
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
  font-family: Fustat, 'Inter', sans-serif;
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
  font-family: Fustat, 'Inter', sans-serif;
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
  background: #1A1A1A;
  color: #FFFFFF;
}

.numpad-btn-dark:hover {
  background: #252525;
}

.numpad-btn-dark:active {
  background: #2A342A;
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
}

.continue-btn {
  width: 100%;
  height: 52px;
  border-radius: 24px;
  font-family: Fustat, 'Inter', sans-serif;
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
