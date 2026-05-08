<template>
  <q-dialog
    v-model="show"
    persistent
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card
      class="address-modal"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Header -->
      <q-card-section class="modal-header">
        <div class="modal-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
          {{ isEditing ? $t('Edit Contact') : $t('Add Contact') }}
        </div>
        <q-btn
          flat
          round
          dense
          @click="closeModal"
          class="close-btn"
          :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"
        >
          <Icon icon="tabler:x" width="20" height="20" />
        </q-btn>
      </q-card-section>

      <!-- Content -->
      <q-card-section class="modal-content">
        <!-- Avatar Preview -->
        <div class="avatar-preview">
          <div
            class="preview-circle"
            :style="{ backgroundColor: formData.color }"
            @click="showColorPicker = true"
          >
            <span class="preview-initial">{{ getPreviewInitial() }}</span>
            <div class="preview-edit-dot">
              <Icon icon="tabler:palette" width="12" height="12" />
            </div>
          </div>
        </div>

        <!-- Form Fields -->
        <div class="form-fields">
          <div class="input-wrapper">
            <div class="input-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ $t('Name') }}
            </div>
            <input
              v-model="formData.name"
              type="text"
              :placeholder="$t('Enter contact name')"
              class="form-input"
              :class="$q.dark.isActive ? 'form-input-dark' : 'form-input-light'"
              ref="nameInput"
              maxlength="50"
            />
          </div>

          <!-- Unified payment address (auto-detects Lightning / Spark / Bitcoin) -->
          <div class="input-wrapper">
            <div class="input-label-row">
              <div class="input-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
                {{ $t('Payment address') }}
              </div>
              <transition name="type-pill">
                <div
                  v-if="detectedType"
                  class="detected-pill"
                  :class="`detected-pill--${detectedType}`"
                >
                  <img
                    v-if="detectedType === 'spark'"
                    width="11" height="11"
                    :src="$q.dark.isActive ? '/Spark/Spark Asterisk White.svg' : '/Spark/Spark Asterisk Black.svg'"
                    alt="Spark"
                  />
                  <Icon v-else :icon="detectedIcon" width="12" height="12" />
                  <span>{{ detectedLabel }}</span>
                </div>
              </transition>
            </div>
            <input
              v-model="formData.address"
              type="text"
              :placeholder="$t('Paste the address from your friend or shop')"
              class="form-input"
              :class="[
                $q.dark.isActive ? 'form-input-dark' : 'form-input-light',
                addressShowsError ? 'form-input--error' : ''
              ]"
              ref="addressInput"
              maxlength="150"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
            />
            <div class="input-helper" :class="$q.dark.isActive ? 'helper-dark' : 'helper-light'">
              <template v-if="addressShowsError">
                <Icon icon="tabler:alert-circle" width="13" height="13" />
                <span>{{ $t("We don't recognize this as a Lightning, Spark, or Bitcoin address") }}</span>
              </template>
              <template v-else>
                <span>{{ $t('Works with a Lightning address, Spark address, or Bitcoin address') }}</span>
              </template>
            </div>
          </div>

          <!-- Notes Field -->
          <div class="input-wrapper">
            <div class="input-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
              {{ $t('Notes') }} <span class="optional-hint">({{ $t('optional') }})</span>
            </div>
            <textarea
              v-model="formData.notes"
              :placeholder="$t('e.g., Monthly rent, Coffee shop...')"
              class="form-input notes-textarea"
              :class="$q.dark.isActive ? 'form-input-dark' : 'form-input-light'"
              maxlength="200"
              rows="2"
            />
          </div>
        </div>
      </q-card-section>

      <!-- Actions -->
      <q-card-actions align="right" class="modal-actions">
        <q-btn
          flat
          :label="$t('Cancel')"
          @click="closeModal"
          no-caps
          class="cancel-btn"
          :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-6'"
        />
        <q-btn
          unelevated
          :label="isEditing ? $t('Update') : $t('Add')"
          @click="saveEntry"
          :loading="isSaving"
          :disable="!isFormValid"
          class="save-btn"
          no-caps
        />
      </q-card-actions>
    </q-card>

    <!-- Color Picker Dialog -->
    <q-dialog v-model="showColorPicker">
      <q-card class="color-picker-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <q-card-section>
          <div class="color-picker-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
            {{ $t('Choose Color') }}
          </div>
        </q-card-section>

        <q-card-section class="color-grid">
          <div
            v-for="color in colorPalette"
            :key="color"
            class="color-option"
            :class="{ 'selected': formData.color === color }"
            :style="{ backgroundColor: color }"
            @click="selectColor(color)"
          >
            <Icon
              v-if="formData.color === color"
              icon="tabler:check"
              class="color-check"
            />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-dialog>
</template>

