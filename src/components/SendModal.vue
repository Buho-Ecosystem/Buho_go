<template>
  <q-dialog 
    v-model="show" 
    persistent 
    maximized 
    transition-show="slide-up" 
    transition-hide="slide-down"
    class="send-modal"
  >
    <q-card class="send-card">
      <!-- Header -->
      <q-card-section class="send-header">
        <div class="header-content">
          <q-btn 
            flat 
            round 
            dense 
            icon="las la-arrow-left" 
            @click="closeModal"
            class="back-btn"
          />
          <div class="header-title">Send</div>
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
          <q-spinner-dots color="white" size="3rem"/>
          <div class="processing-text">Processing payment...</div>
        </div>

        <!-- Camera Error -->
        <div v-if="cameraError" class="camera-error">
          <q-icon name="las la-camera-retro" size="4rem" color="grey-4"/>
          <div class="error-title">Camera Access Required</div>
          <div class="error-subtitle">{{ cameraError }}</div>
          <q-btn
            outline
            color="primary"
            label="Retry"
            @click="initializeCamera"
            class="retry-btn"
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
            @click="showManualInput"
          >
            <div class="btn-content">
              <q-icon name="las la-keyboard" size="24px" class="btn-icon"/>
              <span class="btn-label">Manual</span>
            </div>
          </q-btn>

          <q-btn
            flat
            class="action-btn"
            @click="pasteFromClipboard"
          >
            <div class="btn-content">
              <q-icon name="las la-clipboard" size="24px" class="btn-icon"/>
              <span class="btn-label">Paste</span>
            </div>
          </q-btn>

          <q-btn
            flat
            class="action-btn"
            @click="importFromFile"
          >
            <div class="btn-content">
              <q-icon name="las la-image" size="24px" class="btn-icon"/>
              <span class="btn-label">Import</span>
            </div>
          </q-btn>
        </div>
      </q-card-section>
    </q-card>

    <!-- Manual Input Dialog -->
    <q-dialog v-model="showManualDialog" class="manual-dialog">
      <q-card class="manual-card">
        <q-card-section class="manual-header">
          <div class="manual-title">Enter Payment Details</div>
          <q-btn flat round dense icon="las la-times" v-close-popup class="close-btn"/>
        </q-card-section>

        <q-card-section class="manual-content">
          <q-input
            v-model="manualInput"
            outlined
            label="Lightning Invoice, Address, or LNURL"
            placeholder="lnbc... or user@domain.com or lnurl..."
            class="manual-input"
            autofocus
            :rules="[validatePaymentInput]"
          />
          
          <div class="input-help">
            <div class="help-item">
              <q-icon name="las la-bolt" class="help-icon"/>
              <span>Lightning Invoice (lnbc...)</span>
            </div>
            <div class="help-item">
              <q-icon name="las la-at" class="help-icon"/>
              <span>Lightning Address (user@domain.com)</span>
            </div>
            <div class="help-item">
              <q-icon name="las la-link" class="help-icon"/>
              <span>LNURL (lnurl...)</span>
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right" class="manual-actions">
          <q-btn flat label="Cancel" v-close-popup/>
          <q-btn 
            flat 
            label="Continue" 
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
import { QrcodeStream } from 'vue-qrcode-reader';
import LightningPaymentService from '../utils/lightning.js';

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
        width: { ideal: 1280 },
        height: { ideal: 720 }
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
        // Check if camera permission is available
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop()); // Stop the test stream
        
        this.showCamera = true;
      } catch (error) {
        console.error('Camera initialization error:', error);
        this.handleCameraError(error);
      }
    },

    handleCameraError(error) {
      if (error.name === 'NotAllowedError') {
        this.cameraError = 'Camera permission denied. Please allow camera access and try again.';
      } else if (error.name === 'NotFoundError') {
        this.cameraError = 'No camera found on this device.';
      } else if (error.name === 'NotSupportedError') {
        this.cameraError = 'Camera not supported in this browser.';
      } else {
        this.cameraError = 'Failed to access camera. Please try again.';
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
          message: 'Invalid QR code: ' + error.message,
          position: 'top'
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
        const validation = LightningPaymentService.validatePaymentInput(paymentData);
        
        if (!validation.valid) {
          throw new Error(validation.error);
        }

        // Emit the detected payment data to parent component
        this.$emit('payment-detected', {
          data: paymentData,
          type: validation.type
        });

        this.closeModal();

      } catch (error) {
        throw error;
      }
    },

    showManualInput() {
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
            message: 'Clipboard is empty',
            position: 'top'
          });
        }
      } catch (error) {
        console.error('Clipboard error:', error);
        this.$q.notify({
          type: 'negative',
          message: 'Failed to read clipboard',
          position: 'top'
        });
      }
    },

    importFromFile() {
      // Create file input for QR code image import
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (event) => {
        const file = event.target.files[0];
        if (file) {
          try {
            // This would require a QR code reader library for images
            this.$q.notify({
              type: 'info',
              message: 'QR code import from images coming soon!',
              position: 'top'
            });
          } catch (error) {
            this.$q.notify({
              type: 'negative',
              message: 'Failed to read QR code from image',
              position: 'top'
            });
          }
        }
      };
      input.click();
    },

    validatePaymentInput(input) {
      if (!input || input.trim().length === 0) {
        return 'Please enter a payment request';
      }

      const validation = LightningPaymentService.validatePaymentInput(input.trim());
      return validation.valid ? true : validation.error;
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
          position: 'top'
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
  background: #000000;
  color: white;
}

/* Header */
.send-header {
  background: rgba(0, 0, 0, 0.8);
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
  color: white;
}

.header-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: white;
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
  font-size: 1.125rem;
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
  font-size: 1.25rem;
  font-weight: 600;
  color: white;
  margin: 1rem 0 0.5rem;
}

.error-subtitle {
  color: #9ca3af;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
  line-height: 1.5;
}

.retry-btn {
  border-color: #059573;
  color: #059573;
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
  border: 3px solid #059573;
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
  background: rgba(0, 0, 0, 0.9);
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
  background: rgba(255, 255, 255, 0.1);
  color: white;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: translateY(-2px);
}

.btn-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.btn-icon {
  color: #9ca3af;
}

.btn-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: white;
}

/* Manual Input Dialog */
.manual-dialog :deep(.q-dialog__inner) {
  padding: 1rem;
}

.manual-card {
  width: 100%;
  max-width: 500px;
  border-radius: 16px;
}

.manual-header {
  background: #f8f9fa;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.manual-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
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
  font-size: 0.875rem;
}

.help-icon {
  color: #059573;
  font-size: 16px;
  width: 16px;
}

.manual-actions {
  background: #f8f9fa;
  border-top: 1px solid #e5e7eb;
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
    font-size: 0.75rem;
  }
  
  .manual-content {
    padding: 1rem;
  }
}
</style>