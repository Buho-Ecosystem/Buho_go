/**
 * LUD-09 — `successAction` handling for LNURL-pay.
 *
 * When a wallet fetches an invoice from an LNURL-pay `callback`, the JSON
 * response may carry a `successAction` alongside the `pr` (bolt11). It is the
 * recipient's post-payment message to the payer: a plain text note, a URL, or
 * an AES-encrypted secret only the payer (who holds the preimage) can decrypt.
 *
 *   https://github.com/lnurl/luds/blob/luds/09.md
 *
 * This module is the single source of truth for the three concerns that the
 * spec demands and the rest of the app should never re-implement:
 *   1. parsing/validating the untrusted object at the network boundary,
 *   2. decrypting the `aes` variant with the settled payment's preimage,
 *   3. resolving either into the display shape the success UI renders.
 *
 * It is dependency-free (hex/base64 + Web Crypto only) so it runs unchanged in
 * the Capacitor WebView and the Node test runner.
 */

/** Spec cap for `message` and `description` free text (LUD-09). */
export const SUCCESS_ACTION_MAX_CHARS = 144;

/** Lowercase hex string → Uint8Array. Throws on non-hex / odd length. */
function hexToBytes(hex) {
  const clean = String(hex).trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Invalid hex input');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Standard base64 (padded or not) → Uint8Array. */
function base64ToBytes(b64) {
  // `atob` exists in browsers, the Capacitor WebView, and Node (global from
  // v16+), so we avoid pulling in a Buffer dependency.
  const bin = atob(String(b64).trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Trim and clamp free text to the spec cap. Servers occasionally exceed 144
 * chars; we prefer truncating over dropping an otherwise-valid message.
 */
function clampText(value) {
  if (typeof value !== 'string') return '';
  // Slice by code points, not UTF-16 units, so the cap can't split a surrogate
  // pair (emoji) and leave a lone surrogate behind.
  return Array.from(value.trim()).slice(0, SUCCESS_ACTION_MAX_CHARS).join('');
}

/** Whether a string is a syntactically valid http(s) URL. */
function isHttpUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalize a raw `successAction` from an LNURL-pay callback into a validated,
 * display-safe shape — or `null` when absent or malformed.
 *
 * Strict by design: the object arrives from a remote server, so we whitelist
 * the three LUD-09 tags, clamp free text, and reject a `url` that isn't
 * http(s). The `aes` ciphertext/iv are kept verbatim for later decryption.
 *
 * @param {any} raw
 * @returns {null
 *   | {tag:'message', message:string}
 *   | {tag:'url', description:string, url:string}
 *   | {tag:'aes', description:string, ciphertext:string, iv:string}}
 */
export function parseSuccessAction(raw) {
  if (!raw || typeof raw !== 'object') return null;

  switch (raw.tag) {
    case 'message': {
      const message = clampText(raw.message);
      return message ? { tag: 'message', message } : null;
    }
    case 'url': {
      const url = typeof raw.url === 'string' ? raw.url.trim() : '';
      if (!isHttpUrl(url)) return null;
      return { tag: 'url', description: clampText(raw.description), url };
    }
    case 'aes': {
      const ciphertext = typeof raw.ciphertext === 'string' ? raw.ciphertext.trim() : '';
      const iv = typeof raw.iv === 'string' ? raw.iv.trim() : '';
      if (!ciphertext || !iv) return null;
      return { tag: 'aes', description: clampText(raw.description), ciphertext, iv };
    }
    default:
      return null;
  }
}

/**
 * Decrypt a LUD-09 `aes` successAction. Per spec the cipher is AES-256-CBC with
 * the 32-byte payment preimage as the key and the supplied (base64) IV; the
 * plaintext is PKCS#7-padded, which SubtleCrypto strips automatically.
 *
 * @param {{ciphertext:string, iv:string}} action
 * @param {string} preimage 64-char hex preimage from the settled payment
 * @returns {Promise<string>} decrypted UTF-8 plaintext
 */
export async function decryptAesSuccessAction(action, preimage) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto unavailable for aes successAction');
  if (!action?.ciphertext || !action?.iv) throw new Error('Malformed aes successAction');
  if (!preimage) throw new Error('Missing preimage for aes successAction');

  const keyBytes = hexToBytes(preimage);
  if (keyBytes.length !== 32) {
    throw new Error(`Expected a 32-byte preimage, received ${keyBytes.length} bytes`);
  }
  const ivBytes = base64ToBytes(action.iv);
  const dataBytes = base64ToBytes(action.ciphertext);

  const key = await subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
  const plain = await subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, key, dataBytes);
  return new TextDecoder().decode(plain);
}

/**
 * Resolve a parsed successAction into the object the UI renders. The `aes`
 * variant is decrypted here using the settled payment's preimage; a decryption
 * failure degrades gracefully to a flagged state rather than throwing, so a bad
 * secret never blocks the success screen.
 *
 * The returned shape is intentionally storage-friendly (no ciphertext, secret
 * already decrypted) so it can be persisted and re-displayed later without the
 * preimage in hand.
 *
 * @param {ReturnType<typeof parseSuccessAction>} action
 * @param {string} [preimage]
 * @returns {Promise<null
 *   | {tag:'message', message:string}
 *   | {tag:'url', description:string, url:string}
 *   | {tag:'aes', description:string, secret:(string|null), decryptError:boolean}>}
 */
export async function resolveSuccessAction(action, preimage) {
  if (!action) return null;
  switch (action.tag) {
    case 'message':
      return { tag: 'message', message: action.message };
    case 'url':
      return { tag: 'url', description: action.description, url: action.url };
    case 'aes':
      try {
        const secret = await decryptAesSuccessAction(action, preimage);
        return { tag: 'aes', description: action.description, secret, decryptError: false };
      } catch (err) {
        console.warn('[successAction] aes decryption failed:', err);
        return { tag: 'aes', description: action.description, secret: null, decryptError: true };
      }
    default:
      return null;
  }
}