<script>
import { useAddressBookStore } from '../../stores/addressBook'
import { mapState, mapActions } from 'pinia'
import {
  isSparkAddress,
  isBitcoinAddress,
  isLightningAddress,
} from '../../utils/addressUtils'

// Order matters: Spark addresses are checked before Bitcoin because some
// Spark prefixes share a base58-ish look and we want them claimed first.
function detectType(address) {
  if (!address || typeof address !== 'string') return null
  const v = address.trim()
  if (!v) return null
  if (isSparkAddress(v)) return 'spark'
  if (isBitcoinAddress(v)) return 'bitcoin'
  if (isLightningAddress(v)) return 'lightning'
  return null
}

export default {
  name: 'AddressBookModal',
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    entry: {
      type: Object,
      default: null
    }
  },
  emits: ['update:modelValue', 'saved'],
  data() {
    return {
      formData: {
        name: '',
        address: '',
        color: '#3B82F6',
        notes: ''
      },
      isSaving: false,
      showColorPicker: false
    }
  },
  computed: {
    ...mapState(useAddressBookStore, ['colorPalette']),

    show: {
      get() {
        return this.modelValue
      },
      set(value) {
        this.$emit('update:modelValue', value)
      }
    },

    isEditing() {
      return !!this.entry
    },

    detectedType() {
      return detectType(this.formData.address)
    },

    detectedLabel() {
      const labels = {
        lightning: this.$t('Lightning'),
        spark: this.$t('Spark'),
        bitcoin: this.$t('Bitcoin')
      }
      return labels[this.detectedType] || ''
    },

    detectedIcon() {
      const icons = {
        lightning: 'tabler:bolt',
        bitcoin: 'tabler:currency-bitcoin'
      }
      return icons[this.detectedType] || ''
    },

    addressShowsError() {
      return this.formData.address.trim().length > 0 && !this.detectedType
    },

    isFormValid() {
      return this.formData.name.trim() && !!this.detectedType
    }
  },
  watch: {
    show(newVal) {
      if (newVal) {
        this.initializeForm()
        this.$nextTick(() => {
          this.$refs.nameInput?.focus()
        })
      } else {
        this.resetForm()
      }
    }
  },
  methods: {
    ...mapActions(useAddressBookStore, ['addEntry', 'updateEntry', 'getRandomColor']),

    initializeForm() {
      if (this.entry) {
        this.formData = {
          name: this.entry.name,
          address: this.entry.address || this.entry.lightningAddress || '',
          color: this.entry.color,
          notes: this.entry.notes || ''
        }
      } else {
        this.formData = {
          name: '',
          address: '',
          color: this.getRandomColor(),
          notes: ''
        }
      }
    },

    resetForm() {
      this.formData = {
        name: '',
        address: '',
        color: '#3B82F6',
        notes: ''
      }
      this.isSaving = false
      this.showColorPicker = false
    },

    getPreviewInitial() {
      return this.formData.name ? this.formData.name.charAt(0).toUpperCase() : '?'
    },

    selectColor(color) {
      this.formData.color = color
      this.showColorPicker = false
    },

    async saveEntry() {
      if (!this.isFormValid) return

      this.isSaving = true

      try {
        const entryData = {
          name: this.formData.name.trim(),
          address: this.formData.address.trim(),
          addressType: this.detectedType,
          color: this.formData.color,
          notes: this.formData.notes?.trim() || ''
        }

        if (this.isEditing) {
          await this.updateEntry(this.entry.id, entryData)
          this.$q.notify({
            type: 'positive',
            message: this.$t('Contact saved'),
          })
        } else {
          await this.addEntry(entryData)
          this.$q.notify({
            type: 'positive',
            message: this.$t('Contact added'),
          })
        }

        this.$emit('saved')
        this.closeModal()
      } catch (error) {
        const errorMessage = this.getErrorMessage(error)
        this.$q.notify({
          type: 'negative',
          message: errorMessage.title,
          caption: errorMessage.caption,
          timeout: 4000,
        })
      } finally {
        this.isSaving = false
      }
    },

    closeModal() {
      this.show = false
    },

    getErrorMessage(error) {
      const msg = error.message || ''

      if (msg.includes('already exists')) {
        return {
          title: this.$t('Contact already exists'),
          caption: this.$t('This address is already saved in your address book')
        }
      }

      if (msg.includes('Invalid')) {
        return {
          title: this.$t('Address not recognized'),
          caption: this.$t('Please check the address and try again')
        }
      }

      return {
        title: this.$t("Couldn't save contact"),
        caption: msg || this.$t('Please try again')
      }
    }
  }
}
</script>

<style scoped>
.address-modal {
  width: 100%;
  max-width: 460px;
  border-radius: var(--radius-xl);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-card);
}

.modal-title {
  font-family: 'Manrope', sans-serif;
  font-size: 20px;
  font-weight: 700;
}

.close-btn {
  width: 32px;
  height: 32px;
}

