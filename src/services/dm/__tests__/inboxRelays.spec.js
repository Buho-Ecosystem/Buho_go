/**
 * Inbox relay list tests.
 *
 * The list builder and parser sit between us and third-party relay data, and
 * the resolver decides whether a message may be sent at all ("missing" means
 * do not send, "unknown" means try again), so the cases are table-driven and
 * include hostile input. The resolver runs against fake relays and manual
 * timers: no network, no real waiting.
 *
 * Run directly with Node:
 *   node --test src/services/dm/__tests__/inboxRelays.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-core';
import { DM_DISCOVERY_RELAYS, MAX_INBOX_RELAYS_PER_CONTACT } from '../constants.js';
import { DmError } from '../errors.js';
import {
  INBOX_RELAY_MISSING_TTL_MS,
  buildInboxRelayListTemplate,
  createInboxRelayResolver,
  isPublicRelayHost,
  normalizeInboxRelayUrl,
  parseInboxRelayList,
} from '../inboxRelays.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

const sk = generateSecretKey();
const PUBKEY = getPublicKey(sk);
const otherSk = generateSecretKey();
const OTHER_PUBKEY = getPublicKey(otherSk);

/** A correctly signed kind 10050 event. */
function listEvent(relays, { secretKey = sk, created_at = 1_000, kind = 10050, tags } = {}) {
  return finalizeEvent(
    { kind, created_at, content: '', tags: tags ?? relays.map((url) => ['relay', url]) },
    secretKey,
  );
}

// ---------------------------------------------------------------------------
// normalizeInboxRelayUrl
// ---------------------------------------------------------------------------

const URL_CASES = [
  ['wss://relay.example.com', 'wss://relay.example.com/'],
  ['  wss://relay.example.com  ', 'wss://relay.example.com/'],
  ['WSS://Relay.Example.COM', 'wss://relay.example.com/'],
  ['wss://relay.example.com:443', 'wss://relay.example.com/'],
  ['wss://relay.example.com/path/', 'wss://relay.example.com/path'],
  ['wss://relay.example.com:8443', 'wss://relay.example.com:8443/'],
  ['ws://relay.example.com', null],
  ['https://relay.example.com', null],
  ['relay.example.com', null],
  ['wss://', null],
  ['wss://user:pw@relay.example.com', null],
  ['wss://' + 'a'.repeat(300) + '.com', null],
  ['', null],
  ['   ', null],
  [null, null],
  [undefined, null],
  [42, null],
  [{}, null],
  [['wss://a.com'], null],
  ['javascript:alert(1)', null],
];

for (const [input, expected] of URL_CASES) {
  test(`normalizeInboxRelayUrl(${JSON.stringify(input)}) -> ${JSON.stringify(expected)}`, () => {
    assert.equal(normalizeInboxRelayUrl(input), expected);
  });
}

// ---------------------------------------------------------------------------
// Host blocklist (SSRF-style probing through a hostile list)
// ---------------------------------------------------------------------------

const BLOCKED_HOSTS = [
  'localhost', 'LOCALHOST', 'localhost.', 'localhost..', 'foo.localhost', 'a.b.LOCALHOST.',
  'printer.local', 'Nas.LOCAL.', 'db.internal', 'x.y.internal',
  'abcdefghij234567.onion', 'intranet', 'router',
  '0.0.0.0', '0.255.255.255', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255',
  '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255',
  '192.168.1.1', '198.18.0.1', '198.19.255.255', '224.0.0.1', '239.255.255.255',
  '240.0.0.1', '255.255.255.255',
  // Spellings the WHATWG parser turns into dotted IPv4.
  '2130706433', '0x7f000001', '0x7f.1', '017700000001', '0177.0.0.1', '127.1', '3232235777',
  '[::]', '[::1]', '[0:0:0:0:0:0:0:1]', '[fc00::1]', '[fd12:3456::1]', '[fe80::1]', '[FE80::1]',
  '[febf::1]', '[::ffff:127.0.0.1]', '[::ffff:10.1.2.3]', '[::ffff:c0a8:0101]',
  '[::ffff:a9fe:a9fe]', '[::127.0.0.1]', '[64:ff9b::7f00:1]',
];

const PUBLIC_HOSTS = [
  'relay.example.com', 'Relay.Example.COM', 'a.b.c.example.org', 'relay.damus.io',
  '1.1.1.1', '8.8.8.8', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1',
  '198.17.255.255', '198.20.0.1', '223.255.255.255', '169.253.0.1', '11.0.0.1',
  '[2606:4700::1111]', '[2001:db8::1]', '[::ffff:8.8.8.8]', '[fec0::1]', '[fbff::1]',
  'localhost.example.com', 'notlocal.com', 'my-internal.example.com', 'onion.example.com',
];

for (const host of BLOCKED_HOSTS) {
  test(`the host ${host} is blocked for relays`, () => {
    assert.equal(normalizeInboxRelayUrl(`wss://${host}`), null);
    assert.equal(normalizeInboxRelayUrl(`wss://${host}:8443/path`), null);
    assert.deepEqual(parseInboxRelayList({ kind: 10050, tags: [['relay', `wss://${host}`]] }), []);
    assert.throws(
      () => buildInboxRelayListTemplate([`wss://${host}`], { now: 1 }),
      (err) => DmError.is(err, 'INVALID_ARGUMENT'),
    );
  });
}

