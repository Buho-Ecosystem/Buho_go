/**
 * Identity Store
 *
 * The BuhoGO Identity is a single self-sovereign cryptographic identity
 * generated and stored locally. It is intentionally *not* coupled to any
 * payment stream (Spark, NWC, LNBits) — the wallet you pay with is not
 * the identity you log in with.
 *
 * Today this powers LUD-04 (LNURL-auth) and Nostr (NIP-06). Tomorrow the
 * same seed can derive NIP-05 identifiers, BIP-353 codes, and anything
 * else derivable from a BIP-39 seed — all from one 12-word backup the
 * user already learned how to handle from their Spark wallet.
 *
 * Single-seed invariant:
 *   - There is exactly *one* BuhoGO identity per install. Wiping it wipes
 *     every derived key on this device, including the Nostr key.
 *   - Generating a new identity (`regenerate`) produces a fresh BIP-39
 *     seed and therefore a fresh Nostr keypair. The old Nostr key is
 *     forgotten here and unrecoverable without its old recovery phrase.
 *   - Restoring from a recovery phrase (`importMnemonic`) brings back
 *     both the LUD-04 sign-in keys and the Nostr key, because both are
 *     deterministic functions of the seed.
 *   - The Nostr "rotate" action (`rotateNostrIdentity`) only bumps the
 *     NIP-06 account index — it does *not* change the BuhoGO seed.
 *     Account-index rotation is device-local: it isn't recoverable from
 *     the seed phrase alone, so a fresh restore lands the user back on
 *     account 0 (the canonical NIP-06 account every other Nostr client
 *     also defaults to).
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
import { encryptString, decryptString } from '../utils/deviceCrypto.js';
import { nip05AddressFor } from '../services/nip05.js';
import {
  generateIdentityMnemonic,
  isValidIdentityMnemonic,
  normaliseMnemonic,
  deriveLinkingKey,
  deriveNostrIdentity,
  signLud04Challenge,
  computeIdentityFingerprint,
  bytesToHex,
} from '../utils/identityCrypto.js';
import {
  buildPointerEvent,
  fetchPointer,
  publishPointer,
  sanitizeRoster,
} from '../utils/nostrIdentityPointer.js';
import { fetchOwnWriteRelays } from '../utils/nostrContactsDoc.js';
import { DEFAULT_RELAYS } from '../utils/nostrRelays.js';

const STORAGE_KEYS = Object.freeze({
  METADATA: 'buhoGO_identity_v1',
  SEED_ENVELOPE: 'buhoGO_identity_seed_v1',
});

/** Schema version for the metadata blob. Bump on breaking change. */
const METADATA_VERSION = 1;

/** Maximum number of connected sites we keep locally. */
const MAX_CONNECTED_SITES = 200;

/**
 * Upper bound (exclusive) for the NIP-06 account index. Matches BIP-32's
 * hardened-derivation threshold — anything ≥ 2^31 would collide with the
 * hardened-index encoding and isn't a valid value for the `<account>` field
 * in `m/44'/1237'/<account>'/0/0`.
 */
const NOSTR_MAX_ACCOUNT = 2 ** 31;

/**
 * Defensive parser for the persisted `nip05Handles` array. Returns a fresh
 * normalised array on success, or `null` if the input is missing/malformed
 * so the caller can fall through to the legacy-shape migration.
 *
 * - Drops entries with a missing or non-string `handle`.
 * - Coerces `isFree` / `isActive` to booleans.
 * - At most one entry stays `isActive: true` (first-wins) so a hand-edited
 *   localStorage blob can't put us in a "two actives" invalid state.
 */
function sanitiseNip05Handles(raw) {
  if (!Array.isArray(raw)) return null;
  let sawActive = false;
  const cleaned = [];
  for (const entry of raw) {
    if (!entry || typeof entry.handle !== 'string' || !entry.handle) continue;
    const isActive = !sawActive && !!entry.isActive;
    if (isActive) sawActive = true;
    cleaned.push({
      handle: entry.handle,
      rotationSecret:
        typeof entry.rotationSecret === 'string' ? entry.rotationSecret : null,
      isFree: !!entry.isFree,
      isActive,
      addressId: typeof entry.addressId === 'string' ? entry.addressId : null,
      createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
      // Renewal feature disabled — extension doesn't enforce expiry.
      // expiresAt: Number.isFinite(entry.expiresAt) ? entry.expiresAt : null,
    });
  }
  // If nothing was marked active but the user does have handles, promote
  // the first one. Keeps the "must always have an active" invariant alive.
  if (cleaned.length > 0 && !sawActive) cleaned[0].isActive = true;
  return cleaned;
}

/**
 * One-time migration from the old single-handle persisted shape
 * (`nip05Handle` + `nip05RotationSecret`) into the new array shape. Returns
 * an empty array when the legacy fields are also absent — i.e. a never-
 * registered identity.
 */
