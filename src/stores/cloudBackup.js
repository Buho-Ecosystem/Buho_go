/**
 * Cloud Backup Store
 *
 * Coordinates between the local wallet/identity stores and Google Drive.
 * Holds no secrets in state — the seed phrase only exists as a local
 * variable for the duration of a backup or restore call, mirroring the
 * pattern used in the identity store.
 *
 * Payload format inside the encrypted envelope (version 1):
 *   {
 *     v: 1,
 *     spark: {                       // present iff a Spark wallet exists
 *       mnemonic: string,
 *       network: 'MAINNET' | 'TESTNET',
 *     },
 *     identity: {                    // present iff an identity exists
 *       mnemonic: string,
 *     },
 *   }
 *
 * The envelope itself (salt, IV, KDF params, ciphertext) is handled by
 * utils/backupCrypto. The Drive transport (upload/list/download/delete)
 * is handled by utils/googleDrive. This store is the seam between them
 * and the rest of the app.
 */

import { defineStore } from 'pinia';
import { encryptBackup, decryptBackup } from '../utils/backupCrypto.js';
import { encryptString, decryptString } from '../utils/deviceCrypto.js';
import {
  configureGoogleAuth,
  signIn as oauthSignIn,
  signOut as oauthSignOut,
  isSignedIn as oauthIsSignedIn,
  signedInEmail as oauthSignedInEmail,
} from '../utils/googleOAuth.js';
import {
  uploadBackup,
  listBackups,
  downloadBackup,
  deleteBackup,
} from '../utils/googleDrive.js';
import {
  getCloudBackupConfig,
  isCloudBackupConfigured,
} from '../utils/cloudBackupConfig.js';
import { useWalletStore } from './wallet.js';
import { useIdentityStore } from './identity.js';

const STATE_KEY_LAST_BACKUP = 'buhoGO_cloud_backup_meta_v1';
const STATE_KEY_AUTO = 'buhoGO_cloud_backup_auto_v1';
const PAYLOAD_VERSION = 1;

