/**
 * Username service tests (paid NIP-05 names on mybuho.de).
 *
 * Covers name rules and display (free shape, full address, look-alike
 * domains, input cleaning, slugs, suggestions), and the network calls the
 * claim sheet and boot rely on: search, paid request, payment checks and
 * the ownership check.
 *
 * Run directly with Node:
 *   node src/services/__tests__/nip05.spec.js
 */

import { strict as assert } from 'node:assert';
import {
  NIP05_DOMAIN,
  NIP05_PRICE_TIERS,
  NIP05_MAX_YEARS,
  clampYears,
  expiresAtFor,
  isFreeShapeHandle,
  splitNip05,
  ownUsernameFrom,
  formatUsername,
  normaliseUsernameInput,
  deriveNameSlug,
  suggestUsernames,
  expandUsername,
  usernameAddressFromInput,
  isLikelyAvailableLocalPart,
  searchHandle,
  requestPaidHandle,
  checkPaid,
  waitForActivation,
  isMine,
  lookupOwner,
  suggestUsernameFor,
  clearSuggestionCache,
} from '../nip05.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

/** Minimal fetch stub: records calls, returns queued responses in order. */
function makeFetchStub(queue = []) {
  const calls = [];
  const stub = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) throw new Error(`fetch stub: no queued response for ${url}`);
    if (next instanceof Error) throw next;
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      async json() { return next.body ?? {}; },
    };
  };
  return { stub, calls };
}

const KEY = 'ab'.repeat(32);

console.log('username service');

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

await test('NIP05_PRICE_TIERS: frozen, paid tiers only', () => {
  assert.equal(Object.isFrozen(NIP05_PRICE_TIERS), true);
  assert.equal(NIP05_PRICE_TIERS.every(Object.isFrozen), true);
  assert.deepEqual(
    NIP05_PRICE_TIERS.map(({ id, priceSats }) => [id, priceSats]),
    [['two-to-three', 10_000], ['four', 4_000], ['five-to-six', 2_000], ['seven-plus', 1_000]],
  );
});

await test('clampYears: whole years from 1 to 10', () => {
  assert.equal(NIP05_MAX_YEARS, 10);
  assert.equal(clampYears(1), 1);
  assert.equal(clampYears(10), 10);
  assert.equal(clampYears(11), 10);
  assert.equal(clampYears(0), 1);
  assert.equal(clampYears(2.6), 3);
  assert.equal(clampYears('4'), 4);
  assert.equal(clampYears(undefined), 1);
});

await test('expiresAtFor: 365 days per year from the payment', () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(expiresAtFor(0, 1), 365 * day);
  assert.equal(expiresAtFor(1000, 2), 1000 + 730 * day);
  assert.equal(expiresAtFor(0, 99), 3650 * day);
});

// ---------------------------------------------------------------------------
// Names and display
// ---------------------------------------------------------------------------

await test('isFreeShapeHandle: only the `.NNNNNN` ending', () => {
  assert.equal(isFreeShapeHandle('luckyowl.482913'), true);
  assert.equal(isFreeShapeHandle('maria'), false);
  assert.equal(isFreeShapeHandle('maria.48291'), false);
  assert.equal(isFreeShapeHandle('maria482913'), false);
  assert.equal(isFreeShapeHandle(''), false);
});

await test('splitNip05: lowercases, marks our domain', () => {
  assert.deepEqual(splitNip05('Maria@MyBuho.DE'), { local: 'maria', domain: 'mybuho.de', ours: true });
  assert.deepEqual(splitNip05('bob@example.net'), { local: 'bob', domain: 'example.net', ours: false });
  assert.equal(splitNip05('no-at-sign'), null);
  assert.equal(splitNip05('@mybuho.de'), null);
  assert.equal(splitNip05('maria@'), null);
});

