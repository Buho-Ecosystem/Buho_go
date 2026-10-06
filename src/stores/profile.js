/**
 * The active identity's public profile and durable synchronization state.
 *
 * Each public key has one localStorage document. Profile fields, pending
 * field revisions, the latest Nostr event version, and a signed publication
 * all persist together. `isDirty` is derived from pending field revisions;
 * network activity flags are never persisted.
 *
 * Local edits invalidate the signed outbox. An acknowledgment clears only
 * the revisions included in that event. Recovery applies newer remote events
 * to synchronized fields while retaining unpublished local edits. Async work
 * captures an account session so late results cannot affect another identity.
 *
 * The profileSync service owns scheduling, activation and retries. This store
 * owns content, persistence, signing and event ordering; the identity store
 * owns keys. Only PROFILE_FIELDS are published, using the wire names below.
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
import { nip05AddressFor, ownUsernameFrom, splitNip05, isFreeShapeHandle } from '../services/nip05.js';
import {
  fetchProfile as fetchProfileFromRelays,
  parseProfileContent,
  compareEventFreshness,
} from '../utils/nostrFetch.js';
import { uploadAvatar as uploadAvatarToBlossom } from '../utils/blossomProfileMedia.js';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const STORAGE_KEY = 'buhoGO_profile_v1';
const LEGACY_STORAGE_KEY = STORAGE_KEY;

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
  'nip05',
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
  nip05: 'nip05',
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
  nip05: 200,
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

/** True for a retired free `name.123456` handle on our own domain. */
function isOwnFreeShape(nip05) {
  const parts = splitNip05(nip05);
  return !!parts && parts.ours && isFreeShapeHandle(parts.local);
}

/**
 * The username a saved or live profile shows: its own-domain `nip05`
 * unless that address was found to point at someone else's key.
 */
function usernameOf(nip05, notMine) {
  if (notMine && nip05 === notMine) return '';
  return ownUsernameFrom(nip05);
}

// ----------------------------------------------------------------------------
// Store
// ----------------------------------------------------------------------------

