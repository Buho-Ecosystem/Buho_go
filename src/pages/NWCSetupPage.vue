<template>
  <!-- Loading Screen -->
  <LoadingScreen
    :show="showLoadingScreen"
    :loading-text="loadingText"
  />

  <q-page class="nwc-setup-page flex flex-center" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <div class="container">

      <q-card
        class="setup-card"
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
              <!-- NWC Logo -->
              <svg width="50" height="50" viewBox="0 0 257 256" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M110.938 31.0639C100.704 20.8691 84.0846 20.9782 73.8873 31.2091L7.91341 97.4141C-2.28517 107.646 -2.15541 123.974 8.07554 134.17L116.246 242.34C126.479 252.534 143.066 252.449 153.263 242.218L185.415 210.066C176.038 219.443 168.322 212.701 159.178 203.595L141.244 185.662C127.63 191.051 111.718 188.374 100.688 177.365L87.0221 163.699C86.5623 163.243 86.2075 162.767 85.9582 162.17C85.7089 161.572 85.5803 160.931 85.5797 160.284C85.5792 159.637 85.7067 158.995 85.955 158.398C86.2033 157.8 86.5923 157.293 87.0513 156.837L94.7848 149.103L77.9497 132.268C75.3144 129.638 74.8841 125.391 77.2407 122.522C79.9345 119.228 84.8188 119.053 87.7741 122.002L104.837 139.051L116.394 127.494L99.5187 110.661C96.8822 108.03 96.4531 103.784 98.8298 100.895C99.4602 100.128 100.244 99.5006 101.131 99.0542C102.019 98.6077 102.989 98.3518 103.981 98.3028C104.973 98.2538 105.964 98.4129 106.891 98.7697C107.818 99.1266 108.66 99.6733 109.363 100.375L126.495 117.393L133.755 110.132C134.211 109.673 134.66 109.259 135.258 109.01C135.855 108.761 136.496 108.632 137.144 108.632C137.791 108.631 138.432 108.758 139.03 109.006C139.628 109.254 140.171 109.618 140.628 110.077L154.316 123.738C165.208 134.609 168.056 150.431 162.964 163.943L180.901 181.88C190.045 190.985 197.696 197.785 207.074 188.408L247.645 147.836C237.893 157.588 229.881 150.075 220.244 140.446L110.938 31.0639Z" fill="url(#nwc_setup_grad)"/>
                <path d="M187.641 13.0273L153.153 47.4873L229.781 124.116C237.116 131.419 243.491 137.239 250.565 134.417C254.654 132.787 257.461 128.351 255.894 124.238C219.227 28.0253 219.212 28.0238 214.348 17.507C209.484 6.99014 195.804 4.76016 187.641 13.0273Z" fill="#897FFF"/>
                <defs>
                  <linearGradient id="nwc_setup_grad" x1="123.989" y1="10.4384" x2="123.989" y2="249.939" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#FFCA4A"/>
                    <stop offset="1" stop-color="#F7931A"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>

          <div class="welcome-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
            {{ $t('Connect NWC Wallet') }}
          </div>

          <div class="welcome-subtitle" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Link your existing Lightning wallet via Nostr Wallet Connect') }}
          </div>

          <!-- Wallet Name Input -->
          <div class="input-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Wallet Name') }}
          </div>
          <q-input
            v-model="walletName"
            :placeholder="$t('e.g. My Lightning Wallet')"
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            input-class="q-px-md"
            borderless
            dense
            class="q-mb-md"
          />

          <!-- NWC Connection String Input -->
          <div class="input-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('NWC Connection String') }}
          </div>
          <q-input
            v-model="nwcString"
            :placeholder="$t('nostr+walletconnect://...')"
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            input-class="q-px-md"
            borderless
            dense
            type="textarea"
            autogrow
            class="q-mb-sm nwc-textarea"
          />

          <!-- Error Message -->
          <div v-if="errorMessage" class="error-message q-mb-md">
            {{ errorMessage }}
          </div>

          <div class="button-row">
            <q-btn
              class="connect-btn-inline"
              :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
              :loading="isConnecting"
              @click="validateAndConnect"
              :disable="!walletName || !nwcString"
              no-caps
              unelevated
            >
              <span v-if="!isConnecting">{{ $t('Connect') }}</span>
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
              {{ $t('Scan') }}
            </q-btn>
          </div>

          <div class="help-text q-mt-md" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Get your NWC string from your Lightning wallet\'s settings') }}
          </div>
        </q-card-section>

      </q-card>

      <!-- QR Scanner Card -->
      <q-card
        class="setup-card"
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
                {{ $t('Scan your NWC connection QR code') }}
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
              <q-spinner-dots color="#F7931A" size="2em"/>
              <p class="loading-text">{{ $t('Starting camera...') }}</p>
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

    </div>
  </q-page>
