/**
 * Profile Store
 *
 * The editable profile that lives "on top of" a BuhoGO identity. Where
 * `identityStore` owns the cryptographic seed and its derived keys,
 * `profileStore` owns the public, human-readable layer the user fills
 * in: display name, bio, avatar URL, Lightning address, and so on.
 *
 * The split matters because the two have different security and
 * persistence shapes:
 *
 *   - identityStore is gated by the device-key envelope, holds an
 *     encrypted mnemonic, never persists private material in the clear,
 *     and is the only place the Nostr secret key can be derived.
 *
 *   - profileStore is plaintext metadata. Every field is something the
 *     user is about to broadcast to the open Nostr network anyway, so
 *     localStorage in the clear is fine. Mixing it into the identity
 *     store would muddy the encryption boundary and make the identity
 *     test surface larger than it needs to be.
 *
 * This module is intentionally just the editable model + persistence.
 * Publishing (building kind:0 + kind:10002, fanning out to relays,
 * surfacing per-relay results) lands in Step 4 alongside the
 * identity-store accessor that hands over the schnorr secret key on
 * demand. Keeping that boundary clean lets the editor UI work
 * offline against this store and lets the publish action be tested
 * with a mocked relay pool without coming back through any
 * cryptographic primitive.
 *
 * Storage model:
 *   - One blob at `buhoGO_profile_v1`. Versioned for forward
 *     compatibility — same `METADATA_VERSION` pattern as identityStore.
 *   - Empty fields are dropped from the blob on persist so the file on
 *     disk stays a clean reflection of what the user actually set. A
 *     user who has typed nothing gets a `{ version: 1 }` blob, not a
 *     row of empty strings.
 *
 * Field conventions:
 *   - Local state uses camelCase (`displayName`, `lud16`).
 *   - The wire shape (kind:0 content) uses snake_case (`display_name`).
 *     The mapping lives in `buildPublishablePayload()` so the event
 *     builder in `utils/nostrProfile.js` never has to know about the
 *     store, and the store never has to know about NIP-01.
 */

import { defineStore } from 'pinia';
import { useIdentityStore } from './identity.js';
import {
  DEFAULT_RELAYS,
  getRelayPool,
  publishToRelaysEager,
} from '../utils/nostrRelays.js';
import {
  buildKind0Event,
  buildKind10002Event,
} from '../utils/nostrProfile.js';
import {
  fetchProfile as fetchProfileFromRelays,
  parseProfileContent,
} from '../utils/nostrFetch.js';
import { uploadAvatar as uploadAvatarToBlossom } from '../utils/blossomProfileMedia.js';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const STORAGE_KEY = 'buhoGO_profile_v1';

/** Schema version for the persisted blob. Bump on breaking change. */
const METADATA_VERSION = 1;

/**
 * Every editable field on the store. Order is the order the editor
 * sheet renders them in — useful for deterministic iteration and
 * predictable JSON output for log lines / snapshots.
 *
 * Keep this list in sync with `PROFILE_CONTENT_FIELDS` in
 * `utils/nostrProfile.js`; the mapping table below converts between
 * the two casings.
 */
export const PROFILE_FIELDS = Object.freeze([
  'displayName',
  'name',
  'about',
  'website',
  'picture',
  'banner',
  'lud16',
]);

/**
 * Local field name → NIP-01 content key. Anything not in this map is
 * not published. Defined once so `buildPublishablePayload` stays a
 * pure lookup with no branching.
 */
const FIELD_TO_CONTENT_KEY = Object.freeze({
  displayName: 'display_name',
  name: 'name',
  about: 'about',
  website: 'website',
  picture: 'picture',
  banner: 'banner',
  lud16: 'lud16',
});

/**
 * Length caps. The user-facing editor enforces these too, but the
 * store applies them defensively on `setField` so a paste of pages
 * of text can never bloat the persisted blob or a published event.
 *
 * `about` matches the 280-char counter shown in the editor sheet
 * (the same number bluesky / X conditioned everyone to expect). Every
 * other field is capped at 200 — long enough for any realistic URL,
 * lightning address, or display name, short enough that obvious
 * abuse is rejected on the way in.
 */