await test('splitNip05: a look-alike letter never counts as our domain', () => {
  const lookalike = splitNip05('maria@mybuhо.de'); // Cyrillic o
  assert.ok(lookalike);
  assert.equal(lookalike.ours, false);
  assert.notEqual(lookalike.domain, NIP05_DOMAIN);
});

await test('ownUsernameFrom: paid names on our domain only', () => {
  assert.equal(ownUsernameFrom('maria@mybuho.de'), 'maria');
  assert.equal(ownUsernameFrom('Maria@MYBUHO.de'), 'maria');
  assert.equal(ownUsernameFrom('luckyowl.482913@mybuho.de'), '');
  assert.equal(ownUsernameFrom('maria@example.net'), '');
  assert.equal(ownUsernameFrom('_@mybuho.de'), '');
  assert.equal(ownUsernameFrom(''), '');
  assert.equal(ownUsernameFrom(null), '');
});

await test('formatUsername: always the full address with the domain', () => {
  assert.deepEqual(formatUsername('Maria@mybuho.de'), { text: 'maria@mybuho.de', local: 'maria', domain: 'mybuho.de' });
  assert.deepEqual(formatUsername('bob@example.net'), { text: 'bob@example.net', local: 'bob', domain: 'example.net' });
});

await test('formatUsername: `_@domain` is the domain itself', () => {
  assert.deepEqual(formatUsername('_@example.net'), { text: 'example.net', local: '', domain: 'example.net' });
});

await test('formatUsername: free-shape names on our domain are never shown', () => {
  assert.equal(formatUsername('luckyowl.482913@mybuho.de'), null);
  // Someone else's domain is not ours to judge.
  assert.deepEqual(formatUsername('x.482913@other.net')?.text, 'x.482913@other.net');
});

await test('normaliseUsernameInput: quietly fixes what people type or paste', () => {
  assert.equal(normaliseUsernameInput('  @Maria '), 'maria');
  assert.equal(normaliseUsernameInput('maria@mybuho.de'), 'maria');
  assert.equal(normaliseUsernameInput('María Schmidt'), 'mariaschmidt');
  assert.equal(normaliseUsernameInput('Straße'), 'strasse');
  // Characters that can never work are left for the validator to name.
  assert.equal(normaliseUsernameInput('maria!'), 'maria!');
});

await test('deriveNameSlug: folds accents, strips the rest, caps at 20', () => {
  assert.equal(deriveNameSlug({ name: 'Satoshi' }), 'satoshi');
  assert.equal(deriveNameSlug({ name: 'José Müller' }), 'josemuller');
  assert.equal(deriveNameSlug({ name: 'GROẞE Straße' }), 'grossestrasse');
  assert.equal(deriveNameSlug({ name: 'Big Name!! 21' }), 'bigname21');
  assert.equal(deriveNameSlug({ name: 'a'.repeat(30) }), 'a'.repeat(20));
});

await test('deriveNameSlug: nothing usable returns ""', () => {
  assert.equal(deriveNameSlug({ name: '' }), '');
  assert.equal(deriveNameSlug({ name: 'a' }), '');
  assert.equal(deriveNameSlug({ name: 'Мария' }), '');
  assert.equal(deriveNameSlug({}), '');
  assert.equal(deriveNameSlug(), '');
});

await test('suggestUsernames: variants of a two-word name, minus the taken one', () => {
  assert.deepEqual(suggestUsernames('Maria Schmidt', 'maria'), ['mariaschmidt', 'maria.s', 'maria_schmidt']);
});

await test('suggestUsernames: a single word has no invented variant', () => {
  assert.deepEqual(suggestUsernames('Maria', 'maria'), []);
  assert.deepEqual(suggestUsernames('', 'maria'), []);
});

await test('expandUsername: `@name` becomes the full address, nothing else changes', () => {
  assert.equal(expandUsername('@Maria'), `maria@${NIP05_DOMAIN}`);
  assert.equal(expandUsername('maria@example.net'), 'maria@example.net');
  assert.equal(expandUsername('npub1abc'), 'npub1abc');
  assert.equal(expandUsername('@'), '@');
});

