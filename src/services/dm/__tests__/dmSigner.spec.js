/**
 * The chat signer: one async interface for a key on this phone and for a
 * signer app (NIP-07 extension, NIP-46 remote signer).
 *
 * The external side is driven with nostr-core's own secret-key Signer as the
 * "app", wrapped in controllable delays and failures, so the full gift-wrap
 * round trip runs through exactly the calls a real signer app receives.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/dmSigner.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSecretKeySigner, generateSecretKey, getPublicKey } from 'nostr-core';
import { createExternalDmSigner, createLocalDmSigner, toDmError } from '../dmSigner.js';
import { DM_ERROR, DmError, isSignerWait } from '../errors.js';
import { sealAndWrap } from '../giftWrap.js';
import { openGiftWrap } from '../openWrap.js';
import { createSessionKey } from '../sessionKey.js';
import { keySigner } from './testSigner.js';

const NOW = 1_760_000_000;

function person() {
  const secretKey = generateSecretKey();
  return { secretKey, pubkey: getPublicKey(secretKey) };
}

const textTo = (pubkey) => ({ kind: 14, tags: [['p', pubkey]], content: 'hi', created_at: NOW });

const isCode = (code) => (err) => DmError.is(err, code);

/** An external chat signer whose "app" is nostr-core's secret-key Signer, with hooks. */
function appSigner(owner, { hook = async () => {}, ...options } = {}) {
  const app = createSecretKeySigner(owner.secretKey);
  const calls = [];
  const signer = createExternalDmSigner({
    pubkey: owner.pubkey,
    acquire: async () => ({
      signer: {
        signEvent: async (template) => { calls.push('sign'); await hook('sign'); return app.signEvent(template); },
        nip44: {
          encrypt: async (peer, text) => { calls.push('encrypt'); await hook('encrypt'); return app.nip44.encrypt(peer, text); },
          decrypt: async (peer, payload) => { calls.push('decrypt'); await hook('decrypt'); return app.nip44.decrypt(peer, payload); },
        },
      },
    }),
    ...options,
  });
  return { signer, calls };
}

// ---------------------------------------------------------------------------
// Round trips
// ---------------------------------------------------------------------------

test('a message sealed through a signer app opens with a local key, and back', async () => {
  const alice = person();
  const bob = person();
  const { signer: aliceApp, calls } = appSigner(alice);

  const { rumor, wraps } = await sealAndWrap({ template: textTo(bob.pubkey), signer: aliceApp, recipients: [bob.pubkey] });
  // Recipient and self copy: one encrypt and one seal signature each, nothing else.
  assert.deepEqual(calls.sort(), ['encrypt', 'encrypt', 'sign', 'sign']);
  const toBob = await openGiftWrap(wraps[0].event, keySigner(bob.secretKey), { me: bob.pubkey });
  assert.equal(toBob.ok, true);
  assert.equal(toBob.rumor.id, rumor.id);
  assert.equal(toBob.sender, alice.pubkey);

  // The self copy opens through the app: two decrypts.
  calls.length = 0;
  const self = await openGiftWrap(wraps[1].event, aliceApp, { me: alice.pubkey });
  assert.equal(self.ok, true);
  assert.deepEqual(calls, ['decrypt', 'decrypt']);

  const reply = await sealAndWrap({ template: textTo(alice.pubkey), signer: keySigner(bob.secretKey), recipients: [alice.pubkey] });
  const opened = await openGiftWrap(reply.wraps[0].event, aliceApp, { me: alice.pubkey });
  assert.equal(opened.sender, bob.pubkey);
});

test('the local signer encrypts, decrypts and signs with the key in the session key holder', async () => {
  const alice = person();
  const bob = person();
  const local = createLocalDmSigner({
    pubkey: alice.pubkey,
    sessionKey: createSessionKey({ pubkey: alice.pubkey, load: async () => alice.secretKey.slice() }),
  });
  const payload = await local.nip44Encrypt(bob.pubkey, 'secret');
  assert.equal(await keySigner(bob.secretKey).nip44Decrypt(alice.pubkey, payload), 'secret');
  const event = await local.signEvent({ kind: 1, tags: [], content: '', created_at: NOW });
  assert.equal(event.pubkey, alice.pubkey);
  assert.equal(local.external, false);
  assert.equal(local.isLoaded(), true);
  local.wipe('lock');
  assert.equal(local.isLoaded(), false);
});

// ---------------------------------------------------------------------------
// The external signer's rules
// ---------------------------------------------------------------------------

test('no more requests run at once than maxParallel allows', async () => {
  const alice = person();
  let inFlight = 0;
  let peak = 0;
  const { signer } = appSigner(alice, {
    maxParallel: 2,
    hook: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    },
  });
  const template = { kind: 1, tags: [], content: '', created_at: NOW };
  await Promise.all(Array.from({ length: 6 }, () => signer.signEvent(template)));
  assert.equal(peak, 2);
});

test('a signer app that does not answer in time is SIGNER_UNAVAILABLE, and the work may wait', async () => {
  const alice = person();
  const { signer } = appSigner(alice, { timeoutMs: 10, hook: () => new Promise(() => {}) });
  const err = await signer.nip44Decrypt(alice.pubkey, 'x').catch((e) => e);
  assert.ok(DmError.is(err, DM_ERROR.SIGNER_UNAVAILABLE));
  assert.equal(isSignerWait(err), true);
});

