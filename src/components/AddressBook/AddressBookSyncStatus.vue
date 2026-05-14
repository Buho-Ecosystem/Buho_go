<template>
  <!-- Renders only when there is something to sync. A wallet with
       zero Nostr contacts never sees this row at all — the sync
       layer is invisible until it's relevant. -->
  <button
    v-if="hasNostrContacts"
    type="button"
    class="ab-sync"
    :class="[
      $q.dark.isActive ? 'ab-sync--dark' : 'ab-sync--light',
      `ab-sync--${tone}`,
    ]"
    :disabled="store.isSyncing"
    @click="onTap"
  >
    <q-spinner v-if="store.isSyncing" size="13px" class="ab-sync__icon" />
    <Icon v-else :icon="icon" width="13" height="13" class="ab-sync__icon" />
    <span class="ab-sync__label">{{ label }}</span>
  </button>
</template>

<script>
/**
 * One-line sync status for the address book.
 *
 * Reads the addressBook store directly (it's a singleton) and reflects
 * exactly one of five states — never a panel, never a stack of
 * banners. The whole row is the tap target: tapping retries / forces
 * a sync, which is the only manual control a normal user ever needs.
 * Power-user "pull from Nostr" lives in the page's kebab menu, not
 * here, so this row stays a single calm line.
 *
 * State precedence (top wins):
 *   1. isSyncing       → "Syncing contacts…"           (spinner)
 *   2. lastSyncError   → "Couldn't sync — tap to retry" (warn)
 *   3. syncDirty       → "Changes waiting to sync"      (muted)
 *   4. lastSyncedAt    → "Synced {relative}"            (calm/ok)
 *   5. none of above   → "Not backed up yet — tap to sync"
 *
 * The component owns no network logic — tapping emits `sync` and the
 * page (which holds the identity store) performs the actual publish.
 */
import { useAddressBookStore } from '../../stores/addressBook';
import { formatRelativeTime } from '../../utils/timeFormatting';

export default {
  name: 'AddressBookSyncStatus',

  emits: ['sync'],

  setup() {
    return { store: useAddressBookStore() };
  },

  computed: {
    hasNostrContacts() {
      return this.store.nostrEntries.length > 0;
    },

    tone() {
      if (this.store.isSyncing) return 'progress';
      if (this.store.lastSyncError) return 'error';
      if (this.store.syncDirty) return 'pending';
      if (this.store.lastSyncedAt) return 'ok';
      return 'pending';
    },

    icon() {
      switch (this.tone) {
        case 'error':   return 'tabler:cloud-x';
        case 'pending': return 'tabler:cloud-up';
        case 'ok':      return 'tabler:cloud-check';
        default:        return 'tabler:cloud';
      }
    },

    label() {
      if (this.store.isSyncing) return this.$t('Syncing contacts…');
      if (this.store.lastSyncError) return this.$t('Couldn\'t sync. Tap to retry.');
      if (this.store.syncDirty) {
        return this.store.lastSyncedAt
          ? this.$t('Changes waiting to sync')
          : this.$t('Not backed up yet. Tap to sync.');
      }
      if (this.store.lastSyncedAt) {
        return this.$t('Synced {when}', {
          when: formatRelativeTime(Math.floor(this.store.lastSyncedAt / 1000)),
        });
      }
      return this.$t('Not backed up yet. Tap to sync.');
    },
  },

  methods: {
    onTap() {
      if (this.store.isSyncing) return;
      this.$emit('sync');
    },
  },
};
</script>

<style scoped>
.ab-sync {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;
  margin: 0.5rem 0 0.25rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-card);
  background: transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.ab-sync:disabled {
  cursor: default;
}

.ab-sync__icon {
  flex-shrink: 0;
}

.ab-sync__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Tones — kept deliberately low-contrast. The OK state is the most
   common one a user sees, so it must read as calm background
   reassurance, not a coloured badge demanding attention. */
.ab-sync--ok {
  color: var(--text-muted);
}

.ab-sync--progress {
  color: var(--text-secondary);
}

.ab-sync--pending {
  color: var(--text-secondary);
}

.ab-sync--error {
  color: #C97A0F;
  border-color: rgba(201, 122, 15, 0.35);
}

.ab-sync--light:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.04);
}

.ab-sync--dark:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}
</style>
