/**
 * The kiosk owner PIN, saved as "<salt>:<sha256(salt:pin)>" (hex), so it is
 * never stored or shown in plain text (issue #449). A four-digit PIN can
 * still be found from the hash by trying all 10 000; the hash keeps it off
 * screens and out of readable storage, nothing more. What the PIN guards is
 * leaving the register.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const digest = (salt, pin) => bytesToHex(sha256(utf8ToBytes(`${salt}:${pin}`)));

/** A new salted hash of `pin`. */
export function hashKioskPin(pin, salt = bytesToHex(randomBytes(16))) {
  return `${salt}:${digest(salt, pin)}`;
}

/** Whether `pin` is the PIN behind `stored` (a value from hashKioskPin). */
export function kioskPinMatches(pin, stored) {
  const [salt, hash] = typeof stored === 'string' ? stored.split(':') : [];
  if (!salt || !hash || typeof pin !== 'string' || !pin) return false;
  return digest(salt, pin) === hash;
}

/**
 * The PIN from saved state, as a hash: a PIN saved in plain text by an
 * earlier version is hashed, a hash is kept as it is.
 */
export function savedKioskPinHash({ kioskPinHash, kioskPin } = {}) {
  if (typeof kioskPinHash === 'string' && kioskPinHash) return kioskPinHash;
  if (typeof kioskPin === 'string' && kioskPin) return hashKioskPin(kioskPin);
  return '';
}
