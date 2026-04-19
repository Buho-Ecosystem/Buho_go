/**
 * Share utility — wraps the native share sheet behind a single
 * `shareContent()` call with a layered fallback so the UX never
 * hits a dead end:
 *
 *   1. Native platforms: Capacitor Share with files written to the
 *      app's cache directory. The OS share sheet receives both the
 *      caption text and the image attachment.
 *   2. Web: Web Share API with files (Android Chrome, iOS Safari).
 *   3. Text-only share: Capacitor Share / navigator.share without
 *      attachments (for legacy targets that don't accept files).
 *   4. `{ success: false, reason: 'unsupported' }` → callers drop
 *      back to clipboard.
 *
 * Cancellation and unsupported platforms resolve quietly instead
 * of throwing; real errors surface on `result.error` for logging.
 * Any file written to disk is cleaned up in a `finally` block so
 * the cache directory never accumulates stale QR images.
 */

import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';

/**
 * @typedef {Object} ShareFile
 * @property {Blob}   blob
 * @property {string} name
 * @property {string} [mimeType]
 */

/**
 * @param {Object} options
 * @param {string}       [options.title]
 * @param {string}       [options.text]
 * @param {string}       [options.url]
 * @param {ShareFile[]}  [options.files]
 * @returns {Promise<{success: boolean, reason?: 'cancelled' | 'unsupported' | 'error', error?: Error}>}
 */
export async function shareContent({ title, text, url, files } = {}) {
  const hasFiles = !!files?.length;

  // ── Layer 1a: native with files ────────────────────────────
  if (hasFiles && Capacitor.isNativePlatform()) {
    const result = await tryNativeShareWithFiles({ title, text, url, files });
    if (result.success) return result;
    if (result.reason === 'cancelled') return result;
    // Fall through — keep trying lesser layers.
  }

  // ── Layer 1b: web with files ───────────────────────────────
  if (hasFiles && !Capacitor.isNativePlatform()) {
    const result = await tryWebShareWithFiles({ title, text, url, files });
    if (result.success) return result;
    if (result.reason === 'cancelled') return result;
    // Fall through to text-only.
  }

  // ── Layer 2: text-only share ───────────────────────────────
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title, text, url, dialogTitle: title });
      return { success: true };
    }

    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title, text, url });
      return { success: true };
    }

    return { success: false, reason: 'unsupported' };
  } catch (error) {
    if (isCancelled(error)) return { success: false, reason: 'cancelled' };
    if (error?.code === 'UNAVAILABLE') return { success: false, reason: 'unsupported' };
    return { success: false, reason: 'error', error };
  }
}

/**
 * Native path: write each blob to cache, hand the resulting file URIs
 * to Capacitor Share, delete the temp files afterwards.
 */
async function tryNativeShareWithFiles({ title, text, url, files }) {
  const written = [];
  try {
    for (const file of files) {
      const base64 = await blobToBase64(file.blob);
      const path = `shared/${Date.now()}-${file.name}`;
      const writeResult = await Filesystem.writeFile({
        path,
        data: base64,
        directory: Directory.Cache,
        recursive: true,
      });
      written.push({ path, uri: writeResult.uri });
    }

    await Share.share({
      title,
      text,
      url,
      dialogTitle: title,
      files: written.map((w) => w.uri),
    });

    return { success: true };
  } catch (error) {
    if (isCancelled(error)) return { success: false, reason: 'cancelled' };
    if (error?.code === 'UNAVAILABLE') return { success: false, reason: 'unsupported' };
    return { success: false, reason: 'error', error };
  } finally {
    // Best-effort cleanup — never let a stale file trip us up.
    await Promise.all(
      written.map(({ path }) =>
        Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {})
      )
    );
  }
}

async function tryWebShareWithFiles({ title, text, url, files }) {
  if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) {
    return { success: false, reason: 'unsupported' };
  }

  let fileObjects;
  try {
    fileObjects = files.map(({ blob, name, mimeType }) => (
      new File([blob], name, { type: mimeType || blob.type || 'application/octet-stream' })
    ));
  } catch (error) {
    return { success: false, reason: 'error', error };
  }

  if (!navigator.canShare({ files: fileObjects })) {
    return { success: false, reason: 'unsupported' };
  }

  try {
    await navigator.share({ title, text, url, files: fileObjects });
    return { success: true };
  } catch (error) {
    if (isCancelled(error)) return { success: false, reason: 'cancelled' };
    return { success: false, reason: 'error', error };
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIndex = result.indexOf(',');
      // data:image/png;base64,<payload> → strip the prefix.
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function isCancelled(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return true;
  const message = (error.message || '').toLowerCase();
  return message.includes('cancel') || message.includes('abort');
}
