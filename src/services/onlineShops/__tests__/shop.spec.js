/**
 * onlineShops/shop — unified model helpers.
 *
 * Coverage focus:
 *   - normalizeHost strips scheme/www/port/path and rejects junk
 *   - codeToFlag maps alpha-2 -> emoji and worldwide/unknown -> globe
 *   - mapCategory collapses casing dupes + bespoke labels to the canon
 *   - mergeShops dedupes by host, keeps the higher-priority source, fills
 *     empty fields, merges payments, and promotes a Nostr lnAddress
 *   - sortShops ranks verified > payable > lightning > name
 *
 * Run: node src/services/onlineShops/__tests__/shop.spec.js
 */

import { strict as assert } from 'node:assert';
import {
  normalizeHost, codeToFlag, mapCategory, mergeShops, sortShops,
} from '../shop.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (err) { console.error(`  ✗ ${name}`); console.error(`    ${err.message}`); failed += 1; }
}

const shop = (over = {}) => ({
  id: 'x', name: 'X', description: '', website: '', host: '', category: 'other',
  country: null, payments: { lightning: null, onchain: null },
  source: 'listings', sources: ['listings'], lnAddress: null, logoUrl: null,
  verified: false, raw: {}, ...over,
});

// ── normalizeHost ───────────────────────────────────────────────────────────
test('normalizeHost strips scheme/www/path/query and lowercases', () => {
  assert.equal(normalizeHost('https://WWW.Sats.Coffee/beans/?ref=x'), 'sats.coffee');
  assert.equal(normalizeHost('http://shop.example.com:8080/a'), 'shop.example.com');
  assert.equal(normalizeHost('example.org'), 'example.org');
});
test('normalizeHost rejects junk (no dot / spaces)', () => {
  assert.equal(normalizeHost('not a url'), '');
  assert.equal(normalizeHost('localhost'), '');
  assert.equal(normalizeHost(''), '');
});

// ── codeToFlag ──────────────────────────────────────────────────────────────
test('codeToFlag maps alpha-2 to emoji, worldwide/unknown to globe', () => {
  assert.equal(codeToFlag('US'), '\u{1F1FA}\u{1F1F8}');
  assert.equal(codeToFlag('at'), '\u{1F1E6}\u{1F1F9}');
  assert.equal(codeToFlag('WW'), '\u{1F30D}');
  assert.equal(codeToFlag('GLOBAL'), '\u{1F30D}');
  assert.equal(codeToFlag('xxx'), '\u{1F30D}');
});

// ── mapCategory ─────────────────────────────────────────────────────────────
test('mapCategory collapses casing dupes + bespoke labels', () => {
  assert.equal(mapCategory('listings', 'Food & Beverages'), 'food');
  assert.equal(mapCategory('listings', 'food & Beverages'), 'food');
  assert.equal(mapCategory('listings', 'E-commerce'), 'ecommerce');
  assert.equal(mapCategory('btcpay', 'clothing'), 'ecommerce');
  assert.equal(mapCategory('btcpay', 'hosting'), 'tech');
  assert.equal(mapCategory('listings', 'Charity'), 'charity');
  assert.equal(mapCategory('listings', ''), 'other');
  assert.equal(mapCategory('listings', 'Wholesale Llamas'), 'other');
});

test('mapCategory avoids short-token false positives (apparel/barber/department)', () => {
  assert.equal(mapCategory('listings', 'Apparel'), 'ecommerce'); // not tech via "app"
  assert.equal(mapCategory('btcpay', 'Department Store'), 'ecommerce'); // not media via "art"
  assert.equal(mapCategory('btcpay', 'Barbershop'), 'services'); // not food via "bar"
  assert.equal(mapCategory('listings', 'Art & Collectibles'), 'media');
  assert.equal(mapCategory('listings', 'App'), 'tech'); // still caught
});

// ── mergeShops ──────────────────────────────────────────────────────────────
test('mergeShops dedupes by host, keeps higher-priority source, records both', () => {
  const a = shop({ id: 'listings:1', host: 'sats.coffee', website: 'https://sats.coffee', source: 'listings', sources: ['listings'], name: 'Sats Coffee', country: { code: 'AT', name: 'Austria', flag: '' } });
  const b = shop({ id: 'btcpay:sats.coffee', host: 'sats.coffee', website: 'https://sats.coffee', source: 'btcpay', sources: ['btcpay'], name: 'Sats', payments: { lightning: null, onchain: true } });
  const out = mergeShops([a], [b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'listings'); // listings outranks btcpay
  assert.deepEqual(out[0].sources.sort(), ['btcpay', 'listings']);
  assert.equal(out[0].payments.onchain, true); // filled from btcpay
});

test('mergeShops promotes a Nostr lnAddress onto a website shop', () => {
  const web = shop({ id: 'listings:1', host: 'shop.com', website: 'https://shop.com', source: 'listings', sources: ['listings'], lnAddress: null });
  const nostr = shop({ id: 'nostr:abc', host: 'shop.com', website: 'https://shop.com', source: 'nostr', sources: ['nostr'], lnAddress: 'pay@shop.com' });
  const out = mergeShops([web], [nostr]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'listings'); // canonical stays listings
  assert.equal(out[0].lnAddress, 'pay@shop.com'); // promoted -> "Pay with BuhoGO"
});

test('mergeShops never dedupes hostless (nostr-only) stalls', () => {
  const s1 = shop({ id: 'nostr:a', host: '', source: 'nostr', lnAddress: 'a@x.com' });
  const s2 = shop({ id: 'nostr:b', host: '', source: 'nostr', lnAddress: 'b@y.com' });
  const out = mergeShops([s1, s2]);
  assert.equal(out.length, 2);
});

// ── sortShops ───────────────────────────────────────────────────────────────
test('sortShops ranks verified > payable > lightning > name', () => {
  const verified = shop({ name: 'Z', verified: true });
  const payable = shop({ name: 'M', lnAddress: 'a@b.com' });
  const ln = shop({ name: 'A', payments: { lightning: true, onchain: null } });
  const plain = shop({ name: 'B' });
  const out = sortShops([plain, ln, payable, verified]);
  assert.deepEqual(out.map((s) => s.name), ['Z', 'M', 'A', 'B']);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
