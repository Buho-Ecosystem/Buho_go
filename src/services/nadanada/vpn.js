/**
 * nadanada VPN service — catalog, purchase, extension, config, and status.
 *
 * Flow:
 *   1. requestVpn({ duration })  -> BOLT11 invoice + paymentHash + checkoutId
 *   2. caller pays the invoice from the internal wallet
 *   3. waitForVpnConfig()        -> polls /vpn/config until the payment
 *                                    settles, and returns the finished .conf
 *                                    (with the private key spliced in on device)
 *
 * The server never receives the private key (see ./wireguard.js).
 *
 * ONE CONFIG PER PAYMENT — the single most dangerous property of this API.
 * `/vpn/config` will generate a configuration exactly once for a given
 * payment; every later call returns 409 CONFIG_ALREADY_GENERATED. That means:
 *
 *   - the keypair must be generated and PERSISTED BEFORE the config is
 *     requested, or a lost response leaves a live subscription bound to a
 *     private key nobody holds;
 *   - a 200 response must never be discarded, however odd it looks. We hand
 *     back whatever the server sent rather than retrying into a permanent 409;
 *   - a 409 is terminal and must be reported as such, not retried behind a
 *     "still waiting" spinner.
 *
 * Pure module — no store/network state held here.
 */

import {
  nadanadaGet, nadanadaPost, withRef, pollWhilePending, NadanadaError, assertNativePurchase,
} from './client.js';
import {
  generateWireGuardKeypair,
  generatePresharedKey,
  assembleWireGuardConfig,
} from './wireguard.js';

/** Hard fallback cap on config polling when the invoice carries no usable
 *  expiry. The poll also stops at the invoice `deadline` and backs off. */
const CONFIG_POLL_MAX_MS = 180000;

// ── Normalisers ─────────────────────────────────────────────────────────────

/**
 * Normalise a VPN country from `/vpn/countries`.
 * Raw: { code: "13", name: "🇺🇸 United-States", isoCode: "US" }
 * The display name carries a leading flag emoji and hyphenated words; we
 * split the flag out and tidy the label.
 *
 * `code` is nadanada's own server id and is what `/vpn/config` expects as
 * `country` — confirmed against their spec, whose example value is "13", the
 * same id this endpoint returns for the United States alongside isoCode "US".
 *
 * @returns {{ code: string, isoCode: string, flag: string, name: string }}
 */
export function normalizeVpnCountry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = raw.code != null ? String(raw.code) : '';
  if (!code) return null;
  const rawName = typeof raw.name === 'string' ? raw.name : '';
  // Pull a leading emoji flag (two regional-indicator codepoints) if present.
  const flagMatch = rawName.match(/^(\p{Regional_Indicator}{2})/u);
  const flag = flagMatch ? flagMatch[1] : '';
  const name = rawName
    .replace(/^\p{Regional_Indicator}{2}\s*/u, '')
    .replace(/-/g, ' ')
    .trim();
  return {
    code,
    isoCode: typeof raw.isoCode === 'string' ? raw.isoCode : '',
    flag,
    name: name || rawName || code,
  };
}

/**
 * Normalise a duration option from `/vpn/countries` (`data.durations`).
 * Raw: { duration: 30, price: 30, unit: "year", amount: 1 }
 *
 * NOTE the trap in the field name: `duration` is a PLAN SELECTOR EXPRESSED AS
 * THE PRICE IN USD, not a number of days. Their spec is explicit ("pass the
 * plan's price in USD … This is a price value, not a number of days") and the
 * live catalog confirms it — every entry has `duration === price`. `value` is
 * what goes back to `/vpn/request`; `amount` + `unit` are for the label, kept
 * separate so the UI can translate them.
 *
 * @returns {{ value: number, priceUsd: number, amount: number, unit: string, label: string, dataInGB: number|null }}
 */
export function normalizeDuration(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Number.isFinite(raw.duration)) return null;
  const amount = Number.isFinite(raw.amount) ? raw.amount : 1;
  const unit = typeof raw.unit === 'string' ? raw.unit : 'day';
  const dataInGB = Number.isFinite(raw.dataInGB) ? raw.dataInGB
    : Number.isFinite(raw.data) ? raw.data
    : Number.isFinite(raw.gb) ? raw.gb
    : null;
  return {
    value: raw.duration,
    priceUsd: Number.isFinite(raw.price) ? raw.price : null,
    amount,
    unit,
    // English fallback for stored receipts; the UI localises from amount+unit.
    label: `${amount} ${unit}${amount === 1 ? '' : 's'}`,
    dataInGB,
  };
}

/** Sort durations cheapest-first so the picker reads short to long. */
export function sortDurations(durations) {
  return [...durations].sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
}