for (const host of PUBLIC_HOSTS) {
  test(`the host ${host} is allowed for relays`, () => {
    assert.notEqual(normalizeInboxRelayUrl(`wss://${host}`), null);
  });
}

test('isPublicRelayHost treats non-strings and empty hosts as not public', () => {
  for (const bad of [undefined, null, 5, {}, '', '.', '[]', '[::1::2]', '[zz::1]']) {
    assert.equal(isPublicRelayHost(bad), false);
  }
});

test('blocked hosts are skipped among good ones in a list, and never queried as hints', async () => {
  const tags = [['relay', 'wss://localhost'], ['relay', 'wss://192.168.0.1'], ['relay', 'wss://ok.example.com']];
  assert.deepEqual(parseInboxRelayList({ kind: 10050, tags }), ['wss://ok.example.com/']);
  const { resolver, net } = createHarness({ discoveryRelays: [] });
  await resolver.resolve(PUBKEY, { hints: ['wss://localhost', 'wss://[::1]', 'wss://10.0.0.5', 'wss://ok.example.com'] });
  assert.deepEqual(net.calls.map((c) => c.url), ['wss://ok.example.com/']);
});

test('a hostile list on a relay cannot make the resolver return a LAN relay', async () => {
  const event = listEvent(['wss://127.0.0.1', 'wss://router.local']);
  const { resolver } = createHarness({ behaviours: { [D1]: { events: [event] } } });
  assert.equal((await resolver.resolve(PUBKEY)).status, 'missing');
});

test('hydrate drops blocked hosts from a stored snapshot', () => {
  const { resolver, clock } = createHarness();
  const entry = (relays) => ({ status: 'found', relays, checkedAt: clock.t });
  const other = 'b'.repeat(64);
  resolver.hydrate({
    version: 1,
    entries: { [PUBKEY]: entry(['wss://localhost', 'wss://ok.example.com']), [other]: entry(['wss://10.0.0.1']) },
  });
  assert.deepEqual(resolver.peek(PUBKEY).relays, ['wss://ok.example.com/']);
  assert.equal(resolver.peek(other), null);
});

// ---------------------------------------------------------------------------
// buildInboxRelayListTemplate
// ---------------------------------------------------------------------------

test('buildInboxRelayListTemplate builds an unsigned kind 10050 with relay tags', () => {
  const template = buildInboxRelayListTemplate(['wss://a.example.com', 'wss://b.example.com'], {
    now: 1_700_000_000,
  });
  assert.deepEqual(template, {
    kind: 10050,
    created_at: 1_700_000_000,
    tags: [
      ['relay', 'wss://a.example.com/'],
      ['relay', 'wss://b.example.com/'],
    ],
    content: '',
  });
});

test('buildInboxRelayListTemplate merges duplicates after normalising', () => {
  const template = buildInboxRelayListTemplate(['wss://A.example.com', 'wss://a.example.com/'], { now: 1 });
  assert.deepEqual(template.tags, [['relay', 'wss://a.example.com/']]);
});

test('buildInboxRelayListTemplate defaults created_at to the current time in seconds', () => {
  const before = Math.floor(Date.now() / 1000);
  const { created_at: createdAt } = buildInboxRelayListTemplate(['wss://a.example.com']);
  assert.ok(createdAt >= before && createdAt <= before + 5);
});

test('buildInboxRelayListTemplate output signs and parses back', () => {
  const urls = ['wss://a.example.com/', 'wss://b.example.com/'];
  const event = finalizeEvent(buildInboxRelayListTemplate(urls, { now: 5 }), sk);
  assert.deepEqual(parseInboxRelayList(event), urls);
});

const BAD_TEMPLATE_INPUT = [
  ['not an array', 'wss://a.example.com'],
  ['null', null],
  ['an empty list', []],
  ['a ws:// relay', ['wss://a.example.com', 'ws://b.example.com']],
  ['a non-string entry', ['wss://a.example.com', 7]],
  ['too many relays', Array.from({ length: MAX_INBOX_RELAYS_PER_CONTACT + 1 }, (_, i) => `wss://r${i}.example.com`)],
];

for (const [name, input] of BAD_TEMPLATE_INPUT) {
  test(`buildInboxRelayListTemplate rejects ${name}`, () => {
    assert.throws(
      () => buildInboxRelayListTemplate(input, { now: 1 }),
      (err) => DmError.is(err, 'INVALID_ARGUMENT'),
    );
  });
}

for (const now of [-1, 1.5, NaN, '1', Infinity]) {
  test(`buildInboxRelayListTemplate rejects now = ${String(now)}`, () => {
    assert.throws(
      () => buildInboxRelayListTemplate(['wss://a.example.com'], { now }),
      (err) => DmError.is(err, 'INVALID_ARGUMENT'),
    );
  });
}

// ---------------------------------------------------------------------------
// parseInboxRelayList
// ---------------------------------------------------------------------------

test('parseInboxRelayList reads, normalises and dedupes relay tags', () => {
  const event = listEvent([], {
    tags: [
      ['relay', 'wss://A.example.com'],
      ['relay', 'wss://a.example.com/'],
      ['relay', 'wss://b.example.com'],
    ],
  });
  assert.deepEqual(parseInboxRelayList(event), ['wss://a.example.com/', 'wss://b.example.com/']);
});

