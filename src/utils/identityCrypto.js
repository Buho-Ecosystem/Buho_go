/**
 * BuhoGO Identity — cryptographic primitives.
 *
 * The "identity" is a self-sovereign cryptographic identity backed by a
 * BIP-39 mnemonic. It is independent of any payment wallet (Spark, NWC,
 * LNBits) and exists to provide:
 *
 *   1. LUD-04 (LNURL-auth) signing today — same login at a given domain
 *      regardless of which payment stream is active.
 *   2. A foundation for future NIP-06 Nostr keys, NIP-05 identifiers, and
 *      other identity-derived material — all from the same single seed.
 *
 * The wire-level contract for LUD-04 is fully spec-compliant. See:
 *   - LUD-04: https://github.com/lnurl/luds/blob/luds/04.md
 *   - LUD-05: https://github.com/lnurl/luds/blob/luds/05.md  (derivation)
 *
 * Test vector (from LUD-05) — domain "site.com" must produce path
 *   m/138'/1588488367/2659270754/38110259/4136336762
 * See the unit test in __tests__/identityCrypto.spec.js.
 */

import {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey, HARDENED_OFFSET } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/**
 * Reserved BIP-32 root paths under which different identity-derived material
 * lives. Centralised here so future protocols slot in cleanly without us
 * accidentally colliding with LUD-05's `m/138'/...` namespace.
 */
export const IDENTITY_PATHS = Object.freeze({
  /** LUD-05 reserves the entire `m/138'` subtree for LNURL-auth. */
  LNURL_AUTH_HASHING: "m/138'/0",
  /** NIP-06 reserves `m/44'/1237'/<account>'/0/0` for Nostr keys. */
  NOSTR_ACCOUNT_0: "m/44'/1237'/0'/0/0",
});

// ----------------------------------------------------------------------------
// Mnemonic helpers
// ----------------------------------------------------------------------------

/**
 * Generate a fresh 12-word BIP-39 mnemonic.
 * 128 bits of entropy — the same strength used by the Spark wallet seed.
 */
export function generateIdentityMnemonic() {
  return generateMnemonic(wordlist, 128);
}

/**
 * Validate a BIP-39 mnemonic string. Tolerant to extra whitespace.
 *
 * @param {string} mnemonic
 * @returns {boolean}
 */
export function isValidIdentityMnemonic(mnemonic) {
  if (typeof mnemonic !== 'string') return false;
  const normalised = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalised) return false;
  return validateMnemonic(normalised, wordlist);
}

/**
 * Normalise a mnemonic for storage / hashing. Lowercase, single-spaced,
 * trimmed. Use before any operation that compares two mnemonics or hashes
 * one, so cosmetic variation never produces different keys.
 *
 * @param {string} mnemonic
 * @returns {string}
 */
