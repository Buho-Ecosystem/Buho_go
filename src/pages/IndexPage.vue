<template>
  <!-- Loading Screen -->
  <LoadingScreen 
    :show="showLoadingScreen" 
    :loading-text="loadingText"
  />
  
  <q-page class="wallet-connect-page flex flex-center" :class="{ 'bg-dark': $q.dark.isActive }">
    <div class="container">

      <q-card class="connect-card" :class="{ 'dark-card': $q.dark.isActive }" v-if="!showScanner">
        <q-card-section class="card-header text-center" :class="{ 'dark-header': $q.dark.isActive }">
          <svg xmlns="http://www.w3.org/2000/svg" width="30" height="32" viewBox="0 0 30 32" fill="none">
            <path d="M0 13.4423C0 6.01833 6.01833 0 13.4423 0V18.5577C13.4423 25.9817 7.42399 32 0 32V13.4423Z"
                  fill="#059573"/>
            <path
              d="M15.3906 7.30444C15.3906 3.27031 18.6609 0 22.6951 0C26.7292 0 29.9995 3.27031 29.9995 7.30444V7.72091C29.9995 11.755 26.7292 15.0253 22.6951 15.0253C18.6609 15.0253 15.3906 11.755 15.3906 7.72091V7.30444Z"
              fill="#78D53C"/>
            <path
              d="M15.3906 24.281C15.3906 20.2469 18.6609 16.9766 22.6951 16.9766C26.7292 16.9766 29.9995 20.2469 29.9995 24.281V24.6975C29.9995 28.7316 26.7292 32.0019 22.6951 32.0019C18.6609 32.0019 15.3906 28.7316 15.3906 24.6975V24.281Z"
              fill="#43B65B"/>
          </svg>
          <span class="title q-pl-md">BuhoGO</span>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="nwc-logo-container">
            <div class="nwc-logo-bg">
              <img
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/nwc-logo%282%29-SauOakNKbFy43ZsU4o8BRAXRgPrbcJ.png"
                alt="NWC Logo" class="nwc-logo" :class="{ 'dark-logo': !$q.dark.isActive }">
            </div>
          </div>
          <div class="text-h6 text-center q-mb-sm welcome-title">Connect Your Wallet</div>
          <div class="text-center q-mb-lg welcome-subtitle" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">
            Enter your wallet's connection link or scan a QR code to get started
          </div>

          <q-input
            v-model="nwcString"
            outlined
            placeholder="Paste your wallet connection link here"
            class="q-mb-md"
            :dark="$q.dark.isActive"
          />

          <div class="text-right">
            <q-btn
              unelevated
              dense
              color="primary"
              icon="las la-qrcode"
              label="Scan QR"
              @click="showScanner = true"
              class="scan-qr-btn"
            />
          </div>
        </q-card-section>

        <q-card-section class="card-footer" :class="{ 'dark-footer': $q.dark.isActive }">
          <q-btn
            class="full-width connect-btn"
            :loading="isConnecting"
            @click="connectWallet"
            no-caps
            unelevated
          >
            <span v-if="!isConnecting">Connect Wallet</span>
            <template v-slot:loading>
              <q-spinner-dots class="q-mr-sm"/>
              Connecting...
            </template>
          </q-btn>
        </q-card-section>
      </q-card>

      <q-card class="connect-card" :class="{ 'dark-card': $q.dark.isActive }" v-else>
        <q-card-section class="card-header" :class="{ 'dark-header': $q.dark.isActive }">
          <h2 class="text-h5 text-weight-bold scanner-title">Scan QR Code</h2>
          <p class="text-subtitle2 scanner-subtitle" :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-7'">
            Point your camera at the QR code from your wallet app
          </p>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="qr-scanner-container" :class="{ 'dark-scanner': $q.dark.isActive }">
            <qrcode-capture
              @detect="handleNWCScan"
              style="border-radius: 8px !important;"
              :capture="null"
            />
            <div v-if="isScanning" class="scan-overlay">
              <q-spinner-dots color="primary" size="2em"/>
              <p class="text-white q-mt-sm">Scanning NWC QR code...</p>
            </div>
          </div>
        </q-card-section>

        <q-card-section class="card-footer" :class="{ 'dark-footer': $q.dark.isActive }">
          <q-btn
            unelevated
            class="full-width"
            label="Cancel"
            @click="showScanner = false"
            color="grey-6"
          />
        </q-card-section>
      </q-card>

      <!-- Add Wallet Name Dialog -->
      <q-dialog v-model="showNameDialog">
        <q-card class="name-dialog" :dark="$q.dark.isActive">
          <q-card-section class="dialog-header" :class="{ 'dark-dialog-header': $q.dark.isActive }">
            <div class="text-h6 dialog-title">Name Your Wallet</div>
          </q-card-section>

          <q-card-section class="dialog-content">
            <q-input
              v-model="walletName"
              outlined
              label="Wallet Name"
              placeholder="My Lightning Wallet"
              :rules="[val => !!val || 'Wallet name is required']"
              autofocus
              :dark="$q.dark.isActive"
              class="wallet-name-input"
            />
            <div class="input-hint">
              Choose a name to easily identify this wallet
            </div>
          </q-card-section>

          <q-card-actions align="right">
            <q-btn flat label="Cancel" color="grey-7" v-close-popup class="cancel-btn"/>
            <q-btn 
              unelevated 
              label="Continue" 
              color="primary" 
              @click="proceedWithConnection" 
              :disable="!walletName"
              class="continue-btn"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </div>
  </q-page>
