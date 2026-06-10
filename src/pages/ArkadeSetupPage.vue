<template>
  <q-page class="arkade-setup-page" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <div class="container">
      <q-card
        class="setup-card"
        :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
      >
        <q-card-section class="setup-content">
          <div class="step-content step-creating">
            <ArkadeLogo variant="mark" :size="64" class="arkade-loading-mark" />
            <h2 class="step-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
              {{ $t('Creating your Arkade wallet') }}
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
import ArkadeLogo from '../components/ArkadeLogo.vue';

export default {
  name: 'ArkadeSetupPage',
  components: { ArkadeLogo },
  setup() {
    const walletStore = useWalletStore();
    return { walletStore };
  },
  data() {
    return {
      creatingStatus: this.$t('Getting things ready...'),
    };
  },
  async mounted() {
    // Visual-audit harness: never touch the real SDK / network.
    if (typeof window !== 'undefined' && window.__AUDIT__) {
      this.creatingStatus = this.$t('Securing your wallet...');
      return;
    }
    await this.createWallet();
  },
  methods: {
    async createWallet() {
      try {
        // addArkadeWallet generates a fresh 12-word phrase, encrypts it with
        // the device key, then connects. Backup is deferred — we nudge the
        // user to save their phrase later, once funds arrive.
        await this.walletStore.addArkadeWallet({
          onProgress: (step) => {
            const messages = {
              encrypting: this.$t('Securing your wallet...'),
              connecting: this.$t('Connecting to Arkade...'),
              done: this.$t('Almost done...'),
            };
            this.creatingStatus = messages[step] || this.creatingStatus;
          },
        });

        this.creatingStatus = this.$t('Wallet created!');
        await new Promise((resolve) => setTimeout(resolve, 800));

        this.$router.replace('/spark-success?mode=arkade');
      } catch (error) {
        console.error('Failed to create Arkade wallet:', error);
        this.walletStore.showPaymentError(error, {
          context: 'connect',
          route: 'Arkade wallet creation',
          t: this.$t.bind(this),
        });
        this.$router.push('/');
      }
    },
  },
};
</script>

<style scoped>
.arkade-setup-page {
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

.step-creating {
  justify-content: center;
  padding: 2rem 0;
}

/* Branded loader: the Arkade mark gently pulses while the wallet is created.
   Progress is spelled out in the status line below, so this reads clearly as
   "working" without a separate spinner. */
.arkade-loading-mark {
  margin: 0 auto 1.75rem;
  animation: arkadePulse 1.6s ease-in-out infinite;
}

@keyframes arkadePulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.94); }
}

@media (prefers-reduced-motion: reduce) {
  .arkade-loading-mark { animation: none; }
}

@media (max-width: 480px) {
  .arkade-setup-page {
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
}
</style>
