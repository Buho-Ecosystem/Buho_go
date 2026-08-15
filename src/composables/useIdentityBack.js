/**
 * Where "back" actually goes on the identity surface.
 *
 * Most identity screens have more than one door. Photo and name opens from
 * Manage and from the setup ladder on You; Get paid opens from three places.
 * A hardcoded back label is therefore wrong for whoever came the other way,
 * and the surface had three screens promising "Manage" to people who had
 * never been there.
 *
 * The previous route is read from history state, matched against the screens
 * we actually own, and turned into both the label and the route. Anything we
 * do not recognise (a deep link, an external referrer, a screen outside the
 * surface) falls back to the screen's parent, so back is never a guess and
 * never leaves the app.
 */

/** Route -> the title that screen shows. Keys are also the i18n keys. */
const IDENTITY_TITLES = {
  '/identity': 'You',
  '/identity/manage': 'Manage',
  '/identity/username': 'Username',
  '/identity/get-paid': 'Get paid',
  '/identity/identities': 'Your identities',
  '/identity/words': '12 words',
};

/**
 * @param {import('vue-router').Router} router
 * @param {string} fallback Route to use when the referrer is not one of ours.
 * @returns {{ to: string, key: string }}
 */
export function identityBack(router, fallback = '/identity/manage') {
  const previous = String(router.options?.history?.state?.back || '');
  // Hash mode still yields a plain path here, but a query or fragment on it
  // would defeat a bare lookup.
  const path = previous.split('?')[0].split('#')[0];
  const to = IDENTITY_TITLES[path] ? path : fallback;
  return { to, key: IDENTITY_TITLES[to] || IDENTITY_TITLES['/identity/manage'] };
}
