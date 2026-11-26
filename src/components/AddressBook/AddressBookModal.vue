<template>
  <q-dialog
    v-model="dialogOpen"
    persistent
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    @hide="onHide"
  >
    <q-card
      class="address-modal"
      :class="[$q.dark.isActive ? 'card_dark_style' : 'card_light_style', { 'address-modal--search': !isEditing && activeTab === 'search' }]"
    >
      <!-- Header -->
      <q-card-section class="modal-header" :class="{ 'modal-header--back': activeTab === 'search' && searchNavigation.canGoBack }">
        <button v-if="activeTab === 'search' && searchNavigation.canGoBack" ref="searchBack"
          type="button" class="search-header-back" :aria-label="$t('Back to results')"
          :disabled="searchNavigation.saving" @click="$refs.searchRef?.backToResults()">
          <q-icon name="chevron_left" size="24px" :aria-hidden="true" />
        </button>
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
          :aria-label="$t('Close')"
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
          @address-request="shareAddress"
        />

        <!-- SEARCH -->
        <AddContactSearch
          v-else-if="!isEditing && activeTab === 'search'"
          ref="searchRef"
          :initial-query="initialQuery"
          @navigation-change="searchNavigation = $event"
          @focus-back="$refs.searchBack?.focus()"
          :active="show && activeTab === 'search'"
          @saved="onChildSaved"
          @open-existing="onOpenExisting"
        />

        <!-- MANUAL — also used for the edit flow -->
        <template v-else>
          <!-- The contact as the list will show them: their picture while
               editing, else the first character of the name typed so far. -->
          <div class="avatar-preview">
            <ContactAvatar class="preview-avatar" :entry="previewEntry" />
          </div>

          <!-- The address first: it is what makes a contact payable, and a
               Lightning address or a payment link's label suggests the name. -->
          <div class="form-fields">
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
                    <PaymentMark :address-type="detectedType" :size="12" />
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
                maxlength="16384"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                :aria-invalid="addressShowsError || !!duplicateEntry"
                aria-describedby="contact-address-helper"
              />
              <div id="contact-address-helper" class="input-helper" :class="$q.dark.isActive ? 'helper-dark' : 'helper-light'" aria-live="polite">
                <template v-if="addressIsRequest">
                  <span>{{ $t('Review this request to share your payment address.') }}</span>
                </template>
                <template v-else-if="addressShowsError">
                  <Icon icon="tabler:alert-circle" width="13" height="13" />
                  <span v-if="addressReading?.problem === 'one-time'">{{ $t('This is a one-time payment request, not a lasting address. Pay it and save the contact from the payment screen instead.') }}</span>
                  <span v-else-if="addressReading?.problem === 'invalid'">{{ $t("This address isn't complete or has a typo. Check it and try again.") }}</span>
                  <span v-else>{{ $t("We don't recognize this as a Lightning, Spark, Bitcoin, or LNURL address") }}</span>
                </template>
                <template v-else-if="duplicateEntry">
                  <Icon icon="tabler:alert-circle" width="13" height="13" />
                  <span>{{ $t('Already saved as {name}', { name: duplicateEntry.name }) }}</span>
                </template>
                <template v-else>
                  <span>{{ $t('Works with a Lightning, Spark, or Bitcoin address, or an LNURL link') }}</span>
                </template>
              </div>
            </div>

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
              <div class="input-label" :class="$q.dark.isActive ? 'view_title_dark' : 'view_title'">
                {{ $t('Notes') }} <span class="optional-hint">({{ $t('optional') }})</span>
              </div>
              <textarea
                v-model="formData.notes"
                :placeholder="$t('e.g., Monthly rent, Coffee shop…')"
                class="form-input notes-textarea"
                :class="$q.dark.isActive ? 'form-input-dark' : 'form-input-light'"
                maxlength="200"
                rows="2"
              />
            </div>
          </div>
        </template>
      </q-card-section>

      <!-- Footer: only the manual / edit path needs it; Search and Scan
           save from their own preview card. One full-width action that
           plainly cannot be used until the form is complete, Cancel
           quietly beneath it. -->
      <q-card-section v-if="showManualFooter" class="modal-actions">
        <button
          type="button"
          class="form-sheet-primary save-btn"
          :disabled="isSaving || (!isFormValid && !addressIsRequest)"
          :aria-busy="isSaving ? 'true' : null"
          @click="saveEntry"
        >
          <q-spinner v-if="isSaving" size="18px" :aria-hidden="true" />
          <span>{{ addressIsRequest ? $t('Review request') : isEditing ? $t('Save') : $t('Add contact') }}</span>
        </button>
        <button type="button" class="cancel-btn" @click="closeModal">{{ $t('Cancel') }}</button>
      </q-card-section>
    </q-card>

  </q-dialog>
