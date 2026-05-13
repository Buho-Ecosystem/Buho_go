/**
 * LUD-04 (LNURL-auth) parser + callback-builder tests.
 *
 * This boundary parses untrusted input from QR codes / pasted links and
 * decides whether we sign a challenge with the user's identity key. A
 * silent regression here would either (a) refuse legitimate sign-ins or
 * (b) accept malformed/insecure inputs that the user did not intend to
 * authorise. Both fail loudly here by design.
 *
 * Run with the Node runtime directly (matches identityCrypto.spec.js):
 *   node src/utils/__tests__/lud4.spec.js
 */

import { strict as assert } from 'node:assert';
import { bech32 } from 'bech32';

import {
  LUD04_ACTIONS,
  buildLud04Callback,
  decodeLnurlAuthInput,
  looksLikeLud04,
  parseLud04Input,
  parseLud04Url,
} from '../lud4.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    failed += 1;
  }
}

console.log('lud4');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a synthetic `lnurl1...` bech32 input from a plain URL. Mirrors
 * exactly what production sites do when they hand out a LUD-04 challenge.
 */
function lnurl1(url) {
  const bytes = new TextEncoder().encode(url);
  const words = bech32.toWords(bytes);
  return bech32.encode('lnurl', words, 4096);
}

const K1_HEX = 'a'.repeat(64); // 32 bytes of 0xaa — well-formed and arbitrary
const VALID_URL = `https://site.example/auth?tag=login&k1=${K1_HEX}`;

// ---------------------------------------------------------------------------
// decodeLnurlAuthInput
// ---------------------------------------------------------------------------

test('decodeLnurlAuthInput accepts bech32 lnurl1', () => {
  const out = decodeLnurlAuthInput(lnurl1(VALID_URL));
  assert.equal(out, VALID_URL);
});

test('decodeLnurlAuthInput strips lightning: prefix', () => {
  const out = decodeLnurlAuthInput('lightning:' + lnurl1(VALID_URL));
  assert.equal(out, VALID_URL);
});

test('decodeLnurlAuthInput strips LIGHTNING: prefix (case-insensitive)', () => {
  const out = decodeLnurlAuthInput('LIGHTNING:' + lnurl1(VALID_URL));
  assert.equal(out, VALID_URL);
});

test('decodeLnurlAuthInput accepts keyauth:// (LUD-17)', () => {
  const input = 'keyauth://site.example/auth?tag=login&k1=' + K1_HEX;
  const out = decodeLnurlAuthInput(input);
  assert.equal(out, `https://site.example/auth?tag=login&k1=${K1_HEX}`);
});

test('decodeLnurlAuthInput accepts lnurla:// (rare alias)', () => {
  const input = 'lnurla://site.example/auth?tag=login&k1=' + K1_HEX;
  const out = decodeLnurlAuthInput(input);
  assert.equal(out, `https://site.example/auth?tag=login&k1=${K1_HEX}`);
});

test('decodeLnurlAuthInput rejects non-string input', () => {
  assert.throws(() => decodeLnurlAuthInput(null), TypeError);
  assert.throws(() => decodeLnurlAuthInput(undefined), TypeError);
  assert.throws(() => decodeLnurlAuthInput(42), TypeError);
  assert.throws(() => decodeLnurlAuthInput({}), TypeError);
});

test('decodeLnurlAuthInput rejects unknown schemes', () => {
  assert.throws(() => decodeLnurlAuthInput('https://site.example/whatever'), /Not a LUD-04 input/);
  assert.throws(() => decodeLnurlAuthInput('lnurlp://site.example/...'), /Not a LUD-04 input/);
  assert.throws(() => decodeLnurlAuthInput('plain text'), /Not a LUD-04 input/);
});

test('decodeLnurlAuthInput rejects wrong bech32 HRP', () => {
  const wrongHrp = bech32.encode('lnbc', bech32.toWords(new TextEncoder().encode('x')), 4096);
  assert.throws(() => decodeLnurlAuthInput(wrongHrp), /Not a LUD-04 input/);
});

// ---------------------------------------------------------------------------
// parseLud04Url — happy path
// ---------------------------------------------------------------------------

