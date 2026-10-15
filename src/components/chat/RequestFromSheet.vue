<!--
  RequestFromSheet: who to ask for money, opened from Receive's Request.

  One search field finds both the user's contacts and, as they type, other
  people by name, username or public code (services/profileSearch.findPeople);
  the scan button reads the QR code on someone's profile into that field.
  Without a search, the people asked or chatted with most recently come
  first, then every contact that can get a request (requestPeople.js).

  Emits `pick` with the person: an address-book entry (`contact`) or, for
  someone new, their profile (`profile`: kind 0 event and relay hints) so the
  flow can add them once the request is sent. It requests nothing itself.
  RequestMoneyFlow mounts a fresh one per opening, so the search survives
  going back from the amount and never carries over to the next request.
-->
<template>
  <q-dialog
    :model-value="modelValue"
    position="bottom"
    @update:model-value="$emit('update:modelValue', $event)"
    @show="loadContacts"
  >
    <section class="request-from" :class="{ 'request-from--multiple': multiple }" :aria-labelledby="titleId">
      <div class="form-sheet-grabber" aria-hidden="true" />
      <header class="form-sheet-header">
        <button type="button" class="form-sheet-cancel" @click="$emit('update:modelValue', false)">{{ $t('Cancel') }}</button>
        <h2 :id="titleId" class="form-sheet-title">{{ $t('Request from') }}</h2>
        <span aria-hidden="true" />
      </header>

      <div class="request-from__search">
        <label class="request-from__field">
          <Icon icon="tabler:search" width="16" height="16" />
          <input
            v-model="query"
            type="search"
            :aria-label="$t('Search people')"
            :placeholder="$t('Name or username')"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            enterkeyhint="search"
            maxlength="512"
          >
        </label>
        <button type="button" class="request-from__scan" :aria-label="$t('Scan their QR code')" @click="scanning = true">
          <Icon icon="tabler:scan" width="20" height="20" />
        </button>
      </div>

      <div class="request-from__body">
        <template v-if="!searching">
          <template v-if="recent.length">
            <h3 class="request-from__label">{{ $t('Recent') }}</h3>
            <div class="request-from__recent">
              <button v-for="entry in recent" :key="entry.id" type="button" class="request-from__person" :aria-pressed="multiple ? isSelected(entry.nostr_pubkey) : undefined" :class="{ 'request-from__selected': multiple && isSelected(entry.nostr_pubkey) }" @click="pickContact(entry)">
                <span class="request-from__avatar request-from__avatar--large"><ContactAvatar :entry="entry" :name="entry.name" /></span>
                <span class="request-from__first-name">{{ firstName(entry.name) }}</span>
              </button>
            </div>
          </template>

          <template v-if="allContacts.length">
            <h3 class="request-from__label">{{ $t('Contacts') }}</h3>
            <button v-for="entry in allContacts" :key="entry.id" type="button" class="request-from__row" :aria-pressed="multiple ? isSelected(entry.nostr_pubkey) : undefined" :class="{ 'request-from__selected': multiple && isSelected(entry.nostr_pubkey) }" @click="pickContact(entry)">
              <span class="request-from__avatar"><ContactAvatar :entry="entry" :name="entry.name" /></span>
              <span class="request-from__names">
                <span class="request-from__name">{{ entry.name }}</span>
                <span v-if="addressOf(entry)" class="request-from__address">{{ addressOf(entry) }}</span>
              </span><span v-if="multiple" class="request-from__tick" aria-hidden="true"><Icon v-if="isSelected(entry.nostr_pubkey)" icon="tabler:check" width="14" height="14" /></span>
            </button>
          </template>

          <div v-else class="request-from__empty">
            <span class="request-from__empty-icon"><Icon icon="buho:request" width="30" height="30" /></span>
            <h3>{{ $t('Who do you want to ask?') }}</h3>
            <p>{{ $t("Search their name or username, or scan the QR code on their profile. They're added to your contacts when you send the request.") }}</p>
          </div>
        </template>

        <template v-else>
          <template v-if="matches.length">
            <h3 class="request-from__label">{{ $t('Contacts') }}</h3>
            <button v-for="entry in matches" :key="entry.id" type="button" class="request-from__row" :aria-pressed="multiple ? isSelected(entry.nostr_pubkey) : undefined" :class="{ 'request-from__selected': multiple && isSelected(entry.nostr_pubkey) }" @click="pickContact(entry)">
              <span class="request-from__avatar"><ContactAvatar :entry="entry" :name="entry.name" /></span>
              <span class="request-from__names">
                <span class="request-from__name">{{ entry.name }}</span>
                <span v-if="addressOf(entry)" class="request-from__address">{{ addressOf(entry) }}</span>
              </span><span v-if="multiple" class="request-from__tick" aria-hidden="true"><Icon v-if="isSelected(entry.nostr_pubkey)" icon="tabler:check" width="14" height="14" /></span>
            </button>
          </template>

          <template v-if="newPeople.length">
            <h3 class="request-from__label">{{ $t('More people') }}</h3>
            <button v-for="person in newPeople" :key="person.pubkey" type="button" class="request-from__row" :aria-pressed="multiple ? isSelected(person.pubkey) : undefined" :class="{ 'request-from__selected': multiple && isSelected(person.pubkey) }" @click="pickPerson(person)">
              <span class="request-from__avatar"><ContactAvatar :name="personName(person)" :picture="person.picture" /></span>
              <span class="request-from__names">
                <span class="request-from__name">{{ personName(person) }}</span>
                <span v-if="person.nip05" class="request-from__address">{{ person.nip05 }}</span>
              </span><span v-if="multiple" class="request-from__tick" aria-hidden="true"><Icon v-if="isSelected(person.pubkey)" icon="tabler:check" width="14" height="14" /></span>
            </button>
            <p class="request-from__note">{{ $t('Someone new is added to your contacts when you send the request.') }}</p>
          </template>

          <p v-if="lookup === 'busy'" class="request-from__status" role="status">
            <q-spinner size="16px" aria-hidden="true" />
            {{ $t('Searching...') }}
          </p>
          <p v-else-if="status" class="request-from__status" role="status">{{ status }}</p>
        </template>
      </div>
      <footer v-if="multiple" class="request-from__footer">
        <p v-if="selectionError" class="form-sheet-error" role="alert">{{ selectionError }}</p>
        <p v-else>{{ selected.length ? $t(selected.length === 1 ? '1 person selected' : '{n} people selected', { n: selected.length }) : $t('Choose one person or a few') }}</p>
        <button class="form-sheet-primary" type="button" :disabled="!selected.length" @click="$emit('next')">{{ $t('Next') }}</button>
      </footer>
    </section>

    <QrScanSheet
      v-model="scanning"
      :prompt="$t('Point your camera at the QR code on their profile.')"
      @scanned="onScanned"
    />
  </q-dialog>
