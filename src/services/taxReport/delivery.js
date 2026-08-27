/**
 * Getting a finished report out of the app and into the user's hands.
 *
 * Deliberately NOT `utils/share.js`, which every other share in the app uses.
 * That helper deletes its temp file in a `finally` once the share sheet
 * closes — right for a QR image, wrong here. Dismissing the sheet by accident
 * would destroy a document the user waited on and may have no way to
 * regenerate offline. This one writes first and keeps the file, so a
 * cancelled share is a detour rather than a loss, and the caller can say
 * where it went.
 *
 * Where the file goes differs by platform, and getting it wrong fails only on
 * a device:
 *
 *   - On Android, `Directory.Documents` is the PUBLIC Documents folder:
 *     unwritable on Android 10 without legacy external storage and restricted
 *     from 11 onwards. `Cache` is app-scoped, always writable, and is what
 *     Capacitor's FileProvider is able to hand to another app.
 *   - On iOS, `Documents` IS the app's own sandbox, so the file persists and
 *     shows up in the Files app where a user would look for it.
 *
 * Sharing goes through `files:` rather than `url:`. `url` is for sharing a
 * link; `files` is the documented route for a file, and it is what makes
 * Android pass the path through its FileProvider instead of throwing
 * FileUriExposedException.
 */

import { Capacitor } from '@capacitor/core';

/** What we hand out. Keep in step with what the exporters produce. */
export const MIME = Object.freeze({
  csv: 'text/csv',
  xml: 'application/xml',
  pdf: 'application/pdf',
});

/** Filesystem-safe, and still recognisable in a crowded Downloads folder. */
export function safeFilename(name) {
  return String(name || 'report')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
}

/**
 * Base64 without blowing the stack.
 *
 * `btoa(String.fromCharCode(...bytes))` throws on a spread of any real size,
 * and a PDF of a few hundred transactions is comfortably past it, so the
 * bytes are walked in chunks.
 */
function bytesToBase64(bytes) {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function isNative() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Write the report and offer it to the user.
 *
 * @param {object} file
 * @param {string} file.filename         including extension
 * @param {string|Uint8Array} file.data  text for csv/xml, bytes for pdf
 * @param {'csv'|'xml'|'pdf'} file.kind
 * @param {string} [file.title]          shown in the share sheet
 * @returns {Promise<{ saved: boolean, shared: boolean, path?: string }>}
 *   `saved` says the file exists; `shared` says the user was offered it.
 *   A cancelled share is saved-but-not-shared, which is not a failure.
 */
export async function deliverReport({ filename, data, kind, title }) {
  const name = safeFilename(filename);
  const mime = MIME[kind] || 'application/octet-stream';
  const isText = typeof data === 'string';

  // ── Browser: a download is what a browser can actually do ────────────
  if (!isNative()) {
    const blob = isText
      ? new Blob([data], { type: `${mime};charset=utf-8` })
      : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on a later turn: revoking straight away races the download in
    // some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return { saved: true, shared: true };
  }

  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);

  const directory = Capacitor.getPlatform() === 'android'
    ? Directory.Cache
    : Directory.Documents;

  // Written before the share sheet opens, so a dismissed dialog cannot lose
  // the document.
  const { uri } = await Filesystem.writeFile(
    isText
      ? { path: name, data, directory, encoding: Encoding.UTF8, recursive: true }
      : { path: name, data: bytesToBase64(data), directory, recursive: true },
  );

  try {
    await Share.share({ title: title || name, files: [uri], dialogTitle: title || name });
    return { saved: true, shared: true, path: uri };
  } catch {
    // Dismissing the sheet rejects on iOS. The file is on disk either way.
    return { saved: true, shared: false, path: uri };
  }
}
