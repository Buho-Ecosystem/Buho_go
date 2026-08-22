<template>
  <q-page class="id-sub-page identity-surface" :class="$q.dark.isActive ? 'bg-dark' : 'bg-light'">
    <IdentityNav :back-to="$t(backNav.key)" :to="backNav.to" />

    <div class="id-sub-body">
      <h1 class="id-large-title">{{ $t('Your accounts') }}</h1>

      <button type="button" class="btn-primary add-account" :disabled="busy || bucket.isSweeping" @click="step = 'create'">
        <Icon icon="tabler:plus" width="18" height="18" />
        <span>{{ $t('Add an account') }}</span>
      </button>

      <!--
        This screen IS the switcher.
        It used to be a list whose rows opened a sheet containing the same
        list, so changing identity meant choosing the same one twice. Tapping a
        row here switches, which is the only thing a row naming an identity
        should do.
      -->
      <section class="current-account">
        <span class="current-account-avatar">
          <img v-if="currentPicture" :src="currentPicture" alt="" @error="avatarBroken = true" />
          <Icon v-else icon="tabler:user" width="25" height="25" />
        </span>
        <span class="current-account-copy">
          <span class="current-account-kicker">{{ $t('This account') }}</span>
          <strong>{{ currentAccountName }}</strong>
          <span v-if="currentUsername">@{{ currentUsername }}</span>
        </span>
        <span class="current-account-chip">{{ $t('In use') }}</span>
      </section>

      <IdentityGroup v-if="otherIdentities.length" :title="$t('Switch account')">
        <IdentityRow
          v-for="row in otherIdentities"
          :key="row.account"
          icon=""
          tone="neutral"
          :label="identityName(row)"
          :caption="row.username ? '@' + row.username : $t('Separate profile')"
          :interactive="!busy && !bucket.isSweeping"
          @click="onSwitch(row)"
        >
          <template #leading>
            <span class="account-row-avatar">
              <img v-if="row.picture" :src="row.picture" alt="" />
              <Icon v-else icon="tabler:user" width="19" height="19" />
            </span>
          </template>
        </IdentityRow>
      </IdentityGroup>

      <p v-else class="accounts-empty">{{ $t('You have one account on this phone.') }}</p>

    </div>

    <!-- Creating an identity is a small choice, not an alert. A bottom sheet
         keeps it in the same spatial language as the rest of the profile UI,
         and a dedicated progress stage avoids a spinner jumping into a row. -->
    <q-dialog
      v-model="showAsk"
      position="bottom"
      :persistent="busy"
      :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
    >
      <q-card class="account-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
        <div class="account-sheet-handle" aria-hidden="true"><span></span></div>

        <div class="account-sheet-header">
          <div>
            <span class="account-sheet-kicker">
              {{ step === 'create' ? $t('New account') : $t('Account switch') }}
            </span>
            <h2 class="account-sheet-title">{{ askTitle }}</h2>
          </div>
          <q-btn
            flat
            round
            dense
            class="account-sheet-close"
            :disable="busy"
            :aria-label="$t('Close')"
            @click="closeAsk"
          >
            <Icon icon="tabler:x" width="18" height="18" />
          </q-btn>
        </div>

        <div v-if="busy" class="account-progress" role="status" aria-live="polite">
          <span class="account-progress-orb" aria-hidden="true">
            <q-spinner size="34px" color="positive" />
          </span>
          <strong>{{ busyTitle }}</strong>
          <p>{{ busyBody }}</p>
        </div>

        <div v-else class="account-sheet-body">
          <p class="account-sheet-lede">{{ askBody }}</p>

          <div v-if="step === 'create'" class="account-options">
            <button
              v-if="contactCount > 0"
              type="button"
              class="account-option account-option--recommended"
              @click="onCreate(true)"
            >
              <span class="account-option-icon account-option-icon--accent" aria-hidden="true">
                <Icon icon="tabler:address-book" width="21" height="21" />
              </span>
              <span class="account-option-copy">
                <span class="account-option-title-row">
                  <strong>{{ $t('Bring my contacts') }}</strong>
                  <span class="account-option-chip">{{ $t('Recommended') }}</span>
                </span>
                <span>{{ contactCopyText }}</span>
              </span>
              <Icon class="account-option-chevron" icon="tabler:chevron-right" width="18" height="18" />
            </button>

            <button type="button" class="account-option" @click="onCreate(false)">
              <span class="account-option-icon" aria-hidden="true">
                <Icon icon="tabler:user-plus" width="21" height="21" />
              </span>
              <span class="account-option-copy">
                <strong>{{ $t('Start empty') }}</strong>
                <span>{{ $t('Begin with a clean contact list.') }}</span>
              </span>
              <Icon class="account-option-chevron" icon="tabler:chevron-right" width="18" height="18" />
            </button>

            <div class="account-recovery-note">
              <Icon icon="tabler:shield-check" width="17" height="17" />
              <span>{{ $t('The same 12 words recover this account too.') }}</span>
            </div>
          </div>

          <template v-else>
            <div class="account-switch-target">
              <span class="account-switch-avatar" aria-hidden="true">
                <img v-if="pending.picture" :src="pending.picture" alt="" />
                <Icon v-else icon="tabler:user" width="21" height="21" />
              </span>
              <span class="account-switch-copy">
                <strong>{{ pendingName }}</strong>
                <span v-if="pending.username">@{{ pending.username }}</span>
              </span>
            </div>
            <button type="button" class="account-confirm" @click="confirmSwitch">
              {{ $t('Switch to {name}', { name: pendingName }) }}
            </button>
          </template>
        </div>
      </q-card>
    </q-dialog>
      <q-dialog v-model="showProfileSetup" position="bottom" :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'">
        <q-card class="profile-setup-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
          <div class="sheet-handle" aria-hidden="true"><span></span></div>
          <div class="profile-setup-head">
            <div>
              <span class="account-sheet-kicker">{{ $t('New account') }}</span>
              <h2>{{ $t('Make it yours') }}</h2>
            </div>
            <q-btn flat round dense :aria-label="$t('Close')" @click="showProfileSetup = false">
              <Icon icon="tabler:x" width="18" height="18" />
            </q-btn>
          </div>
          <div class="profile-setup-body">
            <button type="button" class="setup-avatar" @click="showProfilePicker = true">
              <img v-if="profile.picture" :src="profile.picture" alt="" />
              <Icon v-else icon="tabler:camera-plus" width="25" height="25" />
              <span>{{ profile.picture ? $t('Change photo') : $t('Add a photo') }}</span>
            </button>
            <label class="setup-field">
              <span>{{ $t('Name') }}</span>
              <input v-model="profileName" type="text" :placeholder="$t('Your name')" maxlength="200" autocomplete="off" />
            </label>
            <button type="button" class="account-confirm" @click="finishProfileSetup">{{ $t('Done') }}</button>
          </div>
        </q-card>
      </q-dialog>
      <ProfileAvatarPickerSheet v-model="showProfilePicker" />

      <SettingsHubNav />

  </q-page>
