/**
 * Contact chat constants tests.
 *
 * Besides pinning the values, these tests check the reasons behind two of them
 * against the real `nostr-core` (the NIP-44 size limit behind MAX_RUMOR_BYTES,
 * the NIP-59 timestamp backdating behind SINCE_SLACK_SECONDS), so a library
 * change that invalidates a constant fails here instead of in production.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/constants.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DM_RELAY_LIST_KIND,
  createAuthEventTemplate,
  createReactionEventTemplate,
  createRumor,
  createSeal,
  createWrap,
  generateSecretKey,
  getPublicKey,
  unwrap,
  wrapDirectMessage,
} from 'nostr-core';
import { DEFAULT_RELAYS } from '../../../utils/nostrRelays.js';
import * as constants from '../constants.js';
import {
  DM_DISCOVERY_RELAYS,
  DM_INBOX_RELAYS,
  INBOX_RELAY_CACHE_TTL_MS,
  KEY_IDLE_WIPE_MS,
  KIND,
  MAX_INBOX_RELAYS_PER_CONTACT,
  MAX_NOTE_LENGTH,
  MAX_RUMOR_BYTES,
  MAX_TEXT_LENGTH,
  PROTOCOL_VERSION,
  REQUEST_LIFETIME_SECONDS,
  SINCE_SLACK_SECONDS,
} from '../constants.js';

const PURPLEPAGES = 'wss://purplepag.es';
const NIP44_MAX_PLAINTEXT_BYTES = 65_535;

const encoder = new TextEncoder();
const jsonBytes = (value) => encoder.encode(JSON.stringify(value)).length;

/** Fresh author and recipient identities for one test. */
function people() {
  const author = generateSecretKey();
  const recipient = generateSecretKey();
  return {
    author,
    recipient,
    authorPubkey: getPublicKey(author),
    recipientPubkey: getPublicKey(recipient),
  };
}

/** A kind 14 rumor whose JSON is exactly `size` UTF-8 bytes. */
function rumorOfBytes(size, authorPubkey, recipientPubkey) {
  const template = { kind: KIND.DM, tags: [['p', recipientPubkey]], created_at: 1_760_000_000 };
  const empty = createRumor({ ...template, content: '' }, authorPubkey);
  const rumor = createRumor(
    { ...template, content: 'a'.repeat(size - jsonBytes(empty)) },
    authorPubkey,
  );
  assert.equal(jsonBytes(rumor), size, 'the test helper builds the size it promises');
  return rumor;
}

// ---------------------------------------------------------------------------
// Event kinds
// ---------------------------------------------------------------------------

test('KIND carries the kinds NIP-17, NIP-25, NIP-42, NIP-51 and NIP-59 define', () => {
  assert.deepEqual(KIND, {
    DM: 14,
    REACTION: 7,
    SEAL: 13,
    GIFT_WRAP: 1059,
    DM_RELAYS: 10050,
    AUTH: 22242,
  });
});

test('KIND values are distinct non-negative integers', () => {
  const kinds = Object.values(KIND);
  assert.ok(kinds.every((kind) => Number.isInteger(kind) && kind >= 0));
  assert.equal(new Set(kinds).size, kinds.length);
});

test('KIND agrees with the kinds nostr-core itself produces', () => {
  const { author, recipient, recipientPubkey } = people();
  const wrap = wrapDirectMessage('hi', author, recipientPubkey);
  const rumor = unwrap(wrap, recipient);

  assert.equal(rumor.kind, KIND.DM);
  assert.equal(createSeal(rumor, author, recipientPubkey).kind, KIND.SEAL);
  assert.equal(wrap.kind, KIND.GIFT_WRAP);
  assert.equal(DM_RELAY_LIST_KIND, KIND.DM_RELAYS);
  assert.equal(createReactionEventTemplate({ content: '+' }).kind, KIND.REACTION);
  assert.equal(
    createAuthEventTemplate({ relay: 'wss://relay.example', challenge: 'abc' }).kind,
    KIND.AUTH,
  );
});

