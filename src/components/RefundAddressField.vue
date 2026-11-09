<!--
  RefundAddressField
  The "Refunds to" row of the confirm sheet: the Lightning address that goes
  with a payment when the service asks for one (LUD-18), and the choice of
  another.

  Presentational, like PayWithField. The parent builds `refund` with
  utils/refundAddress.js and owns the choice; this component only draws it
  and reports what was picked. It never sends, stores or remembers anything.

    - Collapsed: one quiet row beside the network fee, the exact address that
      leaves the phone (shortened in the middle; read out whole), a chevron.
      A missing or refused address shows in the warning colour, with one
      line under the row saying why (the problem sits on the field).
    - Expanded (tap): an inline list in place, each address written out in
      full, the selected one checked; "No refund address" where the store
      allows it; "Use another address" below the list opens one field. The
      footer names who keeps the address.
    - With no address to offer, the tap opens the field straight away.
-->
<template>
  <div class="refund-field">
    <button
      ref="row"
      type="button"
      class="refund-row"
      :class="{ 'refund-row--open': open, 'refund-row--warn': warn, 'refund-row--joined': joined }"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="open ? panelId : undefined"
      :aria-label="rowLabel"
      :aria-describedby="hint && !open ? hintId : undefined"
      @click="toggle"
      @keydown.down.prevent="openPanel"
    >
      <span :id="labelId" class="refund-row-label">{{ label }}</span>
      <span class="refund-row-value">
        <span class="refund-row-text">{{ valueText }}</span>
        <Icon icon="tabler:chevron-down" width="16" height="16" class="refund-row-chevron" aria-hidden="true" />
      </span>
    </button>

    <div v-if="hint && !open" :id="hintId" class="refund-hint" role="status">
      <Icon icon="tabler:alert-triangle" width="14" height="14" aria-hidden="true" />
      <span>{{ hint }}</span>
    </div>

    <transition name="refund-panel">
      <div v-if="open" :id="panelId" class="refund-panel">
        <div v-if="showList || !typing" class="refund-card">
          <div
            v-if="showList"
            class="refund-list"
            role="listbox"
            :aria-labelledby="labelId"
            :aria-describedby="footId"
            @keydown="onListKeydown"
          >
            <button
              v-for="(option, index) in options"
              :key="option.address"
              type="button"
              role="option"
              class="refund-option"
              :class="{ 'refund-option--selected': isSelected(option.address) }"
              :aria-selected="isSelected(option.address) ? 'true' : 'false'"
              :tabindex="rovingIndex === index ? 0 : -1"
              @click="pickAddress(option.address)"
            >
              <span class="refund-option-copy">
                <strong class="refund-option-address">{{ wrapParts(option.address).name }}<span v-if="wrapParts(option.address).domain" class="refund-option-domain">{{ wrapParts(option.address).domain }}</span></strong>
                <small :class="{ 'refund-option-warn': isRefused(option.address) }">{{ sourceText(option) }}</small>
              </span>
              <Icon v-if="isSelected(option.address)" icon="tabler:check" width="18" height="18" class="refund-check" aria-hidden="true" />
            </button>
            <button
              v-if="refund.canDecline"
              type="button"
              role="option"
              class="refund-option"
              :class="{ 'refund-option--selected': declined }"
              :aria-selected="declined ? 'true' : 'false'"
              :tabindex="rovingIndex === options.length ? 0 : -1"
              @click="decline"
            >
              <span class="refund-option-copy">
                <strong>{{ $t('No refund address') }}</strong>
                <small>{{ $t('A refund may not reach you') }}</small>
              </span>
              <Icon v-if="declined" icon="tabler:check" width="18" height="18" class="refund-check" aria-hidden="true" />
            </button>
          </div>
          <!-- An action, not a choice: it sits outside the listbox. -->
          <button
            v-if="!typing"
            type="button"
            class="refund-option refund-option--action"
            @click="startTyping"
          >
            {{ $t('Use another address') }}
          </button>
        </div>

        <form v-if="typing" class="refund-entry" novalidate @submit.prevent="useDraft">
          <input
            ref="draft"
            v-model="draft"
            type="email"
            inputmode="email"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            maxlength="320"
            placeholder="name@example.com"
            :aria-label="$t('Another address')"
            :aria-invalid="draftInvalid ? 'true' : 'false'"
            :aria-describedby="draftInvalid ? draftErrorId : undefined"
            @input="draftInvalid = false"
            @keydown.esc.prevent.stop="stopTyping"
          />
          <button type="submit" class="refund-entry-use">{{ $t('Use') }}</button>
        </form>
        <p v-if="typing && draftInvalid" :id="draftErrorId" class="refund-entry-error" role="alert">
          {{ $t("Enter an address like name{'@'}example.com.") }}
        </p>

        <p :id="footId" class="refund-foot">{{ footer }}</p>
      </div>
    </transition>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue'
