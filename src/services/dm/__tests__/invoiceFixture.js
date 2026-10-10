/**
 * A structurally valid BOLT-11 invoice for tests (unsigned; the decoder
 * tolerates that). Same encoder as `requests.spec.js` and `protocol.spec.js`,
 * kept here so the runtime and boot specs can mint invoices without a wallet.
 *
 * Test helper only: not imported by application code.
 */

import { bytesToHex } from '@noble/hashes/utils.js';

export const NOW = 1_760_000_000;
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) if ((top >>> i) & 1) chk ^= GENERATORS[i];
  }
  return chk;
}

function bech32Encode(hrp, words) {
  const expanded = [...[...hrp].map((c) => c.charCodeAt(0) >>> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const mod = polymod([...expanded, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + '1' + [...words, ...checksum].map((w) => CHARSET[w]).join('');
}

const numberToWords = (value, count) => Array.from({ length: count }, (_, i) => Math.floor(value / 32 ** (count - 1 - i)) % 32);

function bytesToWords(bytes) {
  const words = [];
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >> bits) & 31);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  return words;
}

const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g), (pair) => parseInt(pair, 16));

/** A structurally valid BOLT-11 invoice (unsigned; the decoder tolerates that). */
function makeInvoice({ sats, network = 'bc', timestamp = NOW, expiry = 3_600, hash = 1 } = {}) {
  const amount = sats === undefined ? '' : `${sats * 10}n`;
  const paymentHash = typeof hash === 'string'
    ? hexToBytes(hash)
    : Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + hash) % 256);
  const tag = (type, words) => [type, ...numberToWords(words.length, 2), ...words];
  const words = [
    ...numberToWords(timestamp, 7),
    ...tag(1, bytesToWords(paymentHash)),
    ...tag(6, numberToWords(expiry, 3)),
    ...bytesToWords(Uint8Array.from({ length: 65 }, (_, i) => (i + 1) % 251)),
  ];
  return { bolt11: bech32Encode(`ln${network}${amount}`, words), paymentHash: bytesToHex(paymentHash) };
}

export { makeInvoice };
