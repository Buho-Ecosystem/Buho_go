/**
 * NIP-05 service — register a BuhoGO identity's Nostr pubkey under a
 * `name@mybuho.de` handle, via the LNbits `nostrnip5` extension.
 *
 * We use the extension's *public* (keyless) signup endpoint with the
 * free-tier naming convention: a local-part ending in `.` + exactly six
 * digits (`is_free_identifier`) is created active and free, with no payment
 * and no API key. The six digits double as automatic collision resolution.
 *
 * This module is intentionally pure — no store/Pinia imports — so it can be
 * unit-tested and called from the boot orchestrator. The cross-store wiring
 * (persisting the handle, seeding the profile field) lives in `boot/nip05.js`.
 *
 * Endpoint + response shape verified against the live extension:
 *   POST {BASE}/nostrnip5/api/v1/public/domain/{DOMAIN_ID}/address
 *   body  { domain_id, local_part, pubkey, create_invoice:false }
 *   201   { local_part, pubkey, active:true, is_free:true, rotation_secret, … }
 */

// ── Config (mybuho.de domain on the timecatcher LNbits instance) ────────────
export const NIP05_DOMAIN = 'mybuho.de';
const LNBITS_BASE = 'https://timecatcher.lnbits.de';
const DOMAIN_ID = 'ANpwyDeLkZFG5kS8Y9v8bA';

// Free-tier handles must be `<base>.<6 digits>`; keep the base short and safe.
const BASE_MAX = 20;
const REGISTER_ATTEMPTS = 4; // retries with a fresh suffix on collision/error
const REQUEST_TIMEOUT_MS = 12000;

/** Full `name@mybuho.de` address for a stored local-part. */
export function nip05AddressFor(localPart) {
  return localPart ? `${localPart}@${NIP05_DOMAIN}` : null;
}

/**
 * Derive the base (suffix-less) local-part for a new handle. Prefers a slug
 * of the user's profile name; falls back to an npub-derived slug so every
 * identity can get a handle even before a profile name is set.
 *
 * Output is `[a-z0-9]`, ≤ 20 chars — the lowest-common-denominator that any
 * NIP-05 server accepts. The `.NNNNNN` free suffix is appended at register
 * time, not here.
 *
 * @param {{ name?: string, npub?: string }} input
 * @returns {string}
 */
export function deriveBaseSlug({ name, npub } = {}) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, BASE_MAX);
  if (slug.length >= 2) return slug;

  // Fallback: `buho` + a stable chunk of the npub's bech32 body. npub is
  // `npub1<data>`; chars after the `npub1` prefix are [a-z0-9].
  const tail = String(npub || '').replace(/^npub1/, '').slice(0, 8);
  return `buho${tail}` || 'buho';
}

/** Random 6-digit string (zero-padded) — the free-identifier marker. */
function freeSuffix() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

async function postAddress(localPart, pubkeyHex) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${LNBITS_BASE}/nostrnip5/api/v1/public/domain/${DOMAIN_ID}/address`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain_id: DOMAIN_ID,
          local_part: localPart,
          pubkey: pubkeyHex,
          create_invoice: false,
        }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      const err = new Error(`nip05 register failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Register a free `<baseSlug>.<6 digits>@mybuho.de` handle for the given
 * pubkey. Retries with a fresh suffix if the name is taken (or a transient
 * error occurs), then gives up.
 *
 * @param {{ baseSlug: string, pubkeyHex: string }} input
 * @returns {Promise<{ handle: string, rotationSecret: string|null, addressId: string|null }>}
 * @throws if every attempt fails (caller treats as "retry next launch").
 */
export async function registerFreeHandle({ baseSlug, pubkeyHex }) {
  if (!pubkeyHex) throw new Error('nip05 register: pubkey required');
  const base = baseSlug || 'buho';

  let lastErr;
  for (let attempt = 0; attempt < REGISTER_ATTEMPTS; attempt++) {
    const localPart = `${base}.${freeSuffix()}`;
    try {
      const data = await postAddress(localPart, pubkeyHex);
      return {
        handle: data.local_part || localPart,
        rotationSecret: data.rotation_secret || null,
        addressId: data.id || null,
      };
    } catch (err) {
      lastErr = err;
      // A 409/400 is almost always a suffix collision — retry with a new one.
      // Any other failure also retries (cheap) before we finally surface it.
    }
  }
  throw lastErr || new Error('nip05 register: exhausted attempts');
}
