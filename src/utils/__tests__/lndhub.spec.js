/**
 * LNbits LNDhub URI parser tests.
 *
 * This boundary takes an untrusted pasted/scanned string and decides
 * which LNbits server + admin key we'll connect to. A regression that
 * mis-derives the server URL (e.g. dropping a sub-path) or grabs the
 * wrong half of `login:key` would point the wallet at the wrong place,
 * so the shapes LNbits actually emits are pinned here.
 *
 * Run with the Node runtime directly (matches lud4.spec.js):
 *   node src/utils/__tests__/lndhub.spec.js
 */

import { strict as assert } from 'node:assert';

import { isLndhubUri, parseLndhubUri } from '../lndhub.js';

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

console.log('lndhub');

// The canonical string LNbits' LNDhub extension hands out.
const ADMIN_URI =
  'lndhub://admin:50a5b49d9adc4ae6851347f56695e12b@https://demo.lnbits.com/lndhub/ext/';

// ---------------------------------------------------------------------------
// isLndhubUri
// ---------------------------------------------------------------------------

test('isLndhubUri accepts the lndhub scheme (any case, surrounding space)', () => {
  assert.equal(isLndhubUri(ADMIN_URI), true);
  assert.equal(isLndhubUri('  LNDHUB://admin:k@https://x/lndhub/ext/  '), true);
});

test('isLndhubUri rejects non-lndhub / non-string input', () => {
  assert.equal(isLndhubUri('https://demo.lnbits.com'), false);
  assert.equal(isLndhubUri('50a5b49d9adc4ae6851347f56695e12b'), false);
  assert.equal(isLndhubUri(''), false);
  assert.equal(isLndhubUri(null), false);
  assert.equal(isLndhubUri(undefined), false);
  assert.equal(isLndhubUri(123), false);
});

// ---------------------------------------------------------------------------
// parseLndhubUri — happy path
// ---------------------------------------------------------------------------

test('parses the canonical LNbits admin URI', () => {
  assert.deepEqual(parseLndhubUri(ADMIN_URI), {
    serverUrl: 'https://demo.lnbits.com',
    adminKey: '50a5b49d9adc4ae6851347f56695e12b',
    login: 'admin',
  });
});

test('tolerates surrounding whitespace', () => {
  assert.deepEqual(parseLndhubUri(`\n  ${ADMIN_URI}  \n`), {
    serverUrl: 'https://demo.lnbits.com',
    adminKey: '50a5b49d9adc4ae6851347f56695e12b',
    login: 'admin',
  });
});

test('host without trailing slash on the path still parses', () => {
  const out = parseLndhubUri('lndhub://admin:abc123@https://demo.lnbits.com/lndhub/ext');
  assert.equal(out.serverUrl, 'https://demo.lnbits.com');
  assert.equal(out.adminKey, 'abc123');
});

test('preserves a sub-path LNbits install (origin would lose it)', () => {
  const out = parseLndhubUri('lndhub://admin:KEY@https://example.com/lnbits/lndhub/ext/');
  assert.equal(out.serverUrl, 'https://example.com/lnbits');
  assert.equal(out.adminKey, 'KEY');
});

test('keeps a non-standard port', () => {
  const out = parseLndhubUri('lndhub://admin:KEY@http://localhost:5000/lndhub/ext/');
  assert.equal(out.serverUrl, 'http://localhost:5000');
});

test('lowercases the login token but never the key', () => {
  const out = parseLndhubUri('lndhub://Invoice:AbCdEf@https://demo.lnbits.com/lndhub/ext/');
  assert.equal(out.login, 'invoice');
  assert.equal(out.adminKey, 'AbCdEf');
});

test('prepends https when the host omits a scheme', () => {
  const out = parseLndhubUri('lndhub://admin:KEY@demo.lnbits.com/lndhub/ext/');
  assert.equal(out.serverUrl, 'https://demo.lnbits.com');
});

// ---------------------------------------------------------------------------
// parseLndhubUri — rejections
// ---------------------------------------------------------------------------

test('rejects a non-lndhub string', () => {
  assert.equal(parseLndhubUri('https://demo.lnbits.com'), null);
  assert.equal(parseLndhubUri('50a5b49d9adc4ae6851347f56695e12b'), null);
});

test('rejects a generic (non-LNbits) LndHub server with no /lndhub/ext path', () => {
  // A BlueWallet-style export we can't drive through the LNbits REST API.
  assert.equal(parseLndhubUri('lndhub://login:pass@https://lndhub.herokuapp.com'), null);
});

test('rejects when login or key is missing', () => {
  assert.equal(parseLndhubUri('lndhub://admin@https://demo.lnbits.com/lndhub/ext/'), null);
  assert.equal(parseLndhubUri('lndhub://admin:@https://demo.lnbits.com/lndhub/ext/'), null);
});

test('rejects when the host is missing', () => {
  assert.equal(parseLndhubUri('lndhub://admin:KEY@'), null);
  assert.equal(parseLndhubUri('lndhub://admin:KEY'), null);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
