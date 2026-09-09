/**
 * nadanada eSIM service — catalog browsing, purchase, top-up, and status.
 *
 * Purchase is a three-step pay-then-fulfill handshake:
 *   1. purchaseEsim()  -> BOLT11 invoice + paymentHash + checkoutId
 *   2. caller pays the invoice from the internal wallet
 *   3. waitForEsim()   -> polls completeEsim() until the payment settles,
 *                          returning the installable eSIM (ICCID + QR)
 *
 * Top-up follows exactly the same shape against /esim/{iccid}/purchase and
 * /esim/{iccid}/complete, so an eSIM that runs out of data never has to be
 * replaced with a new one.
 *
 * Both completion endpoints accept EITHER the `paymentHash` (Lightning) or
 * the `checkoutId` (any payment method) and are documented as safe to call
 * repeatedly for the same order. That idempotency is what makes recovery
 * possible: as long as one of those keys survives, a paid order can still be
 * redeemed. Persist them before paying (see ./orders.js).
 *
 * Pure module — normalisers shield the UI from the raw API shape. Verified
 * against the live v2 endpoints (see ./client.js for the contract).
 */

import {
  nadanadaGet, nadanadaPost, withRef, pollWhilePending, assertNativePurchase,
} from './client.js';

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
 * Normalise a bundle from `/esim/bundles`.
 * Raw: { name, description, dataInGB, durationInDays, countryName, price, unlimited, speed[], roamingEnabled[] }
 *
 * `bundleName` is sent to the purchase endpoint verbatim. nadanada documents
 * the catalog name (`fixed_1GB_7D_DE`) as the canonical input and resolves it
 * to the consumption-based provider SKU itself, echoing the result back as
 * `providerBundleName`. Earlier builds rewrote it to an invented
 * `esim_<plan>_V2` form; that shape appears nowhere in their spec and only
 * worked because their resolver is forgiving, so it is gone.
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
    bundleName: rawName,
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

/** Shape a `/purchase` response into the invoice record we persist. */
function normalizeInvoice(data, extra = {}) {
  if (!data.paymentRequest || !data.paymentHash) {
    throw new Error('esim purchase: server did not return an invoice');
  }
  return {
    checkoutId: data.checkoutId || null,
    paymentRequest: data.paymentRequest,
    paymentHash: data.paymentHash,
    priceUsd: Number.isFinite(data.price) ? data.price : null,
    originalPriceUsd: Number.isFinite(data.originalPrice) ? data.originalPrice : null,
    providerBundleName: data.providerBundleName || null,
    expiresAt: data.expiresAt || null,
    ...extra,
  };
}

/**
 * Create a Lightning invoice for a new eSIM. The affiliate refCode is
 * attached automatically.
 *
 * @param {{ bundleName: string, slug: string }} input
 * @returns {Promise<object>} invoice record (see normalizeInvoice)
 */
export async function purchaseEsim({ bundleName, slug }) {
  assertNativePurchase();
  if (!bundleName) throw new Error('esim purchase: bundleName required');
  if (!slug) throw new Error('esim purchase: slug required');
  const res = await nadanadaPost('/esim/purchase', withRef({ bundleName, slug }));
  // The live API nests the payload under `data` (like the catalog); tolerate a
  // flat shape too in case it changes.
  return normalizeInvoice(res?.data ?? res ?? {});
}

/**
 * Create a Lightning invoice to top an existing eSIM up with another bundle.
 * Same body as a new purchase, addressed to the ICCID.
 *
 * @param {{ iccid: string, bundleName: string, slug: string }} input
 */