</template>

<script>
import {webln} from "@getalby/sdk";
import {QrcodeStream, QrcodeDropZone, QrcodeCapture} from 'vue-qrcode-reader'
import LoadingScreen from '../components/LoadingScreen.vue'
import { useWalletStore } from '../stores/wallet'
import { mapActions } from 'pinia'

export default {
  name: 'WalletConnectPage',
  components: {
    QrcodeStream,
    QrcodeDropZone,
    QrcodeCapture,
    LoadingScreen,
  },
  data() {
    return {
      nwcString: '',
      isConnecting: false,
      showScanner: false,
      isScanning: false,
      scanError: null,
      showNameDialog: false,
      walletName: '',
      showLoadingScreen: true,
      loadingText: 'Initializing BuhoGO...'
    }
  },
  mounted() {
    this.initializeApp();
  },
  methods: {
    ...mapActions(useWalletStore, ['addWallet']),

    async initializeApp() {
      this.loadingText = 'Checking wallet state...';
      
      // Simulate some loading time for better UX
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Check for existing wallet state
      const existingState = localStorage.getItem('buhoGO_wallet_store');
      if (existingState) {
        const walletInfo = JSON.parse(existingState);
        if (walletInfo.activeWalletId && walletInfo.wallets?.length > 0) {
          this.loadingText = 'Loading wallet...';
          await new Promise(resolve => setTimeout(resolve, 800));
          this.$router.push('/wallet');
          return;
        }
      }
      
      // Hide loading screen after initialization
      this.loadingText = 'Ready!';
      await new Promise(resolve => setTimeout(resolve, 500));
      this.showLoadingScreen = false;
    },
    
    async connectWallet() {
      if (!this.nwcString.trim()) return

      // Show name dialog first
      this.showNameDialog = true
    },
    async proceedWithConnection() {
      if (!this.walletName.trim()) return

      this.showLoadingScreen = true;
      this.loadingText = 'Connecting to wallet...';
      
      this.isConnecting = true
      this.showNameDialog = false

      try {
        this.loadingText = 'Verifying connection...';




        // Add wallet using Pinia store
        await this.addWallet({
          name: this.walletName,
          nwcUrl: this.nwcString
        })

        // Reset wallet name
        this.walletName = ''

        this.loadingText = 'Loading wallet interface...';
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Navigate to wallet dashboard
        this.$router.push('/wallet')
      } catch (error) {
        console.error('Error connecting wallet:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to connect wallet: ' + error.message,
          position: 'top'
        });
      } finally {
        this.isConnecting = false;
        this.showLoadingScreen = false;
      }
    },
    async handleNWCScan(result) {
      this.isScanning = true;
      this.scanError = null;

      try {
        // Check if the scanned QR code is an NWC connection string
        if (!result.startsWith('nostr+walletconnect://')) {
          throw new Error('Invalid NWC QR code format');
        }

        // Set the NWC string and connect
        this.nwcString = result;
        this.showScanner = false;
        await this.connectWallet();

      } catch (error) {
        console.error('Error scanning NWC QR code:', error);
        this.scanError = error.message;
        this.$q.notify({
          type: 'negative',
          message: 'Failed to scan QR code: ' + error.message,
          position: 'top'
        });
      } finally {
        this.isScanning = false;
      }
    }
  }
}
</script>