.modal-content {
  padding: 1.25rem 1.5rem 0.5rem;
}

/* Avatar */
.avatar-preview {
  display: flex;
  justify-content: center;
  margin-bottom: 1.25rem;
}

.preview-circle {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.preview-circle:hover {
  transform: scale(1.04);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22);
}

.preview-initial {
  color: white;
  font-family: 'Manrope', sans-serif;
  font-size: 26px;
  font-weight: 700;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

/* Tiny palette badge replaces the "Tap to change color" caption — same
   affordance, less visual chrome. */
.preview-edit-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--bg-card, #fff);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
  border: 1px solid var(--border-card);
}

.body--light .preview-edit-dot {
  background: #fff;
  color: #374151;
}

/* Form */
.view_title_dark { color: var(--text-secondary); }
.view_title { color: var(--text-muted); }

.form-fields {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.input-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 20px;
}

.input-label {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  text-align: left;
}

/* Detected-type pill: the auto-detection feedback that replaces the
   three-way Lightning/Spark/Bitcoin toggle. */
.detected-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  line-height: 1;
}

.detected-pill--lightning {
  background: rgba(5, 149, 115, 0.12);
  color: #059573;
  box-shadow: inset 0 0 0 1px rgba(5, 149, 115, 0.22);
}

.body--dark .detected-pill--lightning,
.q-dark .detected-pill--lightning {
  background: rgba(21, 222, 114, 0.16);
  color: #15DE72;
  box-shadow: inset 0 0 0 1px rgba(21, 222, 114, 0.28);
}

.detected-pill--spark {
  background: rgba(120, 120, 120, 0.12);
  color: var(--text-primary);
  box-shadow: inset 0 0 0 1px rgba(120, 120, 120, 0.25);
}

.detected-pill--bitcoin {
  background: rgba(247, 147, 26, 0.14);
  color: #C97A0F;
  box-shadow: inset 0 0 0 1px rgba(247, 147, 26, 0.28);
}

.body--dark .detected-pill--bitcoin,
.q-dark .detected-pill--bitcoin {
  color: #F7931A;
  box-shadow: inset 0 0 0 1px rgba(247, 147, 26, 0.36);
}

.type-pill-enter-active,
.type-pill-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.type-pill-enter-from,
.type-pill-leave-to {
  opacity: 0;
  transform: translateY(-2px) scale(0.96);
}

/* Input helper line lives under the address field — it carries the
   "what's accepted" hint and the soft validation message. */
.input-helper {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  line-height: 1.3;
  padding-left: 2px;
  min-height: 16px;
}

.helper-dark { color: var(--text-muted); }
.helper-light { color: #6B7280; }

.input-helper :deep(svg),
.input-helper svg {
  flex-shrink: 0;
  color: #EF4444;
}

/* Inputs */
.form-input {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.form-input-dark {
  background: var(--bg-input);
  color: var(--text-primary);
}

.form-input-light {
  background: var(--bg-input);
  color: var(--text-primary);
}

.form-input:focus {
  border-color: var(--color-green);
}

.body--light .form-input:focus {
  border-color: var(--text-primary);
}

.form-input--error,
.form-input--error:focus {
  border-color: rgba(239, 68, 68, 0.55);
}

.form-input::placeholder {
  color: var(--text-muted);
}

.notes-textarea {
  resize: none;
  min-height: 60px;
  line-height: 1.4;
}

.optional-hint {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.6;
}

.modal-actions {
  padding: 1rem 1.5rem 1.5rem;
  gap: 0.75rem;
}

.cancel-btn {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.save-btn {
  height: 40px;
  border-radius: var(--radius-xl);
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
  padding: 0 1.5rem;
  background: var(--gradient-green);
  color: #FFF;
}

.body--light .save-btn {
  background: var(--btn-neutral-bg);
  color: var(--btn-neutral-fg);
}

.save-btn:disabled {
  opacity: 0.4;
}

/* Color Picker */
.color-picker-card {
  width: 100%;
  max-width: 320px;
  border-radius: var(--radius-md);
}

.color-picker-title {
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  text-align: center;
}

.color-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  padding: 1rem;
}

.color-option {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.color-option:hover {
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.color-option.selected {
  transform: scale(1.1);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.3);
}

.color-check {
  color: white;
  font-size: 20px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

/* Responsive Design */
@media (max-width: 480px) {
  .address-modal {
    max-width: 100%;
    margin: 1rem;
    border-radius: var(--radius-md);
  }

  .modal-header {
    padding: 1rem 1.25rem;
  }

  .modal-content {
    padding: 1rem 1.25rem 0.25rem;
  }

  .modal-actions {
    padding: 0.75rem 1.25rem 1.25rem;
  }

  .color-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 0.75rem;
  }

  .color-option {
    width: 40px;
    height: 40px;
  }
}
</style>
