// Signs a BOLT11 test invoice (random key, so unpayable) for scripts/check-bitrefill.mjs.
// Usage: node scripts/fixtures/bitrefill-invoice.mjs <sats> "<memo>" [age in seconds]
import { bech32 } from 'bech32';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from 'node:crypto';

const sats = Number(process.argv[2] || 139846);
const memo = process.argv[3] || 'Bitrefill order';
const hrp = `lnbc${sats * 10}n`;
const toWords = (bytes) => bech32.toWords(bytes);
const intWords = (n, len) => { const w = []; for (let i = len - 1; i >= 0; i--) w.push(Math.floor(n / 2 ** (5 * i)) % 32); return w; };
const tag = (code, words) => [code, ...intWords(words.length, 2), ...words];
const T = { p: 1, s: 16, d: 13, x: 6, c: 24, n: 19 };
const ageSeconds = Number(process.argv[4] || 0);
let data = intWords(Math.floor(Date.now() / 1000) - ageSeconds, 7);
data = data.concat(tag(T.p, toWords(randomBytes(32))));
data = data.concat(tag(T.s, toWords(randomBytes(32))));
data = data.concat(tag(T.d, toWords(Buffer.from(memo, 'utf8'))));
data = data.concat(tag(T.x, intWords(600, 2)));
data = data.concat(tag(T.c, intWords(80, 2)));
const priv = secp256k1.utils.randomSecretKey();
// signing data = hrp bytes + data words packed into bytes (zero padded)
const bits = data.flatMap((w) => intWords(w, 1).map(() => w.toString(2).padStart(5, '0'))).join('');
const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0');
const dataBytes = Buffer.from(padded.match(/.{8}/g).map((b) => parseInt(b, 2)));
const msg = sha256(Buffer.concat([Buffer.from(hrp, 'utf8'), dataBytes]));
const rec = secp256k1.sign(msg, priv, { prehash: false, format: 'recovered' }); // [recovery, r, s]
const sigBytes = Buffer.concat([Buffer.from(rec.slice(1)), Buffer.from([rec[0]])]);
data = data.concat(toWords(sigBytes));
console.log(bech32.encode(hrp, data, 2000));
