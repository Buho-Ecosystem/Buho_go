/**
 * Where the Spark wallets read the Bitcoin chain: deposit addresses, the
 * status of a transaction, fees for a refund.
 *
 * Left to itself, the Breez SDK asks mempool.space alone. On a network that
 * cannot reach that one host, every chain lookup retried for a minute, so
 * each sync took a minute and Spark looked broken while it was answering
 * fine. Here the SDK gets one chain service that asks the same servers as
 * the emergency exit, in order, gives each a short while, and keeps to the
 * one that answered.
 */

import { DEFAULT_ESPLORA_ENDPOINTS, isAlreadyKnownMessage } from './esplora.js';

/** How long one server gets for one lookup before the next is asked: one
 * server that never answers and one that does fit in one Spark sync. */
export const CHAIN_LOOKUP_TIMEOUT_MS = 8_000;
/** How long a server that answered stays first, before the first is tried again. */
export const KEEP_ANSWERING_SERVER_MS = 10 * 60_000;

const LOOKUPS = Object.freeze([
  'getAddressUtxos',
  'getAddressTxos',
  'getTransactionStatus',
  'tipHeight',
  'getTransactionHex',
  'getOutspend',
  'recommendedFees',
]);

class ChainLookupTimeout extends Error {
  constructor() {
    super('The chain server did not answer in time');
    this.name = 'ChainLookupTimeout';
  }
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new ChainLookupTimeout()), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * One chain service (the SDK's BitcoinChainService interface) over several.
 *
 * @param {object[]} servers  chain services, in the order to ask them
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.keepMs]
 * @param {() => number} [options.now]
 */
export function createFallbackChainService(servers, {
  timeoutMs = CHAIN_LOOKUP_TIMEOUT_MS,
  keepMs = KEEP_ANSWERING_SERVER_MS,
  now = () => Date.now(),
} = {}) {
  if (!servers?.length) throw new TypeError('at least one chain server is needed');
  let first = 0;
  let firstSince = 0;

  function order() {
    if (first !== 0 && now() - firstSince > keepMs) first = 0;
    return servers.map((_, i) => (first + i) % servers.length);
  }

  function answered(index) {
    if (index !== first) {
      first = index;
      firstSince = now();
    }
  }

  async function ask(method, args, { accept = () => false } = {}) {
    let lastError;
    for (const index of order()) {
      try {
        const result = await withTimeout(servers[index][method](...args), timeoutMs);
        answered(index);
        return result;
      } catch (error) {
        if (accept(error)) {
          answered(index);
          return undefined;
        }
        lastError = error;
      }
    }
    throw lastError;
  }

  const service = {};
  for (const method of LOOKUPS) service[method] = (...args) => ask(method, args);
  // A transaction a server already has is a broadcast that worked: an
  // earlier server may have taken it before it ran out of time.
  service.broadcastTransaction = (tx) => ask('broadcastTransaction', [tx], {
    accept: (error) => isAlreadyKnownMessage(error?.message || error),
  });
  return service;
}

const shared = new Map();

/**
 * The chain service every Spark wallet on this network shares (one HTTP
 * client per server, as the SDK recommends). Mainnet only: other networks
 * keep the SDK's own server.
 *
 * @param {object} mod      the initialised Breez SDK module
 * @param {string} network  'mainnet' | 'regtest' | 'signet'
 * @returns {Promise<object|null>}
 */
export function sparkChainService(mod, network) {
  if (network !== 'mainnet' || typeof mod?.newRestChainService !== 'function') return Promise.resolve(null);
  if (!shared.has(network)) {
    const built = Promise.all(DEFAULT_ESPLORA_ENDPOINTS.map((url) => mod.newRestChainService(url, network, 'esplora')))
      .then((servers) => createFallbackChainService(servers));
    // A failed build is tried again by the next wallet, not remembered.
    built.catch(() => shared.delete(network));
    shared.set(network, built);
  }
  return shared.get(network);
}
