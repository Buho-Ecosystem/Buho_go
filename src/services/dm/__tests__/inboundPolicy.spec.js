/**
 * Inbound policy tests.
 *
 * The two gates sit in front of the (expensive) decryption and in front of the
 * store, so the cases cover what they must refuse, what they must never refuse
 * (backdated wraps, our own messages) and the order effects of a stateful
 * pipe: a refused event must not be remembered, a duplicate must not be
 * charged to a sender twice. Time-dependent policies read `Date.now()`, so the
 * tests run on a mocked clock.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/inboundPolicy.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect } from 'node:util';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-core';
import { createRumorGate, createWrapGate } from '../inboundPolicy.js';

const START_MS = 1_760_000_000_000;
const NOW = START_MS / 1000;
const HOUR = 3_600;
const DAY = 24 * HOUR;
const ME = 'a'.repeat(64);
const ALICE = 'b'.repeat(64);
const BOB = 'c'.repeat(64);

/** Freeze the clock at START_MS; `t.mock.timers.tick(ms)` advances it. */
function clock(t) {
  t.mock.timers.enable({ apis: ['Date'], now: START_MS });
}

let counter = 0;
/** A unique 64-hex id. */
const nextId = () => (counter += 1).toString(16).padStart(64, '0');

const wrap = (overrides = {}) => ({
  id: nextId(),
  pubkey: 'd'.repeat(64),
  kind: 1059,
  created_at: NOW - HOUR,
  content: 'payload',
  tags: [['p', ME]],
  sig: 'e'.repeat(128),
  ...overrides,
});

const rumor = (overrides = {}) => ({
  id: nextId(),
  pubkey: ALICE,
  kind: 14,
  created_at: NOW,
  content: 'hello',
  tags: [['p', ME]],
  ...overrides,
});

const verdict = async (gate, event) => gate.check(event);

// ---------------------------------------------------------------------------
// Wrap gate
// ---------------------------------------------------------------------------

test('the wrap gate accepts an ordinary gift wrap', async (t) => {
  clock(t);
  assert.deepEqual(await verdict(createWrapGate(), wrap()), { accepted: true });
});

test('the wrap gate accepts wraps backdated by two days, a week or a year', async (t) => {
  clock(t);
  const gate = createWrapGate();
  for (const age of [2 * DAY, 7 * DAY, 365 * DAY]) {
    assert.equal((await verdict(gate, wrap({ created_at: NOW - age }))).accepted, true, `${age}s old`);
  }
});

// [kind]
for (const kind of [0, 1, 4, 7, 13, 14, 1058, 1060, 10050]) {
  test(`the wrap gate refuses kind ${kind}`, async (t) => {
    clock(t);
    const result = await verdict(createWrapGate(), wrap({ kind }));
    assert.equal(result.accepted, false);
    assert.equal(result.policy, 'kindAllowList');
    assert.match(result.reason, /^blocked:/);
  });
}

test('the wrap gate caps content at 87,472 characters, the largest NIP-44 payload', async (t) => {
  clock(t);
  const gate = createWrapGate();
  assert.equal((await verdict(gate, wrap({ content: 'a'.repeat(87_472) }))).accepted, true);
  const over = await verdict(gate, wrap({ content: 'a'.repeat(87_473) }));
  assert.equal(over.accepted, false);
  assert.equal(over.policy, 'sizeLimit');
  assert.match(over.reason, /^invalid:/);
});

test('87,472 is the base64 length of NIP-44\'s largest payload (65,535 bytes of plaintext)', () => {
  const key = nip44.getConversationKey(generateSecretKey(), getPublicKey(generateSecretKey()));
  assert.equal(nip44.encrypt('a'.repeat(65_535), key).length, 87_472);
});

test('the wrap gate allows one hour of clock skew into the future and no more', async (t) => {
  clock(t);
  const gate = createWrapGate();
  assert.equal((await verdict(gate, wrap({ created_at: NOW + HOUR }))).accepted, true);
  const result = await verdict(gate, wrap({ created_at: NOW + HOUR + 1 }));
  assert.equal(result.accepted, false);
  assert.equal(result.policy, 'createdAtPolicy');
});

test('the wrap gate refuses a wrap past its NIP-40 expiration and accepts one that is still live', async (t) => {
  clock(t);
  const gate = createWrapGate();
  const expired = await verdict(gate, wrap({ tags: [['p', ME], ['expiration', String(NOW - 1)]] }));
  assert.equal(expired.accepted, false);
  assert.equal(expired.policy, 'notExpired');
  assert.equal((await verdict(gate, wrap({ tags: [['p', ME], ['expiration', String(NOW + DAY)]] }))).accepted, true);
});

