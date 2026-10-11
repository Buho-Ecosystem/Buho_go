<!--
  PayWithField
  The "Pay with" row of the confirm sheet: which of the user's wallets pays.

  Presentational. The parent builds the entries with
  utils/payingWallets.listPayingWallets and owns the selected id; this
  component only draws them and reports which row was picked. It never
  switches the active wallet and never reads a balance itself.

    - Collapsed: brand mark, wallet name, "type · balance · fiat", chevron. A selected
      wallet that cannot pay shows its reason in the warning colour.
    - Expanded (tap): an inline listbox, active wallet first. The selected row
      carries a check; rows that cannot pay are aria-disabled, dimmed, ignore
      taps and say why.
    - Renders nothing for fewer than two wallets: with one wallet there is
      nothing to choose, so single-wallet users see no extra UI.
-->
<template>
  <div v-if="visible" class="pay-with" :class="{ 'pay-with--open': open }">
    <span :id="labelId" class="pay-with-label">{{ $t('Pay with') }}</span>

    <button
      ref="field"
      type="button"
      class="pay-with-field"
      :class="{ 'pay-with-field--blocked': !!selected.reason }"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="open ? listId : undefined"
      :aria-labelledby="`${labelId} ${valueId}`"
      @click="toggle"
      @keydown.down.prevent="openList"
    >
      <span class="pay-with-tile" :class="{ 'pay-with-tile--arkade': selected.type === 'arkade' }" aria-hidden="true">
        <WalletBrandMark :type="selected.type" :size="18" />
      </span>
      <span :id="valueId" class="pay-with-copy">
        <strong>{{ walletName(selected) }}</strong>
        <small v-balance-updating="isRefreshPending(selected)">
          {{ typeLabel(selected) }}<template v-if="balanceOf(selected).known"> · <HiddenAmount :class="{ 'balance-stale': balanceOf(selected).outdated }">{{ formatBalance(selected) }}</HiddenAmount><template v-if="fiatOf(selected)"> · <HiddenAmount :class="{ 'balance-stale': balanceOf(selected).outdated }">{{ fiatOf(selected) }}</HiddenAmount></template></template>
        </small>
        <small v-if="selected.reason" class="pay-with-reason">{{ reasonText(selected) }}</small>
      </span>
      <Icon
        icon="tabler:chevron-down"
        width="19"
        height="19"
        class="pay-with-chevron"
        :class="{ 'pay-with-chevron--open': open }"
        aria-hidden="true"
      />
    </button>

    <transition name="pay-with-list">
      <div
        v-if="open"
        :id="listId"
        class="pay-with-list"
        role="listbox"
        :aria-labelledby="labelId"
        @keydown="onListKeydown"
      >
        <button
          v-for="wallet in wallets"
          :key="wallet.id"
          type="button"
          role="option"
          class="pay-with-option"
          :class="{
            'pay-with-option--selected': wallet.id === selected.id,
            'pay-with-option--unusable': !wallet.usable
          }"
          :aria-selected="wallet.id === selected.id ? 'true' : 'false'"
          :aria-disabled="wallet.usable ? undefined : 'true'"
          tabindex="-1"
          @click="choose(wallet)"
        >
          <span class="pay-with-tile" :class="{ 'pay-with-tile--arkade': wallet.type === 'arkade' }" aria-hidden="true">
            <WalletBrandMark :type="wallet.type" :size="16" />
          </span>
          <span class="pay-with-copy">
            <strong>{{ walletName(wallet) }}</strong>
            <small v-balance-updating="isRefreshPending(wallet)">
              {{ typeLabel(wallet) }}<template v-if="balanceOf(wallet).known"> · <HiddenAmount :class="{ 'balance-stale': balanceOf(wallet).outdated }">{{ formatBalance(wallet) }}</HiddenAmount><template v-if="fiatOf(wallet)"> · <HiddenAmount :class="{ 'balance-stale': balanceOf(wallet).outdated }">{{ fiatOf(wallet) }}</HiddenAmount></template></template>
            </small>
            <small v-if="wallet.reason" class="pay-with-reason">{{ reasonText(wallet) }}</small>
          </span>
          <Icon
            v-if="wallet.id === selected.id"
            icon="tabler:check"
            width="18"
            height="18"
            class="pay-with-check"
            aria-hidden="true"
          />
        </button>
      </div>
    </transition>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue'
