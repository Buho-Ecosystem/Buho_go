import { APP_PACKAGE } from './publicCard.js';
import { BUHOGO_HOME } from './profileLink.js';

/** Strict input: never silently turn "1e3", "12oops" or fractional sats into a payment. */
export function profileAmountSats(value, { fiat = false, rate = 0 } = {}) {
  const input = String(value).trim().replace(',', '.');
  if (!(fiat ? /^\d+(?:\.\d{1,2})?$/ : /^\d+$/).test(input)) return 0;
  const amount = Number(input);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (fiat && (!Number.isFinite(rate) || rate <= 0)) return 0;
  const sats = fiat ? Math.floor(amount / rate * 100000000) : amount;
  return Number.isSafeInteger(sats * 1000) && sats > 0 ? sats : 0;
}

export function invoiceIsUsable(invoice, now = Date.now()) {
  return !!invoice?.invoice && Number.isFinite(invoice.expiresAt) && invoice.expiresAt > now;
}

/** An opaque lightning: URI targets BuhoGO's existing native payment handler. */
export function invoiceAppIntent(invoice) {
  // Only a BOLT11 string may enter intent syntax, never arbitrary URL fragments.
  if (!/^ln(?:bc|tb|bcrt|tbs)\d+[a-z0-9]*$/i.test(invoice || '')) return '';
  return `intent:${invoice}#Intent;scheme=lightning;package=${APP_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(BUHOGO_HOME)};end`;
}