const FIELD_MAX_LENGTH = Object.freeze({
  displayName: 200,
  name: 200,
  about: 280,
  website: 200,
  picture: 500,
  banner: 500,
  lud16: 200,
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Normalise an input string to the store's canonical form:
 *   - non-strings → ''
 *   - trim leading/trailing whitespace
 *   - truncate to the per-field max
 *
 * `setField` runs every write through this so the state shape stays
 * predictable regardless of how the editor feeds values in.
 */
function normaliseFieldValue(field, raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const cap = FIELD_MAX_LENGTH[field] ?? 200;
  return trimmed.length > cap ? trimmed.slice(0, cap) : trimmed;
}

/**
 * Strip empty fields out of an object. Used at persist time so the
 * blob on disk never carries `displayName: ""` style noise.
 */
function dropEmptyStringFields(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.length > 0) {
      out[key] = value;
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Store
// ----------------------------------------------------------------------------

export const useProfileStore = defineStore('profile', {
  state: () => ({
    /** True once persisted state has been loaded from disk. */
    hydrated: false,

    // ---- Profile content (camelCase locally) ----
    displayName: '',
    name: '',
    about: '',
    website: '',
    picture: '',
    banner: '',
    lud16: '',

    // ---- Editor / publish lifecycle (not all persisted) ----
    /** True after `setField` changes a value, until the next successful publish or reset. */
    isDirty: false,
    /** True while a publish is in flight. Set by Step 4's publish action. */
    isPublishing: false,
    /** Epoch ms of the last successful publish (any relay accepted). Persisted. */
    lastPublishedAt: null,
    /**
     * Per-relay outcome of the most recent publish, shape:
     *   Array<{ relay: string, ok: boolean, error: string | null }>
     * Not persisted — it's transient UI feedback, not source-of-truth state.
     */
    lastPublishResult: null,

    /** True while a Blossom avatar upload is in flight. */
    isUploadingAvatar: false,
    /**
     * Outcome of the most recent avatar upload, shape:
     *   { ok: true,  url, hash, mime, size, server }
     *   | { ok: false, code: string, message: string }
     * Not persisted — purely UI feedback for the avatar picker.
     */
    lastAvatarUploadResult: null,
  }),

  getters: {
    /** True iff every editable field is empty. Drives the "Set up your profile" empty state. */
    isEmpty(state) {
      return PROFILE_FIELDS.every((field) => !state[field]);
    },

    /**
     * Snake-case object ready to hand to `buildKind0Event`. Empty
     * fields are excluded; the builder's own `normaliseProfileContent`
     * would drop them anyway, but doing it here keeps logs and tests
     * honest about what we're actually sending.
     */
    publishablePayload(state) {
      const out = {};
      for (const field of PROFILE_FIELDS) {
        const value = state[field];
        if (typeof value === 'string' && value.length > 0) {
          out[FIELD_TO_CONTENT_KEY[field]] = value;
        }
      }
      return out;
    },

    /** True if we've ever published this profile successfully. */
    hasEverPublished(state) {
      return state.lastPublishedAt !== null;
    },
  },

  actions: {
    // -------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------

    /**
     * Read persisted state from localStorage. Idempotent. Should be
     * called once on the Profile route mount.
     */
    async hydrate() {
      if (this.hydrated) return;

      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.version === METADATA_VERSION) {
            // Restore each whitelisted field. Anything missing or of
            // the wrong shape falls back to the default empty string;
            // unknown keys in the blob are ignored, so a forward-
            // compatible future field can't crash old clients.
            for (const field of PROFILE_FIELDS) {
              const value = parsed[field];
              this[field] = typeof value === 'string' ? value : '';
            }
            this.lastPublishedAt =
              Number.isFinite(parsed.lastPublishedAt)
                ? parsed.lastPublishedAt
                : null;
          }
        }
      } catch (err) {
        // Corrupted blob shouldn't block the Profile page. Defaults
        // are safe: the user just sees an empty editor and can save
        // again. We don't try to "repair" the blob here — the next
        // `_persistMetadata()` will overwrite it cleanly.
        console.warn('[profile] hydrate failed, using defaults:', err);
      }

      this.hydrated = true;
    },

    /**
     * Internal: write the persistable subset of state to localStorage.
     *
     * Only "settled" content + the last-published timestamp are
     * persisted. Editor lifecycle flags (`isDirty`, `isPublishing`,
     * `lastPublishResult`) are reset to defaults every app boot — they
     * describe an in-progress operation, not a fact about the user.
     */
    _persistMetadata() {
      const fields = {};
      for (const field of PROFILE_FIELDS) {
        fields[field] = this[field];
      }
      const payload = {
        version: METADATA_VERSION,
        ...dropEmptyStringFields(fields),
      };
      if (this.lastPublishedAt !== null) {
        payload.lastPublishedAt = this.lastPublishedAt;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    },

    // -------------------------------------------------------------------
    // Editor actions
    // -------------------------------------------------------------------

    /**
     * Set one field. Normalises the incoming value (trim + length cap)
     * and marks the store dirty only if the value actually changed —
     * tapping a field then leaving it alone shouldn't enable the
     * "Save & Publish" button.
     *
     * Throws on an unknown field name. Silent ignore would hide UI
     * bugs (a typoed prop name in the editor) until someone noticed
     * their bio wasn't saving.
     *
     * @param {string} field   - one of `PROFILE_FIELDS`
     * @param {string} value
     */
    setField(field, value) {
      if (!PROFILE_FIELDS.includes(field)) {
        throw new RangeError(`Unknown profile field: ${String(field)}`);
      }
      const next = normaliseFieldValue(field, value);
      if (this[field] === next) return;
      this[field] = next;
      this.isDirty = true;
      this._persistMetadata();
    },

    /**
     * Bulk-apply a set of edits (e.g. when the editor sheet saves all
     * fields at once). Marks dirty if any value changed.
     *
     * Unknown keys are ignored rather than throwing so a future field
     * appearing in a backup blob doesn't break restore. The contract
     * for `setField` is stricter because that path is reached from
     * direct UI interaction.
     *
     * @param {Record<string, string>} patch
     */
    applyEdits(patch) {
      if (!patch || typeof patch !== 'object') return;
      let changed = false;
      for (const [field, value] of Object.entries(patch)) {
        if (!PROFILE_FIELDS.includes(field)) continue;
        const next = normaliseFieldValue(field, value);
        if (this[field] !== next) {
          this[field] = next;
          changed = true;
        }
      }
      if (changed) {
        this.isDirty = true;
        this._persistMetadata();
      }
    },

    // -------------------------------------------------------------------
    // Avatar upload
    // -------------------------------------------------------------------

    /**
     * Upload a new avatar to Blossom, set the `picture` field to the
     * returned URL, and mark the profile dirty so the next "Save &
     * Publish" picks it up.
     *
     * The avatar URL is *not* published by this action — the user
     * still has to confirm the rest of their edits and hit publish.
     * That keeps a partially-typed display name from going out on the
     * wire just because someone picked a new photo.
     *
     * Failure handling: the prior `picture` value is preserved (no
     * destructive write on error), and `lastAvatarUploadResult`
     * carries the typed error code so the UI can render a specific
     * message — "too large", "unsupported format", "network", etc.
     *
     * Re-entrancy: no-op while a previous upload is still running.
     *
     * Test injection: `opts.uploader` lets the spec swap in a fake
     * Blossom helper. Production callers pass nothing.
     *
     * @param {{ size: number, type: string, arrayBuffer: () => Promise<ArrayBuffer> }} file
     * @param {{
     *   server?:   string,
     *   maxBytes?: number,
     *   fetch?:    typeof fetch,
     *   uploader?: typeof uploadAvatarToBlossom,
     * }} [opts]
     * @returns {Promise<
     *   | { ok: true,  url: string, hash: string, mime: string, size: number, server: string }
     *   | { ok: false, code: string, message: string }
     * >}
     */
    async uploadAvatar(file, opts = {}) {
      if (this.isUploadingAvatar) {
        return this.lastAvatarUploadResult ?? { ok: false, code: 'BUSY', message: 'Upload already in flight' };
      }

      const identity = useIdentityStore();
      if (!identity.bootstrapped) {
        const result = {
          ok: false,
          code: 'IDENTITY_NOT_BOOTSTRAPPED',
          message: 'No identity seed',
        };
        this.lastAvatarUploadResult = result;
        return result;
      }

      const upload = opts.uploader ?? uploadAvatarToBlossom;
      const uploadOpts = {};
      if (opts.server) uploadOpts.server = opts.server;
      if (Number.isFinite(opts.maxBytes)) uploadOpts.maxBytes = opts.maxBytes;
      if (opts.fetch) uploadOpts.fetch = opts.fetch;

      this.isUploadingAvatar = true;
      try {
        const secretKey = await identity.getNostrSecretKeyBytes();
        let upshot;
        try {
          upshot = await upload(file, secretKey, uploadOpts);
        } finally {
          // Wipe the key bytes regardless of whether the upload
          // succeeded — the helper signs once before any network I/O
          // so the key is no longer needed by the time we hit this
          // line.
          secretKey.fill(0);
        }

        // Success: commit the new URL into `picture` and mark dirty
        // so the next publish carries it. Persist immediately so a
        // crash between upload and publish doesn't lose the URL.
        if (this.picture !== upshot.url) {
          this.picture = upshot.url;
          this.isDirty = true;
          this._persistMetadata();
        }

        const result = { ok: true, ...upshot };
        this.lastAvatarUploadResult = result;
        return result;
      } catch (err) {
        const result = {
          ok: false,
          code: err?.code || 'AVATAR_UNKNOWN_ERROR',
          message: err?.message || 'Avatar upload failed',
        };
        this.lastAvatarUploadResult = result;
        return result;
      } finally {
        this.isUploadingAvatar = false;
      }
    },

    // -------------------------------------------------------------------
    // Publish
    // -------------------------------------------------------------------

    /**
     * Publish the current profile to the default relay set.
     *
     * Two events go out per publish:
     *   1. kind:0   — profile metadata (display name, bio, avatar URL, …)
     *   2. kind:10002 — relay list (NIP-65)
     *
     * Success is decided on kind:0 alone with eager semantics: the
     * moment a single relay acks the profile event, the publish is
     * "done" from the user's perspective. The remaining kind:0
     * attempts and the entire kind:10002 fan-out continue in the
     * background — their full per-relay outcome lands on
     * `lastPublishResult` once every WebSocket settles.
     *
     * Product rule (Plan 09): a publish is considered successful if
     * at least one relay accepted the profile. Clearing `isDirty`
     * follows that rule. A total kind:0 failure keeps `isDirty` so
     * the editor's "Save & Publish" button stays available without
     * the user having to re-type anything.
     *
     * Secret-key handling: we ask `identityStore` for fresh schnorr
     * bytes, hand them to the two builders, and immediately zero the
     * buffer. The signed events themselves carry only the signature,
     * never the key.
     *
     * Re-entrancy: no-op while a previous publish is still in flight.
     *
     * Return shape:
     *   `{ ok: true,  acceptedRelay, settled }` — first relay accepted
     *   `{ ok: false, results, settled }`      — every kind:0 relay refused
     *
     * `settled` is a promise that resolves with the full per-relay
     * result array once every WebSocket settles. UI callers can
     * ignore it; tests await it for full coverage.
     *
     * Test injection: `opts.pool`, `opts.relays`, `opts.createdAt`,
     * `opts.timeoutMs` are for the spec; production callers pass
     * nothing.
     *
     * @param {{
     *   pool?: import('nostr-core').RelayPool,
     *   relays?: readonly string[],
     *   createdAt?: number,
     *   timeoutMs?: number,
     * }} [opts]
     * @returns {Promise<
     *   | { ok: true,  acceptedRelay: string, settled: Promise<Array<{relay,ok,error}>> }
     *   | { ok: false, results: Array<{relay,ok,error}>, settled: Promise<Array<{relay,ok,error}>> }
     *   | null
     * >}
     */
    async publish(opts = {}) {
      if (this.isPublishing) return null;

      const identity = useIdentityStore();
      if (!identity.bootstrapped) {
        const err = new Error('No identity seed');
        err.code = 'IDENTITY_NOT_BOOTSTRAPPED';
        throw err;
      }

      const pool = opts.pool ?? getRelayPool();
      const relays = Array.isArray(opts.relays) ? opts.relays : DEFAULT_RELAYS;
      const publishOpts = Number.isFinite(opts.timeoutMs)
        ? { timeoutMs: opts.timeoutMs }
        : undefined;

      this.isPublishing = true;
      try {
        // Sign first, publish second — keep the secret-key window as
        // narrow as we can. The finally below wipes the buffer even
        // if signing throws (which the builders don't for valid input).
        const secretKey = await identity.getNostrSecretKeyBytes();
        let profileEvent;
        let relayListEvent;
        try {
          profileEvent = buildKind0Event(this.publishablePayload, secretKey, {
            createdAt: opts.createdAt,
          });
          relayListEvent = buildKind10002Event(relays, secretKey, {
            createdAt: opts.createdAt,
          });
        } finally {
          // Best-effort wipe. V8 may still hold finalised copies of
          // the buffer, but our reference is gone and the array
          // itself is zeroed before falling out of scope.
          secretKey.fill(0);
        }

        // Fire both events in parallel. kind:10002 is genuinely
        // background — we log its outcome but never gate the UI on
        // it. kind:0 drives the success/failure decision.
        const profileFanout = publishToRelaysEager(pool, relays, profileEvent, publishOpts);
        const relayListFanout = publishToRelaysEager(pool, relays, relayListEvent, publishOpts);

        // Background log for the relay-list fan-out so we have
        // visibility without making the user wait.
        relayListFanout.allSettled.then((results) => {
          console.info('[profile] relay list publish settled:', results);
        }).catch(() => { /* allSettled never rejects */ });

        // Combined "settle" promise: resolves with the full kind:0
        // per-relay results AND updates `lastPublishResult` as a
        // side-effect. Exposed on the return value so tests + future
        // UI surfaces can subscribe to it.
        const settled = profileFanout.allSettled.then((results) => {
          this.lastPublishResult = results;
          return results;
        });

        const firstAccept = await profileFanout.firstAccept;

        if (firstAccept) {
          this.lastPublishedAt = Date.now();
          this.isDirty = false;
          this._persistMetadata();
          return {
            ok: true,
            acceptedRelay: firstAccept.relay,
            settled,
          };
        }

        // First-accept resolved null → every kind:0 relay refused.
        // Wait for the full settle to get the error detail the UI
        // can render in its failure banner.
        const results = await settled;
        console.warn('[profile] publish landed on zero relays:', results);
        return { ok: false, results, settled: Promise.resolve(results) };
      } finally {
        this.isPublishing = false;
      }
    },

    // -------------------------------------------------------------------
    // Recovery (pull from Nostr after an identity restore)
    // -------------------------------------------------------------------

    /**
     * Pull the user's most recent kind:0 profile metadata from the
     * default relay set and apply it locally. The mirror of
     * `addressBookStore.recoverFromNostr`: where that one rebuilds
     * the private NIP-51 contact list after a seed restore, this
     * one rebuilds the public profile so the avatar, display name,
     * bio, lud16, etc. come back too.
     *
     * Semantics:
     *   - Full overwrite. Every field in `PROFILE_FIELDS` is written
     *     from the remote event, defaulting to '' when the remote
     *     event omits it. This clears any stale value left over from
     *     a previously bootstrapped identity on the same device.
     *   - The remote IS the published source of truth, so the local
     *     copy is considered clean after this runs (`isDirty=false`).
     *     `lastPublishedAt` is stamped from the event's `created_at`
     *     so the editor's "last published" hint reflects reality
     *     rather than the moment of restore.
     *   - Failure modes never throw. Network errors, missing
     *     identity, no remote event all return a structured result
     *     so the caller's restore-toast logic can branch cleanly.
     *
     * Test injection: `fetcher` swaps in a fake `fetchProfile` for
     * unit tests; `pool`, `relays`, `timeoutMs` are forwarded to the
     * default fetcher. Production callers pass `{ identityStore }`
     * and nothing else.
     *
     * @param {{
     *   identityStore: ReturnType<typeof useIdentityStore>,
     *   pool?:         import('nostr-core').RelayPool,
     *   relays?:       readonly string[],
     *   timeoutMs?:    number,
     *   fetcher?:      typeof fetchProfileFromRelays,
     * }} opts
     * @returns {Promise<{
     *   ok: boolean,
     *   reason?: 'identity-not-bootstrapped' | 'fetch-failed',
     *   hadRemote: boolean,
     *   applied: number,
     *   fields: string[],
     * }>}
     */
    async recoverFromNostr({ identityStore, pool, relays, timeoutMs, fetcher } = {}) {
      await this.hydrate();

      if (!identityStore || !identityStore.bootstrapped) {
        return {
          ok: false,
          reason: 'identity-not-bootstrapped',
          hadRemote: false,
          applied: 0,
          fields: [],
        };
      }

      // Make sure the pubkey cache is populated. `loadNostrIdentity`
      // is idempotent and a no-op when the cache is already warm.
      const identityKeys = await identityStore.loadNostrIdentity();
      if (!identityKeys?.pubkeyHex) {
        return {
          ok: false,
          reason: 'identity-not-bootstrapped',
          hadRemote: false,
          applied: 0,
          fields: [],
        };
      }

      const fetchOne = typeof fetcher === 'function' ? fetcher : fetchProfileFromRelays;
      const fetchOpts = {};
      if (pool) fetchOpts.pool = pool;
      if (Array.isArray(relays) && relays.length > 0) fetchOpts.relays = relays;
      if (Number.isFinite(timeoutMs)) fetchOpts.timeoutMs = timeoutMs;

      let event;
      try {
        event = await fetchOne(identityKeys.pubkeyHex, fetchOpts);
      } catch (err) {
        // Pool failures already collapse to `null` inside
        // `fetchProfile`. Reaching this branch means something
        // upstream of the network call broke (e.g. a programming
        // bug). Log it and surface a typed failure so the caller
        // can show a "couldn't reach relays" hint without crashing
        // the restore flow.
        console.warn('[profile] recoverFromNostr fetch failed:', err);
        return {
          ok: false,
          reason: 'fetch-failed',
          hadRemote: false,
          applied: 0,
          fields: [],
        };
      }

      if (!event) {
        return { ok: true, hadRemote: false, applied: 0, fields: [] };
      }

      // Build a full patch covering every editable field so any
      // stale local-only value from a previous identity is cleared
      // out in the same pass.
      const content = parseProfileContent(event);
      const patch = {};
      const applied = [];
      for (const field of PROFILE_FIELDS) {
        const wireKey = FIELD_TO_CONTENT_KEY[field];
        const raw = content[wireKey];
        const value = typeof raw === 'string' ? raw : '';
        patch[field] = value;
        if (value) applied.push(field);
      }

      this.applyEdits(patch);

      // The fields we just wrote came straight off a published
      // event, so the local copy is in sync with the relays — clear
      // the dirty flag that `applyEdits` set, and stamp the event's
      // signing time as the last-published moment.
      this.isDirty = false;
      this.lastPublishedAt = Number.isFinite(event.created_at)
        ? event.created_at * 1000
        : Date.now();
      this._persistMetadata();

      return {
        ok: true,
        hadRemote: true,
        applied: applied.length,
        fields: applied,
      };
    },

    /**
     * Wipe every editable field + persisted blob. Returns to the
     * fresh-install empty state. Does not touch the identity store —
     * the user keeps their Nostr key and recovery phrase.
     */
    reset() {
      for (const field of PROFILE_FIELDS) {
        this[field] = '';
      }
      this.isDirty = false;
      this.isPublishing = false;
      this.lastPublishedAt = null;
      this.lastPublishResult = null;
      this.isUploadingAvatar = false;
      this.lastAvatarUploadResult = null;
      localStorage.removeItem(STORAGE_KEY);
    },
  },
});