export function normaliseMnemonic(mnemonic) {
  return mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ----------------------------------------------------------------------------
// LUD-05 derivation
// ----------------------------------------------------------------------------

/**
 * Build the LUD-05 derivation path for a fully qualified domain name.
 *
 * Steps (from LUD-05):
 *   1. hashingKey = derive(seed, m/138'/0)
 *   2. dhash      = HMAC-SHA256(hashingKey, domain)
 *   3. take the first 16 bytes of dhash, interpret as four big-endian uint32s
 *      (long1..long4)
 *   4. linkingKey = derive(seed, m/138'/<long1>/<long2>/<long3>/<long4>)
 *
 * @param {Uint8Array} seed         - BIP-32 master seed (64 bytes)
 * @param {string}     domain       - Fully qualified domain (e.g. "stacker.news")
 * @returns {{
 *   path: string,
 *   indices: [number, number, number, number],
 * }}
 */
export function buildLud05Path(seed, domain) {
  if (!(seed instanceof Uint8Array)) {
    throw new TypeError('seed must be a Uint8Array');
  }
  if (typeof domain !== 'string' || !domain) {
    throw new TypeError('domain must be a non-empty string');
  }

  const root = HDKey.fromMasterSeed(seed);
  const hashingNode = root.derive(IDENTITY_PATHS.LNURL_AUTH_HASHING);
  if (!hashingNode.privateKey) {
    throw new Error('LUD-05 hashing-key derivation produced no private key');
  }

  const dhash = hmac(sha256, hashingNode.privateKey, utf8ToBytes(domain));
  // First 16 bytes, big-endian uint32s per LUD-05's Scala reference.
  const view = new DataView(dhash.buffer, dhash.byteOffset, dhash.byteLength);
  const indices = /** @type {[number, number, number, number]} */ ([
    view.getUint32(0, false),
    view.getUint32(4, false),
    view.getUint32(8, false),
    view.getUint32(12, false),
  ]);

  // LUD-05's `long1..long4` are 32-bit unsigned integers and routinely exceed
  // 2^31, which BIP-32 treats as hardened-derivation indices. We render those
  // steps in path notation as `(n - 2^31)'` so any BIP-32 library accepts
  // them. `deriveLinkingKey` uses `deriveChild()` with the raw uint32, which
  // produces the same key by definition, but we still expose the canonical
  // string form for logs and tests.
  return {
    path: `m/138'/${formatLudIndex(indices[0])}/${formatLudIndex(indices[1])}/${formatLudIndex(indices[2])}/${formatLudIndex(indices[3])}`,
    indices,
  };
}

function formatLudIndex(uint32) {
  return uint32 >= HARDENED_OFFSET ? `${uint32 - HARDENED_OFFSET}'` : `${uint32}`;
}

/**
 * Derive the LUD-04 linking keypair for the given domain.
 *
 * @param {string} mnemonic
 * @param {string} domain
 * @returns {{
 *   privateKey: Uint8Array,
 *   publicKey:  Uint8Array,   // compressed, 33 bytes
 *   path:       string,
 * }}
 */
export function deriveLinkingKey(mnemonic, domain) {
  const normalised = normaliseMnemonic(mnemonic);
  const seed = mnemonicToSeedSync(normalised);
  const { path, indices } = buildLud05Path(seed, domain);

  // Walk the path with deriveChild so the raw uint32s land in BIP-32
  // serialization untouched (`derive("m/138'/<huge-uint32>")` would reject
  // the indices). The result is bitwise identical to writing the hardened
  // form in path string notation — confirmed by tests.
  const root = HDKey.fromMasterSeed(seed);
  let node = root.deriveChild(138 + HARDENED_OFFSET);
  for (const idx of indices) {
    node = node.deriveChild(idx);
  }

  if (!node.privateKey) {
    throw new Error(`Linking-key derivation produced no private key at ${path}`);
  }

  // @scure/bip32 returns a 33-byte compressed pubkey — exactly what LUD-04
  // wants for the `&key=` query parameter.
  return {
    privateKey: node.privateKey,
    publicKey: node.publicKey,
    path,
  };
}

// ----------------------------------------------------------------------------
// Signing
// ----------------------------------------------------------------------------

/**
 * Sign a raw 32-byte LUD-04 challenge (k1) using a derived linking key.
 *
 * LUD-04 specifies signing of the raw k1 bytes (no hash), DER-encoded
 * ECDSA over secp256k1.
 *
 * @param {Uint8Array} k1        - 32 raw bytes of challenge
 * @param {Uint8Array} privateKey - 32-byte linking private key
 * @returns {Uint8Array}         - DER-encoded ECDSA signature
 */
export function signLud04Challenge(k1, privateKey) {
  if (!(k1 instanceof Uint8Array) || k1.length !== 32) {
    throw new TypeError('k1 must be a 32-byte Uint8Array');
  }
  if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32) {
    throw new TypeError('privateKey must be a 32-byte Uint8Array');
  }
  // `prehash: false` because LUD-04 signs the raw 32-byte challenge — k1
  // already IS the message digest. `format: 'der'` matches the spec.
  return secp256k1.sign(k1, privateKey, { format: 'der', prehash: false });
}

// ----------------------------------------------------------------------------
// Fingerprint (for the Identity Profile UI)
// ----------------------------------------------------------------------------

/**
 * A short, stable visual identifier for this identity. Computed from the
 * hashing-key public key (`m/138'/0`), which is constant per seed and never
 * used to log in to any service — perfect for showing in the UI without
 * leaking a per-domain pubkey.
 *
 * @param {string} mnemonic
 * @returns {string}  16 lowercase hex chars
 */
export function computeIdentityFingerprint(mnemonic) {
  const normalised = normaliseMnemonic(mnemonic);
  const seed = mnemonicToSeedSync(normalised);
  const root = HDKey.fromMasterSeed(seed);
  const node = root.derive(IDENTITY_PATHS.LNURL_AUTH_HASHING);
  if (!node.publicKey) {
    throw new Error('Identity fingerprint requires a derivable public key');
  }
  // SHA-256 the compressed pubkey, take 8 bytes → 16 hex chars.
  const digest = sha256(node.publicKey);
  return bytesToHex(digest.slice(0, 8));
}

/**
 * Gradient color pair for the identity avatar.
 *
 * Returns the BuhoGO brand accent gradient on every call so the visual
 * stays consistent with the rest of the app in both dark and light mode.
 * The fingerprint argument is intentionally still accepted (and ignored)
 * to leave room for tasteful per-identity variation later — bumping the
 * implementation alone, without churning every call site.
 *
 * @param {string|null|undefined} _fingerprint  reserved for future use
 * @returns {{ from: string, to: string }}     CSS color strings
 */
export function fingerprintToGradient(_fingerprint) {
  return {
    from: '#15DE72', // BuhoGO primary green
    to:   '#0fb35e', // slightly darker shade so the gradient reads
  };
}

// ----------------------------------------------------------------------------
// Encoding helpers
// ----------------------------------------------------------------------------

/**
 * Convert a Uint8Array to lowercase hex.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Convert a hex string to a Uint8Array. Tolerant to `0x` prefix and
 * mixed case. Throws on odd length or non-hex characters.
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  if (typeof hex !== 'string') throw new TypeError('hex must be a string');
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (stripped.length % 2 !== 0) throw new Error('hex string has odd length');
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`invalid hex at offset ${i * 2}`);
    out[i] = byte;
  }
  return out;
}

function utf8ToBytes(str) {
  return new TextEncoder().encode(str);
}