</template>

<script>
import IdentityNav from '../../components/identity/IdentityNav.vue';
import { Icon } from '@iconify/vue';
import SettingsHubNav from '../../components/settings/SettingsHubNav.vue';
import { identityBack } from '../../composables/useIdentityBack';
import IdentityGroup from '../../components/identity/IdentityGroup.vue';
import IdentityRow from '../../components/identity/IdentityRow.vue';
import { useIdentityStore } from '../../stores/identity';
import { useProfileStore } from '../../stores/profile';
import { useAddressBookStore } from '../../stores/addressBook';
import { useSocialBucketStore } from '../../stores/socialBucket';
import ProfileAvatarPickerSheet from '../../components/ProfileAvatarPickerSheet.vue';
import { fetchProfiles, parseProfileContent } from '../../utils/nostrFetch.js';

export default {
  name: 'IdentityListPage',

  components: { SettingsHubNav, Icon, IdentityNav, IdentityGroup, IdentityRow, ProfileAvatarPickerSheet },

  setup() {
    return {
      identity: useIdentityStore(),
      profile: useProfileStore(),
      addressBook: useAddressBookStore(),
      bucket: useSocialBucketStore(),
    };
  },

  data() {
    return {
      identities: [],
      step: null, // null | 'switch' | 'create'
      pending: null,
      busy: false,
      createChoice: null,
      avatarBroken: false,
      showProfileSetup: false,
      showProfilePicker: false,
      profileName: '',
    };
  },

  computed: {
    /** Back goes to whichever screen opened this one. */
    backNav() { return identityBack(this.$router, this.$route.path); },


    contactCount() {
      return this.addressBook.entries.length;
    },

    contactCopyText() {
      return this.contactCount === 1
        ? this.$t('Copy one contact into the new account.')
        : this.$t('Copy {n} contacts into the new account.', { n: this.contactCount });
    },

    activeIdentity() {
      return this.identities.find((row) => row.active) || null;
    },

    otherIdentities() {
      return this.identities.filter((row) => !row.active);
    },

    currentUsername() {
      return this.activeIdentity?.username || '';
    },

    currentAccountName() {
      return this.profile.displayName || this.profile.name ||
        (this.activeIdentity ? this.identityName(this.activeIdentity) : this.$t('This account'));
    },

    currentPicture() {
      return this.avatarBroken ? '' : (this.profile.picture || '');
    },

    showAsk: {
      get() { return this.step !== null; },
      set(v) { if (!v) this.closeAsk(); },
    },

    pendingName() {
      return this.pending ? this.identityName(this.pending) : '';
    },

    askTitle() {
      return this.step === 'create'
        ? this.$t('Create another account')
        : this.$t('Switch account?');
    },

    askBody() {
      return this.step === 'create'
        ? this.$t('Choose what comes with you. You can change the contact list later.')
        : this.$t('Your card, your contacts and your username all change. Your wallets and your Bitcoin stay as they are.');
    },

    busyTitle() {
      return this.step === 'create'
        ? this.$t('Creating your account…')
        : this.$t('Switching accounts…');
    },

    busyBody() {
      if (this.step !== 'create') {
        return this.$t('Updating your card and contacts across BuhoGO.');
      }
      return this.createChoice
        ? this.$t('Copying your contacts and preparing a separate profile.')
        : this.$t('Preparing a fresh profile with no contacts.');
    },
  },

  async created() {
    await this.identity.hydrate();
    await this.profile.hydrate();
    await this.refresh();

    // A stale pointer means another device cannot find these identities after
    // a restore. The moment the user is looking at the list is the moment it
    // matters most, and it is our retry to make, not a task to hand over.
    if (this.identity.pointerDirty) {
      this.identity.republishNostrPointer().catch(() => {});
    }
  },

  methods: {
    async refresh() {
      try {
        const rows = await this.identity.listNostrIdentities();
        const cachedRows = rows.map((row) => {
          const cached = this.readCachedProfile(row.pubkeyHex);
          return { ...row, displayName: cached.displayName || cached.name || '', picture: cached.picture || '' };
        });
        this.identities = cachedRows;
        const pubkeys = rows.map((row) => row.pubkeyHex).filter(Boolean);
        if (!pubkeys.length) return;
        let profiles;
        try {
          profiles = await fetchProfiles(pubkeys);
        } catch (err) {
          console.warn('[identity-list] profile fetch failed:', err);
          return;
        }
        this.identities = rows.map((row) => {
          const event = profiles.get((row.pubkeyHex || '').toLowerCase());
          const content = parseProfileContent(event);
          const cached = this.readCachedProfile(row.pubkeyHex);
          return {
            ...row,
            displayName: content.display_name || content.name || cached.displayName || '',
            picture: content.picture || cached.picture || '',
          };
        });
      } catch (err) {
        console.warn('[identity-list] listing failed:', err);
        this.identities = [];
      }
    },

    readCachedProfile(pubkeyHex) {
      if (!pubkeyHex) return {};
      try {
        const raw = localStorage.getItem(`buhoGO_profile_v1_${pubkeyHex}`);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && parsed.version === 1 ? parsed : {};
      } catch {
        return {};
      }
    },

    /**
     * A user-set label wins, then the card's own username, then the
     * numbered fallback for a card that has neither yet.
     */
    identityName(row) {
      if (row.displayName) return row.displayName;
      if (row.label) return row.label;
      if (row.username) return `@${row.username}`;
      return this.$t('Account {n}', { n: row.account + 1 });
    },

    onSwitch(row) {
      if (row.active || this.busy || this.bucket.isSweeping) return;
      this.pending = row;
      this.step = 'switch';
    },

    closeAsk() {
      if (this.busy) return;
      this.step = null;
      this.pending = null;
      this.createChoice = null;
    },

    /**
     * The profile is scoped to a key, so a changed identity leaves it stale.
     * Reset and refetch, the same treatment a phrase restore gets.
     */
    async _refreshProfileForNewIdentity() {
      const profile = useProfileStore();
      await profile.hydrate({ force: true });
      profile.recoverFromNostr({ identityStore: this.identity }).catch(() => {});
      this.bucket.hydrate({ pubkey: this.identity.nostrPubkeyHex })
        .then(() => this.bucket.sync({ identityStore: this.identity }))
        .catch(() => {});
    },

    _notifyFailed(result, message) {
      const caption = result.reason === 'flush-failed'
        ? this.$t('Your contacts have not finished saving, so nothing was changed. Check your connection and try again.')
        : this.$t('Check your connection and try again.');
      this.$q.notify({ type: 'negative', message, caption, timeout: 4500 });
    },

    async confirmSwitch() {
      if (!this.pending || this.busy || this.bucket.isSweeping) return;
      const target = this.pending;
      this.busy = true;
      try {
        const result = await this.addressBook.switchContactsIdentity({
          identityStore: this.identity,
          changeIdentity: () => this.identity.switchNostrIdentity(target.account),
          keepContacts: false,
        });

        if (result === null) {
          this.$q.notify({ type: 'info', message: this.$t('Still finishing the last change'),
            caption: this.$t('Try again in a moment.'),
            timeout: 3500,
          });
          return;
        }
        if (!result.ok) {
          this._notifyFailed(result, this.$t("Couldn't switch account"));
          await this.refresh();
          return;
        }

        await this._refreshProfileForNewIdentity();
        await this.refresh();
        this.$q.notify({ type: 'positive', message: this.$t('Switched account'), timeout: 3000 });
        this.step = null;
        this.pending = null;
      } catch (err) {
        console.warn('[identity-list] switch failed:', err);
        this.$q.notify({
          type: 'negative',
          message: this.$t("Couldn't switch account"),
          caption: this.$t('Check your connection and try again.'),
          timeout: 4000,
        });
      } finally {
        this.busy = false;
      }
    },

    async onCreate(keepContacts) {
      if (this.busy || this.bucket.isSweeping) return;
      this.createChoice = keepContacts;
      this.busy = true;
      try {
        const result = await this.addressBook.switchContactsIdentity({
          identityStore: this.identity,
          changeIdentity: () => this.identity.createAnotherNostrIdentity(),
          keepContacts,
        });

        if (result === null) {
          this.$q.notify({ type: 'info', message: this.$t('Still finishing the last change'),
            caption: this.$t('Try again in a moment.'),
            timeout: 3500,
          });
          return;
        }
        if (!result.ok) {
          this._notifyFailed(result, this.$t("Couldn't create the account"));
          await this.refresh();
          return;
        }

        await this._refreshProfileForNewIdentity();
        await this.refresh();
        this.step = null;
        this.profileName = '';
        this.showProfileSetup = true;
      } catch (err) {
        console.warn('[identity-list] create failed:', err);
        this.$q.notify({
          type: 'negative',
          message: this.$t("Couldn't create the account"),
          caption: this.$t('Check your connection and try again.'),
          timeout: 4000,
        });
      } finally {
        this.busy = false;
      }
    },

    async finishProfileSetup() {
      this.profile.setField('displayName', this.profileName.trim());
      if (this.profile.isDirty) await this.profile.publish().catch(() => {});
      this.showProfileSetup = false;
      this.$q.notify({ type: 'positive', message: this.$t('New account created'), timeout: 2200 });
    },
  },
};
</script>

