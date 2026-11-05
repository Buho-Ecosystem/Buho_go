/**
 * What the Quick Settings tiles and the launcher shortcuts should show right
 * now (issues #445, #446). Pure: composables/useQuickAccessSync.js gathers the
 * app's state, this decides, services/quickAccess.js carries it to Android.
 *
 * The rules:
 * - Both work only with a wallet and outside kiosk mode. Otherwise the tiles
 *   are greyed out, the long-press menu is empty, and every pinned shortcut is
 *   switched off with the reason the launcher shows when it is tapped.
 * - The long-press menu holds Scan QR, Receive, Send and the last saved
 *   contact paid. With the app lock on, the contact stays out: the menu shows
 *   outside the lock.
 * - A pinned contact whose contact was removed is switched off with that
 *   reason; the person pinned it, so it is never removed.
 *
 * Shortcut ids are what utils/openActions.js `shortcutIdForAction` returns
 * for the action they open. A contact's is `pay-<key>`, see shortcutKeysOf.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** The fixed entries, in rank order: rank 0 sits next to the icon. */
const FIXED = Object.freeze([
  { id: 'scan', action: 'scan', icon: 'scan', label: 'Scan QR' },
  { id: 'receive', action: 'receive', icon: 'receive', label: 'Receive' },
  { id: 'send', action: 'send', icon: 'send', label: 'Send' },
]);

const CONTACT_PREFIX = 'pay-';

/** What a key may look like: the same rule as utils/openActions.js and QuickAccessPlugin.java. */
const KEY = /^[A-Za-z0-9_-]{1,128}$/;

function hashedKey(kind, value) {
  return `k${bytesToHex(sha256(utf8ToBytes(`${kind}:${value}`))).slice(0, 32)}`;
}

/**
 * The keys a contact's shortcut may carry, the most lasting first; a new
 * shortcut takes the first. A contact comes back under a new local id when
 * the address book is rebuilt (another identity's list, a restore), but
 * keeps its Nostr key or its id in the shared contact list, so a pinned
 * shortcut made with either still finds them. Those two are hashed: a
 * shortcut id must be short and plain, and says nothing about the contact.
 *
 * @param {{ id?: string, nostr_pubkey?: string, doc_contact_id?: string }} entry  an address-book entry
 * @returns {string[]}
 */
export function shortcutKeysOf(entry) {
  const keys = [];
  if (typeof entry?.nostr_pubkey === 'string' && entry.nostr_pubkey) keys.push(hashedKey('nostr', entry.nostr_pubkey.toLowerCase()));
  if (typeof entry?.doc_contact_id === 'string' && entry.doc_contact_id) keys.push(hashedKey('doc', entry.doc_contact_id));
  if (typeof entry?.id === 'string' && KEY.test(entry.id)) keys.push(entry.id);
  return keys;
}

/**
 * The address-book entry a contact shortcut opens, or null.
 *
 * @param {object[]} entries
 * @param {string|null} key  the shortcut's contact key
 */
export function findShortcutContact(entries, key) {
  if (typeof key !== 'string' || !key) return null;
  return entries.find((entry) => shortcutKeysOf(entry).includes(key)) || null;
}

/** Only a picture the phone can fetch over https; anything else shows the placeholder. */
function avatarUrlOf(contact) {
  const url = typeof contact?.picture === 'string' ? contact.picture.trim() : '';
  return /^https:\/\/[^\s]+$/i.test(url) && url.length <= 2048 ? url : null;
}

function fixedShortcut(entry, rank, t) {
  const label = t(entry.label);
  return { id: entry.id, action: entry.action, shortLabel: label, longLabel: label, icon: entry.icon, rank };
}

/** @param {string} key  the contact key the shortcut carries (a pinned one keeps its own) */
function contactShortcut(contact, key, rank, t) {
  const name = String(contact.name || '').trim();
  const firstName = name.split(/\s+/)[0];
  const avatarUrl = avatarUrlOf(contact);
  return {
    id: `${CONTACT_PREFIX}${key}`,
    action: 'pay',
    contactId: key,
    shortLabel: t('Pay {name}', { name: firstName }),
    longLabel: t('Pay {name}', { name }),
    icon: contact.isService ? 'service' : 'person',
    rank,
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

/**
 * @typedef {{ keys: string[], name: string, picture?: string, isService?: boolean }} ContactSummary
 *   a saved contact as the shortcuts see it; `keys` from shortcutKeysOf
 */

/**
 * @param {object} state
 * @param {boolean} state.hasWallet
 * @param {boolean} state.kiosk
 * @param {boolean} state.appLock
 * @param {ContactSummary | null} state.lastPaid  the last saved contact paid that can still be paid
 * @param {ContactSummary[]} state.contacts  every saved contact
 * @param {Array<{ id: string, enabled: boolean }>} state.pinned  shortcuts on the Home screen
 * @param {(key: string, values?: object) => string} t
 */
export function planQuickAccess({ hasWallet, kiosk, appLock, lastPaid, contacts, pinned }, t) {
  const available = hasWallet === true && kiosk !== true;
  const tiles = { available, labels: { send: t('Send'), receive: t('Receive') } };

  if (!available) {
    const ids = pinned.map((s) => s.id).filter((id) => FIXED.some((f) => f.id === id) || id.startsWith(CONTACT_PREFIX));
    const message = kiosk ? t('Not available while kiosk mode is on') : t('Set up a wallet in BuhoGO first');
    return { tiles, shortcuts: { menu: [], pinned: [], disabled: ids.length ? [{ ids, message }] : [] } };
  }

  const menu = FIXED.map((entry, rank) => fixedShortcut(entry, rank, t));
  const named = lastPaid && String(lastPaid.name || '').trim();
  if (named && !appLock && lastPaid.keys?.length) menu.push(contactShortcut(lastPaid, lastPaid.keys[0], FIXED.length, t));

  const byKey = new Map();
  for (const contact of contacts) {
    for (const key of contact.keys || []) if (!byKey.has(key)) byKey.set(key, contact);
  }
  const keep = [];
  const removed = [];
  for (const { id } of pinned) {
    const fixed = FIXED.findIndex((f) => f.id === id);
    if (fixed >= 0) {
      keep.push(fixedShortcut(FIXED[fixed], fixed, t));
    } else if (id.startsWith(CONTACT_PREFIX)) {
      const key = id.slice(CONTACT_PREFIX.length);
      const contact = byKey.get(key);
      if (contact && String(contact.name || '').trim()) keep.push(contactShortcut(contact, key, FIXED.length, t));
      else removed.push(id);
    }
  }

  return {
    tiles,
    shortcuts: {
      menu,
      pinned: keep,
      disabled: removed.length ? [{ ids: removed, message: t('This contact was removed') }] : [],
    },
  };
}

/** The Scan QR shortcut, for "Add to Home screen" in Settings. */
export function scanShortcut(t) {
  return fixedShortcut(FIXED[0], 0, t);
}
