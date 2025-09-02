<template>
  <q-dialog
    v-model="show"
    persistent
    maximized
    transition-show="slide-up"
    transition-hide="slide-down"
    class="send-modal"
  >
    <q-card class="send-card" :class="$q.dark.isActive ? 'send-card-dark' : 'send-card-light'">
      <!-- Header -->
      <q-card-section class="send-header">
        <div class="header-content">
          <q-btn
            flat
            round
            dense
            @click="closeModal"
            class="back-btn"
            :class="$q.dark.isActive ? 'back_btn_dark' : 'back_btn_light'"
          >
            <svg v-if="$q.dark.isActive" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"
                 fill="none">
              <path
                d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z"
                fill="white"/>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M8.83191 10.5936C8.75381 10.5162 8.69181 10.424 8.6495 10.3224C8.6072 10.2209 8.58542 10.112 8.58542 10.002C8.58542 9.89195 8.6072 9.78303 8.6495 9.68148C8.69181 9.57993 8.75381 9.48777 8.83191 9.4103L12.6569 5.59363C12.735 5.51616 12.797 5.42399 12.8393 5.32244C12.8816 5.22089 12.9034 5.11197 12.9034 5.00196C12.9034 4.89195 12.8816 4.78303 12.8393 4.68148C12.797 4.57993 12.735 4.48776 12.6569 4.4103C12.5008 4.25509 12.2896 4.16797 12.0694 4.16797C11.8493 4.16797 11.638 4.25509 11.4819 4.4103L7.65691 8.2353C7.18875 8.70405 6.92578 9.33946 6.92578 10.002C6.92578 10.6645 7.18875 11.2999 7.65691 11.7686L11.4819 15.5936C11.6371 15.7476 11.8466 15.8344 12.0652 15.8353C12.1749 15.8359 12.2836 15.8149 12.3852 15.7734C12.4867 15.732 12.579 15.6709 12.6569 15.5936C12.735 15.5162 12.797 15.424 12.8393 15.3224C12.8816 15.2209 12.9034 15.112 12.9034 15.002C12.9034 14.892 12.8816 14.783 12.8393 14.6815C12.797 14.5799 12.735 14.4878 12.6569 14.4103L8.83191 10.5936Z"
                fill="#6D6D6D"/>
            </svg>
          </q-btn>
          <div class="header-title" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
            {{ $t('Send') }}
          </div>
          <div class="header-spacer"></div>
        </div>
      </q-card-section>

      <!-- Camera View -->
      <div class="camera-container">
        <qrcode-stream
          v-if="showCamera && !isProcessing"
          @detect="onQRDetect"
          @error="onCameraError"
          class="camera-view"
          :constraints="cameraConstraints"
        />

        <!-- Processing Overlay -->
        <div v-if="isProcessing" class="processing-overlay">
          <q-spinner-dots color="#15DE72" size="3rem"/>
          <div class="processing-text">{{ $t('Processing payment...') }}</div>
        </div>

        <!-- Camera Error -->
        <div v-if="cameraError" class="camera-error">
          <q-icon name="las la-camera-retro" size="4rem" color="grey-4"/>
          <div class="error-title">{{ $t('Camera Access Required') }}</div>
          <div class="error-subtitle">{{ cameraError }}</div>
          <q-btn
            class="retry-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="$t('Retry')"
            @click="initializeCamera"
            no-caps
          />
        </div>

        <!-- Scanning Frame -->
        <div v-if="showCamera && !isProcessing" class="scanning-frame">
          <div class="frame-corner top-left"></div>
          <div class="frame-corner top-right"></div>
          <div class="frame-corner bottom-left"></div>
          <div class="frame-corner bottom-right"></div>
        </div>
      </div>

      <!-- Bottom Actions -->
      <q-card-section class="send-actions">
        <div class="action-buttons">
          <q-btn
            flat
            class="action-btn"
            :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
            @click="showManualInput"
          >
            <div class="btn-content">
              <q-icon name="las la-keyboard" size="24px" class="btn-icon"/>
              <span class="btn-label">{{ $t('Manual') }}</span>
            </div>
          </q-btn>

          <q-btn
            flat
            class="action-btn"
            :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
            @click="pasteFromClipboard"
          >
            <div class="btn-content">
              <q-icon name="las la-clipboard" size="24px" class="btn-icon"/>
              <span class="btn-label">{{ $t('Paste') }}</span>
            </div>
          </q-btn>

          <q-btn
            flat
            class="action-btn"
            :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
            @click="importFromFile"
          >
            <div class="btn-content">
              <q-icon name="las la-image" size="24px" class="btn-icon"/>
              <span class="btn-label">{{ $t('Import') }}</span>
            </div>
          </q-btn>
        </div>
      </q-card-section>
    </q-card>

    <!-- Manual Input Dialog -->
    <q-dialog v-model="showManualDialog" class="manual-dialog">
      <q-card class="manual-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section class="manual-header">
          <div class="manual-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Enter Payment Details') }}
          </div>
          <q-btn flat round dense icon="las la-times" v-close-popup
                 class="close-btn" :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"/>
        </q-card-section>

        <q-card-section class="manual-content">
          <q-input
            v-model="manualInput"
            outlined
            :label="$t('Lightning Invoice, Address, or LNURL')"
            :placeholder="$t('lnbc... or user@domain.com or lnurl...')"
            class="manual-input"
            autofocus
            :rules="[validatePaymentInput]"
          />

          <div class="input-help">
            <div class="help-item">
              <q-icon name="las la-bolt" class="help-icon"/>
              <span>{{ $t('Lightning Invoice (lnbc...)') }}</span>
            </div>
            <div class="help-item">
              <q-icon name="las la-at" class="help-icon"/>
              <span>{{ $t('Lightning Address (user@domain.com)') }}</span>
            </div>
            <div class="help-item">
              <q-icon name="las la-link" class="help-icon"/>
              <span>{{ $t('LNURL (lnurl...)') }}</span>
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right" class="manual-actions">
          <q-btn flat :label="$t('Cancel')" v-close-popup/>
          <q-btn
            flat
            :label="$t('Continue')"
            color="primary"
            @click="processManualInput"
            :disable="!isValidManualInput"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-dialog>
