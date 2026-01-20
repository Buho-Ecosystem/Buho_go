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
              <q-icon name="las la-bolt" size="24px" class="q-mr-md" />
              <div class="choice-btn-text">
                <div class="choice-btn-title">{{ $t('Create Wallet') }}</div>
                <div class="choice-btn-desc">{{ $t('Self-custody with Spark') }}</div>
              </div>
              <q-icon name="las la-angle-right" size="20px" />
            </div>
          </q-btn>

          <!-- Connect Wallet (NWC) Option -->
          <q-btn
            class="choice-btn full-width q-mb-lg"
            :class="$q.dark.isActive ? 'btn_dark' : 'btn_light'"
            @click="goToNWCSetup"
            no-caps
            unelevated
          >
            <div class="choice-btn-content">
              <q-icon name="las la-link" size="24px" class="q-mr-md" />
              <div class="choice-btn-text">
                <div class="choice-btn-title">{{ $t('Connect Wallet') }}</div>
                <div class="choice-btn-desc">{{ $t('Link via NWC') }}</div>
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
