<template>
  <div
    class="contact-card-entry"
    :class="$q.dark.isActive ? 'contact-card-dark' : 'contact-card-light'"
    @click="$emit('pay', entry)"
  >
    <!-- Avatar -->
    <div
      class="contact-avatar"
      :style="{ backgroundColor: entry.color }"
      @click.stop="$emit('change-color', entry)"
    >
      <span class="avatar-initial">{{ getInitial(entry.name) }}</span>
    </div>

    <!-- Entry Details -->
    <div class="contact-details">
      <div class="contact-name-row">
        <div class="contact-name" :class="$q.dark.isActive ? 'contact-name-dark' : 'contact-name-light'">
          {{ entry.name }}
        </div>
        <div class="address-type-badge" :class="addressTypeBadgeClass">
          <img v-if="addressType === 'spark'" width="10" height="10"
            :src="$q.dark.isActive ? '/Spark/Spark Asterisk White.svg' : '/Spark/Spark Asterisk Black.svg'"
            alt="Spark"
          />
          <Icon v-else :icon="addressTypeIcon" width="10" height="10" />
          <span>{{ addressTypeLabel }}</span>
        </div>
      </div>
      <div class="contact-address" :class="$q.dark.isActive ? 'contact-address-dark' : 'contact-address-light'">
        {{ truncatedAddress }}
      </div>
      <!-- Notes Preview -->
      <div v-if="entry.notes" class="contact-notes" :class="$q.dark.isActive ? 'contact-notes-dark' : 'contact-notes-light'">
        {{ truncatedNotes }}
      </div>
    </div>

    <!-- Actions: Star + 3-dot menu -->
    <div class="contact-actions">
      <!-- Star Toggle -->
      <q-btn
        flat
        round
        dense
        @click.stop="$emit('toggle-favorite', entry)"
        class="star-btn"
        :class="entry.isFavorite ? 'is-favorite' : ''"
        size="sm"
      >
        <Icon :icon="entry.isFavorite ? 'tabler:star-filled' : 'tabler:star'" width="16" height="16" />
        <q-tooltip>{{ entry.isFavorite ? $t('Remove from favorites') : $t('Add to favorites') }}</q-tooltip>
      </q-btn>

      <!-- 3-dot Overflow Menu -->
      <q-btn
        flat
        round
        dense
        @click.stop
        class="overflow-menu-btn"
        :class="$q.dark.isActive ? 'overflow-btn-dark' : 'overflow-btn-light'"
        size="sm"
      >
        <Icon icon="tabler:dots-vertical" width="16" height="16" />
        <q-menu
          :class="$q.dark.isActive ? 'overflow-menu-dark' : 'overflow-menu-light'"
          anchor="bottom right"
          self="top right"
        >
          <q-list style="min-width: 160px">
            <q-item clickable v-close-popup @click.stop="$emit('edit', entry)">
              <q-item-section avatar style="min-width: 32px;">
                <Icon icon="tabler:pencil" width="14" height="14" style="color: var(--text-secondary)" />
              </q-item-section>
              <q-item-section>
                <q-item-label :class="$q.dark.isActive ? 'menu-label-dark' : 'menu-label-light'">{{ $t('Edit') }}</q-item-label>
              </q-item-section>
            </q-item>

            <q-item clickable v-close-popup @click.stop="$emit('copy-address', entry)">
              <q-item-section avatar style="min-width: 32px;">
                <Icon icon="tabler:copy" width="14" height="14" style="color: var(--text-secondary)" />
              </q-item-section>
              <q-item-section>
                <q-item-label :class="$q.dark.isActive ? 'menu-label-dark' : 'menu-label-light'">{{ $t('Copy Address') }}</q-item-label>
              </q-item-section>
            </q-item>

            <q-separator :class="$q.dark.isActive ? 'separator-dark' : 'separator-light'" />

            <q-item clickable v-close-popup @click.stop="$emit('delete', entry)">
              <q-item-section avatar style="min-width: 32px;">
                <Icon icon="tabler:trash" width="14" height="14" style="color: #EF4444" />
              </q-item-section>
              <q-item-section>
                <q-item-label style="color: #EF4444;">{{ $t('Delete') }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-menu>
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
  emits: ['edit', 'delete', 'change-color', 'pay', 'toggle-favorite', 'copy-address'],
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
    truncatedNotes() {
      const notes = this.entry.notes || ''
      if (notes.length <= 40) return notes
      return notes.slice(0, 40) + '...'
    },
    addressTypeIcon() {
      const icons = {
        lightning: 'tabler:bolt',
        spark: 'tabler:flame',
        bitcoin: 'tabler:currency-bitcoin'
      }
      return icons[this.addressType] || icons.lightning
    },
    addressTypeLabel() {
      const labels = {
        lightning: 'Lightning',
        spark: 'Spark',
        bitcoin: 'Bitcoin'
      }
      return labels[this.addressType] || labels.lightning
    },
    addressTypeBadgeClass() {
      const classes = {
        lightning: 'badge-lightning',
        spark: 'badge-spark',
        bitcoin: 'badge-bitcoin'
      }
      return classes[this.addressType] || classes.lightning
    }
  },
  methods: {
    getInitial(name) {
      return name ? name.charAt(0).toUpperCase() : '?'
    }
  }
}
</script>

