/**
 * QR share helper — turns a rendered QR canvas (via the <vue-qrcode>
 * component or a raw <canvas>) into a designed, shareable PNG card:
 * the code on a clean white surface, the identifier it encodes printed
 * beneath it, and the Buho brand mark as the footer.
 *
 * Why the identifier is baked into the IMAGE while the share TEXT stays
 * the pure string:
 *   1. The picture is self-explanatory wherever it gets forwarded —
 *      screenshots, cross-app resharing, printouts — because the
 *      recipient can read what the code is.
 *   2. The shared text remains a pure invoice/address URI, so
 *      recipients can long-press → copy without scraping caption lines.
 *
 * Silent-failure by design: returns null (never throws) if the ref
 * isn't ready or the canvas can't be encoded, so callers can degrade
 * gracefully to text-only share without try/catch. A missing brand
 * asset only drops the logo, never the share.
 */

const BRAND_NAME = 'BuhoGO';
const BRAND_MARK_URL = '/buho_logo.svg';

// ─── Card layout ─────────────────────────────────────────────────────
// All values in canvas pixels. The QR is normalized to a fixed drawing
// size so every share card comes out identical regardless of how large
// the on-screen canvas happened to render.
const QR_SIZE = 320;
const CARD_PADDING_X = 56;
const CARD_PADDING_TOP = 48;
const LABEL_GAP = 30;
const LABEL_FONT = '500 17px "SF Mono", ui-monospace, Menlo, Consolas, monospace';
const LABEL_COLOR = '#475569';
const DIVIDER_GAP = 28;
const DIVIDER_COLOR = '#e2e8f0';
const FOOTER_HEIGHT = 78;
const FOOTER_BOTTOM_PADDING = 14;
const BRAND_FONT = '700 22px "Manrope", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
const BRAND_COLOR = '#0f172a';
const BRAND_MARK_WIDTH = 26;
const BRAND_MARK_HEIGHT = 28; // matches the 30x32 asset's aspect
const BRAND_MARK_GAP = 10;

/**
 * @param {unknown} ref  Template ref pointing at a <vue-qrcode> or <canvas>.
 * @param {object} [opts]
 * @param {string} [opts.label]  The identifier the QR encodes (address /
 *   invoice). Printed beneath the code, middle-truncated to fit; omit to
 *   render the card without the line.
 * @returns {Promise<Blob | null>}
 */
export async function qrBlobFromRef(ref, { label = '' } = {}) {
  const source = resolveCanvas(ref);
  if (!source) return null;

  const brandMark = await loadBrandMark();
  const branded = renderShareCard(source, { label, brandMark });

  // A failed card render must not cost the recipient the image: fall
  // back to the plain QR canvas, so the share degrades card → plain QR
  // → (in the caller) text-only, never straight to text.
  return canvasToPngBlob(branded || source);
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

// The mark is fetched once per session; a failure caches null so a
// broken asset can't retrigger network noise on every share.
let brandMarkPromise = null;

function loadBrandMark() {
  if (!brandMarkPromise) {
    brandMarkPromise = new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = BRAND_MARK_URL;
      } catch {
        resolve(null);
      }
    });
  }
  return brandMarkPromise;
}

/**
 * Compose the share card. Returns null if a 2D context can't be
 * acquired (defensive — should never happen in practice).
 */
function renderShareCard(sourceCanvas, { label, brandMark }) {
  const width = QR_SIZE + CARD_PADDING_X * 2;
  const hasLabel = typeof label === 'string' && label.trim() !== '';
  const labelBlockHeight = hasLabel ? LABEL_GAP + 17 : 0;
  const height = CARD_PADDING_TOP + QR_SIZE + labelBlockHeight
    + DIVIDER_GAP + 1 + FOOTER_HEIGHT + FOOTER_BOTTOM_PADDING;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // White surface gives the QR maximum scanning contrast across every
  // background the image might land on (chat bubbles, galleries).
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // QR, normalized to a fixed size. Nearest-neighbor keeps the modules
  // razor-sharp when the on-screen canvas was smaller than QR_SIZE.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, CARD_PADDING_X, CARD_PADDING_TOP, QR_SIZE, QR_SIZE);
  ctx.imageSmoothingEnabled = true;

  let cursorY = CARD_PADDING_TOP + QR_SIZE;

  // The identifier the code encodes, readable and centered. The share
  // text carries the full string for copying; this line is for humans.
  if (hasLabel) {
    cursorY += LABEL_GAP;
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      fitLabelToWidth(ctx, label.trim(), QR_SIZE),
      width / 2,
      cursorY + 8
    );
    cursorY += 17;
  }

  cursorY += DIVIDER_GAP;
  ctx.fillStyle = DIVIDER_COLOR;
  ctx.fillRect(CARD_PADDING_X, cursorY, QR_SIZE, 1);
  cursorY += 1;

  // Footer: brand mark + name, centered as one group. Falls back to the
  // name alone when the mark asset is unavailable.
  const footerCenterY = cursorY + FOOTER_HEIGHT / 2;
  ctx.fillStyle = BRAND_COLOR;
  ctx.font = BRAND_FONT;
  ctx.textBaseline = 'middle';

  if (brandMark) {
    const nameWidth = ctx.measureText(BRAND_NAME).width;
    const groupWidth = BRAND_MARK_WIDTH + BRAND_MARK_GAP + nameWidth;
    const groupLeft = (width - groupWidth) / 2;
    try {
      ctx.drawImage(
        brandMark,
        groupLeft,
        footerCenterY - BRAND_MARK_HEIGHT / 2,
        BRAND_MARK_WIDTH,
        BRAND_MARK_HEIGHT
      );
      ctx.textAlign = 'left';
      ctx.fillText(BRAND_NAME, groupLeft + BRAND_MARK_WIDTH + BRAND_MARK_GAP, footerCenterY + 1);
    } catch {
      ctx.textAlign = 'center';
      ctx.fillText(BRAND_NAME, width / 2, footerCenterY + 1);
    }
  } else {
    ctx.textAlign = 'center';
    ctx.fillText(BRAND_NAME, width / 2, footerCenterY + 1);
  }

  return canvas;
}

/**
 * Middle-truncate `text` until it fits `maxWidth` under the context's
 * current font, preserving both ends — the parts of an address people
 * actually compare. Exported for tests (measurement is injected via the
 * ctx-shaped object).
 *
 * @param {{ measureText(t: string): { width: number } }} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string}
 */
export function fitLabelToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;

  const ELLIPSIS = '…';
  let keep = Math.floor((text.length - 1) / 2);
  while (keep > 2) {
    const candidate = `${text.slice(0, keep)}${ELLIPSIS}${text.slice(text.length - keep)}`;
    if (ctx.measureText(candidate).width <= maxWidth) return candidate;
    keep -= 1;
  }
  return `${text.slice(0, 2)}${ELLIPSIS}${text.slice(-2)}`;
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