test('the wrap gate refuses a wrap id it has already accepted', async (t) => {
  clock(t);
  const gate = createWrapGate();
  const event = wrap();
  assert.equal((await verdict(gate, event)).accepted, true);
  const again = await verdict(gate, { ...event });
  assert.equal(again.accepted, false);
  assert.equal(again.policy, 'noDuplicates');
  assert.match(again.reason, /^duplicate:/);
});

test('a refused wrap is not remembered: it is accepted when it arrives again valid', async (t) => {
  clock(t);
  const gate = createWrapGate();
  const early = wrap({ created_at: NOW + 2 * HOUR });
  assert.equal((await verdict(gate, early)).accepted, false);
  t.mock.timers.tick(2 * HOUR * 1000);
  assert.equal((await verdict(gate, early)).accepted, true, 'two hours later it is no longer in the future');
});

test('each wrap gate has its own memory', async (t) => {
  clock(t);
  const event = wrap();
  assert.equal((await verdict(createWrapGate(), event)).accepted, true);
  assert.equal((await verdict(createWrapGate(), event)).accepted, true);
});

const MALFORMED_EVENTS = [
  null,
  undefined,
  'wrap',
  42,
  [],
  {},
  { ...wrap(), tags: undefined },
  { ...wrap(), tags: 'p' },
  { ...wrap(), tags: ['p'] },
  { ...wrap(), tags: [['p', 5]] },
  { ...wrap(), content: undefined },
  { ...wrap(), content: 5 },
  { ...wrap(), id: undefined },
  { ...wrap(), created_at: '1' },
  { ...wrap(), created_at: undefined },
  { ...wrap(), kind: '1059' },
];

for (const event of MALFORMED_EVENTS) {
  test(`both gates refuse ${inspect(event, { breakLength: 200 }).slice(0, 55)} without throwing`, async (t) => {
    clock(t);
    for (const gate of [createWrapGate(), createRumorGate({ me: ME })]) {
      const result = await verdict(gate, event);
      assert.equal(result.accepted, false);
      assert.match(result.reason, /^invalid:/);
    }
  });
}

// ---------------------------------------------------------------------------
// Rumor gate
// ---------------------------------------------------------------------------

test('the rumor gate accepts messages and reactions', async (t) => {
  clock(t);
  const gate = createRumorGate({ me: ME });
  assert.equal((await verdict(gate, rumor())).accepted, true);
  assert.equal((await verdict(gate, rumor({ kind: 7, content: '+' }))).accepted, true);
});

for (const kind of [0, 1, 13, 15, 1059, 10050]) {
  test(`the rumor gate refuses kind ${kind}`, async (t) => {
    clock(t);
    const result = await verdict(createRumorGate({ me: ME }), rumor({ kind }));
    assert.equal(result.accepted, false);
    assert.equal(result.policy, 'kindAllowList');
  });
}

test('the rumor gate refuses a blocked sender and consults isBlocked with the sender', async (t) => {
  clock(t);
  const asked = [];
  const gate = createRumorGate({ me: ME, isBlocked: (pubkey) => { asked.push(pubkey); return pubkey === ALICE; } });
  const blocked = await verdict(gate, rumor({ pubkey: ALICE }));
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.policy, 'notBlocked');
  assert.match(blocked.reason, /^blocked:/);
  assert.equal((await verdict(gate, rumor({ pubkey: BOB }))).accepted, true);
  assert.deepEqual(asked, [ALICE, BOB]);
});

test('the rumor gate never blocks our own pubkey, whatever isBlocked says', async (t) => {
  clock(t);
  const gate = createRumorGate({ me: ME, isBlocked: () => true });
  assert.equal((await verdict(gate, rumor({ pubkey: ME }))).accepted, true);
  assert.equal((await verdict(gate, rumor({ pubkey: ALICE }))).accepted, false);
});

test('without isBlocked nobody is blocked', async (t) => {
  clock(t);
  assert.equal((await verdict(createRumorGate({ me: ME }), rumor())).accepted, true);
});

test('the rumor gate refuses an expired rumor', async (t) => {
  clock(t);
  const gate = createRumorGate({ me: ME });
  const result = await verdict(gate, rumor({ tags: [['p', ME], ['expiration', String(NOW - 5)]] }));
  assert.equal(result.accepted, false);
  assert.equal(result.policy, 'notExpired');
});