<style scoped>
/* Contact Card Entry */
.contact-card-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--radius-lg);
  transition: background 0.15s ease;
  cursor: pointer;
  margin-bottom: 4px;
}

.contact-card-dark {
  background: var(--bg-card);
}

.contact-card-light {
  background: #FFF;
}

.contact-card-dark:hover {
  background: #222;
}

.contact-card-light:hover {
  background: #F9FAFB;
}

/* Avatar */
.contact-avatar {
  width: 48px;
  height: 48px;
  min-width: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 16px;
  color: #FFF;
  flex-shrink: 0;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.contact-avatar:hover {
  transform: scale(1.05);
}

.avatar-initial {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 600;
}

/* Details */
.contact-details {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.contact-name-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.125rem;
}

.contact-name {
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-name-dark {
  color: var(--text-primary);
}

.contact-name-light {
  color: #212121;
}

/* Address Type Badge */
.address-type-badge {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.125rem 0.4rem;
  border-radius: 6px;
  font-family: 'Manrope', sans-serif;
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
  background: #000;
  color: white;
}

.badge-bitcoin {
  background: linear-gradient(135deg, #F7931A, #E67E00);
  color: white;
}

/* Address */
.contact-address {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-address-dark {
  color: var(--text-muted);
}

.contact-address-light {
  color: #9CA3AF;
}

/* Notes */
.contact-notes {
  font-family: 'Manrope', sans-serif;
  font-size: 11px;
  font-style: italic;
  margin-top: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-notes-dark {
  color: #555;
}

.contact-notes-light {
  color: #9CA3AF;
}

/* Actions (Star + Overflow) */
.contact-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}

/* Star Button */
.star-btn {
  color: var(--text-muted);
  transition: color 0.15s ease;
  width: 32px;
  height: 32px;
}

.star-btn.is-favorite {
  color: var(--color-green);
}

.star-btn:hover {
  color: var(--color-green);
}

/* Overflow Menu Button */
.overflow-menu-btn {
  width: 32px;
  height: 32px;
  transition: all 0.15s ease;
}

.overflow-btn-dark {
  color: var(--text-muted);
}

.overflow-btn-light {
  color: #9CA3AF;
}

.overflow-btn-dark:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
}

.overflow-btn-light:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #6B7280;
}

/* Overflow Menu Styles */
.overflow-menu-dark :deep(.q-list) {
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-md);
  padding: 4px 0;
}

.overflow-menu-light :deep(.q-list) {
  background: #FFF;
  border: 1px solid #E5E7EB;
  border-radius: var(--radius-md);
  padding: 4px 0;
}

.menu-label-dark {
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
}

.menu-label-light {
  color: #212121;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
}

.separator-dark {
  background: var(--border-card) !important;
}

.separator-light {
  background: #F0F0F0 !important;
}

/* Responsive - Mobile */
@media (max-width: 480px) {
  .contact-card-entry {
    padding: 10px 12px;
    gap: 10px;
    border-radius: 16px;
  }

  .contact-avatar {
    width: 42px;
    height: 42px;
    min-width: 42px;
  }

  .avatar-initial {
    font-size: 15px;
  }

  .contact-name {
    font-size: 14px;
  }

  .contact-address {
    font-size: 11px;
  }

  .address-type-badge {
    font-size: 8px;
    padding: 0.1rem 0.35rem;
  }
}

/* Extra small screens */
@media (max-width: 360px) {
  .contact-name-row {
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .contact-address {
    font-size: 10px;
  }
}
</style>
