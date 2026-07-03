/**
 * Cloud backup encryption.
 *
 * Goal: produce a self-contained, portable, password-encrypted blob that
 * can sit on Google Drive without exposing the seed phrase even if the
 * Drive account itself is compromised. The blob carries every parameter
 * a future client needs to decrypt it, so the wallet never has to keep
 * decryption state in sync with the cloud copy.
 *
 * Format (JSON, UTF-8):
 *   {
 *     v: 1,                              // envelope version
 *     app: 'BuhoGO',
 *     kdf: 'PBKDF2-SHA256',
 *     iterations: 250000,                // OWASP 2023 floor for PBKDF2-SHA256
 *     salt: <base64 16 bytes>,
 *     cipher: 'AES-GCM',
 *     iv: <base64 12 bytes>,
 *     ct: <base64 ciphertext || authTag>,
 *     createdAt: <ISO timestamp>,
 *     hint: <optional user-supplied passphrase hint>
 *   }
 *
 * Plaintext is the *JSON-encoded payload object* (e.g. { seed, identitySeed, … }),
 * not just the raw mnemonic string. This lets us add fields to a backup in a
 * later version without changing the envelope.
 *
 * Why this scheme:
 *   - PBKDF2-SHA256 is everywhere (Web Crypto, mobile native, browser
 *     extensions), so a user can recover a backup with any modern client.
 *     scrypt/argon2id would be stronger, but Web Crypto doesn't ship them,
 *     and a wallet recovery file should not depend on a polyfill.
 *   - 250 000 iterations comes from OWASP's PBKDF2-SHA256 recommendation
 *     and is what 1Password / Bitwarden use today. On a mid-range phone
 *     it's ~250 ms — slow enough to make passphrase brute force costly,
 *     fast enough that the restore flow doesn't feel broken.
 *   - AES-GCM gives confidentiality + integrity in one primitive; tampering
 *     surfaces as a decrypt failure, which the restore UI maps to "wrong
 *     passphrase or corrupted backup" without distinguishing the two.
 */

const BACKUP_VERSION = 1;
const KDF_ITERATIONS = 250000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH_BITS = 256;

function assertSecureContext() {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      'Secure context required for backup encryption. Web Crypto is not available here.'
    );
  }
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt, iterations) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    baseKey,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt an arbitrary JSON-serialisable payload under a passphrase.
 *
 * @param {object} payload          What to back up (e.g. { seed, identitySeed }).
 * @param {string} passphrase       User-chosen passphrase. Caller is
 *                                  responsible for strength checks; we apply
 *                                  no minimum here so test fixtures can
 *                                  exercise the format without leaking
 *                                  policy details into the crypto layer.
 * @param {object} [opts]
 * @param {string} [opts.hint]      Optional human-readable hint stored in
 *                                  the envelope (cleartext). Surfaces in the
 *                                  Drive UI before restore to remind the user
 *                                  which passphrase this file uses.
 * @returns {Promise<object>}       Envelope object ready for JSON.stringify.
 */
export async function encryptBackup(payload, passphrase, opts = {}) {
  assertSecureContext();
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('Passphrase is required');
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  );

  const envelope = {
    v: BACKUP_VERSION,
    app: 'BuhoGO',
    kdf: 'PBKDF2-SHA256',
    iterations: KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    cipher: 'AES-GCM',
    iv: bytesToBase64(iv),
    ct: bytesToBase64(ciphertext),
    createdAt: new Date().toISOString(),
  };
  if (opts.hint && typeof opts.hint === 'string') {
    envelope.hint = opts.hint.slice(0, 200);
  }
  return envelope;
}

/**
 * Decrypt a backup envelope back into its original payload.
 *
 * Throws a `WrongPassphraseError` for any failure that's indistinguishable
 * from "the passphrase was wrong" — including tampered ciphertext. The
 * caller can map that one error class to a single user-facing message
 * without leaking which specific check failed.
 *
 * @param {object|string} envelope  Either the parsed envelope object or its
 *                                  JSON string form (as fetched from Drive).
 * @param {string} passphrase
 * @returns {Promise<object>}       The original payload.
 */
export async function decryptBackup(envelope, passphrase) {
  assertSecureContext();

  const env = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
  if (!env || typeof env !== 'object') {
    throw new InvalidBackupError('Backup file is not a valid envelope');
  }
  if (env.v !== BACKUP_VERSION) {
    throw new InvalidBackupError(`Unsupported backup version: ${env.v}`);
  }
  if (env.kdf !== 'PBKDF2-SHA256' || env.cipher !== 'AES-GCM') {
    throw new InvalidBackupError('Unsupported backup algorithm');
  }

  const salt = base64ToBytes(env.salt);
  const iv = base64ToBytes(env.iv);
  const ct = base64ToBytes(env.ct);
  const iterations = Number(env.iterations) || KDF_ITERATIONS;

  const key = await deriveKey(passphrase, salt, iterations);

  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch {
    // GCM auth failure: passphrase wrong OR ciphertext modified. We
    // intentionally collapse both into one error so the UI doesn't have to
    // distinguish — and so we don't accidentally signal which case it was
    // to a passphrase-guessing attacker.
    throw new WrongPassphraseError();
  }

  try {
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new InvalidBackupError('Decrypted payload is not valid JSON');
  }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase or backup file was modified');
    this.name = 'WrongPassphraseError';
    this.code = 'WRONG_PASSPHRASE';
  }
}

export class InvalidBackupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidBackupError';
    this.code = 'INVALID_BACKUP';
  }
}

export const BACKUP_FORMAT = Object.freeze({
  VERSION: BACKUP_VERSION,
  ITERATIONS: KDF_ITERATIONS,
});
