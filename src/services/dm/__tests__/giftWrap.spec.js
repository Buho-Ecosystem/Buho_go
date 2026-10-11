/**
 * Gift wrap builder tests.
 *
 * `sealAndWrap` is what every outgoing message goes through, so the tests open
 * every wrap it produces with our own `openGiftWrap` (the receiving side of
 * the same contract) and check what a relay can see: kinds, `p` tags and
 * ephemeral authors. Failure cases cover the arguments a caller can get wrong
 * and the size limit.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/giftWrap.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect } from 'node:util';
import { createRumor, generateSecretKey, getPublicKey } from 'nostr-core';
import { MAX_RUMOR_BYTES } from '../constants.js';
import { DM_ERROR, DmError } from '../errors.js';
import { sealAndWrap } from '../giftWrap.js';
import { openGiftWrap } from '../openWrap.js';
import { keySigner } from './testSigner.js';

const NOW = 1_760_000_000;
const encoder = new TextEncoder();
const jsonBytes = (value) => encoder.encode(JSON.stringify(value)).length;

/** A person: secret key, pubkey and chat signer. */
function person() {
  const secretKey = generateSecretKey();
  return { secretKey, pubkey: getPublicKey(secretKey), signer: keySigner(secretKey) };
}

const template = (recipients, content = 'hello') => ({
  kind: 14,
  tags: recipients.map((pubkey) => ['p', pubkey]),
  content,
  created_at: NOW,
});

