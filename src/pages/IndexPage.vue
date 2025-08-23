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

          <div class="button-row">
            <q-btn
              class="connect-btn-inline"
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
            
            <q-btn
              unelevated
              class="scan-qr-btn-inline"
              @click="showScanner = true"
              no-caps
            >
              <q-icon name="las la-qrcode" class="q-mr-sm"/>
              Scan QR
            </q-btn>
          </div>
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
  background: #f5f5f5;
  padding: 1rem;
}

.wallet-connect-page.bg-dark {
  background: #1a1a1a;
  color: #e0e0e0;
}

.container {
  width: 100%;
  max-width: 500px;
  margin: 0 auto;
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
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  background: #ffffff;
  border: 1px solid #e5e7eb;
  transform: translateY(0);
  transition: all 0.3s ease;
}

.connect-card.dark-card {
  background: #2a2a2a;
  border: 1px solid #404040;
  color: #e0e0e0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.card-header {
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
  text-align: center;
  padding: 1.5rem 1rem 1rem;
}

.card-header.dark-header {
  background: #2a2a2a;
  border-bottom: 1px solid #404040;
}

.gradient-text {
  background: linear-gradient(135deg, #059573, #047857);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.nwc-logo-container {
  display: flex;
  justify-content: center;
  margin: 2rem 0 1.5rem;
}

.nwc-logo-bg {
  width: 100px;
  height: 100px;
  background: linear-gradient(135deg, #059573, #06b6d4, #0891b2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  box-shadow: 0 4px 16px rgba(5, 149, 115, 0.3);
  position: relative;
  overflow: hidden;
}

.nwc-logo-bg::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.2), transparent);
  border-radius: 50%;
}

.nwc-logo {
  width: 100%;
  height: 100%;
  object-fit: contain;
  position: relative;
  z-index: 1;
}

.nwc-logo.dark-logo {
  filter: brightness(1.2) contrast(1.1);
}

/* Enhanced Typography */
.welcome-title {
  font-weight: 700;
  color: #1f2937;
  font-size: 1.375rem;
  margin-bottom: 0.75rem;
}

.welcome-subtitle {
  font-size: 1rem;
  line-height: 1.5;
  margin-bottom: 2rem;
  max-width: 320px;
  margin-left: auto;
  margin-right: auto;
}

/* Enhanced Input Styling */
.q-input {
  margin-bottom: 1.5rem;
}

.q-input :deep(.q-field__control) {
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(5, 149, 115, 0.1);
  border: 2px solid rgba(5, 149, 115, 0.1);
  transition: all 0.3s ease;
}

.q-input :deep(.q-field__control):hover {
  border-color: rgba(5, 149, 115, 0.2);
  box-shadow: 0 4px 12px rgba(5, 149, 115, 0.15);
}

.q-input :deep(.q-field__control.q-field--focused) {
  border-color: #059573;
  box-shadow: 0 4px 16px rgba(5, 149, 115, 0.25);
}

.q-input :deep(.q-field__native) {
  font-size: 1rem;
  padding: 0.75rem 1rem;
}