<style scoped>

.add-account { margin-top: 0 !important; margin-bottom: 4px; }

.current-account {
  display: flex;
  align-items: center;
  gap: 13px;
  min-height: 92px;
  padding: 14px 15px;
  border: 1px solid var(--border-card);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  box-shadow: 0 14px 34px -30px rgba(0, 0, 0, 0.7);
}

.current-account-avatar {
  width: 54px;
  height: 54px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: var(--brand-accent-soft);
  color: var(--brand-accent-text);
}

.current-account-avatar img { width: 100%; height: 100%; object-fit: cover; }
.account-row-avatar { width: 36px; height: 36px; flex: 0 0 auto; display: grid; place-items: center; overflow: hidden; border-radius: var(--radius-ms); background: var(--bg-input); color: var(--text-secondary); }
.account-row-avatar img { width: 100%; height: 100%; object-fit: cover; }
.current-account-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.current-account-kicker { color: var(--text-secondary); font-size: 11.5px; font-weight: 700; }
.current-account-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; font-weight: 740; }
.current-account-copy > span:last-child { color: var(--text-secondary); font-size: 12.5px; }
.current-account-chip { flex: 0 0 auto; padding: 6px 9px; border-radius: var(--radius-pill); background: var(--brand-accent-soft); color: var(--brand-accent-text); font-size: 11.5px; font-weight: 700; }
.accounts-empty { margin: 24px 4px 0; color: var(--text-secondary); font-size: 13px; text-align: center; }