test('KIND is frozen: nothing can be changed, added or removed', () => {
  assert.ok(Object.isFrozen(KIND));
  assert.throws(() => { KIND.DM = 15; }, TypeError);
  assert.throws(() => { KIND.NEW = 1; }, TypeError);
  assert.throws(() => { delete KIND.DM; }, TypeError);
  assert.equal(KIND.DM, 14);
  assert.equal(KIND.NEW, undefined);
});

// ---------------------------------------------------------------------------
// Relays
// ---------------------------------------------------------------------------

test('DM_INBOX_RELAYS are the three inbox relays measured on 2026-10-10', () => {
  assert.deepEqual(DM_INBOX_RELAYS, [
    'wss://auth.nostr1.com',
    'wss://nos.lol',
    'wss://relay.primal.net',
  ]);
});

test('DM_INBOX_RELAYS leave out the relays whose AUTH is broken server-side', () => {
  assert.ok(!DM_INBOX_RELAYS.includes('wss://relay.damus.io'));
  assert.ok(!DM_INBOX_RELAYS.includes('wss://relay.nostr.net'));
});

test('DM_INBOX_RELAYS are plain wss origins on three different hosts', () => {
  const hosts = DM_INBOX_RELAYS.map((url) => {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'wss:');
    assert.equal(parsed.href, `${url}/`, `${url} has no path, port or query to normalise away`);
    return parsed.hostname;
  });
  assert.equal(new Set(hosts).size, hosts.length, 'one operator must not hold two inbox slots');
});

test('DM_DISCOVERY_RELAYS are the default relays plus purplepag.es, defaults first', () => {
  const urls = [...DM_DISCOVERY_RELAYS];
  assert.deepEqual(urls.slice(0, DEFAULT_RELAYS.length), [...DEFAULT_RELAYS]);
  assert.ok(urls.includes(PURPLEPAGES));
  for (const relay of DEFAULT_RELAYS) assert.ok(urls.includes(relay), `${relay} is included`);
});

test('DM_DISCOVERY_RELAYS lists every relay exactly once', () => {
  const urls = [...DM_DISCOVERY_RELAYS];
  assert.equal(new Set(urls).size, urls.length, 'no duplicates');
  assert.equal(urls.filter((url) => url === PURPLEPAGES).length, 1);
  assert.equal(urls.length, new Set([...DEFAULT_RELAYS, PURPLEPAGES]).size);
});

test('DM_DISCOVERY_RELAYS are plain wss origins', () => {
  for (const url of DM_DISCOVERY_RELAYS) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'wss:');
    assert.equal(parsed.href, `${url}/`, `${url} has no path, port or query to normalise away`);
  }
});

test('the relay lists are frozen and independent of the shared default set', () => {
  for (const list of [DM_INBOX_RELAYS, DM_DISCOVERY_RELAYS]) {
    const before = [...list];
    assert.ok(Object.isFrozen(list));
    assert.throws(() => list.push('wss://evil.example'), TypeError);
    assert.throws(() => list.pop(), TypeError);
    assert.throws(() => { list[0] = 'wss://evil.example'; }, TypeError);
    assert.throws(() => { list.length = 0; }, TypeError);
    assert.deepEqual([...list], before);
  }
  assert.notEqual(DM_DISCOVERY_RELAYS, DEFAULT_RELAYS, 'a copy, so the shared set stays untouched');
});

// ---------------------------------------------------------------------------
// Protocol version and limits
// ---------------------------------------------------------------------------

test('PROTOCOL_VERSION is the string "1" because tag values are strings', () => {
  assert.strictEqual(PROTOCOL_VERSION, '1');
});

const LIMITS = [
  ['MAX_TEXT_LENGTH', MAX_TEXT_LENGTH, 2_000],
  ['MAX_NOTE_LENGTH', MAX_NOTE_LENGTH, 200],
  ['MAX_RUMOR_BYTES', MAX_RUMOR_BYTES, 40_000],
  ['REQUEST_LIFETIME_SECONDS', REQUEST_LIFETIME_SECONDS, 30 * 24 * 60 * 60],
  ['SINCE_SLACK_SECONDS', SINCE_SLACK_SECONDS, 2 * 24 * 60 * 60],
  ['INBOX_RELAY_CACHE_TTL_MS', INBOX_RELAY_CACHE_TTL_MS, 24 * 60 * 60 * 1000],
  ['MAX_INBOX_RELAYS_PER_CONTACT', MAX_INBOX_RELAYS_PER_CONTACT, 5],
  ['KEY_IDLE_WIPE_MS', KEY_IDLE_WIPE_MS, 10 * 60 * 1000],
];