test('parseInboxRelayList skips invalid URLs and other tags', () => {
  const event = {
    kind: 10050,
    tags: [
      ['relay', 'ws://insecure.example.com'],
      ['relay', 'garbage'],
      ['relay'],
      ['relay', 5],
      ['r', 'wss://wrong-tag.example.com'],
      'relay',
      null,
      [],
      ['relay', 'wss://ok.example.com'],
    ],
  };
  assert.deepEqual(parseInboxRelayList(event), ['wss://ok.example.com/']);
});

test('parseInboxRelayList caps the result and keeps the first relays', () => {
  const urls = Array.from({ length: MAX_INBOX_RELAYS_PER_CONTACT + 4 }, (_, i) => `wss://r${i}.example.com`);
  const result = parseInboxRelayList({ kind: 10050, tags: urls.map((u) => ['relay', u]) });
  assert.equal(result.length, MAX_INBOX_RELAYS_PER_CONTACT);
  assert.equal(result[0], 'wss://r0.example.com/');
});

test('parseInboxRelayList counts the cap after dropping invalid and duplicate entries', () => {
  const tags = [
    ['relay', 'garbage'],
    ['relay', 'wss://a.example.com'],
    ['relay', 'wss://a.example.com'],
    ...Array.from({ length: MAX_INBOX_RELAYS_PER_CONTACT }, (_, i) => ['relay', `wss://r${i}.example.com`]),
  ];
  const result = parseInboxRelayList({ kind: 10050, tags });
  assert.equal(result.length, MAX_INBOX_RELAYS_PER_CONTACT);
  assert.equal(result[0], 'wss://a.example.com/');
});

const NOT_A_LIST = [
  ['null', null],
  ['undefined', undefined],
  ['a string', 'event'],
  ['a number', 10050],
  ['an array', []],
  ['wrong kind', { kind: 10002, tags: [['relay', 'wss://a.example.com']] }],
  ['kind as string', { kind: '10050', tags: [['relay', 'wss://a.example.com']] }],
  ['missing tags', { kind: 10050 }],
  ['tags not an array', { kind: 10050, tags: 'relay' }],
  ['tags an object', { kind: 10050, tags: { 0: ['relay', 'wss://a.example.com'] } }],
];

for (const [name, input] of NOT_A_LIST) {
  test(`parseInboxRelayList returns [] for ${name}`, () => {
    assert.deepEqual(parseInboxRelayList(input), []);
  });
}

test('parseInboxRelayList never throws on a hostile event', () => {
  const hostile = new Proxy({}, { get() { throw new Error('boom'); } });
  assert.deepEqual(parseInboxRelayList(hostile), []);
  const throwingTags = {
    kind: 10050,
    get tags() { throw new Error('boom'); },
  };
  assert.deepEqual(parseInboxRelayList(throwingTags), []);
});

// ---------------------------------------------------------------------------
// Resolver test harness
// ---------------------------------------------------------------------------

/** Manual timers: nothing fires until `fire()`. */
function createTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimer: (fn, ms) => {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimer: (id) => { pending.delete(id); },
    fire: () => {
      for (const [id, { fn }] of [...pending]) {
        pending.delete(id);
        fn();
      }
    },
    get pending() { return pending.size; },
  };
}

/**
 * Fake relays. `behaviours` maps a URL to what that relay does:
 *   { events: [], eose: true }  sends events then EOSE (default)
 *   { closed: 'auth-required: x' }  answers the REQ with CLOSED
 *   { connectFail: true }  ensureRelay rejects
 *   { never: true }  accepts the REQ and never answers
 *   { sync: true }  answers inside subscribe(), before it returns
 *   { throwOnSubscribe: true }
 */
function createFakeNetwork(behaviours = {}) {
  const calls = [];
  const subs = [];
  const ensureRelay = async (url, opts) => {
    calls.push({ url, opts });
    const behaviour = behaviours[url] ?? { events: [] };
    if (behaviour.connectFail) throw new Error('connection failed');
    if (behaviour.slowConnect) await behaviour.slowConnect;
    return {
      subscribe(filters, params) {
        if (behaviour.throwOnSubscribe) throw new Error('not connected');
        const sub = { url, filters, closed: false, close() { this.closed = true; } };
        subs.push(sub);
        const play = () => {
          if (sub.closed) return;
          for (const event of behaviour.events ?? []) params.onevent(event);
          if (behaviour.closed) params.onclose(behaviour.closed);
          else if (!behaviour.never && behaviour.eose !== false) params.oneose();
        };
        if (behaviour.sync) play();
        else queueMicrotask(play);
        return sub;
      },
    };
  };
  return { ensureRelay, calls, subs, behaviours };
}

function createHarness({ behaviours = {}, discoveryRelays = ['wss://d1.example.com/', 'wss://d2.example.com/'], ...options } = {}) {
  const net = createFakeNetwork(behaviours);
  const timers = createTimers();
  const clock = { t: 1_000_000 };
  const resolver = createInboxRelayResolver({
    ensureRelay: net.ensureRelay,
    discoveryRelays,
    timeoutMs: 100,
    now: () => clock.t,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    ...options,
  });
  return { resolver, net, timers, clock };
}

