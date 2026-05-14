<template>
  <div class="search-pane">
    <!-- Identifier input -->
    <div class="search-input-wrap">
      <Icon
        icon="tabler:search"
        width="16"
        height="16"
        class="search-input-icon"
      />
      <input
        ref="input"
        v-model="rawInput"
        type="text"
        class="search-input"
        :class="$q.dark.isActive ? 'search-input-dark' : 'search-input-light'"
        :placeholder="$t('npub, NIP-05, or nostr: link')"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        @keydown.enter.prevent="onSubmit"
      />
      <button
        v-if="rawInput"
        type="button"
        class="search-clear-btn"
        :aria-label="$t('Clear')"
        @click="reset({ keepFocus: true })"
      >
        <Icon icon="tabler:x" width="14" height="14" />
      </button>
    </div>

    <!-- Helper / status line under the input. Single source for both
         hint text (idle) and inline error copy (typed-code mapped). -->
    <div
      class="search-helper"
      :class="[
        $q.dark.isActive ? 'search-helper-dark' : 'search-helper-light',
        statusTone === 'error' ? 'search-helper--error' : '',
        statusTone === 'progress' ? 'search-helper--progress' : '',
      ]"
    >
      <q-spinner
        v-if="statusTone === 'progress'"
        size="13px"
        class="q-mr-xs"
      />
      <Icon
        v-else-if="statusTone === 'error'"
        icon="tabler:alert-circle"
        width="13"
        height="13"
      />
      <Icon
        v-else-if="kind"
        :icon="kindIcon"
        width="13"
        height="13"
      />
      <span>{{ statusText }}</span>
    </div>

    <!-- Preview, once we have a profile (or know we already have it
         saved). NostrContactPreview owns the visual moment; this
         component is just the orchestration layer. -->
    <NostrContactPreview
      v-if="previewReady"
      class="search-preview"
      :pubkey="resolved.pubkey"
      :npub="resolved.npub"
      :profile="parsedProfile"
      :nip05-verified="nip05Verified"
      :existing-entry="existingEntry"
      :saving="isSaving"
      @save="onSave"
      @open-existing="onOpenExisting"
      @copy-npub="onCopyNpub"
    />
  </div>
</template>

<script>
import { useAddressBookStore } from '../../stores/addressBook';
import { mapActions } from 'pinia';
import { classifyIdentifier, lookupIdentifier, LOOKUP_ERROR, NIP05_ERROR } from '../../utils/nostrLookup.js';
import { fetchProfile, parseProfileContent } from '../../utils/nostrFetch.js';
import { copyToClipboard } from 'quasar';
import NostrContactPreview from './NostrContactPreview.vue';

const DEBOUNCE_MS = 350;

/**
 * Pure-function fallback npub formatter — same shape NostrContactPreview
 * uses internally. We re-derive it here only for status copy.
 */
function shortenNpub(npub) {
  if (typeof npub !== 'string' || npub.length <= 16) return npub || '';
  return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
}

