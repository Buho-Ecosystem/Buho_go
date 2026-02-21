<template>
  <!-- Loading Screen -->
  <LoadingScreen
    :show="showLoadingScreen"
    :loading-text="loadingText"
  />

  <q-page class="lnbits-setup-page flex flex-center" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
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
          <div class="lnbits-logo-container">
            <div class="lnbits-logo-bg">
              <!-- LNBits Lightning Bolt (official) -->
              <svg xmlns="http://www.w3.org/2000/svg" width="50" height="60" viewBox="0 0 502 902" fill="none">
                <path d="M158.566 493.857L1 901L450.49 355.202H264.831L501.791 1H187.881L36.4218 493.857H158.566Z" fill="#FF1FE1"/>
              </svg>
            </div>
          </div>

          <div class="welcome-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
            {{ $t('Connect LNBits') }}
          </div>

          <div class="welcome-subtitle" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Enter your LNBits server details') }}
          </div>

          <!-- Server URL Input -->
          <div class="input-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Server URL') }}
          </div>
          <q-input
            v-model="serverUrl"
            :placeholder="$t('https://your.lnbits.server')"
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            input-class="q-px-md"
            borderless
            dense
            class="q-mb-md"
          />

          <!-- Wallet ID Input -->
          <div class="input-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Wallet ID') }}
          </div>
          <q-input
            v-model="walletId"
            :placeholder="$t('e.g. 7459bdd6e60346bcade5db10fcba648b')"
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            input-class="q-px-md"
            borderless
            dense
            class="q-mb-md"
          />

          <!-- Admin Key Input -->
          <div class="input-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Admin Key') }}
          </div>
          <q-input
            v-model="adminKey"
            :placeholder="$t('Paste your admin key here')"
            :class="$q.dark.isActive ? 'search_bg' : 'search_light'"
            input-class="q-px-md"
            borderless
            dense
            class="q-mb-md"
            :type="showAdminKey ? 'text' : 'password'"
          >
            <template v-slot:append>
              <q-btn
                flat
                round
                dense
                :icon="showAdminKey ? 'las la-eye-slash' : 'las la-eye'"
                @click="showAdminKey = !showAdminKey"
                :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
              />
            </template>
          </q-input>

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
              :disable="!serverUrl || !walletId || !adminKey"
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
            {{ $t('Find wallet ID and admin key in LNBits under API Info') }}
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
                {{ scanMode === 'url' ? $t('Scan your LNBits server URL') : $t('Scan your admin key') }}
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

      <!-- Wallet Name Dialog -->
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
            <!-- Wallet Info Preview -->
            <div class="wallet-preview q-mb-md" :class="$q.dark.isActive ? 'preview-dark' : 'preview-light'">
              <div class="preview-row">
                <span class="preview-label">{{ $t('Server') }}</span>
                <span class="preview-value">{{ displayServerUrl }}</span>
              </div>
              <div class="preview-row">
                <span class="preview-label">{{ $t('Wallet ID') }}</span>
                <span class="preview-value preview-id">{{ validatedWalletId }}</span>
              </div>
              <div class="preview-row">
                <span class="preview-label">{{ $t('Balance') }}</span>
                <span class="preview-value">{{ validatedBalance }} sats</span>
              </div>
            </div>

            <q-input
              v-model="walletName"
              :placeholder="validatedWalletName || $t('My LNBits Wallet')"
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
              :label="$t('Add Wallet')"
              @click="addWallet"
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
import QrScanner from 'qr-scanner'
import LoadingScreen from '../components/LoadingScreen.vue'
import { useWalletStore } from '../stores/wallet'
import { LNBitsWalletProvider } from '../providers/LNBitsWalletProvider'
import { mapActions } from 'pinia'