// ── Catalog ──────────────────────────────────────────────────────────────────

/**
 * Fetch the VPN catalog: server countries + available subscription
 * durations. Both are normalised; durations are sorted cheapest-first.
 *
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ countries: object[], durations: object[] }>}
 */
export async function fetchVpnCatalog({ signal } = {}) {
  const res = await nadanadaGet('/vpn/countries', { signal });
  const data = res?.data || {};
  const countries = (Array.isArray(data.countries) ? data.countries : [])
    .map(normalizeVpnCountry)
    .filter(Boolean);
  const durations = sortDurations(
    (Array.isArray(data.durations) ? data.durations : [])
      .map(normalizeDuration)
      .filter(Boolean),
  );
  return { countries, durations };
}

// ── Purchase flow ─────────────────────────────────────────────────────────────

/**
 * Shape a `/vpn/request` or `/vpn/extend` response into an invoice record.
 *
 * `/vpn/extend` also echoes back the country the existing subscription runs
 * on. That is more authoritative than anything we stored, so it is carried
 * through for the caller to prefer — an extension configured against the wrong
 * server would be a new tunnel, not a renewal.
 */
function normalizeVpnInvoice(data, fallbackDuration) {
  if (!data.paymentRequest || !data.paymentHash) {
    throw new Error('vpn request: server did not return an invoice');
  }
  return {
    checkoutId: data.checkoutId || null,
    paymentRequest: data.paymentRequest,
    paymentHash: data.paymentHash,
    // The Lightning discount applies to eSIM only; VPN is charged at list
    // price, so there is no originalPrice to compare against here.
    priceUsd: Number.isFinite(data.price) ? data.price : null,
    duration: Number.isFinite(data.duration) ? data.duration : fallbackDuration,
    expiresAt: data.expiresAt || null,
    country: data.country != null ? String(data.country) : null,
    countryName: data.countryName || null,
  };
}

/**
 * Create a Lightning invoice for a VPN subscription. The affiliate refCode
 * is attached automatically.
 *
 * @param {{ duration: number }} input — the `value` from a normalised duration
 * @returns {Promise<object>} invoice record
 */
export async function requestVpn({ duration }) {
  assertNativePurchase();
  if (!Number.isFinite(duration)) throw new Error('vpn request: duration required');
  const res = await nadanadaPost('/vpn/request', withRef({ duration }));
  return normalizeVpnInvoice(res?.data ?? res ?? {}, duration);
}

/**
 * Create a Lightning invoice to extend an existing subscription, identified
 * by its WireGuard public key. Returns 404 when there is no active
 * subscription for that key.
 *
 * @param {{ publicKey: string, duration: number }} input
 */
export async function requestVpnExtension({ publicKey, duration }) {
  assertNativePurchase();
  if (!publicKey) throw new Error('vpn extend: publicKey required');
  if (!Number.isFinite(duration)) throw new Error('vpn extend: duration required');
  const res = await nadanadaPost('/vpn/extend', withRef({ publicKey, duration }));
  return normalizeVpnInvoice(res?.data ?? res ?? {}, duration);
}

/**
 * Request the WireGuard config for a settled payment. Sends only the public +
 * preshared keys; the server returns the peer config as text/plain.
 *
 * Throws with `status === 402` until the payment settles, and a fatal error
 * with `code === 'CONFIG_ALREADY_GENERATED'` on 409.
 *
 * @param {{ paymentHash?: string, checkoutId?: string, country: string, publicKey: string, presharedKey?: string, signal?: AbortSignal }} input
 * @returns {Promise<string>} raw server config text
 */
export async function fetchVpnConfig({
  paymentHash, checkoutId, country, publicKey, presharedKey, signal,
} = {}) {
  if (!paymentHash && !checkoutId) throw new Error('vpn config: paymentHash or checkoutId required');
  if (!country) throw new Error('vpn config: country required');
  if (!publicKey) throw new Error('vpn config: publicKey required');
  const body = { country, publicKey, presharedKey };
  if (paymentHash) body.paymentHash = paymentHash;
  else body.checkoutId = checkoutId;
  return nadanadaPost('/vpn/config', body, { signal, raw: true });
}

