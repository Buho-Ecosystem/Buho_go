/**
 * NIP-05 marketplace service tests.
 *
 * Covers the post-bootstrap surface the marketplace sheet talks to —
 * `searchHandle`, `requestPaidHandle`, `waitForActivation`, and the
 * client-side `isLikelyAvailableLocalPart` shape check. The free-handle
 * registration path is exercised indirectly by the boot orchestrator
 * tests + an end-to-end manual check; here we focus on the new branches.
 *
 * Run directly with Node:
 *   node src/services/__tests__/nip05.spec.js
 */

import { strict as assert } from 'node:assert';
import {
  isLikelyAvailableLocalPart,
  searchHandle,
  requestPaidHandle,
  waitForActivation,
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

/**
 * Minimal fetch stub. Records every call, returns the next queued response.
 * Keeps each test self-contained — no global pollution between cases.
 */
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

console.log('nip05 marketplace service');

// ---------------------------------------------------------------------------
// isLikelyAvailableLocalPart — client-side shape check
// ---------------------------------------------------------------------------

await test('isLikelyAvailableLocalPart: accepts a normal lowercase name', () => {
  assert.deepEqual(isLikelyAvailableLocalPart('satoshi'), { ok: true });
});

await test('isLikelyAvailableLocalPart: trims + lowercases before checking', () => {
  assert.deepEqual(isLikelyAvailableLocalPart('  Satoshi  '), { ok: true });
});

await test('isLikelyAvailableLocalPart: empty input', () => {
  assert.deepEqual(isLikelyAvailableLocalPart(''), { ok: false, reason: 'empty' });
});

await test('isLikelyAvailableLocalPart: single char rejected as too-short', () => {
  assert.deepEqual(isLikelyAvailableLocalPart('a'), { ok: false, reason: 'too-short' });
});

await test('isLikelyAvailableLocalPart: 64+ chars rejected as too-long', () => {
  const long = 'a'.repeat(64);
  assert.deepEqual(isLikelyAvailableLocalPart(long), { ok: false, reason: 'too-long' });
});

await test('isLikelyAvailableLocalPart: free-fallback shape (`base.NNNNNN`) is allowed', () => {
  // The marketplace sheet routes these through the free registration
  // path (see `onContinue`), so the validator deliberately accepts the
  // `.NNNNNN` shape — typed directly or adopted via the suggestion chip.
  assert.deepEqual(isLikelyAvailableLocalPart('satoshi.482913'), { ok: true });
});

await test('isLikelyAvailableLocalPart: leading dot rejected', () => {
  assert.deepEqual(isLikelyAvailableLocalPart('.satoshi'), { ok: false, reason: 'invalid-chars' });
});

await test('isLikelyAvailableLocalPart: trailing dot rejected', () => {
  assert.deepEqual(isLikelyAvailableLocalPart('satoshi.'), { ok: false, reason: 'invalid-chars' });
});

await test('isLikelyAvailableLocalPart: spaces rejected', () => {
  assert.deepEqual(isLikelyAvailableLocalPart('big name'), { ok: false, reason: 'invalid-chars' });
});

await test('isLikelyAvailableLocalPart: hyphen and underscore allowed', () => {
  assert.deepEqual(isLikelyAvailableLocalPart('foo-bar_baz'), { ok: true });
});

// ---------------------------------------------------------------------------
// searchHandle
// ---------------------------------------------------------------------------

await test('searchHandle: empty query short-circuits with no fetch', async () => {
  const { stub, calls } = makeFetchStub([]);
  globalThis.fetch = stub;
  const r = await searchHandle({ query: '' });
  assert.equal(calls.length, 0);
  assert.equal(r.identifier, '');
  assert.equal(r.available, false);
  assert.equal(r.priceSats, null);
});

await test('searchHandle: hits the public search endpoint with the lowercased query', async () => {
  const { stub, calls } = makeFetchStub([
    {
      ok: true,
      body: {
        identifier: 'satoshi',
        available: true,
        price_in_sats: 10000,
        currency: 'sat',
        free_identifier_number: '482913',
      },
    },
  ]);
  globalThis.fetch = stub;
  const r = await searchHandle({ query: 'SatoSHI' });
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].url,
    /\/nostrnip5\/api\/v1\/domain\/[A-Za-z0-9_-]+\/search\?q=satoshi&years=1$/,
  );
  assert.equal(r.identifier, 'satoshi');
  assert.equal(r.available, true);
  assert.equal(r.priceSats, 10000);
  assert.equal(r.currency, 'sat');
  assert.equal(r.freeIdentifierNumber, '482913');
});

await test('searchHandle: surfaces "taken" via available:false', async () => {
  const { stub } = makeFetchStub([
    { ok: true, body: { identifier: 'taken', available: false, free_identifier_number: '482913' } },
  ]);
  globalThis.fetch = stub;
  const r = await searchHandle({ query: 'taken' });
  assert.equal(r.available, false);
  assert.equal(r.freeIdentifierNumber, '482913');
});

