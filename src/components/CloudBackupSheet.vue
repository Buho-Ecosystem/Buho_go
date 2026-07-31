<!--
  CloudBackupSheet

  Self-contained dialog covering the entire Google Drive backup lifecycle:
  sign in, create a fresh encrypted backup, browse existing backups, restore
  from one, delete a stale one, sign out.

  Crypto and Drive transport live in stores/cloudBackup.js — this component
  is presentation + flow control only. The sheet never sees the decrypted
  seed phrase: the store passes the passphrase straight into encryptBackup()
  and the local mnemonic into the same call.
-->
<template>
  <q-dialog
    v-model="open"
    position="bottom"
    persistent
    :class="$q.dark.isActive ? 'dialog_dark' : 'dialog_light'"
  >
    <q-card class="cb-sheet" :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
      <div class="sheet-handle" aria-hidden="true">
        <span :class="$q.dark.isActive ? 'sheet-handle-bar-dark' : 'sheet-handle-bar-light'"></span>
      </div>

      <q-card-section class="cb-header">
        <button class="cb-back" v-if="canGoBack" @click="goBack" :aria-label="$t('Back')">
          <Icon icon="tabler:chevron-left" width="18" height="18" />
        </button>
        <div class="cb-title" :class="$q.dark.isActive ? 'dialog_title_dark' : 'dialog_title_light'">
          {{ headerTitle }}
        </div>
        <q-btn
          flat
          round
          dense
          :disable="busy"
          @click="close"
          :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          :aria-label="$t('Close')"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </q-card-section>

      <!-- Step: NOT CONFIGURED — surfaced when the build has no OAuth client IDs -->
      <q-card-section v-if="step === 'unconfigured'" class="cb-body">
        <div class="cb-illustration cb-illustration--warn">
          <Icon icon="tabler:cloud-off" width="40" height="40" />
        </div>
        <h2 class="cb-heading">{{ $t('Cloud backup is not set up for this build') }}</h2>
        <p class="cb-lede">
          {{ $t('The Google Drive backup feature needs a Google OAuth client ID to be compiled into the app. Build BuhoGO with VITE_GOOGLE_OAUTH_*_CLIENT_ID and VITE_GOOGLE_OAUTH_*_REDIRECT_URI set for your platform.') }}
        </p>
      </q-card-section>

      <!-- Step: SIGN IN -->
      <q-card-section v-else-if="step === 'sign-in'" class="cb-body">
        <div class="cb-illustration">
          <Icon icon="tabler:cloud-lock" width="40" height="40" />
        </div>
        <h2 class="cb-heading">{{ $t('Encrypted Google Drive backup') }}</h2>
        <p class="cb-lede">
          {{ $t('Your recovery phrase is encrypted on this device with a passphrase you choose, then uploaded to your Google Drive. Anyone with the file still needs your passphrase to use it.') }}
        </p>
        <div class="cb-callout" :class="$q.dark.isActive ? 'cb-callout-dark' : 'cb-callout-light'">
          <Icon icon="tabler:shield-check" width="18" height="18" class="cb-callout-icon" />
          <div class="cb-callout-text">
            {{ $t('BuhoGO only sees files it created itself. Your other Drive files stay private.') }}
          </div>
        </div>
      </q-card-section>

      <!-- Step: MENU — signed in, choose backup or restore -->
      <q-card-section v-else-if="step === 'menu'" class="cb-body">
        <div class="cb-account-row" :class="$q.dark.isActive ? 'cb-account-dark' : 'cb-account-light'">
          <Icon icon="tabler:user-circle" width="18" height="18" />
          <span class="cb-account-email">{{ store.signedInEmail || $t('Signed in') }}</span>
          <button class="cb-account-signout" :disabled="busy" @click="onSignOut">
            {{ $t('Sign out') }}
          </button>
        </div>

        <div v-if="store.lastBackupAt" class="cb-last-backup">
          <Icon icon="tabler:clock" width="14" height="14" />
          <span>{{ $t('Last backup:') }} {{ formatDate(store.lastBackupAt) }}</span>
        </div>

        <div
          class="cb-auto-row"
          :class="$q.dark.isActive ? 'cb-auto-row-dark' : 'cb-auto-row-light'"
        >
          <div class="cb-auto-text">
            <div class="cb-auto-title">{{ $t('Automatic backup') }}</div>
            <div class="cb-auto-sub">
              {{ store.autoBackupEnabled
                ? $t('Your wallet is backed up silently after important changes and at most once a day.')
                : $t('Run a backup first to turn this on. Your passphrase is stored locally, encrypted with the device key.') }}
            </div>
          </div>
          <q-toggle
            :model-value="store.autoBackupEnabled"
            :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'"
            :disable="busy || !store.autoBackupEnabled && !canEnableAutoNow"
            @update:model-value="onToggleAutoBackup"
          />
        </div>

        <button
          class="cb-menu-row"
          :class="$q.dark.isActive ? 'cb-menu-row-dark' : 'cb-menu-row-light'"
          :disabled="!store.hasBackupableSecret || busy"
          @click="step = 'backup'"
        >
          <div class="cb-menu-icon"><Icon icon="tabler:cloud-upload" width="22" height="22" /></div>
          <div class="cb-menu-text">
            <div class="cb-menu-title">{{ $t('Back up now') }}</div>
            <div class="cb-menu-sub">
              {{
                store.hasBackupableSecret
                  ? $t('Encrypt and upload your current wallet + identity seeds.')
                  : $t('Create or restore a wallet first.')
              }}
            </div>
          </div>
          <Icon icon="tabler:chevron-right" width="16" height="16" />
        </button>

        <button
          class="cb-menu-row"
          :class="$q.dark.isActive ? 'cb-menu-row-dark' : 'cb-menu-row-light'"
          :disabled="busy"
          @click="onOpenRestoreList"
        >
          <div class="cb-menu-icon"><Icon icon="tabler:cloud-download" width="22" height="22" /></div>
          <div class="cb-menu-text">
            <div class="cb-menu-title">{{ $t('Restore from backup') }}</div>
            <div class="cb-menu-sub">{{ $t('Recover a wallet from a file in your Drive.') }}</div>
          </div>
          <Icon icon="tabler:chevron-right" width="16" height="16" />
        </button>
      </q-card-section>

      <!-- Step: BACKUP — set passphrase -->
      <q-card-section v-else-if="step === 'backup'" class="cb-body">
        <p class="cb-lede">
          {{ $t('Choose a passphrase. You will need it to restore. Lose it and the backup file is unrecoverable.') }}
        </p>
        <q-input
          v-model="passphrase"
          :type="showPassphrase ? 'text' : 'password'"
          :label="$t('Backup passphrase')"
          outlined
          dense
          :error="!!passphraseError"
          :error-message="passphraseError"
          autocomplete="new-password"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          class="cb-input"
        >
          <template v-slot:append>
            <q-btn flat dense round @click="showPassphrase = !showPassphrase" :aria-label="$t('Show')">
              <Icon :icon="showPassphrase ? 'tabler:eye-off' : 'tabler:eye'" width="16" height="16" />
            </q-btn>
          </template>
        </q-input>
        <q-input
          v-model="passphraseConfirm"
          :type="showPassphrase ? 'text' : 'password'"
          :label="$t('Confirm passphrase')"
          outlined
          dense
          autocomplete="new-password"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          class="cb-input"
        />
        <q-input
          v-model="hint"
          :label="$t('Hint (optional, stored in cleartext)')"
          outlined
          dense
          maxlength="200"
          class="cb-input"
        />
      </q-card-section>

      <!-- Step: PICK — choose which backup to restore -->
      <q-card-section v-else-if="step === 'pick'" class="cb-body cb-body--list">
        <div v-if="store.isListing && store.backups.length === 0" class="cb-list-loading">
          <q-spinner-dots size="28px" />
          <span>{{ $t('Loading backups…') }}</span>
        </div>
        <div v-else-if="store.backups.length === 0" class="cb-empty">
          <Icon icon="tabler:cloud-off" width="32" height="32" />
          <p>{{ $t('No BuhoGO backups in your Drive yet.') }}</p>
        </div>
        <div v-else class="cb-list">
          <div
            v-for="b in store.backups"
            :key="b.id"
            class="cb-list-row"
            :class="$q.dark.isActive ? 'cb-list-row-dark' : 'cb-list-row-light'"
          >
            <Icon icon="tabler:file-zip" width="20" height="20" />
            <div class="cb-list-text">
              <div class="cb-list-name">{{ b.name }}</div>
              <div class="cb-list-meta">{{ formatDate(b.createdTime) }}</div>
            </div>
            <button class="cb-pill" @click="onPickBackup(b)" :disabled="busy">
              {{ $t('Restore') }}
            </button>
            <button class="cb-icon-btn" @click="onDeleteBackup(b)" :disabled="busy" :aria-label="$t('Delete')">
              <Icon icon="tabler:trash" width="16" height="16" />
            </button>
          </div>
        </div>
      </q-card-section>

      <!-- Step: RESTORE — enter passphrase for the picked file -->
      <q-card-section v-else-if="step === 'restore'" class="cb-body">
        <p class="cb-lede">
          {{ $t('Enter the passphrase you set when you created this backup.') }}
          <span v-if="pickedFile?.name" class="cb-pick-name">
            {{ pickedFile.name }}
          </span>
        </p>
        <q-input
          v-model="restorePassphrase"
          :type="showPassphrase ? 'text' : 'password'"
          :label="$t('Backup passphrase')"
          outlined
          dense
          :error="!!restoreError"
          :error-message="restoreError"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          class="cb-input"
        >
          <template v-slot:append>
            <q-btn flat dense round @click="showPassphrase = !showPassphrase" :aria-label="$t('Show')">
              <Icon :icon="showPassphrase ? 'tabler:eye-off' : 'tabler:eye'" width="16" height="16" />
            </q-btn>
          </template>
        </q-input>

        <div v-if="walletExistsWarning" class="cb-callout cb-callout--warn">
          <Icon icon="tabler:alert-triangle" width="18" height="18" class="cb-callout-icon" />
          <div class="cb-callout-text">
            {{ $t('A Spark wallet already exists on this device. The current wallet will be kept; only the identity seed will be replaced from the backup.') }}
          </div>
        </div>
      </q-card-section>

      <!-- Step: DONE -->
      <q-card-section v-else-if="step === 'done'" class="cb-body">
        <div class="cb-illustration cb-illustration--success">
          <Icon icon="tabler:cloud-check" width="40" height="40" />
        </div>
        <h2 class="cb-heading">{{ doneTitle }}</h2>
        <p class="cb-lede">{{ doneSubtitle }}</p>
      </q-card-section>

      <!-- Footer actions -->
      <q-card-actions class="cb-actions">
        <q-btn
          v-if="primaryLabel"
          unelevated
          no-caps
          class="cb-primary"
          :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'"
          :label="primaryLabel"
          :loading="busy"
          :disable="!primaryEnabled"
          @click="onPrimary"
        />
        <q-btn
          v-if="secondaryLabel"
          flat
          no-caps
          class="cb-secondary"
          :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
          :label="secondaryLabel"
          :disable="busy"
          @click="onSecondary"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script>
