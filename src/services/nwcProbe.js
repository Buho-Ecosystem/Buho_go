/**
 * Test an NWC connection before it is saved: ask the wallet who it is and
 * what this connection may do. Nothing is stored here; the result feeds
 * the confirm step (a name, the balance, the address, the grants, the
 * spending limit) and then `addWallet`.
 *
 * Wallets that run on a phone wake by push, so a first silence is not the
 * end: `get_info` is asked once more before the wallet counts as silent.
 */
import { NWCClient } from '@getalby/sdk';
import { parseNwcConnection } from '../utils/nwcConnection.js';
import { nip47Methods, spendingLimitFrom } from '../utils/nwcWallet.js';
import { NWC_ERROR, isNoAnswer, isRelayFailure, nwcError } from '../utils/nwcErrors.js';

/**
 * @typedef {object} NwcProbe
 * @property {string} normalized connection string to store (every relay kept)
 * @property {string} connectionPubkey the wallet service key of this connection
 * @property {string[]} relays
 * @property {string} alias what the wallet calls itself ('' when it does not say)
 * @property {string} nodePubkey the wallet's own node or account key ('' when unknown)
 * @property {string} network
 * @property {string[]} methods NIP-47 methods this connection may use
 * @property {string[]} notifications
 * @property {string|null} lud16 Lightning address, from the connection or the wallet
 * @property {number|null} balanceSats null when the connection may not read it
 * @property {object|null} limit spending limit (utils/nwcWallet spendingLimitFrom)
 */

/**
 * @param {string} nwcUrl
 * @param {object} [options]
 * @param {(url: string) => object} [options.createClient] NWCClient factory, replaceable in tests
 * @param {() => void} [options.onWaiting] called when the first ask went unanswered
 * @returns {Promise<NwcProbe>}
 */
export async function probeNwcConnection(nwcUrl, { createClient = (url) => new NWCClient({ nostrWalletConnectUrl: url }), onWaiting } = {}) {
  const parsed = parseNwcConnection(nwcUrl);
  if (!parsed.ok) throw nwcError('NWC_INVALID', parsed.reason, { reason: parsed.reason });

  const client = createClient(parsed.normalized);
  try {
    const info = await walletInfo(client, onWaiting);
    const methods = nip47Methods(info.methods);
    const [balanceSats, limit] = await Promise.all([
      methods.includes('get_balance')
        ? client.getBalance().then((b) => Math.floor(Number(b?.balance || 0) / 1000)).catch(() => null)
        : null,
      methods.includes('get_budget')
        ? client.getBudget().then(spendingLimitFrom).catch(() => null)
        : null,
    ]);
    return {
      normalized: parsed.normalized,
      connectionPubkey: parsed.pubkey,
      relays: parsed.relays,
      alias: String(info.alias || ''),
      nodePubkey: String(info.pubkey || ''),
      network: info.network || 'mainnet',
      methods,
      notifications: Array.isArray(info.notifications) ? info.notifications : [],
      lud16: parsed.lud16 || info.lud16 || null,
      balanceSats,
      limit,
    };
  } catch (error) {
    throw classify(error);
  } finally {
    try { client.close?.(); } catch { /* already closed */ }
  }
}

/**
 * `get_info`, asked twice when the first goes unanswered. A connection
 * that may not call it still has the methods its wallet published (the
 * kind 13194 info event), which is enough to know what it can do.
 */
async function walletInfo(client, onWaiting) {
  try {
    return await client.getInfo();
  } catch (error) {
    if (isNoAnswer(error) && !/no info event/i.test(error?.message || '')) {
      onWaiting?.();
      return client.getInfo();
    }
    if (error?.code === 'RESTRICTED' || error?.code === 'NOT_IMPLEMENTED') {
      const service = await client.getWalletServiceInfo();
      return { methods: service?.capabilities || [], notifications: service?.notifications || [] };
    }
    throw error;
  }
}

/** Transport failures get BuhoGO's codes; the wallet's own codes pass through. */
function classify(error) {
  if (isNoAnswer(error)) return nwcError(NWC_ERROR.NO_ANSWER, error?.message, { cause: error });
  if (isRelayFailure(error)) return nwcError(NWC_ERROR.RELAY_UNREACHABLE, error?.message, { cause: error });
  return error;
}
