<template>
  <!-- Loading Screen -->
  <LoadingScreen
    :show="showLoadingScreen"
    :loading-text="loadingText"
  />

  <q-page class="welcome-page flex flex-center" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <div class="container">
      <q-card
        class="welcome-card"
        :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
      >
        <q-card-section class="card-header">
          <div class="header-logo">
            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="32" viewBox="0 0 30 32" fill="none">
              <path d="M0 13.4423C0 6.01833 6.01833 0 13.4423 0V18.5577C13.4423 25.9817 7.42399 32 0 32V13.4423Z"
                    fill="#059573"/>
              <path
                d="M15.3906 7.30444C15.3906 3.27031 18.6609 0 22.6951 0C26.7292 0 29.9995 3.27031 29.9995 7.30444V7.72091C29.9995 11.755 26.7292 15.0253 22.6951 15.0253C18.6609 15.0253 15.3906 11.755 15.3906 7.72091V7.30444Z"
                fill="#15DE72"/>
              <path
                d="M15.3906 24.281C15.3906 20.2469 18.6609 16.9766 22.6951 16.9766C26.7292 16.9766 29.9995 20.2469 29.9995 24.281V24.6975C29.9995 28.7316 26.7292 32.0019 22.6951 32.0019C18.6609 32.0019 15.3906 28.7316 15.3906 24.6975V24.281Z"
                fill="#43B65B"/>
            </svg>
            <span class="app-title">BuhoGO</span>
          </div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="welcome-icon-container">
            <div class="welcome-icon-bg">
              <q-icon name="las la-wallet" size="48px" color="white" />
            </div>
          </div>

          <div class="welcome-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
            {{ $t('Welcome to BuhoGO') }}
          </div>

          <div class="welcome-subtitle" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Your Bitcoin Lightning Wallet') }}
          </div>

          <!-- Create Wallet (Spark) Option -->
          <q-btn
            class="choice-btn full-width q-mb-md"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            @click="goToSparkSetup"
            no-caps
            unelevated
          >
            <div class="choice-btn-content">
              <div class="choice-icon-wrapper spark-icon q-mr-md">
                <svg width="24" height="23" viewBox="0 0 135 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fill-rule="evenodd" clip-rule="evenodd" d="M79.4319 49.3554L81.7454 0H52.8438L55.1573 49.356L8.9311 31.9035L0 59.3906L47.6565 72.4425L16.7743 111.012L40.1562 128L67.2966 86.7083L94.4358 127.998L117.818 111.01L86.9359 72.4412L134.587 59.3907L125.656 31.9036L79.4319 49.3554Z" fill="currentColor"/>
                </svg>
              </div>
              <div class="choice-btn-text">
                <div class="choice-btn-title">{{ $t('Create Wallet') }}</div>
                <div class="choice-btn-desc">{{ $t('Self-custody with Spark') }}</div>
              </div>
              <q-icon name="las la-angle-right" size="20px" />
            </div>
          </q-btn>

          <!-- Connect Wallet (NWC) Option -->
          <q-btn
            class="choice-btn full-width q-mb-md"
            :class="$q.dark.isActive ? 'btn_dark' : 'btn_light'"
            @click="goToNWCSetup"
            no-caps
            unelevated
          >
            <div class="choice-btn-content">
              <div class="choice-icon-wrapper nwc-icon q-mr-md">
                <svg width="24" height="24" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="url(#nwc_welcome_grad)"/>
                  <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="#897FFF"/>
                  <defs>
                    <linearGradient id="nwc_welcome_grad" x1="123.989" y1="10.4384" x2="123.989" y2="249.939" gradientUnits="userSpaceOnUse">
                      <stop stop-color="#FFCA4A"/>
                      <stop offset="1" stop-color="#F7931A"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div class="choice-btn-text">
                <div class="choice-btn-title">{{ $t('Connect Wallet') }}</div>
                <div class="choice-btn-desc">{{ $t('Link via NWC') }}</div>
              </div>
              <q-icon name="las la-angle-right" size="20px" />
            </div>
          </q-btn>

          <!-- Connect LNBits Wallet Option -->
          <q-btn
            class="choice-btn full-width q-mb-lg lnbits-btn"
            :class="$q.dark.isActive ? 'btn_dark' : 'btn_light'"
            @click="goToLNBitsSetup"
            no-caps
            unelevated
          >
            <div class="choice-btn-content">
              <div class="choice-icon-wrapper lnbits-icon q-mr-md">
                <svg width="20" height="24" viewBox="0 0 502 902" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="#FF1FE1"/>
                </svg>
              </div>
              <div class="choice-btn-text">
                <div class="choice-btn-title">{{ $t('LNBits Wallet') }}</div>
                <div class="choice-btn-desc">{{ $t('Connect via API') }}</div>
              </div>
              <q-icon name="las la-angle-right" size="20px" />
            </div>
          </q-btn>

          <!-- Restore from backup link -->
          <div class="restore-link" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            <q-btn
              flat
              no-caps
              dense
              class="restore-btn"
              :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
              @click="goToSparkRestore"
            >
              <q-icon name="las la-undo-alt" size="16px" class="q-mr-xs" />
              {{ $t('Restore from backup') }}
            </q-btn>
          </div>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script>
