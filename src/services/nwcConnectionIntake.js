/**
 * NWC connection strings that reach BuhoGO outside the connect sheet: a link
 * from another app, or a code scanned or pasted on Home. They go to the
 * connect sheet (pages/NWCSetupPage.vue), which tests them at once.
 *
 * A connection string carries a spending secret, so it is handed over in
 * memory, once: never in a route, where it would land in the history.
 */
import { looksLikeNwcConnection } from '../utils/nwcConnection.js';

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