</template>

<script>
import {QrcodeStream} from 'vue-qrcode-reader';
import QrScanner from 'qr-scanner';
// Assuming you have this service
// import LightningPaymentService from '../utils/lightning.js';

export default {
  name: 'SendModal',
  components: {
    QrcodeStream
  },
  props: {
    modelValue: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue', 'payment-detected'],
  data() {
    return {
      showCamera: false,
      isProcessing: false,
      cameraError: null,
      showManualDialog: false,
      manualInput: '',
      cameraConstraints: {
        facingMode: 'environment',
        width: {ideal: 1280},
        height: {ideal: 720}
      }
    }
  },
  computed: {
    show: {
      get() {
        return this.modelValue;
      },
      set(value) {
        this.$emit('update:modelValue', value);
      }
    },
    isValidManualInput() {
      return this.manualInput.trim().length > 0 && this.validatePaymentInput(this.manualInput) === true;
    }
  },
  watch: {
    show(newVal) {
      if (newVal) {
        this.initializeCamera();
      } else {
        this.showCamera = false;
        this.resetState();
      }
    }
  },
  methods: {
    async initializeCamera() {
      this.cameraError = null;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({video: true});
        stream.getTracks().forEach(track => track.stop());

        this.showCamera = true;
      } catch (error) {
        console.error('Camera initialization error:', error);
        this.handleCameraError(error);
      }
    },

    handleCameraError(error) {
      if (error.name === 'NotAllowedError') {
        this.cameraError = this.$t('Camera permission denied. Please allow camera access and try again.');
      } else if (error.name === 'NotFoundError') {
        this.cameraError = this.$t('No camera found on this device.');
      } else if (error.name === 'NotSupportedError') {
        this.cameraError = this.$t('Camera not supported in this browser.');
      } else {
        this.cameraError = this.$t('Failed to access camera. Please try again.');
      }
    },

    async onQRDetect(detectedCodes) {
      if (this.isProcessing || !detectedCodes.length) return;

      const qrContent = detectedCodes[0].rawValue;
      this.isProcessing = true;

      try {
        await this.processPaymentData(qrContent);
      } catch (error) {
        console.error('QR processing error:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Invalid QR code: ') + error.message,
          position: 'bottom'
        });
        this.isProcessing = false;
      }
    },

    onCameraError(error) {
      console.error('Camera error:', error);
      this.handleCameraError(error);
    },

    async processPaymentData(paymentData) {
      try {
        // Basic validation
        if (!paymentData || paymentData.trim().length === 0) {
          throw new Error(this.$t('Invalid payment data'));
        }

        const trimmedData = paymentData.trim();
        // Handle lightning: prefix and extract the actual invoice
        const cleanData = trimmedData.toLowerCase().startsWith('lightning:') 
          ? trimmedData.substring(10) 
          : trimmedData;

        // Emit the detected payment data to parent component
        this.$emit('payment-detected', {
          data: cleanData,
          type: this.determinePaymentType(cleanData)
        });

        this.closeModal();

      } catch (error) {
        throw error;
      }
    },

    determinePaymentType(data) {
      const trimmed = data.trim().toLowerCase();
      // Handle lightning: prefix
      const cleanData = trimmed.startsWith('lightning:') ? trimmed.substring(10) : trimmed;
      
      // Handle both invoice types for LNBC format
      if (cleanData.startsWith('lnbc')) return 'lightning_invoice';
      if (cleanData.includes('@') && cleanData.includes('.')) return 'lightning_address';
      if (cleanData.startsWith('lnurl')) return 'lnurl';
      return 'unknown';
    },

    validatePaymentInput(input) {
      if (!input || input.trim().length === 0) {
        return this.$t('Please enter a payment request');
      }

      const trimmed = input.trim().toLowerCase();
      const isValid = trimmed.startsWith('lnbc') ||
        (trimmed.includes('@') && trimmed.includes('.')) ||
        trimmed.startsWith('lnurl');

      return isValid ? true : this.$t('Invalid payment format');
    },

    showManualInput() {
      // hide currrent show
      this.showManualDialog = true;
      this.manualInput = '';
    },

    async pasteFromClipboard() {
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText.trim()) {
          await this.processPaymentData(clipboardText.trim());
        } else {
          this.$q.notify({
            type: 'info',
            message: this.$t('Clipboard is empty'),
            position: 'bottom'
          });
        }
      } catch (error) {
        console.error('Clipboard error:', error);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to read clipboard'),
          position: 'bottom'
        });
      }
    },

    async importFromFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (event) => {
        const file = event.target.files[0];
        if (file) {
          this.isProcessing = true;
          try {
            // Show loading notification
            this.$q.notify({
              type: 'info',
              message: this.$t('Reading QR code from image...'),
              position: 'bottom',
              timeout: 2000
            });

            // Decode QR code from image file
            const qrResult = await QrScanner.scanImage(file, {
              returnDetailedScanResult: true,
              highlightScanRegion: false,
              highlightCodeOutline: false
            });

            if (qrResult && qrResult.data) {
              console.log(qrResult.data);
              // Process the decoded QR data using existing logic
              await this.processPaymentData(qrResult.data);
            } else {
              throw new Error(this.$t('No QR code found in image'));
            }

          } catch (error) {
            console.error('QR decode error:', error);
            let errorMessage = this.$t('Failed to read QR code from image');
            
            if (error.message.includes('No QR code found')) {
              errorMessage = this.$t('No QR code detected in the selected image');
            } else if (error.message.includes('Invalid')) {
              errorMessage = this.$t('Invalid QR code format in image');
            }

            this.$q.notify({
              type: 'negative',
              message: errorMessage,
              position: 'bottom'
            });
            this.isProcessing = false;
          }
        }
      };
      input.click();
    },

    async processManualInput() {
      if (!this.isValidManualInput) return;

      this.showManualDialog = false;
      this.isProcessing = true;

      try {
        await this.processPaymentData(this.manualInput.trim());
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: error.message,
          position: 'bottom'
        });
        this.isProcessing = false;
      }
    },

    closeModal() {
      this.show = false;
    },

    resetState() {
      this.isProcessing = false;
      this.cameraError = null;
      this.manualInput = '';
      this.showManualDialog = false;
    }
  }
}
</script>

