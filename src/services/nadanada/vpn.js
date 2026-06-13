/**
 * nadanada VPN service — catalog + the request/config flow with client-side
 * WireGuard key generation.
 *
 * Flow:
 *   1. requestVpn({ duration })  -> BOLT11 invoice + paymentHash
 *   2. caller pays the invoice from the internal wallet
 *   3. waitForVpnConfig()        -> generates a keypair locally, polls
 *                                    /vpn/config until the payment settles,
 *                                    and returns the finished .conf (with the
 *                                    private key spliced in on device)
 *
 * The server never receives the private key (see ./wireguard.js).
 * Pure module — no store/network state held here.
 */

import { nadanadaGet, nadanadaPost, withRef, pollWhilePending } from './client.js';
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
 * split the flag out and tidy the label. `code` is nadanada's internal id,
 * which is what `/vpn/config` expects as `country`.
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
 * `duration` is the value passed back to `/vpn/request`. `amount` + `unit`
 * give the human label. A data cap is surfaced if the API ever includes one.
 *
 * @returns {{ value: number, priceUsd: number, label: string, dataInGB: number|null }}
 */
export function normalizeDuration(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Number.isFinite(raw.duration)) return null;
  const amount = Number.isFinite(raw.amount) ? raw.amount : 1;
  const unit = typeof raw.unit === 'string' ? raw.unit : 'day';
  const label = `${amount} ${unit}${amount === 1 ? '' : 's'}`;
  const dataInGB = Number.isFinite(raw.dataInGB) ? raw.dataInGB
    : Number.isFinite(raw.data) ? raw.data
    : Number.isFinite(raw.gb) ? raw.gb
    : null;
  return {
    value: raw.duration,
    priceUsd: Number.isFinite(raw.price) ? raw.price : null,
    label,
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
 * Create a Lightning invoice for a VPN subscription. The affiliate refCode
 * is attached automatically.
 *
 * @param {{ duration: number }} input — the `value` from a normalised duration
 * @returns {Promise<{
 *   checkoutId: string, paymentRequest: string, paymentHash: string,
 *   priceUsd: number|null, duration: number, expiresAt: string|null,
 * }>}
 */
export async function requestVpn({ duration }) {
  if (!Number.isFinite(duration)) throw new Error('vpn request: duration required');
  const res = await nadanadaPost('/vpn/request', withRef({ duration }));
  // The live API nests the payload under `data`; tolerate a flat shape too.
  const data = res?.data ?? res ?? {};
  if (!data.paymentRequest || !data.paymentHash) {
    throw new Error('vpn request: server did not return an invoice');
  }
  return {
    checkoutId: data.checkoutId || null,
    paymentRequest: data.paymentRequest,
    paymentHash: data.paymentHash,
    priceUsd: Number.isFinite(data.price) ? data.price : null,
    duration: Number.isFinite(data.duration) ? data.duration : duration,
    expiresAt: data.expiresAt || null,
  };
}

/**
 * Request the WireGuard config for a settled VPN payment. Sends only the
 * public + preshared keys; the server returns the peer config as text/plain.
 * Throws with `err.status === 402` until the payment settles.
 *
 * @param {{ paymentHash: string, country: string, publicKey: string, presharedKey?: string, signal?: AbortSignal }} input
 * @returns {Promise<string>} raw server config text
 */
export async function fetchVpnConfig({ paymentHash, country, publicKey, presharedKey, signal } = {}) {
  if (!paymentHash) throw new Error('vpn config: paymentHash required');
  if (!country) throw new Error('vpn config: country required');
  if (!publicKey) throw new Error('vpn config: publicKey required');
  return nadanadaPost(
    '/vpn/config',
    { paymentHash, country, publicKey, presharedKey },
    { signal, raw: true },
  );
}

/**
 * After payment, generate a keypair locally, poll `/vpn/config` until the
 * payment settles, then splice the private key into the server config to
 * produce the finished, importable `.conf`. Honours an AbortSignal.
 *
 * The caller passes the keypair in (so it can be persisted alongside the
 * config); if omitted, one is generated here.
 *
 * @param {{
 *   paymentHash: string, country: string,
 *   keypair?: { privateKey: string, publicKey: string },
 *   presharedKey?: string,
 *   signal?: AbortSignal, intervalMs?: number, maxMs?: number,
 * }} input
 * @returns {Promise<{ ok: boolean, config?: string, publicKey?: string, privateKey?: string, presharedKey?: string }>}
 */
export async function waitForVpnConfig({
  paymentHash,
  country,
  keypair,
  presharedKey,
  signal,
  deadline,
  maxMs = CONFIG_POLL_MAX_MS,
} = {}) {
  if (!paymentHash) throw new Error('vpn wait: paymentHash required');
  if (!country) throw new Error('vpn wait: country required');

  const keys = keypair || generateWireGuardKeypair();
  const psk = presharedKey || generatePresharedKey();

  // Backs off, stops at the invoice deadline, bails on persistent errors, and
  // is abortable. 402 = payment not confirmed yet (keep polling).
  const config = await pollWhilePending(
    async (sig) => {
      const serverConfig = await fetchVpnConfig({
        paymentHash,
        country,
        publicKey: keys.publicKey,
        presharedKey: psk,
        signal: sig,
      });
      if (serverConfig && /\[interface\]/i.test(serverConfig)) {
        return assembleWireGuardConfig(serverConfig, { privateKey: keys.privateKey, presharedKey: psk });
      }
      return null;
    },
    { signal, deadline, maxMs },
  );

  return config
    ? { ok: true, config, publicKey: keys.publicKey, privateKey: keys.privateKey, presharedKey: psk }
    : { ok: false };
}

/**
 * Live status for a VPN subscription, keyed by its public key (used by
 * "My purchases" to show remaining time/data).
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
    country: data.country || '',
    countryName: data.countryName || '',
    expiryDate: data.expiryDate || null,
    remainingData: Number.isFinite(data.remainingData) ? data.remainingData : null,
    bandwidthUsed: Number.isFinite(data.bandwidthUsed) ? data.bandwidthUsed : null,
    bandwidthAllotted: Number.isFinite(data.bandwidthAllotted) ? data.bandwidthAllotted : null,
    isEnabled: data.isEnabled === true,
    serverUrl: data.serverUrl || '',
  };
}