</template>

<script>
import { isAddressRequest } from '../../utils/lud23.js';
import { offerAddressRequest } from '../../services/addressRequestIntake.js';
import { useAddressRequestStore } from '../../stores/addressRequest.js';
import { useAddressBookStore } from '../../stores/addressBook'
import { mapActions } from 'pinia'
import { lnurlToUrl, lnurlDomain, stripWrapperScheme } from '../../utils/addressUtils.js'
import { isBip21 } from '../../utils/bip21.js'
import { readContactAddress, suggestedContactName } from '../../utils/contactAddress.js'
import { contactSaveError } from '../../utils/contactErrors.js'
import { fetchPayRequest } from '../../utils/lnurlPay.js'
import { parsePayRequestMetadata, serviceTitle, normalizeServiceImage, serviceIdentity } from '../../utils/lnurlMetadata.js'
import { useServiceImagesStore } from '../../stores/serviceImages'
import AddContactSearch from './AddContactSearch.vue'
import AddContactScan from './AddContactScan.vue'
import ContactAvatar from './ContactAvatar.vue'
import PaymentMark from '../PaymentMark.vue'

/** True for text wrapped in a payment link or URI scheme the field unwraps. */
function isWrapped(text) {
  return isBip21(text) || stripWrapperScheme(text) !== text.trim()
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
  components: { AddContactSearch, AddContactScan, ContactAvatar, PaymentMark },
  props: {
    modelValue: {
      type: Boolean,
      default: false
    },
    entry: {
      type: Object,
      default: null
    },
    // A creation draft, never an entry: prefill must not select edit mode.
    initialAddress: {
      type: String,
      default: ''
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
    },
    // Text the Search tab starts with (the chat's "Add contact" hands over the
    // sender's npub, so the preview is one tap away). Ignored by other tabs.
    initialQuery: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue', 'saved', 'open-existing'],
  data() {
    return {
      activeTab: 'manual',
      searchNavigation: { canGoBack: false, saving: false },
      addressHandoff: false,
      tabs: TABS,
      formData: {
        name: '',
        address: '',
        notes: ''
      },
      isSaving: false,
      // The name the address suggested, and the address it came from: a
      // suggestion follows the address until the person names them.
      suggestedName: '',
      nameSuggestedFor: '',
    }
  },
  setup() { return { addressRequests: useAddressRequestStore() }; },
  computed: {
    addressIsRequest() { return isAddressRequest(this.formData.address); },
    dialogOpen: {
      get() { return this.show && !this.addressHandoff; },
      set(value) { if (!this.addressHandoff) this.show = value; }
    },

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

    /** What the field holds as a contact address (utils/contactAddress). */
    addressReading() {
      return readContactAddress(this.formData.address)
    },

    detectedType() {
      return this.addressReading?.addressType || null
    },

    /** An unchanged address of the contact being edited is not a duplicate of itself. */
    duplicateEntry() {
      const address = this.addressReading?.address
      if (!address) return null
      return useAddressBookStore().findContactByAddress(address, this.entry?.id || null)
    },

    /**
     * A Nostr contact saved without an address can still be renamed: its
     * address comes from their profile when they publish one.
     */
    editingWithoutAddress() {
      return this.isEditing && !this.formData.address.trim()
        && this.entry?.source === 'nostr' && !(this.entry.address || this.entry.lightningAddress)
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

    /** The avatar preview: the contact being edited, else what is typed so far. */
    previewEntry() {
      const name = this.formData.name.trim()
      if (this.isEditing) return { ...this.entry, name: name || this.entry.name }
      return { name, address: this.addressReading?.address || '', addressType: this.detectedType || '' }
    },

    addressShowsError() {
      return this.formData.address.trim().length > 0 && !this.detectedType && !this.addressIsRequest
    },

    isFormValid() {
      if (!this.formData.name.trim()) return false
      if (this.editingWithoutAddress) return true
      return !!this.detectedType && !this.duplicateEntry
    }
  },
  watch: {
    'addressRequests.state.presented'(value) {
      if (!value && this.addressRequests.state.stage === 'idle') this.addressHandoff = false;
    },
    'addressRequests.state.stage'(value) {
      if (value === 'idle' && !this.addressRequests.state.presented) this.addressHandoff = false;
    },
    /**
     * A pasted payment link or `lightning:` link becomes the lasting
     * address inside it, in the field itself, so what is saved is what the
     * person sees. The address suggests the name (utils/contactAddress):
     * the link's label, else a Lightning address's own name.
     */
    'formData.address'(value) {
      const reading = this.addressReading
      if (!reading?.address) return
      this.suggestName(suggestedContactName(reading), reading.address)
      if (isWrapped(value)) this.formData.address = reading.address
    },
    show(newVal) {
      if (newVal) {
        this.initializeForm()
        // Add mode lands on `initialTab` (defaults to the manual "Enter"
        // form, which works for everyone without assuming Nostr fluency).
        // Editing always lands on manual regardless of `initialTab` since
        // there is no tab bar in that mode. Resetting here keeps the next
        // open from being biased by where the previous one finished.
        this.activeTab = this.isEditing ? 'manual' : this.initialTab
        this.$nextTick(() => this.focusManualForm())
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
        if (id === 'manual') this.focusManualForm()
        else if (id === 'search') this.$refs.searchRef?.focus?.()
      })
    },

    /** The keyboard opens where the work is: the address until there is one, then the name. */
    focusManualForm() {
      if (this.activeTab !== 'manual') return
      const ref = this.isEditing || this.formData.address.trim() ? 'nameInput' : 'addressInput'
      this.$refs[ref]?.focus()
    },

    /**
     * Put the address's suggestion in the name field, unless the person
     * named the contact themselves. Each address suggests once, so the
     * unwrapped address of a link never replaces its label.
     */
    suggestName(suggestion, forAddress) {
      if (!forAddress || forAddress === this.nameSuggestedFor) return
      this.nameSuggestedFor = forAddress
      const typed = this.formData.name.trim()
      if (typed && typed !== this.suggestedName) return
      this.suggestedName = suggestion
      this.formData.name = suggestion
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
          address: readContactAddress(this.initialAddress)?.address || '',
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
      this.suggestedName = ''
      this.nameSuggestedFor = ''
      this.isSaving = false
      this.activeTab = 'manual'
    },


    /**
     * Child save callback — fires after AddContactSearch or
     * AddContactScan have persisted a Nostr contact. Bubbles up so
     * the list refreshes and the sheet dismisses with the same
     * `saved` semantics the manual flow uses.
     */
    onChildSaved(entry) {
      this.$emit('saved', entry)
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

    shareAddress(value) {
      if (offerAddressRequest(value, { t: this.$t.bind(this) })) {
        this.addressHandoff = this.addressRequests.state.stage !== 'idle';
        this.activeTab = 'manual';
      }
    },

    async saveEntry() {
      if (this.addressIsRequest) { this.shareAddress(this.formData.address); return; }
      if (!this.isFormValid) return

      this.isSaving = true

      try {
        // The stored form: lowercase bech32, the lasting part of a link,
        // the canonical LNURL (utils/contactAddress).
        const entryData = {
          name: this.formData.name.trim(),
          notes: this.formData.notes?.trim() || ''
        }
        if (this.addressReading?.address) {
          entryData.address = this.addressReading.address
          entryData.addressType = this.addressReading.addressType
        }

        // A pasted pay link (LUD-11 service) gets one chance to describe
        // itself (LUD-06 name and logo). Best effort: no answer means the
        // domain is the name, and nothing here ever creates an invoice.
        if (this.detectedType === 'lnurl' && !this.isEditing) {
          entryData.service = await this.describeService(entryData.address)
        }

        let savedEntry
        if (this.isEditing) {
          savedEntry = await this.updateEntry(this.entry.id, entryData)
          this.$q.notify({
            type: 'positive',
            message: this.$t('Contact saved'),
          })
        } else {
          savedEntry = await this.addEntry(entryData)
          this.$q.notify({
            type: 'positive',
            message: this.$t('Contact added'),
          })
        }

        this.$emit('saved', savedEntry)
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

    /**
     * Ask a pay link who it is: one GET of the payRequest, its LUD-06
     * metadata parsed, the logo kept in the local image registry. Whether
     * the link is reusable (LUD-11) is only known after a payment, so
     * `reusable` stays null here. Never throws; null when nothing useful
     * came back.
     */
    async describeService(address) {
      const url = lnurlToUrl(address)
      if (!url) return null
      const domain = lnurlDomain(address)
      const service = { name: domain, identifier: null, domain, reusable: null, seenAt: Date.now() }
      try {
        const data = await fetchPayRequest(url, { timeoutMs: 10000 })
        const meta = parsePayRequestMetadata(data.metadata)
        normalizeServiceImage(meta.image)
          .then((dataUrl) => { if (dataUrl) useServiceImagesStore().put(serviceIdentity(address, meta).address, dataUrl) })
          .catch(() => {})
        return { ...service, name: serviceTitle(meta, domain), identifier: meta.identifier }
      } catch {
        return service
      }
    },

    closeModal() {
      this.show = false
    },

    onHide() {
      if (this.addressHandoff) return;
      // Final cleanup if the dialog was dismissed via escape or
      // backdrop (the `show` watcher handles regular closes).
      this.resetForm()
    },

    getErrorMessage(error) {
      const { message, caption } = contactSaveError(error, this.$t.bind(this))
      return { title: message, caption }
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

.address-modal--search { display: flex; flex-direction: column; max-height: calc(100dvh - 48px); }
.address-modal--search .modal-header, .address-modal--search .modal-tabs { flex-shrink: 0; }
.address-modal--search .modal-content { display: flex; overflow: hidden; min-height: 0; padding-bottom: 16px; }
.search-header-back { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 44px; width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: var(--text-primary); cursor: pointer; }
.search-header-back:focus-visible { outline: 2px solid currentColor; }
.modal-header--back .modal-title { flex: 1; text-align: center; }
.address-modal--search .close-btn { min-width: 44px; min-height: 44px; }
.address-modal--search .seg-tab { min-height: 44px; min-width: 0; }

/* Avatar */
.avatar-preview {
  display: flex;
  justify-content: center;
  margin-bottom: 1.25rem;
}

/* ContactAvatar owns the look; the sheet only sizes it. */
.preview-avatar {
  width: 64px;
  height: 64px;
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
  background: var(--arkade-tint);
  color: var(--arkade-ink-text);
  box-shadow: inset 0 0 0 1px var(--arkade-tint-border);
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
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 1rem 1.5rem 1.25rem;
}

/* Full width, the shared sheet button; while it cannot be used it is
   plainly grey in both themes, never a dimmed version of the live one. */
.save-btn {
  width: 100%;
}

.save-btn:disabled {
  opacity: 1;
  background: var(--bg-input);
  color: var(--text-muted);
}

.cancel-btn {
  width: 100%;
  min-height: 44px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--text-secondary);
  font: 500 15px/1.3 'Manrope', sans-serif;
  cursor: pointer;
}

.cancel-btn:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}


/* Responsive Design */
@media (max-width: 480px) {
  .address-modal.address-modal--search { margin: 0; }
  .address-modal--search .modal-header { padding: 16px 16px 8px; }
  .address-modal--search .modal-tabs { padding: 0 16px 8px; }
  .address-modal--search .modal-content { padding: 8px 16px 16px; }
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
    padding: 0.75rem 1.25rem 1rem;
  }

}
@media (max-width: 360px) {
  .address-modal--search .seg-tab { gap: 0; padding: 8px 2px; }
  .address-modal--search .seg-tab :deep(svg) { display: none; }
}
</style>
