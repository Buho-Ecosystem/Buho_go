/**
 * QR share helper — turns a rendered QR canvas (via the <vue-qrcode>
 * component or a raw <canvas>) into a designed, shareable 4:5 PNG card:
 * a brand-green band saying what the code is, the code itself on a white
 * panel with the identifier it encodes beneath it, the amount when there
 * is one, and a footer telling the recipient what to do with it.
 *
 * Why the identifier is baked into the IMAGE while the share TEXT stays
 * the pure string:
 *   1. The picture is self-explanatory wherever it gets forwarded —
 *      screenshots, cross-app resharing, printouts — because the
 *      recipient can read what the code is.
 *   2. The shared text remains a pure invoice/address URI, so
 *      recipients can long-press → copy without scraping caption lines.
 *
 * 4:5 because that is the largest shape chat apps and feeds show without
 * cropping, so the code arrives big enough to scan off another screen.
 *
 * Silent-failure by design: returns null (never throws) if the ref
 * isn't ready or the canvas can't be encoded, so callers can degrade
 * gracefully to text-only share without try/catch. A missing brand
 * asset only drops the logo, never the share.
 */

const BRAND_NAME = 'BuhoGO';
const BRAND_MARK_URL = '/buho_logo.svg';
const DEFAULT_HINT = 'Scan with any Bitcoin wallet';

// ─── Card layout ─────────────────────────────────────────────────────
// All values in canvas pixels on a fixed 1080x1350 card. The QR is
// normalized to a fixed drawing size so every share card comes out
// identical regardless of how large the on-screen canvas rendered.
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;
const SIDE = 72;
const SURFACE = '#F8F5EE';
const FONT_STACK = '"Manrope", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

const BAND_HEIGHT = 330;
const BRAND_TOP = 64;
const BRAND_MARK_HEIGHT = 50;
const BRAND_MARK_WIDTH = 47; // the 30x32 asset's aspect
const BRAND_MARK_GAP = 16;
const BRAND_FONT = `700 40px ${FONT_STACK}`;
const TITLE_SIZE = 64;
const TITLE_BASELINE = 226;

const PANEL_TOP = 270;
const PANEL_PADDING = 54;
const PANEL_RADIUS = 44;
const QR_SIZE = 640;
const LABEL_GAP = 30;
const LABEL_SIZE = 34;
const LABEL_FONT = `600 ${LABEL_SIZE}px "SF Mono", ui-monospace, Menlo, Consolas, monospace`;
const LABEL_COLOR = '#1F2622';
const AMOUNT_GAP = 16;
const AMOUNT_HEIGHT = 56;
const AMOUNT_FONT = `700 30px ${FONT_STACK}`;

const FOOTER_CENTER_Y = CARD_HEIGHT - 92;
const HINT_FONT = `600 28px ${FONT_STACK}`;
const RAIL_FONT = `700 22px ${FONT_STACK}`;
const RAIL_HEIGHT = 50;
const RAIL_GAP = 12;

/**
 * @param {unknown} ref  Template ref pointing at a <vue-qrcode> or <canvas>.
 * @param {object} [opts]
 * @param {string} [opts.label]  The identifier the QR encodes (address /
 *   invoice). Printed beneath the code, middle-truncated to fit; omit to
 *   render the card without the line.
 * @param {string} [opts.title]  What the code is ("Lightning Invoice"),
 *   shown large in the band. Already translated by the caller.
 * @param {string} [opts.amount]  Display amount ("₿2,100 · $1.78"), shown
 *   as a pill under the label when the code asks for a fixed sum.
 * @param {string} [opts.hint]  The footer line; translated by the caller.
 * @param {string[]} [opts.rails]  Payment rails the code accepts, shown as
 *   chips in the footer ("Lightning"). Omit when unsure: a wrong chip is
 *   worse than none.
 * @returns {Promise<Blob | null>}
 */
