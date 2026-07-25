/**
 * zaps — NIP-57 recognition tests.
 *
 * Coverage focus:
 *   - a real kind-9734 description parses to zapper / note / amount / target
 *   - strictness: wrong kind, bad pubkey, broken JSON, plain memos → null
 *   - leniency: missing note / amount / p tag is still a zap
 *   - tx-level gate: only incoming; legacy bare-npub fallback still flags,
 *     invalid-checksum npubs do not
 *
 * Run directly with Node:
 *   node src/utils/__tests__/zaps.spec.js
 */

import { strict as assert } from 'node:assert';
import { nip19 } from 'nostr-core';
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

const ZAPPER_HEX = 'ee11a5dff40c19a555f41fe42b48f00e618c91225622ae37b6c2bb67b76c4e49';
const TARGET_HEX = '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245';
const ZAPPER_NPUB = nip19.npubEncode(ZAPPER_HEX);

const zapRequest = (overrides = {}) => JSON.stringify({
  kind: 9734,
  pubkey: ZAPPER_HEX,
  created_at: 1753000000,
  content: 'Great note! ⚡',
  tags: [
    ['p', TARGET_HEX],
    ['amount', '21000'],
    ['relays', 'wss://relay.damus.io'],
  ],
  ...overrides,
});

test('full zap request parses: zapper, note, amount, target', () => {
  const z = parseZapRequest(zapRequest());
  assert.equal(z.pubkey, ZAPPER_HEX);
  assert.equal(z.npub, ZAPPER_NPUB);
  assert.equal(z.note, 'Great note! ⚡');
  assert.equal(z.amountMsat, 21000);
  assert.equal(z.recipientPubkey, TARGET_HEX);
  assert.equal(z.createdAt, 1753000000);
});

test('optional fields may be absent — still a zap', () => {
  const z = parseZapRequest(zapRequest({ content: '', tags: [] }));
  assert.equal(z.pubkey, ZAPPER_HEX);
  assert.equal(z.note, '');
  assert.equal(z.amountMsat, null);
  assert.equal(z.recipientPubkey, null);
});

test('strict identity: wrong kind / bad pubkey / broken JSON → null', () => {
  assert.equal(parseZapRequest(zapRequest({ kind: 1 })), null);
  assert.equal(parseZapRequest(zapRequest({ pubkey: 'nothex' })), null);
  assert.equal(parseZapRequest('{"kind":9734,'), null);
  assert.equal(parseZapRequest('Thanks for lunch!'), null);
  assert.equal(parseZapRequest(null), null);
});

test('a JSON memo that is not an event stays a memo', () => {
  assert.equal(parseZapRequest('{"order":9734,"total":"21000"}'), null);
});

test('zapInfoFromTx: incoming with 9734 description → nip57 zap', () => {
  const z = zapInfoFromTx({ type: 'incoming', description: zapRequest() });
  assert.equal(z.via, 'nip57');
  assert.equal(z.npub, ZAPPER_NPUB);
});

test('zapInfoFromTx: outgoing never flags', () => {
  assert.equal(zapInfoFromTx({ type: 'outgoing', description: zapRequest() }), null);
});

test('zapInfoFromTx: legacy bare npub in plain text still flags', () => {
  const z = zapInfoFromTx({ type: 'incoming', description: `Zap from ${ZAPPER_NPUB} via nostr` });
  assert.equal(z.via, 'legacy');
  assert.equal(z.npub, ZAPPER_NPUB);
  assert.equal(z.pubkey, ZAPPER_HEX);
  assert.equal(z.note, '');
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
