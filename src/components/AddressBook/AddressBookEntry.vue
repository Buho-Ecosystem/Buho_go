<template>
  <!--
    A split payee row, the way App Store rows split: tapping the ROW
    navigates to the contact's page, and the capsule button on the
    right performs the primary action (pay) with its own distinct hit
    target. Two zones, one row, no chevron — the capsule anchors the
    right edge. No badges, no action clusters.
  -->
  <div
    class="payee-row"
    role="button"
    tabindex="0"
    :aria-label="entry.name"
    @click="$emit('open', entry)"
    @keydown.enter.prevent="$emit('open', entry)"
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
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.payee-addr {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.payee-addr--plain {
  font-family: 'Manrope', sans-serif;
  font-size: 11.5px;
}

/* The capsule action, App Store style: its own pressable target on
   the row's right edge, visually distinct from the navigation row. */
.payee-pay {
  flex: 0 0 auto;
  min-height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
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