</template>

<script setup>
import { computed, getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import ContactAvatar from '../AddressBook/ContactAvatar.vue';
import QrScanSheet from '../QrScanSheet.vue';
import { useAddressBookStore } from '../../stores/addressBook';
import { useMessagesStore } from '../../stores/messages';
import { findPeople, classifyPeopleInput, PROFILE_SEARCH_DEBOUNCE_MS } from '../../services/profileSearch.js';
import { MAX_REQUEST_PEOPLE } from '../../utils/requestAllocation.js';
import { parseProfileLink } from '../../utils/profileLink.js';
import { formatUsername } from '../../services/nip05.js';
import { lookupProblem, matchContacts, recentRequestContacts, requestableContacts } from './requestPeople.js';

const props = defineProps({ modelValue: { type: Boolean, default: false }, multiple: Boolean, selected: { type: Array, default: () => [] }, excludePubkey: { type: String, default: '' } });
const emit = defineEmits(['update:modelValue', 'pick', 'update:selected', 'next']);

const { proxy } = getCurrentInstance();
const t = (key, params) => proxy.$t(key, params);
const titleId = `request-from-title-${proxy.$.uid}`;
const addressBook = useAddressBookStore();
const messages = useMessagesStore();

const query = ref('');
const selectionError = ref('');
const isSelected = pubkey => props.selected.some(person => person.pubkey === pubkey);
function selectPerson(person) {
  if (!props.multiple) { emit('pick', person); return; }
  selectionError.value = '';
  if (isSelected(person.pubkey)) { emit('update:selected', props.selected.filter(picked => picked.pubkey !== person.pubkey)); return; }
  if (props.selected.length >= MAX_REQUEST_PEOPLE) { selectionError.value = t('Choose up to {n} people.', { n: MAX_REQUEST_PEOPLE }); return; }
  emit('update:selected', [...props.selected, person]);
}
const scanning = ref(false);
/** The network search: 'idle', 'busy', 'done', or why it found no one ('none', 'no-username', 'unchecked', 'failed'). */
const lookup = ref('idle');
const people = ref([]);
let timer = null;
let controller = null;

const allContacts = computed(() => requestableContacts(addressBook.entries).filter(entry => entry.nostr_pubkey !== props.excludePubkey));
const recent = computed(() => recentRequestContacts({
  threads: messages.threadsSorted,
  recentlyPaid: addressBook.recentlyPaidEntries,
  contactFor: (pubkey) => addressBook.findContactByPubkey(pubkey),
}).filter(entry => entry.nostr_pubkey !== props.excludePubkey));
const searching = computed(() => query.value.trim().length > 0);

/** Contacts the words match, plus any the network search names. */
const matches = computed(() => {
  const local = matchContacts(allContacts.value, query.value);
  const known = people.value
    .map((person) => addressBook.findContactByPubkey(person.pubkey))
    .filter((entry) => entry && !local.includes(entry) && allContacts.value.includes(entry));
  return [...local, ...known];
});
/** People the network search found who are not contacts yet. */
const newPeople = computed(() => people.value.filter((person) => person.pubkey !== props.excludePubkey && !addressBook.findContactByPubkey(person.pubkey)));

/** The line under the results: why the field can't search yet, or why no one was found. */
const status = computed(() => {
  const input = classifyPeopleInput(query.value);
  if (input === 'private') return proxy.$t("That's a secret key. Keep it private and search their name or username instead.");
  if (matches.value.length || newPeople.value.length) return '';
  switch (input === 'name' || input === 'identifier' ? lookup.value : input) {
    case 'short': return proxy.$t('Enter at least two characters to search.');
    case 'incomplete': return proxy.$t('Enter their full username or public code.');
    case 'none': return proxy.$t('No one found. Try their username.');
    case 'no-username': return proxy.$t('No one has that username.');
    case 'unchecked': return proxy.$t("That username couldn't be checked.");
    case 'failed': return proxy.$t("Couldn't search right now. Check your connection.");
    default: return '';
  }
});

function loadContacts() {
  addressBook.initialize();
}

function addressOf(entry) {
  return formatUsername(entry.nostr_profile?.nip05)?.text || entry.lightningAddress || '';
}

function personName(person) {
  return person.name || formatUsername(person.nip05)?.text || person.npub.slice(0, 12);
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0];
}