for (const [name, value, expected] of LIMITS) {
  test(`${name} is ${expected.toLocaleString('en-US')}`, () => {
    assert.equal(value, expected);
    assert.ok(Number.isSafeInteger(value) && value > 0, 'a positive whole number');
  });
}

test('a note always fits where a text message does', () => {
  assert.ok(MAX_NOTE_LENGTH <= MAX_TEXT_LENGTH);
});

test('the longest text fits the rumor budget even when every character needs escaping', () => {
  // A control character is one character but six bytes of JSON ("\u0000"): the worst case.
  assert.ok(jsonBytes('\u0000'.repeat(MAX_TEXT_LENGTH)) < MAX_RUMOR_BYTES);
  // Four-byte characters (emoji) are the worst case for plain UTF-8.
  assert.ok(jsonBytes('\u{1F989}'.repeat(MAX_TEXT_LENGTH)) < MAX_RUMOR_BYTES);
});

// ---------------------------------------------------------------------------
// Reasons checked against nostr-core
// ---------------------------------------------------------------------------

test('a rumor of exactly MAX_RUMOR_BYTES can be sealed, gift wrapped and opened', () => {
  const { author, recipient, authorPubkey, recipientPubkey } = people();
  const rumor = rumorOfBytes(MAX_RUMOR_BYTES, authorPubkey, recipientPubkey);

  const seal = createSeal(rumor, author, recipientPubkey);
  assert.ok(
    jsonBytes(seal) <= NIP44_MAX_PLAINTEXT_BYTES,
    'the gift wrap encrypts the seal JSON, which NIP-44 caps at 65,535 bytes',
  );
  const wrap = createWrap(seal, recipientPubkey);

  assert.equal(wrap.kind, KIND.GIFT_WRAP);
  assert.equal(unwrap(wrap, recipient).id, rumor.id);
});

test('a 60,000-byte rumor fits NIP-44 on its own but cannot be gift wrapped', () => {
  const { author, authorPubkey, recipientPubkey } = people();
  const rumor = rumorOfBytes(60_000, authorPubkey, recipientPubkey);

  // The rumor itself fits NIP-44, but its base64 ciphertext inside the seal is a third larger.
  const seal = createSeal(rumor, author, recipientPubkey);
  assert.ok(jsonBytes(seal) > NIP44_MAX_PLAINTEXT_BYTES);
  assert.throws(() => createWrap(seal, recipientPubkey));
  assert.ok(MAX_RUMOR_BYTES < 60_000);
});

test('SINCE_SLACK_SECONDS covers the oldest timestamp NIP-59 can give a gift wrap', (t) => {
  const { author, authorPubkey, recipientPubkey } = people();
  const rumor = rumorOfBytes(1_000, authorPubkey, recipientPubkey);
  const seal = createSeal(rumor, author, recipientPubkey);

  // nostr-core backdates a wrap by Math.random() times two days; take the largest draw.
  t.mock.method(Math, 'random', () => 1 - Number.EPSILON);
  const before = Math.floor(Date.now() / 1000);
  const backdatedBy = before - createWrap(seal, recipientPubkey).created_at;

  assert.ok(backdatedBy >= SINCE_SLACK_SECONDS - 60, 'the largest draw was used');
  assert.ok(backdatedBy <= SINCE_SLACK_SECONDS, 'and still lies inside the slack');
});

// ---------------------------------------------------------------------------
// The module as a whole
// ---------------------------------------------------------------------------

test('every collection the module exports is frozen', () => {
  const collections = Object.entries(constants).filter(
    ([, value]) => typeof value === 'object' && value !== null,
  );
  assert.ok(collections.length >= 3, 'the kinds and both relay lists are among them');
  for (const [name, value] of collections) assert.ok(Object.isFrozen(value), `${name} is frozen`);
});
