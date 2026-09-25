/**
 * LUD-06 payRequest metadata: what a service says about itself.
 *
 * `metadata` is a JSON string holding an array of `[mime, value]` pairs:
 *   text/plain          short description (required by the spec)
 *   text/long-desc      longer description
 *   text/identifier     the Lightning address form of this link
 *   text/email          same, older name
 *   image/png;base64    a logo
 *   image/jpeg;base64   a logo
 *
 * Spec: https://github.com/lnurl/luds/blob/luds/06.md
 *
 * Everything here is untrusted input from a service: entries are validated
 * one by one, sizes are capped, and anything malformed yields nulls rather
 * than a throw. This is what turns a LUD-11 storeable service into a payee
 * with a name and a picture in the address book.
 */

import { isLightningAddress, lnurlDomain, canonicalLnurl } from './addressUtils.js';

const TEXT_MAX = 256;
const LONG_TEXT_MAX = 2048;
const TITLE_MAX = 40;
/** Base64 payload cap before we even try to decode a logo. */
const IMAGE_BASE64_MAX = 96 * 1024;
/** What we keep after downscaling; the registry refuses anything larger. */
export const SERVICE_IMAGE_DATA_URL_MAX = 32 * 1024;
const SERVICE_IMAGE_SIZE = 96;
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;

const EMPTY = Object.freeze({ description: null, longDescription: null, identifier: null, image: null });

function cleanText(value, max) {
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

/**
 * @param {string|Array|null|undefined} metadata  the payRequest `metadata` field
 * @returns {{ description: string|null, longDescription: string|null, identifier: string|null, image: { mime: string, base64: string }|null }}
 */
export function parsePayRequestMetadata(metadata) {
  let entries = metadata;
  if (typeof metadata === 'string') {
    try {
      entries = JSON.parse(metadata);
    } catch {
      return { ...EMPTY };
    }
  }
  if (!Array.isArray(entries)) return { ...EMPTY };

  const out = { ...EMPTY };
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [mime, value] = entry;
    if (typeof mime !== 'string' || typeof value !== 'string') continue;

    switch (mime) {
      case 'text/plain':
        if (out.description === null) out.description = cleanText(value, TEXT_MAX) || null;
        break;
      case 'text/long-desc':
        if (out.longDescription === null) out.longDescription = cleanText(value, LONG_TEXT_MAX) || null;
        break;
      case 'text/identifier':
      case 'text/email': {
        if (out.identifier !== null) break;
        const candidate = value.trim().toLowerCase();
        if (candidate.length <= TEXT_MAX && isLightningAddress(candidate)) out.identifier = candidate;
        break;
      }
      case 'image/png;base64':
      case 'image/jpeg;base64': {
        if (out.image !== null) break;
        const base64 = value.replace(/\s+/g, '');
        if (!base64 || base64.length > IMAGE_BASE64_MAX || !BASE64_RE.test(base64)) break;
        out.image = { mime: mime.slice(0, mime.indexOf(';')), base64 };
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** One identity policy for manual contact saving and payment receipts. */
export function serviceIdentity(payLink, metadata) {
  const identifier = typeof metadata?.identifier === 'string'
    ? metadata.identifier.trim().toLowerCase() : '';
  const link = canonicalLnurl(payLink);
  if (isLightningAddress(identifier)) {
    return { address: identifier, addressType: 'lightning', payLink: link };
  }
  return { address: link, addressType: 'lnurl', payLink: link };
}

/**
 * The name a service gets in the address book: the first line of its
 * description, clamped, or the domain when it said nothing usable.
 * @param {{ description?: string|null }|null|undefined} meta
 * @param {string} domain
 * @param {number} [max]
 * @returns {string}
 */
export function serviceTitle(meta, domain, max = TITLE_MAX) {
  const description = typeof meta?.description === 'string' ? meta.description : '';
  const firstLine = description.split(/\r?\n/)[0].trim();
  if (firstLine) return firstLine.length > max ? `${firstLine.slice(0, max - 1).trimEnd()}…` : firstLine;
  return typeof domain === 'string' ? domain : '';
}

/**
 * The one line every surface uses for a service pay link instead of its
 * bech32 blob: "coffee.example · payment link", or just "payment link" when
 * the address does not decode. `t` is the caller's translate function.
 * @param {string} address  a canonical LNURL (any carrier decodes)
 * @param {(key: string) => string} t
 * @returns {string}
 */
export function serviceAddressLine(address, t) {
  const domain = lnurlDomain(address);
  const label = t('payment link');
  return domain ? `${domain} · ${label}` : label;
}

/**
 * Downscale a LUD-06 logo to a small square data URL for the local image
 * registry. Browser only (needs Image + canvas); resolves null anywhere
 * else, for anything that fails to decode, and for anything still too big
 * after downscaling. Never throws.
 *
 * @param {{ mime: string, base64: string }|null|undefined} image
 * @param {{ size?: number, maxBytes?: number }} [opts]
 * @returns {Promise<string|null>} a `data:image/...;base64,` URL or null
 */
export function normalizeServiceImage(image, { size = SERVICE_IMAGE_SIZE, maxBytes = SERVICE_IMAGE_DATA_URL_MAX } = {}) {
  if (!image?.base64 || !image?.mime) return Promise.resolve(null);
  if (typeof document === 'undefined' || typeof Image === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx || !img.naturalWidth || !img.naturalHeight) return resolve(null);
        // Cover-fit: fill the square, crop the overflow, keep the centre.
        const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        let dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.length > maxBytes) dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl.length <= maxBytes ? dataUrl : null);
      } catch {
        resolve(null);
      }
    };
    img.src = `data:${image.mime};base64,${image.base64}`;
  });
}
