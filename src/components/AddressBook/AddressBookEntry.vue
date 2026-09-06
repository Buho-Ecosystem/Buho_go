<template>
  <!--
    A payee row. The whole row is the Pay action (a wallet contact's
    first job is being paid) and says so with one quiet chip; the info
    glyph is the HIG detail disclosure — the row acts, the glyph opens
    the contact's profile page where everything else lives (favorite,
    copy, edit, remove, history). No badges, no action clusters.
  -->
  <button
    type="button"
    class="payee-row"
    @click="$emit('pay', entry)"
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
           current address. Calm, not an error — the tap still works,
           it explains and re-checks. -->
      <span v-else class="payee-addr payee-addr--plain">{{ $t('No address yet') }}</span>
    </span>

    <span v-if="isPayable" class="payee-chip" aria-hidden="true">{{ $t('Pay') }}</span>

    <span
      class="payee-info"
      role="button"
      :aria-label="$t('Details')"
      @click.stop="$emit('open', entry)"
      @keydown.enter.stop.prevent="$emit('open', entry)"
      tabindex="0"
    >
      <Icon icon="tabler:info-circle" width="16" height="16" />
    </span>
  </button>
</template>

<script>
import { Icon } from '@iconify/vue'
import ContactAvatar from './ContactAvatar.vue'

export default {
  name: 'AddressBookEntry',
  components: { Icon, ContactAvatar },
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

.payee-chip {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.04em;
  color: var(--brand-accent-text, var(--color-green));
  background: var(--brand-accent-soft);
  border-radius: 999px;
  padding: 6px 12px;
}

/* HIG detail disclosure: tapping the row pays, tapping this opens the
   contact. Rendered as a span so the row stays one <button>. */
.payee-info {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  flex: 0 0 auto;
  cursor: pointer;
}

.payee-info:active {
  background: rgba(127, 127, 127, 0.12);
}
</style>