/* Enhanced Scan QR Button */
.scan-qr-btn {
  background: linear-gradient(135deg, #059573, #06b6d4);
  color: white;
  border-radius: 8px;
  padding: 0.5rem 1rem;
  font-weight: 500;
  box-shadow: 0 2px 8px rgba(5, 149, 115, 0.3);
  transition: all 0.2s ease;
}

.scan-qr-btn:hover {
  background: linear-gradient(135deg, #047857, #0891b2);
  box-shadow: 0 4px 12px rgba(5, 149, 115, 0.4);
  transform: translateY(-1px);
}

/* Button Row Layout */
.button-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.connect-btn-inline {
  flex: 2; /* 66% of space */
  background: linear-gradient(135deg, #059573, #047857);
  color: white;
  border-radius: 12px;
  padding: 0.875rem 1rem;
  font-weight: 600;
  font-size: 1rem;
  box-shadow: 0 4px 16px rgba(5, 149, 115, 0.4);
  transition: all 0.3s ease;
  height: 52px;
}

.connect-btn-inline:hover {
  background: linear-gradient(135deg, #047857, #06b6d4);
  box-shadow: 0 6px 20px rgba(5, 149, 115, 0.5);
  transform: translateY(-2px);
}

.connect-btn-inline:active {
  transform: translateY(0);
  box-shadow: 0 2px 8px rgba(5, 149, 115, 0.3);
}

.scan-qr-btn-inline {
  flex: 1; /* 33% of space */
  background: linear-gradient(135deg, #3b82f6, #06b6d4);
  color: white;
  border-radius: 12px;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  transition: all 0.2s ease;
  height: 52px;
  min-width: 0;
  position: relative;
  overflow: hidden;
}

.scan-qr-btn-inline::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.1), transparent);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.scan-qr-btn-inline:hover::before {
  opacity: 1;
}

.scan-qr-btn-inline:hover {
  background: linear-gradient(135deg, #2563eb, #0891b2);
  box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
  transform: translateY(-1px);
}

.scan-qr-btn-inline:active {
  transform: translateY(0);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}

.card-footer {
  background: linear-gradient(135deg, rgba(248, 249, 250, 0.8), rgba(232, 245, 243, 0.6));
  padding: 1rem;
  border-top: 1px solid rgba(5, 149, 115, 0.1);
}

.card-footer.dark-footer {
  background: linear-gradient(135deg, rgba(40, 40, 40, 0.8), rgba(26, 46, 42, 0.6));
  border-top: 1px solid rgba(5, 149, 115, 0.2);
}

.connect-btn {
  background: linear-gradient(135deg, #059573, #047857);
  color: white;
  border-radius: 12px;
  padding: 1rem;
  font-weight: 600;
  font-size: 1.0625rem;
  box-shadow: 0 4px 16px rgba(5, 149, 115, 0.4);
  transition: all 0.3s ease;
  height: 56px;
}

.connect-btn:hover {
  background: linear-gradient(135deg, #047857, #06b6d4);
  box-shadow: 0 6px 20px rgba(5, 149, 115, 0.5);
  transform: translateY(-2px);
}

.connect-btn:active {
  transform: translateY(0);
  box-shadow: 0 2px 8px rgba(5, 149, 115, 0.3);
}

.qr-scanner-container {
  height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f8f9fa, #e8f5f3);
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  border: 2px solid rgba(5, 149, 115, 0.1);
}

.qr-scanner-container.dark-scanner {
  background: linear-gradient(135deg, #2a2a2a, #1a2e2a);
  border-color: rgba(5, 149, 115, 0.2);
}

.scan-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(5, 149, 115, 0.8), rgba(6, 182, 212, 0.7));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 1;
  backdrop-filter: blur(4px);
}

.scan-overlay p {
  font-size: 0.875rem;
  margin: 0;
  font-weight: 500;
}

/* Enhanced Scanner Styling */
.scanner-title {
  color: #1f2937;
  margin-bottom: 0.5rem;
}

.scanner-subtitle {
  line-height: 1.5;
  max-width: 280px;
  margin: 0 auto;
}

/* Enhanced Dialog Styling */
.name-dialog {
  width: 100%;
  max-width: 400px;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(5, 149, 115, 0.2);
  border: 1px solid rgba(5, 149, 115, 0.1);
}

.dialog-header {
  background: linear-gradient(135deg, rgba(5, 149, 115, 0.08), rgba(6, 182, 212, 0.05));
  border-bottom: 1px solid rgba(5, 149, 115, 0.1);
  padding: 1.5rem;
}

.dialog-header.dark-dialog-header {
  background: linear-gradient(135deg, rgba(5, 149, 115, 0.15), rgba(6, 182, 212, 0.1));
  border-bottom: 1px solid rgba(5, 149, 115, 0.2);
}

.dialog-title {
  font-weight: 700;
  color: #1f2937;
}

.dialog-content {
  padding: 1.5rem;
}

.wallet-name-input :deep(.q-field__control) {
  border-radius: 12px;
  border: 2px solid rgba(5, 149, 115, 0.1);
  transition: all 0.3s ease;
}

.wallet-name-input :deep(.q-field__control):hover {
  border-color: rgba(5, 149, 115, 0.2);
}

.wallet-name-input :deep(.q-field__control.q-field--focused) {
  border-color: #059573;
  box-shadow: 0 0 0 3px rgba(5, 149, 115, 0.1);
}

.input-hint {
  font-size: 0.875rem;
  color: #6b7280;
  margin-top: 0.5rem;
  text-align: center;
}

/* Enhanced Action Buttons */
.cancel-btn {
  color: #6b7280;
  font-weight: 500;
}

.continue-btn {
  background: linear-gradient(135deg, #059573, #06b6d4);
  color: white;
  font-weight: 600;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(5, 149, 115, 0.3);
  transition: all 0.2s ease;
}

.continue-btn:hover {
  background: linear-gradient(135deg, #047857, #0891b2);
  box-shadow: 0 4px 12px rgba(5, 149, 115, 0.4);
  transform: translateY(-1px);
}

.continue-btn:disabled {
  background: #d1d5db;
  color: #9ca3af;
  box-shadow: none;
  transform: none;
}

/* Mobile Optimizations */
@media (max-width: 480px) {
  .wallet-connect-page {
    padding: 0.75rem;
  }
  
  .container {
    max-width: 100%;
  }
  
  .connect-card {
    border-radius: 12px;
  }
  
  .card-header {
    padding: 1.25rem 1rem 0.75rem;
  }
  
  .nwc-logo-container {
    margin: 1.5rem 0 1rem;
  }
  
  .nwc-logo-bg {
    width: 80px;
    height: 80px;
    padding: 1.25rem;
  }
  
  .welcome-title {
    font-size: 1.25rem;
    margin-bottom: 0.5rem;
  }
  
  .welcome-subtitle {
    font-size: 0.9375rem;
    margin-bottom: 1.5rem;
    max-width: 280px;
  }
  
  .q-input :deep(.q-field__native) {
    font-size: 0.9375rem;
    padding: 0.625rem 0.875rem;
  }
  
  .connect-btn {
    height: 52px;
    font-size: 1rem;
    padding: 0.875rem;
  }
  
  .button-row {
    gap: 0.5rem;
  }
  
  .connect-btn-inline,
  .scan-qr-btn-inline {
    height: 48px;
  }
  
  .connect-btn-inline {
    padding: 0.75rem 0.875rem;
  }
  
  .qr-scanner-container {
    height: 250px;
    border-radius: 10px;
  }
  
  .scanner-title {
    font-size: 1.125rem;
  }
  
  .scanner-subtitle {
    font-size: 0.875rem;
    max-width: 240px;
  }
  
  .name-dialog {
    max-width: 350px;
    margin: 1rem;
  }
  
  .dialog-header,
  .dialog-content {
    padding: 1.25rem;
  }
  
  .input-hint {
    font-size: 0.8125rem;
  }
}
</style>