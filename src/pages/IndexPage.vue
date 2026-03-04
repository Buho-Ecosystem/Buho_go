<template>
  <!-- Loading Screen -->
  <LoadingScreen
    :show="showLoadingScreen"
    :loading-text="loadingText"
  />

  <q-page class="wallet-connect-page flex flex-center" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <div class="container">

      <q-card
        class="connect-card"
        :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
        v-if="!showScanner"
      >
        <q-card-section class="card-header">
          <div class="header-with-back">
            <q-btn
              flat
              round
              dense
              @click="goBack"
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
            <div class="header-spacer"></div>
          </div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="nwc-logo-container">
            <div class="nwc-logo-bg">
              <img
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/nwc-logo%282%29-SauOakNKbFy43ZsU4o8BRAXRgPrbcJ.png"
                alt="NWC Logo"
                class="nwc-logo"
              >
            </div>
          </div>

          <div class="welcome-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
            {{ $t('Connect Your Wallet') }}
          </div>

          <div class="welcome-subtitle" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Enter your wallet\'s connection link or scan a QR code to get started') }}
          </div>

          <q-input
            v-model="nwcString"
            :placeholder="$t('Paste your wallet connection link here')"
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            input-class="q-px-md"
            borderless
            dense
            class="q-mb-md"
          />

          <div class="button-row">
            <q-btn
              class="connect-btn-inline"
              :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
              :loading="isConnecting"
              @click="connectWallet"
              no-caps
              unelevated
            >
              <span v-if="!isConnecting">{{ $t('Connect Wallet') }}</span>
              <template v-slot:loading>
                <q-spinner-dots class="q-mr-sm"/>
                {{ $t('Connecting...') }}
              </template>
            </q-btn>

            <q-btn
              unelevated
              class="scan-qr-btn-inline"
              :class="$q.dark.isActive ? 'btn_dark' : 'btn_light'"
              @click="openScanner"
              no-caps
            >
              <q-icon name="las la-qrcode" class="q-mr-sm"/>
              {{ $t('Scan QR') }}
            </q-btn>
          </div>
        </q-card-section>

      </q-card>

      <q-card
        class="connect-card"
        :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
        v-else
      >
        <q-card-section class="card-header">
          <div class="scanner-header">
            <q-btn
              flat
              round
              dense
              icon="las la-arrow-left"
              @click="closeScanner"
              class="back-btn"
              :class="$q.dark.isActive ? 'back-btn-dark' : 'back-btn-light'"
            />
            <div class="scanner-title-container">
              <div class="scanner-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
                {{ $t('Scan QR Code') }}
              </div>
              <div class="scanner-subtitle" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
                {{ $t('Point your camera at the QR code from your wallet app') }}
              </div>
            </div>
            <div class="header-spacer"></div>
          </div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div class="qr-scanner-container" :class="$q.dark.isActive ? 'scanner-dark' : 'scanner-light'">
            <video
              v-if="!cameraError"
              ref="videoElement"
              class="qr-video"
              style="width: 100%; height: 100%; object-fit: cover; border-radius: 16px;"
              playsinline
            />

            <!-- Camera Error State -->
            <div v-if="cameraError" class="camera-error">
              <q-icon name="las la-camera" size="3em" color="grey-5"/>
              <p class="error-text">{{ cameraErrorMessage }}</p>
              <q-btn
                unelevated
                :label="$t('Try Again')"
                @click="retryCamera"
                class="retry-btn"
                :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
                no-caps
              />
            </div>

            <!-- Loading State -->
            <div v-if="cameraLoading && !cameraError" class="camera-loading">
              <q-spinner-dots color="#15DE72" size="2em"/>
              <p class="loading-text">{{ $t('Starting camera...') }}</p>
            </div>

            <div v-if="isScanning" class="scan-overlay">
              <q-spinner-dots color="#15DE72" size="2em"/>
              <p class="scan-overlay-text">{{ $t('Scanning NWC QR code...') }}</p>
            </div>

            <!-- Scanning Frame -->
            <div v-if="!cameraError && !cameraLoading" class="scanning-frame">
              <div class="frame-corner top-left"></div>
              <div class="frame-corner top-right"></div>
              <div class="frame-corner bottom-left"></div>
              <div class="frame-corner bottom-right"></div>
            </div>
          </div>
        </q-card-section>

        <q-card-section class="card-footer">
          <q-btn
            unelevated
            class="full-width cancel-btn"
            :class="$q.dark.isActive ? 'more_btn_dark' : 'more_btn_light'"
            :label="$t('Cancel')"
            @click="closeScanner"
            no-caps
          />
        </q-card-section>
      </q-card>

      <!-- Add Wallet Name Dialog -->
      <q-dialog v-model="showNameDialog" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
        <q-card class="name-dialog" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
          <q-card-section class="dialog-header">
            <div class="dialog-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
              {{ $t('Name Your Wallet') }}
            </div>
            <q-btn
              flat
              round
              dense
              icon="close"
              v-close-popup
              class="close-btn"
              :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"
            />
          </q-card-section>

          <q-card-section class="dialog-content">
            <q-input
              v-model="walletName"
              :placeholder="$t('My Lightning Wallet')"
              :rules="[val => !!val || $t('Wallet name is required')]"
              autofocus
              :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
              borderless
              input-class="q-px-md"
              dense
              hide-bottom-space
            />
            <div class="input-hint" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ $t('Choose a name to easily identify this wallet') }}
            </div>
          </q-card-section>

          <q-card-actions align="right" class="dialog-actions">
            <q-btn
              flat
              :label="$t('Cancel')"
              v-close-popup
              class="cancel-action-btn"
              :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
            />
            <q-btn
              unelevated
              :label="$t('Continue')"
              @click="proceedWithConnection"
              :disable="!walletName"
              class="continue-action-btn"
              :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
              no-caps
            />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </div>
  </q-page>
