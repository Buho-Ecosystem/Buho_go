/**
 * Offline country flags for the shops directory.
 *
 * Registers the full `circle-flags` Iconify set (the same flag source the app
 * already vendors for the phone-number flags ke/zm) into @iconify/vue, so
 * `<Icon icon="circle-flags:gb" />` resolves from the app bundle and NEVER hits
 * the Iconify API / a CDN. The set is bundled into the lazy /online-shops chunk
 * (this module is only imported by ShopAvatar), so it never weighs on first
 * paint.
 */
import { addCollection } from '@iconify/vue';
import circleFlags from '@iconify-json/circle-flags/icons.json';

addCollection(circleFlags);

// Codes actually present in the set (icons + aliases). Guarding against this
// means a missing flag falls back to a letter avatar instead of silently
// triggering an API (CDN) lookup for an unknown icon.
const AVAILABLE = new Set([
  ...Object.keys(circleFlags.icons || {}),
  ...Object.keys(circleFlags.aliases || {}),
]);

/**
 * circle-flags icon name for an ISO-3166 alpha-2 code, or '' when there is no
 * matching offline flag (worldwide/unknown included — the caller falls back).
 * @param {string} code
 * @returns {string}
 */
export function flagIcon(code) {
  const cc = String(code || '').toLowerCase();
  if (!cc || cc === 'ww' || cc === 'global') return '';
  return AVAILABLE.has(cc) ? `circle-flags:${cc}` : '';
}
