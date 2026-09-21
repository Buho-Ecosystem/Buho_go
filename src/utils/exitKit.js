/**
 * Pure helpers for the emergency exit kit: what it is called on disk, how
 * a kit that leaves the device is protected, and how its state reads.
 *
 * A kit is exit data, not keys: it carries no spending authority, but it
 * discloses balance and payment history, so it is encrypted before it
 * leaves the device. The key comes from the recovery words themselves,
 * because the words are the only thing a kit is ever useful together with.
 */

import { mnemonicToSeedSync } from '@scure/bip39';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const KIT_FILE_VERSION = 1;
const KIT_KEY_LABEL = 'BuhoGO emergency exit kit v1';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Passphrase for a kit file: an HMAC of the BIP-39 seed, never the words. */
export function deriveKitPassphrase(mnemonic) {
  const seed = mnemonicToSeedSync(mnemonic);
  return bytesToHex(hmac(sha256, seed, new TextEncoder().encode(KIT_KEY_LABEL)));
}

export function kitFilename(walletName, at = Date.now()) {
  const day = new Date(at).toISOString().slice(0, 10);
  const name = String(walletName || 'spark').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'spark';
  return `buhogo-exit-kit-${name}-${day}.json`;
}

/** The plaintext payload a kit file carries before encryption. */
export function kitFilePayload({ sparkAddress, network, accountNumber, exitState, exportedAt, walletName }) {
  return { v: KIT_FILE_VERSION, kind: 'spark-exit-kit', sparkAddress, network, accountNumber, walletName, exportedAt, exitState };
}

export function toExitNetwork(walletNetwork) {
  return String(walletNetwork || 'MAINNET').toUpperCase() === 'REGTEST' ? 'regtest' : 'mainnet';
}

/**
 * One of: 'none' (never exported), 'failed' (refresh failing since a date),
 * 'checked' (kit fresh and quoted), 'saved' (exported but not quoted yet).
 */
export function kitState(meta) {
  if (!meta || !meta.exportedAt) return 'none';
  if (meta.failedSince) return 'failed';
  if (meta.checkedAt) return 'checked';
  return 'saved';
}

/** Where copies of the kit exist, oldest first is irrelevant: the newest of each place. */
export function kitCopies(meta) {
  const copies = [];
  if (meta?.exportedAt) copies.push('phone');
  if (meta?.driveAt && meta.driveAt >= (meta.exportedAt || 0) - DAY_MS) copies.push('drive');
  if (meta?.sharedAt) copies.push('file');
  return copies;
}

export function isSameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}