</template>

<script>
import QrScanner from 'qr-scanner'
import LoadingScreen from '../components/LoadingScreen.vue'
import { useWalletStore } from '../stores/wallet'
import { mapActions } from 'pinia'

export default {
  name: 'NWCSetupPage',
  components: {
    LoadingScreen,
  },
  data() {
    return {
      walletName: '',
      nwcString: '',
      isConnecting: false,
      errorMessage: '',
      showScanner: false,
      cameraError: false,
      cameraErrorMessage: '',
      cameraLoading: true,
      qrScanner: null,
      showLoadingScreen: false,
      loadingText: '',
    }
  },
  beforeUnmount() {
    this.stopQrScanner();
  },
  methods: {
    ...mapActions(useWalletStore, ['addWallet']),

    goBack() {
      if (window.history.length > 1) {
        this.$router.back();
      } else {
        this.$router.push('/');
      }
    },

    validateNwcString(nwcString) {
      if (!nwcString || !nwcString.trim()) {
        return this.$t('NWC string is required');
      }

      const trimmed = nwcString.trim();

      if (!trimmed.startsWith('nostr+walletconnect://')) {
        return this.$t('Must start with nostr+walletconnect://');
      }

      try {
        const url = new URL(trimmed.replace('nostr+walletconnect://', 'https://'));
        const relay = url.searchParams.get('relay');
        const secret = url.searchParams.get('secret');

        if (!relay) {
          return this.$t('Missing relay parameter');
        }
        if (!secret) {
          return this.$t('Missing secret parameter');
        }
      } catch {
        return this.$t('Invalid connection string format');
      }

      return true;
    },

    async validateAndConnect() {
      if (!this.walletName.trim()) {
        this.errorMessage = this.$t('Wallet name is required');
        return;
      }

      const validation = this.validateNwcString(this.nwcString);
      if (validation !== true) {
        this.errorMessage = validation;
        return;
      }

      this.isConnecting = true;
      this.errorMessage = '';

      try {
        this.showLoadingScreen = true;
        this.loadingText = this.$t('Connecting to wallet...');

        await this.addWallet({
          name: this.walletName.trim(),
          nwcUrl: this.nwcString.trim()
        });

        this.loadingText = this.$t('Loading wallet...');
        await new Promise(resolve => setTimeout(resolve, 500));

        this.$router.push('/wallet');
      } catch (error) {
        console.error('Failed to connect NWC wallet:', error);
        this.showLoadingScreen = false;
        this.errorMessage = error.message || this.$t('Connection failed');
      } finally {
        this.isConnecting = false;
      }
    },

    async openScanner() {
      this.showScanner = true;
      this.cameraError = false;
      this.cameraLoading = true;
      this.cameraErrorMessage = '';

      await this.$nextTick();
      await this.startQrScanner();
    },

    closeScanner() {
      this.stopQrScanner();
      this.showScanner = false;
      this.cameraError = false;
      this.cameraLoading = true;
      this.cameraErrorMessage = '';
    },

    async startQrScanner() {
      try {
        if (!this.$refs.videoElement) {
          throw new Error('Video element not found');
        }

        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera) {
          throw new Error('No camera found on this device.');
        }

        this.qrScanner = new QrScanner(
          this.$refs.videoElement,
          (result) => this.handleQrScan(result.data),
          {
            returnDetailedScanResult: false,
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: 'environment'
          }
        );

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

    handleQrScan(qrData) {
      if (!qrData) return;

      const data = qrData.trim();

      // Check if it's a valid NWC string
      if (data.startsWith('nostr+walletconnect://')) {
        this.nwcString = data;
        this.closeScanner();
        this.$q.notify({
          type: 'positive',
          message: this.$t('NWC connection string scanned'),
          
          timeout: 1500,
        });
        return;
      }

      this.$q.notify({
        type: 'warning',
        message: this.$t('Invalid QR code'),
        caption: this.$t('Expected a NWC connection string'),
        
      });
    },

    onCameraError(error) {
      this.cameraError = true;
      this.cameraLoading = false;

      if (error.name === 'NotAllowedError') {
        this.cameraErrorMessage = this.$t('Camera access denied. Please allow camera permissions.');
      } else if (error.name === 'NotFoundError') {
        this.cameraErrorMessage = this.$t('No camera found on this device.');
      } else {
        this.cameraErrorMessage = this.$t('Unable to access camera.');
      }
    },

    async retryCamera() {
      this.cameraError = false;
      this.cameraLoading = true;
      this.cameraErrorMessage = '';
      await this.startQrScanner();
    },
  }
}
</script>

<style scoped>
.nwc-setup-page {
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
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
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
  background: linear-gradient(135deg, #1a1a2e, #2d2d44);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(247, 147, 26, 0.3);
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
  background: linear-gradient(135deg, rgba(247, 147, 26, 0.1), transparent);
  border-radius: 50%;
}

.nwc-logo-bg svg {
  z-index: 1;
}

/* Typography */
.welcome-title {
  text-align: center;
  margin-bottom: 0.75rem;
  font-size: 22px;
  font-weight: 700;
  font-family: Fustat, 'Inter', sans-serif;
}

.welcome-subtitle {
  text-align: center;
  margin-bottom: 1.5rem;
  font-size: 14px;
  font-family: Fustat, 'Inter', sans-serif;
}

.view_title_dark {
  color: #B0B0B0;
}

/* Input Labels */
.input-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 0.5rem;
  padding-left: 0.25rem;
}

/* NWC Textarea */
.nwc-textarea :deep(textarea) {
  min-height: 60px;
  max-height: 120px;
  font-size: 13px;
  line-height: 1.4;
}

/* Error Message */
.error-message {
  color: #FF4B4B;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  text-align: center;
  padding: 0.5rem;
  background: rgba(255, 75, 75, 0.1);
  border-radius: 8px;
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

/* Help Text */
.help-text {
  text-align: center;
  font-size: 12px;
  font-family: Fustat, 'Inter', sans-serif;
}

/* Scanner Styles */
.scanner-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  text-align: left;
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

.scanner-dark {
  background: #171717;
  border-color: #2A342A;
}

.scanner-light {
  background: #F8F9FA;
  border-color: #E5E7EB;
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
  border: 3px solid #F7931A;
}

.frame-corner.top-left { top: 0; left: 0; border-right: none; border-bottom: none; }
.frame-corner.top-right { top: 0; right: 0; border-left: none; border-bottom: none; }
.frame-corner.bottom-left { bottom: 0; left: 0; border-right: none; border-top: none; }
.frame-corner.bottom-right { bottom: 0; right: 0; border-left: none; border-top: none; }

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

/* Responsive Design */
@media (max-width: 480px) {
  .nwc-setup-page {
    padding: 0.75rem;
  }

  .container {
    max-width: 100%;
  }

  .nwc-logo-bg {
    width: 80px;
    height: 80px;
  }

  .nwc-logo-bg svg {
    width: 42px;
    height: 42px;
  }

  .welcome-title {
    font-size: 20px;
  }

  .welcome-subtitle {
    font-size: 13px;
    margin-bottom: 1.25rem;
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
}
</style>
