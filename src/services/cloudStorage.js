/**
 * Cloud storage facade for encrypted wallet backups.
 *
 * The app only ever talks to this module; the platform work lives in the
 * native `CloudBackup` Capacitor plugin (registered in MainActivity). On
 * Android the plugin signs into Google with the drive.appdata scope and
 * moves files in the app's hidden Drive appDataFolder. Encryption happens
 * in utils/backupCrypto BEFORE upload and AFTER download, so the plugin and
 * this facade only ever see the opaque encrypted envelope, never a seed
 * phrase.
 *
 * No OAuth client ID or secret ships in the app: Google identifies the
 * Android app by its package name + APK signing SHA-1, both registered in
 * Google Cloud Console (see docs/CLOUD_BACKUP_SETUP.md). Play Services
 * mints short-lived access tokens on demand, so there is no token for the
 * JS layer to store, refresh, or leak.
 *
 * Two fixed file names, one backup per Drive account: the envelope file is
 * the backup itself, the key file holds the material backupCrypto needs to
 * open it. A new backup always overwrites the previous envelope, never
 * piles up stale copies.
 *
 * Transport errors always reject; a resolved null/absent result only ever
 * means "this file does not exist in the Drive account". The store depends
 * on that distinction to keep "no backup yet" and "could not reach Drive"
 * from ever blurring into each other.
 *
 * Web and iOS have no native implementation and report
 * { available: false }; the UI renders that as "not available on this
 * platform". Availability is never faked with a local stub: a "backup"
 * that silently stays on the device it is meant to protect would be worse
 * than no backup at all.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

const BACKUP_FILE_NAME = 'buhogo-wallet-backup.json';
const KEY_FILE_NAME = 'buhogo-backup-key.json';

const CloudBackup = registerPlugin('CloudBackup');

/**
 * Synchronous platform gate, the single source of truth for "can this
 * build even try". Entry points (Settings row, Welcome restore) use this;
 * isAvailable() below additionally probes the native side.
 */
export function isCloudBackupPlatform() {
  return Capacitor.getPlatform() === 'android';
}

/**
 * Whether cloud backup can work on this platform/build.
 * @returns {Promise<{ available: boolean, reason?: string }>}
 */
export async function isAvailable() {
  if (!isCloudBackupPlatform()) {
    return { available: false, reason: 'platform-not-supported' };
  }
  try {
    return await CloudBackup.isAvailable();
  } catch (err) {
    // Plugin not registered in this binary (e.g. an APK built before the
    // native plugin landed).
    return { available: false, reason: err?.message || 'plugin-missing' };
  }
}

/**
 * Prompt the Google account chooser + Drive consent.
 * @returns {Promise<{ ok: boolean, account?: string, reason?: string }>}
 */
export async function signIn() {
  return CloudBackup.signIn();
}

/** Revoke the Drive grant and forget the account choice. */
export async function signOut() {
  return CloudBackup.signOut();
}

/**
 * Upload an encrypted envelope, overwriting any previous backup.
 * @param {string} envelopeJson  JSON string produced by encryptBackup().
 * @returns {Promise<{ name: string, modifiedAt?: string, size?: number }>}
 *          Metadata of the file as written, from the upload response.
 */
export async function uploadBackup(envelopeJson) {
  const res = await CloudBackup.uploadBackup({
    fileName: BACKUP_FILE_NAME,
    content: envelopeJson,
  });
  if (!res?.ok) {
    throw new Error(res?.reason || 'upload-failed');
  }
  return res;
}

/**
 * Download the backup envelope.
 * @returns {Promise<string|null>}  The envelope JSON, or null when no
 *                                  backup exists in this Drive account.
 *                                  Rejects on any transport/auth failure.
 */
export async function downloadBackup() {
  const res = await CloudBackup.downloadBackup({ fileName: BACKUP_FILE_NAME });
  return res?.content || null;
}

/** Upload the backup key file. @param {string} keyJson */
export async function uploadBackupKey(keyJson) {
  const res = await CloudBackup.uploadBackup({
    fileName: KEY_FILE_NAME,
    content: keyJson,
  });
  if (!res?.ok) {
    throw new Error(res?.reason || 'upload-failed');
  }
  return res;
}

/**
 * Download the backup key file.
 * @returns {Promise<string|null>}  null when none exists; rejects on failure.
 */
export async function downloadBackupKey() {
  const res = await CloudBackup.downloadBackup({ fileName: KEY_FILE_NAME });
  return res?.content || null;
}

/**
 * Metadata of the canonical backup file, or null when none exists.
 * Rejects with "auth-required" when the user needs to (re-)sign in — the
 * store uses that as its signed-in probe.
 * @returns {Promise<{ name: string, modifiedAt: string, size: number }|null>}
 */
export async function getRemoteBackupInfo() {
  const { files = [] } = await CloudBackup.listBackups();
  return files.find((f) => f.name === BACKUP_FILE_NAME) || null;
}

/** Delete the backup and its key file. Resolves ok even when none exists. */
export async function deleteBackup() {
  const res = await CloudBackup.deleteBackup({ fileName: BACKUP_FILE_NAME });
  if (res && res.ok === false) {
    throw new Error(res.reason || 'delete-failed');
  }
  const keyRes = await CloudBackup.deleteBackup({ fileName: KEY_FILE_NAME });
  if (keyRes && keyRes.ok === false) {
    throw new Error(keyRes.reason || 'delete-failed');
  }
}