import { Icon } from '@iconify/vue';
import { useCloudBackupStore } from '../stores/cloudBackup.js';
import { WrongPassphraseError } from '../utils/backupCrypto.js';
import { useWalletStore } from '../stores/wallet.js';

export default {
  name: 'CloudBackupSheet',

  components: { Icon },

  props: {
    modelValue: { type: Boolean, required: true },
  },

  emits: ['update:modelValue', 'restored'],

  setup() {
    const store = useCloudBackupStore();
    const walletStore = useWalletStore();
    return { store, walletStore };
  },

  data() {
    return {
      step: 'sign-in',
      passphrase: '',
      passphraseConfirm: '',
      hint: '',
      showPassphrase: false,
      passphraseError: '',
      restorePassphrase: '',
      restoreError: '',
      pickedFile: null,
      doneTitle: '',
      doneSubtitle: '',
      // Set after a successful manual backup so we know we can ask the user
      // to enable auto-backup with the very passphrase they just used. We
      // hold this string only long enough to offer the prompt and clear it
      // either way (enable → cached encrypted; skip → dropped immediately).
      pendingAutoPassphrase: '',
    };
  },

  computed: {
    open: {
      get() { return this.modelValue; },
      set(v) { this.$emit('update:modelValue', v); },
    },

    busy() {
      return this.store.isAuthing || this.store.isBackingUp || this.store.isRestoring || this.store.isListing;
    },

    canGoBack() {
      return ['backup', 'pick', 'restore'].includes(this.step);
    },

    headerTitle() {
      if (this.step === 'unconfigured') return this.$t('Cloud backup');
      if (this.step === 'sign-in') return this.$t('Cloud backup');
      if (this.step === 'menu') return this.$t('Cloud backup');
      if (this.step === 'backup') return this.$t('Back up to Drive');
      if (this.step === 'pick') return this.$t('Choose a backup');
      if (this.step === 'restore') return this.$t('Restore backup');
      if (this.step === 'done') return this.$t('Done');
      return this.$t('Cloud backup');
    },

    walletExistsWarning() {
      return this.step === 'restore' && this.walletStore.hasAnySparkWallet;
    },

    /**
     * True iff we have a freshly-validated passphrase from the most recent
     * backup. The auto-backup toggle stays disabled in the "off → on"
     * direction until the user has run at least one manual backup, so we
     * know the cached passphrase actually matches what's on Drive.
     */
    canEnableAutoNow() {
      return Boolean(this.pendingAutoPassphrase);
    },

    primaryLabel() {
      switch (this.step) {
        case 'unconfigured': return '';
        case 'sign-in':      return this.$t('Connect Google account');
        case 'menu':         return '';
        case 'backup':       return this.$t('Encrypt and upload');
        case 'pick':         return '';
        case 'restore':      return this.$t('Decrypt and restore');
        case 'done':         return this.$t('Done');
        default:             return '';
      }
    },

    secondaryLabel() {
      switch (this.step) {
        case 'sign-in':  return this.$t('Cancel');
        case 'backup':   return this.$t('Cancel');
        case 'pick':     return this.$t('Cancel');
        case 'restore':  return this.$t('Cancel');
        default:         return '';
      }
    },

    primaryEnabled() {
      if (this.step === 'sign-in') return !this.busy;
      if (this.step === 'backup') {
        return (
          this.passphrase.length >= 8 &&
          this.passphrase === this.passphraseConfirm &&
          !this.busy
        );
      }
      if (this.step === 'restore') return this.restorePassphrase.length > 0 && !this.busy;
      return !this.busy;
    },
  },

  watch: {
    modelValue(isOpen) {
      if (!isOpen) return;
      this.resetLocalState();
      this.bootstrap();
    },
  },

  methods: {
    async bootstrap() {
      await this.store.init();
      if (!this.store.isConfigured) {
        this.step = 'unconfigured';
        return;
      }
      this.step = this.store.signedIn ? 'menu' : 'sign-in';
    },

    resetLocalState() {
      this.passphrase = '';
      this.passphraseConfirm = '';
      this.hint = '';
      this.showPassphrase = false;
      this.passphraseError = '';
      this.restorePassphrase = '';
      this.restoreError = '';
      this.pickedFile = null;
      this.doneTitle = '';
      this.doneSubtitle = '';
      this.pendingAutoPassphrase = '';
    },

    close() {
      if (this.busy) return;
      this.open = false;
    },

    goBack() {
      if (this.busy) return;
      if (this.step === 'restore') {
        this.step = 'pick';
        return;
      }
      this.step = 'menu';
    },

    async onPrimary() {
      switch (this.step) {
        case 'sign-in':  return this.onSignIn();
        case 'backup':   return this.onBackup();
        case 'restore':  return this.onRestore();
        case 'done':     this.open = false; return;
      }
    },

    onSecondary() {
      if (this.step === 'sign-in') { this.open = false; return; }
      this.goBack();
    },

    async onSignIn() {
      try {
        await this.store.signIn();
        this.step = 'menu';
      } catch (err) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Could not sign in'),
          caption: err?.message || String(err),
          timeout: 4000,
        });
      }
    },

    async onSignOut() {
      try {
        await this.store.signOut();
        // signOut() also clears the auto-backup passphrase, so reset our
        // local copy too — leaving it around would be a footgun if the
        // user signed back in with a different account.
        this.pendingAutoPassphrase = '';
        this.step = 'sign-in';
      } catch (err) {
        console.warn('[cb-sheet] sign out:', err);
      }
    },

    /**
     * Toggle handler. Turning auto-backup on requires a passphrase the
     * store can cache; that's only available right after a successful
     * manual backup (`pendingAutoPassphrase`). Turning it off is always
     * allowed — it just clears the cache.
     */
    async onToggleAutoBackup(next) {
      try {
        if (next) {
          if (!this.pendingAutoPassphrase) {
            // Should be unreachable via the UI (toggle is disabled in this
            // branch), but cheap to defend against.
            this.$q.notify({
              type: 'info',
              message: this.$t('Run a backup first, then turn this on.'),
              timeout: 3000,
            });
            return;
          }
          await this.store.enableAutoBackup(this.pendingAutoPassphrase);
          this.pendingAutoPassphrase = '';
          this.$q.notify({
            type: 'positive',
            message: this.$t('Automatic backup is on.'),
            timeout: 1500,
          });
        } else {
          await this.store.disableAutoBackup();
          this.$q.notify({
            type: 'info',
            message: this.$t('Automatic backup is off.'),
            timeout: 1500,
          });
        }
      } catch (err) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Could not change automatic backup setting'),
          caption: err?.message || String(err),
        });
      }
    },

    async onBackup() {
      this.passphraseError = '';
      if (this.passphrase.length < 8) {
        this.passphraseError = this.$t('Use at least 8 characters.');
        return;
      }
      if (this.passphrase !== this.passphraseConfirm) {
        this.passphraseError = this.$t('Passphrases do not match.');
        return;
      }
      try {
        await this.store.backup(this.passphrase, { hint: this.hint });
        // Hand the just-used passphrase to the auto-backup gate so the
        // user can opt in without re-typing it. We hold the string only
        // until the menu step (where the toggle either consumes it or we
        // drop it on close). It is never written to disk except via the
        // store action that encrypts it under the device key.
        this.pendingAutoPassphrase = this.passphrase;
        // Drop from input bindings immediately — `pendingAutoPassphrase`
        // is the only place it lives now until the toggle is touched.
        this.passphrase = '';
        this.passphraseConfirm = '';
        this.doneTitle = this.$t('Backup uploaded');
        this.doneSubtitle = this.$t('Your encrypted recovery file is now in your Google Drive. Keep your passphrase somewhere safe — you cannot recover the file without it.');
        this.step = 'done';
      } catch (err) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Backup failed'),
          caption: err?.message || String(err),
          timeout: 5000,
        });
      }
    },

    async onOpenRestoreList() {
      this.step = 'pick';
      try {
        await this.store.refresh();
      } catch (err) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Could not list backups'),
          caption: err?.message || String(err),
        });
      }
    },

    onPickBackup(file) {
      this.pickedFile = file;
      this.restorePassphrase = '';
      this.restoreError = '';
      this.step = 'restore';
    },

    async onDeleteBackup(file) {
      try {
        await this.store.deleteRemote(file.id);
        this.$q.notify({ type: 'positive', message: this.$t('Backup removed'), timeout: 1500 });
      } catch (err) {
        this.$q.notify({
          type: 'negative',
          message: this.$t('Delete failed'),
          caption: err?.message || String(err),
        });
      }
    },

    async onRestore() {
      this.restoreError = '';
      if (!this.pickedFile?.id) {
        this.restoreError = this.$t('Pick a backup first.');
        return;
      }
      try {
        const result = await this.store.restore(this.pickedFile.id, this.restorePassphrase);
        this.restorePassphrase = '';
        const parts = [];
        if (result.restoredSpark) parts.push(this.$t('Spark wallet restored'));
        if (result.restoredIdentity) parts.push(this.$t('Identity restored'));
        this.doneTitle = this.$t('Restore complete');
        this.doneSubtitle = parts.length
          ? parts.join(' · ')
          : this.$t('Nothing new to restore — your wallet was already in place.');
        this.$emit('restored', result);
        this.step = 'done';
      } catch (err) {
        if (err instanceof WrongPassphraseError || err?.code === 'WRONG_PASSPHRASE') {
          this.restoreError = this.$t('Wrong passphrase or the file is corrupted.');
          return;
        }
        this.$q.notify({
          type: 'negative',
          message: this.$t('Restore failed'),
          caption: err?.message || String(err),
          timeout: 5000,
        });
      }
    },

    formatDate(iso) {
      if (!iso) return '';
      try {
        const d = new Date(iso);
        return d.toLocaleString();
      } catch {
        return iso;
      }
    },
  },
};
</script>

