/**
 * The phone number in a `tel:` link (RFC 3966), the way a phone number is
 * put in a QR code ("A tel URI should be used to encode a telephone number",
 * zxing's barcode contents guide).
 *
 * Read in the RFC's own form, and only the parts a payment can use:
 *   - a global number, the form the RFC says SHOULD be used (5.1.4): `+`,
 *     the country code and the number, with any of the visual separators
 *     `-` `.` `(` `)` it MAY contain (5.1.1): `tel:+254-712-345-678`;
 *   - a local number with the context the RFC requires of one ("Local
 *     numbers MUST have a 'phone-context' parameter", 5.1.5), when that
 *     context is a global number prefix: `tel:0712345678;phone-context=+254`.
 *     What the context means is the reader's to decide
 *     (services/lnAddressServices/phoneNumbers.js).
 * In any case: "URI comparisons are case-insensitive" (4).
 *
 * Not read: a local number without a context (the RFC forbids one, and its
 * digits alone do not say which country it is in), a context that is a
 * domain name (a numbering plan of its own, such as a company's
 * extensions), an extension or an ISDN sub-address (they reach past the
 * number), any other parameter, a space, a percent-encoded character, a
 * `//`, a query, and `*`, `#` or letters.
 *
 * Pure and synchronous. No pattern here has a nested or overlapping repeat,
 * so a long text is read in linear time.
 */

/** `tel:`, then a global number, or a local number and its global-number context. */
const TEL_URI = /^tel:(?:(\+[0-9().-]+)|([0-9().-]+);phone-context=(\+[0-9().-]+))$/i;

/** The RFC's numbers hold at least one digit among their separators. */
const HAS_DIGIT = /[0-9]/;

/**
 * Whether `text` is a `tel:` link at all, readable or not.
 * @param {unknown} text
 * @returns {boolean}
 */
export function isTelUri(text) {
  return typeof text === 'string' && /^tel:/i.test(text.trim());
}

/**
 * The number a `tel:` link calls, or null when the text is not one this
 * reads (see the top of this file).
 *
 * @param {unknown} text
 * @returns {{ number: string, phoneContext: string|null }|null}
 *   `number` as written, with its separators (and its `+`, for a global
 *   number). `phoneContext` as written for a local number; null for a
 *   global one.
 */
export function parseTelUri(text) {
  if (typeof text !== 'string') return null;
  const match = TEL_URI.exec(text.trim());
  if (!match) return null;
  const [, global, local, phoneContext = null] = match;
  const number = global ?? local;
  if (!HAS_DIGIT.test(number) || (phoneContext !== null && !HAS_DIGIT.test(phoneContext))) return null;
  return { number, phoneContext };
}