await test('usernameAddressFromInput: our usernames only, in full', () => {
  assert.equal(usernameAddressFromInput('@Maria'), 'maria@mybuho.de');
  assert.equal(usernameAddressFromInput('maria@mybuho.de'), 'maria@mybuho.de');
  assert.equal(usernameAddressFromInput(' Maria@MyBuho.de '), 'maria@mybuho.de');
  assert.equal(usernameAddressFromInput('maria@example.net'), '');
  assert.equal(usernameAddressFromInput('luckyowl.482913@mybuho.de'), '');
  assert.equal(usernameAddressFromInput('maria'), '');
  assert.equal(usernameAddressFromInput('lnbc10u1abc'), '');
});

await test('isLikelyAvailableLocalPart: the shape rules', () => {
  assert.deepEqual(isLikelyAvailableLocalPart('satoshi'), { ok: true });
  assert.deepEqual(isLikelyAvailableLocalPart('  Satoshi  '), { ok: true });
  assert.deepEqual(isLikelyAvailableLocalPart('foo-bar_baz.q'), { ok: true });
  assert.deepEqual(isLikelyAvailableLocalPart(''), { ok: false, reason: 'empty' });
  assert.deepEqual(isLikelyAvailableLocalPart('a'), { ok: false, reason: 'too-short' });
  assert.deepEqual(isLikelyAvailableLocalPart('a'.repeat(64)), { ok: false, reason: 'too-long' });
  assert.deepEqual(isLikelyAvailableLocalPart('.satoshi'), { ok: false, reason: 'invalid-chars' });
  assert.deepEqual(isLikelyAvailableLocalPart('satoshi.'), { ok: false, reason: 'invalid-chars' });
  assert.deepEqual(isLikelyAvailableLocalPart('maria!'), { ok: false, reason: 'invalid-chars' });
});

// ---------------------------------------------------------------------------
// searchHandle
// ---------------------------------------------------------------------------

await test('searchHandle: empty query makes no request', async () => {
  const { stub, calls } = makeFetchStub([]);
  globalThis.fetch = stub;
  const r = await searchHandle({ query: '' });
  assert.equal(calls.length, 0);
  assert.equal(r.available, false);
  assert.equal(r.priceSats, null);
});

await test('searchHandle: hits the search endpoint with the lowercased query', async () => {
  const { stub, calls } = makeFetchStub([
    { body: { identifier: 'satoshi', available: true, price_in_sats: 10000, currency: 'sats' } },
  ]);
  globalThis.fetch = stub;
  const r = await searchHandle({ query: 'SatoSHI' });
  assert.match(calls[0].url, /\/nostrnip5\/api\/v1\/domain\/[A-Za-z0-9_-]+\/search\?q=satoshi&years=1$/);
  assert.equal(r.available, true);
  assert.equal(r.priceSats, 10000);
  assert.equal(r.currency, 'sats');
});

await test('searchHandle: taken and reserved names are unavailable', async () => {
  globalThis.fetch = makeFetchStub([
    { body: { identifier: 'taken', available: false } },
    { body: { identifier: 'admin', reserved: true } },
  ]).stub;
  assert.equal((await searchHandle({ query: 'taken' })).available, false);
  assert.equal((await searchHandle({ query: 'admin' })).available, false);
});

await test('searchHandle: tolerates the legacy price.sats shape', async () => {
  globalThis.fetch = makeFetchStub([{ body: { identifier: 'foo', available: true, price: { sats: 5000 } } }]).stub;
  assert.equal((await searchHandle({ query: 'foo' })).priceSats, 5000);
});

await test('searchHandle: HTTP errors carry the status', async () => {
  globalThis.fetch = makeFetchStub([{ ok: false, status: 502 }]).stub;
  await assert.rejects(() => searchHandle({ query: 'satoshi' }), (err) => err.status === 502);
});