<style scoped>
.cb-sheet {
  width: 100%;
  max-width: 520px;
  border-radius: 20px 20px 0 0;
  overflow: hidden;
}

.sheet-handle {
  display: flex;
  justify-content: center;
  padding: 6px 0 0;
}
.sheet-handle-bar-light, .sheet-handle-bar-dark {
  display: block;
  width: 36px;
  height: 4px;
  border-radius: 4px;
}
.sheet-handle-bar-light { background: rgba(15, 23, 42, 0.18); }
.sheet-handle-bar-dark  { background: rgba(255, 255, 255, 0.22); }

.cb-header {
  display: grid;
  grid-template-columns: 36px 1fr 36px;
  align-items: center;
  padding: 10px 16px 8px;
}
.cb-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.cb-title {
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  font-weight: 600;
  text-align: center;
}

.cb-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 8px 20px 16px;
  text-align: center;
}
.cb-body--list { gap: 8px; align-items: stretch; text-align: left; }

.cb-illustration {
  width: 72px;
  height: 72px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(21, 222, 114, 0.12);
  color: #15DE72;
}
.cb-illustration--warn {
  background: rgba(244, 114, 22, 0.12);
  color: #f47216;
}
.cb-illustration--success {
  background: rgba(21, 222, 114, 0.18);
  color: #15DE72;
}