<style scoped>
.wallet-connect-page {
  min-height: 100vh;
  background-color: #f8f9fa;
  padding: 1rem;
}

.wallet-connect-page.bg-dark {
  background-color: #121212;
  color: #e0e0e0;
}

.container {
  width: 100%;
  max-width: 500px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.logo-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.logo {
  width: 32px;
  height: 32px;
}

.title {
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, #059573, #10b981, #34d399, #06b6d4, #0891b2, #0284c7);
  background-size: 400% 400%;
  animation: gradientShift 6s ease-in-out infinite;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0;
}

@keyframes gradientShift {
  0% {
    background-position: 0% 0%;
  }
  25% {
    background-position: 100% 0%;
  }
  50% {
    background-position: 100% 100%;
  }
  75% {
    background-position: 0% 100%;
  }
  100% {
    background-position: 0% 0%;
  }
}

.connect-card {
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(229, 231, 235, 0.5);
}

.connect-card.dark-card {
  background: rgba(30, 30, 30, 0.9);
  border: 1px solid rgba(50, 50, 50, 0.5);
  color: #e0e0e0;
}

.card-header {
  background: rgba(5, 149, 115, 0.05);
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
  text-align: center;
}

.card-header.dark-header {
  background: rgba(5, 149, 115, 0.1);
  border-bottom: 1px solid rgba(50, 50, 50, 0.5);
}

.gradient-text {
  background: linear-gradient(135deg, #059573, #047857);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.nwc-logo-container {
  display: flex;
  justify-content: center;
  margin: 1.5rem 0;
}

.nwc-logo-bg {
  width: 100px;
  height: 100px;
  background-color: rgba(5, 149, 115, 0.1);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.nwc-logo {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.nwc-logo.dark-logo {
  filter: invert(1);
}

.card-footer {
  background: rgba(243, 244, 246, 0.5);
  padding: 1rem;
}

.card-footer.dark-footer {
  background: rgba(40, 40, 40, 0.5);
}

.connect-btn {
  background: linear-gradient(135deg, #059573, #047857);
  color: white;
  border-radius: 0.75rem;
  padding: 0.75rem;
  font-weight: 500;
  box-shadow: 0 2px 0 0 rgba(4, 120, 87, 0.6);
  transition: all 0.2s ease;
}

.connect-btn:hover {
  background: linear-gradient(135deg, #047857, #065f46);
  box-shadow: 0 3px 0 0 rgba(4, 120, 87, 0.7);
}

.qr-scanner-container {
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f3f4f6;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
}

.qr-scanner-container.dark-scanner {
  background-color: #2a2a2a;
}

.scan-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

.scan-overlay p {
  font-size: 0.875rem;
  margin: 0;
}

.name-dialog {
  width: 100%;
  max-width: 400px;
  border-radius: 16px;
}

.dialog-header {
  background: rgba(5, 149, 115, 0.05);
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
}

.dialog-header.dark-dialog-header {
  background: rgba(5, 149, 115, 0.1);
  border-bottom: 1px solid rgba(50, 50, 50, 0.5);
}

.dialog-content {
  padding: 20px;
}
</style>
