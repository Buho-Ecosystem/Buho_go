/**
 * Shop avatar helpers. We never call a third-party favicon service (e.g.
 * google.com/s2/favicons) — that would leak every shop the user scrolls past.
 * List rows use a deterministic letter avatar; the detail sheet may attempt the
 * shop's OWN first-party favicon (same origin the user is about to visit, so no
 * new tracking surface), falling back to the letter avatar on error.
 */

// A small, calm palette of (background, foreground) pairs for letter avatars.
const PALETTE = [
  ['#FEE2E2', '#b91c1c'], ['#FEF3C7', '#b45309'], ['#DCFCE7', '#15803d'],
  ['#DBEAFE', '#1d4ed8'], ['#E0E7FF', '#4338ca'], ['#F3E8FF', '#7e22ce'],
  ['#FCE7F3', '#be185d'], ['#CCFBF1', '#0f766e'], ['#FFEDD5', '#c2410c'],
];

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Deterministic letter avatar for a shop: a stable initial + colour pair from
 * its name/host, so the same shop always looks the same and no two adjacent
 * rows clash arbitrarily.
 * @param {import('./shop.js').Shop} shop
 * @returns {{ initial: string, bg: string, fg: string }}
 */
export function letterAvatar(shop) {
  const seed = String(shop?.host || shop?.name || '?');
  const initial = (String(shop?.name || shop?.host || '?').trim()[0] || '?').toUpperCase();
  const [bg, fg] = PALETTE[hashString(seed) % PALETTE.length];
  return { initial, bg, fg };
}

/**
 * The shop's OWN favicon URL (first-party only). The detail sheet renders this
 * in an <img> with an @error fallback to the letter avatar — so a missing or
 * blocked icon never shows a broken image.
 * @param {string} host  normalized bare domain
 * @returns {string} '' when no host
 */
export function faviconUrl(host) {
  if (!host) return '';
  return `https://${host}/favicon.ico`;
}