.cb-heading {
  font-family: 'Manrope', sans-serif;
  font-size: 19px;
  font-weight: 700;
  margin: 4px 0 0;
}

.cb-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
  max-width: 380px;
  color: inherit;
  opacity: 0.85;
}

.cb-pick-name {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.7;
  word-break: break-all;
}

.cb-callout {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  border-left: 2px solid #15DE72;
  text-align: left;
  width: 100%;
  font-size: 13px;
  line-height: 1.45;
}
.cb-callout--warn { border-left-color: #f47216; }
.cb-callout-light { background: rgba(21, 222, 114, 0.06); color: #0f172a; }
.cb-callout-dark  { background: rgba(255, 255, 255, 0.04); color: #e2e8f0; }
.cb-callout-icon { flex: 0 0 auto; color: inherit; }

.cb-account-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
}
.cb-account-light { background: rgba(21, 222, 114, 0.06); color: #0f172a; }
.cb-account-dark  { background: rgba(255, 255, 255, 0.04); color: #e2e8f0; }
.cb-account-email {
  flex: 1;
  text-align: left;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cb-account-signout {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #ef4444;
  padding: 0;
}
.cb-account-signout:disabled { opacity: 0.5; }

.cb-last-backup {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0.7;
  align-self: flex-start;
}

.cb-auto-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  font-family: 'Manrope', sans-serif;
}
.cb-auto-row-light { background: rgba(15, 23, 42, 0.04); color: #0f172a; }
.cb-auto-row-dark  { background: rgba(255, 255, 255, 0.04); color: #f1f5f9; }
.cb-auto-text { flex: 1; min-width: 0; text-align: left; }
.cb-auto-title { font-size: 13px; font-weight: 600; }
.cb-auto-sub { font-size: 11px; opacity: 0.7; margin-top: 2px; line-height: 1.4; }

.cb-menu-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px;
  border-radius: 14px;
  border: none;
  font-family: 'Manrope', sans-serif;
  text-align: left;
  cursor: pointer;
}
.cb-menu-row:disabled { opacity: 0.5; cursor: not-allowed; }
.cb-menu-row-light { background: rgba(15, 23, 42, 0.04); color: #0f172a; }
.cb-menu-row-dark  { background: rgba(255, 255, 255, 0.04); color: #f1f5f9; }
.cb-menu-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(21, 222, 114, 0.12);
  color: #15DE72;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cb-menu-text { flex: 1; min-width: 0; }
.cb-menu-title { font-size: 14px; font-weight: 600; }
.cb-menu-sub { font-size: 12px; opacity: 0.7; margin-top: 2px; }

.cb-input { width: 100%; max-width: 420px; }

.cb-list { display: flex; flex-direction: column; gap: 6px; }
.cb-list-loading,
.cb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 12px;
  font-size: 13px;
  opacity: 0.75;
}
.cb-list-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  font-family: 'Manrope', sans-serif;
}
.cb-list-row-light { background: rgba(15, 23, 42, 0.04); color: #0f172a; }
.cb-list-row-dark  { background: rgba(255, 255, 255, 0.04); color: #f1f5f9; }
.cb-list-text { flex: 1; min-width: 0; }
.cb-list-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cb-list-meta { font-size: 11px; opacity: 0.7; margin-top: 2px; }
.cb-pill {
  background: #15DE72;
  color: #fff;
  border: none;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.cb-pill:disabled { opacity: 0.5; cursor: not-allowed; }
.cb-icon-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
  padding: 4px;
}
.cb-icon-btn:hover { opacity: 1; }

.cb-actions {
  padding: 0 20px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.cb-primary {
  width: 100%;
  max-width: 360px;
  height: 48px;
  border-radius: 24px;
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 500;
}
.cb-secondary {
  width: 100%;
  max-width: 360px;
  height: 40px;
  border-radius: 20px;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
}
</style>