import { PAYER_ADDRESS_PURPOSE, REFUND_SOURCE, sameRefundAddress, shortRefundAddress } from '../utils/refundAddress.js'
import { payerIdentifier } from '../utils/lud18.js'

export default {
  name: 'RefundAddressField',
  components: { Icon },
  props: {
    /**
     * The row as Wallet.vue's refundSheet builds it: { purpose, options,
     * selected, required, canDecline, declined, refusedAddress, holder }.
     * `problem` comes along for the page's own use; the row reads its state
     * from the address it shows.
     */
    refund: { type: Object, required: true },
    /** Freezes the row while the payment is in flight. */
    disabled: { type: Boolean, default: false },
    /**
     * The network fee row sits right above: the two read as one group of
     * facts, so this row drops its top corners and draws a hairline.
     */
    joined: { type: Boolean, default: false }
  },
  emits: ['pick'],
  data() {
    return { open: false, typing: false, draft: '', draftInvalid: false }
  },
  computed: {
    labelId() { return `refund-label-${this.$.uid}` },
    footId() { return `refund-foot-${this.$.uid}` },
    hintId() { return `refund-hint-${this.$.uid}` },
    panelId() { return `refund-panel-${this.$.uid}` },
    draftErrorId() { return `refund-draft-error-${this.$.uid}` },

    isRefund() { return this.refund.purpose === PAYER_ADDRESS_PURPOSE.REFUND },
    options() { return Array.isArray(this.refund.options) ? this.refund.options : [] },
    selected() { return this.refund.selected || null },
    declined() { return !this.selected && !!this.refund.declined },
    missing() { return !!this.refund.required && !this.selected },
    /** The address on the row is the one the store just turned down. */
    refused() { return this.isRefused(this.selected) },
    warn() { return this.missing || this.refused },

    label() { return this.isRefund ? this.$t('Refunds to') : this.$t('Your address') },
    valueText() {
      if (this.selected) return this.short(this.selected)
      return this.missing ? this.$t('Add an address') : this.$t('No address')
    },
    /** What a screen reader hears for the row: the label and the whole address. */
    rowLabel() {
      return `${this.label}, ${this.selected || this.valueText}`
    },
    /** Why the slide waits, said on the row (the problem sits on the field). */
    hint() {
      if (this.refused) return this.$t("This address can't receive refunds. Choose another.")
      if (this.missing) {
        return this.isRefund ? this.$t('This store needs a refund address.') : this.$t('This recipient needs your address.')
      }
      return ''
    },
    footer() {
      const name = this.refund.holder || ''
      return this.isRefund
        ? this.$t('{provider} keeps this address with your payment to send any refund.', { provider: name })
        : this.$t('{service} asks for your address with this payment.', { service: name })
    },
    showList() { return this.options.length > 0 || this.refund.canDecline },
    /** The one option Tab lands on: the chosen one, else the first. */
    rovingIndex() {
      const at = this.options.findIndex((option) => this.isSelected(option.address))
      if (at >= 0) return at
      return this.declined ? this.options.length : 0
    }
  },
  watch: {
    disabled(v) {
      if (v) this.close()
    }
  },
  methods: {
    short(address) { return shortRefundAddress(address) },

    isSelected(address) { return sameRefundAddress(this.selected, address) },

    isRefused(address) { return sameRefundAddress(address, this.refund.refusedAddress) },

    /**
     * An address split where it may wrap: a long name wraps anywhere, the
     * domain stays whole on its line (`npub.cash`, never `npub.cas` + `h`).
     * A domain too long for a narrow line wraps with the name.
     */
    wrapParts(address) {
      const text = String(address || '')
      const at = text.lastIndexOf('@')
      const domain = at > 0 ? text.slice(at) : ''
      return domain && domain.length <= 24 ? { name: text.slice(0, at), domain } : { name: text, domain: '' }
    },

    sourceText(option) {
      if (this.isRefused(option.address)) return this.$t("Can't receive refunds")
      switch (option.source) {
        case REFUND_SOURCE.WALLET: return option.name || this.$t('Wallet')
        case REFUND_SOURCE.BUCKET: return this.$t('Social Bucket')
        case REFUND_SOURCE.ENTERED: return this.$t('Just for this payment')
        default: return this.$t('Your profile')
      }
    },

    toggle() {
      if (this.disabled) return
      if (this.open) this.close(true)
      else this.openPanel()
    },

    openPanel() {
      if (this.disabled) return
      this.open = true
      this.draftInvalid = false
      // Nothing to choose from: straight to the one field.
      this.typing = !this.showList
      this.$nextTick(() => {
        if (this.typing) {
          this.$refs.draft?.focus?.()
          return
        }
        const target = this.$el?.querySelector?.('.refund-option--selected')
          || this.$el?.querySelector?.('[role="option"]')
        target?.focus?.()
        // The list opens in place: bring its foot into view, no further.
        const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        this.$el?.querySelector?.('.refund-foot')?.scrollIntoView?.({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
      })
    },

    close(refocus = false) {
      this.open = false
      this.typing = false
      this.draft = ''
      this.draftInvalid = false
      if (refocus) this.$nextTick(() => this.$refs.row?.focus?.())
    },

    pickAddress(address) {
      if (this.disabled) return
      this.$emit('pick', { address })
      this.close(true)
    },

    decline() {
      if (this.disabled || !this.refund.canDecline) return
      this.$emit('pick', { declined: true })
      this.close(true)
    },

    startTyping() {
      this.typing = true
      this.$nextTick(() => this.$refs.draft?.focus?.())
    },

    stopTyping() {
      if (this.showList) {
        this.typing = false
        this.draft = ''
        this.draftInvalid = false
      } else {
        this.close(true)
      }
    },

    /** The same check every address in the app gets (utils/lud18.payerIdentifier). */
    useDraft() {
      const address = payerIdentifier(this.draft)
      if (!address) {
        this.draftInvalid = true
        this.$nextTick(() => this.$refs.draft?.focus?.())
        return
      }
      this.$emit('pick', { address, entered: true })
      this.close(true)
    },

    onListKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.close(true)
        return
      }
      const items = Array.from(this.$el.querySelectorAll('.refund-list > [role="option"]'))
      if (!items.length) return
      const at = items.indexOf(document.activeElement)
      let next
      if (event.key === 'ArrowDown') next = at < items.length - 1 ? at + 1 : 0
      else if (event.key === 'ArrowUp') next = at > 0 ? at - 1 : items.length - 1
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = items.length - 1
      else return
      event.preventDefault()
      items[next].focus()
    }
  }
}
</script>

