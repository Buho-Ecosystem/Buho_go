/**
 * Esplora client for the emergency exit: the few chain facts the exit needs
 * and the two ways to broadcast. Public instances that proxy bitcoind's
 * `submitpackage` are listed first; the tree transactions pay no fee of
 * their own and are only accepted together with their fee child.
 *
 * Every read fails over across the endpoints. A broadcast is different: a
 * rejection is an answer, so it is surfaced instead of retried elsewhere,
 * except when the network already knows the transaction, which counts as
 * success.
 */

export const DEFAULT_ESPLORA_ENDPOINTS = Object.freeze([
  'https://mempool.space/api',
  'https://blockstream.info/api',
  'https://mempool.emzy.de/api',
]);

const ALREADY_KNOWN = /already[- ]known|already in block chain|txn-already-in-mempool|already-in-mempool/i;

export class EsploraError extends Error {
  constructor(message, { code = 'ESPLORA_ERROR', status = 0, endpoint = '' } = {}) {
    super(message);
    this.name = 'EsploraError';
    this.code = code;
    this.status = status;
    this.endpoint = endpoint;
  }
}

export function isAlreadyKnownMessage(text) {
  return ALREADY_KNOWN.test(String(text || ''));
}

export function createEsploraClient({
  endpoints = DEFAULT_ESPLORA_ENDPOINTS,
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 15000,
} = {}) {
  const bases = endpoints.map(url => String(url).replace(/\/+$/, ''));

  async function request(base, path, init = {}) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(`${base}${path}`, { ...init, signal: controller?.signal });
      const text = await response.text();
      return { ok: response.ok, status: response.status, text };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Reads: try each endpoint in turn; a transport failure or 5xx moves on. */
  async function read(path, { allowNotFound = false } = {}) {
    let lastError = null;
    for (const base of bases) {
      try {
        const res = await request(base, path);
        if (res.ok) return { base, text: res.text, status: res.status };
        if (res.status === 404 && allowNotFound) return { base, text: res.text, status: 404 };
        if (res.status >= 500 || res.status === 429) { lastError = new EsploraError(res.text || `HTTP ${res.status}`, { status: res.status, endpoint: base }); continue; }
        throw new EsploraError(res.text || `HTTP ${res.status}`, { status: res.status, endpoint: base });
      } catch (error) {
        if (error instanceof EsploraError && error.status && error.status < 500 && error.status !== 429) throw error;
        lastError = error;
      }
    }
    throw new EsploraError(lastError?.message || 'No endpoint reachable', { code: 'UNREACHABLE' });
  }

  async function tipHeight() {
    const { text } = await read('/blocks/tip/height');
    const height = Number(text);
    if (!Number.isInteger(height)) throw new EsploraError('Bad tip height', { code: 'BAD_RESPONSE' });
    return height;
  }

  async function txStatus(txid) {
    const { status, text } = await read(`/tx/${txid}/status`, { allowNotFound: true });
    if (status === 404) return { known: false, confirmed: false };
    const data = JSON.parse(text);
    return { known: true, confirmed: !!data.confirmed, blockHeight: data.block_height ?? undefined };
  }

  async function utxos(address) {
    const { text } = await read(`/address/${address}/utxo`);
    return JSON.parse(text).map(u => ({
      txid: u.txid, vout: u.vout, value: u.value,
      confirmed: !!u.status?.confirmed, blockHeight: u.status?.block_height ?? undefined,
    }));
  }

  /** Sat/vB tiers. mempool-style `/v1/fees/recommended` first, Esplora `/fee-estimates` as fallback. */
  async function recommendedFees() {
    try {
      const { text } = await read('/v1/fees/recommended');
      const data = JSON.parse(text);
      if (Number.isFinite(data.hourFee)) return { fast: data.fastestFee, medium: data.halfHourFee, slow: data.hourFee, minimum: data.minimumFee ?? 1 };
    } catch { /* fall through to the Esplora shape */ }
    const { text } = await read('/fee-estimates');
    const data = JSON.parse(text);
    const pick = target => Math.max(1, Math.ceil(Number(data[target] || data['1'] || 1)));
    return { fast: pick('1'), medium: pick('3'), slow: pick('6'), minimum: 1 };
  }

  async function broadcastTx(txHex) {
    const res = await request(bases[0], '/tx', { method: 'POST', body: txHex, headers: { 'Content-Type': 'text/plain' } });
    if (res.ok) return res.text.trim();
    if (isAlreadyKnownMessage(res.text)) return null;
    throw new EsploraError(res.text || `HTTP ${res.status}`, { code: 'REJECTED', status: res.status, endpoint: bases[0] });
  }

  /** One parent with its fee child, as bitcoind's submitpackage expects. */
  async function broadcastPackage(txHexes) {
    if (!Array.isArray(txHexes) || txHexes.length < 1 || txHexes.length > 25) {
      throw new EsploraError('A package holds 1 to 25 transactions', { code: 'BAD_PACKAGE' });
    }
    let lastError = null;
    for (const base of bases) {
      const res = await request(base, '/txs/package', { method: 'POST', body: JSON.stringify(txHexes), headers: { 'Content-Type': 'application/json' } }).catch(error => ({ ok: false, status: 0, text: error.message }));
      if (res.ok) return res.text ? safeJson(res.text) : {};
      if (isAlreadyKnownMessage(res.text)) return { alreadyKnown: true };
      lastError = new EsploraError(res.text || `HTTP ${res.status}`, { code: res.status ? 'REJECTED' : 'UNREACHABLE', status: res.status, endpoint: base });
      // Only a transport failure or a server error justifies asking the next node.
      if (res.status && res.status < 500) throw lastError;
    }
    throw lastError || new EsploraError('No endpoint reachable', { code: 'UNREACHABLE' });
  }

  return { endpoints: bases, tipHeight, txStatus, utxos, recommendedFees, broadcastTx, broadcastPackage };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
