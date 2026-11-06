import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, nip44 } from 'nostr-core';
import {
  createNotificationEvent, DEFAULT_LIFETIME_SECONDS, NotificationProtocolError,
  openNotificationEvent, parseNotificationPayload, validateNotificationEvent,
} from '../protocol.js';

const NOW = 1_798_000_000;
const receiver = person();
const sender = person();
const payload = {
  version: '1.0', title: 'Sale received', message: 'Coffee · 2,000 sats',
  topic: 'buhogo.sales', priority: 'default', timestamp: NOW,
};

function person() {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  return {
    secret, pubkey,
    nip44Encrypt: async (peer, value) => nip44.encrypt(value, nip44.getConversationKey(secret, peer)),
    nip44Decrypt: async (peer, value) => nip44.decrypt(value, nip44.getConversationKey(secret, peer)),
    signEvent: async (template) => finalizeEvent(template, secret),
  };
}

const create = (overrides = {}) => createNotificationEvent({
  recipient: receiver.pubkey, payload, signer: sender, now: NOW,
  randomId: () => 'synthetic-random-id', ...overrides,
});
const open = (event, overrides = {}) => openNotificationEvent(event, {
  signer: receiver, allowedSenders: new Set([sender.pubkey]), now: NOW, ...overrides,
});
const code = (expected) => (error) => error instanceof NotificationProtocolError && error.code === expected;
const resign = (event, overrides = {}) => finalizeEvent({
  kind: event.kind, content: event.content, created_at: event.created_at, tags: event.tags, ...overrides,
}, sender.secret);

test('real signed NIP-44 event matches the draft and opens with the recipient key', async () => {
  const event = await create();
  assert.equal(event.kind, 7741);
  assert.equal(event.id, getEventHash(event));
  assert.deepEqual(event.tags, [
    ['p', receiver.pubkey], ['d', 'synthetic-random-id'], ['expiration', String(NOW + DEFAULT_LIFETIME_SECONDS)],
  ]);
  assert.ok(!JSON.stringify(event).includes('Coffee'));
  assert.ok(!JSON.stringify(event.tags).includes(payload.topic), 'topic remains inside encryption');
  const plaintext = nip44.decrypt(event.content, nip44.getConversationKey(receiver.secret, sender.pubkey));
  assert.deepEqual(JSON.parse(plaintext), payload, 'standard crypto can read it without Buho helpers');
  assert.deepEqual((await open(event)).payload, payload);
});

test('receiver opens an independently constructed draft-compatible event', async () => {
  const foreign = finalizeEvent({
    kind: 7741, created_at: NOW,
    tags: [['d', 'cli-fixture'], ['expiration', String(NOW + 600)], ['p', receiver.pubkey]],
    content: nip44.encrypt(JSON.stringify(payload), nip44.getConversationKey(sender.secret, receiver.pubkey)),
  }, sender.secret);
  assert.deepEqual((await open(foreign)).payload, payload);
});

test('trust is denied by default, before any decryption request', async () => {
  let decrypts = 0;
  const signer = { ...receiver, nip44Decrypt: () => { decrypts++; } };
  await assert.rejects(openNotificationEvent(await create(), { signer, now: NOW }), code('UNTRUSTED_SENDER'));
  assert.equal(decrypts, 0);
});

test('a notification addressed to another key is rejected before decryption', async () => {
  await assert.rejects(open(await create(), { signer: person() }), code('WRONG_RECIPIENT'));
});

test('content changed under a previously valid ID is rejected', async () => {
  const event = await create();
  await assert.rejects(open({ ...event, content: event.content + 'A' }), code('INVALID_SIGNATURE'));
});

test('a forged signature is rejected even when the ID matches its contents', async () => {
  const event = await create();
  await assert.rejects(open({ ...event, sig: '0'.repeat(128) }), code('INVALID_SIGNATURE'));
});

test('expiration is enforced at its exact boundary before decryption', async () => {
  const event = await create({ expiresAt: NOW + 10 });
  assert.equal((await open(event, { now: NOW + 9 })).expiresAt, NOW + 10);
  await assert.rejects(open(event, { now: NOW + 10 }), code('EXPIRED_NOTIFICATION'));
  await assert.rejects(create({ expiresAt: NOW }), code('EXPIRED_NOTIFICATION'));
});

test('an already expired source cannot request encryption', async () => {
  let encrypted = false;
  await assert.rejects(create({ expiresAt: NOW - 1, signer: {
    ...sender, nip44Encrypt: () => { encrypted = true; },
  } }), code('EXPIRED_NOTIFICATION'));
  assert.equal(encrypted, false);
});

