<template>
  <q-dialog
    v-model="show"
    persistent
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @hide="onHide"
  >
    <q-card
      class="address-modal"
      :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'"
    >
      <!-- Header -->
      <q-card-section class="modal-header">
        <div class="modal-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
          {{ isEditing ? $t('Edit contact') : $t('Add contact') }}
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

      <!-- Segmented control (add-mode only). Keeps the existing edit
           flow uncluttered — there is nothing to "search" for when
           you're correcting a name. Order: Scan / Search / Enter, but
           we default to Search so opening the sheet never prompts for
           camera permission. -->
      <q-card-section v-if="!isEditing" class="modal-tabs">
        <div class="seg-control" role="tablist" :aria-label="$t('Add contact method')">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            role="tab"
            class="seg-tab"
            :class="{ 'seg-tab--active': activeTab === tab.id }"
            :aria-selected="activeTab === tab.id"
            @click="switchTab(tab.id)"
          >
            <Icon :icon="tab.icon" width="14" height="14" />
            <span>{{ $t(tab.label) }}</span>
          </button>
        </div>
      </q-card-section>

      <!-- Content router -->
      <q-card-section class="modal-content">
        <!-- SCAN -->
        <AddContactScan
          v-if="!isEditing && activeTab === 'scan'"
          :active="show && activeTab === 'scan'"
          @saved="onChildSaved"
          @open-existing="onOpenExisting"
          @switch-to-search="switchTab('search')"
          @detected-address="onScanDetectedAddress"
        />

        <!-- SEARCH -->
        <AddContactSearch
          v-else-if="!isEditing && activeTab === 'search'"
          ref="searchRef"
          @saved="onChildSaved"
          @open-existing="onOpenExisting"
        />

        <!-- MANUAL — also used for the edit flow -->
        <template v-else>
          <!-- Static preview: the app-wide filled-bust silhouette.
               Contacts no longer carry a color; a Nostr picture (via
               the Search / Scan tabs) is the only way an avatar
               personalizes. -->
          <div class="avatar-preview">
            <div class="preview-circle">
              <svg class="preview-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 12.3a4.05 4.05 0 1 0 0-8.1 4.05 4.05 0 0 0 0 8.1Zm0 2.2c-4.3 0-7.6 2.6-8.1 6.3h16.2c-.5-3.7-3.8-6.3-8.1-6.3Z" />
              </svg>
            </div>
          </div>

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

            <div class="input-wrapper">
              <div class="input-label-row">
                <div class="input-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
                  {{ $t('Payment address') }}
                </div>
                <transition name="type-pill">
                  <div
                    v-if="detectedType"
                    class="detected-pill"
                    :class="`detected-pill--${detectedDisplayType}`"
                  >
                    <img
                      v-if="detectedDisplayType === 'spark'"
                      width="11" height="11"
                      :src="$q.dark.isActive ? '/Spark/Spark Asterisk White.svg' : '/Spark/Spark Asterisk Black.svg'"
                      alt="Spark"
                    />
                    <ArkadeLogo v-else-if="detectedDisplayType === 'arkade'" variant="mark" :size="12" />
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
                  <span v-if="addressIsSparkRequest">{{ $t('This is a one-time payment request, not a lasting address. Pay it and save the contact from the payment screen instead.') }}</span>
                  <span v-else>{{ $t("We don't recognize this as a Lightning, Spark, Bitcoin, or LNURL address") }}</span>
                </template>
                <template v-else>
                  <span>{{ $t('Works with a Lightning, Spark, or Bitcoin address, or an LNURL link') }}</span>
                </template>
              </div>
            </div>

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
        </template>
      </q-card-section>

      <!-- Footer — only the manual / edit path needs a global Save
           button. Search and Scan tabs ship their own save UI inside
           the preview card. -->
      <q-card-actions
        v-if="showManualFooter"
        align="right"
        class="modal-actions"
      >
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

  </q-dialog>
</template>

<script>
import { useAddressBookStore } from '../../stores/addressBook'
import { mapState, mapActions } from 'pinia'
import {
  isSparkAddress,
  isBitcoinAddress,
  isLightningAddress,
  isLnurl,
  isArkadeAddress,
} from '../../utils/addressUtils.js'
import { isSparkPaymentRequest } from '../../utils/sparkPayment.js'
import AddContactSearch from './AddContactSearch.vue'
import AddContactScan from './AddContactScan.vue'
import ArkadeLogo from '../ArkadeLogo.vue'

