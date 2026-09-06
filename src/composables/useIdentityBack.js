/**
 * Where "back" goes on the identity surface.
 *
 * Back is the screen's PARENT in the hierarchy, never the browser history.
 * An earlier version read the previous route out of history state, which
 * built a trap: our back control navigates with push, so going
 * Manage -> Words and tapping "Manage" made history say Words was the
 * previous screen — and Manage's back then pointed at Words. Two screens
 * each naming the other as the way out is a room with no exit.
 *
 * A screen reachable from more than one door lists every legitimate parent;
 * the one place the history is consulted is to pick between THOSE, so back
 * matches the door actually used when it can, and always goes somewhere
 * shallower when it cannot. Every chain ends at /identity.
 */

/** Route -> acceptable parents, nearest-the-root first. First entry is the default. */
const PARENTS = {
  '/identity/sign-in': ['/identity'],
  '/identity/profile': ['/identity'],
  '/identity/identities': ['/identity'],
  '/identity/username': ['/identity/profile', '/identity'],
  '/identity/words': ['/identity', '/identity/identities'],
  '/identity/advanced': ['/identity'],
  '/identity/erase': ['/identity/identities', '/identity'],
};

/** Route -> the title its screen shows. Values are also the i18n keys. */
const IDENTITY_TITLES = {
  '/identity': 'You',
  '/identity/profile': 'Your profile',
  '/identity/identities': 'Identities',
};

/**
 * @param {import('vue-router').Router} router
 * @param {string} currentPath The calling screen's own route.
 * @returns {{ to: string, key: string }}
 */
export function identityBack(router, currentPath) {
  const allowed = PARENTS[currentPath] || ['/identity'];

  // History only ever picks BETWEEN legitimate parents. Anything else it
  // claims — a deeper screen, a foreign route, nothing at all — is ignored.
  const previous = String(router.options?.history?.state?.back || '')
    .split('?')[0]
    .split('#')[0];
  const to = allowed.includes(previous) ? previous : allowed[0];

  return { to, key: IDENTITY_TITLES[to] || IDENTITY_TITLES['/identity'] };
}