.profile-setup-sheet { width: 100%; max-width: 520px; border-radius: 24px 24px 0 0; padding-bottom: max(14px, env(safe-area-inset-bottom, 0px)); }
.profile-setup-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 10px 20px 12px; }
.profile-setup-head h2 { margin: 0; color: var(--text-primary); font-size: 21px; font-weight: 740; letter-spacing: -0.025em; }
.profile-setup-body { padding: 4px 20px 12px; }
.setup-avatar { display: flex; flex-direction: column; align-items: center; gap: 7px; width: 100%; padding: 4px 0 18px; border: 0; background: transparent; color: var(--brand-accent-text); font-size: 13px; font-weight: 650; }
.setup-avatar img, .setup-avatar > svg { width: 76px; height: 76px; border-radius: 50%; object-fit: cover; display: grid; place-items: center; background: var(--brand-accent-soft); }
.setup-field { display: flex; flex-direction: column; gap: 7px; margin-bottom: 16px; color: var(--text-secondary); font-size: 12.5px; font-weight: 650; }
.setup-field input { width: 100%; min-height: 48px; padding: 0 13px; border: 1px solid var(--border-card); border-radius: var(--radius-md); background: var(--bg-input); color: var(--text-primary); font: inherit; font-size: 15px; outline: none; }
.setup-field input:focus { border-color: var(--brand-accent-text); }