/**
 * After payment, poll `/vpn/config` until the payment settles, then splice the
 * private key into the server config to produce the finished, importable
 * `.conf`. Honours an AbortSignal and always settles within `maxMs`.
 *
 * The caller MUST pass the keypair in, already persisted, because the server
 * will only ever issue one config for this payment.
 *
 * A 200 is never rejected for looking unfamiliar: if the body does not carry
 * an `[Interface]` section we still return it, flagged `raw: true`, so the
 * user can copy it out by hand. Retrying instead would burn the one config
 * this payment is entitled to.
 *
 * @param {{
 *   paymentHash?: string, checkoutId?: string, country: string,
 *   keypair?: { privateKey: string, publicKey: string },
 *   presharedKey?: string,
 *   signal?: AbortSignal, deadline?: number, maxMs?: number,
 * }} input
 * @returns {Promise<{ ok: boolean, config?: string, raw?: boolean, publicKey?: string, privateKey?: string, presharedKey?: string, fatal?: boolean, error?: string, code?: string }>}
 */
export async function waitForVpnConfig({
  paymentHash,
  checkoutId,
  country,
  keypair,
  presharedKey,
  signal,
  deadline,
  maxMs = CONFIG_POLL_MAX_MS,
} = {}) {
  if (!paymentHash && !checkoutId) throw new Error('vpn wait: paymentHash or checkoutId required');
  if (!country) throw new Error('vpn wait: country required');

  const keys = keypair || generateWireGuardKeypair();
  const psk = presharedKey || generatePresharedKey();

  try {
    const issued = await pollWhilePending(
      async (sig) => {
        const serverConfig = await fetchVpnConfig({
          paymentHash,
          checkoutId,
          country,
          publicKey: keys.publicKey,
          presharedKey: psk,
          signal: sig,
        });
        const text = typeof serverConfig === 'string' ? serverConfig.trim() : '';
        if (!text) return null; // an empty body is not a config; keep waiting
        // Anything non-empty is the one config we get. Take it as-is.
        return /\[interface\]/i.test(text)
          ? { config: assembleWireGuardConfig(text, { privateKey: keys.privateKey, presharedKey: psk }), raw: false }
          : { config: text, raw: true };
      },
      { signal, deadline, maxMs },
    );

    if (!issued) return { ok: false };
    return {
      ok: true,
      config: issued.config,
      raw: issued.raw,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      presharedKey: psk,
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    if (err?.fatal) {
      return {
        ok: false,
        fatal: true,
        error: err.message,
        code: err.code || null,
        // Hand the keys back so the caller can still store them against the
        // order; a config that was issued elsewhere is bound to this key.
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        presharedKey: psk,
      };
    }
    throw err;
  }
}

// ── Live status ──────────────────────────────────────────────────────────────

/**
 * Live status for a VPN subscription, keyed by its public key.
 * Returns `{ found: false }` when the server has no record of the key.
 *
 * @param {string} publicKey
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function fetchVpnStatus(publicKey, { signal } = {}) {
  if (!publicKey) throw new Error('vpn status: publicKey required');
  const res = await nadanadaGet(`/vpn/status/${encodeURIComponent(publicKey)}`, { signal });
  const data = res?.data || {};
  if (!data.found) return { found: false };
  return {
    found: true,
    country: data.country != null ? String(data.country) : '',
    countryName: data.countryName || '',
    expiryDate: data.expiryDate || null,
    remainingData: Number.isFinite(data.remainingData) ? data.remainingData : null,
    bandwidthUsed: Number.isFinite(data.bandwidthUsed) ? data.bandwidthUsed : null,
    bandwidthAllotted: Number.isFinite(data.bandwidthAllotted) ? data.bandwidthAllotted : null,
    isEnabled: data.isEnabled === true,
    serverUrl: data.serverUrl || '',
  };
}

/**
 * Reduce a VPN status to the one line the product card leads with.
 *
 * `percent` is only computed when the server reports both a used and an
 * allotted figure — an empty meter reads as broken, so the card omits the bar
 * entirely rather than drawing 0%.
 *
 * @param {object|null} status — from fetchVpnStatus
 * @param {number} [now] — epoch ms, injectable for tests
 * @returns {{ state: 'active'|'expired'|'disabled'|'unknown', endsAt: string|null, daysLeft: number|null, percent: number|null }}
 */
export function deriveVpnState(status, now = Date.now()) {
  const out = { state: 'unknown', endsAt: null, daysLeft: null, percent: null };
  if (!status || status.found === false) return out;

  out.endsAt = status.expiryDate || null;
  const end = status.expiryDate ? Date.parse(status.expiryDate) : NaN;
  if (Number.isFinite(end)) {
    out.daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
    out.state = end > now ? 'active' : 'expired';
  }
  if (out.state === 'active' && status.isEnabled === false) out.state = 'disabled';

  const used = status.bandwidthUsed;
  const allotted = status.bandwidthAllotted;
  if (Number.isFinite(used) && Number.isFinite(allotted) && allotted > 0) {
    out.percent = Math.min(100, Math.max(0, (used / allotted) * 100));
  }
  return out;
}

export { NadanadaError };
