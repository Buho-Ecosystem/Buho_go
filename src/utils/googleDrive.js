/**
 * Google Drive REST client — just enough surface to put a backup file up,
 * list it, fetch it back, and delete it.
 *
 * We use the `drive.appdata` scope, which gives the app exclusive read/write
 * access to a hidden per-user folder Google calls the "Application Data
 * folder". The user never sees these files in Drive's web UI; they're only
 * reachable through the API by this exact app authenticated against the
 * same Google account. Three consequences flow from that:
 *
 *   1. Every create call must set `parents: ['appDataFolder']` — without it,
 *      Drive places the file in the user's root, which we don't have scope
 *      to write to, and the request 403s.
 *
 *   2. Every list call must scope to `spaces=appDataFolder` — without it,
 *      the list query returns 0 results because the default `spaces=drive`
 *      can't see appdata.
 *
 *   3. Re-installing the app means re-authenticating with the same Google
 *      account. The file persists because Drive owns it by account, not by
 *      OAuth subject — but the new install's tokens need to be issued
 *      fresh before any API call works.
 *
 * All requests go through `authedFetch`, which lazily refreshes the access
 * token via googleOAuth.getAccessToken() and retries once on a 401. That
 * keeps every endpoint here single-purpose and short.
 */

import { getAccessToken } from './googleOAuth.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const BACKUP_MIME = 'application/json';
const BACKUP_FILENAME_PREFIX = 'buhogo-backup';

async function authedFetch(url, init = {}, retry = true) {
  const token = await getAccessToken();
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && retry) {
    // Stale token cached locally; force a re-fetch and try once more. We
    // do NOT auto-retry past the first attempt — repeated 401s mean the
    // refresh token itself was rejected, which the caller needs to know.
    return authedFetch(url, init, false);
  }
  return res;
}

function backupFilename(now = new Date()) {
  // Filename includes an ISO date for human scannability inside Drive UI.
  // Drive permits duplicates so collisions don't matter, but a date prefix
  // means listing them sorted is intuitive.
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${BACKUP_FILENAME_PREFIX}-${stamp}.json`;
}

/**
 * Upload an encrypted backup envelope.
 *
 * @param {object} envelope  Output of encryptBackup() from utils/backupCrypto.
 * @param {object} [opts]
 * @param {string} [opts.filename]  Override the default timestamped name.
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function uploadBackup(envelope, opts = {}) {
  const name = opts.filename || backupFilename();
  const body = JSON.stringify(envelope);

  // Multipart upload: one HTTP request that carries both the metadata and
  // the file contents. Drive's docs label this "multipart" rather than
  // "resumable" — fine for a payload this small (a few hundred bytes).
  const boundary = `buho-${crypto.randomUUID()}`;
  const delim = `--${boundary}`;
  const closeDelim = `--${boundary}--`;

  const metadata = {
    name,
    mimeType: BACKUP_MIME,
    description: 'BuhoGO encrypted wallet backup',
    // appdata scope requires the file land in the hidden Application Data
    // folder explicitly. Without this parent the create request 403s.
    parents: ['appDataFolder'],
  };

  const multipartBody =
    `${delim}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `${delim}\r\n` +
    `Content-Type: ${BACKUP_MIME}\r\n\r\n` +
    `${body}\r\n` +
    `${closeDelim}`;

  const res = await authedFetch(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id,name`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody,
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive upload failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * List BuhoGO backup files the app has access to, most recent first.
 *
 * @returns {Promise<Array<{ id: string, name: string, createdTime: string, size: number|null }>>}
 */
export async function listBackups() {
  // `spaces=appDataFolder` is required for appdata-scoped listing — without
  // it the default `spaces=drive` query returns 0 hits even though the
  // files exist. The `q` filter then keeps the result tight: only JSON
  // files matching our timestamped naming convention, never anything else
  // the app might have written into appdata in a future release.
  const q = encodeURIComponent(
    `mimeType='${BACKUP_MIME}' and name contains '${BACKUP_FILENAME_PREFIX}' and trashed=false`,
  );
  const fields = encodeURIComponent('files(id,name,createdTime,size)');
  const url = `${DRIVE_API}/files?spaces=appDataFolder&q=${q}&orderBy=createdTime desc&pageSize=50&fields=${fields}`;

  const res = await authedFetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive list failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    createdTime: f.createdTime,
    size: f.size ? Number(f.size) : null,
  }));
}

/**
 * Download a backup file's content as the parsed envelope object.
 *
 * @param {string} fileId
 * @returns {Promise<object>}
 */
export async function downloadBackup(fileId) {
  const res = await authedFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive download failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Delete a backup file. Drive moves files to trash by default — we pass
 * the `permanently` query so the file is actually removed: a stale backup
 * still encrypted under an old passphrase should not linger in Trash where
 * it might be restored by accident.
 *
 * @param {string} fileId
 */
export async function deleteBackup(fileId) {
  const res = await authedFetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`Drive delete failed (${res.status}): ${text}`);
  }
}
