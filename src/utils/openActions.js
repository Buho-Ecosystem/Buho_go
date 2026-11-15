/**
 * Open actions: a request from outside the app to open BuhoGO on one screen
 * (issue #444).
 *
 * The Quick Settings tiles and the launcher shortcuts (the long-press menu on
 * the app icon, and the icons pinned from it) start the app with
 *
 *   buhogo://open/<kind>[?contact=<address-book id>][&src=tile|shortcut]
 *
 * which arrives in src/boot/deep-links.js like any other link. The native side
 * builds these links in OpenActionIntents.java; the two must stay in step.
 *
 * An action only ever opens a screen. It carries no amount and no destination
 * other than a saved contact's id, and it never pays: the person still sees
 * the screen and decides.
 *
 * Plain module, no Vue or Capacitor, so it runs under `node --test`.
 */

/** What an action can open. `quick-access` is the settings sheet for the tiles and shortcuts. */
export const OPEN_ACTION_KINDS = Object.freeze(['send', 'receive', 'scan', 'pay', 'quick-access']);

/** Where an action came from. Unknown sources are dropped to null, never trusted. */
const SOURCES = new Set(['tile', 'shortcut']);

/**
 * An action that waited this long (for the app lock, say) is no longer what
 * the person asked for just now, and is dropped instead of opening a screen
 * out of the blue.
 */
export const OPEN_ACTION_TTL_MS = 2 * 60 * 1000;

/** Address-book ids are `addr-<time>-<random>`; anything else is not one of ours. */
const CONTACT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Parsed by hand rather than with `new URL`: older Android WebViews read a
 * custom scheme's host into the path, so the same link would parse
 * differently from phone to phone.
 */
const OPEN_ACTION_URL = /^buhogo:\/\/open\/([a-z-]+)\/?(?:\?([^#]*))?(?:#.*)?$/i;

/** Is this one of our open links? True even for one we cannot read (it is consumed, not shown as unknown). */
export function isOpenActionUrl(url) {
  return typeof url === 'string' && /^buhogo:\/\/open(?:[/?#]|$)/i.test(url.trim());
}

/**
 * Read an open link.
 *
 * @param {string} url
 * @returns {{ kind: string, contactId: string|null, source: 'tile'|'shortcut'|null } | null}
 *   null when the link is not a well-formed open action
 */
export function parseOpenAction(url) {
  if (typeof url !== 'string') return null;
  const match = OPEN_ACTION_URL.exec(url.trim());
  if (!match) return null;

  const kind = match[1].toLowerCase();
  if (!OPEN_ACTION_KINDS.includes(kind)) return null;

  const params = new URLSearchParams(match[2] || '');
  const source = SOURCES.has(params.get('src')) ? params.get('src') : null;

  if (kind !== 'pay') return { kind, contactId: null, source };

  // Paying someone needs exactly one saved contact to pay.
  const contactIds = params.getAll('contact');
  if (contactIds.length !== 1 || !CONTACT_ID.test(contactIds[0])) return null;
  return { kind, contactId: contactIds[0], source };
}

/**
 * The launcher shortcut an action belongs to: the id it is published under,
 * so the launcher can learn which ones get used.
 *
 * @param {{ kind: string, contactId?: string|null }} action
 * @returns {string|null}
 */
export function shortcutIdForAction(action) {
  if (!action) return null;
  if (action.kind === 'pay') return action.contactId ? `pay-${action.contactId}` : null;
  return ['send', 'receive', 'scan'].includes(action.kind) ? action.kind : null;
}

/**
 * @param {{ receivedAt?: number }} action
 * @param {number} [now]
 */
export function isOpenActionStale(action, now = Date.now()) {
  const at = Number(action?.receivedAt);
  return !Number.isFinite(at) || now - at > OPEN_ACTION_TTL_MS;
}