// Minimum gap between automatic backups when the app moves to the
// foreground. Manual backups always run regardless. 24 h matches the spec's
// "app backgrounded → backup if >24 hours since last".
const AUTO_BACKUP_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function readMeta() {
  try {
    const raw = localStorage.getItem(STATE_KEY_LAST_BACKUP);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeMeta(meta) {
  if (!meta) {
    localStorage.removeItem(STATE_KEY_LAST_BACKUP);
    return;
  }
  localStorage.setItem(STATE_KEY_LAST_BACKUP, JSON.stringify(meta));
}

/**
 * Threat model for the cached passphrase:
 *
 *   - We encrypt the passphrase with the same device key that already
 *     protects the on-disk encrypted mnemonic. This means a Drive-account
 *     compromise on its own *cannot* recover the seed — the attacker would
 *     also need the device's localStorage to read the passphrase, and the
 *     device's localStorage to read the encrypted mnemonic envelope it
 *     would also need to unlock with the same key.
 *
 *   - A device-level compromise gets the attacker the seed regardless of
 *     cloud backup; caching the passphrase doesn't change that calculus.
 *
 *   - The user can opt out at any time via the auto-backup toggle, which
 *     immediately removes both the cached passphrase and the persisted
 *     opt-in flag.
 */
async function readAuto() {
  try {
    const raw = localStorage.getItem(STATE_KEY_AUTO);
    if (!raw) return null;
    const meta = JSON.parse(raw);
    if (!meta?.envelope) return null;
    const passphrase = await decryptString(meta.envelope);
    return { passphrase, enabledAt: meta.enabledAt || null };
  } catch (err) {
    // Decryption failure can happen if the device key was rotated/cleared
    // (full wipe). Drop the stale state rather than throwing on every
    // call into the store.
    console.warn('[cloudBackup] failed to read cached passphrase:', err);
    localStorage.removeItem(STATE_KEY_AUTO);
    return null;
  }
}

async function writeAuto(passphrase) {
  if (!passphrase) {
    localStorage.removeItem(STATE_KEY_AUTO);
    return;
  }
  const envelope = await encryptString(passphrase);
  localStorage.setItem(STATE_KEY_AUTO, JSON.stringify({
    envelope,
    enabledAt: new Date().toISOString(),
  }));
}

export const useCloudBackupStore = defineStore('cloudBackup', {
  state: () => ({
    /** True once OAuth client config is wired up (idempotent). */
    initialized: false,
    /** Email of the signed-in Google account, or null. */
    signedInEmail: null,
    /** True if a refresh token (or unexpired access token) is on disk. */
    signedIn: false,
    /** True while the OAuth consent flow is in progress. */
    isAuthing: false,
    /** True while a backup upload is in flight. */
    isBackingUp: false,
    /** True while a restore (download + decrypt + import) is in flight. */
    isRestoring: false,
    /** Cached list of remote backups for the Settings UI. */
    backups: [],
    /** True while we're refreshing the backups list. */
    isListing: false,
    /** ISO timestamp of the most recent successful backup, if any. */
    lastBackupAt: null,
    /** Drive file ID of the most recent backup we created. */
    lastBackupId: null,
    /**
     * True iff the user has opted into automatic backups. Auto-backup
     * requires a cached passphrase (encrypted with the device key); turning
     * the toggle off clears it. The state is persisted to localStorage so
     * a reload doesn't surprise the user with a different behaviour.
     */
    autoBackupEnabled: false,
    /** Last error from any cloud op, for UI surfacing. */
    lastError: null,
  }),

  getters: {
    /** True iff the build was compiled with OAuth client IDs configured. */
    isConfigured: () => isCloudBackupConfigured(),

    /** True iff there is at least one local secret eligible for backup. */
    hasBackupableSecret() {
      const wallet = useWalletStore();
      const identity = useIdentityStore();
      return Boolean(wallet.hasAnySparkWallet || identity.bootstrapped);
    },
  },

  actions: {
    /**
     * Wire up OAuth config and load any persisted state. Safe to call
     * multiple times — subsequent calls are a no-op. Should be called once
     * at app boot (e.g. from a Quasar boot file or the Settings page on
     * mount), before any other action here.
     */
    async init() {
      if (this.initialized) return;
      this.initialized = true;

      const meta = readMeta();
      if (meta) {
        this.lastBackupAt = meta.lastBackupAt || null;
        this.lastBackupId = meta.lastBackupId || null;
      }

      if (!isCloudBackupConfigured()) {
        // Without OAuth credentials we can still render a "not available"
        // state in Settings; we just can't sign in. Don't throw here.
        return;
      }

      const cfg = getCloudBackupConfig();
      configureGoogleAuth(cfg);

      // Resolve cached sign-in state for the UI without forcing a network
      // round-trip. The auth helper returns true if a refresh token is on
      // disk; the next Drive call will validate it.
      this.signedIn = await oauthIsSignedIn();
      this.signedInEmail = await oauthSignedInEmail();

      const auto = await readAuto();
      this.autoBackupEnabled = Boolean(auto?.passphrase);
    },

    async signIn() {
      if (!this.isConfigured) {
        throw new Error('Cloud backup is not configured in this build.');
      }
      this.isAuthing = true;
      this.lastError = null;
      try {
        const { email } = await oauthSignIn();
        this.signedIn = true;
        this.signedInEmail = email;
      } catch (err) {
        this.lastError = err?.message || String(err);
        throw err;
      } finally {
        this.isAuthing = false;
      }
    },

    async signOut() {
      try {
        await oauthSignOut();
      } finally {
        this.signedIn = false;
        this.signedInEmail = null;
        this.backups = [];
        // Auto-backup without an account is meaningless and would leak
        // the cached passphrase past the user's apparent "I'm done" gesture.
        await writeAuto(null);
        this.autoBackupEnabled = false;
      }
    },

    /**
     * Enable automatic backups going forward. Stores the passphrase
     * encrypted with the device key so subsequent triggers can run without
     * prompting the user. The caller must have just successfully completed
     * a backup with this same passphrase (i.e. we know the passphrase is
     * the one matching the live encrypted file on Drive).
     *
     * @param {string} passphrase
     */
    async enableAutoBackup(passphrase) {
      if (typeof passphrase !== 'string' || passphrase.length === 0) {
        throw new Error('Cannot enable auto-backup without a passphrase');
      }
      await writeAuto(passphrase);
      this.autoBackupEnabled = true;
    },

    async disableAutoBackup() {
      await writeAuto(null);
      this.autoBackupEnabled = false;
    },

    /**
     * Run a silent backup if the user has opted in AND there's something
     * eligible to back up AND we're past the minimum interval. Errors are
     * logged but never thrown — auto-backup is a best-effort background
     * operation and must not interfere with whatever flow triggered it
     * (e.g. mnemonic verification UX would otherwise stall on a Drive
     * outage).
     *
     * @param {object} [opts]
     * @param {boolean} [opts.bypassInterval]  Skip the >24 h gate. Used
     *                                          when the trigger is a
     *                                          one-shot event (wallet
     *                                          created, mnemonic verified)
     *                                          rather than a periodic check.
     */
    async runAutoBackupIfDue(opts = {}) {
      if (!this.autoBackupEnabled) return false;
      if (!this.signedIn) return false;
      if (!this.hasBackupableSecret) return false;
      if (this.isBackingUp || this.isRestoring) return false;

      if (!opts.bypassInterval && this.lastBackupAt) {
        const last = Date.parse(this.lastBackupAt);
        if (Number.isFinite(last) && Date.now() - last < AUTO_BACKUP_MIN_INTERVAL_MS) {
          return false;
        }
      }

      const auto = await readAuto();
      if (!auto?.passphrase) {
        // The toggle says "on" but the cached envelope is gone (device
        // wipe, manual localStorage edit). Flip the flag back so the UI
        // doesn't keep advertising auto-backup is on.
        this.autoBackupEnabled = false;
        return false;
      }

      try {
        await this.backup(auto.passphrase, { silent: true });
        return true;
      } catch (err) {
        console.warn('[cloudBackup] auto-backup failed:', err);
        return false;
      }
    },

    /**
     * Build the plaintext payload from the live stores. The mnemonic
     * strings exist only inside this function — they are passed straight
     * into encryptBackup() and dropped, never assigned to store state.
     */
    async _gatherPayload() {
      const wallet = useWalletStore();
      const identity = useIdentityStore();

      const payload = { v: PAYLOAD_VERSION };

      if (wallet.hasAnySparkWallet) {
        const sparkMnemonic = await wallet.getSparkMnemonic();
        const network =
          wallet.activeWallet?.connectionData?.network ||
          wallet.sparkWallet?.connectionData?.network ||
          'MAINNET';
        payload.spark = { mnemonic: sparkMnemonic, network };
      }

      if (identity.bootstrapped) {
        const identityMnemonic = await identity.getMnemonic();
        payload.identity = { mnemonic: identityMnemonic };
      }

      if (!payload.spark && !payload.identity) {
        const err = new Error('Nothing to back up yet');
        err.code = 'NOTHING_TO_BACKUP';
        throw err;
      }
      return payload;
    },

    /**
     * Encrypt the local wallet + identity seeds under `passphrase` and
     * upload the resulting envelope to Google Drive.
     *
     * @param {string} passphrase
     * @param {object} [opts]
     * @param {string} [opts.hint]  Optional cleartext hint stored alongside
     *                              the envelope.
     */
    async backup(passphrase, opts = {}) {
      if (!this.signedIn) {
        throw new Error('Sign in to Google before backing up.');
      }
      this.isBackingUp = true;
      this.lastError = null;
      try {
        const payload = await this._gatherPayload();
        const envelope = await encryptBackup(payload, passphrase, {
          hint: opts.hint || '',
        });
        const file = await uploadBackup(envelope);

        const meta = {
          lastBackupAt: envelope.createdAt,
          lastBackupId: file.id,
        };
        writeMeta(meta);
        this.lastBackupAt = meta.lastBackupAt;
        this.lastBackupId = meta.lastBackupId;

        // Refresh the list so the Settings UI shows the new entry.
        await this.refresh();
        return file;
      } catch (err) {
        this.lastError = err?.message || String(err);
        throw err;
      } finally {
        this.isBackingUp = false;
      }
    },

    /**
     * Fetch the list of backups in the user's Drive.
     */
    async refresh() {
      if (!this.signedIn) {
        this.backups = [];
        return;
      }
      this.isListing = true;
      try {
        this.backups = await listBackups();
      } catch (err) {
        if (err?.message === 'NOT_SIGNED_IN') {
          this.signedIn = false;
          this.signedInEmail = null;
          this.backups = [];
          return;
        }
        this.lastError = err?.message || String(err);
        throw err;
      } finally {
        this.isListing = false;
      }
    },

    /**
     * Download a backup file, decrypt it, and import the contained seeds
     * into the wallet and identity stores. Caller is responsible for
     * confirming the user wants to overwrite any existing wallet — this
     * action does NOT prompt.
     *
     * @param {string} fileId
     * @param {string} passphrase
     * @returns {Promise<{ restoredSpark: boolean, restoredIdentity: boolean }>}
     */
    async restore(fileId, passphrase) {
      this.isRestoring = true;
      this.lastError = null;
      try {
        const envelope = await downloadBackup(fileId);
        const payload = await decryptBackup(envelope, passphrase);

        if (!payload || payload.v !== PAYLOAD_VERSION) {
          throw new Error('Unsupported backup payload version');
        }

        const identity = useIdentityStore();
        const wallet = useWalletStore();

        let restoredIdentity = false;
        let restoredSpark = false;

        if (payload.identity?.mnemonic) {
          await identity.importMnemonic(payload.identity.mnemonic, true);
          restoredIdentity = true;
          // The import lands on NIP-06 account 0; the published
          // identity pointer says which account was actually active.
          // Best-effort and bounded — no pointer (or no network)
          // means account 0 stays, which is always safe.
          try {
            await identity.resolveActiveNostrAccount();
          } catch (err) {
            console.warn('[cloudBackup] pointer discovery after restore failed:', err);
          }
        }

        if (payload.spark?.mnemonic && !wallet.hasAnySparkWallet) {
          // Only restore Spark if there isn't already one locally. The
          // user has to wipe first to overwrite — protects against a
          // restore on top of a freshly-generated wallet they meant to
          // use rather than discard.
          await wallet.addSparkWallet({
            mnemonic: payload.spark.mnemonic,
            network: payload.spark.network || 'MAINNET',
            isRestore: true,
          });
          restoredSpark = true;
        }

        // Drop locals before returning — the GC will eventually clean them
        // anyway, but explicit assignment to null narrows the window.
        // eslint-disable-next-line no-unused-vars
        let _drop = null;
        _drop = payload;

        return { restoredSpark, restoredIdentity };
      } catch (err) {
        this.lastError = err?.message || String(err);
        throw err;
      } finally {
        this.isRestoring = false;
      }
    },

    async deleteRemote(fileId) {
      await deleteBackup(fileId);
      if (this.lastBackupId === fileId) {
        this.lastBackupId = null;
        writeMeta({ lastBackupAt: this.lastBackupAt, lastBackupId: null });
      }
      await this.refresh();
    },
  },
});
