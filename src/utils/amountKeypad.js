/**
 * The amount keypad's rules (components/AmountKeypad.vue), kept free of Vue
 * so they can be tested on their own.
 *
 * The keypad edits a raw string in one unit at a time: whole sats, or fiat
 * with up to two decimals. The other unit is derived from the exchange rate
 * (fiat per bitcoin); without a rate there is only sats.
 */

/** Longest raw input, so the amount stays readable on one line. */
export const KEYPAD_MAX_LENGTH = 12;

const SATS_PER_BTC = 100_000_000;

/** Fiat to whole sats, rounded down; 0 without a rate. */
export function fiatToSats(fiat, rate) {
  if (!rate || !(fiat > 0)) return 0;
  return Math.floor((fiat / rate) * SATS_PER_BTC);
}

/** Sats to fiat; 0 without a rate. */
export function satsToFiat(sats, rate) {
  if (!rate || !(sats > 0)) return 0;
  return (sats / SATS_PER_BTC) * rate;
}

/** The sats a raw keypad value stands for. */
export function keypadSats(value, { fiat, rate }) {
  return fiat ? fiatToSats(parseFloat(value) || 0, rate) : parseInt(value, 10) || 0;
}

/**
 * The raw value after one key:
 * - digits append, collapsing leading zeros ('0' then '5' is '5', but '0.5' stays)
 * - '000' (sats) appends three zeros
 * - '.' (fiat) adds the decimal point once
 * - 'del' removes the last character
 * Fiat keeps two decimals at most, and the value never grows past
 * KEYPAD_MAX_LENGTH.
 */
export function applyKeypadKey(value, key, { fiat }) {
  if (key === 'del') return value.slice(0, -1);
  if (key === '.') return value.includes('.') ? value : `${value || '0'}.`;
  if (value.length >= KEYPAD_MAX_LENGTH) return value;
  if (fiat && value.includes('.') && value.split('.')[1].length >= 2) return value;

  let next = value + key;
  while (next.length > 1 && next.startsWith('0') && !next.startsWith('0.')) next = next.slice(1);
  return next.slice(0, KEYPAD_MAX_LENGTH);
}

/**
 * Switch the unit typed in, converting the value so the amount stays the
 * same (sats round down, fiat keeps two decimals). Null without a rate.
 */
export function swapKeypadUnit(value, { fiat, rate }) {
  if (!rate) return null;
  const sats = keypadSats(value, { fiat, rate });
  if (fiat) return { value: sats > 0 ? String(sats) : '', fiat: false };
  const amount = satsToFiat(sats, rate);
  return { value: amount > 0 ? amount.toFixed(2) : '', fiat: true };
}

/** "1234567.5" becomes "1,234,567.5": groups the whole part, keeps the typed decimals. */
export function groupFiatInput(value, locale = 'en-US') {
  if (!value) return '0';
  const [whole, decimals] = String(value).split('.');
  const grouped = Number(whole || 0).toLocaleString(locale);
  const separator = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')?.value || '.';
  return decimals !== undefined ? `${grouped}${separator}${decimals}` : grouped;
}
