/**
 * nadanada eSIM service — catalog browsing + the purchase/complete flow.
 *
 * Purchase is a three-step pay-then-fulfill handshake:
 *   1. purchaseEsim()  -> BOLT11 invoice + paymentHash
 *   2. caller pays the invoice from the internal wallet
 *   3. waitForEsim()   -> polls completeEsim() until the payment settles,
 *                          returning the installable eSIM (ICCID + QR)
 *
 * Pure module — normalisers shield the UI from the raw API shape. Verified
 * against the live v2 endpoints (see ./client.js for the contract).
 */

import { nadanadaGet, nadanadaPost, withRef, pollWhilePending } from './client.js';

/** Hard fallback cap on completion polling when the invoice carries no usable
 *  expiry. The poll also stops at the invoice's `expiresAt` and backs off
 *  between attempts (see waitForEsim + pollWhilePending). */
const COMPLETE_POLL_MAX_MS = 180000;

// ── Normalisers ─────────────────────────────────────────────────────────────

/**
 * Normalise a country record from `/esim/countries`.
 * Raw: { code, name, flag, slug }
 * @returns {{ code: string, name: string, flag: string, slug: string }}
 */
export function normalizeCountry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = typeof raw.code === 'string' ? raw.code : '';
  const slug = typeof raw.slug === 'string' ? raw.slug : '';
  if (!slug) return null;
  return {
    code,
    name: typeof raw.name === 'string' ? raw.name : slug,
    flag: typeof raw.flag === 'string' ? raw.flag : '',
    slug,
  };
}

/**
 * Normalise a region record from `/esim/countries` (`data.regions`).
 * Regions are slugs the bundles endpoint accepts via `?region=`.
 * @returns {{ name: string, slug: string }}
 */
export function normalizeRegion(raw) {
  if (raw == null) return null;
  // Regions may arrive as bare strings or as objects.
  if (typeof raw === 'string') {
    const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return slug ? { name: raw, slug } : null;
  }
  const name = typeof raw.name === 'string' ? raw.name : '';
  const slug = typeof raw.slug === 'string'
    ? raw.slug
    : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug ? { name: name || slug, slug } : null;
}

/**
 * The catalog lists country bundles under a `fixed_<data>_<days>_<ISO>` name,
 * but the purchase endpoint only accepts the versioned eSIM SKU
 * `esim_<data>_<days>_<ISO>_V2`. Verified live for country bundles (AT, BR,
 * and the docs' JP example).
 *
 * Region bundles (e.g. `fixed_1GB_7D_EUROPE`) use a different, currently
 * unverified purchase scheme, so regions are not offered for purchase yet —
 * the shop surfaces countries only (see ShopPage.loadEsimCatalog).
 *
 * @param {string} name — catalog bundle name
 * @returns {string} the purchasable SKU
 */
export function toPurchasableBundleName(name) {
  if (typeof name !== 'string' || !name) return '';
  if (name.startsWith('fixed_')) return `esim_${name.slice('fixed_'.length)}_V2`;
  return name; // already an esim_*_V2 SKU, or an unknown shape: pass through
}

/**
 * Normalise a bundle from `/esim/bundles`.
 * Raw: { name, description, dataInGB, durationInDays, countryName, price, unlimited, speed[], roamingEnabled[] }
 * `bundleName` is the purchasable SKU; `rawName` keeps the catalog name.
 *
 * @returns {{
 *   bundleName: string, rawName: string, dataInGB: number, durationInDays: number,
 *   priceUsd: number, unlimited: boolean, countryName: string,
 *   description: string,
 * }}
 */
export function normalizeBundle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const rawName = typeof raw.name === 'string' ? raw.name : '';
  if (!rawName) return null;
  return {
    bundleName: toPurchasableBundleName(rawName),
    rawName,
    dataInGB: Number.isFinite(raw.dataInGB) ? raw.dataInGB : null,
    durationInDays: Number.isFinite(raw.durationInDays) ? raw.durationInDays : null,
    priceUsd: Number.isFinite(raw.price) ? raw.price : null,
    unlimited: raw.unlimited === true,
    countryName: typeof raw.countryName === 'string' ? raw.countryName : '',
    description: typeof raw.description === 'string' ? raw.description : '',
  };
}

/** Sort bundles into the order users scan best: by data ascending, then by
 *  duration ascending. Unlimited plans float to the end. */
export function sortBundles(bundles) {
  return [...bundles].sort((a, b) => {
    if (a.unlimited !== b.unlimited) return a.unlimited ? 1 : -1;
    const d = (a.dataInGB ?? Infinity) - (b.dataInGB ?? Infinity);
    if (d !== 0) return d;
    return (a.durationInDays ?? 0) - (b.durationInDays ?? 0);
  });
}

// ── Catalog ──────────────────────────────────────────────────────────────────

/**
 * Fetch the eSIM catalog index: every country and region, plus totals.
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ countries: object[], regions: object[], totalCountries: number, totalRegions: number }>}
 */
export async function fetchEsimCountries({ signal } = {}) {
  const res = await nadanadaGet('/esim/countries', { signal });
  const data = res?.data || {};
  const countries = (Array.isArray(data.countries) ? data.countries : [])
    .map(normalizeCountry)
    .filter(Boolean);
  const regions = (Array.isArray(data.regions) ? data.regions : [])
    .map(normalizeRegion)
    .filter(Boolean);
  return {
    countries,
    regions,
    totalCountries: Number.isFinite(data.totalCountries) ? data.totalCountries : countries.length,
    totalRegions: Number.isFinite(data.totalRegions) ? data.totalRegions : regions.length,
  };
}