function cancelLookup() {
  clearTimeout(timer);
  controller?.abort();
  controller = null;
}

watch(query, (value) => {
  cancelLookup();
  people.value = [];
  if (!['name', 'identifier'].includes(classifyPeopleInput(value))) {
    lookup.value = 'idle';
    return;
  }
  lookup.value = 'busy';
  timer = setTimeout(() => runLookup(value), PROFILE_SEARCH_DEBOUNCE_MS);
});

async function runLookup(value) {
  const current = new AbortController();
  controller = current;
  try {
    const { people: found, complete } = await findPeople(value, { signal: current.signal });
    if (controller !== current) return;
    people.value = found;
    // An empty answer only means "no one" when the relays replied.
    lookup.value = found.length ? 'done' : complete ? 'none' : 'failed';
  } catch (error) {
    if (controller !== current) return;
    lookup.value = lookupProblem(error) || 'idle';
  }
}

/** A scanned profile becomes the search: the person appears to tap. */
function onScanned(text) {
  const raw = String(text || '').trim();
  query.value = parseProfileLink(raw) || raw.replace(/^nostr:/i, '');
}

function pickContact(entry) {
  selectPerson({ pubkey: entry.nostr_pubkey, name: entry.name, contact: entry, profile: null });
}

function pickPerson(person) {
  selectPerson({
    pubkey: person.pubkey,
    name: personName(person),
    contact: null,
    profile: { npub: person.npub, event: person.event, relays: person.relays, picture: person.picture },
  });
}

