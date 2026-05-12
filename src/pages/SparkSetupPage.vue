<template>
  <q-page class="spark-setup-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <div class="container">
      <q-card
        class="setup-card"
        :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
      >
        <!-- Header -->

        <!-- Content -->
        <q-card-section class="setup-content">
          <!-- Creating Wallet -->
          <div v-if="currentStep === 1" class="step-content step-creating">
            <div class="creating-animation">
              <q-spinner-orbit size="80px" color="primary" />
            </div>
            <h2 class="step-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
              {{ $t('Creating Your Wallet') }}
            </h2>
            <p class="step-desc" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ creatingStatus }}
            </p>
          </div>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script>
import { useWalletStore } from '../stores/wallet';
import { SparkWalletProvider } from '../providers/SparkWalletProvider';

export default {
  name: 'SparkSetupPage',
  setup() {
    const walletStore = useWalletStore();
    return { walletStore };
  },
  data() {
    return {
      currentStep: 1,
      isProcessing: false,
      mnemonic: '',
      creatingStatus: 'Initializing...',
    }
  },
  async mounted() {
    if (typeof window !== 'undefined' && window.__AUDIT__) {
      this.mnemonic = 'audit stub mnemonic twelve words for visual capture only skip real sdk'
      this.creatingStatus = this.$t('Encrypting wallet...')
      return
    }
    await this.generateAndCreate();
  },
  methods: {
    async generateAndCreate() {
      try {
        const { wallet, mnemonic } = await SparkWalletProvider.createNewWallet('MAINNET');
        this.mnemonic = mnemonic;
        wallet.cleanupConnections();
      } catch (error) {
        console.error('Failed to generate wallet:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to generate wallet'),
          caption: this.$t('Please try again'),
        });
        this.$router.push('/');
        return;
      }

      // Proceed directly to wallet creation
      this.creatingStatus = this.$t('Encrypting wallet...');

      try {
        await this.walletStore.addSparkWallet({
          mnemonic: this.mnemonic,
          network: 'MAINNET',
          onProgress: (step) => {
            const messages = {
              encrypting: this.$t('Encrypting wallet...'),
              business: this.$t('Setting up Business wallet...'),
              personal: this.$t('Setting up Personal wallet...'),
              done: this.$t('Almost done...'),
            };
            this.creatingStatus = messages[step] || this.creatingStatus;
          }
        });

        this.creatingStatus = this.$t('Wallet created!');
        await new Promise(resolve => setTimeout(resolve, 800));

        this.$router.replace('/spark-success');
      } catch (error) {
        console.error('Failed to create wallet:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to create wallet'),
          caption: this.$t('Please try again'),
        });
        this.$router.push('/');
      }
    },

  }
}
</script>

<style scoped>
.spark-setup-page {
  min-height: 100vh;
  padding: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bg-dark {
  background: var(--bg-primary);
}

.bg-light {
  background: var(--bg-primary);
}

.container {
  width: 100%;
  max-width: 480px;
}

.setup-card {
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
.setup-content {
  padding: 0 1.5rem 1.5rem;
  min-height: 400px;
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
  color: var(--text-secondary);
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
  background: var(--border-card);
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

/* Responsive */
@media (max-width: 480px) {
  .spark-setup-page {
    padding: 0.5rem;
  }

  .setup-content {
    padding: 0 1rem 1rem;
  }

  .step-title {
    font-size: 20px;
  }

  .step-desc {
    font-size: 13px;
    max-width: 280px;
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
}

@media (max-height: 700px) {
  .step-icon {
    margin-bottom: 1rem;
  }

  .icon-bg {
    width: 60px;
    height: 60px;
  }

  .icon-bg .q-icon {
    font-size: 28px !important;
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
</style>