export async function purchaseEsimTopup({ iccid, bundleName, slug }) {
  assertNativePurchase();
  if (!iccid) throw new Error('esim topup: iccid required');
  if (!bundleName) throw new Error('esim topup: bundleName required');
  if (!slug) throw new Error('esim topup: slug required');
  const res = await nadanadaPost(
    `/esim/${encodeURIComponent(iccid)}/purchase`,
    withRef({ bundleName, slug }),
  );
  const data = res?.data ?? res ?? {};
  // The server echoes the ICCID it bound the checkout to; trust that over the
  // one we sent, so the complete call can never address the wrong eSIM.
  return normalizeInvoice(data, { iccid: data.iccid || iccid });
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

/** Body for a complete call: prefer the payment hash, fall back to checkoutId. */
function redemptionBody({ paymentHash, checkoutId }) {
  if (!paymentHash && !checkoutId) {
    throw new Error('esim complete: paymentHash or checkoutId required');
  }
  return paymentHash ? { paymentHash } : { checkoutId };
}

/**
 * Complete a paid eSIM purchase. Idempotent server-side. Throws a fatal
 * NadanadaError on 404 (no such checkout session) and a pending one with
 * `status === 402` until the payment settles — the poll helper relies on that
 * distinction to know when to keep waiting and when to stop.
 *
 * @param {{ paymentHash?: string, checkoutId?: string, signal?: AbortSignal }} input
 * @returns {Promise<object>} normalised completion
 */
export async function completeEsim({ paymentHash, checkoutId, signal } = {}) {
  const res = await nadanadaPost(
    '/esim/complete',
    redemptionBody({ paymentHash, checkoutId }),
    { signal },
  );
  return normalizeCompletion(res?.data ?? res ?? {});
}

/**
 * Complete a paid top-up. Also idempotent. Returns `{ iccid, bundleName,
 * toppedUp }` rather than installation details — the eSIM is already
 * installed; only its allowance changed.
 *
 * @param {{ iccid: string, paymentHash?: string, checkoutId?: string, signal?: AbortSignal }} input
 */
export async function completeEsimTopup({ iccid, paymentHash, checkoutId, signal } = {}) {
  if (!iccid) throw new Error('esim topup complete: iccid required');
  const res = await nadanadaPost(
    `/esim/${encodeURIComponent(iccid)}/complete`,
    redemptionBody({ paymentHash, checkoutId }),
    { signal },
  );
  const data = res?.data ?? res ?? {};
  return {
    iccid: data.iccid || iccid,
    bundleName: data.bundleName || '',
    toppedUp: data.toppedUp === true,
  };
}

/**
 * Poll `completeEsim` until the payment settles and the eSIM is provisioned.
 * Backs off between attempts, stops at the invoice `deadline`, always settles
 * within `maxMs`, and honours an AbortSignal (closing the sheet stops the
 * traffic). Completion is idempotent, so re-polling is safe.
 *
 * Resolves `{ ok: false }` when the payment simply has not landed yet, and
 * `{ ok: false, fatal: true, ... }` when the order can never complete — the
 * caller must show those two states differently.
 *
 * @param {{ paymentHash?: string, checkoutId?: string, signal?: AbortSignal, deadline?: number, maxMs?: number }} input
 * @returns {Promise<{ ok: boolean, esim?: object, fatal?: boolean, error?: string, code?: string }>}
 */
export async function waitForEsim({
  paymentHash, checkoutId, signal, deadline, maxMs = COMPLETE_POLL_MAX_MS,
} = {}) {
  if (!paymentHash && !checkoutId) throw new Error('esim wait: paymentHash or checkoutId required');
  try {
    const esim = await pollWhilePending(
      async (sig) => {
        const e = await completeEsim({ paymentHash, checkoutId, signal: sig });
        return e.iccid ? e : null;
      },
      { signal, deadline, maxMs },
    );
    return esim ? { ok: true, esim } : { ok: false };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    if (err?.fatal) return { ok: false, fatal: true, error: err.message, code: err.code || null };
    throw err;
  }
}

/**
 * Poll `completeEsimTopup` until the top-up applies. Same three-outcome
 * contract as waitForEsim.
 *
 * @param {{ iccid: string, paymentHash?: string, checkoutId?: string, signal?: AbortSignal, deadline?: number, maxMs?: number }} input
 * @returns {Promise<{ ok: boolean, topup?: object, fatal?: boolean, error?: string, code?: string }>}
 */
export async function waitForEsimTopup({
  iccid, paymentHash, checkoutId, signal, deadline, maxMs = COMPLETE_POLL_MAX_MS,
} = {}) {
  if (!iccid) throw new Error('esim topup wait: iccid required');
  if (!paymentHash && !checkoutId) throw new Error('esim topup wait: paymentHash or checkoutId required');
  try {
    const topup = await pollWhilePending(
      async (sig) => {
        const t = await completeEsimTopup({ iccid, paymentHash, checkoutId, signal: sig });
        return t.toppedUp ? t : null;
      },
      { signal, deadline, maxMs },
    );
    return topup ? { ok: true, topup } : { ok: false };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    if (err?.fatal) return { ok: false, fatal: true, error: err.message, code: err.code || null };
    throw err;
  }
}

// ── Live status ──────────────────────────────────────────────────────────────

/**
 * The data allowance a bundle name or description declares, in bytes.
 * `esimc_1GB_7D_DE_V2` / "eSIM, 1GB, 7 Days, Germany" -> 1000000000.
 *
 * @returns {number|null} bytes, or null when nothing parseable is declared
 */
export function declaredBundleBytes(nameOrDescription) {
  const m = /(\d+(?:\.\d+)?)\s*(GB|MB)/i.exec(String(nameOrDescription || ''));
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return m[2].toUpperCase() === 'GB' ? value * 1e9 : value * 1e6;
}

/**
 * Decide whether a usage block's opaque `provider_units` may be shown as bytes.
 *
 * nadanada names the unit `provider_units` and documents no meaning for it, so
 * we never assume. Instead we check the provider's own arithmetic: a bundle
 * that calls itself 1GB and reports an initial quantity of 1000000000 has told
 * us what the unit is. Only on that agreement do we put a data figure on
 * screen; otherwise the percentage carries the meaning on its own.
 *
 * @param {object|null} usage — a normalised usage block
 * @param {string} label — the bundle name or description to cross-check against
 * @returns {boolean}
 */
export function unitsAreBytes(usage, label) {
  const declared = declaredBundleBytes(label);
  if (!declared || !Number.isFinite(usage?.initial) || usage.initial <= 0) return false;
  return Math.abs(usage.initial - declared) / declared < 0.02;
}

/** Normalise one usage block. `unit` is the provider's own unit
 *  (`provider_units`), NOT megabytes — never relabel it. `percent` is what the
 *  UI leads with, because it is unit-free. */
function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const initial = Number.isFinite(raw.totalInitialQuantity) ? raw.totalInitialQuantity : null;
  const remaining = Number.isFinite(raw.totalRemainingQuantity) ? raw.totalRemainingQuantity : null;
  const used = Number.isFinite(raw.totalUsedQuantity) ? raw.totalUsedQuantity : null;
  let percent = Number.isFinite(raw.usagePercent) ? raw.usagePercent : null;
  if (percent == null && Number.isFinite(initial) && initial > 0 && Number.isFinite(used)) {
    percent = (used / initial) * 100;
  }
  if (percent != null) percent = Math.min(100, Math.max(0, percent));
  return {
    unit: typeof raw.unit === 'string' ? raw.unit : '',
    initial,
    remaining,
    used,
    percent,
  };
}

