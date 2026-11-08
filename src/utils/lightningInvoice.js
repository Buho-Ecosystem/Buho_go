import { Invoice } from '@getalby/lightning-tools';
import { bech32 } from 'bech32';
import { bytesToHex } from '@noble/hashes/utils.js';

// A BOLT11 invoice's data: a 35-bit timestamp (7 words), tagged fields, then
// a 65-byte signature (104 words). Tag `h` (23) holds the SHA-256 of the
// description the invoice pays for, 256 bits in 52 words.
const TIMESTAMP_WORDS = 7;
const SIGNATURE_WORDS = 104;
const DESCRIPTION_HASH_TAG = 23;
const DESCRIPTION_HASH_WORDS = 52;

/**
 * The description hash an invoice carries (BOLT11 tag `h`), as lowercase
 * hex, or null when it carries none or cannot be read. LNURL-pay binds the
 * invoice to the pay request through it (LUD-06).
 * @param {string} invoice  a BOLT11 invoice, without a `lightning:` prefix
 * @returns {string|null}
 */
export function invoiceDescriptionHash(invoice) {
  let words;
  try {
    ({ words } = bech32.decode(String(invoice).toLowerCase(), Number.MAX_SAFE_INTEGER));
  } catch {
    return null;
  }
  const end = words.length - SIGNATURE_WORDS;
  for (let i = TIMESTAMP_WORDS; i + 3 <= end;) {
    const length = words[i + 1] * 32 + words[i + 2];
    if (i + 3 + length > end) return null;
    if (words[i] === DESCRIPTION_HASH_TAG && length === DESCRIPTION_HASH_WORDS) {
      const bytes = bech32.fromWordsUnsafe(words.slice(i + 3, i + 3 + length));
      return bytes && bytes.length === 32 ? bytesToHex(Uint8Array.from(bytes)) : null;
    }
    i += 3 + length;
  }
  return null;
}

/** Decode the invoice selected by the send flow, including BIP21 lightning=. */
export function parseLightningInvoice(input) {
  const invoice = input.trim().replace(/^lightning:/i, '').trim();
  // Use the BOLT11 decoder so every supported network and amount unit is
  // handled, and malformed invoices do not become amountless requests.
  const decoded = new Invoice({ pr: invoice });
  return {
    invoice,
    amount: decoded.satoshi,
    description: decoded.description || '',
    descriptionHash: invoiceDescriptionHash(invoice),
    expiry: decoded.timestamp + (decoded.expiry ?? 3600),
  };
}