const D1 = 'wss://d1.example.com/';
const D2 = 'wss://d2.example.com/';

// ---------------------------------------------------------------------------
// Resolver: statuses
// ---------------------------------------------------------------------------

test('resolve returns found with the relays of a valid list', async () => {
  const event = listEvent(['wss://inbox.example.com']);
  const { resolver, clock } = createHarness({ behaviours: { [D1]: { events: [event] } } });
  const result = await resolver.resolve(PUBKEY);
  assert.deepEqual(result, { status: 'found', relays: ['wss://inbox.example.com/'], checkedAt: clock.t });
});

test('resolve returns missing when relays answered and none has a list', async () => {
  const { resolver, clock } = createHarness();
  assert.deepEqual(await resolver.resolve(PUBKEY), { status: 'missing', relays: [], checkedAt: clock.t });
});

test('resolve returns missing when one relay answered although the others failed', async () => {
  const { resolver } = createHarness({
    behaviours: { [D1]: { connectFail: true }, [D2]: { events: [] } },
  });
  assert.equal((await resolver.resolve(PUBKEY)).status, 'missing');
});

test('resolve returns unknown when every relay fails, refuses or stays silent', async () => {
  const { resolver, timers } = createHarness({
    behaviours: {
      [D1]: { connectFail: true },
      [D2]: { never: true },
      'wss://hint.example.com/': { closed: 'auth-required: sign in' },
    },
  });
  const pending = resolver.resolve(PUBKEY, { hints: ['wss://hint.example.com'] });
  await flush();
  timers.fire();
  assert.deepEqual(await pending, { status: 'unknown', relays: [], checkedAt: 1_000_000 });
});

test('a CLOSED reply does not count as an answer', async () => {
  const { resolver } = createHarness({
    behaviours: { [D1]: { closed: 'auth-required: x' }, [D2]: { closed: 'blocked: x' } },
  });
  assert.equal((await resolver.resolve(PUBKEY)).status, 'unknown');
});

test('a silent relay times out and the others still decide the result', async () => {
  const event = listEvent(['wss://inbox.example.com']);
  const { resolver, timers } = createHarness({
    behaviours: { [D1]: { never: true }, [D2]: { events: [event] } },
  });
  const pending = resolver.resolve(PUBKEY);
  await flush();
  timers.fire();
  assert.equal((await pending).status, 'found');
});

test('a relay that never connects times out', async () => {
  const hang = new Promise(() => {});
  const { resolver, timers, net } = createHarness({
    behaviours: { [D1]: { slowConnect: hang }, [D2]: { events: [] } },
  });
  const pending = resolver.resolve(PUBKEY);
  await flush();
  timers.fire();
  assert.equal((await pending).status, 'missing');
  assert.equal(net.subs.filter((s) => s.url === D1).length, 0);
});

test('a relay that connects after its timeout is not subscribed to', async () => {
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  const { resolver, timers, net } = createHarness({
    behaviours: { [D1]: { slowConnect: slow }, [D2]: { events: [] } },
  });
  const pending = resolver.resolve(PUBKEY);
  await flush();
  timers.fire();
  await pending;
  release();
  await flush();
  assert.equal(net.subs.filter((s) => s.url === D1).length, 0);
});

test('an event received before CLOSED still counts', async () => {
  const event = listEvent(['wss://inbox.example.com']);
  const { resolver } = createHarness({
    behaviours: { [D1]: { events: [event], closed: 'error: bye' }, [D2]: { connectFail: true } },
  });
  assert.equal((await resolver.resolve(PUBKEY)).status, 'found');
});

test('an event without EOSE counts when the relay later times out', async () => {
  const event = listEvent(['wss://inbox.example.com']);
  const { resolver, timers } = createHarness({
    behaviours: { [D1]: { events: [event], eose: false }, [D2]: { connectFail: true } },
  });
  const pending = resolver.resolve(PUBKEY);
  await flush();
  timers.fire();
  assert.equal((await pending).status, 'found');
});

test('a relay answering inside subscribe() is handled and closed', async () => {
  const event = listEvent(['wss://inbox.example.com']);
  const { resolver, net } = createHarness({
    behaviours: { [D1]: { events: [event], sync: true }, [D2]: { sync: true } },
  });
  assert.equal((await resolver.resolve(PUBKEY)).status, 'found');
  assert.ok(net.subs.length === 2 && net.subs.every((s) => s.closed));
});

test('a throwing subscribe counts as no answer', async () => {
  const { resolver } = createHarness({
    behaviours: { [D1]: { throwOnSubscribe: true }, [D2]: { throwOnSubscribe: true } },
  });
  assert.equal((await resolver.resolve(PUBKEY)).status, 'unknown');
});

