/**
 * Cloud Backup Store
 *
 * Coordinates between the local wallet/identity stores and the platform
 * cloud storage (Google Drive appDataFolder on Android). Holds no secrets
 * in state — seed phrases and connection keys exist only as local variables
 * for the duration of a backup or restore call, mirroring the pattern used
 * in the identity store.
 *
 * Auth model: there is no OAuth client config in the JS layer at all. The
 * native plugin owns sign-in; this store discovers the signed-in state by
 * probing the file listing (services/cloudStorage.getRemoteBackupInfo),
 * which rejects with "auth-required" when a sign-in is needed. Nothing
 * token-shaped is ever persisted by the app.
 *
 * Payload format inside the encrypted envelope:
 *
 *   version 2 (current):
 *     {
 *       v: 2,
 *       spark:    { mnemonic, network, accounts },          // iff present
 *       exitKits: [{ sparkAddress, network, accountNumber, exitState, exportedAt }],
 *       arkade:   { mnemonic, arkServerUrl, network },      // iff present
 *       nwc:      [{ name, nwcUrl }, ...],                  // iff present
 *       lnbits:   [{ name, serverUrl, adminKey }, ...],     // iff present
 *       identity: { mnemonic },                             // iff present
 *     }
 *
 *   version 1 (accepted on restore): { v: 1, spark?, identity? } — the
 *   same shapes, before connected-wallet coverage was added.
 *
 *   `spark.accounts` lists the Spark wallets the phrase covers
 *   ([{ accountNumber, name, lud16, sparkAddress }], utils/sparkBackup.js);
 *   it was added within version 2, so older apps still restore the phrase.
 *
 * Restore is strictly additive: it fills whatever is missing on this
 * device and never overwrites an existing wallet or identity. Restoring
 * on top of a freshly-generated wallet the user meant to keep must not
 * destroy it — to replace, wipe first.
 *
 * Keeping the backup current: after wallets change, the device that wrote
 * the current backup uploads a fresh one by itself (noteWalletsChanged).
 * An automatic upload never:
 *   - runs on a device that only restored (it never wrote the backup);
 *   - replaces a backup another phone wrote since (Drive's own timestamp of
 *     our last upload must still match);
 *   - loses a recovery phrase the backup on Drive holds (it decrypts the
 *     current backup and compares, utils/backupSecrets.js);
 *   - runs after a restore that could not bring everything back.
 * Each of those leaves a sticky block that only a backup the person starts
 * clears.
 *
 * The envelope itself (salt, IV, KDF params, ciphertext) is handled by
 * utils/backupCrypto. Transport is services/cloudStorage. This store is
 * the seam between them and the rest of the app.
 */

import { defineStore } from 'pinia';
import { encryptBackup, decryptBackup } from '../utils/backupCrypto.js';
import {
  isAvailable as cloudIsAvailable,
  signIn as cloudSignIn,
  signOut as cloudSignOut,
  uploadBackup,
  downloadBackup,
  uploadBackupKey,
  downloadBackupKey,
  getRemoteBackupInfo,
  deleteBackup,
  isCloudBackupPlatform,
} from '../services/cloudStorage.js';
import { WALLET_TYPES } from '../providers/WalletFactory';
import { useWalletStore } from './wallet.js';
import { useIdentityStore } from './identity.js';
import { exitKitService } from '../services/exitKit.js';
import { sparkAccountsForBackup, sparkAccountsFromBackup, sparkNetworkFromBackup } from '../utils/sparkBackup.js';
import { droppedSecrets } from '../utils/backupSecrets.js';

const META_KEY = 'buhoGO_cloud_backup_meta_v1';
const PAYLOAD_VERSION = 2;
// Several changes in a row (restore discovery, a rename typed in steps) make one upload.
const AUTO_BACKUP_DELAY_MS = 4000;
// Clocks of two uploads from the same phone can differ by the upload time.
const REMOTE_NEWER_SLACK_MS = 2 * 60 * 1000;
let autoBackupTimer = null;

function readMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeMeta(meta) {
  if (!meta) {
    localStorage.removeItem(META_KEY);
    return;
  }
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

/** True when a rejection means "the user must (re-)sign in", not "broken". */
function isAuthRequired(err) {
  const msg = err?.message || String(err || '');
  return /auth-required|not-signed-in/i.test(msg);
}

export const useCloudBackupStore = defineStore('cloudBackup', {
  state: () => ({
    /** True once a Drive call has succeeded this session. */
    signedIn: false,
    /** Email of the signed-in Google account (from the last sign-in). */
    signedInEmail: null,
    /** Remote file metadata { modifiedAt, size } or null when none/unknown. */
    remoteBackup: null,
    /** ISO timestamp of the last successful backup from this device. */
    lastBackupAt: null,
    isAuthing: false,
    isBackingUp: false,
    isRestoring: false,
    isListing: false,
    /** ISO timestamp of the last wallet change on this device (persisted). */
    changedAt: null,
    /**
     * Why automatic uploads are not happening, or null:
     *   'remote_newer'       another phone wrote the backup since
     *   'restore_incomplete' a restore could not bring everything back; an
     *                        upload now would drop it from the backup
     *   'would_drop_secret'  this phone no longer has a recovery phrase the
     *                        backup on Drive holds
     *   'auth'               sign in again
     *   'failed'             the last attempt failed (retried on the next change)
     * Cleared by a backup the person starts.
     */
    autoBackupBlocked: null,
    /** Drive's modifiedAt of this device's last upload: proves nobody wrote since. */
    remoteAtLastBackup: null,
  }),

  getters: {
    hasRemoteBackup: (state) => Boolean(state.remoteBackup),

    /** Wallets changed after the last backup this device made. */
    backupOutOfDate: (state) => Boolean(state.lastBackupAt && state.changedAt
      && Date.parse(state.changedAt) > Date.parse(state.lastBackupAt)),

    /** Best-known time of the newest backup: remote truth beats local memory. */
    newestBackupAt: (state) => state.remoteBackup?.modifiedAt || state.lastBackupAt,

    /** True iff there is at least one local secret eligible for backup. */
    hasBackupableSecret() {
      const wallet = useWalletStore();
      const identity = useIdentityStore();
      return Boolean(wallet.wallets.length > 0 || identity.bootstrapped);
    },
  },

  actions: {
    /** Load persisted metadata. Idempotent and cheap; call before anything else. */
    init() {
      const meta = readMeta();
      if (meta) {
        this.lastBackupAt = meta.lastBackupAt || null;
        this.signedInEmail = meta.signedInEmail || null;
        this.changedAt = meta.changedAt || null;
        this.autoBackupBlocked = meta.autoBackupBlocked || null;
        this.remoteAtLastBackup = meta.remoteAtLastBackup || null;
      }
    },

    /** Persist the non-secret bookkeeping that survives restarts. */
    _persistMeta() {
      writeMeta({
        lastBackupAt: this.lastBackupAt,
        signedInEmail: this.signedInEmail,
        changedAt: this.changedAt,
        autoBackupBlocked: this.autoBackupBlocked,
        remoteAtLastBackup: this.remoteAtLastBackup,
      });
    },

    /**
     * Wallets were added, removed, renamed or restored on this device. When
     * this device wrote the current Drive backup, a fresh one follows a few
     * seconds later, silently; otherwise the change is only remembered, so
     * the backup sheet can say the backup is out of date.
     */
    noteWalletsChanged() {
      if (!this.lastBackupAt && !this.signedInEmail) this.init();
      this.changedAt = new Date().toISOString();
      this._persistMeta();
      if (!this.lastBackupAt || !this.signedInEmail || !isCloudBackupPlatform()) return;
      if (this._autoBackupPaused()) return;
      clearTimeout(autoBackupTimer);
      autoBackupTimer = setTimeout(() => {
        autoBackupTimer = null;
        this._autoBackup().catch(() => {});
      }, AUTO_BACKUP_DELAY_MS);
    },

    /** A block only a backup the person starts lifts. */
    _autoBackupPaused() {
      return ['remote_newer', 'remote_missing', 'remote_unreadable', 'restore_incomplete', 'would_drop_secret'].includes(this.autoBackupBlocked);
    },

    /** The silent upload behind noteWalletsChanged. Never throws, never prompts. */
    async _autoBackup() {
      // Re-checked here: a restore may have started, or ended incomplete,
      // while the timer was waiting.
      if (this.isBackingUp || this.isRestoring || this._autoBackupPaused()) return;
      try {
        const remote = await getRemoteBackupInfo();
        this.signedIn = true;
        this.remoteBackup = remote;
        if (this._remoteChangedSinceOurUpload(remote)) {
          this.autoBackupBlocked = 'remote_newer';
          return;
        }
        // Deleted on Drive (by the person, maybe from another phone) after
        // this device uploaded: putting every secret back is their call.
        if (!remote && this.lastBackupAt) {
          this.autoBackupBlocked = 'remote_missing';
          return;
        }
        const next = await this._gatherPayload();
        const current = remote ? await this._readRemotePayload() : null;
        // A backup this phone cannot open (its key is gone) is never
        // replaced silently: nothing could prove the upload keeps its secrets.
        if (remote && !current) {
          this.autoBackupBlocked = 'remote_unreadable';
          return;
        }
        if (current && droppedSecrets(current, next).length) {
          this.autoBackupBlocked = 'would_drop_secret';
          return;
        }
        if (this.isRestoring || this._autoBackupPaused()) return;
        await this._upload(next);
      } catch (err) {
        this.autoBackupBlocked = isAuthRequired(err) ? 'auth' : 'failed';
        if (isAuthRequired(err)) this.signedIn = false;
        console.warn('[cloudBackup] automatic backup skipped:', err?.code || err?.message || err);
      } finally {
        this._persistMeta();
      }
    },

    /**
     * Probe whether Drive backup can work on this device, and why not.
     * @returns {Promise<{ available: boolean, reason: string|null }>}
     */
    async checkAvailability() {
      const res = await cloudIsAvailable();
      return { available: Boolean(res?.available), reason: res?.reason || null };
    },

    /**
     * Probe the remote state. Doubles as the signed-in check: a successful
     * listing proves the grant works, an "auth-required" rejection means
     * the user has to sign in (again). Any other failure is surfaced.
     */
    async refresh() {
      this.isListing = true;
      try {
        this.remoteBackup = await getRemoteBackupInfo();
        this.signedIn = true;
      } catch (err) {
        this.remoteBackup = null;
        if (isAuthRequired(err)) {
          this.signedIn = false;
          return;
        }
        throw err;
      } finally {
        this.isListing = false;
      }
    },

    /**
     * Run the native Google sign-in (account chooser + Drive consent).
     * Throws an Error whose `.reason` carries the raw native code so the
     * UI can map it to an actionable message (SHA-1 misconfig, network,
     * scope declined, cancelled).
     */
    async signIn() {
      this.isAuthing = true;
      try {
        const res = await cloudSignIn();
        if (!res?.ok) {
          const err = new Error(res?.reason || 'sign-in-failed');
          err.reason = res?.reason || 'sign-in-failed';
          throw err;
        }
        this.signedIn = true;
        this.signedInEmail = res.account || null;
        this._persistMeta();
        await this.refresh();
        if (!this.signedIn) {
          // The listing probe right after a "successful" sign-in still hit
          // auth-required: the grant is not actually usable (e.g. revoked
          // server-side). Surface that instead of pretending success.
          const err = new Error('auth-required');
          err.reason = 'auth-required';
          throw err;
        }
      } finally {
        this.isAuthing = false;
      }
    },

    /** Revoke the Drive grant and forget the account. */
    async signOut() {
      try {
        await cloudSignOut();
      } finally {
        this.signedIn = false;
        this.signedInEmail = null;
        this.remoteBackup = null;
        this._persistMeta();
      }
    },

    /**
     * Build the plaintext payload from the live stores. Secret strings
     * exist only inside this function — they are passed straight into
     * encryptBackup() and dropped, never assigned to store state.
     */
    _sparkWalletIds() {
      return useWalletStore().wallets.filter((w) => w.type === WALLET_TYPES.SPARK).map((w) => w.id);
    },

    async _gatherPayload() {
      const wallet = useWalletStore();
      const identity = useIdentityStore();

      const payload = { v: PAYLOAD_VERSION };

      if (wallet.hasAnySparkWallet) {
        payload.spark = {
          mnemonic: await wallet.getSparkMnemonic(),
          network: wallet.sparkWallet?.connectionData?.network || 'MAINNET',
          // Which wallets the phrase covers here, so a restore brings back
          // exactly these, with their names.
          accounts: sparkAccountsForBackup(wallet.wallets),
        };
        // The emergency exit kits ride along: exit data, not keys, and the
        // only thing that lets the money leave Spark without the operators.
        const exitKits = await exitKitService().kitsForBackup(this._sparkWalletIds()).catch(() => []);
        if (exitKits.length) payload.exitKits = exitKits;
      }

      if (wallet.hasArkadeWallet) {
        const ark = wallet.arkadeWallet;
        payload.arkade = {
          mnemonic: await wallet.getArkadeMnemonic(),
          arkServerUrl: ark?.connectionData?.arkServerUrl || null,
          network: ark?.connectionData?.network || null,
        };
      }

      const nwc = wallet.wallets
        .filter((w) => w.type === WALLET_TYPES.NWC && w.nwcUrl)
        .map((w) => ({ name: w.name || '', nwcUrl: w.nwcUrl }));
      if (nwc.length) payload.nwc = nwc;

      const lnbits = wallet.wallets
        .filter(
          (w) =>
            w.type === WALLET_TYPES.LNBITS &&
            w.connectionData?.serverUrl &&
            w.connectionData?.adminKey
        )
        .map((w) => ({
          name: w.name || '',
          serverUrl: w.connectionData.serverUrl,
          adminKey: w.connectionData.adminKey,
        }));
      if (lnbits.length) payload.lnbits = lnbits;

      if (identity.bootstrapped) {
        payload.identity = { mnemonic: await identity.getMnemonic() };
      }

      if (Object.keys(payload).length === 1) {
        const err = new Error('Nothing to back up yet');
        err.code = 'NOTHING_TO_BACKUP';
        throw err;
      }
      return payload;
    },

    /**
     * Fetch the backup key from the key file, or null when there is none
     * (or it does not parse). Never creates one — restore must only read.
     */
    async _loadKey() {
      const raw = await downloadBackupKey();
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return typeof parsed?.k === 'string' && parsed.k.length > 0 ? parsed.k : null;
      } catch {
        return null;
      }
    },

    /**
     * The key for the envelope. An existing key is reused so every envelope
     * ever written with it stays readable; created on first backup.
     */
    async _loadOrCreateKey() {
      const existing = await this._loadKey();
      if (existing) return existing;
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const key = btoa(bin);
      await uploadBackupKey(JSON.stringify({ v: 1, k: key }));
      return key;
    },

    /**
     * Encrypt every local wallet secret + the identity seed and upload the
     * envelope, overwriting the previous one.
     */
    async backup() {
      return this._upload(await this._gatherPayload());
    },

    /**
     * Whether a backup now would remove a secret the backup on Drive holds (a
     * recovery phrase, an NWC connection or an LNbits key). The backup sheet
     * says so before the person confirms. False when unknown.
     */
    async backupDropsSecrets() {
      try {
        const current = await this._readRemotePayload();
        return !!current && droppedSecrets(current, await this._gatherPayload()).length > 0;
      } catch {
        return false;
      }
    },

    /**
     * True when the file on Drive is not the one this device uploaded last.
     * Compares Drive's own timestamps; an install from before that was
     * recorded falls back to its clock with a margin.
     */
    _remoteChangedSinceOurUpload(remote) {
      if (!remote?.modifiedAt) return false;
      if (this.remoteAtLastBackup) return remote.modifiedAt !== this.remoteAtLastBackup;
      const remoteAt = Date.parse(remote.modifiedAt);
      return Number.isFinite(remoteAt) && remoteAt > Date.parse(this.lastBackupAt) + REMOTE_NEWER_SLACK_MS;
    },

    /** The decrypted payload on Drive, or null when there is none. Never writes. */
    async _readRemotePayload() {
      const envelopeJson = await downloadBackup();
      if (!envelopeJson) return null;
      const key = await this._loadKey();
      if (!key) return null;
      return decryptBackup(envelopeJson, key);
    },

    async _upload(payload) {
      this.isBackingUp = true;
      try {
        const key = await this._loadOrCreateKey();
        const envelope = await encryptBackup(payload, key);
        const uploaded = await uploadBackup(JSON.stringify(envelope));

        this.lastBackupAt = envelope.createdAt;
        this.remoteAtLastBackup = uploaded?.modifiedAt || null;
        this.autoBackupBlocked = null;
        this._persistMeta();
        if (payload.exitKits?.length) exitKitService().markBackedUp(this._sparkWalletIds(), Date.now());
        // The upload response carries the written file's metadata, so the
        // remote state is known without a follow-up listing round trip.
        this.remoteBackup = {
          name: uploaded?.name || '',
          modifiedAt: uploaded?.modifiedAt || envelope.createdAt,
          size: uploaded?.size || 0,
        };
      } catch (err) {
        if (isAuthRequired(err)) this.signedIn = false;
        throw err;
      } finally {
        this.isBackingUp = false;
      }
    },

    /**
     * Download the backup, decrypt it, and additively apply it: anything
     * in the payload that is missing on this device is recreated, anything
     * already present is left untouched.
     *
     * @returns {Promise<{ restored: string[], skipped: string[], failed: Array<{label: string, reason: string}> }>}
     *          Labels are payload-kind names ('spark', 'arkade', wallet
     *          display names for nwc/lnbits, 'identity') for UI summary.
     */
    async restore() {
      this.isRestoring = true;
      // A pending silent upload must not run against a half-restored phone.
      clearTimeout(autoBackupTimer);
      autoBackupTimer = null;
      try {
        const envelopeJson = await downloadBackup();
        if (!envelopeJson) {
          const err = new Error('No backup found in this Google account');
          err.code = 'NO_BACKUP_FOUND';
          throw err;
        }
        const key = await this._loadKey();
        if (!key) {
          // An envelope with no readable key file cannot be opened. Distinct
          // from NO_BACKUP_FOUND so the UI never claims "no backup" while
          // one is sitting in the account.
          const err = new Error('Backup cannot be read');
          err.code = 'BACKUP_UNREADABLE';
          throw err;
        }
        const payload = await decryptBackup(envelopeJson, key);
        if (!payload || !Number.isInteger(payload.v) || payload.v < 1 || payload.v > PAYLOAD_VERSION) {
          const err = new Error(`Unsupported backup payload version: ${payload?.v}`);
          err.code = 'UNSUPPORTED_PAYLOAD';
          throw err;
        }
        const result = await this._applyPayload(payload);
        if (result.failed.length) {
          // Uploading from this phone now would drop what did not come back.
          this.autoBackupBlocked = 'restore_incomplete';
          this._persistMeta();
        }
        return result;
      } catch (err) {
        if (isAuthRequired(err)) this.signedIn = false;
        throw err;
      } finally {
        this.isRestoring = false;
      }
    },

    /**
     * Apply a decrypted payload to the local stores, additively. Each item
     * is independent: one wallet failing to connect (dead relay, LNbits
     * server offline) must not abort the seeds that already restored.
     */
    async _applyPayload(payload) {
      const wallet = useWalletStore();
      const identity = useIdentityStore();

      // The welcome-screen restore path can reach here before either store
      // has loaded its persisted state. Applying against empty in-memory
      // state would mis-read "nothing on this device": the wallet store
      // would refuse to persist (it never saves before its saved state is
      // loaded) and the identity guard below would see bootstrapped=false
      // while a key exists. Hydrate first; both calls are idempotent.
      if (!wallet.isInitialized) await wallet.initialize();
      await identity.hydrate();

      const restored = [];
      const skipped = [];
      const failed = [];
      // The code travels with a failure, so the sheet can explain the ones
      // the app knows (WALLET_STATE_*: the saved wallets could not be changed).
      const fail = (label, err) => failed.push({ label, reason: err?.message || String(err), code: err?.code || null });

      // Identity first: cheap, offline, and the Nostr key other features
      // hang off. Never replace an existing identity — a restore must not
      // silently swap the user's Nostr key out from under them.
      if (payload.identity?.mnemonic) {
        if (identity.bootstrapped) {
          skipped.push('identity');
        } else {
          try {
            // markBackedUp=false: restoring from the cloud proves nothing
            // about the user ever having written the 12 words down, so the
            // write-them-down prompt must survive the restore.
            await identity.importMnemonic(payload.identity.mnemonic, false);
            restored.push('identity');
            // The import lands on NIP-06 account 0; the published
            // identity pointer says which account was actually active.
            // Best-effort and bounded: no pointer (or no network)
            // means account 0 stays, which is always safe.
            try {
              await identity.resolveActiveNostrAccount();
            } catch (err) {
              console.warn('[cloudBackup] pointer discovery after restore failed:', err);
            }
          } catch (err) {
            fail('identity', err);
          }
        }
      }

      // Exit kits first: stored now, they are imported into each Spark
      // wallet's SDK on its first connect below, so a restore never depends
      // on the operators.
      if (Array.isArray(payload.exitKits) && payload.exitKits.length) {
        try {
          await exitKitService().stashRestoredKits(payload.exitKits);
        } catch (err) {
          console.warn('exit kits not restored:', err?.message || err);
        }
      }

      // Seed-based wallets next. The Spark restore brings back the wallets
      // the backup lists (or the first one) now and finds any other account
      // of the phrase in the background; on a device that already holds this
      // phrase it only adds what is missing, and a different phrase is left
      // alone.
      if (payload.spark?.mnemonic) {
        try {
          const { merged, added } = await wallet.restoreSparkWallets({
            mnemonic: payload.spark.mnemonic,
            network: sparkNetworkFromBackup(payload.spark),
            accounts: sparkAccountsFromBackup(payload),
            // Restoring from Drive proves nothing about the 12 words being
            // written down (same rule as the identity import above).
            phraseConfirmed: false,
          });
          if (merged && !added.length) skipped.push('spark');
          else restored.push('spark');
        } catch (err) {
          if (err?.code === 'SPARK_OTHER_PHRASE') skipped.push('spark');
          else fail('spark', err);
        }
      }

      if (payload.arkade?.mnemonic) {
        if (wallet.hasArkadeWallet) {
          skipped.push('arkade');
        } else {
          try {
            await wallet.addArkadeWallet({
              mnemonic: payload.arkade.mnemonic,
              arkServerUrl: payload.arkade.arkServerUrl || undefined,
              network: payload.arkade.network || undefined,
              isRestore: true,
            });
            restored.push('arkade');
          } catch (err) {
            fail('arkade', err);
          }
        }
      }

      // Connected wallets last: they hit the network (NWC relays retry for
      // up to ~20 s each) and are the most likely to fail transiently.
      for (const entry of payload.nwc || []) {
        if (!entry?.nwcUrl) continue;
        const label = entry.name || 'NWC wallet';
        if (wallet.wallets.some((w) => w.nwcUrl === entry.nwcUrl)) {
          skipped.push(label);
          continue;
        }
        try {
          await wallet.addWallet({ name: entry.name || undefined, nwcUrl: entry.nwcUrl });
          restored.push(label);
        } catch (err) {
          fail(label, err);
        }
      }

      for (const entry of payload.lnbits || []) {
        if (!entry?.serverUrl || !entry?.adminKey) continue;
        const label = entry.name || 'LNbits wallet';
        const exists = wallet.wallets.some(
          (w) =>
            w.type === WALLET_TYPES.LNBITS &&
            w.connectionData?.serverUrl === entry.serverUrl &&
            w.connectionData?.adminKey === entry.adminKey
        );
        if (exists) {
          skipped.push(label);
          continue;
        }
        try {
          await wallet.addLNBitsWallet({
            name: entry.name || undefined,
            serverUrl: entry.serverUrl,
            adminKey: entry.adminKey,
          });
          restored.push(label);
        } catch (err) {
          // The store's own duplicate check throws "already connected" for
          // a same-server wallet added under a different admin key copy.
          if (/already connected/i.test(err?.message || '')) {
            skipped.push(label);
          } else {
            fail(label, err);
          }
        }
      }

      return { restored, skipped, failed };
    },

    /** Delete the remote backup and its key file. */
    async deleteRemote() {
      await deleteBackup();
      this.remoteBackup = null;
      this.lastBackupAt = null;
      this.autoBackupBlocked = null;
      this._persistMeta();
    },
  },
});
