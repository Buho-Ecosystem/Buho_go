<template>
  <!--
    Switch identity, opened from the photo on the card.

    Same orchestration as the sheet this replaces (which lived, of all
    places, in the Address Book kebab menu): the outgoing contact book is
    flushed before the identity changes and the incoming one is pulled after,
    and creating a new identity asks the one question that matters first.

    Contact counts are shown only for the identity in use. The others are not
    loaded, and inventing a number for them would be worse than showing none.
  -->
  <q-dialog v-model="open" position="bottom" :persistent="busy" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
    <q-card class="switch-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-grab" aria-hidden="true"><span></span></div>

      <template v-if="step === 'list'">
        <div class="sheet-head">
          <div class="sheet-title">{{ $t('Switch identity') }}</div>
          <q-btn flat round dense :disable="busy" :aria-label="$t('Close')" @click="open = false">
            <Icon icon="tabler:x" width="18" height="18" />
          </q-btn>
        </div>

        <div class="sheet-body">
          <IdentityGroup>
            <IdentityRow
              v-for="row in identities"
              :key="row.account"
              :label="identityName(row)"
              :caption="row.active ? $t('{n} contacts', { n: contactCount }) : ''"
              :chip="row.active ? $t('In use') : ''"
              :chip-tone="row.active ? 'ok' : 'mute'"
              :chevron="!row.active"
              icon="tabler:user"
              :tone="row.active ? 'accent' : 'neutral'"
              @click="onPickIdentity(row)"
            />
          </IdentityGroup>

          <IdentityGroup class="switch-add">
            <IdentityRow
              icon="tabler:plus"
              :label="$t('Add an identity')"
              :caption="$t('For a shop, a stage name, a second life')"
              @click="step = 'create'"
            />
          </IdentityGroup>

          <p class="sheet-foot">{{ $t('Your wallets and balances do not change when you switch.') }}</p>
        </div>
      </template>

      <template v-else>
        <div class="sheet-body sheet-body--create">
          <h2 class="create-title">{{ $t('Bring your contacts along?') }}</h2>
          <p class="create-body">
            {{ $t('Your new card can start with a copy of your contacts, or with none. The same 12 words cover both cards.') }}
          </p>

          <button type="button" class="btn-primary" :disabled="busy" @click="onCreateIdentity(true)">
            <q-spinner v-if="busy" size="18px" class="q-mr-sm" />
            {{ $t('Bring my contacts') }}
          </button>
          <button type="button" class="btn-secondary" :disabled="busy" @click="onCreateIdentity(false)">
            {{ $t('Start empty') }}
          </button>
          <button type="button" class="btn-quiet" :disabled="busy" @click="step = 'list'">
            {{ $t('Cancel') }}
          </button>
        </div>
      </template>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import IdentityGroup from './IdentityGroup.vue';
import IdentityRow from './IdentityRow.vue';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';
import { useAddressBookStore } from '../../stores/addressBook';