test('plaintext returned by a broken encryption signer cannot be signed or published', async () => {
  let signed = false;
  await assert.rejects(create({ signer: {
    ...sender,
    nip44Encrypt: async (_peer, plaintext) => plaintext,
    signEvent: async () => { signed = true; },
  } }), code('INVALID_ENCRYPTION_RESULT'));
  assert.equal(signed, false);
});

test('new notifications get independent random IDs and ciphertext', async () => {
  const first = await create({ randomId: undefined });
  const second = await create({ randomId: undefined });
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.tags[1][1], second.tags[1][1]);
  assert.notEqual(first.content, second.content);
});

test('far-future events and ambiguous recipient/expiration tags are rejected', async () => {
  const event = await create();
  await assert.rejects(open(resign(event, { created_at: NOW + 61 })), code('FUTURE_NOTIFICATION'));
  for (const tag of [['p', receiver.pubkey], ['expiration', String(NOW + 1000)]]) {
    await assert.rejects(open(resign(event, { tags: [...event.tags, tag] })), code('INVALID_NOTIFICATION'));
  }
});

test('public plaintext is not accepted as an encrypted inbox message', async () => {
  const event = await create();
  await assert.rejects(open(resign(event, { content: JSON.stringify(payload) })), code('DECRYPTION_FAILED'));
  await assert.rejects(open(resign(event, { tags: event.tags.filter(([name]) => name !== 'p') })), code('INVALID_NOTIFICATION'));
});

test('payload version and presentation limits are checked without echoing content', () => {
  assert.throws(() => parseNotificationPayload({ ...payload, version: '2.0' }), code('UNSUPPORTED_VERSION'));
  assert.throws(() => parseNotificationPayload({ ...payload, message: 'sensitive'.repeat(300) }), (error) => {
    assert.ok(!error.message.includes('sensitive'));
    return code('INVALID_NOTIFICATION')(error);
  });
  assert.throws(() => parseNotificationPayload({ version: '1.0', message: '' }), code('INVALID_NOTIFICATION'));
  assert.throws(() => parseNotificationPayload({ ...payload, tags: Array(21).fill('x') }), code('INVALID_NOTIFICATION'));
  assert.throws(() => parseNotificationPayload({ ...payload, priority: 'normal' }), code('INVALID_NOTIFICATION'));
});

test('known fields survive; external icons and unknown extensions are not fetched or executed', () => {
  const input = { ...payload, icon: 'https://tracking.example/icon', future: { dangerous: true }, tags: ['sale'] };
  const read = parseNotificationPayload(input);
  assert.deepEqual(read, { ...payload, tags: ['sale'] });
  input.tags.push('changed');
  assert.deepEqual(read.tags, ['sale'], 'returned values are detached');
});

test('view actions support current Buho payment links and reject executable/credential URLs', async () => {
  const link = 'buhogo://pay?request=lightning%3Alnbc-synthetic';
  const alert = { ...payload, click: link, actions: [{ label: 'Review payment', url: link, method: 'view' }] };
  assert.deepEqual((await open(await create({ payload: alert }))).payload, alert);
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', '//example.com', 'https://example.com\\x']) {
    assert.throws(() => parseNotificationPayload({ ...payload, click: url }), code('UNSAFE_ACTION'));
  }
  assert.throws(() => parseNotificationPayload({ ...payload, actions: [{ label: 'Pay', url: 'https://example.com', method: 'http' }] }), code('UNSUPPORTED_ACTION'));
});

test('a signer cannot replace the content, recipient or author after approval', async () => {
  await assert.rejects(create({ signer: {
    ...sender, signEvent: async (template) => finalizeEvent({ ...template, content: 'replaced' }, sender.secret),
  } }), code('INVALID_SIGNER_RESULT'));
  const other = person();
  await assert.rejects(create({ signer: { ...sender, signEvent: other.signEvent } }), code('INVALID_SIGNER_RESULT'));
});

test('a signer cannot mutate the expected template in place', async () => {
  await assert.rejects(create({ signer: {
    ...sender, signEvent: async (template) => {
      template.tags[1][1] = 'mutated';
      return finalizeEvent(template, sender.secret);
    },
  } }), code('INVALID_SIGNER_RESULT'));
});

test('an identity switch during encryption cannot silently change the author', async () => {
  let current = sender;
  const other = person();
  await assert.rejects(create({ signer: {
    get pubkey() { return current.pubkey; },
    nip44Encrypt: async (peer, plaintext) => {
      const encrypted = await current.nip44Encrypt(peer, plaintext);
      current = other;
      return encrypted;
    },
    signEvent: (template) => current.signEvent(template),
  } }), code('INVALID_SIGNER_RESULT'));
});

test('oversized untrusted wire input is rejected before signature/decryption work', () => {
  assert.throws(() => validateNotificationEvent({ content: 'x'.repeat(17_000) }, {
    recipient: receiver.pubkey, now: NOW,
  }), code('NOTIFICATION_TOO_LARGE'));
});
