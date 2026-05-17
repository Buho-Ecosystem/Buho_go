/**
 * NWC connection-string parser tests.
 *
 * Covers every prefix variant seen in the wild plus the structural
 * validation paths (missing relay/secret, malformed pubkey, etc.).
 * These tests are the contract the three scanner call sites and the
 * Settings manual-input validator rely on — break one and you'll
 * silently break wallet onboarding for some users.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/nwcConnection.spec.js
 */

import { strict as assert } from 'node:assert';
import { parseNwcConnection, NwcParseReason, isValidNwcConnection } from '../nwcConnection.js';

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

// Spec example from NIP-47.
const PK = 'b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4';
const SECRET = '71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c';
const RELAY = 'wss://nostr.bitcoiner.social';
const RELAY_ENC = encodeURIComponent(RELAY);

// ─── Accepted prefix variants ────────────────────────────────────────

test('canonical nostr+walletconnect:// parses cleanly', () => {
  const r = parseNwcConnection(`nostr+walletconnect://${PK}?relay=${RELAY_ENC}&secret=${SECRET}`);
  assert.equal(r.ok, true);
  assert.equal(r.pubkey, PK);
  assert.equal(r.relay, RELAY);
  assert.equal(r.secret, SECRET);
});

test('no-authority form (nostr+walletconnect:) is accepted and normalised to ://', () => {
  const r = parseNwcConnection(`nostr+walletconnect:${PK}?relay=${RELAY_ENC}&secret=${SECRET}`);
  assert.equal(r.ok, true);
  assert(r.normalized.startsWith('nostr+walletconnect://'), 'expected canonical normalisation');
});

test('historical nostrwalletconnect:// (no `+`) is accepted', () => {
  const r = parseNwcConnection(`nostrwalletconnect://${PK}?relay=${RELAY_ENC}&secret=${SECRET}`);
  assert.equal(r.ok, true);
});

test('historical nostrwalletconnect: (no `+`, no authority) is accepted', () => {
  const r = parseNwcConnection(`nostrwalletconnect:${PK}?relay=${RELAY_ENC}&secret=${SECRET}`);
  assert.equal(r.ok, true);
});

test('web+nostrwalletconnect:// browser-handler prefix is accepted', () => {
  const r = parseNwcConnection(`web+nostrwalletconnect://${PK}?relay=${RELAY_ENC}&secret=${SECRET}`);
  assert.equal(r.ok, true);
});

test('uppercase scheme is accepted (RFC 3986 §3.1)', () => {
  const r = parseNwcConnection(`NOSTR+WALLETCONNECT://${PK}?relay=${RELAY_ENC}&secret=${SECRET}`);
  assert.equal(r.ok, true);
});

test('mixed-case scheme is accepted', () => {
  const r = parseNwcConnection(`Nostr+WalletConnect://${PK}?relay=${RELAY_ENC}&secret=${SECRET}`);
  assert.equal(r.ok, true);
});

test('lightning: deeplink wrapper is stripped', () => {
  const r = parseNwcConnection(`lightning:nostr+walletconnect://${PK}?relay=${RELAY_ENC}&secret=${SECRET}`);
  assert.equal(r.ok, true);
});

test('whitespace and trailing newlines are tolerated', () => {
  const r = parseNwcConnection(`  nostr+walletconnect://${PK}?relay=${RELAY_ENC}&secret=${SECRET}\n  `);
  assert.equal(r.ok, true);
});

test('ws:// relay is accepted (some local-dev setups)', () => {
  const r = parseNwcConnection(`nostr+walletconnect://${PK}?relay=${encodeURIComponent('ws://127.0.0.1:7777')}&secret=${SECRET}`);
  assert.equal(r.ok, true);
});

// ─── Optional lud16 handling ─────────────────────────────────────────

test('lud16 is preserved when present', () => {
  const r = parseNwcConnection(`nostr+walletconnect://${PK}?relay=${RELAY_ENC}&secret=${SECRET}&lud16=alice@example.com`);
  assert.equal(r.ok, true);
  assert.equal(r.lud16, 'alice@example.com');
});

