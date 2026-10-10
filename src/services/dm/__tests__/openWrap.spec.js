/**
 * Gift wrap opening tests.
 *
 * Everything `openGiftWrap` reads was chosen by a stranger, so each failure
 * reason has a wrap crafted by hand to trigger exactly that reason: a forged
 * rumor id (upstream issue #73), a seal signed by someone else, tampered
 * ciphertext, a rumor addressed to nobody we know. The crafting helper builds
 * wraps from the NIP-44 primitives so any layer can be made wrong on its own.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/openWrap.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect } from 'node:util';
import {
  createRumor,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
} from 'nostr-core';
import { sealAndWrap } from '../giftWrap.js';
import { OPEN_FAILURE, openGiftWrap } from '../openWrap.js';

const NOW = 1_760_000_000;

function person() {
  const secretKey = generateSecretKey();
  return { secretKey, pubkey: getPublicKey(secretKey) };
}

const encryptTo = (value, fromSecretKey, toPubkey) =>
  nip44.encrypt(
    typeof value === 'string' ? value : JSON.stringify(value),
    nip44.getConversationKey(fromSecretKey, toPubkey),
  );

/**
 * A wrap crafted layer by layer. Every option replaces one layer's default so a
 * test breaks exactly one thing.
 *
 * @param {object} o
 * @param {object} o.author Who the rumor says wrote it.
 * @param {object} o.to The recipient (the wrap and the seal are encrypted to them).
 * @param {object} [o.rumor] Rumor to carry; defaults to a valid message author -> to.
 * @param {object} [o.sealer] Who signs the seal; defaults to `author`.
 * @param {object} [o.seal] Fields overriding the seal template.
 * @param {*} [o.sealPayload] Replaces the seal event as the wrap's plaintext.
 * @param {*} [o.rumorPayload] Replaces the rumor as the seal's plaintext.
 * @param {object} [o.wrap] Fields overriding the wrap template.
 */
function craft({ author, to, rumor, sealer = author, seal = {}, sealPayload, rumorPayload, wrap = {} }) {
  const carried = rumor ?? createRumor({ kind: 14, tags: [['p', to.pubkey]], content: 'hello', created_at: NOW }, author.pubkey);
  const sealEvent = finalizeEvent(
    { kind: 13, tags: [], content: encryptTo(rumorPayload ?? carried, sealer.secretKey, to.pubkey), created_at: NOW, ...seal },
    sealer.secretKey,
  );
  const wrapKey = generateSecretKey();
  return finalizeEvent(
    {
      kind: 1059,
      tags: [['p', to.pubkey]],
      content: encryptTo(sealPayload ?? sealEvent, wrapKey, to.pubkey),
      created_at: NOW,
      ...wrap,
    },
    wrapKey,
  );
}

const alice = person();
const bob = person();
const carol = person();
const open = (event, recipient = bob) => openGiftWrap(event, recipient.secretKey, { me: recipient.pubkey });
const reasonOf = (event, recipient) => {
  const result = open(event, recipient);
  assert.equal(result.ok, false, 'the wrap must not open');
  return result.reason;
};

// ---------------------------------------------------------------------------
// Success
// ---------------------------------------------------------------------------

test('a wrap made by sealAndWrap opens to the rumor and its verified sender', () => {
  const { rumor, wraps } = sealAndWrap({
    template: { kind: 14, tags: [['p', bob.pubkey]], content: 'hi bob', created_at: NOW },
    senderSecretKey: alice.secretKey,
    recipients: [bob.pubkey],
  });
  const result = open(wraps[0].event);
  assert.deepEqual(result, { ok: true, rumor, sender: alice.pubkey });
});

test('the sender can open its own self copy', () => {
  const { rumor, wraps } = sealAndWrap({
    template: { kind: 14, tags: [['p', bob.pubkey]], content: 'sent', created_at: NOW },
    senderSecretKey: alice.secretKey,
    recipients: [bob.pubkey],
  });
  const result = open(wraps.at(-1).event, alice);
  assert.equal(result.ok, true);
  assert.equal(result.rumor.id, rumor.id);
  assert.equal(result.sender, alice.pubkey);
});

test('a crafted valid wrap opens, and kind 7 reactions open like messages', () => {
  const reaction = createRumor(
    { kind: 7, tags: [['e', 'a'.repeat(64)], ['p', bob.pubkey]], content: '+', created_at: NOW },
    alice.pubkey,
  );
  const result = open(craft({ author: alice, to: bob, rumor: reaction }));
  assert.equal(result.ok, true);
  assert.equal(result.rumor.kind, 7);
});

