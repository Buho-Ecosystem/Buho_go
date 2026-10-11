/**
 * Blocks follow the person: the NIP-51 mute list (kind 10000).
 *
 * The chat keeps blocked pubkeys on the device (`stores/messages.js`). Other
 * Nostr apps keep the same thing in a replaceable kind 10000 list: public `p`
 * tags, plus a private part (the JSON of more tags, NIP-44 encrypted to the
 * author's own key). This module reads that list, writes the chat's block and
 * unblock changes into it, and keeps what it does not handle (muted words,
 * hashtags, threads) exactly as it found it.
 *
 * Rules, the same as Lotus:
 *   - A new block goes into the private part; an unblock removes the key from
 *     both parts.
 *   - A list whose private part cannot be read here (NIP-04, a signer app that
 *     refused, garbage) is never rewritten: that would delete entries nobody
 *     can see. Its readable keys may still add blocks, never remove one.
 *   - "No relay answered" is not "there is no list": silence decides nothing.
 */

import { KIND } from './constants.js';

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * @typedef {object} MuteList
 * @property {string[]} publicKeys Pubkeys in public `p` tags.
 * @property {string[]} privateKeys Pubkeys in the private part.
 * @property {string[][]} otherPublicTags Every other public tag, kept verbatim.
 * @property {string[][]} otherPrivateTags Every other private tag, kept verbatim.
 * @property {boolean} readable False when a private part exists that could not be read here.
 * @property {number} createdAt The event's `created_at` (0 without an event).
 *
 * @typedef {{ op: 'block' | 'unblock', pubkey: string }} BlockChange
 */

const pubkeyOf = (tag) => {
  const key = typeof tag[1] === 'string' ? tag[1].trim().toLowerCase() : '';
  return tag[0] === 'p' && HEX_64.test(key) ? key : null;
};

/** NIP-51 used NIP-04 for private items before NIP-44; that format carries `?iv=`. */
const isNip04 = (content) => /(?:\?|&)iv=/.test(content);

/**
 * Read `me`'s kind 10000 event (null: there is none).
 *
 * @param {object | null} event
 * @param {{ me: string, signer: { nip44Decrypt: (peer: string, payload: string) => Promise<string> } }} deps
 * @returns {Promise<MuteList>}
 */
export async function readMuteList(event, { me, signer }) {
  const list = { publicKeys: [], privateKeys: [], otherPublicTags: [], otherPrivateTags: [], readable: true, createdAt: event?.created_at ?? 0 };
  if (!event) return list;
  for (const tag of event.tags) {
    if (tag[0] === 'client') continue; // names the app that wrote it last, not an entry
    const key = pubkeyOf(tag);
    if (key) list.publicKeys.push(key);
    else list.otherPublicTags.push(tag);
  }
  if (!event.content) return list;
  try {
    if (isNip04(event.content)) throw new Error('NIP-04 private part');
    const tags = JSON.parse(await signer.nip44Decrypt(me, event.content));
    if (!Array.isArray(tags)) throw new Error('not a tag list');
    for (const tag of tags) {
      if (!Array.isArray(tag)) continue;
      const key = pubkeyOf(tag);
      if (key) list.privateKeys.push(key);
      else list.otherPrivateTags.push(tag);
    }
  } catch {
    return { ...list, privateKeys: [], otherPrivateTags: [], readable: false };
  }
  return list;
}

/** `list` with `changes` applied, in order: a block goes private, an unblock removes the key from both parts. */
export function applyBlockChanges(list, changes) {
  const publicKeys = new Set(list.publicKeys);
  const privateKeys = new Set(list.privateKeys);
  for (const { op, pubkey } of changes) {
    if (op === 'block') {
      if (!publicKeys.has(pubkey)) privateKeys.add(pubkey);
    } else {
      publicKeys.delete(pubkey);
      privateKeys.delete(pubkey);
    }
  }
  return { ...list, publicKeys: [...publicKeys], privateKeys: [...privateKeys] };
}

/** Every pubkey `list` blocks. */
export const blockedKeysOf = (list) => [...new Set([...list.publicKeys, ...list.privateKeys])];

/**
 * The kind 10000 template for `list`. The private part is encrypted even when
 * empty, so "no private entries" stays distinguishable from an app that
 * dropped them.
 */
export async function buildMuteListTemplate(list, { me, signer, createdAt }) {
  const privateTags = [...list.otherPrivateTags, ...list.privateKeys.map((key) => ['p', key])];
  return {
    kind: KIND.MUTE_LIST,
    created_at: createdAt,
    tags: [...list.otherPublicTags, ...list.publicKeys.map((key) => ['p', key])],
    content: await signer.nip44Encrypt(me, JSON.stringify(privateTags)),
  };
}

/**
 * Keep the device's blocked keys and the published list in step.
 *
 * `sync()` reads the newest list, publishes the block changes made here that
 * are not saved yet (unless the list cannot be read safely), and hands the
 * result to the store. A sync asked for while one runs makes it run once more.
 * Never rejects: whatever fails is tried again on the next sync.
 *
 * @param {object} deps
 * @param {string} deps.me
 * @param {object} deps.signer The chat signer: nip44Encrypt, nip44Decrypt, signEvent.
 * @param {object} deps.store `pendingBlockChanges()`, `settleBlockChanges(changes)`, `adoptBlockList(keys, { complete })`.
 * @param {() => Promise<{ best: object | null, anyAnswered: boolean }>} deps.fetchLatest
 * @param {(event: object) => Promise<boolean>} deps.publish True when a relay accepted it.
 * @param {() => number} [deps.now] Milliseconds.
 */
export function createMuteListSync({ me, signer, store, fetchLatest, publish, now = Date.now }) {
  let running = null;
  let again = false;

  async function run() {
    const { best, anyAnswered } = await fetchLatest();
    if (!best && !anyAnswered) return;
    const remote = await readMuteList(best, { me, signer });
    const changes = store.pendingBlockChanges();
    let list = remote;
    if (changes.length > 0 && remote.readable) {
      const next = applyBlockChanges(remote, changes);
      const createdAt = Math.max(Math.floor(now() / 1000), remote.createdAt + 1);
      const event = await signer.signEvent(await buildMuteListTemplate(next, { me, signer, createdAt }));
      if (await publish(event)) {
        store.settleBlockChanges(changes);
        list = next;
      }
    }
    store.adoptBlockList(blockedKeysOf(list), { complete: list.readable });
  }

  async function loop() {
    try {
      do {
        again = false;
        await run().catch(() => {});
      } while (again);
    } finally {
      running = null;
    }
  }

  /** Resolves once the run in progress and any asked for meanwhile are done. */
  function sync() {
    if (running) again = true;
    else running = loop();
    return running;
  }

  return { sync };
}