test("lud16='null' literal is treated as absent (legacy server quirk)", () => {
  const r = parseNwcConnection(`nostr+walletconnect://${PK}?relay=${RELAY_ENC}&secret=${SECRET}&lud16=null`);
  assert.equal(r.ok, true);
  assert.equal(r.lud16, null);
});

test('lud16 is omitted from normalised form when absent', () => {
  const r = parseNwcConnection(`nostr+walletconnect://${PK}?relay=${RELAY_ENC}&secret=${SECRET}`);
  assert.equal(r.ok, true);
  assert(!r.normalized.includes('lud16'), 'absent lud16 should not appear in canonical output');
});

// ─── Rejected inputs ─────────────────────────────────────────────────

test('bunker:// (NIP-46) is rejected with reason=bunker', () => {
  const r = parseNwcConnection(`bunker://${PK}?relay=${RELAY_ENC}`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, NwcParseReason.Bunker);
});

test('empty / null / undefined / whitespace input returns reason=empty', () => {
  assert.equal(parseNwcConnection('').reason, NwcParseReason.Empty);
  assert.equal(parseNwcConnection(null).reason, NwcParseReason.Empty);
  assert.equal(parseNwcConnection(undefined).reason, NwcParseReason.Empty);
  assert.equal(parseNwcConnection('   ').reason, NwcParseReason.Empty);
});

test('non-NWC URIs are rejected with reason=wrongScheme', () => {
  assert.equal(parseNwcConnection('https://example.com').reason, NwcParseReason.WrongScheme);
  assert.equal(parseNwcConnection('lnurl1abc').reason, NwcParseReason.WrongScheme);
  assert.equal(parseNwcConnection('lnbc1xyz').reason, NwcParseReason.WrongScheme);
});

test('missing relay yields reason=missingRelay', () => {
  const r = parseNwcConnection(`nostr+walletconnect://${PK}?secret=${SECRET}`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, NwcParseReason.MissingRelay);
});

test('missing secret yields reason=missingSecret', () => {
  const r = parseNwcConnection(`nostr+walletconnect://${PK}?relay=${RELAY_ENC}`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, NwcParseReason.MissingSecret);
});

test('non-hex pubkey yields reason=invalidPubkey', () => {
  const r = parseNwcConnection(`nostr+walletconnect://zz889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=${RELAY_ENC}&secret=${SECRET}`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, NwcParseReason.InvalidPubkey);
});

test('short pubkey yields reason=invalidPubkey', () => {
  const r = parseNwcConnection(`nostr+walletconnect://abc?relay=${RELAY_ENC}&secret=${SECRET}`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, NwcParseReason.InvalidPubkey);
});

test('http:// relay yields reason=invalidRelay', () => {
  const r = parseNwcConnection(`nostr+walletconnect://${PK}?relay=${encodeURIComponent('http://relay.example')}&secret=${SECRET}`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, NwcParseReason.InvalidRelay);
});

test('non-hex secret yields reason=invalidSecret', () => {
  const r = parseNwcConnection(`nostr+walletconnect://${PK}?relay=${RELAY_ENC}&secret=zz`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, NwcParseReason.InvalidSecret);
});

// ─── Round-trip invariants ───────────────────────────────────────────

test('normalised form parses back to the same components', () => {
  const r1 = parseNwcConnection(`nostr+walletconnect:${PK}?relay=${RELAY_ENC}&secret=${SECRET}&lud16=alice@example.com`);
  assert.equal(r1.ok, true);
  const r2 = parseNwcConnection(r1.normalized);
  assert.equal(r2.ok, true);
  assert.equal(r1.pubkey, r2.pubkey);
  assert.equal(r1.relay, r2.relay);
  assert.equal(r1.secret, r2.secret);
  assert.equal(r1.lud16, r2.lud16);
  assert.equal(r1.normalized, r2.normalized);
});

test('isValidNwcConnection mirrors parseNwcConnection.ok', () => {
  assert.equal(isValidNwcConnection(`nostr+walletconnect://${PK}?relay=${RELAY_ENC}&secret=${SECRET}`), true);
  assert.equal(isValidNwcConnection('https://example.com'), false);
  assert.equal(isValidNwcConnection(''), false);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
