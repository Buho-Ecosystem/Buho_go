<!--
  CloudBackupSheet

  Self-contained bottom sheet covering the whole Google Drive backup
  lifecycle: sign in, create or replace the backup, restore from it,
  delete it, sign out.

  Crypto and orchestration live in stores/cloudBackup.js; the native Drive
  transport lives behind services/cloudStorage.js. This component is
  presentation + flow control only and never sees a decrypted seed phrase.

  There is exactly ONE backup per Google account (a new backup overwrites
  the old one), so there is no file picker: backup and restore both act on
  the canonical file.

  The `intent` prop lets entry points steer the flow: Settings opens with
  'backup', the welcome screen's recovery entry opens with 'restore' and
  jumps straight to the restore step once signed in.
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
          :disable="store.isBackingUp || store.isRestoring"
          @click="close"
          :class="$q.dark.isActive ? 'close_btn_dark' : 'close_btn_light'"
          :aria-label="$t('Close')"
        >
          <Icon icon="tabler:x" width="18" height="18" />
        </q-btn>
      </q-card-section>

      <!-- Step: CHECKING -->
      <q-card-section v-if="step === 'checking'" class="cb-body">
        <div class="cb-list-loading">
          <q-spinner-dots size="28px" />
          <span>{{ $t('Checking Google Drive...') }}</span>
        </div>
      </q-card-section>

      <!-- Step: UNAVAILABLE — platform has no cloud backup implementation -->
      <q-card-section v-else-if="step === 'unavailable'" class="cb-body">
        <div class="cb-illustration cb-illustration--warn">
          <Icon icon="tabler:cloud-off" width="40" height="40" />
        </div>
        <h2 class="cb-heading">{{ $t('Cloud backup is not available here') }}</h2>
        <p class="cb-lede">
          {{ $t('Google Drive backup works in the BuhoGO Android app. Install it on your phone to back up there.') }}
        </p>
      </q-card-section>

      <!-- Step: SIGN IN -->
      <q-card-section v-else-if="step === 'sign-in'" class="cb-body">
        <div class="cb-illustration">
          <Icon icon="tabler:cloud-lock" width="40" height="40" />
        </div>
        <h2 class="cb-heading">{{ $t('Google Drive backup') }}</h2>
        <p class="cb-lede">
          {{ $t('Keeps a backup of your wallets and Nostr identity in your Google Drive, so you can bring them back on a new phone.') }}
        </p>
        <div class="cb-callout" :class="$q.dark.isActive ? 'cb-callout-dark' : 'cb-callout-light'">
          <Icon icon="tabler:shield-check" width="18" height="18" class="cb-callout-icon" />
          <div class="cb-callout-text">
            {{ $t('BuhoGO only sees files it created itself. Your other Drive files stay private.') }}
          </div>
        </div>
        <div v-if="signInError" class="cb-callout cb-callout--warn">
          <Icon icon="tabler:alert-triangle" width="18" height="18" class="cb-callout-icon" />
          <div class="cb-callout-text">{{ signInError }}</div>
        </div>
      </q-card-section>

      <!-- Step: MENU — signed in -->
      <q-card-section v-else-if="step === 'menu'" class="cb-body">
        <div class="cb-account-row" :class="$q.dark.isActive ? 'cb-account-dark' : 'cb-account-light'">
          <Icon icon="tabler:user-circle" width="18" height="18" />
          <span class="cb-account-email">{{ store.signedInEmail || $t('Signed in') }}</span>
          <button class="cb-account-signout" :disabled="busy" @click="onSignOut">
            {{ $t('Sign out') }}
          </button>
        </div>

        <div v-if="store.newestBackupAt" class="cb-last-backup">
          <Icon icon="tabler:clock" width="14" height="14" />
          <span>{{ $t('Last backup:') }} {{ formatDate(store.newestBackupAt) }}</span>
        </div>

        <button
          class="cb-menu-row"
          :class="$q.dark.isActive ? 'cb-menu-row-dark' : 'cb-menu-row-light'"
          :disabled="!store.hasBackupableSecret || busy"
          @click="step = 'backup'"
        >
          <div class="cb-menu-icon"><Icon icon="tabler:cloud-upload" width="22" height="22" /></div>
          <div class="cb-menu-text">
            <div class="cb-menu-title">
              {{ store.hasRemoteBackup ? $t('Back up again') : $t('Back up now') }}
            </div>
            <div class="cb-menu-sub">
              {{
                store.hasBackupableSecret
                  ? $t('Upload your wallets and Nostr identity. Replaces the previous backup.')
                  : $t('Create or restore a wallet first.')
              }}
            </div>
          </div>
          <Icon icon="tabler:chevron-right" width="16" height="16" />
        </button>

        <button
          class="cb-menu-row"
          :class="$q.dark.isActive ? 'cb-menu-row-dark' : 'cb-menu-row-light'"
          :disabled="!store.hasRemoteBackup || busy"
          @click="step = 'restore'"
        >
          <div class="cb-menu-icon"><Icon icon="tabler:cloud-download" width="22" height="22" /></div>
          <div class="cb-menu-text">
            <div class="cb-menu-title">{{ $t('Restore from backup') }}</div>
            <div class="cb-menu-sub">
              {{ store.hasRemoteBackup
                ? $t('Bring back wallets that are missing on this device.')
                : $t('No backup in this Google account yet.') }}
            </div>
          </div>
          <Icon icon="tabler:chevron-right" width="16" height="16" />
        </button>

        <button
          v-if="store.hasRemoteBackup"
          class="cb-menu-row"
          :class="$q.dark.isActive ? 'cb-menu-row-dark' : 'cb-menu-row-light'"
          :disabled="busy"
          @click="onDeleteBackup"
        >
          <div class="cb-menu-icon cb-menu-icon--danger"><Icon icon="tabler:trash" width="20" height="20" /></div>
          <div class="cb-menu-text">
            <div class="cb-menu-title">{{ $t('Delete backup') }}</div>
            <div class="cb-menu-sub">{{ $t('Remove the backup file from your Google Drive.') }}</div>
          </div>
          <Icon icon="tabler:chevron-right" width="16" height="16" />
        </button>
      </q-card-section>

      <!-- Step: BACKUP — confirm -->
      <q-card-section v-else-if="step === 'backup'" class="cb-body">
        <div class="cb-illustration">
          <Icon icon="tabler:cloud-upload" width="40" height="40" />
        </div>
        <p class="cb-lede">
          {{ $t('Your wallets and Nostr identity will be backed up to your Google Drive.') }}
        </p>
        <div v-if="store.hasRemoteBackup" class="cb-callout cb-callout--warn">
          <Icon icon="tabler:alert-triangle" width="18" height="18" class="cb-callout-icon" />
          <div class="cb-callout-text">
            {{ $t('This replaces the existing backup in your Drive.') }}
          </div>
        </div>
      </q-card-section>

      <!-- Step: RESTORE — confirm -->
      <q-card-section v-else-if="step === 'restore'" class="cb-body">
        <div class="cb-illustration">
          <Icon icon="tabler:cloud-download" width="40" height="40" />
        </div>
        <p class="cb-lede">
          {{ $t('Bring back the wallets and Nostr identity from the backup in your Google Drive.') }}
        </p>

        <div class="cb-callout" :class="$q.dark.isActive ? 'cb-callout-dark' : 'cb-callout-light'">
          <Icon icon="tabler:info-circle" width="18" height="18" class="cb-callout-icon" />
          <div class="cb-callout-text">
            {{ $t('Restoring adds whatever is missing on this device. Wallets and the Nostr identity already set up here are kept as they are.') }}
          </div>
        </div>

        <div v-if="restoreError" class="cb-callout cb-callout--warn">
          <Icon icon="tabler:alert-triangle" width="18" height="18" class="cb-callout-icon" />
          <div class="cb-callout-text">{{ restoreError }}</div>
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