// Order matters: Spark addresses are checked before Bitcoin because some
// Spark prefixes share a base58-ish look and we want them claimed first.
function detectType(address) {
  if (!address || typeof address !== 'string') return null
  const v = address.trim()
  if (!v) return null
  // A Spark invoice shares the spark1… prefix but is single-use — it must
  // never become a contact. The helper text below names it specifically.
  if (isSparkAddress(v)) return isSparkPaymentRequest(v) ? null : 'spark'
  if (isArkadeAddress(v)) return 'arkade'
  if (isBitcoinAddress(v)) return 'bitcoin'
  // LNURL static pay links — recognized as their own type for routing, but
  // surfaced as Lightning in the pill below (see detectedType/Label/Icon).
  if (isLnurl(v)) return 'lnurl'
  if (isLightningAddress(v)) return 'lightning'
  return null
}

const TABS = [
  // Enter is the default entry: typing a Lightning/Spark/Bitcoin
  // address works for everyone without assuming Nostr fluency, and it
  // never prompts for camera permission on open. Scan is one tap away
  // for in-person sharing; Search covers the Nostr-aware path of
  // pasting an npub or profile link.
  { id: 'manual', label: 'Enter',  icon: 'tabler:keyboard' },
  { id: 'scan',   label: 'Scan',   icon: 'tabler:qrcode' },
  { id: 'search', label: 'Search', icon: 'tabler:search' },
]

