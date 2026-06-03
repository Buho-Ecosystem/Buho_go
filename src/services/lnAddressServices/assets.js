/**
 * Resolve the bundled flag / logo files named in ./countries.js to their
 * built URLs. This is the ONLY module in the package that imports image
 * assets (via Vite's `?url`), which keeps countries.js + phoneNumbers.js pure
 * and unit-testable under plain Node. Assets are bundled locally so the send
 * sheet never calls an icon CDN — it works offline and doesn't reveal the
 * destination country to a third party at payment time.
 *
 * When adding a country/provider: drop the round SVG under
 * src/assets/lnAddressServices/, add the import + map entry here, and point
 * the country's flagFile/logoFile at the same relative path.
 */
import keFlag from '../../assets/lnAddressServices/flags/circle-flags--ke.svg?url'
import zmFlag from '../../assets/lnAddressServices/flags/circle-flags--zm.svg?url'
import bitzedLogo from '../../assets/lnAddressServices/logos/bitzed.svg?url'
import tandoLogo from '../../assets/lnAddressServices/logos/tando.png?url'

const ASSET_URLS = {
  'flags/circle-flags--ke.svg': keFlag,
  'flags/circle-flags--zm.svg': zmFlag,
  'logos/bitzed.svg': bitzedLogo,
  'logos/tando.png': tandoLogo,
}

/**
 * @param {string|null|undefined} file  relative path from countries.js
 * @returns {string|null} the bundled URL, or null when unset/unknown
 */
export function assetUrl(file) {
  if (!file) return null
  return ASSET_URLS[file] || null
}
