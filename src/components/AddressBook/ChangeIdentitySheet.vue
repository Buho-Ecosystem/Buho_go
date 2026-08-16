<!--
  ChangeIdentitySheet

  Switch between the identities derived from the user's one recovery
  phrase, or create the next one. Lives in the Address Book kebab
  because contacts are what visibly change with the identity — each
  identity owns its own private contact list.

  Owns the full orchestration for both actions:
    switch:  addressBook.switchContactsIdentity wraps
             identity.switchNostrIdentity so the outgoing book is
             flushed first and the incoming book pulled after.
    create:  same wrapper around identity.createAnotherNostrIdentity,
             with exactly one question first — "Bring your contacts
             along?" — because a new identity starting empty reads as
             data loss to anyone who didn't expect it.

  The profile store is identity-scoped, so a successful change also
  resets it and refetches the (possibly published) kind:0 for the new
  key, mirroring what ProfilePage does after a phrase restore.
-->
<template>
  <q-dialog
    v-model="open"
    :persistent="busy"
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="cis-card" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <!-- Step: list -->
      <template v-if="step === 'list'">
        <q-card-section class="cis-header">
          <h2 class="cis-heading" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
            {{ $t('Change identity') }}
          </h2>
          <p class="cis-subline" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('One recovery phrase backs every identity here. Each identity has its own profile and contacts.') }}
          </p>
        </q-card-section>

        <q-card-section class="cis-body">
          <q-list>
            <q-item
              v-for="row in identities"
              :key="row.account"
              clickable
              :disable="busy"
              class="cis-row"
              @click="onPickIdentity(row)"
            >
              <q-item-section avatar style="min-width: 36px;">
                <Icon
                  :icon="row.active ? 'tabler:user-check' : 'tabler:user'"
                  width="20"
                  height="20"
                  :style="{ color: row.active ? 'var(--q-primary)' : 'var(--text-secondary)' }"
                />
              </q-item-section>
              <q-item-section>
                <q-item-label class="cis-row-name">
                  {{ identityName(row) }}
                </q-item-label>
                <q-item-label caption class="cis-npub">
                  {{ shortNpub(row.npub) }}
                </q-item-label>
              </q-item-section>
              <q-item-section v-if="row.active" side>
                <q-item-label caption>{{ $t('Active') }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>

          <!-- The published pointer lags local state; without it a
               fresh restore on another device cannot find the climbed
               identities, so a stale one earns a quiet retry row. -->
          <q-item
            v-if="identityStore.pointerDirty"
            clickable
            dense
            :disable="busy"
            class="cis-pointer-warn"
            @click="onRetryPointer"
          >
            <q-item-section avatar style="min-width: 32px;">
              <Icon icon="tabler:cloud-off" width="16" height="16" style="color: var(--text-secondary)" />
            </q-item-section>
            <q-item-section>
              <q-item-label caption>
                {{ $t('Your identity list has not synced yet. Tap to retry.') }}
              </q-item-label>
            </q-item-section>
          </q-item>
        </q-card-section>

        <q-card-actions class="cis-actions">
          <q-btn
            unelevated
            no-caps
            class="cis-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="$t('Create another identity')"
            :disable="busy"
            @click="step = 'create'"
          />
          <q-btn
            flat
            no-caps
            class="cis-secondary-btn"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
            :label="$t('Close')"
            :disable="busy"
            @click="open = false"
          />
        </q-card-actions>
      </template>

      <!-- Step: create — the one question -->
      <template v-else>
        <q-card-section class="cis-header">
          <h2 class="cis-heading" :class="$q.dark.isActive ? 'main_page_title_dark' : 'main_page_title_light'">
            {{ $t('Bring your contacts along?') }}
          </h2>
          <p class="cis-subline" :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'">
            {{ $t('Your new identity can start with a copy of your current contacts, or with none. Your recovery phrase stays the same and backs both identities.') }}
          </p>
        </q-card-section>

        <q-card-actions class="cis-actions">
          <q-btn
            unelevated
            no-caps
            class="cis-primary-btn"
            :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
            :label="$t('Bring my contacts')"
            :loading="busy"
            @click="onCreateIdentity(true)"
          />
          <q-btn
            outline
            no-caps
            class="cis-primary-btn"
            :label="$t('Start fresh')"
            :disable="busy"
            @click="onCreateIdentity(false)"
          />
          <q-btn
            flat
            no-caps
            class="cis-secondary-btn"
            :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
            :label="$t('Back')"
            :disable="busy"
            @click="step = 'list'"
          />
        </q-card-actions>
      </template>

      <q-inner-loading :showing="busy">
        <q-spinner-orbit size="42px" color="primary" />
      </q-inner-loading>
    </q-card>
  </q-dialog>
</template>

<script>
import { useAddressBookStore } from '../../stores/addressBook'
import { useIdentityStore } from '../../stores/identity'
import { useProfileStore } from '../../stores/profile'

// The `Icon` component is registered globally by boot/iconify.js.
export default {
  name: 'ChangeIdentitySheet',

  props: {
    modelValue: { type: Boolean, default: false },
  },

  emits: ['update:modelValue', 'changed'],

  data() {
    return {
      step: 'list',
      identities: [],
      busy: false,
    }
  },

  computed: {
    open: {
      get() { return this.modelValue },
      set(v) { this.$emit('update:modelValue', v) },
    },
    identityStore() {
      return useIdentityStore()
    },
  },

  watch: {
    async modelValue(v) {
      if (!v) return
      this.step = 'list'
      await this.refreshIdentities()
      // A stale pointer retries itself whenever the sheet opens — the
      // moment the user is looking at identities is the moment it
      // matters most that other devices can find them.
      if (this.identityStore.pointerDirty) {
        this.identityStore.republishNostrPointer().catch(() => {})
      }
    },
  },

  methods: {
    async refreshIdentities() {
      try {
        this.identities = await this.identityStore.listNostrIdentities()
      } catch (err) {
        console.warn('[change-identity] listing failed:', err)
        this.identities = []
      }
    },

    identityName(row) {
      return row.label || this.$t('Identity {n}', { n: row.account + 1 })
    },

    shortNpub(npub) {
      if (!npub) return ''
      return `${npub.slice(0, 12)}…${npub.slice(-6)}`
    },

    async onRetryPointer() {
      const result = await this.identityStore.republishNostrPointer()
      if (result.ok) {
        this.$q.notify({ type: 'positive', message: this.$t('Identity list synced'), timeout: 2500 })
      }
    },

    /**
     * Shared tail of both flows: the identity flipped, so the
     * identity-scoped profile is stale. Reset it and refetch in the
     * background — the same treatment ProfilePage gives a restore.
     */
    _refreshProfileForNewIdentity() {
      const profile = useProfileStore()
      profile.reset()
      profile.recoverFromNostr({ identityStore: this.identityStore }).catch(() => {})
    },

    async onPickIdentity(row) {
      if (row.active || this.busy) return
      this.busy = true
      try {
        const addressBook = useAddressBookStore()
        const result = await addressBook.switchContactsIdentity({
          identityStore: this.identityStore,
          changeIdentity: () => this.identityStore.switchNostrIdentity(row.account),
          keepContacts: false,
        })
        if (result === null) {
          this.$q.notify({ type: 'info', message: this.$t('Sync already running'), timeout: 3000 })
          return
        }
        // switchContactsIdentity swallows every internal failure into
        // {ok:false} — a thrown changeIdentity included — so the catch
        // below only sees programming errors. Failure is decided HERE.
        if (!result.ok) {
          this._notifySwitchFailed(result, this.$t('Couldn\'t switch identity'))
          await this.refreshIdentities()
          return
        }
        this._refreshProfileForNewIdentity()
        await this.refreshIdentities()
        this.$emit('changed')
        this.$q.notify({ type: 'positive', message: this.$t('Switched identity'), timeout: 3000 })
        this.open = false
      } catch (err) {
        console.warn('[change-identity] switch failed:', err)
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t switch identity'),
          caption: this.$t('Check your connection and try again.'),
          timeout: 4000,
        })
      } finally {
        this.busy = false
      }
    },

    /**
     * Failure toast for a non-ok switch/create result. The one reason
     * worth its own words is 'flush-failed': the identity did NOT
     * change because unsynced contact edits would have been destroyed
     * — the user needs to know it is about their pending changes, not
     * a generic hiccup.
     */
    _notifySwitchFailed(result, message) {
      const caption = result.reason === 'flush-failed'
        ? this.$t('Your latest contact changes could not be synced yet, so nothing was changed. Check your connection and try again.')
        : this.$t('Check your connection and try again.')
      this.$q.notify({ type: 'negative', message, caption, timeout: 4500 })
    },

    async onCreateIdentity(keepContacts) {
      if (this.busy) return
      this.busy = true
      try {
        const addressBook = useAddressBookStore()
        const result = await addressBook.switchContactsIdentity({
          identityStore: this.identityStore,
          changeIdentity: () => this.identityStore.createAnotherNostrIdentity(),
          keepContacts,
        })
        if (result === null) {
          this.$q.notify({ type: 'info', message: this.$t('Sync already running'), timeout: 3000 })
          return
        }
        if (!result.ok) {
          this._notifySwitchFailed(result, this.$t('Couldn\'t create the identity'))
          await this.refreshIdentities()
          return
        }
        this._refreshProfileForNewIdentity()
        await this.refreshIdentities()
        this.$emit('changed')
        this.$q.notify({ type: 'positive', message: this.$t('New identity created'), timeout: 3000 })
        this.open = false
      } catch (err) {
        console.warn('[change-identity] create failed:', err)
        this.$q.notify({
          type: 'negative',
          message: this.$t('Couldn\'t create the identity'),
          caption: this.$t('Check your connection and try again.'),
          timeout: 4000,
        })
      } finally {
        this.busy = false
      }
    },
  },
}
</script>

<style scoped>
.cis-card {
  width: 100%;
  max-width: 380px;
  border-radius: 16px;
}

.cis-header {
  padding-bottom: 0;
}

.cis-heading {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 6px;
}

.cis-subline {
  font-size: 13px;
  line-height: 1.45;
  margin: 0;
}

.cis-body {
  padding-top: 8px;
  padding-bottom: 0;
  max-height: 46vh;
  overflow-y: auto;
}

.cis-row {
  border-radius: 10px;
}

.cis-row-name {
  font-size: 14px;
  font-weight: 500;
}

.cis-npub {
  font-family: monospace;
  font-size: 11px;
}

.cis-pointer-warn {
  border-radius: 10px;
  margin-top: 4px;
}

.cis-actions {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 12px 16px 16px;
}

.cis-primary-btn {
  width: 100%;
  border-radius: 12px;
}

.cis-secondary-btn {
  width: 100%;
}
</style>
