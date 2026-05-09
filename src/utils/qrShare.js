/**
 * QR share helper — turns a rendered QR canvas (via the <vue-qrcode>
 * component or a raw <canvas>) into a shareable PNG Blob with a
 * subtle BuhoGO wordmark baked in beneath the code.
 *
 * Why bake the wordmark onto the image instead of appending it to
 * the share text:
 *   1. The shared TEXT stays a pure invoice URI, so recipients can
 *      long-press → copy without scraping signature lines.
 *   2. The wordmark travels with the image wherever it gets
 *      forwarded — screenshots, cross-app resharing, etc.
 *
 * Silent-failure by design: returns null (never throws) if the ref
 * isn't ready or the canvas can't be encoded, so callers can
 * degrade gracefully to text-only share without try/catch.
 */

const BRAND_LABEL = 'Sent with BuhoGO';

/** Whitespace around the QR inside the final image. */
const CANVAS_PADDING = 48;
/** Reserved height below the QR for the wordmark. */
const FOOTER_HEIGHT = 52;

/**
 * @param {unknown} ref  Template ref pointing at a <vue-qrcode> or <canvas>.
 * @returns {Promise<Blob | null>}
 */
export async function qrBlobFromRef(ref) {
  const source = resolveCanvas(ref);
  if (!source) return null;

  const branded = renderBrandedQr(source);
  if (!branded) return null;

  return canvasToPngBlob(branded);
}

function resolveCanvas(ref) {
  if (!ref) return null;
  if (ref instanceof HTMLCanvasElement) return ref;

  // <vue-qrcode> exposes its root element via $el (the canvas itself).
  if (ref.$el instanceof HTMLCanvasElement) return ref.$el;

  // Fallback: component wrapper with a nested <canvas>.
  const host = ref.$el || ref;
  if (host?.querySelector) return host.querySelector('canvas');
  return null;
}

/**
 * Compose a larger canvas with the source QR centered and a small
 * wordmark caption below. Returns null if a 2D context can't be
 * acquired (defensive — should never happen in practice).
 */
function renderBrandedQr(sourceCanvas) {
  const width = sourceCanvas.width + CANVAS_PADDING * 2;
  const height = sourceCanvas.height + CANVAS_PADDING * 2 + FOOTER_HEIGHT;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // White surface gives the QR maximum scanning contrast across
  // every background the image might land on (chat bubbles, galleries).
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.drawImage(sourceCanvas, CANVAS_PADDING, CANVAS_PADDING);

  // Wordmark. Kept small, muted, and centered so it reads as a
  // signature rather than a watermark.
  const footerCenterY = sourceCanvas.height + CANVAS_PADDING * 2 + FOOTER_HEIGHT / 2;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 18px "Manrope", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(BRAND_LABEL, width / 2, footerCenterY);

  return canvas;
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob || null), 'image/png');
    } catch {
      resolve(null);
    }
  });
}
