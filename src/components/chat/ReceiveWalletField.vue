<!--
  ReceiveWalletField
  "Receive in": which wallet the requested money lands in. The receiving
  counterpart of PayWithField, with the same cell, list and keyboard
  behaviour, but with no store inside: the parent passes ready-to-draw rows.

    entries: [{ id, name, type, detail, usable, reason }]
      type    'spark' | 'arkade' | 'nwc' | 'lnbits' (picks the icon)
      detail  second line, already formatted ("Spark · ₿ 1,200")
      reason  why an unusable wallet cannot receive, already translated

  With one entry the row is static (it still tells where the money lands);
  with several it is a listbox. Rows that cannot receive are listed with their
  reason but cannot be picked.
-->
<template>
  <div v-if="selected" class="receive-field" :class="{ 'receive-field--open': open }">
    <span :id="labelId" class="receive-field__label">{{ $t('Receive in') }}</span>

    <div v-if="!choosable" class="receive-field__cell receive-field__cell--static">
      <span class="receive-field__tile" aria-hidden="true">
        <Icon :icon="walletIcon(selected.type)" width="20" height="20" />
      </span>
      <span :id="valueId" class="receive-field__copy">
        <strong>{{ selected.name }}</strong>
        <small>{{ selected.detail }}</small>
      </span>
    </div>

    <template v-else>
      <button
        ref="field"
        type="button"
        class="receive-field__cell"
        :disabled="disabled"
        aria-haspopup="listbox"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="open ? listId : undefined"
        :aria-labelledby="`${labelId} ${valueId}`"
        @click="toggle"
        @keydown.down.prevent="openList"
      >
        <span class="receive-field__tile" aria-hidden="true">
          <Icon :icon="walletIcon(selected.type)" width="20" height="20" />
        </span>
        <span :id="valueId" class="receive-field__copy">
          <strong>{{ selected.name }}</strong>
          <small>{{ selected.detail }}</small>
        </span>
        <Icon
          icon="tabler:chevron-down"
          width="19"
          height="19"
          class="receive-field__chevron"
          :class="{ 'receive-field__chevron--open': open }"
        />
      </button>

      <div
        v-if="open"
        :id="listId"
        class="receive-field__list"
        role="listbox"
        :aria-labelledby="labelId"
        @keydown="onListKeydown"
      >
        <button
          v-for="entry in entries"
          :key="entry.id"
          type="button"
          role="option"
          class="receive-field__option"
          :class="{
            'receive-field__option--selected': entry.id === selected.id,
            'receive-field__option--unusable': !entry.usable
          }"
          :aria-selected="entry.id === selected.id ? 'true' : 'false'"
          :aria-disabled="entry.usable ? undefined : 'true'"
          tabindex="-1"
          @click="choose(entry)"
        >
          <span class="receive-field__tile" aria-hidden="true">
            <Icon :icon="walletIcon(entry.type)" width="18" height="18" />
          </span>
          <span class="receive-field__copy">
            <strong>{{ entry.name }}</strong>
            <small>{{ entry.detail }}</small>
            <small v-if="entry.reason" class="receive-field__reason">{{ entry.reason }}</small>
          </span>
          <Icon
            v-if="entry.id === selected.id"
            icon="tabler:check"
            width="18"
            height="18"
            class="receive-field__check"
          />
        </button>
      </div>
    </template>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue'
import './chatTokens.css'

export default {
  name: 'ReceiveWalletField',
  components: { Icon },
  props: {
    entries: { type: Array, default: () => [] },
    /** Id of the selected wallet. */
    modelValue: { type: String, default: null },
    disabled: { type: Boolean, default: false }
  },
  emits: ['update:modelValue'],
  data() {
    return { open: false }
  },
  computed: {
    labelId() { return `receive-label-${this.$.uid}` },
    listId() { return `receive-list-${this.$.uid}` },
    valueId() { return `receive-value-${this.$.uid}` },
    choosable() { return this.entries.length >= 2 },
    /** A missing or stale id falls back to the first wallet that can receive. */
    selected() {
      return this.entries.find((e) => e.id === this.modelValue)
        || this.entries.find((e) => e.usable)
        || this.entries[0]
        || null
    }
  },
  watch: {
    choosable(v) { if (!v) this.open = false },
    disabled(v) { if (v) this.open = false }
  },
  methods: {
    walletIcon(type) {
      if (type === 'nwc') return 'tabler:plug-connected'
      if (type === 'lnbits') return 'tabler:server'
      return 'tabler:wallet'
    },
    toggle() {
      if (this.disabled) return
      if (this.open) this.close(true)
      else this.openList()
    },
    openList() {
      if (this.disabled || !this.choosable) return
      this.open = true
      this.$nextTick(() => {
        const target = this.$el?.querySelector?.('.receive-field__option--selected')
          || this.$el?.querySelector?.('[role="option"]')
        target?.focus?.()
      })
    },
    close(refocus = false) {
      this.open = false
      if (refocus) this.$nextTick(() => this.$refs.field?.focus?.())
    },
    /** A wallet that cannot receive can be looked at but never picked. */
    choose(entry) {
      if (!entry?.usable || this.disabled) return
      if (entry.id !== this.selected?.id) this.$emit('update:modelValue', entry.id)
      this.close(true)
    },
    onListKeydown(event) {
      if (event.key === 'Escape') {
        // The sheet must not close with the list.
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
.receive-field { display: flex; flex-direction: column; gap: 6px; font-family: 'Manrope', sans-serif; }

.receive-field__label {
  padding: 0 4px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--text-secondary);
}

.receive-field__cell {
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
  font-family: inherit;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
button.receive-field__cell { cursor: pointer; }
button.receive-field__cell:disabled { cursor: default; opacity: 0.6; }
button.receive-field__cell:active:not(:disabled),
.receive-field--open .receive-field__cell { background: var(--brand-accent-soft); }

.receive-field__tile {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: var(--brand-accent-text);
  background: var(--brand-accent-soft);
}
.receive-field--open .receive-field__cell .receive-field__tile,
.receive-field__option--selected .receive-field__tile { background: var(--bg-card); }

.receive-field__copy { min-width: 0; flex: 1; }
.receive-field__copy strong,
.receive-field__copy small { display: block; }
.receive-field__copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.90625rem;
  font-weight: 650;
}
.receive-field__copy small { margin-top: 2px; font-size: 0.75rem; line-height: 1.35; color: var(--text-secondary); }
.receive-field__copy .receive-field__reason { font-weight: 600; color: var(--color-warn); }

.receive-field__chevron { flex: 0 0 auto; color: var(--text-muted); transition: transform 0.16s ease; }
.receive-field__chevron--open { transform: rotate(180deg); }
.receive-field__check { flex: 0 0 auto; color: var(--brand-accent-text); }

.receive-field__list {
  max-height: min(264px, 34dvh);
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}
.receive-field__option {
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
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.receive-field__option:last-child { border-bottom: 0; }
.receive-field__option:active:not(.receive-field__option--unusable),
.receive-field__option--selected { background: var(--brand-accent-soft); }
.receive-field__option--unusable { cursor: not-allowed; }
.receive-field__option--unusable .receive-field__tile,
.receive-field__option--unusable .receive-field__copy strong { opacity: 0.55; }

.receive-field__cell:focus-visible,
.receive-field__option:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: -2px; }

@media (prefers-reduced-motion: reduce) {
  .receive-field__chevron { transition: none; }
}
</style>
