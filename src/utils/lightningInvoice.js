import { Invoice } from '@getalby/lightning-tools';

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
    expiry: decoded.timestamp + (decoded.expiry ?? 3600),
  };
}
