/**
 * NWC connection strings that reach BuhoGO outside the connect sheet: a link
 * from another app, or a code scanned or pasted on Home. They go to the
 * connect sheet (pages/NWCSetupPage.vue), which tests them at once. So does
 * a Hub's return address after the person approved BuhoGO there.
 *
 * A connection string carries a spending secret, so it is handed over in
 * memory, once: never in a route, where it would land in the history.
 */
import { looksLikeNwcConnection } from '../utils/nwcConnection.js';
import { pairingReturnRoute } from '../utils/nwcPairing.js';

const CONNECT_ROUTE = '/nwc-setup';

let handedOver = '';
let openSheet = null;

/**
 * Take an NWC connection string to the connect sheet.
 * @param {string} input   what was opened, scanned or pasted
 * @param {object} router  the app's router
 * @returns {boolean} true when the input was a connection string and was taken
 */
export function offerNwcConnection(input, router) {
  if (!looksLikeNwcConnection(input)) return false;
  const connection = String(input).trim();
  if (openSheet) {
    openSheet(connection);
    return true;
  }
  handedOver = connection;
  router.push(CONNECT_ROUTE).catch(() => { /* navigation rejection is non-fatal */ });
  return true;
}

/** The connection string handed over before the sheet opened, once; '' when there is none. */
export function takeNwcConnection() {
  const connection = handedOver;
  handedOver = '';
  return connection;
}

/**
 * While the connect sheet is open, a new connection goes straight to it.
 * @param {(connection: string) => void} receive
 * @returns {() => void} stops listening
 */
export function listenForNwcConnection(receive) {
  openSheet = receive;
  return () => {
    if (openSheet === receive) openSheet = null;
  };
}

let openReturn = null;

/**
 * A Hub's return address (https://go.mybuho.de/nwc/connected?…), opened in
 * the app. While the connect sheet is waiting it takes it directly, so the
 * request it holds is finished in place; otherwise the return route opens.
 * @param {string} url
 * @param {object} router
 * @returns {boolean} true when the link was a return address
 */
export function offerPairingReturn(url, router) {
  const route = pairingReturnRoute(url);
  if (!route) return false;
  if (openReturn) {
    openReturn(route.query);
    return true;
  }
  router.push(route).catch(() => { /* navigation rejection is non-fatal */ });
  return true;
}

/**
 * While the connect sheet is open, a return address goes straight to it.
 * @param {(query: Record<string, string|string[]>) => void} receive
 * @returns {() => void} stops listening
 */
export function listenForPairingReturn(receive) {
  openReturn = receive;
  return () => {
    if (openReturn === receive) openReturn = null;
  };
}