/**
 * Fetch the data plans for one country (ISO code) or region (slug). Pass
 * exactly one of `country` / `region`. Results are normalised and sorted.
 *
 * @param {{ country?: string, region?: string, signal?: AbortSignal }} input
 * @returns {Promise<object[]>}
 */
export async function fetchEsimBundles({ country, region, signal } = {}) {
  if (!country && !region) throw new Error('esim bundles: country or region required');
  const params = country ? { country } : { region };
  const res = await nadanadaGet('/esim/bundles', { params, signal });
  // The bundles can arrive directly under `data` as an array, or nested
  // (e.g. `data.bundles`). Tolerate both.
  const data = res?.data ?? res;
  const list = Array.isArray(data) ? data : (Array.isArray(data?.bundles) ? data.bundles : []);
  return sortBundles(list.map(normalizeBundle).filter(Boolean));
}

// ── Purchase flow ─────────────────────────────────────────────────────────────

/**
 * Create a Lightning invoice for a new eSIM. The affiliate refCode is
 * attached automatically.
 *
 * @param {{ bundleName: string, slug: string }} input
 * @returns {Promise<{
 *   checkoutId: string, paymentRequest: string, paymentHash: string,
 *   priceUsd: number|null, originalPriceUsd: number|null, expiresAt: string|null,
 * }>}
 */
export async function purchaseEsim({ bundleName, slug }) {
  if (!bundleName) throw new Error('esim purchase: bundleName required');
  if (!slug) throw new Error('esim purchase: slug required');
  const res = await nadanadaPost('/esim/purchase', withRef({ bundleName, slug }));
  // The live API nests the payload under `data` (like the catalog); tolerate a
  // flat shape too in case it changes.
  const data = res?.data ?? res ?? {};
  if (!data.paymentRequest || !data.paymentHash) {
    throw new Error('esim purchase: server did not return an invoice');
  }
  return {
    checkoutId: data.checkoutId || null,
    paymentRequest: data.paymentRequest,
    paymentHash: data.paymentHash,
    priceUsd: Number.isFinite(data.price) ? data.price : null,
    originalPriceUsd: Number.isFinite(data.originalPrice) ? data.originalPrice : null,
    expiresAt: data.expiresAt || null,
  };
}

/**
 * Normalise a `/esim/complete` success body into an installable record.
 * @returns {{
 *   iccid: string, bundleName: string, orderReference: string,
 *   installation: {
 *     qrCode: string, manualCode: string, smdpAddress: string,
 *     matchingId: string, appleInstallUrl: string, androidInstallUrl: string,
 *   },
 * }}
 */
function normalizeCompletion(data) {
  const inst = data.installationDetails || {};
  return {
    iccid: data.iccid || '',
    bundleName: data.bundleName || '',
    orderReference: data.orderReference || '',
    installation: {
      qrCode: inst.qrCode || '',
      manualCode: inst.manualCode || '',
      smdpAddress: inst.smdpAddress || '',
      matchingId: inst.matchingId || '',
      appleInstallUrl: inst.appleInstallUrl || '',
      androidInstallUrl: inst.androidInstallUrl || '',
    },
  };
}

/**
 * Complete a paid eSIM purchase. Idempotent server-side. Throws with
 * `err.status === 402` while the payment has not settled yet — the poll
 * helper relies on this to know when to keep waiting.
 *
 * @param {{ paymentHash: string, signal?: AbortSignal }} input
 * @returns {Promise<object>} normalised completion
 */
export async function completeEsim({ paymentHash, signal } = {}) {
  if (!paymentHash) throw new Error('esim complete: paymentHash required');
  const res = await nadanadaPost('/esim/complete', { paymentHash }, { signal });
  const data = res?.data ?? res ?? {};
  return normalizeCompletion(data);
}

/**
 * Poll `completeEsim` until the payment settles and the eSIM is provisioned.
 * Backs off between attempts, stops at the invoice `deadline`, bails out on
 * persistent hard errors, and honours an AbortSignal (closing the sheet stops
 * the traffic). HTTP 402 is the documented "not paid yet" signal and simply
 * continues. Completion is idempotent, so re-polling is safe.
 *
 * @param {{ paymentHash: string, signal?: AbortSignal, deadline?: number, maxMs?: number }} input
 *   deadline: epoch ms of the invoice expiry — polling stops once past it.
 * @returns {Promise<{ ok: boolean, esim?: object }>}
 */
export async function waitForEsim({ paymentHash, signal, deadline, maxMs = COMPLETE_POLL_MAX_MS } = {}) {
  if (!paymentHash) throw new Error('esim wait: paymentHash required');
  const esim = await pollWhilePending(
    async (sig) => {
      const e = await completeEsim({ paymentHash, signal: sig });
      return e.iccid ? e : null;
    },
    { signal, deadline, maxMs },
  );
  return esim ? { ok: true, esim } : { ok: false };
}

/**
 * Live status + usage for an installed eSIM (used by "My purchases").
 * @param {string} iccid
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function fetchEsimStatus(iccid, { signal } = {}) {
  if (!iccid) throw new Error('esim status: iccid required');
  const res = await nadanadaGet(`/esim/${encodeURIComponent(iccid)}`, { signal });
  const data = res?.data ?? res ?? {};
  return {
    iccid: data.iccid || iccid,
    profileStatus: data.profileStatus || 'unknown',
    bundleCount: Number.isFinite(data.bundleCount) ? data.bundleCount : 0,
    activeBundleCount: Number.isFinite(data.activeBundleCount) ? data.activeBundleCount : 0,
    usageSummary: data.usageSummary || null,
    bundles: Array.isArray(data.bundles) ? data.bundles : [],
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  };
}
