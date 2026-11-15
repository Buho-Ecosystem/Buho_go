import { Invoice } from '@getalby/lightning-tools';

/** A payment request counts in thousandths of the smallest Bitcoin unit. */
const MSAT_PER_SAT = 1000;

/**
 * The one whole figure for an amount a request names in thousandths. Wallets
 * and screens count in whole units, so the amount is rounded up, here and
 * nowhere else: the review, the paid screen and the records all show this
 * figure, and it is never below what leaves the wallet.
 * @param {number} msat
 * @returns {number} whole sats; 0 when there is no amount
 */
export function wholeSats(msat) {
  const amount = Number(msat);
  return Number.isFinite(amount) && amount > 0 ? Math.ceil(amount / MSAT_PER_SAT) : 0;
}

/**
 * What a decoded BOLT11 invoice asks for in its own unit, exact (the decoder
 * hands it over divided by a thousand); 0 when it names no amount. For a
 * check that an invoice is for exactly the amount asked for.
 * @param {{ satoshi?: number }} decoded  an Invoice of the decoder library
 * @returns {number} msat
 */
export function invoiceMsat(decoded) {
  return Math.round((Number(decoded?.satoshi) || 0) * MSAT_PER_SAT);
}

/**
 * What a decoded BOLT11 invoice asks for as the whole figure to show and
 * record (see wholeSats); 0 when it names no amount. Every decoder of an
 * invoice's amount reads it through here.
 * @param {{ satoshi?: number }} decoded  an Invoice of the decoder library
 * @returns {number} whole sats
 */
export function invoiceSats(decoded) {
  return wholeSats(invoiceMsat(decoded));
}

/**
 * Decode the invoice selected by the send flow, including BIP21 lightning=.
 * `amount` is the whole figure (invoiceSats), `amountMsat` the exact one.
 */
export function parseLightningInvoice(input) {
  const invoice = input.trim().replace(/^lightning:/i, '').trim();
  // Use the BOLT11 decoder so every supported network and amount unit is
  // handled, and malformed invoices do not become amountless requests.
  const decoded = new Invoice({ pr: invoice });
  return {
    invoice,
    amount: invoiceSats(decoded),
    amountMsat: invoiceMsat(decoded),
    description: decoded.description || '',
    expiry: decoded.timestamp + (decoded.expiry ?? 3600),
  };
}