export default {
  name: 'AddContactSearch',

  components: { NostrContactPreview },

  emits: ['saved', 'open-existing'],

  data() {
    return {
      rawInput: '',
      kind: null,                  // 'npub' | 'hex' | 'nprofile' | 'nip05' | null
      // Stage drives the visible status / preview readiness.
      //   idle       → empty input, generic helper shown
      //   detected   → input parses to something we recognise
      //   resolving  → waiting on NIP-05 or kind:0 fetch
      //   ready      → kind:0 loaded; preview can render
      //   not-found  → relays returned no profile for the pubkey
      //   error      → typed-code error, surfaced via friendly copy
      stage: 'idle',
      errorCode: null,
      resolved: null,              // { pubkey, npub, relays, source, nip05? }
      profileEvent: null,          // verified kind:0 NostrEvent
      isSaving: false,
      debounceHandle: null,
      lookupController: null,
      fetchController: null,
      // Monotonically-increasing token so a stale async result can't
      // overwrite a newer in-flight resolution.
      currentToken: 0,
    };
  },

  computed: {
    parsedProfile() {
      return this.profileEvent ? parseProfileContent(this.profileEvent) : {};
    },

    /** Tri-state NIP-05 verification (only meaningful for the nip05 path). */
    nip05Verified() {
      if (!this.resolved || !this.profileEvent) return null;
      // We trust the NIP-05 lookup result *because* we already verified
      // event signature server-side in fetchProfile. The remaining
      // check the UI shows is: does the profile's self-claimed nip05
      // match what we resolved against?
      if (this.resolved.source !== 'nip05') {
        // For npub / hex / nprofile, we don't have an authoritative
        // NIP-05 lookup to compare against. Show "unknown" rather than
        // a false positive.
        return null;
      }
      const selfClaimed = typeof this.parsedProfile?.nip05 === 'string'
        ? this.parsedProfile.nip05.trim().toLowerCase()
        : '';
      if (!selfClaimed) return null;
      const claimed = selfClaimed.startsWith('_@') ? selfClaimed.slice(2) : selfClaimed;
      const resolved = (this.resolved.nip05 || '').toLowerCase();
      const resolvedBare = resolved.startsWith('_@') ? resolved.slice(2) : resolved;
      return claimed === resolvedBare;
    },

    existingEntry() {
      if (!this.resolved) return null;
      const store = useAddressBookStore();
      return store.findContactByPubkey(this.resolved.pubkey);
    },

    previewReady() {
      return this.stage === 'ready' && this.resolved && this.profileEvent;
    },

    kindIcon() {
      const icons = {
        npub:     'tabler:key',
        nprofile: 'tabler:key',
        hex:      'tabler:key',
        nip05:    'tabler:at',
      };
      return icons[this.kind] || 'tabler:circle';
    },

    statusTone() {
      switch (this.stage) {
        case 'resolving': return 'progress';
        case 'error':     return 'error';
        case 'not-found': return 'error';
        default:          return 'neutral';
      }
    },

    statusText() {
      switch (this.stage) {
        case 'idle':
          return this.$t('Paste a Nostr identifier to find someone.');
        case 'detected':
          return this.detectedHint;
        case 'resolving':
          return this.resolvingText;
        case 'ready':
          return this.resolved?.nip05
            ? this.resolved.nip05
            : shortenNpub(this.resolved?.npub);
        case 'not-found':
          return this.$t("We couldn't find a Nostr profile for this identifier yet.");
        case 'error':
          return this.errorCopy;
        default:
          return '';
      }
    },

    detectedHint() {
      switch (this.kind) {
        case 'npub':     return this.$t('Looks like a Nostr identifier (npub).');
        case 'nprofile': return this.$t('Nostr profile with relay hints.');
        case 'hex':      return this.$t('Looks like a Nostr pubkey.');
        case 'nip05':    return this.$t('Looks like a NIP-05 identifier.');
        default:         return '';
      }
    },

    resolvingText() {
      // While resolving, the same line shows progress copy specific
      // to the step we're on (handle lookup vs profile fetch).
      if (this.kind === 'nip05' && !this.resolved) return this.$t('Resolving NIP-05 identifier…');
      return this.$t('Looking up the profile…');
    },

    errorCopy() {
      const code = this.errorCode;
      // Map typed codes to human-friendly copy. Anything we don't
      // recognise gets the soft generic fallback so the UI never
      // shows a raw error string.
      switch (code) {
        case LOOKUP_ERROR.UNRECOGNIZED:
          return this.$t("That doesn't look like a Nostr identifier yet.");
        case LOOKUP_ERROR.INVALID_NPUB:
          return this.$t("This npub doesn't decode correctly.");
        case LOOKUP_ERROR.INVALID_NPROFILE:
          return this.$t("This nprofile doesn't decode correctly.");
        case LOOKUP_ERROR.INVALID_HEX:
          return this.$t('Expected a 64-character pubkey.');
        case NIP05_ERROR.INVALID_FORMAT:
          return this.$t("That doesn't look like a valid NIP-05 identifier.");
        case NIP05_ERROR.NETWORK:
          return this.$t("We couldn't reach the server for this NIP-05 right now.");
        case NIP05_ERROR.HTTP:
          return this.$t("The server didn't answer with a NIP-05 record.");
        case NIP05_ERROR.BAD_RESPONSE:
          return this.$t('The NIP-05 server returned something we cannot read.');
        case NIP05_ERROR.NOT_FOUND:
          return this.$t('No one with that NIP-05 is registered on that server.');
        case NIP05_ERROR.PUBKEY_INVALID:
          return this.$t('The NIP-05 server returned an invalid pubkey.');
        default:
          return this.$t('Something went wrong. Please try again.');
      }
    },
  },

  watch: {
    rawInput() {
      this.scheduleLookup();
    },
  },

  beforeUnmount() {
    this.cancelInFlight();
    if (this.debounceHandle) clearTimeout(this.debounceHandle);
  },

  methods: {
    ...mapActions(useAddressBookStore, ['addNostrContact']),

    focus() {
      this.$nextTick(() => this.$refs.input?.focus());
    },

    reset({ keepFocus = false } = {}) {
      this.cancelInFlight();
      if (this.debounceHandle) {
        clearTimeout(this.debounceHandle);
        this.debounceHandle = null;
      }
      this.rawInput = '';
      this.kind = null;
      this.stage = 'idle';
      this.errorCode = null;
      this.resolved = null;
      this.profileEvent = null;
      if (keepFocus) this.focus();
    },

    cancelInFlight() {
      try { this.lookupController?.abort(); } catch { /* no-op */ }
      try { this.fetchController?.abort(); } catch { /* no-op */ }
      this.lookupController = null;
      this.fetchController = null;
    },

    onSubmit() {
      // Bypass debounce on Enter — let power users skip the wait.
      if (this.debounceHandle) {
        clearTimeout(this.debounceHandle);
        this.debounceHandle = null;
      }
      this.runLookup();
    },

    scheduleLookup() {
      this.cancelInFlight();
      if (this.debounceHandle) clearTimeout(this.debounceHandle);

      const trimmed = (this.rawInput || '').trim();
      const kind = classifyIdentifier(trimmed);
      this.kind = kind;

      if (!trimmed) {
        this.stage = 'idle';
        this.errorCode = null;
        this.resolved = null;
        this.profileEvent = null;
        return;
      }

      if (!kind) {
        // Don't show an error for half-typed identifiers — only when
        // the user clearly stopped typing.
        this.stage = 'detected'; // helper goes empty; no error noise
        this.resolved = null;
        this.profileEvent = null;
        return;
      }

      this.stage = 'detected';
      this.resolved = null;
      this.profileEvent = null;
      this.errorCode = null;

      this.debounceHandle = setTimeout(() => {
        this.debounceHandle = null;
        this.runLookup();
      }, DEBOUNCE_MS);
    },

    async runLookup() {
      const trimmed = (this.rawInput || '').trim();
      if (!trimmed) return;

      this.currentToken += 1;
      const token = this.currentToken;

      this.cancelInFlight();
      this.stage = 'resolving';
      this.errorCode = null;
      this.resolved = null;
      this.profileEvent = null;

      // Step 1 — resolve the identifier to a pubkey.
      let resolved;
      try {
        this.lookupController = new AbortController();
        resolved = await lookupIdentifier(trimmed, {
          signal: this.lookupController.signal,
        });
      } catch (err) {
        if (token !== this.currentToken) return; // stale
        if (err?.code === LOOKUP_ERROR.CANCELLED) return;
        this.stage = 'error';
        this.errorCode = err?.code || null;
        return;
      }

      if (token !== this.currentToken) return; // user kept typing
      this.resolved = resolved;

      // Step 2 — if we already have this contact, short-circuit:
      // no need to hit the relays for the kind:0 again.
      const store = useAddressBookStore();
      const existing = store.findContactByPubkey(resolved.pubkey);
      if (existing) {
        // Render the preview from the stored snapshot so the user
        // can see the same card shape they'd see on a fresh add.
        this.profileEvent = existing.nostr_event || {
          // Legacy entries without a stored event — synth a thin
          // shell so the preview can still render from nostr_profile.
          kind: 0,
          pubkey: resolved.pubkey,
          content: JSON.stringify(existing.nostr_profile || {}),
          created_at: 0,
          tags: [],
        };
        this.stage = 'ready';
        return;
      }

      // Step 3 — fetch the latest kind:0. Use any relay hints we got
      // (nprofile / nip05) before falling back to the default set.
      try {
        this.fetchController = new AbortController();
        const opts = {};
        if (Array.isArray(resolved.relays) && resolved.relays.length > 0) {
          opts.relays = resolved.relays;
        }
        const event = await fetchProfile(resolved.pubkey, opts);
        if (token !== this.currentToken) return; // stale
        if (!event) {
          this.stage = 'not-found';
          return;
        }
        this.profileEvent = event;
        this.stage = 'ready';
      } catch (err) {
        if (token !== this.currentToken) return;
        // fetchProfile never throws for network failures (it returns
        // null), so this is a true bug — surface generically.
        this.stage = 'error';
        this.errorCode = null;
        console.warn('[addressBook] fetchProfile threw:', err);
      }
    },

    async onSave() {
      if (!this.resolved || !this.profileEvent || this.isSaving) return;
      this.isSaving = true;
      try {
        await this.addNostrContact({
          pubkey: this.resolved.pubkey,
          npub: this.resolved.npub,
          event: this.profileEvent,
          relayHints: this.resolved.relays || [],
        });
        this.$q.notify({
          type: 'positive',
          message: this.$t('Contact added'),
        });
        this.$emit('saved');
        this.reset();
      } catch (err) {
        const msg = err?.message || '';
        if (msg.includes('Lightning address')) {
          this.$q.notify({
            type: 'negative',
            message: this.$t('No Lightning address'),
            caption: this.$t('This profile cannot receive payments yet.'),
            timeout: 4000,
          });
        } else if (msg.includes('already')) {
          this.$q.notify({
            type: 'warning',
            message: this.$t('Already in your address book'),
            timeout: 3000,
          });
        } else {
          this.$q.notify({
            type: 'negative',
            message: this.$t("Couldn't save contact"),
            caption: msg || this.$t('Please try again'),
            timeout: 4000,
          });
        }
      } finally {
        this.isSaving = false;
      }
    },

    onOpenExisting(entry) {
      this.$emit('open-existing', entry);
    },

    async onCopyNpub(npub) {
      try {
        await copyToClipboard(npub);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Copied'),
          timeout: 1500,
        });
      } catch {
        this.$q.notify({
          type: 'negative',
          message: this.$t("Couldn't copy"),
          timeout: 2000,
        });
      }
    },
  },
};
</script>

<style scoped>
.search-pane {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.search-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.search-input-icon {
  position: absolute;
  left: 0.85rem;
  color: var(--text-muted);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 0.75rem 2.5rem 0.75rem 2.4rem;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
  background: var(--bg-input);
  color: var(--text-primary);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-input:focus {
  border-color: var(--color-green);
}

.body--light .search-input:focus {
  border-color: var(--text-primary);
}

.search-clear-btn {
  position: absolute;
  right: 0.4rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
}

.search-clear-btn:hover {
  background: rgba(120, 120, 120, 0.08);
  color: var(--text-primary);
}

.search-helper {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 18px;
  padding-left: 0.25rem;
  font-family: 'Manrope', sans-serif;
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--text-muted);
}

.search-helper--error {
  color: #C97A0F;
}

.search-helper--progress {
  color: var(--text-secondary);
}

.search-preview {
  margin-top: 0.25rem;
}
</style>