<style scoped>
.send-modal :deep(.q-dialog__inner) {
  padding: 0;
}

.send-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.send-card-dark {
  background: #0C0C0C;
  color: #FFF;
}

.send-card-light {
  background: #FFF;
  color: #212121;
}

/* Header */
.send-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding: 1rem;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.back-btn {
  color: inherit;
}

.header-title {
  flex: 1;
  text-align: center;
}

.header-spacer {
  width: 40px;
}

/* Camera Container */
.camera-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #000;
}

.camera-view {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.processing-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 5;
}

.processing-text {
  color: white;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 18px;
  font-weight: 500;
  margin-top: 1rem;
}

.camera-error {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #1f2937;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  text-align: center;
}

.error-title {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 20px;
  font-weight: 600;
  color: white;
  margin: 1rem 0 0.5rem;
}

.error-subtitle {
  color: #9ca3af;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  margin-bottom: 1.5rem;
  line-height: 1.5;
}

.retry-btn {
  border-radius: 24px;
}

/* Scanning Frame */
.scanning-frame {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 250px;
  height: 250px;
  pointer-events: none;
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

/* Bottom Actions */
.send-actions {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: 1rem;
  flex-shrink: 0;
}

.action-buttons {
  display: flex;
  justify-content: space-around;
  gap: 1rem;
}

.action-btn {
  flex: 1;
  height: 80px;
  border-radius: 16px;
  transition: all 0.2s ease;
}

.action-btn-dark {
  background: rgba(42, 52, 42, 0.5);
  color: white;
}

.action-btn-light {
  background: rgba(0, 0, 0, 0.05);
  color: #212121;
}

.action-btn-dark:hover {
  background: rgba(42, 52, 42, 0.8);
  transform: translateY(-2px);
}

.action-btn-light:hover {
  background: rgba(0, 0, 0, 0.1);
  transform: translateY(-2px);
}

.btn-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.btn-icon {
  color: #15DE72;
}

.btn-label {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

/* Manual Input Dialog */
.manual-dialog :deep(.q-dialog__inner) {
  padding: 1rem;
}

.manual-card {
  width: 100%;
  max-width: 500px;
  border-radius: 24px;
}

.manual-header {
  border-bottom: 1px solid;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.manual-title {
  font-family: Fustat, 'Inter', sans-serif;
}

.close-btn {
  color: #6b7280;
}

.manual-content {
  padding: 1.5rem;
}

.manual-input {
  margin-bottom: 1.5rem;
}

.manual-input :deep(.q-field__control) {
  border-radius: 12px;
}

.input-help {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.help-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: #6b7280;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
}

.help-icon {
  color: #15DE72;
  font-size: 16px;
  width: 16px;
}

.manual-actions {
  border-top: 1px solid;
}

/* Responsive Design */
@media (max-width: 480px) {
  .scanning-frame {
    width: 200px;
    height: 200px;
  }

  .action-buttons {
    gap: 0.5rem;
  }

  .action-btn {
    height: 70px;
  }

  .btn-label {
    font-size: 12px;
  }

  .manual-content {
    padding: 1rem;
  }
}
</style>