import LoadingScreen from '../components/LoadingScreen.vue'

export default {
  name: 'WelcomePage',
  components: {
    LoadingScreen,
  },
  data() {
    return {
      showLoadingScreen: true,
      loadingText: 'Initializing BuhoGO...'
    }
  },
  mounted() {
    this.initializeApp();
  },
  methods: {
    async initializeApp() {
      try {
        // Check for existing wallet state
        const existingState = localStorage.getItem('buhoGO_wallet_store');
        if (existingState) {
          this.loadingText = 'Checking wallet state...';

          await new Promise(resolve => setTimeout(resolve, 1000));

          try {
            const walletInfo = JSON.parse(existingState);
            if (walletInfo.activeWalletId && walletInfo.wallets?.length > 0) {
              this.loadingText = 'Loading wallet...';
              await new Promise(resolve => setTimeout(resolve, 800));
              this.$router.push('/wallet');
              return;
            }
          } catch (parseError) {
            console.warn('Failed to parse wallet state, clearing:', parseError);
            localStorage.removeItem('buhoGO_wallet_store');
          }
        }

        this.showLoadingScreen = false;
      } catch (error) {
        console.error('Error initializing app:', error);
        this.showLoadingScreen = false;
      }
    },

    goToSparkSetup() {
      this.$router.push('/spark-setup');
    },

    goToNWCSetup() {
      this.$router.push('/nwc-setup');
    },

    goToLNBitsSetup() {
      this.$router.push('/lnbits-setup');
    },

    goToSparkRestore() {
      this.$router.push('/spark-restore');
    }
  }
}
</script>

<style scoped>
.welcome-page {
  min-height: 100vh;
  padding: 1rem;
}

.bg-dark {
  background: #0C0C0C;
  color: #FFF;
}

.bg-light {
  background: #F8F8F8;
  color: #212121;
}

.container {
  width: 100%;
  max-width: 500px;
  margin: 0 auto;
}

/* Header Styling */
.card-header {
  padding: 1.5rem 1rem 1rem;
  text-align: center;
}

.header-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.app-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 24px;
  font-weight: 800;
  line-height: 100%;
  background: linear-gradient(90deg, #059573 0%, #15DE72 50%, #78D53C 100%);
  background-size: 200% 200%;
  animation: gradientShift 3s ease-in-out infinite;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

@keyframes gradientShift {
  0%, 100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}

/* Welcome Icon */
.welcome-icon-container {
  display: flex;
  justify-content: center;
  margin: 2rem 0 1.5rem;
}

.welcome-icon-bg {
  width: 100px;
  height: 100px;
  background: linear-gradient(135deg, #059573, #15DE72, #78D53C);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(21, 222, 114, 0.3);
  position: relative;
  overflow: hidden;
}

.welcome-icon-bg::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.2), transparent);
  border-radius: 50%;
}

/* Typography */
.welcome-title {
  text-align: center;
  margin-bottom: 0.5rem;
  font-size: 22px;
  font-weight: 700;
  font-family: Fustat, 'Inter', sans-serif;
}

.welcome-subtitle {
  text-align: center;
  margin-bottom: 2rem;
  font-size: 14px;
  font-family: Fustat, 'Inter', sans-serif;
}

.view_title_dark {
  color: #B0B0B0;
}

/* Choice Button Styling */
.choice-btn {
  height: auto;
  min-height: 72px;
  border-radius: 16px;
  font-family: Fustat, 'Inter', sans-serif;
  padding: 16px;
}

.choice-btn-content {
  display: flex;
  align-items: center;
  width: 100%;
  text-align: left;
}

.choice-btn-text {
  flex: 1;
}

.choice-btn-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 2px;
}

.choice-btn-desc {
  font-size: 12px;
  opacity: 0.8;
}

/* Choice Icon Wrappers */
.choice-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.choice-icon-wrapper.spark-icon {
  color: currentColor;
}

.choice-icon-wrapper.nwc-icon {
  /* NWC uses its own gradient colors from SVG */
}

.choice-icon-wrapper.lnbits-icon {
  /* LNBits uses magenta from SVG */
}

/* Restore Link */
.restore-link {
  text-align: center;
  padding-top: 0.5rem;
}

.restore-btn {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

/* Responsive Design */
@media (max-width: 480px) {
  .welcome-page {
    padding: 0.75rem;
  }

  .container {
    max-width: 100%;
  }

  .card-header {
    padding: 1.25rem 1rem 0.75rem;
  }

  .welcome-icon-bg {
    width: 80px;
    height: 80px;
  }

  .welcome-icon-bg .q-icon {
    font-size: 40px !important;
  }

  .welcome-title {
    font-size: 20px;
  }

  .welcome-subtitle {
    font-size: 13px;
    margin-bottom: 1.5rem;
  }

  .choice-btn {
    min-height: 64px;
    padding: 12px 16px;
    border-radius: 14px;
  }

  .choice-btn-title {
    font-size: 15px;
  }

  .choice-btn-desc {
    font-size: 11px;
  }
}
</style>