async function throwsDm(fn, code) {
  try {
    await fn();
  } catch (err) {
    assert.ok(DmError.is(err, code), `expected DmError ${code}, got ${inspect(err)}`);
    return err;
  }
  return assert.fail(`expected DmError ${code}`);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

test('every wrap opens, with its recipient\'s key, to the same rumor', async () => {
  const alice = person();
  const bob = person();
  const carol = person();
  const { rumor, wraps } = await sealAndWrap({
    template: template([bob.pubkey, carol.pubkey]),
    signer: alice.signer,
    recipients: [bob.pubkey, carol.pubkey],
  });

  assert.equal(wraps.length, 3);
  const keys = { [alice.pubkey]: alice, [bob.pubkey]: bob, [carol.pubkey]: carol };
  for (const { recipient, event } of wraps) {
    const opened = await openGiftWrap(event, keySigner(keys[recipient].secretKey), { me: recipient });
    assert.equal(opened.ok, true, `${recipient.slice(0, 6)} can open its wrap`);
    assert.equal(opened.rumor.id, rumor.id);
    assert.equal(opened.sender, alice.pubkey);
    assert.deepEqual(opened.rumor, rumor);
  }
});

test('the rumor is the template authored by the sender, with its id', async () => {
  const alice = person();
  const bob = person();
  const input = template([bob.pubkey], 'hi');
  const { rumor } = await sealAndWrap({ template: input, signer: alice.signer, recipients: [bob.pubkey] });
  assert.deepEqual(rumor, createRumor(input, alice.pubkey));
});

test('the self copy comes last, is flagged and is addressed to the sender', async () => {
  const alice = person();
  const bob = person();
  const carol = person();
  const { wraps } = await sealAndWrap({
    template: template([bob.pubkey, carol.pubkey]),
    signer: alice.signer,
    recipients: [bob.pubkey, carol.pubkey],
  });
  assert.deepEqual(wraps.map((w) => [w.recipient, w.self]), [
    [bob.pubkey, false],
    [carol.pubkey, false],
    [alice.pubkey, true],
  ]);
  const selfWrap = wraps.at(-1).event;
  assert.deepEqual(selfWrap.tags, [['p', alice.pubkey]]);
  assert.equal((await openGiftWrap(selfWrap, keySigner(alice.secretKey), { me: alice.pubkey })).ok, true);
});

test('selfCopy: false leaves out the copy for the sender', async () => {
  const alice = person();
  const bob = person();
  const { wraps } = await sealAndWrap({
    template: template([bob.pubkey]),
    signer: alice.signer,
    recipients: [bob.pubkey],
    selfCopy: false,
  });
  assert.deepEqual(wraps.map((w) => [w.recipient, w.self]), [[bob.pubkey, false]]);
});

test('recipients are deduplicated and the sender is dropped from them', async () => {
  const alice = person();
  const bob = person();
  const { wraps } = await sealAndWrap({
    template: template([bob.pubkey]),
    signer: alice.signer,
    recipients: [bob.pubkey, alice.pubkey, bob.pubkey, alice.pubkey],
  });
  assert.deepEqual(wraps.map((w) => [w.recipient, w.self]), [
    [bob.pubkey, false],
    [alice.pubkey, true],
  ]);
});

test('addressing only yourself yields just the self copy, or nothing to wrap without it', async () => {
  const alice = person();
  const only = await sealAndWrap({ template: template([alice.pubkey]), signer: alice.signer, recipients: [alice.pubkey] });
  assert.equal(only.wraps.length, 1);
  assert.equal(only.wraps[0].self, true);
  await throwsDm(
    () => sealAndWrap({ template: template([]), signer: alice.signer, recipients: [alice.pubkey], selfCopy: false }),
    DM_ERROR.INVALID_ARGUMENT,
  );
});

test('what a relay sees: kind 1059, one p tag with the recipient, a throwaway author', async () => {
  const alice = person();
  const bob = person();
  const { wraps } = await sealAndWrap({ template: template([bob.pubkey]), signer: alice.signer, recipients: [bob.pubkey] });
  for (const { recipient, event } of wraps) {
    assert.equal(event.kind, 1059);
    assert.deepEqual(event.tags, [['p', recipient]]);
    assert.notEqual(event.pubkey, alice.pubkey);
    assert.ok(event.created_at <= Math.floor(Date.now() / 1000), 'timestamps are never in the future');
    assert.ok(!event.content.includes('hello'));
  }
});

test('every wrap has its own ephemeral pubkey, id and ciphertext', async () => {
  const alice = person();
  const peers = [person(), person(), person()];
  const { wraps } = await sealAndWrap({
    template: template(peers.map((p) => p.pubkey)),
    signer: alice.signer,
    recipients: peers.map((p) => p.pubkey),
  });
  for (const field of ['pubkey', 'id', 'content']) {
    assert.equal(new Set(wraps.map((w) => w.event[field])).size, wraps.length, `${field} differs per wrap`);
  }
  const again = await sealAndWrap({ template: template([peers[0].pubkey]), signer: alice.signer, recipients: [peers[0].pubkey] });
  assert.notEqual(again.wraps[0].event.pubkey, wraps[0].event.pubkey, 'and per call');
});

test('a wrap cannot be opened by anyone but its recipient', async () => {
  const alice = person();
  const bob = person();
  const mallory = person();
  const { wraps } = await sealAndWrap({ template: template([bob.pubkey]), signer: alice.signer, recipients: [bob.pubkey] });
  const opened = await openGiftWrap(wraps[0].event, keySigner(mallory.secretKey), { me: bob.pubkey });
  assert.deepEqual(opened, { ok: false, reason: 'undecryptable' });
});

test('the input template is neither changed nor leaked beyond its four fields', async () => {
  const alice = person();
  const bob = person();
  const input = { ...template([bob.pubkey]), sig: 'f'.repeat(128), pubkey: 'e'.repeat(64), extra: true };
  const snapshot = structuredClone(input);
  const { rumor } = await sealAndWrap({ template: input, signer: alice.signer, recipients: [bob.pubkey] });
  assert.deepEqual(input, snapshot);
  assert.deepEqual(Object.keys(rumor).sort(), ['content', 'created_at', 'id', 'kind', 'pubkey', 'tags']);
  assert.equal(rumor.pubkey, alice.pubkey);
});

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

/** A template whose rumor JSON is exactly `size` UTF-8 bytes. */
function templateOfBytes(size, authorPubkey, recipient) {
  const base = template([recipient], '');
  const empty = jsonBytes(createRumor(base, authorPubkey));
  return { ...base, content: 'a'.repeat(size - empty) };
}

test('a rumor of exactly MAX_RUMOR_BYTES is wrapped', async () => {
  const alice = person();
  const bob = person();
  const input = templateOfBytes(MAX_RUMOR_BYTES, alice.pubkey, bob.pubkey);
  const { rumor, wraps } = await sealAndWrap({ template: input, signer: alice.signer, recipients: [bob.pubkey] });
  assert.equal(jsonBytes(rumor), MAX_RUMOR_BYTES);
  assert.equal((await openGiftWrap(wraps[0].event, keySigner(bob.secretKey), { me: bob.pubkey })).rumor.id, rumor.id);
});

test('one byte over MAX_RUMOR_BYTES is MESSAGE_TOO_LARGE, with the sizes as details', async () => {
  const alice = person();
  const bob = person();
  const input = templateOfBytes(MAX_RUMOR_BYTES + 1, alice.pubkey, bob.pubkey);
  const err = await throwsDm(
    () => sealAndWrap({ template: input, signer: alice.signer, recipients: [bob.pubkey] }),
    DM_ERROR.MESSAGE_TOO_LARGE,
  );
  assert.deepEqual(err.details, { bytes: MAX_RUMOR_BYTES + 1, max: MAX_RUMOR_BYTES });
});

test('the size is counted in UTF-8 bytes of the JSON, not in characters', async () => {
  const alice = person();
  const bob = person();
  // 12,000 four-byte emoji are 12,000 code points (24,000 UTF-16 units) but 48,000 bytes.
  const input = template([bob.pubkey], '\u{1F989}'.repeat(12_000));
  await throwsDm(
    () => sealAndWrap({ template: input, signer: alice.signer, recipients: [bob.pubkey] }),
    DM_ERROR.MESSAGE_TOO_LARGE,
  );
  // Characters that JSON escapes grow as well: 7,000 control characters are 42,000 bytes.
  await throwsDm(
    () => sealAndWrap({ template: template([bob.pubkey], '\u0000'.repeat(7_000)), signer: alice.signer, recipients: [bob.pubkey] }),
    DM_ERROR.MESSAGE_TOO_LARGE,
  );
});

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const alice = person();
const bobPubkey = person().pubkey;
const wrapWith = (overrides) =>
  sealAndWrap({ template: template([bobPubkey]), signer: alice.signer, recipients: [bobPubkey], ...overrides });

const BAD_TEMPLATES = [
  undefined,
  null,
  'text',
  [],
  {},
  { ...template([bobPubkey]), kind: '14' },
  { ...template([bobPubkey]), kind: 1.5 },
  { ...template([bobPubkey]), content: undefined },
  { ...template([bobPubkey]), content: 5 },
  { ...template([bobPubkey]), created_at: '1760000000' },
  { ...template([bobPubkey]), created_at: NaN },
  { ...template([bobPubkey]), tags: undefined },
  { ...template([bobPubkey]), tags: 'p' },
  { ...template([bobPubkey]), tags: ['p'] },
  { ...template([bobPubkey]), tags: [['p', 5]] },
  { ...template([bobPubkey]), tags: [null] },
];

for (const bad of BAD_TEMPLATES) {
  test(`sealAndWrap refuses the template ${inspect(bad, { breakLength: 200 }).slice(0, 60)}`, async () => {
    await throwsDm(() => wrapWith({ template: bad }), DM_ERROR.INVALID_ARGUMENT);
  });
}

const BAD_SIGNERS = [
  undefined,
  null,
  new Uint8Array(32),
  { pubkey: alice.pubkey },
  { ...alice.signer, pubkey: 'abc' },
  { ...alice.signer, nip44Encrypt: undefined },
  { ...alice.signer, signEvent: undefined },
];

for (const signer of BAD_SIGNERS) {
  test(`sealAndWrap refuses the signer ${inspect(signer, { depth: 0 }).slice(0, 50)}`, async () => {
    await throwsDm(() => wrapWith({ signer }), DM_ERROR.INVALID_ARGUMENT);
  });
}

test('a signer that cannot answer keeps its code, so the caller can wait for it', async () => {
  const signer = {
    ...alice.signer,
    nip44Encrypt: async () => { throw new DmError(DM_ERROR.SIGNER_UNAVAILABLE); },
  };
  await throwsDm(() => wrapWith({ signer }), DM_ERROR.SIGNER_UNAVAILABLE);
});

test('a seal signed by another key is refused: the wrap would carry the wrong author', async () => {
  const mallory = person();
  const signer = { ...alice.signer, signEvent: mallory.signer.signEvent };
  await throwsDm(() => wrapWith({ signer }), DM_ERROR.NO_IDENTITY);
});

const BAD_RECIPIENT_LISTS = [
  undefined,
  null,
  [],
  bobPubkey,
  [bobPubkey, 'abc'],
  [bobPubkey.toUpperCase()],
  [bobPubkey, null],
  [{ pubkey: bobPubkey }],
  [`${bobPubkey}0`],
];

for (const recipients of BAD_RECIPIENT_LISTS) {
  test(`sealAndWrap refuses the recipients ${inspect(recipients).slice(0, 60)}`, async () => {
    await throwsDm(() => wrapWith({ recipients }), DM_ERROR.INVALID_ARGUMENT);
  });
}

test('sealAndWrap refuses a pubkey that is no curve point, keeping the cause, and wraps nothing', async () => {
  const err = await throwsDm(() => wrapWith({ recipients: ['f'.repeat(64)] }), DM_ERROR.INVALID_ARGUMENT);
  assert.ok(err.cause instanceof Error);
  assert.deepEqual(err.details, { recipient: 'f'.repeat(64) });
});

test('sealAndWrap with no arguments is an INVALID_ARGUMENT, not a TypeError', async () => {
  await throwsDm(() => sealAndWrap(), DM_ERROR.INVALID_ARGUMENT);
});