import { mapState } from 'pinia'
import { useWalletStore } from '../stores/wallet'
import { WALLET_TYPE_LABELS } from '../providers/WalletFactory'
import { formatAmount } from '../utils/amountFormatting.js'
import { payingWalletReasonText } from '../utils/payingWallets.js'
import balanceUpdating from '../directives/balanceUpdating.js'
import WalletBrandMark from './WalletBrandMark.vue'
import HiddenAmount from './HiddenAmount.vue'

export default {
  name: 'PayWithField',
  components: { Icon, WalletBrandMark, HiddenAmount },
  directives: { balanceUpdating },
  props: {
    /**
     * Entries from utils/payingWallets.listPayingWallets, active wallet first:
     * { id, name, type, balanceSats, isActive, usable, reason }.
     */
    wallets: { type: Array, default: () => [] },
    /** Id of the selected wallet. */
    modelValue: { type: String, default: null },
    /** Freezes the field while the payment is in flight. */
    disabled: { type: Boolean, default: false }
  },
  emits: ['update:modelValue'],
  data() {
    return { open: false }
  },
  computed: {
    ...mapState(useWalletStore, ['useBip177Format', 'getDisplayBalance', 'fiatValueOf']),

    labelId() { return `pay-with-label-${this.$.uid}` },
    listId() { return `pay-with-list-${this.$.uid}` },
    valueId() { return `pay-with-value-${this.$.uid}` },

    visible() {
      return this.wallets.length >= 2
    },

    /** The shown row. A missing or stale id falls back to the active wallet. */
    selected() {
      return this.wallets.find((w) => w.id === this.modelValue)
        || this.wallets.find((w) => w.isActive)
        || this.wallets[0]
        || null
    }
  },
  watch: {
    // The field is a choice between wallets; with fewer than two, or while a
    // payment is in flight, an open list has no business staying open.
    visible(v) {
      if (!v) this.open = false
    },
    disabled(v) {
      if (v) this.open = false
    }
  },
  methods: {
    walletName(wallet) {
      return wallet.name || this.$t('Wallet')
    },

    typeLabel(wallet) {
      return WALLET_TYPE_LABELS[wallet.type] || wallet.type
    },

    /**
     * The one balance rule of every wallet list: a known figure (dimmed when
     * outdated) with its fiat value, nothing while unknown, a pulse while the
     * first figure is on the way. The entry's balanceSats stays the input of
     * the "can it pay" verdict only.
     */
    balanceOf(wallet) {
      return this.getDisplayBalance(wallet.id)
    },

    isRefreshPending(wallet) {
      const shown = this.balanceOf(wallet)
      return shown.refreshing && !shown.known
    },

    formatBalance(wallet) {
      return formatAmount(this.balanceOf(wallet).balance, this.useBip177Format)
    },

    fiatOf(wallet) {
      return this.fiatValueOf(this.balanceOf(wallet).balance)
    },

    reasonText(wallet) {
      return payingWalletReasonText(wallet.reason, this.$t.bind(this))
    },

    toggle() {
      if (this.disabled) return
      if (this.open) this.close()
      else this.openList()
    },

    openList() {
      if (this.disabled || !this.visible) return
      this.open = true
      // Keyboard and screen-reader users land on the current choice.
      this.$nextTick(() => {
        const target = this.$el?.querySelector?.('.pay-with-option--selected')
          || this.$el?.querySelector?.('[role="option"]')
        target?.focus?.()
      })
    },

    close(refocus = false) {
      this.open = false
      if (refocus) this.$nextTick(() => this.$refs.field?.focus?.())
    },

    /** A wallet that cannot pay is listed with its reason but cannot be picked. */
    choose(wallet) {
      if (!wallet?.usable || this.disabled) return
      if (wallet.id !== this.selected?.id) this.$emit('update:modelValue', wallet.id)
      this.close(true)
    },

    onListKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.close(true)
        return
      }
      const options = Array.from(this.$el.querySelectorAll('[role="option"]'))
      if (!options.length) return
      const at = options.indexOf(document.activeElement)
      let next
      if (event.key === 'ArrowDown') next = at < options.length - 1 ? at + 1 : 0
      else if (event.key === 'ArrowUp') next = at > 0 ? at - 1 : options.length - 1
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = options.length - 1
      else return
      event.preventDefault()
      options[next].focus()
    }
  }
}
</script>