/** Pick the most relevant assignment window from a bundle: the active one if
 *  there is one, else the latest by end time. */
function pickWindow(assignments) {
  const list = Array.isArray(assignments) ? assignments : [];
  if (!list.length) return { startTime: null, endTime: null, unlimited: false };
  const scored = list
    .map((a) => ({
      startTime: a?.startTime || null,
      endTime: a?.endTime || null,
      unlimited: a?.unlimited === true,
      end: a?.endTime ? Date.parse(a.endTime) : NaN,
    }))
    .sort((a, b) => (Number.isFinite(b.end) ? b.end : -Infinity) - (Number.isFinite(a.end) ? a.end : -Infinity));
  const now = Date.now();
  const live = scored.find((a) => Number.isFinite(a.end) && a.end > now);
  const pick = live || scored[0];
  return { startTime: pick.startTime, endTime: pick.endTime, unlimited: pick.unlimited };
}

/**
 * Live status + usage for an installed eSIM (used by "Your products").
 *
 * @param {string} iccid
 * @param {{ signal?: AbortSignal }} [opts]
 */
export async function fetchEsimStatus(iccid, { signal } = {}) {
  if (!iccid) throw new Error('esim status: iccid required');
  const res = await nadanadaGet(`/esim/${encodeURIComponent(iccid)}`, { signal });
  const data = res?.data ?? res ?? {};
  const bundles = (Array.isArray(data.bundles) ? data.bundles : []).map((b) => {
    const usage = normalizeUsage(b?.usage);
    const label = `${b?.name || ''} ${b?.description || ''}`;
    return {
      name: b?.name || '',
      description: b?.description || '',
      active: b?.active === true,
      usage: usage ? { ...usage, isBytes: unitsAreBytes(usage, label) } : null,
      ...pickWindow(b?.assignments),
    };
  });

  // The account-level summary only counts as bytes when every bundle feeding it
  // agreed, and the totals actually add up. One unrecognised bundle and we fall
  // back to percentages rather than mislabel the whole allowance.
  const summary = normalizeUsage(data.usageSummary);
  const everyBundleInBytes = bundles.length > 0 && bundles.every((b) => b.usage?.isBytes);
  const bundleTotal = bundles.reduce((n, b) => n + (b.usage?.initial || 0), 0);
  const summaryIsBytes = everyBundleInBytes
    && Number.isFinite(summary?.initial)
    && summary.initial > 0
    && Math.abs(summary.initial - bundleTotal) / summary.initial < 0.02;
  return {
    iccid: data.iccid || iccid,
    profileStatus: data.profileStatus || '',
    firstInstalledAt: data.firstInstalledAt || null,
    bundleCount: Number.isFinite(data.bundleCount) ? data.bundleCount : bundles.length,
    activeBundleCount: Number.isFinite(data.activeBundleCount) ? data.activeBundleCount : 0,
    usage: summary ? { ...summary, isBytes: summaryIsBytes } : null,
    bundles,
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  };
}