test('the returned rumor has only the unsigned-event fields, even if the sender added more', () => {
  const rumor = { ...createRumor({ kind: 14, tags: [['p', bob.pubkey]], content: 'x', created_at: NOW }, alice.pubkey) };
  const padded = { ...rumor, sig: 'f'.repeat(128), extra: { deep: true } };
  const result = open(craft({ author: alice, to: bob, rumor: padded }));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.rumor).sort(), ['content', 'created_at', 'id', 'kind', 'pubkey', 'tags']);
});

test('OPEN_FAILURE lists the seven reasons of the contract and is frozen', () => {
  assert.deepEqual(Object.values(OPEN_FAILURE).sort(), [
    'id-mismatch',
    'impersonation',
    'invalid-rumor',
    'invalid-seal',
    'not-addressed',
    'not-gift-wrap',
    'undecryptable',
  ]);
  assert.ok(Object.isFrozen(OPEN_FAILURE));
});

// ---------------------------------------------------------------------------
// not-gift-wrap
// ---------------------------------------------------------------------------

const NOT_WRAPS = [undefined, null, 'wrap', 7, [], {}, { kind: '1059' }, { kind: 1 }, { kind: 13 }, { kind: 14 }];

for (const event of NOT_WRAPS) {
  test(`${inspect(event)} is not-gift-wrap`, () => {
    assert.equal(reasonOf(event), 'not-gift-wrap');
  });
}

test('a signed event of another kind is not-gift-wrap even when its content is a valid wrap', () => {
  const wrap = craft({ author: alice, to: bob });
  assert.equal(reasonOf({ ...wrap, kind: 1 }), 'not-gift-wrap');
});

// ---------------------------------------------------------------------------
// not-addressed
// ---------------------------------------------------------------------------

test('a wrap whose p tag names someone else is not-addressed', () => {
  assert.equal(reasonOf(craft({ author: alice, to: bob, wrap: { tags: [['p', carol.pubkey]] } })), 'not-addressed');
});

const BAD_WRAP_TAGS = [
  [],
  [['e', bob.pubkey]],
  [['p']],
  [['p', bob.pubkey.toUpperCase()]],
  [[bob.pubkey, 'p']],
  undefined,
  'p',
  [null],
  [['p', 5]],
];

for (const tags of BAD_WRAP_TAGS) {
  test(`a wrap with tags ${inspect(tags)} is not-addressed`, () => {
    assert.equal(reasonOf({ ...craft({ author: alice, to: bob }), tags }), 'not-addressed');
  });
}

test('a wrap tagged for us that carries a rumor addressed to a third person is not-addressed', () => {
  const rumor = createRumor({ kind: 14, tags: [['p', carol.pubkey]], content: 'for carol', created_at: NOW }, alice.pubkey);
  assert.equal(reasonOf(craft({ author: alice, to: bob, rumor })), 'not-addressed');
});

test('a rumor without any p tag from a stranger is not-addressed, but our own is accepted', () => {
  const stranger = createRumor({ kind: 14, tags: [], content: 'x', created_at: NOW }, alice.pubkey);
  assert.equal(reasonOf(craft({ author: alice, to: bob, rumor: stranger })), 'not-addressed');
  const mine = createRumor({ kind: 14, tags: [], content: 'x', created_at: NOW }, bob.pubkey);
  assert.equal(open(craft({ author: bob, to: bob, rumor: mine })).ok, true);
});

test('the reason is not-addressed before any decryption is attempted', () => {
  const wrap = { ...craft({ author: alice, to: bob }), tags: [['p', carol.pubkey]], content: 'garbage' };
  assert.equal(reasonOf(wrap), 'not-addressed');
});

// ---------------------------------------------------------------------------
// undecryptable
// ---------------------------------------------------------------------------

/** Flip one character in the middle of a base64 payload. */
function tamper(payload) {
  const i = Math.floor(payload.length / 2);
  return `${payload.slice(0, i)}${payload[i] === 'A' ? 'B' : 'A'}${payload.slice(i + 1)}`;
}

test('tampered wrap ciphertext is undecryptable', () => {
  const wrap = craft({ author: alice, to: bob });
  assert.equal(reasonOf({ ...wrap, content: tamper(wrap.content) }), 'undecryptable');
});

const BAD_WRAP_CONTENT = ['', 'not base64 !!', '#', 'A'.repeat(100), 'AA==', undefined, null, 5, {}];

for (const content of BAD_WRAP_CONTENT) {
  test(`wrap content ${inspect(content)} is undecryptable`, () => {
    assert.equal(reasonOf({ ...craft({ author: alice, to: bob }), content }), 'undecryptable');
  });
}

test('a wrap encrypted to someone else but tagged for us is undecryptable', () => {
  assert.equal(reasonOf(craft({ author: alice, to: carol, wrap: { tags: [['p', bob.pubkey]] } })), 'undecryptable');
});

