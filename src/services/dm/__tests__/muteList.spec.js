/**
 * The NIP-51 mute list (services/dm/muteList.js): reading another app's list
 * without losing what the chat does not handle, writing block changes into
 * it, and the rules that keep a list nobody can fully read from being
 * rewritten. A real local chat signer does the NIP-44 and the signing.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finalizeEvent, generateSecretKey, getPublicKey, nip04, verifyEvent } from 'nostr-core';
import { KIND } from '../constants.js';
import { createLocalDmSigner } from '../dmSigner.js';
import { createSessionKey } from '../sessionKey.js';
import {
  applyBlockChanges,
  blockedKeysOf,
  buildMuteListTemplate,
  createMuteListSync,
  readMuteList,
} from '../muteList.js';

const hex = (c) => c.repeat(64);
const ALICE = hex('a');
const BOB = hex('b');
const CAROL = hex('c');
const NOW_S = 1_760_000_000;

function identity() {
  const secretKey = generateSecretKey();
  const me = getPublicKey(secretKey);
  const signer = createLocalDmSigner({ pubkey: me, sessionKey: createSessionKey({ pubkey: me, load: async () => Uint8Array.from(secretKey) }) });
  return { secretKey, me, signer };
}

/** A kind 10000 event of `who` as another app would publish it. */
async function listEvent(who, { publicTags = [], privateTags = null, createdAt = NOW_S - 100 } = {}) {
  const content = privateTags === null ? '' : await who.signer.nip44Encrypt(who.me, JSON.stringify(privateTags));
  return finalizeEvent({ kind: KIND.MUTE_LIST, created_at: createdAt, tags: publicTags, content }, who.secretKey);
}

/** The store port the sync talks to, in memory. */
function fakeStore(changes = []) {
  const store = {
    changes: [...changes],
    adopted: [],
    pendingBlockChanges: () => store.changes.map((change) => ({ ...change })),
    settleBlockChanges(settled) {
      const saved = new Set(settled.map((c) => `${c.op}:${c.pubkey}`));
      store.changes = store.changes.filter((c) => !saved.has(`${c.op}:${c.pubkey}`));
    },
    adoptBlockList(keys, options) {
      store.adopted.push({ keys: [...keys].sort(), ...options });
    },
  };
  return store;
}

// --- reading -----------------------------------------------------------------

test('read: public and private keys, every other entry kept verbatim, the client tag dropped', async () => {
  const me = identity();
  const event = await listEvent(me, {
    publicTags: [['p', ALICE.toUpperCase()], ['t', 'spam'], ['word', 'scam'], ['client', 'lotus']],
    privateTags: [['p', BOB], ['e', hex('e')], ['p', 'not-a-key']],
  });
  const list = await readMuteList(event, me);
  assert.deepEqual(list.publicKeys, [ALICE], 'keys are normalised to lowercase');
  assert.deepEqual(list.privateKeys, [BOB]);
  assert.deepEqual(list.otherPublicTags, [['t', 'spam'], ['word', 'scam']]);
  assert.deepEqual(list.otherPrivateTags, [['e', hex('e')], ['p', 'not-a-key']]);
  assert.equal(list.readable, true);
  assert.equal(list.createdAt, event.created_at);
  assert.deepEqual(blockedKeysOf(list).sort(), [ALICE, BOB].sort());
});

test('read: no event is an empty, readable list', async () => {
  const me = identity();
  assert.deepEqual(await readMuteList(null, me), { publicKeys: [], privateKeys: [], otherPublicTags: [], otherPrivateTags: [], readable: true, createdAt: 0 });
});

test('read: a private part this device cannot read (NIP-04, garbage) marks the list unreadable', async () => {
  const me = identity();
  const legacy = finalizeEvent({ kind: KIND.MUTE_LIST, created_at: NOW_S, tags: [['p', ALICE]], content: nip04.encrypt(me.secretKey, me.me, JSON.stringify([['p', BOB]])) }, me.secretKey);
  const old = await readMuteList(legacy, me);
  assert.equal(old.readable, false);
  assert.deepEqual(old.publicKeys, [ALICE], 'the public part is still read');
  assert.deepEqual(old.privateKeys, []);
  const garbage = finalizeEvent({ kind: KIND.MUTE_LIST, created_at: NOW_S, tags: [], content: 'not ciphertext' }, me.secretKey);
  assert.equal((await readMuteList(garbage, me)).readable, false);
});

// --- writing -----------------------------------------------------------------

test('apply: a block goes private unless already public; an unblock removes the key from both parts', () => {
  const list = { publicKeys: [ALICE], privateKeys: [BOB], otherPublicTags: [], otherPrivateTags: [], readable: true, createdAt: 1 };
  const next = applyBlockChanges(list, [
    { op: 'block', pubkey: ALICE },
    { op: 'block', pubkey: CAROL },
    { op: 'unblock', pubkey: BOB },
  ]);
  assert.deepEqual(next.publicKeys, [ALICE]);
  assert.deepEqual(next.privateKeys, [CAROL]);
  assert.deepEqual(applyBlockChanges(next, [{ op: 'unblock', pubkey: ALICE }]).publicKeys, []);
});

