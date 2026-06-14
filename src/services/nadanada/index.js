/**
 * nadanada store service — barrel export.
 *
 * Native in-app store for nadanada (formerly LNVPN) privacy products:
 * eSIM data plans and WireGuard VPN, paid from the internal wallet balance.
 * See ./client.js for the API contract and the affiliate refCode.
 */

export {
  NADANADA_BASE,
  NADANADA_REF_CODE,
  withRef,
  nadanadaGet,
  nadanadaPost,
} from './client.js';

export {
  fetchEsimCountries,
  fetchEsimBundles,
  purchaseEsim,
  completeEsim,
  waitForEsim,
  fetchEsimStatus,
  normalizeCountry,
  normalizeRegion,
  normalizeBundle,
  sortBundles,
} from './esim.js';

export {
  fetchVpnCatalog,
  requestVpn,
  fetchVpnConfig,
  waitForVpnConfig,
  fetchVpnStatus,
  normalizeVpnCountry,
  normalizeDuration,
  sortDurations,
} from './vpn.js';

export {
  generateWireGuardKeypair,
  generatePresharedKey,
  assembleWireGuardConfig,
} from './wireguard.js';