test('a wrap from a malformed wrap pubkey is undecryptable', () => {
  assert.equal(reasonOf({ ...craft({ author: alice, to: bob }), pubkey: 'zz' }), 'undecryptable');
  assert.equal(reasonOf({ ...craft({ author: alice, to: bob }), pubkey: undefined }), 'undecryptable');
});

test('a wrap whose plaintext is not JSON, or JSON but not an object, is undecryptable', () => {
  for (const sealPayload of ['not json', '[]', 'null', '42', '"seal"']) {
    assert.equal(reasonOf(craft({ author: alice, to: bob, sealPayload })), 'undecryptable', sealPayload);
  }
});

test('a seal whose rumor is encrypted to someone else is undecryptable', () => {
  const rumor = createRumor({ kind: 14, tags: [['p', bob.pubkey]], content: 'x', created_at: NOW }, alice.pubkey);
  const seal = finalizeEvent(
    { kind: 13, tags: [], content: encryptTo(rumor, alice.secretKey, carol.pubkey), created_at: NOW },
    alice.secretKey,
  );
  assert.equal(reasonOf(craft({ author: alice, to: bob, sealPayload: seal })), 'undecryptable');
});

test('a seal with tampered ciphertext (re-signed, so the seal itself is valid) is undecryptable', () => {
  const rumor = createRumor({ kind: 14, tags: [['p', bob.pubkey]], content: 'x', created_at: NOW }, alice.pubkey);
  const content = tamper(encryptTo(rumor, alice.secretKey, bob.pubkey));
  const seal = finalizeEvent({ kind: 13, tags: [], content, created_at: NOW }, alice.secretKey);
  assert.equal(reasonOf(craft({ author: alice, to: bob, sealPayload: seal })), 'undecryptable');
});

test('a rumor that decrypts to non-JSON, or JSON but not an object, is undecryptable', () => {
  for (const rumorPayload of ['not json', '[]', 'null', '7']) {
    assert.equal(reasonOf(craft({ author: alice, to: bob, rumorPayload })), 'undecryptable', rumorPayload);
  }
});

// ---------------------------------------------------------------------------
// invalid-seal
// ---------------------------------------------------------------------------

/** A correctly signed seal carrying a valid rumor from `alice`, with `override` fields applied after signing. */
function sealWith(override) {
  const rumor = createRumor({ kind: 14, tags: [['p', bob.pubkey]], content: 'x', created_at: NOW }, alice.pubkey);
  const seal = finalizeEvent(
    { kind: 13, tags: [], content: encryptTo(rumor, alice.secretKey, bob.pubkey), created_at: NOW },
    alice.secretKey,
  );
  return { ...seal, ...override };
}

test('a seal of the wrong kind is invalid-seal', () => {
  assert.equal(reasonOf(craft({ author: alice, to: bob, seal: { kind: 14 } })), 'invalid-seal');
  assert.equal(reasonOf(craft({ author: alice, to: bob, seal: { kind: 1059 } })), 'invalid-seal');
});

test('a seal with tags is invalid-seal', () => {
  assert.equal(reasonOf(craft({ author: alice, to: bob, seal: { tags: [['p', bob.pubkey]] } })), 'invalid-seal');
});

// [description, field overrides applied to a correctly signed seal]
const TAMPERED_SEALS = [
  ['a changed signature', { sig: 'f'.repeat(128) }],
  ['a signature of the wrong length', { sig: 'ab' }],
  ['a missing signature', { sig: undefined }],
  ['a changed id', { id: 'f'.repeat(64) }],
  ['a missing id', { id: undefined }],
  ['a changed created_at', { created_at: NOW + 1 }],
  ['a swapped signer pubkey', { pubkey: bob.pubkey }],
  ['a malformed signer pubkey', { pubkey: 'zz' }],
  ['a non-numeric created_at', { created_at: 'now' }],
  ['non-string content', { content: 7 }],
];

for (const [description, override] of TAMPERED_SEALS) {
  test(`a seal with ${description} is invalid-seal`, () => {
    assert.equal(reasonOf(craft({ author: alice, to: bob, sealPayload: sealWith(override) })), 'invalid-seal');
  });
}

test('a seal whose content was changed after signing is invalid-seal', () => {
  const other = encryptTo({ forged: true }, alice.secretKey, bob.pubkey);
  assert.equal(reasonOf(craft({ author: alice, to: bob, sealPayload: sealWith({ content: other }) })), 'invalid-seal');
});

test('a seal that is an empty object is invalid-seal', () => {
  assert.equal(reasonOf(craft({ author: alice, to: bob, sealPayload: {} })), 'invalid-seal');
});

// ---------------------------------------------------------------------------
// invalid-rumor
// ---------------------------------------------------------------------------

const goodRumor = () => createRumor({ kind: 14, tags: [['p', bob.pubkey]], content: 'x', created_at: NOW }, alice.pubkey);