// ---------------------------------------------------------------------------
// requestPaidHandle
// ---------------------------------------------------------------------------

await test('requestPaidHandle: posts the body and returns the payment code', async () => {
  const { stub, calls } = makeFetchStub([{
    status: 201,
    body: { id: 'addr-id', local_part: 'satoshi', payment_request: 'lnbc1abc', payment_hash: 'hash123', rotation_secret: 'rot' },
  }]);
  globalThis.fetch = stub;
  const r = await requestPaidHandle({ localPart: 'satoshi', pubkeyHex: KEY });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(body.local_part, 'satoshi');
  assert.equal(body.pubkey, KEY);
  assert.equal(body.create_invoice, true);
  assert.equal(body.years, 1);
  assert.deepEqual(r, { addressId: 'addr-id', handle: 'satoshi', invoice: 'lnbc1abc', paymentHash: 'hash123', rotationSecret: 'rot' });
});

await test('requestPaidHandle: asks for the chosen years, clamped to 1..10', async () => {
  const { stub, calls } = makeFetchStub([
    { status: 201, body: { local_part: 'a', payment_request: 'lnbc1', payment_hash: 'h' } },
    { status: 201, body: { local_part: 'a', payment_request: 'lnbc1', payment_hash: 'h' } },
  ]);
  globalThis.fetch = stub;
  await requestPaidHandle({ localPart: 'a', pubkeyHex: KEY, years: 3 });
  await requestPaidHandle({ localPart: 'a', pubkeyHex: KEY, years: 40 });
  assert.equal(JSON.parse(calls[0].init.body).years, 3);
  assert.equal(JSON.parse(calls[1].init.body).years, 10);
});

await test('requestPaidHandle: missing pubkey is refused before any request', async () => {
  globalThis.fetch = makeFetchStub([]).stub;
  await assert.rejects(() => requestPaidHandle({ localPart: 'x', pubkeyHex: '' }), /pubkey required/);
});

await test('requestPaidHandle: 409 (just taken) carries the status', async () => {
  globalThis.fetch = makeFetchStub([{ ok: false, status: 409 }]).stub;
  await assert.rejects(() => requestPaidHandle({ localPart: 'taken', pubkeyHex: KEY }), (err) => err.status === 409);
});

await test('requestPaidHandle: no payment code in the answer is an error', async () => {
  globalThis.fetch = makeFetchStub([{ status: 201, body: { id: 'x', local_part: 'y', payment_request: null } }]).stub;
  await assert.rejects(() => requestPaidHandle({ localPart: 'y', pubkeyHex: KEY }), /did not return an invoice/);
});

// ---------------------------------------------------------------------------
// checkPaid and waitForActivation
// ---------------------------------------------------------------------------

await test('checkPaid: true, false, and a fresh 404 counts as not paid yet', async () => {
  globalThis.fetch = makeFetchStub([
    { body: { paid: true } },
    { body: { paid: false } },
    { ok: false, status: 404 },
    { ok: false, status: 500 },
    new Error('offline'),
  ]).stub;
  assert.equal(await checkPaid({ paymentHash: 'h' }), true);
  assert.equal(await checkPaid({ paymentHash: 'h' }), false);
  assert.equal(await checkPaid({ paymentHash: 'h' }), false);
  assert.equal(await checkPaid({ paymentHash: 'h' }), null);
  assert.equal(await checkPaid({ paymentHash: 'h' }), null);
});

await test('waitForActivation: resolves paid once the server says so', async () => {
  const { stub, calls } = makeFetchStub([{ body: { paid: false } }, { ok: false, status: 404 }, { body: { paid: true } }]);
  globalThis.fetch = stub;
  const r = await waitForActivation({ paymentHash: 'hash123', intervalMs: 5, maxMs: 1000 });
  assert.equal(r.paid, true);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/payments\/hash123$/);
});