.account-sheet {
  width: 100%;
  max-width: 520px;
  border-radius: 24px 24px 0 0;
  overflow: hidden;
  padding-bottom: max(14px, env(safe-area-inset-bottom, 0px));
}

.account-sheet-handle {
  display: flex;
  justify-content: center;
  padding: 8px 0 3px;
}

.account-sheet-handle span {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.18);
  background: color-mix(in srgb, var(--text-secondary) 28%, transparent);
}

body.body--dark .account-sheet-handle span { background: rgba(255, 255, 255, 0.22); }

.account-sheet-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 20px 12px;
}

.account-sheet-kicker {
  display: block;
  margin-bottom: 3px;
  color: var(--brand-accent-text);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.035em;
  text-transform: uppercase;
}

.account-sheet-title {
  font-family: 'Manrope', sans-serif;
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -0.03em;
  line-height: 1.22;
  color: var(--text-primary);
  margin: 0;
}

.account-sheet-close {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
  color: var(--text-secondary);
  background: rgba(15, 23, 42, 0.055);
  background: color-mix(in srgb, var(--text-secondary) 9%, transparent);
}

body.body--dark .account-sheet-close { background: rgba(255, 255, 255, 0.07); }

.account-sheet-body { padding: 0 20px 8px; }

.account-sheet-lede {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0 0 16px;
}