await test('searchHandle: tolerates the legacy price.sats shape', async () => {
  const { stub } = makeFetchStub([
    { ok: true, body: { identifier: 'foo', available: true, price: { sats: 5000 } } },
  ]);
  globalThis.fetch = stub;
  const r = await searchHandle({ query: 'foo' });
  assert.equal(r.priceSats, 5000);
});

await test('searchHandle: HTTP error surfaces with status code', async () => {
  const { stub } = makeFetchStub([{ ok: false, status: 502, body: {} }]);
  globalThis.fetch = stub;
  await assert.rejects(
    () => searchHandle({ query: 'satoshi' }),
    (err) => err.status === 502,
  );
});

// ---------------------------------------------------------------------------
// requestPaidHandle
// ---------------------------------------------------------------------------

await test('requestPaidHandle: posts the right body and returns the invoice', async () => {
  const { stub, calls } = makeFetchStub([
    {
      ok: true,
      status: 201,
      body: {
        id: 'addr-id',
        local_part: 'satoshi',
        payment_request: 'lnbc1abc',
        payment_hash: 'hash123',
        rotation_secret: 'rot-secret',
      },
    },
  ]);
  globalThis.fetch = stub;
  const r = await requestPaidHandle({
    localPart: 'satoshi',
    pubkeyHex: 'aa'.repeat(32),
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.local_part, 'satoshi');
  assert.equal(body.pubkey, 'aa'.repeat(32));
  assert.equal(body.create_invoice, true);
  assert.equal(body.years, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(r.invoice, 'lnbc1abc');
  assert.equal(r.paymentHash, 'hash123');
  assert.equal(r.rotationSecret, 'rot-secret');
  assert.equal(r.addressId, 'addr-id');
  assert.equal(r.handle, 'satoshi');
});

await test('requestPaidHandle: missing pubkey throws synchronously', async () => {
  globalThis.fetch = makeFetchStub([]).stub;
  await assert.rejects(
    () => requestPaidHandle({ localPart: 'x', pubkeyHex: '' }),
    /pubkey required/,
  );
});

await test('requestPaidHandle: 409 (name taken) surfaces with status', async () => {
  const { stub } = makeFetchStub([{ ok: false, status: 409, body: {} }]);
  globalThis.fetch = stub;
  await assert.rejects(
    () => requestPaidHandle({ localPart: 'taken', pubkeyHex: 'aa'.repeat(32) }),
    (err) => err.status === 409,
  );
});

await test('requestPaidHandle: server returns no invoice → typed error', async () => {
  const { stub } = makeFetchStub([
    { ok: true, status: 201, body: { id: 'x', local_part: 'y', payment_request: null } },
  ]);
  globalThis.fetch = stub;
  await assert.rejects(
    () => requestPaidHandle({ localPart: 'y', pubkeyHex: 'aa'.repeat(32) }),
    /did not return an invoice/,
  );
});

// ---------------------------------------------------------------------------
// waitForActivation
// ---------------------------------------------------------------------------

await test('waitForActivation: returns paid:true once the endpoint flips', async () => {
  const { stub, calls } = makeFetchStub([
    { ok: true, body: { paid: false } },
    { ok: true, body: { paid: false } },
    { ok: true, body: { paid: true } },
  ]);
  globalThis.fetch = stub;
  const r = await waitForActivation({
    paymentHash: 'hash123',
    intervalMs: 5,
    maxMs: 1000,
  });
  assert.equal(r.paid, true);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/payments\/hash123$/);
});

await test('waitForActivation: gives up with paid:false after maxMs', async () => {
  // Stub returns "not yet" forever; the cap stops us first.
  const { stub } = makeFetchStub(
    Array.from({ length: 20 }, () => ({ ok: true, body: { paid: false } })),
  );
  globalThis.fetch = stub;
  const r = await waitForActivation({
    paymentHash: 'h',
    intervalMs: 5,
    maxMs: 25,
  });
  assert.equal(r.paid, false);
});

await test('waitForActivation: transient 404s are tolerated, paid:true still resolves', async () => {
  const { stub } = makeFetchStub([
    { ok: false, status: 404, body: {} },     // just-created invoice, row not visible yet
    { ok: false, status: 404, body: {} },
    { ok: true, body: { paid: true } },
  ]);
  globalThis.fetch = stub;
  const r = await waitForActivation({
    paymentHash: 'h',
    intervalMs: 5,
    maxMs: 1000,
  });
  assert.equal(r.paid, true);
});

await test('waitForActivation: respects an external AbortSignal', async () => {
  const { stub } = makeFetchStub([
    { ok: true, body: { paid: false } },
  ]);
  globalThis.fetch = stub;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(
    () => waitForActivation({
      paymentHash: 'h',
      signal: controller.signal,
      intervalMs: 5,
      maxMs: 1000,
    }),
    (err) => err.name === 'AbortError',
  );
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
