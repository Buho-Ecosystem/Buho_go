// Synthetic regtest fixture for local display tests only. Re-encoded, not re-signed:
// it must never be submitted to a wallet or used to make a payment.
import { bech32 } from 'bech32';
const original = 'lnbcrt45190n1p42dta6pp5g4ncw5dxn8qc4q5py4xwehshxfvfqqm5fl85rp5yef4act4x03lsdzu2pskjepqw3hjq3zf2dgycs2eyp2y2565ypz9y56gf9r9ggpgfaexgetjypy5gw3qgdfj6v3sxgmrqwf3xvknqvps8y5scqzzsxqzuysp5esvpf02e8wlpsttednes9nl4p30k30adw3mu8a63q3yvhyfjqayq9qxpqysgqq8mwenpwd8t07qu9y5ev0ngh98xhxssxfxyp89qupqnu47tgf8gqk2zvd8n3jf4fv922jceyqc5uzefxry0lvnp7xcckzxar8l8uxlqpht6qxr';
export function profileInvoiceFixture(amountSats = 1000, now = Date.now()) {
  const words = [...bech32.decode(original, 4096).words];
  let timestamp = Math.floor(now / 1000);
  for (let i = 6; i >= 0; i--) {
    words[i] = timestamp % 32;
    timestamp = Math.floor(timestamp / 32);
  }
  return bech32.encode(`lnbcrt${amountSats * 10}n`, words, 4096);
}