.account-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.account-option {
  width: 100%;
  min-height: 72px;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 12px;
  padding: 12px 13px;
  border: 1px solid var(--border-card);
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.025);
  background: color-mix(in srgb, var(--text-primary) 2.5%, transparent);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: transform 100ms ease, border-color 160ms ease, background 160ms ease;
  -webkit-tap-highlight-color: transparent;
}

.account-option--recommended {
  border-color: rgba(8, 120, 62, 0.28);
  border-color: color-mix(in srgb, var(--brand-accent-text) 30%, var(--border-card));
  background: rgba(21, 222, 114, 0.08);
  background: color-mix(in srgb, var(--brand-accent-soft) 48%, transparent);
}

.account-option:hover {
  border-color: rgba(8, 120, 62, 0.34);
  border-color: color-mix(in srgb, var(--brand-accent-text) 35%, var(--border-card));
}
.account-option:active { transform: scale(0.985); }

body.body--dark .account-option { background: rgba(255, 255, 255, 0.025); }
body.body--dark .account-option--recommended {
  border-color: rgba(113, 232, 167, 0.26);
  background: rgba(21, 222, 114, 0.09);
}

.account-option-icon {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  background: rgba(15, 23, 42, 0.065);
  background: color-mix(in srgb, var(--text-secondary) 9%, transparent);
}

body.body--dark .account-option-icon { background: rgba(255, 255, 255, 0.07); }

.account-option-icon--accent {
  color: var(--brand-accent-text);
  background: var(--brand-accent-soft);
}

.account-option-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-family: 'Manrope', sans-serif;
}

.account-option-copy strong { font-size: 15px; font-weight: 700; line-height: 1.25; }
.account-option-copy > span:last-child { color: var(--text-secondary); font-size: 12.5px; line-height: 1.35; }

.account-option-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
}

.account-option-chip {
  padding: 3px 7px;
  border-radius: 999px;
  color: var(--brand-accent-text);
  background: var(--brand-accent-soft);
  font-size: 10.5px;
  font-weight: 750;
  letter-spacing: 0.01em;
}

.account-option-chevron { color: var(--text-secondary); opacity: 0.65; }

.account-recovery-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 5px 8px 1px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.35;
  text-align: center;
}

.account-progress {
  min-height: 238px;
  padding: 32px 24px 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.account-progress-orb {
  width: 68px;
  height: 68px;
  margin-bottom: 17px;
  display: grid;
  place-items: center;
  border-radius: 22px;
  color: var(--brand-accent-text);
  background: var(--brand-accent-soft);
}

.account-progress strong {
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
  font-size: 18px;
  font-weight: 750;
  letter-spacing: -0.02em;
}

.account-progress p {
  max-width: 300px;
  margin: 7px 0 0;
  color: var(--text-secondary);
  font-size: 13.5px;
  line-height: 1.45;
}

.account-switch-target {
  min-height: 68px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid var(--border-card);
  border-radius: 18px;
  color: var(--text-primary);
}

.account-switch-avatar { width: 42px; height: 42px; flex: 0 0 auto; display: grid; place-items: center; overflow: hidden; border-radius: 14px; color: var(--brand-accent-text); background: var(--brand-accent-soft); }
.account-switch-avatar img { width: 100%; height: 100%; object-fit: cover; }
.account-switch-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.account-switch-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 700; }
.account-switch-copy > span { color: var(--text-secondary); font-size: 12.5px; }

.account-confirm {
  width: 100%;
  min-height: 50px;
  border: 0;
  border-radius: 16px;
  background: #1a1a1c;
  color: #faf7ef;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

body.body--dark .account-confirm { background: #f4f4f4; color: #0c0c0c; }
.account-confirm:active { transform: scale(0.985); }
</style>
