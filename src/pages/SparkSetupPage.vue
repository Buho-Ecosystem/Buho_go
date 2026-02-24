<template>
  <q-page class="spark-setup-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <div class="container">
      <q-card
        class="setup-card"
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
              {{ $t('Almost there') }}
            </div>
          </div>
        </q-card-section>

        <!-- Content -->
        <q-card-section class="setup-content">
          <!-- Step 1: Set PIN -->
          <div v-if="currentStep === 1" class="step-content step-pin">
            <div class="step-icon">
              <div class="icon-bg icon-lock">
                <q-icon :name="pinMode === 'create' ? 'las la-lock' : 'las la-check-circle'" size="32px" color="white" />
              </div>
            </div>
            <h2 class="step-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
              {{ pinMode === 'create' ? $t('Secure your wallet') : $t('One more time') }}
            </h2>
            <p class="step-desc" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ pinMode === 'create'
                ? $t('Pick a 6-digit PIN that only you know. It keeps your wallet private on this device.')
                : $t('Enter the same PIN again to make sure you got it right.')
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

          <!-- Step 2: Creating Wallet -->
          <div v-else-if="currentStep === 2" class="step-content step-creating">
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

      // Creating
      creatingStatus: 'Initializing...',
    }
  },
  async mounted() {
    await this.generateMnemonic();
  },
  methods: {
    async generateMnemonic() {
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
      }
    },

    handleBack() {
      if (this.currentStep === 1 && this.pinMode === 'confirm') {
        this.pinMode = 'create';
        this.currentPin = '';
        this.firstPin = '';
        this.pinError = '';
      } else {
        this.$router.push('/');
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
        if (this.currentPin === this.firstPin) {
          this.createWallet();
        } else {
          this.pinError = this.$t('PINs do not match');
          this.currentPin = '';
          setTimeout(() => {
            this.pinError = '';
          }, 2000);
        }
      }
    },

    async createWallet() {
      this.currentStep = 2;
      this.creatingStatus = this.$t('Encrypting wallet...');

      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        this.creatingStatus = this.$t('Connecting to Spark network...');

        await this.walletStore.addSparkWallet({
          name: 'Spark Wallet',
          mnemonic: this.mnemonic,
          pin: this.firstPin,
          network: 'MAINNET'
        });

        this.creatingStatus = this.$t('Wallet created!');
        await new Promise(resolve => setTimeout(resolve, 800));

        this.$q.notify({
          type: 'positive',
          message: this.$t('Wallet created successfully'),
        });

        this.$router.push('/wallet');
      } catch (error) {
        console.error('Failed to create wallet:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to create wallet'),
          caption: this.$t('Please try again'),
        });
        this.currentStep = 1;
        this.pinMode = 'create';
        this.currentPin = '';
        this.firstPin = '';
      }
    }
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
  background: #0C0C0C;
}

.bg-light {
  background: #F8F8F8;
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
  font-family: Fustat, 'Inter', sans-serif;
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
