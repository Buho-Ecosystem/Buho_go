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
 *       spark:    { mnemonic, network },                    // iff present
 *       arkade:   { mnemonic, arkServerUrl, network },      // iff present
 *       nwc:      [{ name, nwcUrl }, ...],                  // iff present
 *       lnbits:   [{ name, serverUrl, adminKey }, ...],     // iff present
 *       identity: { mnemonic },                             // iff present
 *     }
 *
 *   version 1 (accepted on restore): { v: 1, spark?, identity? } — the
 *   same shapes, before connected-wallet coverage was added.
 *
 * Restore is strictly additive: it fills whatever is missing on this
 * device and never overwrites an existing wallet or identity. Restoring
 * on top of a freshly-generated wallet the user meant to keep must not
 * destroy it — to replace, wipe first.
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
} from '../services/cloudStorage.js';
import { WALLET_TYPES } from '../providers/WalletFactory';
import { useWalletStore } from './wallet.js';
import { useIdentityStore } from './identity.js';

const META_KEY = 'buhoGO_cloud_backup_meta_v1';
const PAYLOAD_VERSION = 2;

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
  }),

  getters: {
    hasRemoteBackup: (state) => Boolean(state.remoteBackup),

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
      }
    },

    /** Persist the non-secret bookkeeping that survives restarts. */
    _persistMeta() {
      writeMeta({ lastBackupAt: this.lastBackupAt, signedInEmail: this.signedInEmail });
    },

    /** Probe platform availability. @returns {Promise<boolean>} */
    async checkAvailability() {
      const res = await cloudIsAvailable();
      return Boolean(res?.available);
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
    async _gatherPayload() {
      const wallet = useWalletStore();
      const identity = useIdentityStore();

      const payload = { v: PAYLOAD_VERSION };

      if (wallet.hasAnySparkWallet) {
        payload.spark = {
          mnemonic: await wallet.getSparkMnemonic(),
          network: wallet.sparkWallet?.connectionData?.network || 'MAINNET',
        };
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
      this.isBackingUp = true;
      try {
        const payload = await this._gatherPayload();
        const key = await this._loadOrCreateKey();
        const envelope = await encryptBackup(payload, key);
        const uploaded = await uploadBackup(JSON.stringify(envelope));

        this.lastBackupAt = envelope.createdAt;
        this._persistMeta();
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
        return await this._applyPayload(payload);
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

      // The welcome-screen restore path reaches here before either store
      // has loaded its persisted state. Applying against empty in-memory
      // state would mis-read "nothing on this device": the wallet store
      // would refuse to persist (it never drops wallets it saw on disk)
      // and the identity guard below would see bootstrapped=false while a
      // key exists. Hydrate first; both calls are idempotent.
      if (!wallet.isInitialized) await wallet.initialize();
      await identity.hydrate();

      const restored = [];
      const skipped = [];
      const failed = [];

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
            failed.push({ label: 'identity', reason: err?.message || String(err) });
          }
        }
      }

      // Seed-based wallets next. addSparkWallet(isRestore) probes the
      // legacy account-0 derivation itself, so restored pre-v1.6.0 funds
      // stay reachable.
      if (payload.spark?.mnemonic) {
        if (wallet.hasAnySparkWallet) {
          skipped.push('spark');
        } else {
          try {
            await wallet.addSparkWallet({
              mnemonic: payload.spark.mnemonic,
              network: payload.spark.network || 'MAINNET',
              isRestore: true,
            });
            restored.push('spark');
          } catch (err) {
            failed.push({ label: 'spark', reason: err?.message || String(err) });
          }
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
            failed.push({ label: 'arkade', reason: err?.message || String(err) });
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
          failed.push({ label, reason: err?.message || String(err) });
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
            failed.push({ label, reason: err?.message || String(err) });
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
      this._persistMeta();
    },
  },
});
