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

import { isAlreadyKnownMessage } from './esplora.js';

/**
 * The servers, in the order they are asked: the emergency exit's
 * (esplora.js DEFAULT_ESPLORA_ENDPOINTS). Mempool servers are asked as
 * Mempool, which gives the SDK their recommended fees, as its own default
 * does; Blockstream speaks plain Esplora.
 */
export const SPARK_CHAIN_SERVERS = Object.freeze([
  Object.freeze({ url: 'https://mempool.space/api', api: 'mempoolSpace' }),
  Object.freeze({ url: 'https://blockstream.info/api', api: 'esplora' }),
  Object.freeze({ url: 'https://mempool.emzy.de/api', api: 'mempoolSpace' }),
]);

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

// The SDK reads a chain service's failure as text only (an Error object
// reaches it as "Chain service error occurred"), as its own servers fail.
const TIMED_OUT = 'Service connectivity: the chain server did not answer in time';

/** A failure as the SDK reads it: text, with the server's own words. */
function failureText(error) {
  if (typeof error === 'string') return error;
  return String(error?.message || error || 'Chain service error');
}

/**
 * A server's verdict on the question, as opposed to a server in trouble:
 * 400 (a broadcast refused), 404 (no such transaction) or 422 (a request
 * it cannot process). Asking the next server would only repeat it. Any
 * other answer says nothing about the question and the next server is
 * asked: 5xx, a rate limit (429), a timeout, or a block in front of the
 * server (401, 403, 407, 451 from a proxy, a CDN or a region block).
 */
const VERDICTS = new Set([400, 404, 422]);

export function isVerdict(text) {
  return VERDICTS.has(Number(/Status error: (\d{3})/.exec(text)?.[1]));
}

const timedOut = Symbol('timed out');

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(timedOut), ms); });
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
    // What a server said beats a server that said nothing: it may carry the
    // answer the SDK looks for ("already in the mempool", "not found").
    let refusal = null;
    for (const index of order()) {
      let result;
      try {
        result = await withTimeout(servers[index][method](...args), timeoutMs);
      } catch (error) {
        const text = failureText(error);
        if (accept(text)) {
          answered(index);
          return undefined;
        }
        if (isVerdict(text)) {
          answered(index);
          throw text;
        }
        refusal = text;
        continue;
      }
      if (result === timedOut) continue;
      answered(index);
      return result;
    }
    throw refusal ?? TIMED_OUT;
  }

  const service = {};
  for (const method of LOOKUPS) service[method] = (...args) => ask(method, args);
  // A transaction a server already has is a broadcast that worked: an
  // earlier server may have taken it before it ran out of time.
  service.broadcastTransaction = (tx) => ask('broadcastTransaction', [tx], { accept: isAlreadyKnownMessage });
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
    const built = Promise.all(SPARK_CHAIN_SERVERS.map(({ url, api }) => mod.newRestChainService(url, network, api)))
      .then((servers) => createFallbackChainService(servers));
    // A failed build is tried again by the next wallet, not remembered.
    built.catch(() => shared.delete(network));
    shared.set(network, built);
  }
  return shared.get(network);
}