onBeforeUnmount(cancelLookup);
</script>

<style scoped>
.request-from__footer {
  flex-shrink: 0;
  padding: 12px 20px max(16px, var(--safe-bottom, 0px));
  background: var(--bg-card);
}
.request-from__footer .form-sheet-primary {
  width: 100%;
}
.request-from__footer p {
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 10px;
}
.request-from__tick {
  width: 22px;
  height: 22px;
  border: 1px solid var(--border-card);
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.request-from__selected .request-from__tick {
  background: var(--brand-accent-text);
  border-color: var(--brand-accent-text);
  color: var(--bg-card);
}
.request-from__selected .request-from__avatar {
  outline: 2px solid var(--brand-accent-text);
  outline-offset: 3px;
}

.request-from {
  /* Quasar only makes a dialog's direct child <div> tappable; this root is a <section>. */
  pointer-events: all;
  width: 100%;
  max-width: 520px;
  height: min(90vh, calc(100vh - var(--safe-top, 0px) - 40px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  background: var(--bg-card);
  border-top: 1px solid var(--border-card);
  color: var(--text-primary);
  font-family: 'Manrope', sans-serif;
}

.request-from__search { display: flex; gap: 8px; padding: 8px 16px 4px; }
.request-from__field {
  flex: 1;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-radius: 12px;
  background: var(--bg-input);
  color: var(--text-muted);
}
.request-from__field:focus-within { box-shadow: 0 0 0 2px var(--brand-accent-soft); }
.request-from__field input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  /* 16px: below this iOS zooms the page on focus. */
  font: 500 16px 'Manrope', sans-serif;
  outline: none;
}
.request-from__field input::placeholder { color: var(--text-muted); }
.request-from__scan {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 12px;
  background: var(--bg-input);
  color: var(--text-primary);
  cursor: pointer;
}

.request-from__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: max(16px, var(--safe-bottom, 0px));
}

.request-from__label { margin: 20px 20px 8px; font-size: 13px; font-weight: 600; color: var(--text-secondary); }

.request-from__recent {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
  padding: 0 12px;
}
.request-from__person {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
.request-from__first-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.request-from__row {
  width: 100%;
  min-height: 60px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 20px;
  border: 0;
  border-bottom: 1px solid var(--border-card);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}
.request-from__row:active,
.request-from__person:active { background: rgba(128, 128, 128, 0.08); }

.request-from__avatar { flex: 0 0 auto; width: 40px; height: 40px; display: grid; }
.request-from__avatar--large { width: 56px; height: 56px; }
.request-from__avatar :deep(.contact-avatar) { width: 100%; height: 100%; }

.request-from__names { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.request-from__name { font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.request-from__address { font-size: 13px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.request-from__note,
.request-from__status {
  margin: 14px 20px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-secondary);
}

.request-from__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 56px 32px 0;
  text-align: center;
}
.request-from__empty-icon {
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--brand-accent-soft);
  color: var(--brand-accent-text);
}
.request-from__empty h3 { margin: 18px 0 0; font-size: 20px; font-weight: 800; }
.request-from__empty p { margin: 8px 0 0; max-width: 300px; font-size: 15px; line-height: 1.5; color: var(--text-secondary); }

.request-from__scan:focus-visible,
.request-from__row:focus-visible,
.request-from__person:focus-visible { outline: 2px solid var(--chat-focus, currentColor); outline-offset: -2px; }
</style>