test('parseLud04Url returns the documented shape on a valid URL', () => {
  const result = parseLud04Url(VALID_URL);
  assert.ok(result.url instanceof URL);
  assert.equal(result.domain, 'site.example');
  assert.equal(result.tag, 'login');
  assert.equal(result.action, 'login');
  assert.equal(result.k1Hex, K1_HEX);
  assert.ok(result.k1 instanceof Uint8Array);
  assert.equal(result.k1.length, 32);
  for (let i = 0; i < 32; i += 1) assert.equal(result.k1[i], 0xaa);
});

test('parseLud04Url lowercases the domain', () => {
  const result = parseLud04Url(`https://Site.EXAMPLE/x?tag=login&k1=${K1_HEX}`);
  assert.equal(result.domain, 'site.example');
});

test('parseLud04Url preserves the full URL for callback construction', () => {
  const url = `https://site.example/x?tag=login&k1=${K1_HEX}&extra=keep`;
  const result = parseLud04Url(url);
  assert.equal(result.url.searchParams.get('extra'), 'keep');
});

// ---------------------------------------------------------------------------
// parseLud04Url — every defined action plus the default-on-missing path
// ---------------------------------------------------------------------------

for (const action of LUD04_ACTIONS) {
  test(`parseLud04Url accepts action=${action}`, () => {
    const result = parseLud04Url(`https://site.example/x?tag=login&k1=${K1_HEX}&action=${action}`);
    assert.equal(result.action, action);
  });
}

test('parseLud04Url defaults action to login when missing', () => {
  const result = parseLud04Url(`https://site.example/x?tag=login&k1=${K1_HEX}`);
  assert.equal(result.action, 'login');
});

test('parseLud04Url falls back to login when action is unknown', () => {
  // A buggy service handing out a non-spec action shouldn't dead-end us.
  const result = parseLud04Url(`https://site.example/x?tag=login&k1=${K1_HEX}&action=bogus`);
  assert.equal(result.action, 'login');
});

// ---------------------------------------------------------------------------
// parseLud04Url — security: HTTPS-only
// ---------------------------------------------------------------------------

test('parseLud04Url rejects http: with LUD04_INSECURE_SCHEME', () => {
  const httpUrl = `http://site.example/x?tag=login&k1=${K1_HEX}`;
  try {
    parseLud04Url(httpUrl);
    assert.fail('expected parseLud04Url to throw on http://');
  } catch (err) {
    assert.equal(err.code, 'LUD04_INSECURE_SCHEME');
    assert.match(err.message, /HTTPS/);
  }
});

test('parseLud04Url rejects http: even on localhost', () => {
  // Explicit: no localhost exception. Dev environments use HTTPS too.
  const httpUrl = `http://localhost:8080/x?tag=login&k1=${K1_HEX}`;
  assert.throws(() => parseLud04Url(httpUrl), err => err.code === 'LUD04_INSECURE_SCHEME');
});

test('parseLud04Url rejects exotic schemes', () => {
  assert.throws(() => parseLud04Url(`ftp://site.example/x?tag=login&k1=${K1_HEX}`));
  assert.throws(() => parseLud04Url(`file:///etc/passwd?tag=login&k1=${K1_HEX}`));
  assert.throws(() => parseLud04Url(`javascript:alert(1)`));
});

// ---------------------------------------------------------------------------
// parseLud04Url — malformed inputs
// ---------------------------------------------------------------------------

test('parseLud04Url rejects an invalid URL', () => {
  assert.throws(() => parseLud04Url('not a url at all'), /valid URL/);
});

test('parseLud04Url rejects tag != login', () => {
  assert.throws(
    () => parseLud04Url(`https://site.example/x?tag=withdraw&k1=${K1_HEX}`),
    /tag=withdraw/,
  );
});

test('parseLud04Url rejects missing tag', () => {
  assert.throws(
    () => parseLud04Url(`https://site.example/x?k1=${K1_HEX}`),
    /tag=none/,
  );
});

test('parseLud04Url rejects missing k1', () => {
  assert.throws(
    () => parseLud04Url(`https://site.example/x?tag=login`),
    /missing the k1 challenge/,
  );
});

