/**
 * Who the "Request from" sheet (RequestFromSheet.vue) offers, as plain
 * functions over address-book entries and chat threads.
 *
 * A request travels as a chat message, so only a contact with a public key
 * can get one. The sheet shows the people asked or chatted with most
 * recently first, then everyone else by name.
 */

import { LOOKUP_ERROR, NIP05_ERROR } from '../../utils/nostrLookup.js';

const HEX_64 = /^[0-9a-f]{64}$/;

/** Fold for matching: case, accents and Unicode forms do not matter. */
const fold = (value) => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** Can this address-book entry be asked for money? */
export function canRequestFrom(entry) {
  return HEX_64.test(entry?.nostr_pubkey || '');
}

/** The contacts that can be asked, by name. */
export function requestableContacts(entries) {
  return (entries || [])
    .filter(canRequestFrom)
    .sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
}

/**
 * Up to `limit` people to offer first: the latest chats, then the contacts
 * paid most recently, each once.
 *
 * @param {{ threads: Array<{ partner: string }>, recentlyPaid: object[],
 *   contactFor: (pubkey: string) => object|null, limit?: number }} sources
 */
export function recentRequestContacts({ threads, recentlyPaid, contactFor, limit = 5 }) {
  const seen = new Set();
  const recent = [];
  const add = (entry) => {
    if (recent.length >= limit || !canRequestFrom(entry) || seen.has(entry.id)) return;
    seen.add(entry.id);
    recent.push(entry);
  };
  for (const thread of threads || []) add(contactFor(thread.partner));
  for (const entry of recentlyPaid || []) add(entry);
  return recent;
}

/**
 * What a failed people search tells the user: 'no-username' (no one has
 * it), 'none' (the input names no one, e.g. a public code that does not
 * decode), 'unchecked' (the username's server gave no usable answer) or
 * 'failed' (no connection). Null for a cancelled search, which says nothing.
 */
export function lookupProblem(error) {
  switch (error?.code) {
    case LOOKUP_ERROR.CANCELLED:
    case NIP05_ERROR.CANCELLED:
      return null;
    case NIP05_ERROR.NOT_FOUND:
      return 'no-username';
    case NIP05_ERROR.INVALID_FORMAT:
    case LOOKUP_ERROR.UNRECOGNIZED:
    case LOOKUP_ERROR.INVALID_NPUB:
    case LOOKUP_ERROR.INVALID_NPROFILE:
    case LOOKUP_ERROR.INVALID_HEX:
      return 'none';
    case NIP05_ERROR.HTTP:
    case NIP05_ERROR.BAD_RESPONSE:
    case NIP05_ERROR.PUBKEY_INVALID:
      return 'unchecked';
    default:
      return 'failed';
  }
}

/** The contacts whose name or address contains every word typed. */
export function matchContacts(contacts, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return contacts;
  return contacts.filter((entry) => {
    const haystack = fold([entry.name, entry.lightningAddress, entry.nostr_profile?.nip05].join(' '));
    return words.every((word) => haystack.includes(word));
  });
}