test('the rumor gate refuses a rumor id it has already accepted', async (t) => {
  clock(t);
  const gate = createRumorGate({ me: ME });
  const event = rumor();
  assert.equal((await verdict(gate, event)).accepted, true);
  assert.equal((await verdict(gate, event)).policy, 'noDuplicates');
});

test('a blocked rumor is not remembered: once unblocked it is accepted', async (t) => {
  clock(t);
  let blocked = true;
  const gate = createRumorGate({ me: ME, isBlocked: () => blocked });
  const event = rumor();
  assert.equal((await verdict(gate, event)).accepted, false);
  blocked = false;
  assert.equal((await verdict(gate, event)).accepted, true);
});

test('the rumor gate does not limit the age of a rumor: backfill delivers old messages', async (t) => {
  clock(t);
  assert.equal((await verdict(createRumorGate({ me: ME }), rumor({ created_at: NOW - 400 * DAY }))).accepted, true);
});

// ---------------------------------------------------------------------------
// Rumor gate: rate limit
// ---------------------------------------------------------------------------

const RATE = { max: 3, windowMs: 60_000 };

test('without a rate there is no limit', async (t) => {
  clock(t);
  const gate = createRumorGate({ me: ME });
  for (let i = 0; i < 50; i += 1) assert.equal((await verdict(gate, rumor())).accepted, true);
});

test('the rate limit refuses a sender beyond max per window and recovers afterwards', async (t) => {
  clock(t);
  const gate = createRumorGate({ me: ME, rate: RATE });
  for (let i = 0; i < 3; i += 1) assert.equal((await verdict(gate, rumor())).accepted, true);
  const limited = await verdict(gate, rumor());
  assert.equal(limited.accepted, false);
  assert.equal(limited.policy, 'rateLimit');
  assert.match(limited.reason, /^rate-limited:/);
  t.mock.timers.tick(RATE.windowMs + 1);
  assert.equal((await verdict(gate, rumor())).accepted, true);
});

test('the rate limit is per sender', async (t) => {
  clock(t);
  const gate = createRumorGate({ me: ME, rate: RATE });
  for (let i = 0; i < 3; i += 1) await verdict(gate, rumor({ pubkey: ALICE }));
  assert.equal((await verdict(gate, rumor({ pubkey: ALICE }))).accepted, false);
  assert.equal((await verdict(gate, rumor({ pubkey: BOB }))).accepted, true);
});

test('the rate limit never applies to our own pubkey', async (t) => {
  clock(t);
  const gate = createRumorGate({ me: ME, rate: { max: 1, windowMs: 60_000 } });
  for (let i = 0; i < 20; i += 1) assert.equal((await verdict(gate, rumor({ pubkey: ME }))).accepted, true);
  assert.equal((await verdict(gate, rumor({ pubkey: ALICE }))).accepted, true);
  assert.equal((await verdict(gate, rumor({ pubkey: ALICE }))).accepted, false);
});

test('one rumor delivered by several relays is charged once', async (t) => {
  clock(t);
  const gate = createRumorGate({ me: ME, rate: { max: 2, windowMs: 60_000 } });
  const first = rumor();
  const second = rumor();
  for (const event of [first, first, first]) await verdict(gate, event);
  const results = [await verdict(gate, second), await verdict(gate, rumor())];
  assert.deepEqual(results.map((r) => r.accepted), [true, false], 'two distinct rumors fit, the third does not');
});

test('a rumor refused by the rate limit is neither remembered nor let through on redelivery', async (t) => {
  clock(t);
  const gate = createRumorGate({ me: ME, rate: RATE });
  for (let i = 0; i < 3; i += 1) await verdict(gate, rumor());
  const refused = rumor();
  assert.equal((await verdict(gate, refused)).policy, 'rateLimit');
  assert.equal((await verdict(gate, refused)).policy, 'rateLimit', 'a second relay does not get it through');
  t.mock.timers.tick(RATE.windowMs + 1);
  assert.equal((await verdict(gate, refused)).accepted, true, 'accepted once the window has passed');
});

test('a blocked sender does not use up the rate limit of anyone', async (t) => {
  clock(t);
  const gate = createRumorGate({ me: ME, isBlocked: (pubkey) => pubkey === ALICE, rate: RATE });
  for (let i = 0; i < 10; i += 1) assert.equal((await verdict(gate, rumor({ pubkey: ALICE }))).policy, 'notBlocked');
  for (let i = 0; i < 3; i += 1) assert.equal((await verdict(gate, rumor({ pubkey: BOB }))).accepted, true);
});