</template>

<script>
import { NostrWebLNProvider } from "@getalby/sdk";
import QrScanner from 'qr-scanner'
import LoadingScreen from '../components/LoadingScreen.vue'
import {useWalletStore} from '../stores/wallet'
import {mapActions} from 'pinia'

// Error handling wrapper for async operations
const safeAsync = (fn) => {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (error) {
      console.error('Async operation failed:', error)
      throw error
    }
  }
}

export default {
  name: 'WalletConnectPage',
  components: {
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
      loadingText: 'Initializing BuhoGO...',
      cameraError: false,
      cameraErrorMessage: '',
      cameraLoading: true,
      qrScanner: null,
      videoElement: null
    }
  },
  mounted() {
    // Safety timeout: force-hide loading screen after 5s to prevent permanent black screen
    setTimeout(() => {
      this.showLoadingScreen = false;
    }, 5000);
    this.initializeApp();
  },
  beforeUnmount() {
    this.stopQrScanner();
  },
  methods: {
    ...mapActions(useWalletStore, ['addWallet']),

    goBack() {
      // Navigate back to welcome page
      if (window.history.length > 1) {
        this.$router.back();
      } else {
        this.$router.push('/');
      }
    },

    async initializeApp() {
      try {
        // Check for existing wallet state
        const existingState = localStorage.getItem('buhoGO_wallet_store');
        if (existingState) {
          this.loadingText = 'Checking wallet state...';

          try {
            const walletInfo = JSON.parse(existingState);
            if (walletInfo.activeWalletId && walletInfo.wallets?.length > 0) {
              this.loadingText = 'Loading wallet...';
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

    async openScanner() {
      this.showScanner = true;
      this.cameraError = false;
      this.cameraLoading = true;
      this.cameraErrorMessage = '';
      this.isScanning = false;
      
      // Wait for the next tick to ensure the video element is rendered
      await this.$nextTick();
      await this.startQrScanner();
    },

    closeScanner() {
      this.stopQrScanner();
      this.showScanner = false;
      this.cameraError = false;
      this.cameraLoading = true;
      this.cameraErrorMessage = '';
      this.isScanning = false;
    },

    async connectWallet() {
      if (!this.nwcString.trim()) return

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

        await this.addWallet({
          name: this.walletName,
          nwcUrl: this.nwcString
        })

        this.walletName = ''

        this.loadingText = 'Loading wallet interface...';
        await new Promise(resolve => setTimeout(resolve, 800));

        this.$router.push('/wallet')
      } catch (error) {
        console.error('Error connecting wallet:', error);
        if (this.$q && this.$q.notify) {
          this.$q.notify({
            type: 'negative',
            message: this.$t ? this.$t('Connection failed') : 'Connection failed',
            caption: this.$t ? this.$t('Please check your connection and try again') : 'Please check your connection and try again',
            
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
        }
      } finally {
        this.isConnecting = false;
        this.showLoadingScreen = false;
      }
    },

    async startQrScanner() {
      try {
        if (!this.$refs.videoElement) {
          throw new Error('Video element not found');
        }

        this.videoElement = this.$refs.videoElement;
        
        // Check if QrScanner has camera support
        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera) {
          throw new Error('No camera found on this device.');
        }

        // Create QR scanner instance
        this.qrScanner = new QrScanner(
          this.videoElement,
          (result) => this.handleNWCScan(result.data),
          {
            returnDetailedScanResult: false,
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: 'environment' // Use back camera if available
          }
        );

        // Start scanning
        await this.qrScanner.start();
        this.cameraLoading = false;
        this.cameraError = false;
        
      } catch (error) {
        console.error('Error starting QR scanner:', error);
        this.onCameraError(error);
      }
    },

    stopQrScanner() {
      if (this.qrScanner) {
        this.qrScanner.stop();
        this.qrScanner.destroy();
        this.qrScanner = null;
      }
    },

    async handleNWCScan(qrData) {
      this.isScanning = true;
      this.scanError = null;
      console.log('QR Code detected:', qrData);
      
      try {
        if (!qrData || typeof qrData !== 'string') {
          throw new Error(this.$t ? this.$t('No QR code detected') : 'No QR code detected');
        }

        // Check if it's an NWC URL
        if (!qrData.startsWith('nostr+walletconnect://')) {
          throw new Error(this.$t ? this.$t('Invalid NWC QR code format') : 'Invalid NWC QR code format');
        }

        const nwcUrl = qrData.trim();
        this.nwcString = nwcUrl;
        this.closeScanner();
        await this.connectWallet();

      } catch (error) {
        console.error('Error processing QR code:', error);
        this.scanError = error.message;
        if (this.$q && this.$q.notify) {
          this.$q.notify({
            type: 'negative',
            message: this.$t ? this.$t('Invalid QR code') : 'Invalid QR code',
            caption: this.$t ? this.$t('Please try a different code') : 'Please try a different code',
            
            actions: [{ icon: 'close', color: 'white', round: true, flat: true }]
          });
        }
      } finally {
        this.isScanning = false;
      }
    },

    onCameraError(error) {
      console.error('Camera error:', error);
      this.cameraError = true;
      this.cameraLoading = false;

      if (error.name === 'NotAllowedError') {
        this.cameraErrorMessage = this.$t ? this.$t('Camera access denied. Please allow camera permissions and try again.') : 'Camera access denied. Please allow camera permissions and try again.';
      } else if (error.name === 'NotFoundError') {
        this.cameraErrorMessage = this.$t ? this.$t('No camera found on this device.') : 'No camera found on this device.';
      } else if (error.name === 'NotSupportedError') {
        this.cameraErrorMessage = this.$t ? this.$t('Camera not supported on this device.') : 'Camera not supported on this device.';
      } else if (error.name === 'NotReadableError') {
        this.cameraErrorMessage = this.$t ? this.$t('Camera is already in use by another application.') : 'Camera is already in use by another application.';
      } else {
        this.cameraErrorMessage = this.$t ? this.$t('Unable to access camera. Please check your permissions.') : 'Unable to access camera. Please check your permissions.';
      }
    },

    onCameraReady() {
      this.cameraError = false;
      this.cameraLoading = false;
      this.cameraErrorMessage = '';
    },

    onCameraOff() {
      this.cameraLoading = true;
    },

    async retryCamera() {
      this.cameraError = false;
      this.cameraLoading = true;
      this.cameraErrorMessage = '';
      await this.startQrScanner();
    }
  }
}
</script>

<style scoped>
.wallet-connect-page {
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

.header-with-back {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.header-with-back .header-logo {
  margin-bottom: 0;
}

.header-with-back .header-spacer {
  width: 40px;
}

.back-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
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

/* Scanner Header */
.scanner-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  text-align: left;
}

.back_btn_dark {
  color: #FFF;
}

.back_btn_light {
  color: #6D6D6D;
}

.scanner-title-container {
  flex: 1;
}

.scanner-title {
  font-family: Fustat, 'Inter', sans-serif;
  margin-bottom: 0.5rem;
}

.scanner-subtitle {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  line-height: 1.4;
}

.header-spacer {
  width: 40px;
}

/* NWC Logo */
.nwc-logo-container {
  display: flex;
  justify-content: center;
  margin: 2rem 0 1.5rem;
}

.nwc-logo-bg {
  width: 100px;
  height: 100px;
  background: linear-gradient(135deg, #059573, #15DE72, #78D53C);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  box-shadow: 0 4px 16px rgba(21, 222, 114, 0.3);
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
  filter: brightness(1.1) contrast(1.1);
}

/* Typography */
.welcome-title {
  text-align: center;
  margin-bottom: 0.75rem;
}

.welcome-subtitle {
  text-align: center;
  margin-bottom: 2rem;
  max-width: 320px;
  margin-left: auto;
  margin-right: auto;
}

.view_title_dark {
  color: #B0B0B0;
}

/* Input Styling */
.nwc-input {
  margin-bottom: 1.5rem;
}

.nwc-input :deep(.q-field__control) {
  border-radius: 20px;
  padding: 0.75rem 1rem;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
}

.nwc-input :deep(.q-field__native) {
  font-family: Fustat, 'Inter', sans-serif;
}

/* Button Styling */
.button-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.connect-btn-inline {
  flex: 2;
  height: 52px;
  border-radius: 24px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 400;
}

.scan-qr-btn-inline {
  flex: 1;
  height: 52px;
  border-radius: 20px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
  min-width: 0;
}

/* QR Scanner */
.qr-scanner-container {
  height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  overflow: hidden;
  position: relative;
  border: 2px solid;
}

.camera-error,
.camera-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  text-align: center;
  padding: 2rem;
}

.error-text,
.loading-text {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  margin: 1rem 0;
  color: #666;
  line-height: 1.4;
}

.retry-btn {
  height: 40px;
  border-radius: 20px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
  padding: 0 1.5rem;
  margin-top: 0.5rem;
}

.scanner-dark {
  background: #171717;
  border-color: #2A342A;
}

.scanner-light {
  background: #F8F9FA;
  border-color: #E5E7EB;
}

.scan-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(12, 12, 12, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
  backdrop-filter: blur(4px);
}

.scan-overlay-text {
  color: white;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
  margin: 0.5rem 0 0;
}

/* Scanning Frame */
.scanning-frame {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 200px;
  height: 200px;
  pointer-events: none;
  z-index: 5;
}

.frame-corner {
  position: absolute;
  width: 30px;
  height: 30px;
  border: 3px solid #15DE72;
}

.frame-corner.top-left {
  top: 0;
  left: 0;
  border-right: none;
  border-bottom: none;
}

.frame-corner.top-right {
  top: 0;
  right: 0;
  border-left: none;
  border-bottom: none;
}

.frame-corner.bottom-left {
  bottom: 0;
  left: 0;
  border-right: none;
  border-top: none;
}

.frame-corner.bottom-right {
  bottom: 0;
  right: 0;
  border-left: none;
  border-top: none;
}

/* Footer */
.card-footer {
  padding: 1rem;
}

.cancel-btn {
  height: 48px;
  border-radius: 12px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* Dialog Styling */
.name-dialog {
  width: 100%;
  max-width: 400px;
  border-radius: 24px;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid;
}

.dialog-header {
  border-bottom-color: #2A342A;
}

.close-btn {
  width: 32px;
  height: 32px;
}

.dialog-content {
  padding: 1.5rem;
}

.wallet-name-input {
  margin-bottom: 1rem;
}

.wallet-name-input :deep(.q-field__control) {
  border-radius: 20px;
  padding: 0.75rem 1rem;
  font-family: Fustat, 'Inter', sans-serif;
}

.input-hint {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  text-align: center;
  margin-top: 0.5rem;
}

.dialog-actions {
  padding: 1rem 1.5rem 1.5rem;
  gap: 0.75rem;
}

.cancel-action-btn {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.continue-action-btn {
  height: 40px;
  border-radius: 24px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 400;
  padding: 0 1.5rem;
}

/* Responsive Design */
@media (max-width: 480px) {
  .wallet-connect-page {
    padding: 0.75rem;
  }

  .container {
    max-width: 100%;
  }

  .card-header {
    padding: 1.25rem 1rem 0.75rem;
  }

  .nwc-logo-bg {
    width: 80px;
    height: 80px;
    padding: 1.25rem;
  }

  .welcome-title {
    font-size: 20px;
    margin-bottom: 0.5rem;
  }

  .welcome-subtitle {
    font-size: 12px;
    margin-bottom: 1.5rem;
    max-width: 280px;
  }

  .button-row {
    gap: 0.5rem;
  }

  .connect-btn-inline,
  .scan-qr-btn-inline {
    height: 48px;
    font-size: 13px;
  }

  .qr-scanner-container {
    height: 250px;
  }

  .scanning-frame {
    width: 180px;
    height: 180px;
  }

  .frame-corner {
    width: 25px;
    height: 25px;
  }

  .scanner-header {
    align-items: center;
  }

  .scanner-title {
    font-size: 18px;
  }

  .scanner-subtitle {
    font-size: 11px;
  }

  .name-dialog {
    max-width: 350px;
    margin: 1rem;
  }

  .dialog-header,
  .dialog-content {
    padding: 1.25rem;
  }

  .dialog-actions {
    padding: 1rem 1.25rem 1.25rem;
  }

  .input-hint {
    font-size: 11px;
  }
}
</style>