test('build: round-trips through a signed event; an empty private part is still encrypted', async () => {
  const me = identity();
  const list = { publicKeys: [ALICE], privateKeys: [BOB], otherPublicTags: [['word', 'scam']], otherPrivateTags: [['t', 'x']], readable: true, createdAt: 0 };
  const event = await me.signer.signEvent(await buildMuteListTemplate(list, { ...me, createdAt: NOW_S }));
  assert.equal(verifyEvent(event), true);
  assert.equal(event.kind, KIND.MUTE_LIST);
  const back = await readMuteList(event, me);
  assert.deepEqual([back.publicKeys, back.privateKeys, back.otherPublicTags, back.otherPrivateTags], [[ALICE], [BOB], [['word', 'scam']], [['t', 'x']]]);
  const empty = await buildMuteListTemplate({ ...list, privateKeys: [], otherPrivateTags: [] }, { ...me, createdAt: NOW_S });
  assert.notEqual(empty.content, '');
  assert.equal(JSON.parse(await me.signer.nip44Decrypt(me.me, empty.content)).length, 0);
});

// --- sync --------------------------------------------------------------------

function syncWith({ me, store, latest = null, anyAnswered = true, accept = true }) {
  const published = [];
  const sync = createMuteListSync({
    me: me.me,
    signer: me.signer,
    store,
    fetchLatest: async () => ({ best: latest, anyAnswered }),
    publish: async (event) => {
      published.push(event);
      return accept;
    },
    now: () => NOW_S * 1000,
  });
  return { sync, published };
}

test('sync: silence decides nothing; no relay answering leaves the store and the list alone', async () => {
  const me = identity();
  const store = fakeStore([{ op: 'block', pubkey: ALICE }]);
  const { sync, published } = syncWith({ me, store, anyAnswered: false });
  await sync.sync();
  assert.equal(published.length, 0);
  assert.equal(store.adopted.length, 0);
  assert.equal(store.changes.length, 1);
});

test('sync: changes made here are written into the newest list, keeping everything else, newer than it', async () => {
  const me = identity();
  const latest = await listEvent(me, { publicTags: [['p', ALICE], ['word', 'scam']], privateTags: [['p', BOB], ['t', 'x']], createdAt: NOW_S + 50 });
  const store = fakeStore([{ op: 'block', pubkey: CAROL }, { op: 'unblock', pubkey: ALICE }]);
  const { sync, published } = syncWith({ me, store, latest });
  await sync.sync();
  assert.equal(published.length, 1);
  const written = await readMuteList(published[0], me);
  assert.deepEqual(written.publicKeys, []);
  assert.deepEqual(written.privateKeys.sort(), [BOB, CAROL].sort());
  assert.deepEqual(written.otherPublicTags, [['word', 'scam']]);
  assert.deepEqual(written.otherPrivateTags, [['t', 'x']]);
  assert.equal(published[0].created_at, NOW_S + 51, 'newer than the list it replaces, even with a clock behind');
  assert.deepEqual(store.changes, [], 'saved');
  assert.deepEqual(store.adopted, [{ keys: [BOB, CAROL].sort(), complete: true }]);
});

test('sync: a list whose private part cannot be read is never rewritten; its keys only add blocks', async () => {
  const me = identity();
  const legacy = finalizeEvent({ kind: KIND.MUTE_LIST, created_at: NOW_S, tags: [['p', ALICE]], content: nip04.encrypt(me.secretKey, me.me, '[]') }, me.secretKey);
  const store = fakeStore([{ op: 'block', pubkey: BOB }]);
  const { sync, published } = syncWith({ me, store, latest: legacy });
  await sync.sync();
  assert.equal(published.length, 0);
  assert.equal(store.changes.length, 1, 'still waiting to be saved');
  assert.deepEqual(store.adopted, [{ keys: [ALICE], complete: false }]);
});

test('sync: no list yet and nothing to save adopts an empty, complete list; a refused publish keeps the changes', async () => {
  const me = identity();
  const quiet = fakeStore();
  await syncWith({ me, store: quiet }).sync.sync();
  assert.deepEqual(quiet.adopted, [{ keys: [], complete: true }]);

  const store = fakeStore([{ op: 'block', pubkey: ALICE }]);
  const { sync, published } = syncWith({ me, store, accept: false });
  await sync.sync();
  assert.equal(published.length, 1);
  assert.equal(store.changes.length, 1, 'not saved, tried again next time');
  assert.deepEqual(store.adopted, [{ keys: [], complete: true }], 'the store keeps its unsaved changes on top');
});

test('sync: a sync asked for during a run runs once more, and both callers wait for it', async () => {
  const me = identity();
  const store = fakeStore();
  let fetches = 0;
  let release;
  const sync = createMuteListSync({
    me: me.me,
    signer: me.signer,
    store,
    fetchLatest: () => {
      fetches += 1;
      return fetches === 1 ? new Promise((resolve) => { release = () => resolve({ best: null, anyAnswered: true }); }) : Promise.resolve({ best: null, anyAnswered: true });
    },
    publish: async () => true,
  });
  const first = sync.sync();
  const second = sync.sync();
  const third = sync.sync();
  assert.equal(first, second);
  assert.equal(second, third);
  release();
  await first;
  assert.equal(fetches, 2, 'one follow-up run, not one per call');
});
