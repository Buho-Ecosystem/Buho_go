<template>
  <div 
    class="address-entry"
    :class="$q.dark.isActive ? 'address-entry-dark' : 'address-entry-light'"
    @click="$emit('edit', entry)"
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
      <div class="entry-name" :class="$q.dark.isActive ? 'entry-name-dark' : 'entry-name-light'">
        {{ entry.name }}
      </div>
      <div class="entry-address" :class="$q.dark.isActive ? 'entry-address-dark' : 'entry-address-light'">
        {{ entry.lightningAddress }}
      </div>
    </div>

    <!-- Actions -->
    <div class="entry-actions">
      <q-btn
        flat
        round
        dense
        icon="las la-copy"
        @click.stop="copyAddress"
        class="copy-btn"
        :class="$q.dark.isActive ? 'copy-btn-dark' : 'copy-btn-light'"
        size="sm"
      >
        <q-tooltip>{{ $t('Copy address') }}</q-tooltip>
      </q-btn>
      
      <q-btn
        flat
        round
        dense
        icon="las la-trash"
        @click.stop="$emit('delete', entry)"
        class="delete-btn"
        :class="$q.dark.isActive ? 'delete-btn-dark' : 'delete-btn-light'"
        size="sm"
      >
        <q-tooltip>{{ $t('Delete entry') }}</q-tooltip>
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
  emits: ['edit', 'delete', 'change-color'],
  methods: {
    getInitial(name) {
      return name ? name.charAt(0).toUpperCase() : '?'
    },

    async copyAddress() {
      try {
        await navigator.clipboard.writeText(this.entry.lightningAddress)
        this.$q.notify({
          type: 'positive',
          message: this.$t('Address copied to clipboard!'),
          position: 'bottom',
          timeout: 2000
        })
      } catch (error) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Failed to copy address'),
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
  gap: 1rem;
  padding: 1rem;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid;
  margin-bottom: 0.75rem;
}

.address-entry-dark {
  background: #0C0C0C;
  border-color: #2A342A;
}

.address-entry-light {
  background: #FFF;
  border-color: #E5E7EB;
}

.address-entry-dark:hover {
  background: #171717;
  border-color: #15DE72;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(21, 222, 114, 0.15);
}

.address-entry-light:hover {
  background: #F9FAFB;
  border-color: #15DE72;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(21, 222, 114, 0.15);
}

.entry-avatar {
  cursor: pointer;
  transition: transform 0.2s ease;
}

.entry-avatar:hover {
  transform: scale(1.05);
}

.avatar-circle {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: box-shadow 0.2s ease;
}

.avatar-circle:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.avatar-initial {
  color: white;
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 18px;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.entry-details {
  flex: 1;
  min-width: 0;
}

.entry-name {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 0.25rem;
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

.entry-address {
  font-family: Fustat, 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-address-dark {
  color: #B0B0B0;
}

.entry-address-light {
  color: #6B7280;
}

.entry-actions {
  display: flex;
  gap: 0.5rem;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.address-entry:hover .entry-actions {
  opacity: 1;
}

.copy-btn,
.delete-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.copy-btn-dark {
  color: #B0B0B0;
}

.copy-btn-light {
  color: #6B7280;
}

.copy-btn-dark:hover {
  background: rgba(21, 222, 114, 0.1);
  color: #15DE72;
}

.copy-btn-light:hover {
  background: rgba(21, 222, 114, 0.1);
  color: #15DE72;
}

.delete-btn-dark {
  color: #B0B0B0;
}

.delete-btn-light {
  color: #6B7280;
}

.delete-btn-dark:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #EF4444;
}

.delete-btn-light:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #EF4444;
}

/* Mobile Responsive */
@media (max-width: 480px) {
  .address-entry {
    padding: 0.75rem;
    gap: 0.75rem;
  }

  .avatar-circle {
    width: 40px;
    height: 40px;
  }

  .avatar-initial {
    font-size: 16px;
  }

  .entry-name {
    font-size: 15px;
  }

  .entry-address {
    font-size: 13px;
  }

  .entry-actions {
    opacity: 1; /* Always show on mobile */
  }

  .copy-btn,
  .delete-btn {
    width: 28px;
    height: 28px;
  }
}
</style>