await test('waitForActivation: gives up with paid:false after maxMs', async () => {
  globalThis.fetch = makeFetchStub(Array.from({ length: 50 }, () => ({ body: { paid: false } }))).stub;
  const r = await waitForActivation({ paymentHash: 'h', intervalMs: 5, maxMs: 25 });
  assert.equal(r.paid, false);
});

await test('waitForActivation: an external abort stops it with AbortError', async () => {
  globalThis.fetch = makeFetchStub(Array.from({ length: 50 }, () => ({ body: { paid: false } }))).stub;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(
    () => waitForActivation({ paymentHash: 'h', signal: controller.signal, intervalMs: 5, maxMs: 1000 }),
    (err) => err.name === 'AbortError',
  );
});

// ---------------------------------------------------------------------------
// isMine
// ---------------------------------------------------------------------------

await test('isMine: true only when the name points at this key', async () => {
  const { stub, calls } = makeFetchStub([
    { body: { names: { maria: KEY.toUpperCase() } } },
    { body: { names: { maria: 'cd'.repeat(32) } } },
    { body: { names: {} } },
  ]);
  assert.equal(await isMine('Maria', KEY, { fetch: stub }), true);
  assert.equal(await isMine('maria', KEY, { fetch: stub }), false);
  assert.equal(await isMine('maria', KEY, { fetch: stub }), false);
  assert.match(calls[0].url, /\/nostrnip5\/api\/v1\/domain\/[A-Za-z0-9_-]+\/nostr\.json\?name=maria$/);
});

await test('isMine: an unanswerable check is null, never "not yours"', async () => {
  const { stub } = makeFetchStub([{ ok: false, status: 502 }, new Error('offline'), { body: { nope: true } }]);
  assert.equal(await isMine('maria', KEY, { fetch: stub }), null);
  assert.equal(await isMine('maria', KEY, { fetch: stub }), null);
  assert.equal(await isMine('maria', KEY, { fetch: stub }), null);
});

await test('isMine: missing input is simply false, with no request', async () => {
  const { stub, calls } = makeFetchStub([]);
  assert.equal(await isMine('', KEY, { fetch: stub }), false);
  assert.equal(await isMine('maria', '', { fetch: stub }), false);
  assert.equal(calls.length, 0);
});

await test('lookupOwner: the owner, "no one yet", or unknown', async () => {
  const { stub } = makeFetchStub([
    { body: { names: { maria: KEY.toUpperCase() } } },
    { body: { names: {}, relays: {} } },
    { ok: false, status: 500 },
  ]);
  assert.equal(await lookupOwner('maria', { fetch: stub }), KEY);
  assert.equal(await lookupOwner('maria', { fetch: stub }), '');
  assert.equal(await lookupOwner('maria', { fetch: stub }), null);
});

// ---------------------------------------------------------------------------
// suggestUsernameFor
// ---------------------------------------------------------------------------

await test('suggestUsernameFor: one search per slug, then cached', async () => {
  clearSuggestionCache();
  let searches = 0;
  const search = async () => { searches += 1; return { available: true, priceSats: 1000 }; };
  const first = await suggestUsernameFor('María', { now: 1000, search });
  const again = await suggestUsernameFor('Maria', { now: 2000, search });
  assert.deepEqual(first, { slug: 'maria', available: true });
  assert.deepEqual(again, first);
  assert.equal(searches, 1);
});

await test('suggestUsernameFor: stale after a day, unknown on errors, null without a slug', async () => {
  clearSuggestionCache();
  let searches = 0;
  const ok = async () => { searches += 1; return { available: false, priceSats: null }; };
  await suggestUsernameFor('maria', { now: 0, search: ok });
  await suggestUsernameFor('maria', { now: 25 * 60 * 60 * 1000, search: ok });
  assert.equal(searches, 2);
  assert.equal(await suggestUsernameFor('bob', { search: async () => { throw new Error('offline'); } }), null);
  assert.equal(await suggestUsernameFor('Мария', { search: ok }), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
