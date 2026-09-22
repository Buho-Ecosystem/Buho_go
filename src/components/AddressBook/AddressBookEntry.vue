<template>
  <!--
    A split payee row: tapping the ROW navigates to the contact's
    page, and the capsule button on the right performs the primary
    action (pay) with its own distinct hit target. Two zones, one
    row, no chevron — the capsule anchors the right edge. No badges,
    no action clusters.
  -->
  <div class="payee-row">
    <button
      type="button"
      class="payee-open"
      :aria-label="entry.name"
      @click="$emit('open', entry)"
    >
      <!-- Avatar — real picture for nostr-sourced contacts, the
           app-wide grey silhouette otherwise. -->
      <ContactAvatar
        class="payee-avatar"
        :entry="entry"
      />

      <span class="payee-copy">
        <span class="payee-name">{{ entry.name }}</span>
        <span v-if="isPayable" class="payee-addr">{{ truncatedAddress }}</span>
        <!-- Identity-only Nostr contact: saved (or restored) without a
             current address. Calm, not an error — their page explains
             and re-checks. -->
        <span v-else class="payee-addr payee-addr--plain">{{ $t('No address yet') }}</span>
      </span>

    </button>

    <button
      v-if="isPayable"
      type="button"
      class="payee-pay"
      :aria-label="$t('Pay {name}', { name: entry.name })"
      @click.stop="$emit('pay', entry)"
    >
      {{ $t('Pay') }}
    </button>
  </div>
</template>

<script>
import ContactAvatar from './ContactAvatar.vue'
import { serviceAddressLine } from '../../utils/lnurlMetadata.js'

export default {
  name: 'AddressBookEntry',
  components: { ContactAvatar },
  props: {
    entry: {
      type: Object,
      required: true
    }
  },
  emits: ['pay', 'open'],
  computed: {
    displayAddress() {
      return this.entry.address || this.entry.lightningAddress || ''
    },
    /**
     * Whether this entry has a usable payment destination right now.
     * The only entries this flags false are identity-only Nostr
     * contacts whose `address` hasn't been resolved yet.
     */
    isPayable() {
      return !!this.displayAddress
    },
    truncatedAddress() {
      const address = this.displayAddress
      if (!address) return ''
      // A service pay link (LUD-11) is a bech32 blob nobody reads: say
      // where it points and what it is instead.
      if (this.entry.addressType === 'lnurl') return serviceAddressLine(address, this.$t)
      // Short addresses (user@domain.com) show whole; long strings
      // (Spark, on-chain) truncate in the middle, domain-preserving.
      if (address.length <= 34) return address
      const start = address.slice(0, 12)
      const end = address.slice(-10)
      return `${start}…${end}`
    }
  }
}
</script>

<style scoped>
.payee-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  flex-wrap: wrap;
  min-height: 62px;
  padding: 10px 2px;
  border: 0;
  background: none;
  text-align: left;
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.payee-open {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1 1 10rem;
  min-width: 0;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.payee-open:focus-visible,
.payee-pay:focus-visible {
  outline: 2px solid var(--brand-accent);
  outline-offset: 2px;
  border-radius: 8px;
}

.payee-row + .payee-row {
  border-top: 1px solid var(--border-card);
}

.payee-row:active {
  background: rgba(127, 127, 127, 0.06);
}

.payee-avatar {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
}

.payee-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.payee-name {
  font-size: 0.9375rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}

.payee-addr {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.payee-addr--plain {
  font-family: 'Manrope', sans-serif;
  font-size: 0.71875rem;
}

/* The capsule action: its own pressable target on the row's right
   edge, visually distinct from the navigation row. */
.payee-pay {
  flex: 0 0 auto;
  margin-left: auto;
  min-height: 44px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 0.75rem;
  font-weight: 750;
  letter-spacing: 0.04em;
  color: var(--brand-accent-text, var(--color-green));
  background: var(--brand-accent-soft);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.1s ease;
}

.payee-pay:active {
  transform: scale(0.95);
}
</style>