test('parseLud04Url rejects non-hex k1', () => {
  assert.throws(
    () => parseLud04Url(`https://site.example/x?tag=login&k1=not-hex-content`),
    /not valid hex/,
  );
});

test('parseLud04Url rejects k1 with wrong length', () => {
  assert.throws(
    () => parseLud04Url(`https://site.example/x?tag=login&k1=ff`),
    /must be 32 bytes/,
  );
  assert.throws(
    () => parseLud04Url(`https://site.example/x?tag=login&k1=${'a'.repeat(62)}`),
    /must be 32 bytes/,
  );
});

// ---------------------------------------------------------------------------
// parseLud04Input — end-to-end (bech32 → parsed shape)
// ---------------------------------------------------------------------------

test('parseLud04Input round-trips through bech32', () => {
  const result = parseLud04Input(lnurl1(VALID_URL));
  assert.equal(result.k1Hex, K1_HEX);
  assert.equal(result.domain, 'site.example');
  assert.equal(result.action, 'login');
});

test('parseLud04Input rejects http: bech32 too', () => {
  // The HTTPS-only check must fire after bech32 decoding, otherwise a
  // bech32-wrapped http URL would slip through. Pin that explicitly.
  const httpBech32 = lnurl1(`http://site.example/x?tag=login&k1=${K1_HEX}`);
  assert.throws(() => parseLud04Input(httpBech32), err => err.code === 'LUD04_INSECURE_SCHEME');
});

// ---------------------------------------------------------------------------
// buildLud04Callback
// ---------------------------------------------------------------------------

test('buildLud04Callback appends sig and key, preserves existing params', () => {
  const sig = new Uint8Array([0x30, 0x44, 0x02, 0x20]); // DER prefix
  const pub = new Uint8Array(33).fill(0x02);
  const original = new URL(`https://site.example/x?tag=login&k1=${K1_HEX}&extra=keep`);
  const callback = buildLud04Callback(original, sig, pub);
  const cb = new URL(callback);
  assert.equal(cb.searchParams.get('tag'), 'login');
  assert.equal(cb.searchParams.get('k1'), K1_HEX);
  assert.equal(cb.searchParams.get('extra'), 'keep');
  assert.equal(cb.searchParams.get('sig'), '30440220');
  assert.equal(cb.searchParams.get('key'), '02'.repeat(33));
});

test('buildLud04Callback does not mutate the input URL', () => {
  const sig = new Uint8Array([0x30]);
  const pub = new Uint8Array(33);
  const original = new URL(`https://site.example/x?tag=login&k1=${K1_HEX}`);
  const before = original.toString();
  buildLud04Callback(original, sig, pub);
  // The contract is that callers can keep the parsed URL for display
  // after the callback is built; mutation would surprise them.
  assert.equal(original.toString(), before);
});

// ---------------------------------------------------------------------------
// looksLikeLud04 — dispatch hint (no decoding)
// ---------------------------------------------------------------------------

test('looksLikeLud04 returns true for plain lnurl1 strings', () => {
  assert.equal(looksLikeLud04(lnurl1(VALID_URL)), true);
});

test('looksLikeLud04 strips lightning: before checking', () => {
  assert.equal(looksLikeLud04('lightning:' + lnurl1(VALID_URL)), true);
});

test('looksLikeLud04 returns true for LUD-17 schemes', () => {
  assert.equal(looksLikeLud04('keyauth://site.example'), true);
  assert.equal(looksLikeLud04('lnurla://site.example'), true);
});

test('looksLikeLud04 returns false for payment LNURL schemes', () => {
  // These share the lnurl-family but are NOT LUD-04. Misclassifying
  // them would cause the auth dialog to open on a payment challenge.
  assert.equal(looksLikeLud04('lnurlp://site.example'), false);
  assert.equal(looksLikeLud04('lnurlw://site.example'), false);
  assert.equal(looksLikeLud04('lnurlc://site.example'), false);
});

test('looksLikeLud04 returns false for non-string and empty input', () => {
  assert.equal(looksLikeLud04(null), false);
  assert.equal(looksLikeLud04(undefined), false);
  assert.equal(looksLikeLud04(123), false);
  assert.equal(looksLikeLud04(''), false);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