// [description, rumor fields overridden]
const BAD_RUMORS = [
  ['no id', { id: undefined }],
  ['an id that is not hex', { id: 'zz'.repeat(32) }],
  ['an uppercase id', { id: goodRumor().id.toUpperCase() }],
  ['no pubkey', { pubkey: undefined }],
  ['a short pubkey', { pubkey: 'abc' }],
  ['a string kind', { kind: '14' }],
  ['a fractional kind', { kind: 14.5 }],
  ['no kind', { kind: undefined }],
  ['a string created_at', { created_at: '1' }],
  ['a fractional created_at', { created_at: 1.5 }],
  ['numeric content', { content: 5 }],
  ['no content', { content: undefined }],
  ['no tags', { tags: undefined }],
  ['tags that are a string', { tags: 'p' }],
  ['a tag that is a string', { tags: ['p'] }],
  ['a tag with a number', { tags: [['p', 5]] }],
  ['a null tag', { tags: [null] }],
];

for (const [description, override] of BAD_RUMORS) {
  test(`a rumor with ${description} is invalid-rumor`, () => {
    assert.equal(reasonOf(craft({ author: alice, to: bob, rumor: { ...goodRumor(), ...override } })), 'invalid-rumor');
  });
}

// ---------------------------------------------------------------------------
// impersonation
// ---------------------------------------------------------------------------

test('a rumor claiming Alice inside a seal signed by Mallory is impersonation', () => {
  const mallory = person();
  // The id is correct: only the seal signer disagrees with the rumor author.
  const rumor = createRumor({ kind: 14, tags: [['p', bob.pubkey]], content: 'send me money', created_at: NOW }, alice.pubkey);
  assert.equal(reasonOf(craft({ author: alice, sealer: mallory, to: bob, rumor })), 'impersonation');
});

test('a rumor claiming to be written by us, sealed by a stranger, is impersonation', () => {
  const mallory = person();
  const rumor = createRumor({ kind: 14, tags: [['p', alice.pubkey]], content: 'x', created_at: NOW }, bob.pubkey);
  assert.equal(reasonOf(craft({ author: bob, sealer: mallory, to: bob, rumor })), 'impersonation');
});

// ---------------------------------------------------------------------------
// id-mismatch (upstream nostr-core issue #73)
// ---------------------------------------------------------------------------

test('a rumor whose id is not the hash of its content is id-mismatch', () => {
  const forged = { ...goodRumor(), id: 'f'.repeat(64) };
  assert.equal(reasonOf(craft({ author: alice, to: bob, rumor: forged })), 'id-mismatch');
});

test('a rumor re-using the id of another message with different content is id-mismatch', () => {
  const original = goodRumor();
  const swapped = { ...original, content: 'a different message' };
  assert.equal(reasonOf(craft({ author: alice, to: bob, rumor: swapped })), 'id-mismatch');
});

test('changing any rumor field without recomputing the id is id-mismatch', () => {
  const rumor = goodRumor();
  for (const change of [{ created_at: NOW + 1 }, { kind: 7 }, { tags: [['p', bob.pubkey], ['x', 'y']] }]) {
    assert.equal(reasonOf(craft({ author: alice, to: bob, rumor: { ...rumor, ...change } })), 'id-mismatch', inspect(change));
  }
});

// ---------------------------------------------------------------------------
// Never throws
// ---------------------------------------------------------------------------

test('hostile arguments are reported, never thrown', () => {
  const wrap = craft({ author: alice, to: bob });
  const attempts = [
    () => openGiftWrap(wrap, undefined, { me: bob.pubkey }),
    () => openGiftWrap(wrap, 'secret', { me: bob.pubkey }),
    () => openGiftWrap(wrap, new Uint8Array(0), { me: bob.pubkey }),
    () => openGiftWrap(wrap, bob.secretKey),
    () => openGiftWrap(wrap, bob.secretKey, {}),
    () => openGiftWrap(wrap, bob.secretKey, { me: 5 }),
    () => openGiftWrap(wrap, bob.secretKey, null),
    () => openGiftWrap(),
  ];
  for (const attempt of attempts) {
    const result = attempt();
    assert.equal(result.ok, false);
    assert.ok(Object.values(OPEN_FAILURE).includes(result.reason));
  }
});

test('opening with the wrong key reports undecryptable and does not leak', () => {
  const result = openGiftWrap(craft({ author: alice, to: bob }), carol.secretKey, { me: bob.pubkey });
  assert.deepEqual(result, { ok: false, reason: 'undecryptable' });
});

test('the failure result is just { ok, reason }', () => {
  assert.deepEqual(Object.keys(open({ kind: 1 })).sort(), ['ok', 'reason']);
});
