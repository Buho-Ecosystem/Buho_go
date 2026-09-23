import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent, nip19 } from 'nostr-core';
import { searchProfiles, fetchPeopleProfile, classifyPeopleInput, profileMatchScore, PROFILE_SEARCH_RELAYS } from '../profileSearch.js';

const key = n => new Uint8Array(32).fill(n);
const event = (name, timestamp = 10, author = 1, extra = {}) => finalizeEvent({
  kind: 0, created_at: timestamp, tags: [], content: JSON.stringify({ name, ...extra }),
}, key(author));

function fakePool(handlers) {
  const requests = [], closed = [];
  return { requests, closed,
    async ensureRelay(url) {
      if (handlers[url] === 'fail') throw new Error('unavailable');
      return { subscribe(filters, callbacks) {
        requests.push({ url, filters });
        const sub = { close() { closed.push(url); } };
        queueMicrotask(() => handlers[url]?.(callbacks));
        return sub;
      } };
    },
  };
}

test('classifies public identifiers, short names and secrets before network access', async () => {
  const pub = event('Alice').pubkey;
  for (const value of [pub, nip19.npubEncode(pub), `nostr:${nip19.nprofileEncode({ pubkey: pub })}`, 'alice@example.com']) {
    assert.equal(classifyPeopleInput(value), 'identifier');
  }
  for (const value of ['nsec1abc', 'nostr:NSEC1abc', 'https://example.com/nsec1abc', 'ｎｓｅｃ１abc']) {
    assert.equal(classifyPeopleInput(value), 'private');
  }
  assert.equal(classifyPeopleInput('a'), 'short');
  assert.equal(classifyPeopleInput('npub1'), 'incomplete');
  assert.equal(classifyPeopleInput('alice@'), 'incomplete');
  assert.equal(classifyPeopleInput('Ａlice'), 'name');
  const pool = fakePool({});
  for (const value of ['a', 'nsec1secret', pub, 'alice@example.com']) await searchProfiles(value, { pool });
  assert.equal(pool.requests.length, 0);
});

test('local name matching normalizes Unicode and requires every query word', () => {
  assert.equal(profileMatchScore({ name: 'ＡLICE' }, 'alice'), 2);
  assert.equal(profileMatchScore({ display_name: 'Alice Smith' }, 'alice'), 1);
  assert.equal(profileMatchScore({ name: 'Alice', nip05: 'smith@example.com' }, 'alice smith'), 0);
  assert.equal(profileMatchScore({ name: 'Bob', about: 'alice' }, 'alice'), -1);
  assert.equal(profileMatchScore({ name: {}, display_name: 2 }, 'alice'), -1);
});

test('fans out to default relays, verifies signatures, streams and ranks results', async () => {
  const exact = event('Alice', 10), prefix = event('Alice Smith', 30, 2), contains = event('The Alice', 40, 3);
  const pool = fakePool({
    [PROFILE_SEARCH_RELAYS[0]]: c => { c.onevent(prefix); c.onevent({ ...JSON.parse(JSON.stringify(exact)), content: '{"name":"forged"}' }); c.oneose(); },
    [PROFILE_SEARCH_RELAYS[1]]: c => { c.onevent(contains); c.onevent(exact); c.onevent(event('Bob', 10, 4)); c.oneose(); },
  });
  const snapshots = [];
  const result = await searchProfiles('alice', { pool, onResults: profiles => snapshots.push(profiles) });
  assert.deepEqual(result.profiles.map(p => p.pubkey), [exact.pubkey, prefix.pubkey, contains.pubkey]);
  assert.equal(result.complete, true);
  assert.equal(result.partial, false);
  assert.ok(snapshots.length >= 3);
  assert.equal(pool.closed.length, 2);
  assert.deepEqual(pool.requests.map(r => r.url), PROFILE_SEARCH_RELAYS);
  assert.deepEqual(pool.requests[0].filters, [{ kinds: [0], search: 'alice', limit: 20 }]);
});