test('after a refusal nothing more is asked until the person allows it again', async () => {
  const alice = person();
  let refuse = true;
  const { signer, calls } = appSigner(alice, {
    hook: async () => {
      if (refuse) throw new Error('User rejected the request');
    },
  });
  await assert.rejects(signer.nip44Decrypt(alice.pubkey, 'x'), isCode(DM_ERROR.SIGNER_DENIED));
  await assert.rejects(signer.nip44Decrypt(alice.pubkey, 'x'), isCode(DM_ERROR.SIGNER_DENIED));
  assert.equal(calls.length, 1, 'the second request never reached the app');

  refuse = false;
  signer.allowAgain();
  const bob = person();
  const payload = await keySigner(bob.secretKey).nip44Encrypt(alice.pubkey, 'hello');
  assert.equal(await signer.nip44Decrypt(bob.pubkey, payload), 'hello');
  assert.equal(calls.length, 2, 'asked again after allowAgain');
});

test('while the app is locked nothing reaches the signer app', async () => {
  const alice = person();
  let locked = true;
  const { signer, calls } = appSigner(alice, { isLocked: () => locked });
  await assert.rejects(signer.signEvent({ kind: 1, tags: [], content: '', created_at: NOW }), isCode(DM_ERROR.KEY_WIPED));
  assert.equal(calls.length, 0);
  locked = false;
  const event = await signer.signEvent({ kind: 1, tags: [], content: '', created_at: NOW });
  assert.equal(event.pubkey, alice.pubkey);
});

test('an event signed for another identity is refused', async () => {
  const alice = person();
  const mallory = person();
  const pinned = createExternalDmSigner({ pubkey: alice.pubkey, acquire: async () => ({ signer: createSecretKeySigner(mallory.secretKey) }) });
  await assert.rejects(pinned.signEvent({ kind: 1, tags: [], content: '', created_at: NOW }), isCode(DM_ERROR.NO_IDENTITY));
});

test('an app without NIP-44 is SIGNER_UNSUPPORTED', async () => {
  const alice = person();
  const signer = createExternalDmSigner({ pubkey: alice.pubkey, acquire: async () => ({ signer: { signEvent: async () => ({}) } }) });
  await assert.rejects(signer.nip44Encrypt(alice.pubkey, 'x'), isCode(DM_ERROR.SIGNER_UNSUPPORTED));
});

test('dispose and wipe drop what still waits, as KEY_WIPED', async () => {
  const alice = person();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { signer } = appSigner(alice, { hook: () => gate });
  const template = { kind: 1, tags: [], content: '', created_at: NOW };
  const first = signer.signEvent(template);
  const queued = signer.signEvent(template);
  signer.wipe('lock');
  await assert.rejects(queued, isCode(DM_ERROR.KEY_WIPED));
  release();
  assert.equal((await first).pubkey, alice.pubkey, 'a request already with the app finishes');
  signer.dispose();
  await assert.rejects(signer.signEvent(template), isCode(DM_ERROR.KEY_WIPED));
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

test('signer app errors map to chat codes; payload errors stay as they are', () => {
  const named = (name, message = '') => Object.assign(new Error(message), { name });
  const coded = (code, message = '') => Object.assign(new Error(message), { code });
  const cases = [
    [named('Nip46TimeoutError'), DM_ERROR.SIGNER_UNAVAILABLE],
    [named('Nip46ConnectionError'), DM_ERROR.SIGNER_UNAVAILABLE],
    [coded('NIP07_NOT_AVAILABLE'), DM_ERROR.SIGNER_UNAVAILABLE],
    [coded('NIP07_NIP44_UNSUPPORTED'), DM_ERROR.SIGNER_UNSUPPORTED],
    [coded('SIGNER_MISMATCH'), DM_ERROR.NO_IDENTITY],
    [named('Nip46RemoteError', 'Permission denied for nip44_decrypt'), DM_ERROR.SIGNER_DENIED],
    [new Error('User rejected'), DM_ERROR.SIGNER_DENIED],
  ];
  for (const [err, code] of cases) assert.ok(DmError.is(toDmError(err), code), `${err.name}: ${err.message} -> ${code}`);

  const payload = named('Nip46RemoteError', 'invalid MAC');
  assert.equal(toDmError(payload), payload);
  const own = new DmError(DM_ERROR.TIMEOUT);
  assert.equal(toDmError(own), own);
});

test('while the app is in the background nothing reaches the signer app; the work waits', async () => {
  const alice = person();
  let hidden = true;
  const { signer, calls } = appSigner(alice, { isHidden: () => hidden });
  const err = await signer.nip44Decrypt(alice.pubkey, 'x').catch((e) => e);
  assert.ok(DmError.is(err, DM_ERROR.KEY_WIPED));
  assert.equal(isSignerWait(err), true);
  assert.equal(calls.length, 0);
  hidden = false;
  assert.equal((await signer.signEvent({ kind: 1, tags: [], content: '', created_at: NOW })).pubkey, alice.pubkey);
});

test('a decrypt error that does not blame the ciphertext waits; one that does is final', async () => {
  const alice = person();
  const failing = (message) => createExternalDmSigner({
    pubkey: alice.pubkey,
    acquire: async () => ({ signer: { signEvent: async () => ({}), nip44: { encrypt: async () => '', decrypt: async () => { throw Object.assign(new Error(message), { name: 'Nip46Error' }); } } } }),
  });
  for (const message of ['Connection closed', 'Failed to publish nip44_decrypt', 'Prompt was closed']) {
    const err = await failing(message).nip44Decrypt(alice.pubkey, 'x').catch((e) => e);
    assert.ok(DmError.is(err, DM_ERROR.SIGNER_UNAVAILABLE), message);
  }
  const bad = await failing('invalid MAC').nip44Decrypt(alice.pubkey, 'x').catch((e) => e);
  assert.equal(bad instanceof DmError, false, 'a bad ciphertext is the wrap\'s problem, not the signer\'s');
});
