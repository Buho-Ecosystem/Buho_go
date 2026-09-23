<template>
  <div class="search-pane">
    <div class="search-fixed">
    <!-- One field for names and direct public identities. -->
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
        type="search"
        class="search-input"
        :aria-label="$t('Search people')"
        :aria-describedby="previewReady ? undefined : 'people-search-status'"
        :disabled="isSaving"
        autocomplete="off"
        enterkeyhint="search"
        maxlength="512"
        @keydown.down.prevent="focusResult(0)"
        :class="$q.dark.isActive ? 'search-input-dark' : 'search-input-light'"
        :placeholder="$t('Name, npub, or NIP-05')"
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
        :disabled="isSaving"
        @click="reset({ keepFocus: true })"
      >
        <Icon icon="tabler:x" width="14" height="14" />
      </button>
    </div>

    <!-- Helper / status line under the input. Single source for both
         hint text (idle) and inline error copy (typed-code mapped). -->
    <div
      v-if="!previewReady"
      id="people-search-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
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

    <button v-if="stage === 'unavailable' || (stage === 'results' && searchPartial && !loadMoreFailed)"
      type="button" class="search-retry" @click="runLookup">{{ $t('Try again') }}</button>

    </div>
    <div ref="resultsScroll" class="search-scroll" @scroll.passive="maybeLoadMore">
    <ul v-if="results.length && !previewReady" class="people-results" :aria-label="$t('Search results')">
      <li v-for="(person, index) in results" :key="person.pubkey">
        <button type="button" class="people-result" :data-pubkey="person.pubkey"
          @click="selectPerson(person)" @keydown.down.prevent="focusResult(index + 1)"
          @keydown.up.prevent="focusResult(index - 1)" @keydown.esc.stop.prevent="focus">
          <ContactAvatar class="people-avatar" :picture="person.picture" />
          <span class="people-copy">
            <span class="people-name">{{ person.name || person.nip05 || $t('Nostr profile') }}</span>
            <span v-if="person.nip05 && person.name" class="people-handle">{{ person.nip05 }}</span>
            <span v-if="person.about" class="people-bio">{{ person.about }}</span>
          </span>
          <q-icon name="chevron_right" size="20px" :aria-hidden="true" />
        </button>
      </li>
    </ul>

    <div v-if="(results.length || hasMore || loadMoreFailed) && !previewReady" class="search-pagination" role="status" aria-live="polite">
      <q-spinner v-if="loadingMore" size="18px" :aria-hidden="true" />
      <span v-if="loadingMore">{{ $t('Loading more people…') }}</span>
      <button v-else-if="hasMore || loadMoreFailed" type="button" class="search-retry" @click="loadMore">
        {{ loadMoreFailed ? $t('Try again') : $t('Load more people') }}
      </button>
      <span v-else-if="!searchPartial && stage === 'results'">{{ $t('All available results shown.') }}</span>
      <span v-if="loadMoreFailed">{{ $t('Could not load more people. Your results are still here.') }}</span>
    </div>

    <NostrContactPreview
      v-if="previewReady"
      class="search-preview"
      :pubkey="resolved.pubkey"
      :npub="resolved.npub"
      :profile="parsedProfile"
      :nip05-verified="nip05Verified"
      :existing-entry="existingEntry"
      :saving="isSaving"
      show-copy-identifier
      @save="onSave"
      @open-existing="onOpenExisting"
      @copy-npub="onCopyNpub"
    />
    </div>
  </div>
</template>

<script>
import { useAddressBookStore } from '../../stores/addressBook';
import { mapActions } from 'pinia';
import { classifyIdentifier, lookupIdentifier, LOOKUP_ERROR, NIP05_ERROR } from '../../utils/nostrLookup.js';
import { parseProfileContent } from '../../utils/nostrFetch.js';
import { copyToClipboard } from 'quasar';
import NostrContactPreview from './NostrContactPreview.vue';
import ContactAvatar from './ContactAvatar.vue';
import { classifyPeopleInput, searchProfiles, fetchPeopleProfile, PROFILE_SEARCH_DEBOUNCE_MS, PROFILE_SEARCH_TIMEOUT_MS } from '../../services/profileSearch.js';