test('newest revision wins including non-matches; equal dates use lowest event id', async () => {
  const a = event('Alice', 20), b = event('Alice B', 20);
  const winner = [a, b].sort((a, b) => a.id.localeCompare(b.id))[0];
  let pool = fakePool({ relay: c => { c.onevent(b); c.onevent(a); c.onevent(event('Alice older', 10)); c.oneose(); } });
  let result = await searchProfiles('alice', { pool, relays: ['relay'] });
  assert.equal(result.profiles[0].event.id, winner.id);
  pool = fakePool({ relay: c => { c.onevent(a); c.onevent(event('Renamed', 30)); c.onevent(b); c.oneose(); } });
  result = await searchProfiles('alice', { pool, relays: ['relay'] });
  assert.equal(result.profiles.length, 0);
});

test('distinguishes empty completion, rejected connections, CLOSED and timeout; retains partial results', async () => {
  for (const handler of ['fail', c => c.onclose('rate limited'), () => {}]) {
    const pool = fakePool({ relay: handler });
    const result = await searchProfiles('alice', { pool, relays: ['relay'], timeoutMs: 15 });
    assert.equal(result.complete, false);
    assert.equal(result.partial, true);
  }
  const pool = fakePool({ a: c => { c.onevent(event('Alice')); c.oneose(); }, b: 'fail' });
  const result = await searchProfiles('alice', { pool, relays: ['a', 'b'] });
  assert.equal(result.profiles.length, 1);
  assert.equal(result.partial, true);
  assert.equal(result.complete, true);
  const empty = await searchProfiles('alice', { pool: fakePool({ a: c => c.oneose() }), relays: ['a'] });
  assert.equal(empty.complete, true);
  assert.deepEqual(empty.profiles, []);
});

test('abort closes subscriptions, suppresses late events, and does not subscribe after a slow connection', async () => {
  const controller = new AbortController();
  let callbacks;
  const pool = fakePool({ relay: c => { callbacks = c; controller.abort(); } });
  let updates = 0;
  await searchProfiles('alice', { pool, relays: ['relay'], signal: controller.signal, onResults: () => updates++ });
  callbacks.onevent(event('Alice'));
  assert.equal(updates, 0);
  assert.deepEqual(pool.closed, ['relay']);
  let connect, subscribed = false;
  const slowPool = { ensureRelay: () => new Promise(resolve => { connect = resolve; }) };
  await searchProfiles('alice', { pool: slowPool, relays: ['relay'], timeoutMs: 10 });
  connect({ subscribe() { subscribed = true; } });
  await Promise.resolve();
  assert.equal(subscribed, false);
});

test('direct lookup uses authors, rejects unrelated profiles and supports cancellation', async () => {
  const alice = event('Alice');
  const pool = fakePool({ relay: c => { c.onevent(event('Bob', 30, 2)); c.onevent(alice); c.oneose(); } });
  const result = await fetchPeopleProfile(alice.pubkey, { pool, relays: ['relay'] });
  assert.equal(result.event.id, alice.id);
  assert.deepEqual(pool.requests[0].filters, [{ kinds: [0], authors: [alice.pubkey] }]);
});

test('grows relevance windows without timestamp cursors, merges revisions, and stops at exhaustion', async () => {
  const events = Array.from({ length: 45 }, (_, index) => event(`Alice ${index}`, 10, index + 1));
  const pool = fakePool({ relay: c => {
    const limit = pool.requests.at(-1).filters[0].limit;
    events.slice(0, limit).forEach(c.onevent);
    c.oneose();
  } });
  let previousEvents = [];
  for (const [limit, count, hasMore] of [[20, 20, true], [40, 40, true], [60, 45, false]]) {
    const result = await searchProfiles('alice', { pool, relays: ['relay'], limit, previousEvents });
    assert.equal(result.profiles.length, count);
    assert.equal(new Set(result.profiles.map(person => person.pubkey)).size, count);
    assert.equal(result.hasMore, hasMore);
    assert.equal(pool.requests.at(-1).filters[0].until, undefined);
    previousEvents = result.events;
  }
});
