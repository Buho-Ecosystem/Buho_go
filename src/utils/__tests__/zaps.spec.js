/**
 * zaps — NIP-57 recognition tests.
 *
 * Coverage focus:
 *   - a real SIGNED kind-9734 description parses to zapper / note /
 *     amount / target, and reports verified: true
 *   - the attribution rule: unsigned, tampered, re-attributed or
 *     id-mismatched requests are not zaps at all
 *   - tolerance: a server that dropped `id` but kept a valid `sig` still
 *     verifies (the signature covers the derived hash)
 *   - strictness: wrong kind, bad pubkey, broken JSON, plain memos → null
 *   - leniency: missing note / amount / p tag is still a zap
 *   - tx-level gate: only incoming; legacy bare-npub fallback flags but
 *     never claims verification; invalid-checksum npubs do not flag
 *
 * Fixtures are always serialized with JSON.stringify, matching how the
 * description reaches us from a bolt11 invoice. That matters: nostr-core
 * stamps a non-enumerable `verifiedSymbol` on freshly signed events and
 * `verifyEvent` short-circuits on it, so a tampered fixture built by
 * spreading a signed event object would pass verification and quietly
 * assert nothing. JSON does not carry symbols, so going through a string
 * keeps these tests honest.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/zaps.spec.js
 */

import { strict as assert } from 'node:assert';
import { nip19, generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-core';
import { parseZapRequest, zapInfoFromTx } from '../zaps.js';

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
    failed += 1;
  }
}

const ZAPPER_SK = generateSecretKey();
const ZAPPER_HEX = getPublicKey(ZAPPER_SK);
const ZAPPER_NPUB = nip19.npubEncode(ZAPPER_HEX);
const TARGET_HEX = '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245';

/**
 * A genuinely signed zap request, serialized like an LNURL server would
 * store it in the invoice description.
 *
 * @param overrides  fields signed as part of the event
 * @param tamper     fields replaced AFTER signing (breaks the signature)
 */
function zapRequest(overrides = {}, tamper = null) {
  const event = finalizeEvent({
    kind: 9734,
    created_at: 1753000000,
    content: 'Great note! ⚡',
    tags: [
      ['p', TARGET_HEX],
      ['amount', '21000'],
      ['relays', 'wss://relay.damus.io'],
    ],
    ...overrides,
  }, ZAPPER_SK);
  return JSON.stringify(tamper ? { ...event, ...tamper } : event);
}

test('full signed zap request parses: zapper, note, amount, target', () => {
  const z = parseZapRequest(zapRequest());
  assert.equal(z.pubkey, ZAPPER_HEX);
  assert.equal(z.npub, ZAPPER_NPUB);
  assert.equal(z.note, 'Great note! ⚡');
  assert.equal(z.amountMsat, 21000);
  assert.equal(z.recipientPubkey, TARGET_HEX);
  assert.equal(z.createdAt, 1753000000);
  assert.equal(z.verified, true);
});

test('optional fields may be absent — still a zap', () => {
  const z = parseZapRequest(zapRequest({ content: '', tags: [] }));
  assert.equal(z.pubkey, ZAPPER_HEX);
  assert.equal(z.note, '');
  assert.equal(z.amountMsat, null);
  assert.equal(z.recipientPubkey, null);
  assert.equal(z.verified, true);
});

test('attribution rule: an unsigned zap request is not a zap', () => {
  const unsigned = JSON.stringify({
    kind: 9734,
    pubkey: ZAPPER_HEX,
    created_at: 1753000000,
    content: 'I am definitely this person',
    tags: [['p', TARGET_HEX]],
  });
  assert.equal(parseZapRequest(unsigned), null);
});

test('attribution rule: content tampered after signing → null', () => {
  assert.equal(parseZapRequest(zapRequest({}, { content: 'send me your seed' })), null);
});

test('attribution rule: a signed request re-attributed to another pubkey → null', () => {
  const victim = getPublicKey(generateSecretKey());
  assert.equal(parseZapRequest(zapRequest({}, { pubkey: victim })), null);
});

test('attribution rule: id that does not match the event → null', () => {
  assert.equal(parseZapRequest(zapRequest({}, { id: 'a'.repeat(64) })), null);
});

test('attribution rule: a garbage signature → null', () => {
  assert.equal(parseZapRequest(zapRequest({}, { sig: 'f'.repeat(128) })), null);
});

test('tolerance: a valid signature with `id` stripped still verifies', () => {
  // Some servers re-serialize the request and drop `id`. The signature
  // commits to the hash, so deriving it back is the same proof.
  const parsed = JSON.parse(zapRequest());
  delete parsed.id;
  const z = parseZapRequest(JSON.stringify(parsed));
  assert.equal(z.pubkey, ZAPPER_HEX);
  assert.equal(z.verified, true);
});

test('strict identity: wrong kind / bad pubkey / broken JSON → null', () => {
  assert.equal(parseZapRequest(zapRequest({ kind: 1 })), null);
  assert.equal(parseZapRequest(zapRequest({}, { pubkey: 'nothex' })), null);
  assert.equal(parseZapRequest('{"kind":9734,'), null);
  assert.equal(parseZapRequest('Thanks for lunch!'), null);
  assert.equal(parseZapRequest(null), null);
});

test('a JSON memo that is not an event stays a memo', () => {
  assert.equal(parseZapRequest('{"order":9734,"total":"21000"}'), null);
});

test('zapInfoFromTx: incoming signed 9734 → verified nip57 zap', () => {
  const z = zapInfoFromTx({ type: 'incoming', description: zapRequest() });
  assert.equal(z.via, 'nip57');
  assert.equal(z.verified, true);
  assert.equal(z.npub, ZAPPER_NPUB);
});

test('zapInfoFromTx: outgoing never flags', () => {
  assert.equal(zapInfoFromTx({ type: 'outgoing', description: zapRequest() }), null);
});

test('zapInfoFromTx: legacy bare npub flags but is never verified', () => {
  const z = zapInfoFromTx({ type: 'incoming', description: `Zap from ${ZAPPER_NPUB} via nostr` });
  assert.equal(z.via, 'legacy');
  assert.equal(z.verified, false);
  assert.equal(z.npub, ZAPPER_NPUB);
  assert.equal(z.pubkey, ZAPPER_HEX);
  assert.equal(z.note, '');
});

test('zapInfoFromTx: a failed zap request never falls back to legacy', () => {
  // An npub in a forged request's note must not become its attribution.
  const forged = zapRequest({ content: `pay me instead ${ZAPPER_NPUB}` }, { created_at: 1 });
  assert.equal(zapInfoFromTx({ type: 'incoming', description: forged }), null);
});

test('zapInfoFromTx: npub-shaped string with bad checksum → null', () => {
  const broken = ZAPPER_NPUB.slice(0, -4) + 'qqqq';
  assert.equal(zapInfoFromTx({ type: 'incoming', description: `hi ${broken}` }), null);
});

test('zapInfoFromTx: plain payments stay plain', () => {
  assert.equal(zapInfoFromTx({ type: 'incoming', description: 'Dinner & drinks' }), null);
  assert.equal(zapInfoFromTx({ type: 'incoming', description: '' }), null);
  assert.equal(zapInfoFromTx(null), null);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