export default {
  name: 'CloudBackupSheet',

  components: { Icon },

  props: {
    modelValue: { type: Boolean, required: true },
    /**
     * What the user came here to do. 'restore' (welcome screen) jumps
     * straight to the restore step after sign-in when a backup exists;
     * 'backup' (Settings) lands on the menu.
     */
    intent: {
      type: String,
      default: 'backup',
      validator: (v) => ['backup', 'restore'].includes(v),
    },
  },

  emits: ['update:modelValue', 'restored'],

  setup() {
    const store = useCloudBackupStore();
    return { store };
  },

  data() {
    return {
      step: 'checking',
      restoreError: '',
      signInError: '',
      // True when the last sign-in failure smells like an OAuth/consent
      // state worth escaping via revoke; shows "Sign out and retry".
      offerSignOutRetry: false,
      doneTitle: '',
      doneSubtitle: '',
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
      return ['backup', 'restore'].includes(this.step);
    },

    headerTitle() {
      if (this.step === 'backup') return this.$t('Back up to Drive');
      if (this.step === 'restore') return this.$t('Restore backup');
      if (this.step === 'done') return this.$t('Done');
      return this.$t('Cloud backup');
    },

    primaryLabel() {
      switch (this.step) {
        case 'sign-in': return this.$t('Connect Google account');
        case 'backup':  return this.$t('Back up now');
        case 'restore': return this.$t('Restore');
        case 'done':    return this.$t('Done');
        default:        return '';
      }
    },

    secondaryLabel() {
      if (this.step === 'sign-in') {
        return this.offerSignOutRetry ? this.$t('Sign out and retry') : this.$t('Cancel');
      }
      if (['backup', 'restore'].includes(this.step)) return this.$t('Cancel');
      return '';
    },

    primaryEnabled() {
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
      this.step = 'checking';
      this.store.init();
      try {
        const available = await this.store.checkAvailability();
        if (!available) {
          this.step = 'unavailable';
          return;
        }
        // refresh() doubles as the signed-in probe: success proves the
        // grant works, "auth-required" leaves signedIn false. Any other
        // rejection is a connectivity/service problem and must not be
        // presented as "you are signed out" — that road leads a signed-in
        // user into a pointless account chooser with misleading errors.
        try {
          await this.store.refresh();
        } catch (err) {
          console.warn('[cb-sheet] bootstrap probe:', err);
          this.step = 'sign-in';
          this.signInError = this.$t('Could not reach Google Drive. Check your connection and try again.');
          return;
        }
        if (!this.store.signedIn) {
          this.step = 'sign-in';
          return;
        }
        this.afterAuth();
      } catch (err) {
        console.warn('[cb-sheet] bootstrap:', err);
        this.step = 'sign-in';
      }
    },

    /** Land on the step matching what the user came to do. */
    afterAuth() {
      if (this.intent === 'restore' && this.store.hasRemoteBackup) {
        this.step = 'restore';
        return;
      }
      this.step = 'menu';
    },

    resetLocalState() {
      this.restoreError = '';
      this.signInError = '';
      this.offerSignOutRetry = false;
      this.doneTitle = '';
      this.doneSubtitle = '';
    },

    close() {
      // Only a mutation in flight blocks closing. A slow or wedged probe,
      // sign-in, or listing must never trap the user in the sheet.
      if (this.store.isBackingUp || this.store.isRestoring) return;
      this.open = false;
    },

    goBack() {
      if (this.busy) return;
      this.step = 'menu';
    },

    async onPrimary() {
      switch (this.step) {
        case 'sign-in': return this.onSignIn();
        case 'backup':  return this.onBackup();
        case 'restore': return this.onRestore();
        case 'done':    this.open = false; return;
      }
    },

    onSecondary() {
      if (this.step === 'sign-in') {
        if (this.offerSignOutRetry) return this.onSignOutRetry();
        this.open = false;
        return;
      }
      this.goBack();
    },

    /**
     * Map the native plugin's raw failure reasons to actionable copy. The
     * raw reason is appended for bug reports; the headline tells the user
     * (or the developer testing a build) what to actually do.
     */
    signInReasonToMessage(reason) {
      const r = String(reason || '');
      if (/user-cancelled|cancelled/i.test(r)) {
        return this.$t('Sign-in was cancelled.');
      }
      if (/auth-required|not-signed-in/i.test(r)) {
        return this.$t('Please sign in to Google again.');
      }
      if (/network-error/i.test(r)) {
        return this.$t('Network error. Check your connection and try again.');
      }
      if (/drive-scope-not-granted|consent-declined|needs-additional-consent/i.test(r)) {
        return this.$t('Google Drive access was not granted. Sign in again and allow the Drive permission.');
      }
      if (/developer-error|sha1|12500|sign-in-failed/i.test(r)) {
        return this.$t('Google sign-in is not set up for this build. The app package and signing key must be registered in Google Cloud Console.');
      }
      return r;
    },

    async onSignIn() {
      this.signInError = '';
      try {
        await this.store.signIn();
        this.afterAuth();
      } catch (err) {
        const reason = err?.reason || err?.message || String(err);
        this.signInError = this.signInReasonToMessage(reason);
        // A wedged consent/config state is best escaped by revoking and
        // starting clean; a plain cancel is not.
        this.offerSignOutRetry = !/user-cancelled|cancelled/i.test(reason);
      }
    },

    /** Escape hatch for a wedged OAuth state: revoke, then sign in fresh. */
    async onSignOutRetry() {
      try {
        await this.store.signOut();
      } catch (err) {
        console.warn('[cb-sheet] sign out before retry:', err);
      }
      this.signInError = '';
      this.offerSignOutRetry = false;
      await this.onSignIn();
    },

    async onSignOut() {
      try {
        await this.store.signOut();
        this.step = 'sign-in';
      } catch (err) {
        console.warn('[cb-sheet] sign out:', err);
      }
    },

    async onBackup() {
      try {
        await this.store.backup();
        this.doneTitle = this.$t('Backup uploaded');
        this.doneSubtitle = this.$t('Your backup is now in your Google Drive.');
        this.step = 'done';
      } catch (err) {
        if (!this.store.signedIn) {
          this.step = 'sign-in';
          this.signInError = this.$t('Please sign in to Google again.');
          return;
        }
        this.$q.notify({
          type: 'negative',
          message: this.$t('Backup failed'),
          caption: err?.message || String(err),
          timeout: 5000,
        });
      }
    },

    async onRestore() {
      this.restoreError = '';
      try {
        const result = await this.store.restore();
        this.doneTitle = this.$t('Restore complete');
        this.doneSubtitle = this.describeRestoreResult(result);
        this.$emit('restored', result);
        this.step = 'done';
      } catch (err) {
        if (
          err instanceof WrongPassphraseError ||
          err?.code === 'WRONG_PASSPHRASE' ||
          err?.code === 'BACKUP_UNREADABLE' ||
          err?.code === 'UNSUPPORTED_PAYLOAD'
        ) {
          this.restoreError = this.$t('This backup cannot be read. Create a new backup from the device that has your wallets.');
          return;
        }
        if (err?.code === 'NO_BACKUP_FOUND') {
          this.restoreError = this.$t('No backup in this Google account yet.');
          return;
        }
        if (!this.store.signedIn) {
          this.step = 'sign-in';
          this.signInError = this.$t('Please sign in to Google again.');
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

    /** One human sentence per outcome bucket, joined for the done screen. */
    describeRestoreResult(result) {
      const label = (l) => {
        if (l === 'spark') return this.$t('Spark wallet');
        if (l === 'arkade') return this.$t('Arkade wallet');
        if (l === 'identity') return this.$t('Nostr identity');
        return l;
      };
      const parts = [];
      if (result.restored.length) {
        parts.push(`${this.$t('Restored:')} ${result.restored.map(label).join(', ')}`);
      }
      if (result.skipped.length) {
        parts.push(`${this.$t('Already on this device:')} ${result.skipped.map(label).join(', ')}`);
      }
      if (result.failed.length) {
        parts.push(`${this.$t('Could not restore:')} ${result.failed.map((f) => label(f.label)).join(', ')}`);
      }
      if (!parts.length) {
        return this.$t('Nothing new to restore. Everything was already in place.');
      }
      return parts.join(' · ');
    },

    async onDeleteBackup() {
      this.$q.dialog({
        title: this.$t('Delete backup'),
        message: this.$t('Remove the backup from your Google Drive? You can create a new one at any time.'),
        cancel: true,
        persistent: true,
      }).onOk(async () => {
        try {
          await this.store.deleteRemote();
          this.$q.notify({ type: 'positive', message: this.$t('Backup removed'), timeout: 1500 });
        } catch (err) {
          this.$q.notify({
            type: 'negative',
            message: this.$t('Delete failed'),
            caption: err?.message || String(err),
          });
        }
      });
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
.cb-menu-icon--danger {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}
.cb-menu-text { flex: 1; min-width: 0; }
.cb-menu-title { font-size: 14px; font-weight: 600; }
.cb-menu-sub { font-size: 12px; opacity: 0.7; margin-top: 2px; }

.cb-input { width: 100%; max-width: 420px; }

.cb-list-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 12px;
  font-size: 13px;
  opacity: 0.75;
}

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
