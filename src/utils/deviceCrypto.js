/**
 * Device-key based encryption shared across stores.
 *
 * One 256-bit AES-GCM key, generated on first use and persisted in
 * `localStorage` under `buhoGO_device_key`. Every secret we keep on disk
 * (Spark mnemonics, the identity seed, anything added later) is encrypted
 * with this same key — so the device key is the single bootstrap secret
 * the OS keychain would have held if Capacitor exposed one consistently
 * across Web, iOS, and Android.
 *
 * Encryption envelope format: `base64( iv(12 bytes) || ciphertext )`.
 *
 * Originally lived in `src/stores/wallet.js`; extracted so the new identity
 * store can share the same device key without re-implementing the same AES
 * dance. The wallet store now re-exports the helpers for backwards
 * compatibility with call sites that still reference `CryptoUtils`.
 */

const STORAGE_KEY_DEVICE = 'buhoGO_device_key';

/**
 * Get or create the device encryption key. Idempotent.
 */
export async function getDeviceKey() {
  // crypto.subtle only exists in a secure context (HTTPS or localhost).
  // Serving over a LAN IP / plain http:// leaves it undefined, which
  // otherwise surfaces as a cryptic "Cannot read properties of undefined".
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      'Secure context required. Open this app over HTTPS or from localhost. ' +
      'Browsers disable Web Crypto on plain http:// LAN addresses.'
    );
  }

  let keyB64 = localStorage.getItem(STORAGE_KEY_DEVICE);

  if (!keyB64) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    keyB64 = btoa(String.fromCharCode(...raw));
    localStorage.setItem(STORAGE_KEY_DEVICE, keyB64);
  }

  const raw = Uint8Array.from(atob(keyB64), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt an arbitrary plaintext string with the device key.
 * @param {string} plaintext
 * @returns {Promise<string>}  base64-encoded envelope
 */
export async function encryptString(plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getDeviceKey();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );

  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...result));
}

/**
 * Decrypt an envelope produced by `encryptString`.
 * @param {string} envelope  base64-encoded envelope
 * @returns {Promise<string>}
 */
export async function decryptString(envelope) {
  const data = Uint8Array.from(atob(envelope), c => c.charCodeAt(0));
  const iv = data.slice(0, 12);
  const encrypted = data.slice(12);
  const key = await getDeviceKey();

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * One-time migration: re-encrypt a PIN-protected secret to device-key
 * encryption. Kept here so any store that needs to migrate legacy data can
 * reuse the same path.
 *
 * Old envelope: `salt(16) || iv(12) || ciphertext` (PBKDF2-derived key)
 * New envelope: `iv(12) || ciphertext` (device key)
 *
 * @param {string} oldEnvelope - base64-encoded old envelope
 * @param {string} pin         - user's original PIN
 * @returns {Promise<string>}  - new envelope
 */
export async function migrateFromPin(oldEnvelope, pin) {
  const data = Uint8Array.from(atob(oldEnvelope), c => c.charCodeAt(0));
  const salt = data.slice(0, 16);
  const iv = data.slice(16, 28);
  const encrypted = data.slice(28);

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(pin), 'PBKDF2', false, ['deriveKey']
  );
  const oldKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    oldKey,
    encrypted
  );

  const plaintext = new TextDecoder().decode(decrypted);
  return encryptString(plaintext);
}

/**
 * True when an envelope cannot be decrypted with the current device key.
 * Used to detect Spark mnemonics that still use the legacy PIN scheme so
 * the upgrade flow can prompt for the PIN once.
 *
 * @param {string} envelope
 * @returns {Promise<boolean>}
 */
export async function isOldPinFormat(envelope) {
  try {
    await decryptString(envelope);
    return false;
  } catch {
    return true;
  }
}