export default {
  name: 'AddressBookModal',
  components: { AddContactSearch, AddContactScan, ArkadeLogo },
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    entry: {
      type: Object,
      default: null
    },
    /**
     * Which add-mode tab to land on when the sheet opens. Defaults to
     * 'manual' (see the tab-order comment above) — callers that want a
     * more specific entry point, e.g. the Identity page's header scan
     * button jumping straight to the camera, pass 'scan' or 'search'.
     * Ignored while editing (there is no tab bar in edit mode).
     */
    initialTab: {
      type: String,
      default: 'manual'
    }
  },
  emits: ['update:modelValue', 'saved', 'open-existing'],
  data() {
    return {
      activeTab: 'manual',
      tabs: TABS,
      formData: {
        name: '',
        address: '',
        notes: ''
      },
      isSaving: false,
    }
  },
  computed: {

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

    /**
     * The global Save/Cancel footer only makes sense for the
     * legacy manual form — Search/Scan ship their own save UI
     * inside the preview card so the user's eye doesn't leave
     * the profile they're confirming.
     */
    showManualFooter() {
      return this.isEditing || this.activeTab === 'manual'
    },

    detectedType() {
      return detectType(this.formData.address)
    },

    /**
     * Visual type for the pill. LNURL is stored as its own `addressType`
     * (so the send flow routes it through LNURL resolution) but folds into
     * the Lightning badge here, since to the user it is just another way to
     * pay over Lightning.
     */
    detectedDisplayType() {
      return this.detectedType === 'lnurl' ? 'lightning' : this.detectedType
    },

    detectedLabel() {
      const labels = {
        lightning: this.$t('Lightning'),
        spark: this.$t('Spark'),
        arkade: this.$t('Arkade'),
        bitcoin: this.$t('Bitcoin')
      }
      return labels[this.detectedDisplayType] || ''
    },

    detectedIcon() {
      const icons = {
        lightning: 'tabler:bolt',
        bitcoin: 'tabler:currency-bitcoin'
      }
      return icons[this.detectedDisplayType] || ''
    },

    addressShowsError() {
      return this.formData.address.trim().length > 0 && !this.detectedType
    },
    addressIsSparkRequest() {
      const v = this.formData.address.trim()
      return v.length > 0 && isSparkPaymentRequest(v)
    },

    isFormValid() {
      return this.formData.name.trim() && !!this.detectedType
    }
  },
  watch: {
    show(newVal) {
      if (newVal) {
        this.initializeForm()
        // Add mode lands on `initialTab` (defaults to the manual "Enter"
        // form, which works for everyone without assuming Nostr fluency).
        // Editing always lands on manual regardless of `initialTab` since
        // there is no tab bar in that mode. Resetting here keeps the next
        // open from being biased by where the previous one finished.
        this.activeTab = this.isEditing ? 'manual' : this.initialTab
        this.$nextTick(() => {
          this.$refs.nameInput?.focus()
        })
      } else {
        this.resetForm()
      }
    }
  },
  methods: {
    ...mapActions(useAddressBookStore, ['addEntry', 'updateEntry']),

    switchTab(id) {
      if (this.activeTab === id) return
      this.activeTab = id
      this.$nextTick(() => {
        if (id === 'manual') this.$refs.nameInput?.focus()
        else if (id === 'search') this.$refs.searchRef?.focus?.()
      })
    },

    initializeForm() {
      if (this.entry) {
        this.formData = {
          name: this.entry.name,
          address: this.entry.address || this.entry.lightningAddress || '',
          notes: this.entry.notes || ''
        }
      } else {
        this.formData = {
          name: '',
          address: '',
          notes: ''
        }
      }
    },

    resetForm() {
      this.formData = {
        name: '',
        address: '',
        notes: ''
      }
      this.isSaving = false
      this.activeTab = 'manual'
    },


    /**
     * Child save callback — fires after AddContactSearch or
     * AddContactScan have persisted a Nostr contact. Bubbles up so
     * the list refreshes and the sheet dismisses with the same
     * `saved` semantics the manual flow uses.
     */
    onChildSaved() {
      this.$emit('saved')
      this.closeModal()
    },

    /**
     * The child preview signals an "already saved" affordance.
     * Forward upward so the page can open the contact detail or
     * scroll to its row, then close this sheet to get out of the way.
     */
    onOpenExisting(entry) {
      this.$emit('open-existing', entry)
      this.closeModal()
    },

    /**
     * The Scan tab found a payment address (Lightning / Spark / Bitcoin /
     * LNURL) rather than a Nostr profile. Pre-fill the manual form and
     * switch to it so the detected-type pill lights up and the user just
     * adds a name + optional note before saving via the normal addEntry path.
     */
    onScanDetectedAddress(address) {
      this.formData.address = address
      this.switchTab('manual')
    },

    async saveEntry() {
      if (!this.isFormValid) return

      this.isSaving = true

      try {
        const entryData = {
          name: this.formData.name.trim(),
          address: this.formData.address.trim(),
          addressType: this.detectedType,
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

    onHide() {
      // Final cleanup if the dialog was dismissed via escape or
      // backdrop (the `show` watcher handles regular closes).
      this.resetForm()
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
  padding: 1.25rem 1.5rem 0.75rem;
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

/* Segmented control */
.modal-tabs {
  padding: 0 1.5rem 0.5rem;
}

.seg-control {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  border-radius: var(--radius-lg);
  background: rgba(120, 120, 120, 0.08);
}

.body--dark .seg-control,
.q-dark .seg-control {
  background: rgba(255, 255, 255, 0.06);
}

.seg-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.5rem 0.5rem;
  border-radius: calc(var(--radius-lg) - 4px);
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.seg-tab:hover {
  color: var(--text-primary);
}

.seg-tab--active {
  background: var(--bg-card, #FAF7EF);
  color: var(--text-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.body--dark .seg-tab--active,
.q-dark .seg-tab--active {
  background: #1A1A1A;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.modal-content {
  padding: 0.75rem 1.5rem 0.5rem;
}

/* Avatar */
.avatar-preview {
  display: flex;
  justify-content: center;
  margin-bottom: 1.25rem;
}

/* Silhouette preview — same blue-on-pale-blue treatment as
   ContactAvatar's fallback, purely informational (no picker behind
   it anymore). */
.preview-circle {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #EAEFF7;
  color: #3B82F6;
}

.body--dark .preview-circle {
  background: #23272E;
  color: #5B8DEF;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
}

.preview-glyph {
  /* Filled marks read smaller than strokes — 52% matches the
     reference wallet's bust-to-disc ratio. */
  width: 52%;
  height: 52%;
  display: block;
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

.detected-pill--arkade {
  background: rgba(241, 67, 23, 0.12);
  color: #C0360F;
  box-shadow: inset 0 0 0 1px rgba(241, 67, 23, 0.24);
}

.body--dark .detected-pill--arkade,
.q-dark .detected-pill--arkade {
  color: #F14317;
  box-shadow: inset 0 0 0 1px rgba(241, 67, 23, 0.34);
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


/* Responsive Design */
@media (max-width: 480px) {
  .address-modal {
    max-width: 100%;
    margin: 1rem;
    border-radius: var(--radius-md);
  }

  .modal-header {
    padding: 1rem 1.25rem 0.5rem;
  }

  .modal-tabs {
    padding: 0 1.25rem 0.5rem;
  }

  .modal-content {
    padding: 0.5rem 1.25rem 0.25rem;
  }

  .modal-actions {
    padding: 0.75rem 1.25rem 1.25rem;
  }

}
</style>