export default {
  name: 'IdentitySwitchSheet',

  components: { Icon, IdentityGroup, IdentityRow },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue', 'changed'],

  setup() {
    return {
      identityStore: useIdentityStore(),
      addressBook: useAddressBookStore(),
    };
  },

  data() {
    return { step: 'list', identities: [], busy: false };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    contactCount() {
      return this.addressBook.entries.length;
    },
  },

  watch: {
    async modelValue(v) {
      if (!v) return;
      this.step = 'list';
      await this.refreshIdentities();
      // A stale pointer retries itself whenever this opens. The moment the
      // user is looking at identities is the moment it matters most that
      // another device can find them, and it is not a task to hand over.
      if (this.identityStore.pointerDirty) {
        this.identityStore.republishNostrPointer().catch(() => {});
      }
    },
  },

  methods: {
    async refreshIdentities() {
      try {
        this.identities = await this.identityStore.listNostrIdentities();
      } catch (err) {
        console.warn('[identity-switch] listing failed:', err);
        this.identities = [];
      }
    },

    identityName(row) {
      return row.label || this.$t('Identity {n}', { n: row.account + 1 });
    },

    /**
     * The profile store is identity-scoped, so a changed identity leaves it
     * stale. Reset and refetch in the background, the same treatment a
     * phrase restore gets.
     */
    _refreshProfileForNewIdentity() {
      const profile = useProfileStore();
      profile.reset();
      profile.recoverFromNostr({ identityStore: this.identityStore }).catch(() => {});
    },

    _notifyFailed(result, message) {
      const caption = result.reason === 'flush-failed'
        ? this.$t('Your latest contact changes could not be synced yet, so nothing was changed. Check your connection and try again.')
        : this.$t('Check your connection and try again.');
      this.$q.notify({ type: 'negative', message, caption, timeout: 4500 });
    },

    async onPickIdentity(row) {
      if (row.active || this.busy) return;
      this.busy = true;
      try {
        const result = await this.addressBook.switchContactsIdentity({
          identityStore: this.identityStore,
          changeIdentity: () => this.identityStore.switchNostrIdentity(row.account),
          keepContacts: false,
        });
        if (result === null) {
          this.$q.notify({ type: 'info', message: this.$t('Sync already running'), timeout: 3000 });
          return;
        }
        if (!result.ok) {
          this._notifyFailed(result, this.$t('Couldn\'t switch identity'));
          await this.refreshIdentities();
          return;
        }
        this._refreshProfileForNewIdentity();
        await this.refreshIdentities();
        this.$emit('changed');
        this.$q.notify({ type: 'positive', message: this.$t('Switched identity'), timeout: 3000 });
        this.open = false;
      } catch (err) {
        console.warn('[identity-switch] switch failed:', err);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t switch identity'),
          caption: this.$t('Check your connection and try again.'),
          timeout: 4000,
        });
      } finally {
        this.busy = false;
      }
    },

    async onCreateIdentity(keepContacts) {
      if (this.busy) return;
      this.busy = true;
      try {
        const result = await this.addressBook.switchContactsIdentity({
          identityStore: this.identityStore,
          changeIdentity: () => this.identityStore.createAnotherNostrIdentity(),
          keepContacts,
        });
        if (result === null) {
          this.$q.notify({ type: 'info', message: this.$t('Sync already running'), timeout: 3000 });
          return;
        }
        if (!result.ok) {
          this._notifyFailed(result, this.$t('Couldn\'t create the identity'));
          await this.refreshIdentities();
          return;
        }
        this._refreshProfileForNewIdentity();
        await this.refreshIdentities();
        this.$emit('changed');
        this.$q.notify({ type: 'positive', message: this.$t('New identity created'), timeout: 3000 });
        this.open = false;
      } catch (err) {
        console.warn('[identity-switch] create failed:', err);
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t create the identity'),
          caption: this.$t('Check your connection and try again.'),
          timeout: 4000,
        });
      } finally {
        this.busy = false;
      }
    },
  },
};
</script>

<style scoped>
.switch-sheet {
  width: 100%;
  max-width: 520px;
  border-radius: 24px 24px 0 0;
  padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
}

.sheet-grab { display: flex; justify-content: center; padding: 9px 0 2px; }
.sheet-grab span {
  width: 36px; height: 4px; border-radius: 999px;
  background: var(--border-card); display: block;
}

.sheet-head { display: flex; align-items: center; gap: 8px; padding: 8px 14px 4px; }

.sheet-title {
  flex: 1;
  padding-left: 4px;
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 720;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.sheet-body { padding: 8px 16px 20px; }
.sheet-body--create { padding-top: 18px; text-align: center; }

.switch-add { margin-top: 12px; }

.sheet-foot {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 10px 6px 0;
}

.create-title {
  font-family: 'Manrope', sans-serif;
  font-size: 22px;
  font-weight: 760;
  letter-spacing: -0.03em;
  line-height: 1.2;
  color: var(--text-primary);
  margin: 0 0 8px;
}

.create-body {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 20px;
}

.btn-primary,
.btn-secondary,
.btn-quiet {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  font-family: 'Manrope', sans-serif;
  font-size: 15.5px;
  font-weight: 650;
  letter-spacing: -0.01em;
  padding: 15px 18px;
  border-radius: 15px;
  min-height: 52px;
  cursor: pointer;
  margin-bottom: 9px;
  border: 1px solid transparent;
}

.btn-primary { background: var(--btn-neutral-bg); color: var(--btn-neutral-fg); }
.btn-secondary { background: transparent; color: var(--text-primary); border-color: var(--border-card); }
.btn-quiet { background: transparent; color: var(--text-secondary); margin-bottom: 0; }

.btn-primary:disabled,
.btn-secondary:disabled,
.btn-quiet:disabled { opacity: 0.5; cursor: default; }
</style>