function legacyToHandleArray(parsed) {
  const legacyHandle = typeof parsed?.nip05Handle === 'string' ? parsed.nip05Handle : null;
  if (!legacyHandle) return [];
  return [{
    handle: legacyHandle,
    rotationSecret:
      typeof parsed.nip05RotationSecret === 'string' ? parsed.nip05RotationSecret : null,
    isFree: true,
    isActive: true,
    addressId: null,
    createdAt: 0,
    // Renewal feature disabled — extension doesn't enforce expiry.
    // expiresAt: null,
  }];
}

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
    /**
     * Nostr NIP-06 account index for the active identity. Defaults to 0;
     * incremented by `rotateNostrIdentity()` to forget the previous key
     * without rotating the whole BuhoGO identity. Persists across reloads
     * so the same npub keeps showing up.
     */
    nostrAccountIndex: 0,
    /** Cached x-only Nostr pubkey (64 hex chars) or null until first derive. */
    nostrPubkeyHex: null,
    /** Cached NIP-19 `npub1...` for the current account, or null. */
    nostrNpub: null,
    /**
     * BuhoGO-managed NIP-05 handles for the current Nostr key, registered
     * under `mybuho.de`. The first one is auto-registered as a free
     * `.NNNNNN` identifier by `boot/nip05.js`; the user can later buy
     * additional premium names from the profile editor's marketplace.
     *
     * Shape:
     *   { handle, rotationSecret, isFree, isActive, addressId, createdAt }
     *
     * Invariants:
     *   - At most one entry has `isActive: true`. That entry is the one
     *     surfaced in the hero chip and published in the kind:0 `nip05`
     *     field. All non-active entries still verify via the well-known
     *     endpoint — they just aren't the "primary."
     *   - Handles are unique by `handle` (local part).
     *   - `rotationSecret` is the keyless management token the extension
     *     returns and lets us manage/rotate the entry without an LNbits
     *     account.
     *
     * Cleared on `rotateNostrIdentity` because every handle is bound to
     * the previous pubkey.
     */
    nip05Handles: [],
    /**
     * Epoch-ms the Profile intro carousel was first dismissed, or null
     * if the user has never opened ProfilePage. Used to show the intro
     * exactly once. Reset to null by `reset()` so a fresh identity sees
     * the intro again.
     */
    profileIntroSeenAt: null,
    /**
     * Every NIP-06 account this identity is known to use, sorted by
     * index: [{ i, label?, createdAt? }]. Always contains account 0.
     * "Create another identity" appends here; the roster is what the
     * Change-identity sheet lists and what the published pointer
     * carries so a fresh restore can find every identity again from
     * the same 12 words.
     */
    nostrKnownAccounts: [],
    /**
     * True while the published pointer is known to lag local state (a
     * create/switch whose publish did not land). The Change-identity
     * sheet surfaces a retry; a stale pointer only costs restore
     * accuracy on OTHER devices, so nothing blocks on it locally.
     */
    pointerDirty: false,
    /**
     * Per-account stash of NIP-05 handles keyed by account index.
     * Handles are bound to a pubkey, so switching identities must not
     * drag them along — the active account's handles live in
     * `nip05Handles` (every existing consumer keeps working) and the
     * inactive accounts' handles wait here for the switch back.
     */
    nostrAccountNip05: {},
    /**
     * In-flight pointer discovery, or null. Single-flight so the
     * restore flow can await the same lookup `importMnemonic`'s
     * caller kicked off. Never persisted.
     */
    _pointerResolve: null,
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

    /** The currently-active NIP-05 entry, or null. */
    nip05ActiveEntry(state) {
      return state.nip05Handles.find((h) => h.isActive) || null;
    },

    /** Full `name@mybuho.de` of the active handle, or null. */
    nip05Address(state) {
      const active = state.nip05Handles.find((h) => h.isActive);
      return active ? nip05AddressFor(active.handle) : null;
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
            // Nostr fields are optional — older metadata blobs predate
            // them, so fall back to defaults without invalidating the
            // rest of the persisted state. The account index is clamped
            // to a valid BIP-32 non-hardened range so a hand-edited
            // localStorage value can't break key derivation.
            const persistedAcct = parsed.nostrAccountIndex;
            this.nostrAccountIndex =
              Number.isInteger(persistedAcct) &&
              persistedAcct >= 0 &&
              persistedAcct < NOSTR_MAX_ACCOUNT
                ? persistedAcct
                : 0;
            this.nostrPubkeyHex = parsed.nostrPubkeyHex ?? null;
            this.nostrNpub = parsed.nostrNpub ?? null;
            // NIP-05 handles. New shape is an array; older blobs (before
            // the marketplace landed) persisted a single `nip05Handle` +
            // `nip05RotationSecret`. Migrate transparently — the single
            // handle becomes the only entry, marked free + active, so the
            // boot orchestrator's idempotent path treats the user as
            // "already registered" rather than racing to re-register.
            this.nip05Handles = sanitiseNip05Handles(parsed.nip05Handles)
              ?? legacyToHandleArray(parsed);
            this.profileIntroSeenAt = parsed.profileIntroSeenAt ?? null;
            // Multi-identity fields are newer than the metadata schema;
            // older blobs simply lack them. The roster is re-seeded from
            // the active index so a pre-roster install that already
            // rotated still lists its current identity.
            this.nostrKnownAccounts = sanitizeRoster(
              parsed.nostrKnownAccounts,
              this.nostrAccountIndex,
            );
            this.pointerDirty = !!parsed.pointerDirty;
            this.nostrAccountNip05 = {};
            if (parsed.nostrAccountNip05 && typeof parsed.nostrAccountNip05 === 'object') {
              for (const [key, value] of Object.entries(parsed.nostrAccountNip05)) {
                const idx = Number.parseInt(key, 10);
                const handles = sanitiseNip05Handles(value);
                if (Number.isInteger(idx) && idx >= 0 && handles) {
                  this.nostrAccountNip05[idx] = handles;
                }
              }
            }
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
        nostrAccountIndex: this.nostrAccountIndex,
        nostrPubkeyHex: this.nostrPubkeyHex,
        nostrNpub: this.nostrNpub,
        nip05Handles: this.nip05Handles.map((h) => ({ ...h })),
        profileIntroSeenAt: this.profileIntroSeenAt,
        nostrKnownAccounts: this.nostrKnownAccounts.map((a) => ({ ...a })),
        pointerDirty: this.pointerDirty,
        nostrAccountNip05: Object.fromEntries(
          Object.entries(this.nostrAccountNip05).map(
            ([i, handles]) => [i, handles.map((h) => ({ ...h }))],
          ),
        ),
      };
      localStorage.setItem(STORAGE_KEYS.METADATA, JSON.stringify(payload));
    },

    /**
     * Internal: derive the public Nostr identity (npub + hex pubkey) and
     * cache it on the store. Called from any action that already holds
     * the mnemonic in scope so we never re-decrypt just to compute a
     * pubkey. Throws on derivation failure — callers decide whether to
     * propagate or swallow.
     *
     * @param {string} mnemonic
     */
    _cacheNostrPublic(mnemonic) {
      const { publicKeyHex, npub } = deriveNostrIdentity(
        mnemonic,
        this.nostrAccountIndex,
      );
      this.nostrPubkeyHex = publicKeyHex;
      this.nostrNpub = npub;
    },

    /**
     * Internal: try to cache the Nostr public material but never throw.
     * Used by identity-bootstrap flows (`ensureIdentity`, `importMnemonic`)
     * so a Nostr-derivation failure can't take down the whole identity —
     * LUD-04 sign-in keeps working, and the dialog can call
     * `loadNostrIdentity()` later to retry.
     *
     * @param {string} mnemonic
     */
    _tryCacheNostrPublic(mnemonic) {
      try {
        this._cacheNostrPublic(mnemonic);
      } catch (err) {
        console.warn(
          '[identity] Nostr cache failed at bootstrap, leaving null:',
          err,
        );
        this.nostrPubkeyHex = null;
        this.nostrNpub = null;
      }
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
      this.nostrAccountIndex = 0;
      this.nostrKnownAccounts = [{ i: 0, createdAt: Date.now() }];
      this.pointerDirty = false;
      this.nostrAccountNip05 = {};
      // Nostr cache is best-effort here: a derivation failure must not
      // prevent the user from getting a working LUD-04 identity.
      this._tryCacheNostrPublic(mnemonic);
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
      // Restored identity lands on the canonical NIP-06 account 0 first —
      // fast, deterministic, works offline, and matches what any other
      // Nostr client derives from the same words. Identities created via
      // the account-index climb are recovered afterwards by the restore
      // orchestrator awaiting `resolveActiveNostrAccount()`, which reads
      // the published pointer and silently upgrades the active account.
      // Best-effort cache: a derivation failure must not block the restore.
      this.nostrAccountIndex = 0;
      this.nostrKnownAccounts = [{ i: 0, createdAt: Date.now() }];
      this.pointerDirty = false;
      this.nostrAccountNip05 = {};
      this._tryCacheNostrPublic(normalised);
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
      this.nostrAccountIndex = 0;
      this.nostrPubkeyHex = null;
      this.nostrNpub = null;
      this.nip05Handles = [];
      this.profileIntroSeenAt = null;
      this.nostrKnownAccounts = [];
      this.pointerDirty = false;
      this.nostrAccountNip05 = {};
      this._pointerResolve = null;
    },

    /**
     * Append a newly-registered NIP-05 handle. The first handle added is
     * marked active automatically; subsequent ones default to inactive so
     * a background re-registration never reshuffles the user's published
     * identity. The caller can promote later via `setActiveNip05`.
     *
     * Duplicate handles (same local part) are no-ops — the registration
     * path retries with a fresh suffix on collision, so getting here with
     * a duplicate means the boot orchestrator already added it.
     *
     * @param {{
     *   handle: string,
     *   rotationSecret?: string|null,
     *   isFree?: boolean,
     *   addressId?: string|null,
     * }} info
     */
    addNip05Handle({ handle, rotationSecret = null, isFree = true, addressId = null /* , expiresAt = null */ }) {
      if (!handle) return;
      if (this.nip05Handles.some((h) => h.handle === handle)) return;
      const isFirst = this.nip05Handles.length === 0;
      this.nip05Handles.push({
        handle,
        rotationSecret,
        isFree: !!isFree,
        isActive: isFirst,
        addressId: addressId || null,
        createdAt: Date.now(),
        // Renewal feature disabled — extension doesn't enforce expiry.
        // expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
      });
      this._persistMetadata();
    },

    /**
     * Make the given handle the active one — the address surfaced on the
     * profile and published in the next kind:0. Republishing of the kind:0
     * is NOT triggered here: the profile editor's "Save & Publish" stays
     * the sole relay-broadcast gate, matching the rest of the publish
     * contract.
     *
     * No-op if the handle isn't in the list or is already active.
     *
     * @param {string} handle
     */
    setActiveNip05(handle) {
      if (!handle) return;
      const target = this.nip05Handles.find((h) => h.handle === handle);
      if (!target || target.isActive) return;
      for (const entry of this.nip05Handles) {
        entry.isActive = entry.handle === handle;
      }
      this._persistMetadata();
    },

    /**
     * Drop a handle from the list. If the removed handle was active, the
     * remaining handle with the earliest `createdAt` is promoted so the
     * user never ends up with a populated list and no active entry.
     *
     * Not exposed to the v1 UI — there is no keyless delete-by-rotation
     * endpoint on the extension, so a "removed" handle would keep
     * resolving via the well-known. Kept for tests and future server
     * support.
     *
     * @param {string} handle
     */
    removeNip05Handle(handle) {
      if (!handle) return;
      const before = this.nip05Handles.length;
      this.nip05Handles = this.nip05Handles.filter((h) => h.handle !== handle);
      if (this.nip05Handles.length === before) return;
      if (!this.nip05Handles.some((h) => h.isActive) && this.nip05Handles.length > 0) {
        const next = [...this.nip05Handles].sort(
          (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
        )[0];
        next.isActive = true;
      }
      this._persistMetadata();
    },

    /**
     * Mark the Profile intro carousel as seen so it does not re-appear
     * on subsequent visits. Idempotent: re-calling is a no-op once set.
     */
    markProfileIntroSeen() {
      if (this.profileIntroSeenAt) return;
      this.profileIntroSeenAt = Date.now();
      this._persistMetadata();
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
    // Nostr (NIP-06) keys
    //
    // Public material (`nostrPubkeyHex`, `nostrNpub`) is cached on the
    // store and persisted, so the UI can render the user's npub without
    // touching the encrypted mnemonic. Private material (`nsec`,
    // `privateKeyHex`) is *never* persisted and only returned from a
    // dedicated action — caller decides how long to hold it.
    // -------------------------------------------------------------------

    /**
     * Make sure the cached Nostr public material is populated for the
     * current identity. Idempotent. Useful from existing-user flows where
     * `bootstrapped` is true (metadata is hydrated) but the cache predates
     * the Nostr feature.
     *
     * @returns {Promise<{ pubkeyHex: string, npub: string } | null>}
     *   `null` if no identity exists yet.
     */
    async loadNostrIdentity() {
      if (!this.bootstrapped) return null;
      if (this.nostrPubkeyHex && this.nostrNpub) {
        return { pubkeyHex: this.nostrPubkeyHex, npub: this.nostrNpub };
      }

      const mnemonic = await this.getMnemonic();
      try {
        this._cacheNostrPublic(mnemonic);
        this._persistMetadata();
        return { pubkeyHex: this.nostrPubkeyHex, npub: this.nostrNpub };
      } finally {
        // eslint-disable-next-line no-unused-vars
        const _drop = mnemonic;
      }
    },

    /**
     * Reveal the current Nostr secret key. Decrypts the mnemonic, derives
     * the NIP-06 keypair for the active account, and returns the secret
     * key in both raw and bech32 forms. The decrypted mnemonic and the
     * returned secret material are never assigned to store state.
     *
     * Caller is responsible for:
     *   1. Gating this call behind biometric/PIN (App Lock).
     *   2. Wiping local references when the reveal UI closes.
     *
     * @returns {Promise<{ privateKeyHex: string, nsec: string }>}
     */
    async revealNostrSecret() {
      if (!this.bootstrapped) {
        const err = new Error('No identity seed');
        err.code = 'IDENTITY_NOT_BOOTSTRAPPED';
        throw err;
      }
      const mnemonic = await this.getMnemonic();
      try {
        const { privateKey, nsec } = deriveNostrIdentity(
          mnemonic,
          this.nostrAccountIndex,
        );
        return { privateKeyHex: bytesToHex(privateKey), nsec };
      } finally {
        // eslint-disable-next-line no-unused-vars
        const _drop = mnemonic;
      }
    },

    /**
     * Internal: return the raw 32-byte schnorr secret key bytes for the
     * current Nostr account. Used by `profileStore.publish()` to sign
     * kind:0 / kind:10002 events; not surfaced to user-facing UI and
     * deliberately not gated by an extra biometric prompt — the app-
     * level lock already covered entry to the app, and the byte buffer
     * is meant to be consumed and wiped within a single call.
     *
     * The returned array is freshly allocated on every call; callers
     * SHOULD `secretKey.fill(0)` once they no longer need it. We never
     * cache these bytes on the store and never persist them.
     *
     * @returns {Promise<Uint8Array>}  32 bytes
     */
    async getNostrSecretKeyBytes() {
      if (!this.bootstrapped) {
        const err = new Error('No identity seed');
        err.code = 'IDENTITY_NOT_BOOTSTRAPPED';
        throw err;
      }
      const mnemonic = await this.getMnemonic();
      try {
        const { privateKey } = deriveNostrIdentity(
          mnemonic,
          this.nostrAccountIndex,
        );
        return privateKey;
      } finally {
        // eslint-disable-next-line no-unused-vars
        const _drop = mnemonic;
      }
    },

    /**
     * Rotate to a fresh Nostr key while keeping the BuhoGO identity (the
     * BIP-39 seed) unchanged. Bumps the NIP-06 account index by one and
     * recomputes the cached pubkey/npub.
     *
     * Old keys are *not* unrecoverable — anyone with the recovery phrase
     * can re-derive them — but the UI forgets them, so the user has a
     * single canonical Nostr identity at any time. This is the right
     * trade-off for the "forget my Nostr key" intent: cryptographic
     * destruction would require burning the whole identity.
     *
     * @returns {Promise<{ pubkeyHex: string, npub: string, account: number }>}
     */
    async rotateNostrIdentity() {
      if (!this.bootstrapped) {
        const err = new Error('No identity seed');
        err.code = 'IDENTITY_NOT_BOOTSTRAPPED';
        throw err;
      }

      const currentAccount = Number.isInteger(this.nostrAccountIndex)
        ? this.nostrAccountIndex
        : 0;
      const nextAccount = currentAccount + 1;
      if (nextAccount >= NOSTR_MAX_ACCOUNT) {
        // Practically unreachable (2^31 rotations), but a hard wall is
        // better than a silent BIP-32 collision once we ever do hit it.
        const err = new Error('Nostr account index exhausted');
        err.code = 'NOSTR_ACCOUNT_EXHAUSTED';
        throw err;
      }

      const mnemonic = await this.getMnemonic();
      try {
        const { publicKeyHex, npub } = deriveNostrIdentity(mnemonic, nextAccount);

        // Persist-then-commit: write to disk first, only mutate the
        // reactive state once the metadata is durable. If localStorage
        // throws (quota exceeded, etc.), the user stays on the old key
        // instead of seeing a "new" npub that vanishes on next reload.
        const prev = {
          account: this.nostrAccountIndex,
          pubkey: this.nostrPubkeyHex,
          npub: this.nostrNpub,
          nip05Handles: this.nip05Handles.map((h) => ({ ...h })),
          knownAccounts: this.nostrKnownAccounts.map((a) => ({ ...a })),
        };
        this.nostrAccountIndex = nextAccount;
        this.nostrPubkeyHex = publicKeyHex;
        this.nostrNpub = npub;
        // Every handle maps the *previous* pubkey; clear the list so the
        // boot orchestrator registers a fresh free handle for the new key.
        // Premium handles bought under the old key stay valid server-side
        // but are no longer this app's to manage.
        this.nip05Handles = [];
        // Rotation is the forget-my-key flow, but the account still
        // joins the roster: the index is in use, and the Change-identity
        // sheet must never offer a "next" index that collides with it.
        this.nostrKnownAccounts = sanitizeRoster(
          [...this.nostrKnownAccounts, { i: nextAccount, createdAt: Date.now() }],
          nextAccount,
        );
        // This dormant path publishes no pointer itself; flag the lag
        // so the Change-identity sheet's retry surface picks it up.
        const prevPointerDirty = this.pointerDirty;
        this.pointerDirty = true;
        try {
          this._persistMetadata();
        } catch (persistErr) {
          this.nostrAccountIndex = prev.account;
          this.nostrPubkeyHex = prev.pubkey;
          this.nostrNpub = prev.npub;
          this.nip05Handles = prev.nip05Handles;
          this.nostrKnownAccounts = prev.knownAccounts;
          this.pointerDirty = prevPointerDirty;
          throw persistErr;
        }

        return { pubkeyHex: publicKeyHex, npub, account: nextAccount };
      } finally {
        // eslint-disable-next-line no-unused-vars
        const _drop = mnemonic;
      }
    },

    // -------------------------------------------------------------------
    // Multiple identities — the account-index climb
    //
    // Another identity NEVER means another mnemonic. It is the next
    // NIP-06 account under the SAME 12 words, so the one recovery
    // phrase the user already backed up covers every identity forever.
    // The roster (`nostrKnownAccounts`) plus the published pointer
    // (utils/nostrIdentityPointer.js) make the climb restorable on a
    // fresh device; without the pointer a restore would silently land
    // on account 0 and lose sight of everything above it.
    // -------------------------------------------------------------------

    /**
     * Internal: park the active account's NIP-05 handles and load the
     * target account's. Handles are bound to a pubkey — they must not
     * travel across a switch, and they must still be there when the
     * user switches back.
     */
    _stashAndLoadNip05(fromAccount, toAccount) {
      this.nostrAccountNip05[fromAccount] = this.nip05Handles.map((h) => ({ ...h }));
      this.nip05Handles = (this.nostrAccountNip05[toAccount] || []).map((h) => ({ ...h }));
    },

    /**
     * Create the next identity: derive at the lowest index above every
     * roster entry, make it active, and publish the pointer so the new
     * identity survives a fresh restore.
     *
     * Pointer publish failure never rolls the creation back — the new
     * identity is real the moment the metadata is durable; the pointer
     * only affects OTHER devices' restores, so it degrades to
     * `pointerDirty` plus a retry surface in the sheet.
     *
     * @param {{
     *   label?:   string,
     *   pointer?: object,   // injection for tests / relay overrides —
     *                       // forwarded to republishNostrPointer()
     * }} [opts]
     * @returns {Promise<{ pubkeyHex: string, npub: string, account: number }>}
     */
    async createAnotherNostrIdentity({ label, pointer } = {}) {
      if (!this.bootstrapped) {
        const err = new Error('No identity seed');
        err.code = 'IDENTITY_NOT_BOOTSTRAPPED';
        throw err;
      }

      const highest = this.nostrKnownAccounts.reduce(
        (max, a) => Math.max(max, a.i),
        this.nostrAccountIndex,
      );
      const nextAccount = highest + 1;
      if (nextAccount >= NOSTR_MAX_ACCOUNT) {
        const err = new Error('Nostr account index exhausted');
        err.code = 'NOSTR_ACCOUNT_EXHAUSTED';
        throw err;
      }

      const mnemonic = await this.getMnemonic();
      try {
        const { publicKeyHex, npub } = deriveNostrIdentity(mnemonic, nextAccount);

        // Persist-then-commit, same contract as rotateNostrIdentity: if
        // localStorage rejects, the user stays on the old identity
        // instead of seeing a new npub that vanishes on reload.
        const prev = {
          account: this.nostrAccountIndex,
          pubkey: this.nostrPubkeyHex,
          npub: this.nostrNpub,
          nip05Handles: this.nip05Handles.map((h) => ({ ...h })),
          knownAccounts: this.nostrKnownAccounts.map((a) => ({ ...a })),
          accountNip05: { ...this.nostrAccountNip05 },
        };
        this._stashAndLoadNip05(this.nostrAccountIndex, nextAccount);
        this.nostrAccountIndex = nextAccount;
        this.nostrPubkeyHex = publicKeyHex;
        this.nostrNpub = npub;
        const entry = { i: nextAccount, createdAt: Date.now() };
        if (typeof label === 'string' && label.trim()) entry.label = label.trim();
        this.nostrKnownAccounts = sanitizeRoster(
          [...this.nostrKnownAccounts, entry],
          nextAccount,
        );
        // The published pointer lags local truth until the publish
        // below lands — flag it now so a crash in between still shows
        // the retry surface on next launch.
        this.pointerDirty = true;
        try {
          this._persistMetadata();
        } catch (persistErr) {
          this.nostrAccountIndex = prev.account;
          this.nostrPubkeyHex = prev.pubkey;
          this.nostrNpub = prev.npub;
          this.nip05Handles = prev.nip05Handles;
          this.nostrKnownAccounts = prev.knownAccounts;
          this.nostrAccountNip05 = prev.accountNip05;
          throw persistErr;
        }

        await this.republishNostrPointer(pointer);
        return { pubkeyHex: publicKeyHex, npub, account: nextAccount };
      } finally {
        // eslint-disable-next-line no-unused-vars
        const _drop = mnemonic;
      }
    },

    /**
     * Switch the active identity to another roster account. Cheap and
     * reversible by design — no confirmation ceremony belongs here.
     *
     * @param {number} account  a roster index (from `nostrKnownAccounts`)
     * @param {{ pointer?: object }} [opts]
     * @returns {Promise<{ pubkeyHex: string, npub: string, account: number }>}
     */
    async switchNostrIdentity(account, { pointer } = {}) {
      if (!this.bootstrapped) {
        const err = new Error('No identity seed');
        err.code = 'IDENTITY_NOT_BOOTSTRAPPED';
        throw err;
      }
      if (!this.nostrKnownAccounts.some((a) => a.i === account)) {
        const err = new Error('Unknown identity account');
        err.code = 'NOSTR_ACCOUNT_UNKNOWN';
        throw err;
      }
      if (account === this.nostrAccountIndex) {
        return {
          pubkeyHex: this.nostrPubkeyHex,
          npub: this.nostrNpub,
          account,
        };
      }

      const mnemonic = await this.getMnemonic();
      try {
        const { publicKeyHex, npub } = deriveNostrIdentity(mnemonic, account);

        const prev = {
          account: this.nostrAccountIndex,
          pubkey: this.nostrPubkeyHex,
          npub: this.nostrNpub,
          nip05Handles: this.nip05Handles.map((h) => ({ ...h })),
          accountNip05: { ...this.nostrAccountNip05 },
        };
        this._stashAndLoadNip05(this.nostrAccountIndex, account);
        this.nostrAccountIndex = account;
        this.nostrPubkeyHex = publicKeyHex;
        this.nostrNpub = npub;
        this.pointerDirty = true;
        try {
          this._persistMetadata();
        } catch (persistErr) {
          this.nostrAccountIndex = prev.account;
          this.nostrPubkeyHex = prev.pubkey;
          this.nostrNpub = prev.npub;
          this.nip05Handles = prev.nip05Handles;
          this.nostrAccountNip05 = prev.accountNip05;
          throw persistErr;
        }

        await this.republishNostrPointer(pointer);
        return { pubkeyHex: publicKeyHex, npub, account };
      } finally {
        // eslint-disable-next-line no-unused-vars
        const _drop = mnemonic;
      }
    },

    /**
     * Derive the display material for every roster identity in one
     * mnemonic decrypt. Read-only — nothing is cached or persisted;
     * the Change-identity sheet calls this when it opens.
     *
     * @returns {Promise<Array<{
     *   account: number, npub: string, label: string | null, active: boolean,
     * }>>}
     */
    async listNostrIdentities() {
      if (!this.bootstrapped) return [];
      const mnemonic = await this.getMnemonic();
      try {
        return this.nostrKnownAccounts.map((entry) => {
          let npub = '';
          let pubkeyHex = '';
          try {
            const derived = deriveNostrIdentity(mnemonic, entry.i);
            npub = derived.npub;
            pubkeyHex = derived.publicKeyHex;
          } catch { /* row renders without an npub rather than not at all */ }

          // The username is how the owner recognises a card: "Card 2" names
          // nothing, "@maria" names the person it is. The active account's
          // handles live in nip05Handles; every other account's wait in the
          // per-account stash, so no row needs the network to get its name.
          const handles = entry.i === this.nostrAccountIndex
            ? this.nip05Handles
            : this.nostrAccountNip05[entry.i] || [];
          const named = handles.find((h) => h.isActive) || handles[0] || null;

          return {
            account: entry.i,
            npub,
            pubkeyHex,
            label: entry.label || null,
            username: named?.handle || null,
            active: entry.i === this.nostrAccountIndex,
          };
        });
      } finally {
        // eslint-disable-next-line no-unused-vars
        const _drop = mnemonic;
      }
    },

    /**
     * Publish the pointer from current local truth (active account +
     * roster), signed by the account-0 key. Clears `pointerDirty` on
     * an accepted publish, sets it on failure. Never throws for
     * network reasons — a stale pointer is a retryable condition, not
     * an error state.
     *
     * @param {{
     *   pool?:      any,
     *   relays?:    readonly string[],
     *   timeoutMs?: number,
     *   fetcher?:   typeof fetchPointer,    // injected in tests
     *   publisher?: typeof publishPointer,  // injected in tests
     * }} [opts]
     * @returns {Promise<{ ok: boolean, acceptedRelay: string | null }>}
     */
    async republishNostrPointer({ pool, relays, timeoutMs, fetcher, publisher } = {}) {
      if (!this.bootstrapped) return { ok: false, acceptedRelay: null };
      const doFetch = typeof fetcher === 'function' ? fetcher : fetchPointer;
      const doPublish = typeof publisher === 'function' ? publisher : publishPointer;

      let secretKey0 = null;
      try {
        const mnemonic = await this.getMnemonic();
        const account0 = deriveNostrIdentity(mnemonic, 0);
        secretKey0 = account0.privateKey;
        const pubkey0 = account0.publicKeyHex;

        // The pointer's relay home is account 0's: that is the key a
        // fresh restore derives first and queries with.
        let relaySet = relays;
        if (!Array.isArray(relaySet) || relaySet.length === 0) {
          const own = await fetchOwnWriteRelays({ pool, pubkey: pubkey0, timeoutMs });
          relaySet = [...new Set([...DEFAULT_RELAYS, ...own])];
        }

        // Replaceable event: strictly outbid whatever is out there so
        // this publish wins even against a skewed clock. The fetched
        // pointer is more than a clock floor — its roster may know
        // identities this device does not (created elsewhere, never
        // hydrated here). Publishing only the local roster would
        // orphan them for every future restore, so the rosters merge
        // and the store learns the union too. The ACTIVE index stays
        // local: this publish exists to broadcast the user's latest
        // action on this device.
        let floorCreatedAt = 0;
        try {
          const existing = await doFetch({
            pool, relays: relaySet, pubkey0, secretKey0, timeoutMs,
          });
          if (existing) {
            floorCreatedAt = existing.eventCreatedAt;
            this.nostrKnownAccounts = sanitizeRoster(
              [...this.nostrKnownAccounts, ...existing.accounts],
              this.nostrAccountIndex,
            );
          }
        } catch { /* best-effort floor; now() still wins the common case */ }

        const event = buildPointerEvent({
          secretKey0,
          pubkey0,
          active: this.nostrAccountIndex,
          accounts: this.nostrKnownAccounts,
          createdAt: Math.max(Math.floor(Date.now() / 1000), floorCreatedAt + 1),
        });
        const fanout = doPublish({ pool, relays: relaySet, event, timeoutMs });
        const firstAccept = await fanout.firstAccept;

        this.pointerDirty = !firstAccept;
        this._persistMetadata();
        return { ok: !!firstAccept, acceptedRelay: firstAccept ? firstAccept.relay : null };
      } catch (err) {
        console.warn('[identity] pointer publish failed:', err);
        this.pointerDirty = true;
        try { this._persistMetadata(); } catch { /* keep the in-memory flag */ }
        return { ok: false, acceptedRelay: null };
      } finally {
        if (secretKey0) secretKey0.fill(0);
      }
    },

    /**
     * Discover the active identity from the published pointer — the
     * restore path's account-climb recovery. Lands silently on the
     * pointer's account when it is above the current one and merges
     * its roster; finding nothing means account 0 stays, which is
     * exactly today's behavior and always safe.
     *
     * Single-flight: the restore orchestrators (ProfilePage's phrase
     * restore and the cloud-backup Drive restore) await this BEFORE
     * contact recovery so contacts are pulled for the right identity,
     * and a second caller during that window shares the same lookup.
     *
     * @param {{
     *   pool?:      any,
     *   relays?:    readonly string[],
     *   timeoutMs?: number,
     *   fetcher?:   typeof fetchPointer,   // injected in tests
     * }} [opts]
     * @returns {Promise<{ found: boolean, active: number, upgraded: boolean }>}
     */
    async resolveActiveNostrAccount({ pool, relays, timeoutMs = 4000, fetcher } = {}) {
      if (!this.bootstrapped) {
        return { found: false, active: this.nostrAccountIndex, upgraded: false };
      }
      if (this._pointerResolve) return this._pointerResolve;

      const doFetch = typeof fetcher === 'function' ? fetcher : fetchPointer;
      const run = (async () => {
        let secretKey0 = null;
        try {
          const mnemonic = await this.getMnemonic();
          const account0 = deriveNostrIdentity(mnemonic, 0);
          secretKey0 = account0.privateKey;

          // Query the same relay set the publish targets (defaults
          // union account 0's NIP-65 write relays) — a pointer that
          // only landed on the user's own relays must still be found
          // by a restore. Skipped for injected fetchers: a stub
          // ignores relays and the NIP-65 lookup would hit the
          // network from unit tests.
          let relaySet = relays;
          if ((!Array.isArray(relaySet) || relaySet.length === 0) && doFetch === fetchPointer) {
            const own = await fetchOwnWriteRelays({
              pool, pubkey: account0.publicKeyHex, timeoutMs,
            });
            relaySet = [...new Set([...DEFAULT_RELAYS, ...own])];
          }

          const pointer = await doFetch({
            pool,
            relays: relaySet,
            pubkey0: account0.publicKeyHex,
            secretKey0,
            timeoutMs,
          });
          if (!pointer) {
            return { found: false, active: this.nostrAccountIndex, upgraded: false };
          }

          this.nostrKnownAccounts = sanitizeRoster(
            [...this.nostrKnownAccounts, ...pointer.accounts],
            Math.max(pointer.active, this.nostrAccountIndex),
          );
          let upgraded = false;
          if (pointer.active > this.nostrAccountIndex) {
            const derived = deriveNostrIdentity(mnemonic, pointer.active);
            this._stashAndLoadNip05(this.nostrAccountIndex, pointer.active);
            this.nostrAccountIndex = pointer.active;
            this.nostrPubkeyHex = derived.publicKeyHex;
            this.nostrNpub = derived.npub;
            upgraded = true;
          }
          this._persistMetadata();
          return { found: true, active: this.nostrAccountIndex, upgraded };
        } catch (err) {
          // Discovery is strictly additive; any failure means "stay
          // where we are", never a broken restore.
          console.warn('[identity] pointer discovery failed:', err);
          return { found: false, active: this.nostrAccountIndex, upgraded: false };
        } finally {
          if (secretKey0) secretKey0.fill(0);
        }
      })();

      this._pointerResolve = run;
      try {
        return await run;
      } finally {
        this._pointerResolve = null;
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