test('an ensureRelay that throws synchronously counts as no answer', async () => {
  const timers = createTimers();
  const resolver = createInboxRelayResolver({
    ensureRelay: () => { throw new Error('sync failure'); },
    discoveryRelays: [D1],
    now: () => 1,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  assert.equal((await resolver.resolve(PUBKEY)).status, 'unknown');
});

test('a list with no usable relay is missing, even when a relay holds the event', async () => {
  const event = listEvent([], { tags: [['relay', 'ws://insecure.example.com']] });
  const { resolver } = createHarness({ behaviours: { [D1]: { events: [event] } } });
  const result = await resolver.resolve(PUBKEY);
  assert.deepEqual([result.status, result.relays], ['missing', []]);
});

// ---------------------------------------------------------------------------
// Resolver: which events are accepted
// ---------------------------------------------------------------------------

test('the newest list wins across relays', async () => {
  const older = listEvent(['wss://old.example.com'], { created_at: 100 });
  const newer = listEvent(['wss://new.example.com'], { created_at: 200 });
  const { resolver } = createHarness({
    behaviours: { [D1]: { events: [newer] }, [D2]: { events: [older] } },
  });
  assert.deepEqual((await resolver.resolve(PUBKEY)).relays, ['wss://new.example.com/']);
});

test('the newest list wins within one relay regardless of arrival order', async () => {
  const older = listEvent(['wss://old.example.com'], { created_at: 100 });
  const newer = listEvent(['wss://new.example.com'], { created_at: 200 });
  const { resolver } = createHarness({ behaviours: { [D1]: { events: [newer, older] } } });
  assert.deepEqual((await resolver.resolve(PUBKEY)).relays, ['wss://new.example.com/']);
});

test('on equal timestamps the lowest id wins, whichever relay reports it', async () => {
  const a = listEvent(['wss://a.example.com'], { created_at: 100 });
  const b = listEvent(['wss://b.example.com'], { created_at: 100 });
  const [low, high] = a.id < b.id ? [a, b] : [b, a];
  for (const order of [[low, high], [high, low]]) {
    const { resolver } = createHarness({
      behaviours: { [D1]: { events: [order[0]] }, [D2]: { events: [order[1]] } },
    });
    assert.deepEqual((await resolver.resolve(PUBKEY)).relays, parseInboxRelayList(low));
  }
});

test('the newest list wins even when it is empty (the user cleared it)', async () => {
  const older = listEvent(['wss://old.example.com'], { created_at: 100 });
  const cleared = listEvent([], { created_at: 200 });
  const { resolver } = createHarness({
    behaviours: { [D1]: { events: [older] }, [D2]: { events: [cleared] } },
  });
  assert.equal((await resolver.resolve(PUBKEY)).status, 'missing');
});

test('an event by another author is ignored', async () => {
  const forged = listEvent(['wss://evil.example.com'], { secretKey: otherSk });
  assert.notEqual(forged.pubkey, PUBKEY);
  const { resolver } = createHarness({ behaviours: { [D1]: { events: [forged] } } });
  assert.equal((await resolver.resolve(PUBKEY)).status, 'missing');
});

test('an event of the wrong kind is ignored', async () => {
  const wrongKind = listEvent(['wss://evil.example.com'], { kind: 10002 });
  const { resolver } = createHarness({ behaviours: { [D1]: { events: [wrongKind] } } });
  assert.equal((await resolver.resolve(PUBKEY)).status, 'missing');
});

test('an event with a bad signature or tampered content is ignored', async () => {
  const genuine = listEvent(['wss://good.example.com'], { created_at: 100 });
  const tampered = { ...listEvent(['wss://good.example.com'], { created_at: 300 }), tags: [['relay', 'wss://evil.example.com']] };
  const badSig = { ...listEvent(['wss://evil2.example.com'], { created_at: 400 }), sig: '0'.repeat(128) };
  const { resolver } = createHarness({
    behaviours: { [D1]: { events: [tampered, badSig, genuine] } },
  });
  assert.deepEqual((await resolver.resolve(PUBKEY)).relays, ['wss://good.example.com/']);
});

const JUNK_EVENTS = [null, undefined, 'event', 42, [], {}, { kind: 10050 }, { kind: 10050, pubkey: PUBKEY }];

for (const junk of JUNK_EVENTS) {
  test(`junk event ${JSON.stringify(junk)} from a relay is ignored`, async () => {
    const { resolver } = createHarness({ behaviours: { [D1]: { events: [junk] } } });
    assert.equal((await resolver.resolve(PUBKEY)).status, 'missing');
  });
}

test('a list is capped at MAX_INBOX_RELAYS_PER_CONTACT relays', async () => {
  const urls = Array.from({ length: 12 }, (_, i) => `wss://r${i}.example.com`);
  const { resolver } = createHarness({ behaviours: { [D1]: { events: [listEvent(urls)] } } });
  assert.equal((await resolver.resolve(PUBKEY)).relays.length, MAX_INBOX_RELAYS_PER_CONTACT);
});

// ---------------------------------------------------------------------------
// Resolver: querying
// ---------------------------------------------------------------------------

test('the query asks for the contact\'s kind 10050 on discovery relays and valid hints', async () => {
  const { resolver, net } = createHarness();
  await resolver.resolve(PUBKEY, {
    hints: ['wss://hint.example.com', 'ws://insecure.example.com', 'junk', 42, D1],
  });
  assert.deepEqual(
    net.calls.map((c) => c.url).sort(),
    [D1, D2, 'wss://hint.example.com/'].sort(),
  );
  for (const call of net.calls) assert.deepEqual(call.opts, { connectionTimeout: 100 });
  for (const sub of net.subs) {
    assert.deepEqual(sub.filters, [{ kinds: [10050], authors: [PUBKEY], limit: 1 }]);
  }
});

test('hints are capped', async () => {
  const hints = Array.from({ length: 50 }, (_, i) => `wss://h${i}.example.com`);
  const { resolver, net } = createHarness({ discoveryRelays: [] });
  await resolver.resolve(PUBKEY, { hints });
  assert.equal(net.calls.length, MAX_INBOX_RELAYS_PER_CONTACT);
});

test('a hostile hints value is ignored', async () => {
  const { resolver, net } = createHarness();
  await resolver.resolve(PUBKEY, { hints: 'wss://hint.example.com' });
  assert.equal(net.calls.length, 2);
});

test('relays are queried in parallel, not one after the other', async () => {
  const { resolver, net, timers } = createHarness({
    behaviours: { [D1]: { never: true }, [D2]: { never: true } },
  });
  const pending = resolver.resolve(PUBKEY);
  await flush();
  assert.equal(net.calls.length, 2);
  timers.fire();
  await pending;
});

test('every subscription is closed and every timer cleared', async () => {
  const event = listEvent(['wss://inbox.example.com']);
  const { resolver, net, timers } = createHarness({
    behaviours: {
      [D1]: { events: [event] },
      [D2]: { never: true },
      'wss://hint.example.com/': { closed: 'error: x' },
    },
  });
  const pending = resolver.resolve(PUBKEY, { hints: ['wss://hint.example.com'] });
  await flush();
  timers.fire();
  await pending;
  assert.equal(net.subs.length, 3);
  assert.ok(net.subs.every((s) => s.closed));
  assert.equal(timers.pending, 0);
});

test('the default discovery relays are DM_DISCOVERY_RELAYS', async () => {
  const net = createFakeNetwork();
  const resolver = createInboxRelayResolver({ ensureRelay: net.ensureRelay, now: () => 1 });
  await resolver.resolve(PUBKEY);
  assert.deepEqual(
    new Set(net.calls.map((c) => c.url)),
    new Set(DM_DISCOVERY_RELAYS.map((u) => normalizeInboxRelayUrl(u))),
  );
});

// ---------------------------------------------------------------------------
// Resolver: arguments
// ---------------------------------------------------------------------------

const BAD_PUBKEYS = [
  undefined,
  null,
  '',
  'abc',
  PUBKEY.toUpperCase(),
  PUBKEY + '0',
  PUBKEY.slice(1),
  'z'.repeat(64),
  ` ${PUBKEY}`,
  42,
  {},
  [PUBKEY],
];

for (const bad of BAD_PUBKEYS) {
  test(`resolve rejects the pubkey ${JSON.stringify(bad)}`, async () => {
    const { resolver, net } = createHarness();
    await assert.rejects(resolver.resolve(bad), (err) => DmError.is(err, 'INVALID_ARGUMENT'));
    assert.equal(net.calls.length, 0);
  });
}

test('createInboxRelayResolver requires ensureRelay', () => {
  assert.throws(() => createInboxRelayResolver(), (err) => DmError.is(err, 'INVALID_ARGUMENT'));
  assert.throws(
    () => createInboxRelayResolver({ ensureRelay: 'nope' }),
    (err) => DmError.is(err, 'INVALID_ARGUMENT'),
  );
});

// ---------------------------------------------------------------------------
// Resolver: caching
// ---------------------------------------------------------------------------

const FOUND_EVENT = () => listEvent(['wss://inbox.example.com']);

test('found is served from the cache until ttlMs has passed', async () => {
  const { resolver, net, clock } = createHarness({
    ttlMs: 1_000,
    behaviours: { [D1]: { events: [FOUND_EVENT()] } },
  });
  await resolver.resolve(PUBKEY);
  const calls = net.calls.length;
  clock.t += 999;
  assert.equal((await resolver.resolve(PUBKEY)).status, 'found');
  assert.equal(net.calls.length, calls);
  clock.t += 1;
  await resolver.resolve(PUBKEY);
  assert.ok(net.calls.length > calls);
});

test('missing is cached for the shorter missingTtlMs', async () => {
  const { resolver, net, clock } = createHarness({ ttlMs: 10_000_000, missingTtlMs: 500 });
  await resolver.resolve(PUBKEY);
  const calls = net.calls.length;
  clock.t += 499;
  await resolver.resolve(PUBKEY);
  assert.equal(net.calls.length, calls);
  clock.t += 1;
  await resolver.resolve(PUBKEY);
  assert.ok(net.calls.length > calls);
});

test('the default missing TTL is 30 minutes and shorter than the found TTL', async () => {
  assert.equal(INBOX_RELAY_MISSING_TTL_MS, 30 * 60 * 1000);
  const { resolver, net, clock } = createHarness();
  await resolver.resolve(PUBKEY);
  const calls = net.calls.length;
  clock.t += INBOX_RELAY_MISSING_TTL_MS - 1;
  await resolver.resolve(PUBKEY);
  assert.equal(net.calls.length, calls);
  clock.t += 1;
  await resolver.resolve(PUBKEY);
  assert.ok(net.calls.length > calls);
});

test('unknown is never cached', async () => {
  const { resolver, net } = createHarness({
    behaviours: { [D1]: { connectFail: true }, [D2]: { connectFail: true } },
  });
  await resolver.resolve(PUBKEY);
  assert.equal(resolver.peek(PUBKEY), null);
  await resolver.resolve(PUBKEY);
  assert.equal(net.calls.length, 4);
});

test('force bypasses the cache and replaces it', async () => {
  const { resolver, net, clock } = createHarness({ behaviours: { [D1]: { events: [FOUND_EVENT()] } } });
  await resolver.resolve(PUBKEY);
  clock.t += 10;
  net.behaviours[D1] = { events: [listEvent(['wss://newer.example.com'], { created_at: 5_000 })] };
  const forced = await resolver.resolve(PUBKEY, { force: true });
  assert.deepEqual(forced.relays, ['wss://newer.example.com/']);
  assert.deepEqual(resolver.peek(PUBKEY).relays, ['wss://newer.example.com/']);
});

test('a failed forced lookup does not erase a good cached answer', async () => {
  const { resolver, net } = createHarness({ behaviours: { [D1]: { events: [FOUND_EVENT()] } } });
  await resolver.resolve(PUBKEY);
  net.behaviours[D1] = { connectFail: true };
  net.behaviours[D2] = { connectFail: true };
  assert.equal((await resolver.resolve(PUBKEY, { force: true })).status, 'unknown');
  assert.equal(resolver.peek(PUBKEY).status, 'found');
});

test('returned results are copies: mutating them cannot corrupt the cache', async () => {
  const { resolver } = createHarness({ behaviours: { [D1]: { events: [FOUND_EVENT()] } } });
  const first = await resolver.resolve(PUBKEY);
  first.relays.push('wss://evil.example.com/');
  first.status = 'missing';
  assert.deepEqual(resolver.peek(PUBKEY).relays, ['wss://inbox.example.com/']);
  assert.equal((await resolver.resolve(PUBKEY)).status, 'found');
});

// ---------------------------------------------------------------------------
// Resolver: concurrency
// ---------------------------------------------------------------------------

test('concurrent resolves for one pubkey share a single query', async () => {
  const { resolver, net } = createHarness({ behaviours: { [D1]: { events: [FOUND_EVENT()] } } });
  const results = await Promise.all([resolver.resolve(PUBKEY), resolver.resolve(PUBKEY), resolver.resolve(PUBKEY)]);
  assert.equal(net.calls.length, 2);
  assert.ok(results.every((r) => r.status === 'found'));
  assert.notEqual(results[0], results[1]);
});

test('force during an in-flight lookup shares it', async () => {
  const { resolver, net } = createHarness();
  const [a, b] = await Promise.all([resolver.resolve(PUBKEY), resolver.resolve(PUBKEY, { force: true })]);
  assert.equal(net.calls.length, 2);
  assert.deepEqual(a, b);
});

test('different pubkeys are looked up separately', async () => {
  const { resolver, net } = createHarness();
  await Promise.all([resolver.resolve(PUBKEY), resolver.resolve(OTHER_PUBKEY)]);
  assert.equal(net.calls.length, 4);
});

test('a lookup after the previous one finished starts a new query (no stale in-flight)', async () => {
  const { resolver, net } = createHarness({
    behaviours: { [D1]: { connectFail: true }, [D2]: { connectFail: true } },
  });
  await resolver.resolve(PUBKEY);
  await resolver.resolve(PUBKEY);
  assert.equal(net.calls.length, 4);
});

// ---------------------------------------------------------------------------
// Resolver: peek / invalidate
// ---------------------------------------------------------------------------

test('peek returns the fresh cached answer and never queries', async () => {
  const { resolver, net, clock } = createHarness({
    ttlMs: 100,
    behaviours: { [D1]: { events: [FOUND_EVENT()] } },
  });
  assert.equal(resolver.peek(PUBKEY), null);
  await resolver.resolve(PUBKEY);
  const calls = net.calls.length;
  assert.equal(resolver.peek(PUBKEY).status, 'found');
  clock.t += 100;
  assert.equal(resolver.peek(PUBKEY), null);
  assert.equal(net.calls.length, calls);
});

test('peek tolerates non-string input', () => {
  const { resolver } = createHarness();
  for (const bad of [undefined, null, 5, {}]) assert.equal(resolver.peek(bad), null);
});

test('invalidate drops the cached answer', async () => {
  const { resolver } = createHarness({ behaviours: { [D1]: { events: [FOUND_EVENT()] } } });
  await resolver.resolve(PUBKEY);
  resolver.invalidate(PUBKEY);
  assert.equal(resolver.peek(PUBKEY), null);
});

test('invalidate during a lookup stops its result from being cached', async () => {
  const { resolver } = createHarness({ behaviours: { [D1]: { events: [FOUND_EVENT()] } } });
  const pending = resolver.resolve(PUBKEY);
  resolver.invalidate(PUBKEY);
  assert.equal((await pending).status, 'found');
  assert.equal(resolver.peek(PUBKEY), null);
});

test('invalidate of an unknown pubkey is harmless', () => {
  const { resolver } = createHarness();
  resolver.invalidate(PUBKEY);
  resolver.invalidate('junk');
  resolver.invalidate(undefined);
});

// ---------------------------------------------------------------------------
// Resolver: snapshot / hydrate
// ---------------------------------------------------------------------------

test('snapshot is plain JSON and hydrate restores it in a new resolver', async () => {
  const first = createHarness({ behaviours: { [D1]: { events: [FOUND_EVENT()] } } });
  await first.resolver.resolve(PUBKEY);
  await first.resolver.resolve(OTHER_PUBKEY);
  const stored = JSON.parse(JSON.stringify(first.resolver.snapshot()));
  assert.equal(Object.keys(stored.entries).length, 2);

  const second = createHarness();
  second.clock.t = first.clock.t + 1_000;
  assert.equal(second.resolver.hydrate(stored), 2);
  assert.equal(second.resolver.peek(PUBKEY).status, 'found');
  assert.deepEqual(second.resolver.peek(PUBKEY).relays, ['wss://inbox.example.com/']);
  assert.equal(second.net.calls.length, 0);
});

test('snapshot of an empty resolver is valid and omits expired entries', async () => {
  const { resolver, clock } = createHarness({ missingTtlMs: 10 });
  assert.deepEqual(Object.keys(resolver.snapshot().entries), []);
  await resolver.resolve(PUBKEY);
  clock.t += 10;
  assert.deepEqual(resolver.snapshot().entries, {});
});

test('hydrate skips expired entries', () => {
  const { resolver, clock } = createHarness({ ttlMs: 1_000 });
  const snapshot = {
    version: 1,
    entries: { [PUBKEY]: { status: 'found', relays: ['wss://a.example.com'], checkedAt: clock.t - 1_000 } },
  };
  assert.equal(resolver.hydrate(snapshot), 0);
  assert.equal(resolver.peek(PUBKEY), null);
});

test('hydrate re-validates, normalises and caps relays', () => {
  const { resolver, clock } = createHarness();
  const relays = ['wss://A.example.com', 'ws://insecure.example.com', 7, null,
    ...Array.from({ length: 10 }, (_, i) => `wss://r${i}.example.com`)];
  resolver.hydrate({ version: 1, entries: { [PUBKEY]: { status: 'found', relays, checkedAt: clock.t } } });
  const peeked = resolver.peek(PUBKEY);
  assert.equal(peeked.relays.length, MAX_INBOX_RELAYS_PER_CONTACT);
  assert.equal(peeked.relays[0], 'wss://a.example.com/');
});

test('hydrate never lets a missing entry carry relays', () => {
  const { resolver, clock } = createHarness();
  resolver.hydrate({
    version: 1,
    entries: { [PUBKEY]: { status: 'missing', relays: ['wss://a.example.com'], checkedAt: clock.t } },
  });
  assert.deepEqual(resolver.peek(PUBKEY).relays, []);
});

const BAD_SNAPSHOTS = [
  ['null', null],
  ['undefined', undefined],
  ['a string', '{"version":1}'],
  ['an array', []],
  ['a wrong version', { version: 2, entries: {} }],
  ['no version', { entries: {} }],
  ['no entries', { version: 1 }],
  ['entries as an array', { version: 1, entries: [] }],
  ['entries as null', { version: 1, entries: null }],
];

for (const [name, snapshot] of BAD_SNAPSHOTS) {
  test(`hydrate ignores ${name}`, () => {
    const { resolver } = createHarness();
    assert.equal(resolver.hydrate(snapshot), 0);
  });
}

test('hydrate skips malformed entries one by one and keeps the good ones', () => {
  const { resolver, clock } = createHarness();
  const good = { status: 'found', relays: ['wss://ok.example.com'], checkedAt: clock.t };
  const pk = (n) => n.toString(16).padStart(64, '0');
  const snapshot = {
    version: 1,
    entries: {
      [PUBKEY]: good,
      notahexkey: good,
      [pk(1)]: null,
      [pk(2)]: 'string',
      [pk(3)]: { ...good, status: 'unknown' },
      [pk(4)]: { ...good, status: 'weird' },
      [pk(5)]: { ...good, checkedAt: 'now' },
      [pk(6)]: { ...good, checkedAt: NaN },
      [pk(7)]: { ...good, checkedAt: clock.t + 60_000 },
      [pk(8)]: { ...good, relays: [] },
      [pk(9)]: { ...good, relays: 'wss://ok.example.com' },
      [pk(10)]: { ...good, relays: ['ws://insecure.example.com'] },
      [pk(11)]: { status: 'found' },
    },
  };
  assert.equal(resolver.hydrate(snapshot), 1);
  assert.deepEqual(Object.keys(resolver.snapshot().entries), [PUBKEY]);
});

test('hydrate does not replace a fresher entry', async () => {
  const { resolver, clock } = createHarness({ behaviours: { [D1]: { events: [FOUND_EVENT()] } } });
  await resolver.resolve(PUBKEY);
  resolver.hydrate({
    version: 1,
    entries: { [PUBKEY]: { status: 'found', relays: ['wss://stale.example.com'], checkedAt: clock.t - 5 } },
  });
  assert.deepEqual(resolver.peek(PUBKEY).relays, ['wss://inbox.example.com/']);
});

test('hydrate does not trust a __proto__ key', () => {
  const { resolver } = createHarness();
  const entries = JSON.parse('{"__proto__": {"status":"found","relays":["wss://a.example.com"],"checkedAt":1000000}}');
  assert.equal(resolver.hydrate({ version: 1, entries }), 0);
  assert.equal({}.status, undefined);
});