export const useProfileStore = defineStore('profile', {
  state: () => ({
    /** True once persisted state has been loaded from disk. */
    hydrated: false,
    /** Storage namespace currently loaded into this store. */
    hydratedProfileKey: '',

    // ---- Profile content (camelCase locally) ----
    displayName: '',
    name: '',
    about: '',
    website: '',
    picture: '',
    banner: '',
    lud16: '',
    nip05: '',

    // ---- Username bookkeeping (persisted, never published) ----
    /**
     * A `nip05` on our domain that the name server says belongs to another
     * key (only possible if another app wrote it). Remembered so it is not
     * shown as this person's username; cleared when `nip05` changes.
     */
    nip05NotMine: '',
    /** Epoch ms the home tab's username suggestion was dismissed, or null. */
    usernameSuggestionDismissedAt: null,

    // ---- Editor / publish lifecycle (not all persisted) ----
    /** Local edit sequence and the revision still owed for each edited field. */
    revision: 0,
    /** Last username change and its origin, retained to arbitrate a delayed claim. */
    usernameVersion: { revision: 0, event: null },
    pendingFields: {},
    /** Latest authored/applied kind:0 version, independent of wall-clock publish time. */
    eventVersion: null,
    /** Signed outbox entry. Retries send the same event until the content changes. */
    pendingEvent: null,
    /** Receipt written atomically with a claimed username; closes interrupted handoffs. */
    lastUsernameClaim: '',
    /** Invalidates asynchronous work when this store loads a different session. */
    session: 0,
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
    usernameRevision(state) {
      return state.usernameVersion.revision;
    },
    isDirty(state) {
      return Object.keys(state.pendingFields).length > 0;
    },
    /** True iff every editable field is empty. Drives the "Set up your profile" empty state. */
    isEmpty(state) {
      // A username is optional and set on its own screen, not part of
      // filling in the card, so nip05 alone does not count.
      return PROFILE_FIELDS.every((field) => field === 'nip05' || !state[field]);
    },

    /**
     * The person's username: the local part of their published `nip05`
     * when it is a paid name on our domain (`maria` for `maria@mybuho.de`),
     * else ''. The one value every screen reads. The profile is the source
     * of truth, so a restore or a second phone shows it with no extra step.
     */
    username(state) {
      return usernameOf(state.nip05, state.nip05NotMine);
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
    _profileStorageKey() {
      const identity = useIdentityStore();
      const key = identity.nostrPubkeyHex || `account-${identity.nostrAccountIndex ?? 0}`;
      return `${STORAGE_KEY}_${key}`;
    },

    _clearFields() {
      for (const field of PROFILE_FIELDS) this[field] = '';
      this.nip05NotMine = '';
      this.usernameSuggestionDismissedAt = null;
      this.revision = 0;
      this.usernameVersion = { revision: 0, event: null };
      this.pendingFields = {};
      this.eventVersion = null;
      this.pendingEvent = null;
      this.lastUsernameClaim = '';
      this.session += 1;
      this.isPublishing = false;
      this.lastPublishedAt = null;
      this.lastPublishResult = null;
      this.isUploadingAvatar = false;
      this.lastAvatarUploadResult = null;
    },

    async hydrate({ force = false } = {}) {
      const storageKey = this._profileStorageKey();
      if (this.hydrated && !force && this.hydratedProfileKey === storageKey) return;

      this._clearFields();

      try {
        let raw = localStorage.getItem(storageKey);
        // Migrate the pre-multi-account profile exactly once to the account
        // that was active when the app first adopts per-account storage.
        if (!raw && !localStorage.getItem(`${STORAGE_KEY}_migrated`)) {
          raw = localStorage.getItem(LEGACY_STORAGE_KEY);
          if (raw) {
            localStorage.setItem(storageKey, raw);
            localStorage.setItem(`${STORAGE_KEY}_migrated`, '1');
            localStorage.removeItem(LEGACY_STORAGE_KEY);
          }
        }
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
            this.nip05NotMine =
              typeof parsed.nip05NotMine === 'string' ? parsed.nip05NotMine : '';
            this.usernameSuggestionDismissedAt =
              Number.isFinite(parsed.usernameSuggestionDismissedAt)
                ? parsed.usernameSuggestionDismissedAt
                : null;
            this.revision = Number.isSafeInteger(parsed.revision) && parsed.revision >= 0 ? parsed.revision : 0;
            if (Number.isSafeInteger(parsed.usernameVersion?.revision)
                && parsed.usernameVersion.revision >= 0 && parsed.usernameVersion.revision <= this.revision) {
              this.usernameVersion = {
                revision: parsed.usernameVersion.revision,
                event: Number.isFinite(parsed.usernameVersion.event?.created_at) ? parsed.usernameVersion.event : null,
              };
            }
            for (const field of PROFILE_FIELDS) {
              const revision = parsed.pendingFields?.[field];
              if (Number.isSafeInteger(revision) && revision > 0 && revision <= this.revision) {
                this.pendingFields[field] = revision;
              }
            }
            if (Number.isFinite(parsed.eventVersion?.created_at) && typeof parsed.eventVersion?.id === 'string') {
              this.eventVersion = parsed.eventVersion;
            }
            const pending = parsed.pendingEvent;
            if (this.isDirty && pending?.revision === this.revision && pending.event?.kind === 0
                && pending.event.pubkey === useIdentityStore().nostrPubkeyHex
                && pending.event.id === this.eventVersion?.id) {
              this.pendingEvent = pending;
            }
            this.lastUsernameClaim = typeof parsed.lastUsernameClaim === 'string' ? parsed.lastUsernameClaim : '';
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
      this.hydratedProfileKey = storageKey;
    },

    /**
     * Internal: write the persistable subset of state to localStorage.
     *
     * Content and its synchronization work share one atomic storage write.
     * Network activity flags are transient; pending edits and signed events aren't.
     */
    _persistMetadata() {
      const fields = {};
      for (const field of PROFILE_FIELDS) {
        fields[field] = this[field];
      }
      const payload = {
        version: METADATA_VERSION,
        ...dropEmptyStringFields(fields),
        revision: this.revision,
        usernameVersion: this.usernameVersion,
        pendingFields: { ...this.pendingFields },
        eventVersion: this.eventVersion,
        pendingEvent: this.pendingEvent,
        lastUsernameClaim: this.lastUsernameClaim,
      };
      if (this.lastPublishedAt !== null) {
        payload.lastPublishedAt = this.lastPublishedAt;
      }
      if (this.nip05NotMine) payload.nip05NotMine = this.nip05NotMine;
      if (this.usernameSuggestionDismissedAt !== null) {
        payload.usernameSuggestionDismissedAt = this.usernameSuggestionDismissedAt;
      }
      const encoded = JSON.stringify(payload);
      localStorage.setItem(this._profileStorageKey(), encoded);
      // Keep the legacy key as a compatibility mirror for older builds. It
      // is never used to load a profile after migration, so it cannot merge
      // account state; it only prevents an upgrade from looking empty.
      localStorage.setItem(LEGACY_STORAGE_KEY, encoded);
      localStorage.setItem(`${STORAGE_KEY}_migrated`, '1');
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
      this.applyEdits({ [field]: value });
    },

    /**
     * The person's name, written the one way Nostr apps agree on:
     * `display_name` and `name` carry the same value, so every client shows
     * the same name once. The only writer of either field.
     *
     * @param {string} value
     */
    setDisplayName(value) {
      this.applyEdits({ displayName: value, name: value });
    },

    /**
     * Make `localPart@mybuho.de` the published username. Callers run the
     * ownership check first; this only writes. Marks the profile dirty, so
     * the background sync (`boot/profile-sync.js`) publishes it and retries
     * on its own when the phone is offline.
     *
     * @param {string} localPart e.g. `maria`
     */
    setUsername(localPart) {
      const address = nip05AddressFor(String(localPart || '').trim().toLowerCase());
      if (!address) return;
      const clearedNotMine = !!this.nip05NotMine;
      this.nip05NotMine = '';
      if (this.nip05 !== address) this.setField('nip05', address);
      else if (clearedNotMine) this._persistMetadata();
    },

    /** The profile write is the durable handoff from purchase to publication. */
    acceptUsernameClaim(handle, paymentHash, { select = true } = {}) {
      if (this.lastUsernameClaim === paymentHash) return;
      const previous = this.lastUsernameClaim;
      this.lastUsernameClaim = paymentHash;
      try {
        if (select) this.setUsername(handle);
        // Also save receipts when the name already matches or the user chose another.
        this._persistMetadata();
      } catch (err) {
        this.lastUsernameClaim = previous;
        throw err;
      }
    },

    /** Capture account/session once, and recheck at every async boundary. */
    captureSession() {
      const pubkey = useIdentityStore().nostrPubkeyHex;
      const session = this.session;
      const key = this._profileStorageKey();
      return { pubkey, current: () => this.session === session
        && useIdentityStore().nostrPubkeyHex === pubkey && this._profileStorageKey() === key };
    },

    /**
     * Remember that the current own-domain `nip05` points at someone else's
     * key, so it is never shown as this person's username. The profile
     * itself is left alone: it is theirs, and a claim replaces the value.
     */
    markNip05NotMine() {
      if (!this.nip05 || this.nip05NotMine === this.nip05) return;
      this.nip05NotMine = this.nip05;
      this._persistMetadata();
    },

    /** Hide the home tab's username suggestion for this identity, for good. */
    dismissUsernameSuggestion() {
      this.usernameSuggestionDismissedAt = Date.now();
      this._persistMetadata();
    },

    /**
     * Drop the retired free `name.123456` handle that older versions put in
     * every profile. A profile that was published goes through `setField`
     * so the background sync republishes it without the handle; one that
     * never left the phone is cleaned quietly.
     *
     * @returns {boolean} true when something was dropped
     */
    dropFreeNip05() {
      if (!isOwnFreeShape(this.nip05)) return false;
      if (this.hasEverPublished) {
        this.setField('nip05', '');
      } else {
        this.nip05 = '';
        this._persistMetadata();
      }
      return true;
    },

    /**
     * The username of another identity on this phone, read from that
     * identity's saved profile (profiles are stored per key). Same rule as
     * the `username` getter; '' when nothing is saved.
     *
     * @param {string} pubkeyHex
     * @returns {string}
     */
    savedUsernameFor(pubkeyHex) {
      const identity = useIdentityStore();
      if (!pubkeyHex) return '';
      if (pubkeyHex === identity.nostrPubkeyHex) return this.username;
      try {
        const raw = localStorage.getItem(`${STORAGE_KEY}_${pubkeyHex}`);
        if (!raw) return '';
        const parsed = JSON.parse(raw);
        return usernameOf(parsed?.nip05, parsed?.nip05NotMine);
      } catch {
        return '';
      }
    },

    /**
     * Adopt a default payment address as `lud16`.
     *
     * Without a `lud16` a username is unpayable: a payer resolves the name to
     * this profile and then to this field, and gives up when it is empty. The
     * app brings its own default — the first Spark wallet's Lightning address
     * when one exists, the Social Bucket otherwise.
     *
     * A user's own address always wins. This only fills an empty field or
     * replaces a value the caller declares replaceable (a bucket address, or
     * a spark address of ours that just changed), and never touches an
     * address the user typed in, because that is their money routing decision
     * and not ours to override.
     *
     * Marks the profile dirty on purpose: the field is worthless until it is
     * published, and `isDirty` is what tells the boot step to publish it.
     *
     * @param {string} address The default to adopt.
     * @param {{ isReplaceable: (current: string) => boolean }} opts
     * @returns {boolean} true when the value changed
     */
    adoptDefaultPaymentAddress(address, { isReplaceable }) {
      const value = normaliseFieldValue('lud16', address);
      if (!value) return false;
      const current = this.lud16;
      if (current === value) return false;
      // Only ever replace nothing, or a default of our own.
      if (current && !isReplaceable(current)) return false;
      this.setField('lud16', value);
      return true;
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
      const changed = [];
      for (const [field, value] of Object.entries(patch)) {
        if (!PROFILE_FIELDS.includes(field)) continue;
        const next = normaliseFieldValue(field, value);
        if (this[field] !== next) {
          this[field] = next;
          changed.push(field);
        }
      }
      if (changed.length) {
        this.revision += 1;
        for (const field of changed) this.pendingFields[field] = this.revision;
        if (changed.includes('nip05')) {
          this.nip05NotMine = '';
          this.usernameVersion = { revision: this.revision, event: null };
        }
        this.pendingEvent = null;
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
      await this.hydrate();
      if (this.isUploadingAvatar) return { ok: false, code: 'BUSY' };

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
      const scope = this.captureSession();
      const uploadOpts = {};
      if (opts.server) uploadOpts.server = opts.server;
      if (Number.isFinite(opts.maxBytes)) uploadOpts.maxBytes = opts.maxBytes;
      if (opts.fetch) uploadOpts.fetch = opts.fetch;

      this.isUploadingAvatar = true;
      try {
        const secretKey = await identity.getNostrSecretKeyBytes();
        let upshot;
        try {
          if (!scope.current()) return { ok: false, code: 'IDENTITY_CHANGED' };
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
        if (!scope.current()) return { ok: false, code: 'IDENTITY_CHANGED' };
        this.setField('picture', upshot.url);

        const result = { ok: true, ...upshot };
        this.lastAvatarUploadResult = result;
        return result;
      } catch (err) {
        const result = {
          ok: false,
          code: err?.code || 'AVATAR_UNKNOWN_ERROR',
          message: err?.message || 'Avatar upload failed',
        };
        if (scope.current()) this.lastAvatarUploadResult = result;
        return result;
      } finally {
        if (scope.current()) this.isUploadingAvatar = false;
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
      await this.hydrate();
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

      const scope = this.captureSession();
      const revision = this.revision;
      const payload = this.publishablePayload;

      this.isPublishing = true;
      try {
        // Sign first, publish second — keep the secret-key window as
        // narrow as we can. The finally below wipes the buffer even
        // if signing throws (which the builders don't for valid input).
        const secretKey = await identity.getNostrSecretKeyBytes();
        let profileEvent;
        let relayListEvent;
        try {
          if (!scope.current() || this.revision !== revision) return null;
          const createdAt = Math.max(
            Number.isFinite(opts.createdAt) ? opts.createdAt : Math.floor(Date.now() / 1000),
            (this.eventVersion?.created_at ?? -1) + 1,
          );
          profileEvent = this.pendingEvent?.revision === revision
            ? this.pendingEvent.event
            : buildKind0Event(payload, secretKey, { createdAt });
          if (profileEvent.pubkey !== scope.pubkey) return null;
          relayListEvent = buildKind10002Event(relays, secretKey, {
            createdAt: profileEvent.created_at,
          });
          this.eventVersion = { created_at: profileEvent.created_at, id: profileEvent.id };
          this.pendingEvent = { revision, event: profileEvent };
          this._persistMetadata();
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
          if (scope.current() && this.eventVersion?.id === profileEvent.id) this.lastPublishResult = results;
          return results;
        });

        const firstAccept = await profileFanout.firstAccept;

        if (firstAccept) {
          if (scope.current() && compareEventFreshness(profileEvent, this.eventVersion) <= 0) {
            this.lastPublishedAt = Date.now();
            for (const [field, editedAt] of Object.entries(this.pendingFields)) {
              if (editedAt <= revision) delete this.pendingFields[field];
            }
            if (this.pendingEvent?.event.id === profileEvent.id) this.pendingEvent = null;
            this._persistMetadata();
          }
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
        if (scope.current()) this.isPublishing = false;
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
     * Only a newer event may be applied, and only to fields without pending
     * local edits. An account/session or revision change during the fetch
     * invalidates the response. Recovery never acknowledges local work.
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
      const scope = this.captureSession();
      const revision = this.revision;
      const skipped = (reason) => ({ ok: true, hadRemote: false, applied: 0, fields: [], reason });

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
      if (!scope.current()) return skipped('identity-changed');
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

      if (!scope.current()) return skipped('identity-changed');
      if (this.revision !== revision) return skipped('local-changed');
      if (this.eventVersion && compareEventFreshness(event, this.eventVersion) >= 0) return skipped('stale-event');
      // Older builds only saved a wall-clock timestamp. It cannot establish an
      // exact event version, but must not permit a clearly older profile rollback.
      if (!this.eventVersion && this.lastPublishedAt && event.created_at < Math.floor(this.lastPublishedAt / 1000)) {
        return skipped('stale-event');
      }

      // Remote omissions clear synchronized fields. Pending local edits,
      // including explicit removals, survive and are published on top.
      const content = parseProfileContent(event);
      const patch = {};
      const applied = [];
      for (const field of PROFILE_FIELDS) {
        if (this.pendingFields[field]) continue;
        const wireKey = FIELD_TO_CONTENT_KEY[field];
        const raw = content[wireKey];
        const value = typeof raw === 'string' ? raw : '';
        patch[field] = value;
        if (value) applied.push(field);
      }

      // A retired free handle must not come back in through a restore. The
      // relays still carry it, so the profile goes out again without it.
      const droppedFreeName = isOwnFreeShape(patch.nip05);
      if (droppedFreeName) patch.nip05 = '';

      this.revision += 1;
      for (const [field, value] of Object.entries(patch)) {
        if (field === 'nip05' && this.nip05 !== value) {
          this.nip05NotMine = '';
          this.usernameVersion = { revision: this.revision, event: { created_at: event.created_at, id: event.id } };
        }
        this[field] = normaliseFieldValue(field, value);
      }
      this.eventVersion = { created_at: event.created_at, id: event.id };
      this.pendingEvent = null;

      // This is the remote event's time, not a local acknowledgment. Pending
      // fields retain their revisions until their own event is accepted.
      this.lastPublishedAt = Number.isFinite(event.created_at)
        ? event.created_at * 1000
        : Date.now();
      if (droppedFreeName) this.pendingFields.nip05 = this.revision;
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
      this._clearFields();
      localStorage.removeItem(this._profileStorageKey());
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      this.hydratedProfileKey = this._profileStorageKey();
    },
  },
});
