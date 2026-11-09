/**
 * Reading a QR code out of a picture the person chose (a screenshot of an
 * invoice, a code sent in a chat, a photo of a printed one).
 *
 * In the app the native decoder reads it first: the model the live camera
 * uses, and far better at a small or tilted code in a large photo. When it
 * finds nothing, one quick look in the web view still runs, for a light code
 * on a dark screenshot. When it cannot run at all, and on the web, the
 * picture gets the looks below.
 *
 * The camera scanners decode a small, downscaled region of every frame; a
 * chosen picture is one still image of any size. The looks read the whole
 * picture at three sizes, smallest first: the decoder finds a code only when
 * its squares are neither too small nor too blurred at the size it reads, so
 * one size misses codes another finds (measured on screenshots, chat images
 * and 12 and 48 megapixel photos: three sizes found 51 of 55, two sizes at
 * most 47). Each look also tries inverted colours. The looks are capped at
 * 3200 px; the picture itself is opened at its full size (about 48 MB for a
 * 12-megapixel photo, four times that for 48), and a picture the device has
 * no memory for ends as one it cannot open.
 *
 * Everything that touches the browser or the app (decoding the file, the QR
 * engines) is injected, so the plan and the outcomes are testable with Node.
 */
import QrScanner from 'qr-scanner';

/** Why a picture gave no code, as `err.code`. */
export const PHOTO_SCAN_ERROR = Object.freeze({
  /** The picture opened, and none of the looks found a QR code in it. */
  NO_CODE: 'PHOTO_NO_CODE',
  /** The file is not a picture this device can open (a document, a broken file, a format it cannot decode). */
  UNREADABLE: 'PHOTO_UNREADABLE',
});

/**
 * The longest side of each look, smallest first. The first finds a
 * screenshot's code in a moment, the last a code that is small in a large
 * photo. A picture smaller than a look is read at its own size, once.
 */
export const LOOK_SIDES = Object.freeze([800, 1600, 3200]);

/** The quick look after the native decoder found nothing: a screenshot's size. */
export const AFTER_NATIVE_SIDES = Object.freeze([1600]);

/**
 * How long the native decoder may take before the web view's looks take
 * over. A 48-megapixel photo reads in about a second; a decoder that never
 * answers must not leave "Reading photo" spinning.
 */
export const NATIVE_READ_MS = 10_000;

/**
 * The sizes to read a `width` x `height` picture at: each look scaled to
 * fit, never above the picture's own size, without repeats.
 *
 * @param {number} width
 * @param {number} height
 * @param {readonly number[]} [sides]
 * @returns {{ width: number, height: number }[]}
 */
export function lookSizes(width, height, sides = LOOK_SIDES) {
  const longest = Math.max(width, height);
  if (!(longest > 0)) return [];
  const sizes = [];
  for (const side of sides) {
    const scale = Math.min(1, side / longest);
    const size = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
    const last = sizes.at(-1);
    if (!last || last.width !== size.width || last.height !== size.height) sizes.push(size);
    if (scale === 1) break;
  }
  return sizes;
}

function coded(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause !== undefined) err.cause = cause;
  return err;
}

/** Open a picked file as something a canvas can draw, at its full size. */
async function openPicture(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One look at the whole picture, drawn at `size`: the code's text, or null. */
async function lookAt(picture, size, width, height) {
  try {
    const result = await QrScanner.scanImage(picture, {
      scanRegion: { x: 0, y: 0, width, height, downScaledWidth: size.width, downScaledHeight: size.height },
      returnDetailedScanResult: true,
    });
    return result?.data || null;
  } catch {
    // The library rejects with a sentence when there is no code, and with
    // another when its worker timed out; either way this look found nothing.
    return null;
  }
}

/** The looks at a picture, in the web view. */
async function lookThrough(file, { open = openPicture, look = lookAt, sides = LOOK_SIDES } = {}) {
  let picture;
  try {
    picture = await open(file);
  } catch (err) {
    throw coded(PHOTO_SCAN_ERROR.UNREADABLE, 'The file could not be opened as a picture.', err);
  }
  try {
    const width = picture?.width || picture?.naturalWidth || 0;
    const height = picture?.height || picture?.naturalHeight || 0;
    const sizes = lookSizes(width, height, sides);
    if (!sizes.length) throw coded(PHOTO_SCAN_ERROR.UNREADABLE, 'The picture has no size.');
    for (const size of sizes) {
      const text = (await look(picture, size, width, height))?.trim();
      if (text) return text;
    }
    throw coded(PHOTO_SCAN_ERROR.NO_CODE, 'No QR code found in the picture.');
  } finally {
    try { picture?.close?.(); } catch { /* an image element has nothing to release */ }
  }
}

/**
 * The text of the QR code in a picked picture.
 *
 * Throws an Error whose `code` is a `PHOTO_SCAN_ERROR`: UNREADABLE when the
 * file cannot be opened as a picture, NO_CODE when it opened and no code was
 * found in it.
 *
 * @param {Blob} file
 * @param {{
 *   readNative?: ((file: Blob) => Promise<string | null>) | null,
 *   open?: (file: Blob) => Promise<{ width: number, height: number, close?: () => void }>,
 *   look?: (picture: any, size: { width: number, height: number }, width: number, height: number) => Promise<string | null>,
 *   sides?: readonly number[],
 *   nativeTimeoutMs?: number,
 * }} [deps] readNative: the app's native decoder (nativeScanner.readQrFromPicture), none on the web
 * @returns {Promise<string>}
 */
export async function readQrFromImage(file, { readNative = null, nativeTimeoutMs = NATIVE_READ_MS, ...looks } = {}) {
  if (!readNative) return lookThrough(file, looks);
  let found;
  let timer;
  try {
    found = await Promise.race([
      readNative(file),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(coded(PHOTO_SCAN_ERROR.UNREADABLE, 'The native decoder did not answer.')), nativeTimeoutMs);
      }),
    ]);
  } catch {
    // The native decoder cannot run here, cannot open this file, or did not answer.
    return lookThrough(file, looks);
  } finally {
    clearTimeout(timer);
  }
  const text = typeof found === 'string' ? found.trim() : '';
  if (text) return text;
  // The native decoder opened the picture and found no code. One quick look
  // still runs; whatever it cannot do, the answer stays "no code".
  try {
    return await lookThrough(file, { ...looks, sides: AFTER_NATIVE_SIDES });
  } catch {
    throw coded(PHOTO_SCAN_ERROR.NO_CODE, 'No QR code found in the picture.');
  }
}
