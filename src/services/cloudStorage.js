/**
 * Cloud storage facade for encrypted wallet backups.
 *
 * The app only ever talks to this module; the platform work lives in the
 * native `CloudBackup` Capacitor plugin (registered in MainActivity). On
 * Android the plugin signs into Google with the drive.appdata scope and
 * moves files in the app's hidden Drive appDataFolder. Encryption happens
 * in utils/backupCrypto BEFORE upload and AFTER download, so the plugin and
 * this facade only ever see the opaque encrypted envelope, never a seed
 * phrase or passphrase.
 *
 * No OAuth client ID or secret ships in the app: Google identifies the
 * Android app by its package name + APK signing SHA-1, both registered in
 * Google Cloud Console (see docs/CLOUD_BACKUP_SETUP.md). Play Services
 * mints short-lived access tokens on demand, so there is no token for the
 * JS layer to store, refresh, or leak.
 *
 * The backup file name is fixed so a new backup always overwrites the
 * previous one - one canonical file per Drive account, never a pile of
 * stale copies.
 *
 * Web and iOS have no native implementation and report
 * { available: false }; the UI renders that as "not available on this
 * platform". Availability is never faked with a local stub: a "backup"
 * that silently stays on the device it is meant to protect would be worse
 * than no backup at all.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

const BACKUP_FILE_NAME = 'buhogo-wallet-backup.json';

const CloudBackup = registerPlugin('CloudBackup');

/** Human label for where backups live. Android-only feature today. */
export function providerName() {
  return 'Google Drive';
}

/**
 * Whether cloud backup can work on this platform/build.
 * @returns {Promise<{ available: boolean, reason?: string }>}
 */
export async function isAvailable() {
  if (Capacitor.getPlatform() !== 'android') {
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
 */
export async function downloadBackup() {
  const res = await CloudBackup.downloadBackup({ fileName: BACKUP_FILE_NAME });
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

/** Delete the backup file. Resolves ok even when none exists. */
export async function deleteBackup() {
  return CloudBackup.deleteBackup({ fileName: BACKUP_FILE_NAME });
}

export const BACKUP_FILE = BACKUP_FILE_NAME;
