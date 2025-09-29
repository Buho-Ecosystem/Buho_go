<template>
  <q-dialog
    v-model="show"
    persistent
    :class="$q.dark.isActive ? 'dailog_dark' : 'dailog_light'"
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
          icon="las la-times"
          @click="closeModal"
          class="close-btn"
          :class="$q.dark.isActive ? 'text-white' : 'text-grey-6'"
        />
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
          </div>
          <div class="avatar-hint" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
            {{ $t('Tap to change color') }}
          </div>
        </div>

        <!-- Form Fields -->
        <div class="form-fields">
          <q-input
            v-model="formData.name"
            :placeholder="$t('Enter contact name')"
            :class="$q.dark.isActive ? 'add_wallet_textbox_dark' : 'add_wallet_textbox_light'"
            borderless
            dense
            input-class="q-px-md"
            :rules="[val => !!val || $t('Name is required')]"
            ref="nameInput"
            maxlength="50"
          >
            <template v-slot:prepend>
              <q-icon name="las la-user" class="q-ml-sm" />
            </template>
          </q-input>

          <q-input
            v-model="formData.lightningAddress"
            :placeholder="$t('user@domain.com')"
            :class="$q.dark.isActive ? 'add_wallet_textbox_dark' : 'add_wallet_textbox_light'"
            borderless
            dense
            input-class="q-px-md"
            :rules="[
              val => !!val || $t('Lightning address is required'),
              val => isValidLightningAddress(val) || $t('Invalid Lightning address format')
            ]"
            ref="addressInput"
            maxlength="100"
          >
            <template v-slot:prepend>
              <q-icon name="las la-at" class="q-ml-sm" />
            </template>
          </q-input>
        </div>
      </q-card-section>

      <!-- Actions -->
      <q-card-actions align="right" class="modal-actions">
        <q-btn
          flat
          :label="$t('Cancel')"
          @click="closeModal"
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
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
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
            <q-icon 
              v-if="formData.color === color"
              name="las la-check"
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
        lightningAddress: '',
        color: '#3B82F6'
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

    isFormValid() {
      return this.formData.name.trim() && 
             this.formData.lightningAddress.trim() && 
             this.isValidLightningAddress(this.formData.lightningAddress)
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
          lightningAddress: this.entry.lightningAddress,
          color: this.entry.color
        }
      } else {
        this.formData = {
          name: '',
          lightningAddress: '',
          color: this.getRandomColor()
        }
      }
    },

    resetForm() {
      this.formData = {
        name: '',
        lightningAddress: '',
        color: '#3B82F6'
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

    isValidLightningAddress(address) {
      if (!address) return false
      const lightningAddressRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
      return lightningAddressRegex.test(address.trim())
    },

    async saveEntry() {
      if (!this.isFormValid) return

      this.isSaving = true
      
      try {
        const entryData = {
          name: this.formData.name.trim(),
          lightningAddress: this.formData.lightningAddress.trim(),
          color: this.formData.color
        }

        if (this.isEditing) {
          await this.updateEntry(this.entry.id, entryData)
          this.$q.notify({
            type: 'positive',
            message: this.$t('Contact updated successfully!'),
            position: 'bottom',
            icon: 'las la-check'
          })
        } else {
          await this.addEntry(entryData)
          this.$q.notify({
            type: 'positive',
            message: this.$t('Contact added successfully!'),
            position: 'bottom',
            icon: 'las la-check'
          })
        }

        this.$emit('saved')
        this.closeModal()
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: error.message || this.$t('Failed to save contact'),
          position: 'bottom',
          icon: 'las la-exclamation-triangle'
        })
      } finally {
        this.isSaving = false
      }
    },

    closeModal() {
      this.show = false
    }
  }
}
</script>

<style scoped>
.address-modal {
  width: 100%;
  max-width: 480px;
  border-radius: 24px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid;
}

.modal-header {
  border-bottom-color: #2A342A;
}

.modal-title {
  font-family: Fustat, 'Inter', sans-serif;
}

.close-btn {
  width: 32px;
  height: 32px;
}

.modal-content {
  padding: 1.5rem;
}

.avatar-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 2rem;
}

.preview-circle {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  margin-bottom: 0.75rem;
}

.preview-circle:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
}

.preview-initial {
  color: white;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 32px;
  font-weight: 700;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.avatar-hint {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 12px;
  text-align: center;
}

.view_title_dark {
  color: #B0B0B0;
}

.form-fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-fields .q-field {
  margin-bottom: 1rem;
}

.form-fields .q-field:last-child {
  margin-bottom: 0;
}

.modal-actions {
  padding: 1rem 1.5rem 1.5rem;
  gap: 0.75rem;
}

.cancel-btn {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 500;
}

.save-btn {
  height: 40px;
  border-radius: 24px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 400;
  padding: 0 1.5rem;
}

/* Color Picker */
.color-picker-card {
  width: 100%;
  max-width: 320px;
  border-radius: 16px;
}

.color-picker-title {
  font-family: Fustat, 'Inter', sans-serif;
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
    border-radius: 16px;
  }

  .modal-header,
  .modal-content {
    padding: 1.25rem;
  }

  .modal-actions {
    padding: 1rem 1.25rem 1.25rem;
  }

  .preview-circle {
    width: 64px;
    height: 64px;
  }

  .preview-initial {
    font-size: 24px;
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