const DEBOUNCE_MS = PROFILE_SEARCH_DEBOUNCE_MS;

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

  components: { NostrContactPreview, ContactAvatar },

  props: { active: { type: Boolean, default: true } },

  emits: ['saved', 'open-existing', 'navigation-change', 'focus-back'],

  data() {
    return {
      rawInput: '',
      results: [],
      resultEvents: [],
      searchLimit: 20,
      hasMore: false,
      loadingMore: false,
      loadMoreFailed: false,
      resultsScrollTop: 0,
      searchPartial: false,
      selectedFromResults: false,
      selectedPubkey: null,
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
    navigationState() { return { canGoBack: !!(this.previewReady && this.selectedFromResults), saving: this.isSaving }; },
    parsedProfile() {
      return this.profileEvent ? parseProfileContent(this.profileEvent) : {};
    },

    /** Tri-state NIP-05 verification (only meaningful for the nip05 path). */
    nip05Verified() {
      if (!this.resolved || !this.profileEvent) return null;
      // We trust the NIP-05 lookup result *because* we already verified
      // event signature locally in the profile reader. The remaining
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
        case 'searching':
        case 'resolving': return 'progress';
        case 'private':
        case 'unavailable': return 'error';
        case 'error':     return 'error';
        case 'not-found': return 'error';
        default:          return 'neutral';
      }
    },

    statusText() {
      switch (this.stage) {
        case 'idle':
          return this.$t('Find someone by name or paste their public Nostr identifier.');
        case 'short': return this.$t('Enter at least two characters to search.');
        case 'private': return this.$t('This is a private key. Use a public identifier instead.');
        case 'incomplete': return this.$t('Enter a complete public Nostr identifier.');
        case 'searching': return this.$t('Searching for people…');
        case 'results': return this.searchPartial
          ? this.$t('Some results may be missing. You can try again.')
          : this.$t('Choose a person to view their profile.');
        case 'empty-results': return this.$t('No matching people found. Try another name or a public identifier.');
        case 'unavailable': return this.$t('Search is unavailable right now. Please try again.');
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
        default:         return this.$t('Search by name or public Nostr identifier.');
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
    navigationState: { immediate: true, handler(value) { this.$emit('navigation-change', value); } },
    active(value) { if (!value) this.reset(); },
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
      this.results = [];
      this.resultEvents = [];
      this.searchLimit = 20;
      this.hasMore = false;
      this.loadMoreFailed = false;
      this.selectedFromResults = false;
      this.searchPartial = false;
      this.kind = null;
      this.stage = 'idle';
      this.errorCode = null;
      this.resolved = null;
      this.profileEvent = null;
      if (keepFocus) this.focus();
    },

    cancelInFlight() {
      this.currentToken += 1;
      this.loadingMore = false;
      try { this.lookupController?.abort(); } catch { /* no-op */ }
      try { this.fetchController?.abort(); } catch { /* no-op */ }
      this.lookupController = null;
      this.fetchController = null;
    },

    shortKey: shortenNpub,

    focusResult(index) {
      const rows = this.$el.querySelectorAll('.people-result');
      if (index < 0) return this.focus();
      rows[Math.min(index, rows.length - 1)]?.focus();
    },

    selectPerson(person) {
      if (this.stage === 'searching') this.searchPartial = true;
      this.cancelInFlight();
      this.selectedFromResults = true;
      this.selectedPubkey = person.pubkey;
      this.resultsScrollTop = this.$refs.resultsScroll?.scrollTop || 0;
      this.resolved = { pubkey: person.pubkey, npub: person.npub, relays: [], source: 'search' };
      this.profileEvent = person.event;
      this.stage = 'ready';
      this.$nextTick(() => {
        if (this.$refs.resultsScroll) this.$refs.resultsScroll.scrollTop = 0;
        this.$emit('focus-back');
      });
    },

    backToResults() {
      this.selectedFromResults = false;
      this.resolved = null;
      this.profileEvent = null;
      this.stage = 'results';
      this.$nextTick(() => {
        const rows = [...this.$el.querySelectorAll('.people-result')];
        if (this.$refs.resultsScroll) this.$refs.resultsScroll.scrollTop = this.resultsScrollTop;
        rows.find(row => row.dataset.pubkey === this.selectedPubkey)?.focus({ preventScroll: true });
      });
    },

    onSubmit(event) {
      if (event?.isComposing || this.isSaving) return;
      if (this.results.length && !this.previewReady) return this.selectPerson(this.results[0]);
      if (this.debounceHandle) clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
      this.runLookup();
    },

    scheduleLookup() {
      this.cancelInFlight();
      if (this.debounceHandle) clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
      this.results = [];
      this.resultEvents = [];
      this.searchLimit = 20;
      this.hasMore = false;
      this.loadMoreFailed = false;
      this.selectedFromResults = false;
      this.searchPartial = false;
      this.resolved = null;
      this.profileEvent = null;
      this.errorCode = null;
      const trimmed = this.rawInput.trim();
      this.kind = classifyIdentifier(trimmed);
      const mode = classifyPeopleInput(trimmed);
      this.stage = mode === 'empty' ? 'idle' : mode;
      if (!this.active || !['name', 'identifier'].includes(mode)) return;
      this.stage = 'detected';
      this.debounceHandle = setTimeout(() => {
        this.debounceHandle = null;
        this.runLookup();
      }, DEBOUNCE_MS);
    },

    async runLookup() {
      if (!this.active || this.isSaving) return;
      const trimmed = this.rawInput.trim();
      const mode = classifyPeopleInput(trimmed);
      if (!['name', 'identifier'].includes(mode)) return;
      this.cancelInFlight();
      const token = this.currentToken;
      this.kind = classifyIdentifier(trimmed);
      this.stage = mode === 'name' ? 'searching' : 'resolving';
      this.errorCode = null;
      this.resolved = null;
      this.profileEvent = null;
      this.results = [];
      this.resultEvents = [];
      this.searchLimit = 20;
      this.hasMore = false;
      this.loadMoreFailed = false;
      this.selectedFromResults = false;
      this.lookupController = new AbortController();
      const signal = this.lookupController.signal;
      const started = Date.now();

      if (mode === 'name') {
        try {
          const result = await searchProfiles(trimmed, {
            signal,
            onResults: profiles => { if (token === this.currentToken) this.results = profiles; },
          });
          if (token !== this.currentToken) return;
          this.results = result.profiles;
          this.resultEvents = result.events || [];
          this.hasMore = result.hasMore;
          this.searchPartial = result.partial;
          this.stage = result.profiles.length ? 'results' : result.complete ? 'empty-results' : 'unavailable';
          this.$nextTick(() => this.maybeLoadMore());
        } catch {
          if (token === this.currentToken) this.stage = 'unavailable';
        }
        return;
      }

      // Step 1 — resolve the identifier to a pubkey.
      let resolved;
      try {
        resolved = await lookupIdentifier(trimmed, {
          signal, timeoutMs: PROFILE_SEARCH_TIMEOUT_MS,
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
        const opts = { signal: this.fetchController.signal, timeoutMs: Math.max(1, PROFILE_SEARCH_TIMEOUT_MS - (Date.now() - started)) };
        if (Array.isArray(resolved.relays) && resolved.relays.length > 0) {
          opts.relays = resolved.relays;
        }
        const { event, complete } = await fetchPeopleProfile(resolved.pubkey, opts);
        if (token !== this.currentToken) return; // stale
        if (!event) {
          this.stage = complete ? 'not-found' : 'unavailable';
          return;
        }
        this.profileEvent = event;
        this.stage = 'ready';
      } catch (err) {
        if (token !== this.currentToken) return;
        // Surface unexpected failures without exposing raw network errors.
        this.stage = 'error';
        this.errorCode = null;
        // Keep raw inputs and network errors out of logs.
      }
    },

    maybeLoadMore() {
      const scroller = this.$refs.resultsScroll;
      if (!scroller || this.stage !== 'results' || this.loadMoreFailed || !this.hasMore) return;
      if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160) void this.loadMore();
    },

    async loadMore() {
      if (this.loadingMore || this.previewReady || (!this.hasMore && !this.loadMoreFailed)) return;
      this.loadingMore = true;
      this.loadMoreFailed = false;
      const token = this.currentToken;
      const previousCount = this.results.length;
      const limit = this.searchLimit + 20;
      this.lookupController = new AbortController();
      try {
        const result = await searchProfiles(this.rawInput.trim(), {
          signal: this.lookupController.signal, limit, previousEvents: this.resultEvents,
          visiblePubkeys: this.results.map(person => person.pubkey),
        });
        if (token !== this.currentToken) return;
        // Preserve the order of visible rows while extending the list so
        // loading a page never moves the person under someone's finger.
        const incoming = new Map(result.profiles.map(person => [person.pubkey, person]));
        const kept = this.results.filter(person => incoming.has(person.pubkey)).map(person => incoming.get(person.pubkey));
        const existing = new Set(kept.map(person => person.pubkey));
        this.results = [...kept, ...result.profiles.filter(person => !existing.has(person.pubkey))];
        this.resultEvents = result.events;
        this.searchPartial = result.partial;
        this.hasMore = result.hasMore;
        this.loadMoreFailed = result.partial;
        this.stage = this.results.length ? 'results' : result.complete ? 'empty-results' : 'unavailable';
        if (!result.partial) this.searchLimit = limit;
      } catch {
        if (token === this.currentToken) this.loadMoreFailed = true;
      } finally {
        if (token === this.currentToken) {
          this.loadingMore = false;
          // Fill a tall viewport, but never automatically retry a page
          // that made no progress or failed.
          if (this.results.length > previousCount) this.$nextTick(() => this.maybeLoadMore());
        }
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
          allowWithoutLightningAddress: true,
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
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.search-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.search-input-icon {
  position: absolute;
  left: 0.85rem;
  color: var(--text-secondary);
  pointer-events: none;
}

.search-input {
  width: 100%;
  min-height: 48px;
  padding: 0.75rem 3.25rem 0.75rem 2.4rem;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  font-family: 'Manrope', sans-serif;
  font-size: 16px;
  outline: none;
  transition: border-color 0.2s;
  background: var(--bg-input);
  color: var(--text-primary);
}

.search-input::placeholder {
  color: var(--text-secondary);
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
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: var(--text-secondary);
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
  color: var(--text-secondary);
}

.search-helper--error {
  color: #9a4b00;
}

.search-helper--progress {
  color: var(--text-secondary);
}

.search-preview {
  margin-top: 0.25rem;
}
.body--dark .search-helper--error { color: #ffc480; }
.search-input::-webkit-search-cancel-button { display: none; }
.people-results { list-style: none; padding: 0; margin: 0; }
.people-results li + li { border-top: 1px solid var(--border-color, #8883); }
.people-result { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 72px; padding: 14px 4px; border: 0; border-radius: 12px; background: transparent; color: var(--text-primary); text-align: left; font: inherit; cursor: pointer; }
.people-result:hover, .people-result:active { background: var(--bg-input); }
.people-avatar { flex: 0 0 44px; width: 44px; height: 44px; }
.people-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.people-name { font-size: 1rem; font-weight: 650; overflow-wrap: anywhere; }
.people-handle { font-size: .8125rem; color: var(--text-secondary); overflow-wrap: anywhere; }
.people-bio { font-size: .875rem; line-height: 1.4; color: var(--text-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.search-retry { display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; min-height: 44px; padding: 8px 12px; border-radius: 12px; border: 0; background: var(--bg-input); color: var(--text-primary); font: 600 .875rem 'Manrope', sans-serif; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
button:disabled { opacity: .5; cursor: default; }
.search-fixed { flex-shrink: 0; display: flex; flex-direction: column; gap: 12px; }
.search-scroll { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.search-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; padding: 12px 4px; color: var(--text-secondary); font-size: .8125rem; }
</style>