/**
 * Reduce an eSIM status to the one line the product card leads with.
 *
 * Deliberately derived only from fields whose meaning is documented: the
 * active-bundle count and the assignment time windows. `profileStatus` is a
 * provider enum whose values are not specified anywhere in nadanada's spec,
 * so it is never shown to a user or used to decide state.
 *
 * @param {object|null} status — from fetchEsimStatus
 * @param {number} [now] — epoch ms, injectable for tests
 * @returns {{ state, endsAt, startsAt, daysLeft, percent, bytesUsed, bytesTotal }}
 *   bytesUsed/bytesTotal are non-null ONLY when the provider's own figures
 *   confirmed the unit (see unitsAreBytes).
 */
export function deriveEsimState(status, now = Date.now()) {
  const out = {
    state: 'unknown', endsAt: null, startsAt: null, daysLeft: null,
    percent: null, bytesUsed: null, bytesTotal: null,
  };
  if (!status) return out;
  out.percent = status.usage?.percent ?? null;
  if (status.usage?.isBytes) {
    out.bytesUsed = Number.isFinite(status.usage.used) ? status.usage.used : null;
    out.bytesTotal = Number.isFinite(status.usage.initial) ? status.usage.initial : null;
  }

  const windows = (status.bundles || []).filter((b) => b.startTime || b.endTime);
  const current = windows.find((b) => {
    const s = b.startTime ? Date.parse(b.startTime) : -Infinity;
    const e = b.endTime ? Date.parse(b.endTime) : Infinity;
    return s <= now && now < e;
  });
  const upcoming = windows.find((b) => b.startTime && Date.parse(b.startTime) > now);
  const pick = current || upcoming || windows[0] || null;

  if (pick) {
    out.startsAt = pick.startTime || null;
    out.endsAt = pick.endTime || null;
    const end = pick.endTime ? Date.parse(pick.endTime) : NaN;
    if (Number.isFinite(end)) out.daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
  }

  if (current || status.activeBundleCount > 0) out.state = 'active';
  else if (upcoming) out.state = 'upcoming';
  else if (pick?.endTime && Date.parse(pick.endTime) <= now) out.state = 'expired';
  return out;
}