<style scoped>
.pay-with {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pay-with-label {
  padding: 0 4px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--text-secondary);
}

/* The collapsed field: the same quiet cell as the recipient above it. */
.pay-with-field {
  width: 100%;
  min-height: 56px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
.pay-with-field:disabled { cursor: default; opacity: 0.6; }
.pay-with-field:active:not(:disabled) { background: var(--brand-accent-soft); }
.pay-with-field--blocked { box-shadow: inset 0 0 0 1px var(--color-warn); }
.pay-with--open .pay-with-field { background: var(--brand-accent-soft); }

.pay-with-tile {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: white;
  /* The dark wallet circle every wallet list uses. */
  background: linear-gradient(135deg, #2A2A2A, #1A1A1A);
}
/* Arkade's purple mark needs a light tile on cream (brand rule). */
body.body--light .pay-with-tile--arkade {
  background: var(--arkade-tile);
  box-shadow: inset 0 0 0 1px var(--arkade-tint-border);
}

.pay-with-copy { min-width: 0; flex: 1; }
.pay-with-copy strong,
.pay-with-copy small { display: block; }
.pay-with-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.90625rem;
  font-weight: 650;
  color: var(--text-primary);
}
.pay-with-copy small {
  margin-top: 2px;
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--text-secondary);
}
.pay-with-copy .pay-with-reason {
  font-weight: 600;
  color: var(--color-warn);
}

.pay-with-chevron {
  flex: 0 0 auto;
  color: var(--text-muted);
  transition: transform 0.16s ease;
}
.pay-with-chevron--open { transform: rotate(180deg); }
.pay-with-check { flex: 0 0 auto; color: var(--brand-accent-text); }

/* The inline list, scrolling on its own if the user has many wallets. */
.pay-with-list {
  max-height: min(264px, 34dvh);
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}

.pay-with-option {
  width: 100%;
  min-height: 56px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid var(--border-card);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  -webkit-tap-highlight-color: transparent;
}
.pay-with-option:last-child { border-bottom: 0; }
.pay-with-option:active:not(.pay-with-option--unusable),
.pay-with-option--selected { background: var(--brand-accent-soft); }
.pay-with-option .pay-with-tile { width: 34px; height: 34px; flex-basis: 34px; }
/* Listed so the reason is discoverable, but visibly out of reach. */
.pay-with-option--unusable { cursor: not-allowed; }
.pay-with-option--unusable .pay-with-tile,
.pay-with-option--unusable .pay-with-copy strong { opacity: 0.55; }

.pay-with-field:focus-visible,
.pay-with-option:focus-visible {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: -2px;
}

.pay-with-list-enter-active,
.pay-with-list-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
  transform-origin: top;
}
.pay-with-list-enter-from,
.pay-with-list-leave-to { opacity: 0; transform: translateY(-4px); }

@media (prefers-reduced-motion: reduce) {
  .pay-with-field,
  .pay-with-chevron,
  .pay-with-list-enter-active,
  .pay-with-list-leave-active { transition: none; }
  .pay-with-list-enter-from,
  .pay-with-list-leave-to { transform: none; }
}
</style>
