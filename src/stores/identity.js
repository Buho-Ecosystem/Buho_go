/**
 * Identity Store
 *
 * The BuhoGO Identity is a single self-sovereign cryptographic identity
 * generated and stored locally. It is intentionally *not* coupled to any
 * payment stream (Spark, NWC, LNBits) — the wallet you pay with is not
 * the identity you log in with.
 *
 * Today this powers LUD-04 (LNURL-auth). Tomorrow the same seed can derive
 * Nostr keys (NIP-06), NIP-05 identifiers, and BIP-353 codes — all from
 * one 12-word backup the user already learned how to handle from their
 * Spark wallet.
 *
 * Storage model:
 *   - Encrypted mnemonic at `buhoGO_identity_seed_v1` (envelope from
 *     `utils/deviceCrypto`, same scheme as the Spark seed).
 *   - Metadata (backup status, connected sites) at `buhoGO_identity_v1`.
 *   - Both keyed off the same device key as the wallet store, so a single
 *     bootstrap secret protects everything we keep on disk.
 *
 * Design notes:
 *   - Identity is created lazily (on first LUD-04 attempt or first visit
 *     to the Identity Profile settings section). We never force a user
 *     through identity onboarding before they need it.
 *   - Signing does *not* re-prompt biometrics on every callback. App-level
 *     biometric lock (if enabled) already gated entry to the app.
 *   - The mnemonic is decrypted, used, and dropped — never held on the
 *     store after a call returns.
 */

import { defineStore } from 'pinia';
import { encryptString, decryptString } from '../utils/deviceCrypto';
import {
  generateIdentityMnemonic,
  isValidIdentityMnemonic,
  normaliseMnemonic,
  deriveLinkingKey,
  signLud04Challenge,
  computeIdentityFingerprint,
  bytesToHex,
} from '../utils/identityCrypto';

const STORAGE_KEYS = Object.freeze({
  METADATA: 'buhoGO_identity_v1',
  SEED_ENVELOPE: 'buhoGO_identity_seed_v1',
});

/** Schema version for the metadata blob. Bump on breaking change. */
const METADATA_VERSION = 1;

/** Maximum number of connected sites we keep locally. */
const MAX_CONNECTED_SITES = 200;

