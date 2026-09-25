/**
 * Getting a file the app made out of the app: saving it where the user
 * chooses, or handing it to another app.
 *
 * Two separate actions, because they answer different questions. SAVE is
 * "keep this on my device": the system's own save dialog, where the user
 * picks the folder and sees the name. SHARE is "send this somewhere": the
 * system share sheet. Folding one into the other left users of phones with no
 * cloud storage app (GrapheneOS without Google services, for one) with no
 * way to keep the file at all.
 *
 * SAVE, per platform:
 *
 *   - Android: the in-repo FileExport plugin opens the Storage Access
 *     Framework's "create document" dialog. It needs no storage permission on
 *     any Android version, and it is served by the platform's own DocumentsUI,
 *     not Google Play services, so it behaves the same on GrapheneOS.
 *   - iOS: the same plugin presents the system export dialog
 *     (UIDocumentPickerViewController), which saves into Files: On My iPhone,
 *     iCloud Drive or any installed file provider.
 *   - Browser: a normal download.
 *
 * SHARE writes the file to the app's cache first, because the share sheet on
 * both platforms takes a file URL, not bytes. The cache is app-private, needs
 * no permission, and is the location the app's FileProvider exposes on
 * Android. Files there are replaced by the next export of the same name and
 * otherwise left to the OS to clear: deleting straight after the share sheet
 * closes can pull the file out from under an app still reading it.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

const FileExport = registerPlugin('FileExport');

/** Media types for the files the app hands out. */
export const MIME = Object.freeze({
  csv: 'text/csv',
  xml: 'application/xml',
  pdf: 'application/pdf',
  json: 'application/json',
});

/** The share plugin rejects with this message on both platforms when the user closes the sheet. */
const SHARE_CANCELED = 'Share canceled';

/** Filesystem-safe, and still recognisable in a crowded Downloads folder. */
export function safeFilename(name) {
  return String(name || 'file')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
}

function isNative() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Text is written as UTF-8. Bytes are written as they are. */
function toBytes(data) {
  return typeof data === 'string' ? new TextEncoder().encode(data) : data;
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

function browserDownload(name, bytes, mimeType) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on a later turn: revoking straight away races the download in
  // some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * @typedef {object} ExportFile
 * @property {string} filename           including extension
 * @property {string|Uint8Array} data    text or bytes
 * @property {string} mimeType
 */

/**
 * Save the file where the user chooses.
 *
 * @param {ExportFile} file
 * @returns {Promise<{ saved: boolean }>} `saved: false` means the user closed
 *   the dialog. A failure to write rejects.
 */
export async function saveFile({ filename, data, mimeType }) {
  const name = safeFilename(filename);
  const bytes = toBytes(data);

  if (!isNative()) {
    browserDownload(name, bytes, mimeType);
    return { saved: true };
  }

  const { saved } = await FileExport.save({ filename: name, mimeType, data: bytesToBase64(bytes) });
  return { saved: saved === true };
}

/**
 * Whether `shareFile` can offer this file here. Always on the phone apps; in
 * a browser only where the Web Share API accepts files.
 *
 * @param {ExportFile} file
 */
export function canShareFile({ filename, data, mimeType }) {
  if (isNative()) return true;
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([toBytes(data)], safeFilename(filename), { type: mimeType })] });
  } catch {
    return false;
  }
}

/**
 * Offer the file to another app through the system share sheet.
 *
 * @param {ExportFile & { title?: string }} file
 * @returns {Promise<{ shared: boolean }>} `shared: false` means the user
 *   closed the sheet. Anything else that goes wrong rejects.
 */
export async function shareFile({ filename, data, mimeType, title }) {
  const name = safeFilename(filename);
  const bytes = toBytes(data);

  if (!isNative()) {
    try {
      await navigator.share({ title: title || name, files: [new File([bytes], name, { type: mimeType })] });
      return { shared: true };
    } catch (err) {
      if (err?.name === 'AbortError') return { shared: false };
      throw err;
    }
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);

  const { uri } = await Filesystem.writeFile({
    path: name,
    data: bytesToBase64(bytes),
    directory: Directory.Cache,
    recursive: true,
  });

  try {
    await Share.share({ title: title || name, files: [uri], dialogTitle: title || name });
    return { shared: true };
  } catch (err) {
    if (err?.message === SHARE_CANCELED) return { shared: false };
    throw err;
  }
}