export default {
  name: 'LNBitsSetupPage',
  components: {
    LoadingScreen,
  },
  data() {
    return {
      serverUrl: '',
      walletId: '',
      adminKey: '',
      showAdminKey: false,
      isConnecting: false,
      errorMessage: '',
      showScanner: false,
      scanMode: 'url', // 'url', 'walletId', or 'key'
      cameraError: false,
      cameraErrorMessage: '',
      cameraLoading: true,
      qrScanner: null,
      showNameDialog: false,
      walletName: '',
      showLoadingScreen: false,
      loadingText: '',
      // Validated data from server
      validatedServerUrl: '',
      validatedWalletId: '',
      validatedWalletName: '',
      validatedBalance: 0,
    }
  },
  computed: {
    displayServerUrl() {
      try {
        const url = new URL(this.validatedServerUrl);
        return url.hostname;
      } catch {
        return this.validatedServerUrl;
      }
    }
  },
  beforeUnmount() {
    this.stopQrScanner();
  },
  methods: {
    ...mapActions(useWalletStore, ['addLNBitsWallet']),

    goBack() {
      if (window.history.length > 1) {
        this.$router.back();
      } else {
        this.$router.push('/');
      }
    },

    async validateAndConnect() {
      if (!this.serverUrl.trim() || !this.walletId.trim() || !this.adminKey.trim()) {
        this.errorMessage = this.$t('Please fill in all fields');
        return;
      }

      this.isConnecting = true;
      this.errorMessage = '';

      try {
        // Validate credentials
        const validation = await LNBitsWalletProvider.validateCredentials(
          this.serverUrl.trim(),
          this.walletId.trim(),
          this.adminKey.trim()
        );

        // Store validated data
        this.validatedServerUrl = validation.serverUrl;
        this.validatedWalletId = validation.walletInfo.id;
        this.validatedWalletName = validation.walletInfo.name;
        this.validatedBalance = validation.walletInfo.balance;
        this.walletName = validation.walletInfo.name;

        // Show name dialog
        this.showNameDialog = true;

      } catch (error) {
        console.error('LNBits validation failed:', error);
        this.errorMessage = error.message || this.$t('Connection failed');
      } finally {
        this.isConnecting = false;
      }
    },

    async addWallet() {
      if (!this.walletName.trim()) return;

      this.showNameDialog = false;
      this.showLoadingScreen = true;
      this.loadingText = this.$t('Adding wallet...');

      try {
        await this.addLNBitsWallet({
          name: this.walletName.trim(),
          serverUrl: this.validatedServerUrl,
          walletId: this.validatedWalletId,
          adminKey: this.adminKey.trim(),
        });

        this.loadingText = this.$t('Loading wallet...');
        await new Promise(resolve => setTimeout(resolve, 500));

        this.$router.push('/wallet');
      } catch (error) {
        console.error('Failed to add LNBits wallet:', error);
        this.showLoadingScreen = false;
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to add wallet'),
          caption: error.message,
          
        });
      }
    },

    async openScanner() {
      this.showScanner = true;
      this.scanMode = !this.serverUrl ? 'url' : 'key';
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

      // Check if it's a URL (could contain wallet params)
      if (data.startsWith('http://') || data.startsWith('https://')) {
        try {
          const url = new URL(data);
          // Check for LNBits wallet URL format: /wallet?usr=...&wal=...
          const walParam = url.searchParams.get('wal');
          if (walParam) {
            // Extract server URL without query params
            this.serverUrl = `${url.protocol}//${url.host}`;
            this.walletId = walParam;
            this.closeScanner();
            this.$q.notify({
              type: 'positive',
              message: this.$t('Server URL and Wallet ID extracted'),
              caption: this.$t('Please enter your admin key'),
              
              timeout: 2000,
            });
            return;
          }
        } catch {
          // Not a valid URL with params, use as-is
        }

        this.serverUrl = data;
        this.closeScanner();
        this.$q.notify({
          type: 'positive',
          message: this.$t('Server URL scanned'),
          
          timeout: 1500,
        });
        return;
      }

      // Check if it looks like a wallet ID (32 char hex)
      if (data.length === 32 && /^[a-f0-9]+$/i.test(data) && !this.walletId) {
        this.walletId = data;
        this.closeScanner();
        this.$q.notify({
          type: 'positive',
          message: this.$t('Wallet ID scanned'),
          
          timeout: 1500,
        });
        return;
      }

      // Otherwise treat as admin key (32+ chars)
      if (data.length >= 32) {
        this.adminKey = data;
        this.closeScanner();
        this.$q.notify({
          type: 'positive',
          message: this.$t('Admin key scanned'),
          
          timeout: 1500,
        });
        return;
      }

      this.$q.notify({
        type: 'warning',
        message: this.$t('Unrecognized QR code'),
        caption: this.$t('Expected a URL, wallet ID, or admin key'),
        
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
.lnbits-setup-page {
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

/* LNBits Logo */
.lnbits-logo-container {
  display: flex;
  justify-content: center;
  margin: 2rem 0 1.5rem;
}

.lnbits-logo-bg {
  width: 100px;
  height: 100px;
  background: linear-gradient(135deg, #1a1a2e, #2d2d44);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(255, 31, 225, 0.3);
  position: relative;
  overflow: hidden;
}

.lnbits-logo-bg::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255, 31, 225, 0.1), transparent);
  border-radius: 50%;
}

.lnbits-logo-bg svg {
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
  border: 3px solid #FF1FE1;
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
  border-bottom-color: #2A342A;
}

.close-btn {
  width: 32px;
  height: 32px;
}

.dialog-content {
  padding: 1.5rem;
}

/* Wallet Preview */
.wallet-preview {
  padding: 1rem;
  border-radius: 12px;
}

.preview-dark {
  background: #1A1A1A;
}

.preview-light {
  background: #F5F5F5;
}

.preview-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0;
}

.preview-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  color: #888;
}

.preview-value {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

.preview-id {
  font-family: monospace;
  font-size: 11px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
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
  .lnbits-setup-page {
    padding: 0.75rem;
  }

  .container {
    max-width: 100%;
  }

  .lnbits-logo-bg {
    width: 80px;
    height: 80px;
  }

  .lnbits-logo-bg svg {
    width: 42px;
    height: 50px;
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

  .name-dialog {
    max-width: 350px;
    margin: 1rem;
  }
}
</style>