export const useIdentityStore = defineStore('identity', {
  state: () => ({
    /** True once we've loaded any persisted state from disk. */
    hydrated: false,
    /** True iff an identity seed exists on disk. */
    bootstrapped: false,
    /** True after the user verifies they wrote the seed down. */
    backupConfirmed: false,
    /** Cached, derived fingerprint of the identity. 16 hex chars or null. */
    fingerprint: null,
    /** Local-only record of sites the user has authenticated to. */
    connectedSites: [],
    /** Sticky banner dismissal — undefined or epoch-ms. */
    backupBannerDismissedUntil: null,
  }),

  getters: {
    /** True if there's an identity *and* the user has confirmed backup. */
    isReady(state) {
      return state.bootstrapped && state.backupConfirmed;
    },

    /** Shape used by the connected-sites list UI. */
    connectedSitesSorted(state) {
      return [...state.connectedSites].sort(
        (a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0),
      );
    },

    /** True iff the backup banner should be shown right now. */
    shouldShowBackupBanner(state) {
      if (!state.bootstrapped) return false;
      if (state.backupConfirmed) return false;
      const until = state.backupBannerDismissedUntil;
      if (until && Date.now() < until) return false;
      return true;
    },
  },

  actions: {
    // -------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------

    /**
     * Read persisted state from localStorage. Idempotent. Should be called
     * once on app boot and any time we suspect external mutation (storage
     * events, etc.).
     */
    async hydrate() {
      if (this.hydrated) return;

      try {
        const raw = localStorage.getItem(STORAGE_KEYS.METADATA);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.version === METADATA_VERSION) {
            this.backupConfirmed = !!parsed.backupConfirmed;
            this.fingerprint = parsed.fingerprint ?? null;
            this.connectedSites = Array.isArray(parsed.connectedSites)
              ? parsed.connectedSites.slice(0, MAX_CONNECTED_SITES)
              : [];
            this.backupBannerDismissedUntil =
              parsed.backupBannerDismissedUntil ?? null;
          }
        }

        const envelope = localStorage.getItem(STORAGE_KEYS.SEED_ENVELOPE);
        this.bootstrapped = !!envelope;
      } catch (err) {
        // Corrupted persisted state should not block the app; surface in
        // logs and fall through with defaults so the user can still set up
        // a fresh identity from Settings.
        console.warn('[identity] hydrate failed, using defaults:', err);
      }

      this.hydrated = true;
    },

    /** Internal: persist the non-secret state to disk. */
    _persistMetadata() {
      const payload = {
        version: METADATA_VERSION,
        backupConfirmed: this.backupConfirmed,
        fingerprint: this.fingerprint,
        connectedSites: this.connectedSites.slice(0, MAX_CONNECTED_SITES),
        backupBannerDismissedUntil: this.backupBannerDismissedUntil,
      };
      localStorage.setItem(STORAGE_KEYS.METADATA, JSON.stringify(payload));
    },

    // -------------------------------------------------------------------
    // Seed lifecycle
    // -------------------------------------------------------------------

    /**
     * Make sure an identity seed exists. Generates a new one if not. Safe
     * to call repeatedly; only the first call mutates state.
     */
    async ensureIdentity() {
      await this.hydrate();
      if (this.bootstrapped) return;

      const mnemonic = generateIdentityMnemonic();
      const envelope = await encryptString(mnemonic);
      localStorage.setItem(STORAGE_KEYS.SEED_ENVELOPE, envelope);

      this.bootstrapped = true;
      this.backupConfirmed = false;
      this.fingerprint = computeIdentityFingerprint(mnemonic);
      this._persistMetadata();
    },

    /**
     * Import an externally-supplied mnemonic. Replaces any existing
     * identity, *including* its connected-sites list, because the new seed
     * produces different linking keys and any previously linked site no
     * longer recognises this user.
     *
     * @param {string}  mnemonic
     * @param {boolean} [markBackedUp=true]  - imported seeds are assumed
     *   to already have a backup (the user just typed it).
     */
    async importMnemonic(mnemonic, markBackedUp = true) {
      const normalised = normaliseMnemonic(mnemonic);
      if (!isValidIdentityMnemonic(normalised)) {
        const err = new Error('Invalid recovery phrase');
        err.code = 'IDENTITY_INVALID_MNEMONIC';
        throw err;
      }

      const envelope = await encryptString(normalised);
      localStorage.setItem(STORAGE_KEYS.SEED_ENVELOPE, envelope);

      this.bootstrapped = true;
      this.backupConfirmed = !!markBackedUp;
      this.fingerprint = computeIdentityFingerprint(normalised);
      this.connectedSites = [];
      this.backupBannerDismissedUntil = null;
      this._persistMetadata();
    },

    /**
     * Return the decrypted mnemonic. Throws if no identity exists. The
     * caller is responsible for wiping the returned string from any
     * component state when it's done with it.
     *
     * @returns {Promise<string>}
     */
    async getMnemonic() {
      const envelope = localStorage.getItem(STORAGE_KEYS.SEED_ENVELOPE);
      if (!envelope) {
        const err = new Error('No identity seed');
        err.code = 'IDENTITY_NOT_BOOTSTRAPPED';
        throw err;
      }
      return decryptString(envelope);
    },

    /**
     * Mark the seed as backed up. Called after the verification step
     * succeeds in the seed-phrase dialog.
     */
    async confirmBackup() {
      this.backupConfirmed = true;
      this.backupBannerDismissedUntil = null;
      this._persistMetadata();
    },

    /**
     * Dismiss the backup banner for a window (default 4 hours, matching
     * the wallet seed backup banner). The banner re-appears once expired.
     *
     * @param {number} [hours=4]
     */
    dismissBackupBanner(hours = 4) {
      this.backupBannerDismissedUntil = Date.now() + hours * 60 * 60 * 1000;
      this._persistMetadata();
    },

    /**
     * Destroy the local identity entirely. Used by the "Reset Identity"
     * action and on full app wipe. Does NOT remove the device key —
     * that's shared with the wallet store and must outlive identity.
     */
    async reset() {
      localStorage.removeItem(STORAGE_KEYS.SEED_ENVELOPE);
      localStorage.removeItem(STORAGE_KEYS.METADATA);
      this.bootstrapped = false;
      this.backupConfirmed = false;
      this.fingerprint = null;
      this.connectedSites = [];
      this.backupBannerDismissedUntil = null;
    },

    /**
     * Wipe the current identity and immediately generate a fresh one in
     * the same call. Used by the "Generate new identity" destructive
     * action — guarantees the user always lands with an identity in
     * place, no in-between "no identity at all" state where the UI
     * would dead-end on a missing fingerprint.
     */
    async regenerate() {
      await this.reset();
      await this.ensureIdentity();
    },

    // -------------------------------------------------------------------
    // LUD-04 signing
    // -------------------------------------------------------------------

    /**
     * Produce the proof bundle for a LUD-04 challenge.
     *
     * Caller passes the parsed challenge (from `utils/lud4.parseLud04Url`);
     * we decrypt the mnemonic, derive the linking key for the given
     * domain, sign the k1, and return everything the callback URL needs.
     *
     * The decrypted mnemonic is *never* assigned to component state — it
     * lives only as a local var during this call.
     *
     * @param {{ domain: string, k1: Uint8Array }} challenge
     * @returns {Promise<{ sigDerHex: string, linkingPubHex: string }>}
     */
    async signLud04(challenge) {
      const { domain, k1 } = challenge;
      if (typeof domain !== 'string' || !domain) {
        throw new TypeError('challenge.domain is required');
      }
      if (!(k1 instanceof Uint8Array) || k1.length !== 32) {
        throw new TypeError('challenge.k1 must be a 32-byte Uint8Array');
      }

      if (!this.bootstrapped) {
        await this.ensureIdentity();
      }

      const mnemonic = await this.getMnemonic();
      try {
        const linking = deriveLinkingKey(mnemonic, domain);
        const sig = signLud04Challenge(k1, linking.privateKey);

        // Recompute the fingerprint on the off-chance it wasn't cached
        // (e.g. when state was rebuilt from corrupted metadata). Cheap
        // and idempotent.
        if (!this.fingerprint) {
          this.fingerprint = computeIdentityFingerprint(mnemonic);
          this._persistMetadata();
        }

        return {
          sigDerHex: bytesToHex(sig),
          linkingPubHex: bytesToHex(linking.publicKey),
        };
      } finally {
        // Best-effort wipe — JS strings are immutable so the engine still
        // holds copies, but at least we drop our reference.
        // eslint-disable-next-line no-param-reassign, no-unused-vars
        const _drop = mnemonic;
      }
    },

    // -------------------------------------------------------------------
    // Connected-sites bookkeeping
    // -------------------------------------------------------------------

    /**
     * Record (or update) a site the user has authenticated to. Stored
     * locally only; the site itself is the source of truth for whether
     * this identity is actually still linked on their end.
     *
     * @param {{ domain: string, action: string, linkingPubHex: string }} info
     */
    recordConnectedSite({ domain, action, linkingPubHex }) {
      if (!domain) return;
      const now = Date.now();
      const existingIdx = this.connectedSites.findIndex(
        s => s.domain === domain,
      );

      if (existingIdx >= 0) {
        const existing = this.connectedSites[existingIdx];
        this.connectedSites[existingIdx] = {
          ...existing,
          lastUsedAt: now,
          lastAction: action || existing.lastAction,
          linkingPubHex: linkingPubHex || existing.linkingPubHex,
          useCount: (existing.useCount || 1) + 1,
        };
      } else {
        this.connectedSites = [
          {
            domain,
            firstLinkedAt: now,
            lastUsedAt: now,
            lastAction: action || 'login',
            linkingPubHex: linkingPubHex || null,
            useCount: 1,
          },
          ...this.connectedSites,
        ].slice(0, MAX_CONNECTED_SITES);
      }

      this._persistMetadata();
    },

    /**
     * Remove a site from the local list. The site server is unaware of
     * this action — the UI should make clear that this is a local-only
     * forget.
     *
     * @param {string} domain
     */
    removeConnectedSite(domain) {
      if (!domain) return;
      const before = this.connectedSites.length;
      this.connectedSites = this.connectedSites.filter(
        s => s.domain !== domain,
      );
      if (this.connectedSites.length !== before) {
        this._persistMetadata();
      }
    },
  },
});
