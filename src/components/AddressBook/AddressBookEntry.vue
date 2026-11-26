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
      :aria-label="openLabel"
      @click="$emit('open', entry)"
    >
      <!-- Avatar: their picture, else the first character of their name. -->
      <span class="payee-avatar-wrap">
        <ContactAvatar
          class="payee-avatar"
          :entry="entry"
        />
        <!-- Unread chat messages: a pin on the avatar's corner, so the
             row keeps its layout. -->
        <span v-if="unread > 0" class="payee-unread" aria-hidden="true">{{ unreadBadge }}</span>
      </span>

      <span class="payee-copy">
        <span class="payee-name">{{ entry.name }}</span>
        <!-- How they are paid, then when they last were; their address
             until the first payment. -->
        <span v-if="isPayable" class="payee-sub">
          <PaymentMark :address-type="entry.addressType" :address="displayAddress" :size="12" />
          <span v-if="lastPaidLabel" class="payee-paid">{{ lastPaidLabel }}</span>
          <span v-else class="payee-addr">{{ truncatedAddress }}</span>
        </span>
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
import PaymentMark from '../PaymentMark.vue'
import { serviceAddressLine } from '../../utils/lnurlMetadata.js'

export default {
  name: 'AddressBookEntry',
  components: { ContactAvatar, PaymentMark },
  props: {
    entry: {
      type: Object,
      required: true
    },
    /** Unread chat messages from this contact (0: no badge). */
    unread: {
      type: Number,
      default: 0
    }
  },
  emits: ['pay', 'open'],
  computed: {
    unreadBadge() {
      return this.unread > 99 ? '99+' : String(this.unread)
    },
    openLabel() {
      const parts = [this.entry.name]
      if (this.unread > 0) parts.push(`${this.$t('New messages')}: ${this.unread}`)
      if (this.isPayable && this.lastPaidLabel) parts.push(this.lastPaidLabel)
      return parts.join(', ')
    },
    /**
     * When they were last paid (addressBook.recordPayment owns the date):
     * today, yesterday, else the day, with the year once it is not this one.
     */
    lastPaidLabel() {
      const at = Number(this.entry.lastPaidAt) || 0
      if (!at) return ''
      const paid = new Date(at)
      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      const startOfYesterday = new Date(startOfToday)
      startOfYesterday.setDate(startOfYesterday.getDate() - 1)
      if (at >= startOfToday.getTime()) return this.$t('Last paid today')
      if (at >= startOfYesterday.getTime()) return this.$t('Last paid yesterday')
      const sameYear = paid.getFullYear() === startOfToday.getFullYear()
      try {
        const date = new Intl.DateTimeFormat(this.$i18n?.locale || undefined, {
          day: 'numeric',
          month: 'short',
          ...(sameYear ? {} : { year: 'numeric' }),
        }).format(paid)
        return this.$t('Last paid {date}', { date })
      } catch {
        return this.$t('Last paid {date}', { date: paid.toLocaleDateString() })
      }
    },
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

.payee-avatar-wrap {
  position: relative;
  display: flex;
  flex-shrink: 0;
}

.payee-unread {
  position: absolute;
  top: -4px;
  right: -6px;
  min-width: 18px;
  height: 17px;
  padding: 0 5px;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  border: 2px solid var(--bg-primary);
  border-radius: 999px;
  background: var(--brand-accent);
  color: #04150b;
  font: 800 9px/1 'Manrope', sans-serif;
  pointer-events: none;
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

.payee-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.payee-paid {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.payee-addr {
  min-width: 0;
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
