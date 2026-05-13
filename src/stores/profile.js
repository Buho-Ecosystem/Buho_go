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
      localStorage.removeItem(STORAGE_KEY);
    },
  },
});