<style scoped>
.refund-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* One quiet fact beside the fee: same type, same height, same surface. */
.refund-row {
  width: 100%;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-secondary);
  font-family: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s ease;
}
.refund-row--joined {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
  box-shadow: inset 0 1px 0 var(--border-card);
}
.refund-row:disabled { cursor: default; opacity: 0.6; }
.refund-row:active:not(:disabled),
.refund-row--open { background: var(--brand-accent-soft); }
.refund-row-label { flex: none; font-weight: 500; letter-spacing: 0.01em; }
.refund-row-value {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  color: var(--text-primary);
}
.refund-row-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.refund-row-chevron { flex: none; color: var(--text-muted); transition: transform 0.16s ease; }
.refund-row--open .refund-row-chevron { transform: rotate(180deg); }
.refund-row--warn .refund-row-value,
.refund-row--warn .refund-row-chevron { color: var(--color-warn); }

.refund-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  font-size: 12.5px;
  line-height: 1.4;
  background: rgba(245, 158, 11, 0.10);
  color: #B45309;
  box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.22);
}
.body--dark .refund-hint {
  background: rgba(245, 158, 11, 0.12);
  color: #F59E0B;
  box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.28);
}
.refund-hint svg { flex: none; }

.refund-panel { display: flex; flex-direction: column; gap: 8px; }