export async function qrBlobFromRef(ref, { label = '', title = '', amount = '', hint = DEFAULT_HINT, rails = [] } = {}) {
  const source = resolveCanvas(ref);
  if (!source) return null;

  const brandMark = await loadBrandMark();
  let branded = null;
  try {
    branded = renderShareCard(source, { label, title, amount, hint, rails, brandMark });
  } catch {
    branded = null;
  }

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
function renderShareCard(sourceCanvas, { label, title, amount, hint, rails, brandMark }) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  drawBand(ctx, { title, brandMark });

  // Panel: white keeps the QR at maximum scanning contrast wherever the
  // image lands (chat bubbles, galleries, a second phone's camera).
  const hasLabel = typeof label === 'string' && label.trim() !== '';
  const hasAmount = typeof amount === 'string' && amount.trim() !== '';
  const panelHeight = PANEL_PADDING * 2 + QR_SIZE
    + (hasLabel ? LABEL_GAP + LABEL_SIZE + 8 : 0)
    + (hasAmount ? AMOUNT_GAP + AMOUNT_HEIGHT : 0);
  const panelWidth = CARD_WIDTH - SIDE * 2;

  ctx.save();
  ctx.shadowColor = 'rgba(3, 36, 26, 0.22)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 28;
  ctx.fillStyle = '#ffffff';
  roundedRect(ctx, SIDE, PANEL_TOP, panelWidth, panelHeight, PANEL_RADIUS);
  ctx.fill();
  ctx.restore();

  // QR, normalized to a fixed size. Nearest-neighbor keeps the modules
  // razor-sharp when the on-screen canvas was smaller than QR_SIZE.
  const qrLeft = (CARD_WIDTH - QR_SIZE) / 2;
  let cursorY = PANEL_TOP + PANEL_PADDING;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, qrLeft, cursorY, QR_SIZE, QR_SIZE);
  ctx.imageSmoothingEnabled = true;
  cursorY += QR_SIZE;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // The identifier the code encodes, readable and centered. The share
  // text carries the full string for copying; this line is for humans.
  if (hasLabel) {
    cursorY += LABEL_GAP;
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = LABEL_FONT;
    ctx.fillText(fitLabelToWidth(ctx, label.trim(), panelWidth - PANEL_PADDING * 2), CARD_WIDTH / 2, cursorY + LABEL_SIZE / 2);
    cursorY += LABEL_SIZE + 8;
  }

  if (hasAmount) {
    cursorY += AMOUNT_GAP;
    ctx.font = AMOUNT_FONT;
    const text = amount.trim();
    const pillWidth = ctx.measureText(text).width + 44;
    ctx.fillStyle = '#E8F7EF';
    roundedRect(ctx, (CARD_WIDTH - pillWidth) / 2, cursorY, pillWidth, AMOUNT_HEIGHT, AMOUNT_HEIGHT / 2);
    ctx.fill();
    ctx.fillStyle = '#047857';
    ctx.fillText(text, CARD_WIDTH / 2, cursorY + AMOUNT_HEIGHT / 2 + 1);
  }

  drawFooter(ctx, { hint, rails });
  return canvas;
}

/** Brand-green band: logo, name, and what the code is. */
function drawBand(ctx, { title, brandMark }) {
  const base = ctx.createLinearGradient(0, 0, CARD_WIDTH * 0.35, BAND_HEIGHT * 1.9);
  base.addColorStop(0, '#075A40');
  base.addColorStop(1, '#03241A');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, CARD_WIDTH, BAND_HEIGHT);

  // One soft leaf-green light from the top right, so the band is not flat.
  const glow = ctx.createRadialGradient(CARD_WIDTH * 0.8, 0, 0, CARD_WIDTH * 0.8, 0, CARD_WIDTH * 0.6);
  glow.addColorStop(0, 'rgba(120, 213, 60, 0.35)');
  glow.addColorStop(1, 'rgba(120, 213, 60, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_WIDTH, BAND_HEIGHT);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = BRAND_FONT;
  const brandCenterY = BRAND_TOP + BRAND_MARK_HEIGHT / 2;
  let nameLeft = SIDE;
  if (brandMark) {
    try {
      ctx.drawImage(brandMark, SIDE, BRAND_TOP, BRAND_MARK_WIDTH, BRAND_MARK_HEIGHT);
      nameLeft = SIDE + BRAND_MARK_WIDTH + BRAND_MARK_GAP;
    } catch {
      nameLeft = SIDE;
    }
  }
  ctx.fillText(BRAND_NAME, nameLeft, brandCenterY + 2);

  if (typeof title === 'string' && title.trim() !== '') {
    // Shrink rather than clip: translations run longer than English.
    const maxWidth = CARD_WIDTH - SIDE * 2;
    let size = TITLE_SIZE;
    ctx.font = `800 ${size}px ${FONT_STACK}`;
    while (size > 36 && ctx.measureText(title.trim()).width > maxWidth) {
      size -= 2;
      ctx.font = `800 ${size}px ${FONT_STACK}`;
    }
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title.trim(), SIDE, TITLE_BASELINE);
  }
}

/** Footer: what to do with the code, and which rails it takes. */
function drawFooter(ctx, { hint, rails }) {
  ctx.textBaseline = 'middle';

  let railsLeft = CARD_WIDTH - SIDE;
  const chips = Array.isArray(rails) ? rails.filter((r) => typeof r === 'string' && r.trim() !== '') : [];
  if (chips.length) {
    ctx.font = RAIL_FONT;
    const widths = chips.map((r) => ctx.measureText(r).width + 36);
    railsLeft = CARD_WIDTH - SIDE - widths.reduce((a, b) => a + b, 0) - RAIL_GAP * (chips.length - 1);
    let x = railsLeft;
    chips.forEach((rail, i) => {
      ctx.fillStyle = '#EDEAE2';
      roundedRect(ctx, x, FOOTER_CENTER_Y - RAIL_HEIGHT / 2, widths[i], RAIL_HEIGHT, RAIL_HEIGHT / 2);
      ctx.fill();
      ctx.fillStyle = '#3A403D';
      ctx.textAlign = 'center';
      ctx.fillText(rail, x + widths[i] / 2, FOOTER_CENTER_Y + 1);
      x += widths[i] + RAIL_GAP;
    });
  }

  if (typeof hint === 'string' && hint.trim() !== '') {
    ctx.font = HINT_FONT;
    ctx.fillStyle = '#5B625F';
    ctx.textAlign = 'left';
    ctx.fillText(fitLabelToWidth(ctx, hint.trim(), railsLeft - SIDE - 24), SIDE, FOOTER_CENTER_Y + 1);
  }
}

/** Rounded rectangle path; ctx.roundRect is missing on older WebViews. */
function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
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
