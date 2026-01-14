<template>
  <div
    class="address-entry"
    :class="$q.dark.isActive ? 'address-entry-dark' : 'address-entry-light'"
    @click="$emit('pay', entry)"
  >
    <!-- Avatar -->
    <div class="entry-avatar" @click.stop="$emit('change-color', entry)">
      <div
        class="avatar-circle"
        :style="{ backgroundColor: entry.color }"
      >
        <span class="avatar-initial">{{ getInitial(entry.name) }}</span>
      </div>
    </div>

    <!-- Entry Details -->
    <div class="entry-details">
      <div class="entry-name-row">
        <div class="entry-name" :class="$q.dark.isActive ? 'entry-name-dark' : 'entry-name-light'">
          {{ entry.name }}
        </div>
        <div class="address-type-badge" :class="addressTypeBadgeClass">
          <q-icon :name="addressTypeIcon" size="10px" />
          <span>{{ addressTypeLabel }}</span>
        </div>
      </div>
      <div class="entry-address" :class="$q.dark.isActive ? 'entry-address-dark' : 'entry-address-light'">
        {{ truncatedAddress }}
      </div>
    </div>

    <!-- Actions -->
    <div class="entry-actions" :class="{ 'actions-visible': isTouchDevice }">
      <q-btn
        flat
        round
        dense
        icon="las la-pen"
        @click.stop="$emit('edit', entry)"
        class="action-btn"
        :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
        size="sm"
      >
        <q-tooltip>{{ $t('Edit') }}</q-tooltip>
      </q-btn>

      <q-btn
        flat
        round
        dense
        icon="las la-copy"
        @click.stop="copyAddress"
        class="action-btn"
        :class="$q.dark.isActive ? 'action-btn-dark' : 'action-btn-light'"
        size="sm"
      >
        <q-tooltip>{{ $t('Copy') }}</q-tooltip>
      </q-btn>

      <q-btn
        flat
        round
        dense
        icon="las la-trash-alt"
        @click.stop="$emit('delete', entry)"
        class="action-btn action-btn-danger"
        size="sm"
      >
        <q-tooltip>{{ $t('Delete') }}</q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<script>
export default {
  name: 'AddressBookEntry',
  props: {
    entry: {
      type: Object,
      required: true
    }
  },
  emits: ['edit', 'delete', 'change-color', 'pay'],
  data() {
    return {
      isTouchDevice: false
    }
  },
  computed: {
    addressType() {
      return this.entry.addressType || 'lightning'
    },
    displayAddress() {
      return this.entry.address || this.entry.lightningAddress || ''
    },
    truncatedAddress() {
      const address = this.displayAddress
      if (!address) return ''

      // For short addresses (like lightning addresses user@domain.com), show full
      if (address.length <= 30) return address

      // For long addresses (like Spark addresses), truncate in the middle
      const start = address.slice(0, 12)
      const end = address.slice(-10)
      return `${start}...${end}`
    },
    addressTypeIcon() {
      return this.addressType === 'spark' ? 'las la-fire' : 'las la-bolt'
    },
    addressTypeLabel() {
      return this.addressType === 'spark' ? 'Spark' : 'Lightning'
    },
    addressTypeBadgeClass() {
      return this.addressType === 'spark'
        ? 'badge-spark'
        : 'badge-lightning'
    }
  },
  mounted() {
    // Detect touch device
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  },
  methods: {
    getInitial(name) {
      return name ? name.charAt(0).toUpperCase() : '?'
    },

    async copyAddress() {
      try {
        await navigator.clipboard.writeText(this.displayAddress)
        this.$q.notify({
          type: 'positive',
          message: this.$t('Address copied'),
          position: 'bottom',
          timeout: 2000
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t copy'),
          position: 'bottom'
        })
      }
    }
  }
}
</script>

<style scoped>
.address-entry {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1rem;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.address-entry-dark {
  background: #1A1A1A;
}

.address-entry-light {
  background: #FFF;
}

.address-entry-dark:hover {
  background: #222;
}

.address-entry-light:hover {
  background: #F9FAFB;
}

/* Avatar */
.entry-avatar {
  flex-shrink: 0;
}

.avatar-circle {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-initial {
  color: white;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

/* Entry Details */
.entry-details {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.entry-name-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.125rem;
}

.entry-name {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-name-dark {
  color: #F6F6F6;
}

.entry-name-light {
  color: #212121;
}

/* Address Type Badge */
.address-type-badge {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.125rem 0.4rem;
  border-radius: 6px;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.badge-lightning {
  background: linear-gradient(135deg, #F59E0B, #D97706);
  color: white;
}

.badge-spark {
  background: linear-gradient(135deg, #15DE72, #059573);
  color: white;
}

/* Address */
.entry-address {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-address-dark {
  color: #777;
}

.entry-address-light {
  color: #9CA3AF;
}

/* Actions */
.entry-actions {
  display: flex;
  gap: 0.25rem;
  opacity: 0;
  transition: opacity 0.15s ease;
  flex-shrink: 0;
}

.address-entry:hover .entry-actions,
.entry-actions.actions-visible {
  opacity: 1;
}

.action-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  transition: all 0.15s ease;
}

.action-btn-dark {
  color: #666;
}

.action-btn-light {
  color: #9CA3AF;
}

.action-btn-dark:hover {
  background: rgba(21, 222, 114, 0.1);
  color: #15DE72;
}

.action-btn-light:hover {
  background: rgba(21, 222, 114, 0.1);
  color: #15DE72;
}

.action-btn-danger {
  color: #777;
}

.action-btn-danger:hover {
  background: rgba(239, 68, 68, 0.1) !important;
  color: #EF4444 !important;
}

/* Responsive - Tablet and smaller */
@media (max-width: 768px) {
  .entry-actions {
    opacity: 1;
  }
}

/* Responsive - Mobile */
@media (max-width: 480px) {
  .address-entry {
    padding: 0.75rem;
    gap: 0.75rem;
    border-radius: 10px;
  }

  .avatar-circle {
    width: 40px;
    height: 40px;
  }

  .avatar-initial {
    font-size: 15px;
  }

  .entry-name {
    font-size: 14px;
  }

  .entry-address {
    font-size: 11px;
  }

  .address-type-badge {
    font-size: 8px;
    padding: 0.1rem 0.35rem;
  }

  .entry-actions {
    opacity: 1;
    flex-direction: column;
    gap: 0.125rem;
  }

  .action-btn {
    width: 28px;
    height: 28px;
  }
}

/* Extra small screens */
@media (max-width: 360px) {
  .entry-name-row {
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .entry-address {
    font-size: 10px;
  }
}
</style>
