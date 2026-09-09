/**
 * nadanada store service — barrel export.
 *
 * Native in-app store for nadanada (formerly LNVPN) privacy products:
 * eSIM data plans and WireGuard VPN, paid from the internal wallet balance.
 * See ./client.js for the API contract and the affiliate refCode, and
 * ./orders.js for why every purchase is recorded before it is paid.
 */

export {
  NADANADA_BASE,
  NADANADA_REF_CODE,
  NadanadaError,
  isFatalError,
  assertNativePurchase,
  isPendingError,
  withRef,
  nadanadaGet,
  nadanadaPost,
  pollWhilePending,
} from './client.js';

export {
  fetchEsimCountries,
  fetchEsimBundles,
  purchaseEsim,
  purchaseEsimTopup,
  completeEsim,
  completeEsimTopup,
  waitForEsim,
  waitForEsimTopup,
  fetchEsimStatus,
  deriveEsimState,
  declaredBundleBytes,
  unitsAreBytes,
  normalizeCountry,
  normalizeRegion,
  normalizeBundle,
  sortBundles,
} from './esim.js';

export {
  fetchVpnCatalog,
  requestVpn,
  requestVpnExtension,
  fetchVpnConfig,
  waitForVpnConfig,
  fetchVpnStatus,
  deriveVpnState,
  normalizeVpnCountry,
  normalizeDuration,
  sortDurations,
} from './vpn.js';

export {
  ORDER_STATE,
  ORDER_KIND,
  REDEEM_ATTEMPT_MS,
  PROBE_ATTEMPT_MS,
  newOrderId,
  isPending,
  isUnconfirmed,
  isRedeemable,
  isDefinitivelyUnpaid,
  needsAttention,
  invoiceDeadline,
  orderReference,
  orderReceiptText,
  redeemOrder,
  redeemAll,
} from './orders.js';

export {
  parseNadanadaInvoice,
  findOrphanPayments,
  missingDetailFor,
  candidateOrderFields,
  collectOutgoingPayments,
} from './recovery.js';

export {
  generateWireGuardKeypair,
  generatePresharedKey,
  assembleWireGuardConfig,
} from './wireguard.js';