.refund-card {
  overflow: hidden;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}
.refund-list {
  max-height: min(240px, 32dvh);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.refund-list + .refund-option--action { border-top: 1px solid var(--border-card); }
.refund-option {
  width: 100%;
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border: 0;
  border-bottom: 1px solid var(--border-card);
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.refund-option:last-child { border-bottom: 0; }
.refund-option--selected,
.refund-option:active { background: var(--brand-accent-soft); }
.refund-option--action {
  min-height: 44px;
  font-size: 0.90625rem;
  font-weight: 650;
  color: var(--brand-accent-text);
}
.refund-option-copy { flex: 1; min-width: 0; }
.refund-option-copy strong,
.refund-option-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.refund-option-copy strong { font-size: 0.90625rem; font-weight: 650; color: var(--text-primary); }
/* The list says exactly what leaves the phone: a long address wraps, its
   domain kept whole. */
.refund-option-copy .refund-option-address { white-space: normal; overflow-wrap: anywhere; }
.refund-option-domain { white-space: nowrap; }
.refund-option-copy small { margin-top: 2px; font-size: 0.75rem; line-height: 1.35; color: var(--text-secondary); }
.refund-option-copy .refund-option-warn { font-weight: 600; color: var(--color-warn); }
.refund-check { flex: none; color: var(--brand-accent-text); }

.refund-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 2px 4px 2px 14px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
}
.refund-entry:focus-within { box-shadow: inset 0 0 0 1px rgba(128, 128, 128, 0.35); }
.refund-entry input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: none;
  font-family: inherit;
  /* 16px on purpose: anything smaller makes the phone zoom the sheet on focus. */
  font-size: 16px;
  color: var(--text-primary);
}
.refund-entry input::placeholder { color: var(--text-muted); }
.refund-entry-use {
  flex: none;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  background: none;
  font-family: inherit;
  font-size: 0.90625rem;
  font-weight: 650;
  color: var(--brand-accent-text);
  cursor: pointer;
}
.refund-entry-error { margin: -2px 0 0; padding: 0 4px; font-size: 12px; color: var(--color-warn); }
.refund-foot { margin: 0; padding: 0 4px; font-size: 12px; line-height: 1.4; color: var(--text-secondary); }

.refund-row:focus-visible,
.refund-option:focus-visible,
.refund-entry-use:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: -2px;
}

.refund-panel-enter-active,
.refund-panel-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; transform-origin: top; }
.refund-panel-enter-from,
.refund-panel-leave-to { opacity: 0; transform: translateY(-4px); }

@media (prefers-reduced-motion: reduce) {
  .refund-row,
  .refund-row-chevron,
  .refund-panel-enter-active,
  .refund-panel-leave-active { transition: none; }
  .refund-panel-enter-from,
  .refund-panel-leave-to { transform: none; }
}
</style>
