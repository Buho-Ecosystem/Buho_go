/**
 * Blossom avatar upload tests.
 *
 * Pins the wire-level contract for the BUD-02 upload flow without
 * touching a real network: auth-event shape, header encoding,
 * validation order, hash-binding, and the response-handling paths
 * (success, hash mismatch, bad MIME, oversize, HTTP error, network
 * error, malformed JSON).
 *
 * Run directly with Node:
 *   node src/utils/__tests__/blossomProfileMedia.spec.js
 */

import { strict as assert } from 'node:assert';
import { verifyEvent, getPublicKey } from 'nostr-core';
import {
  ALLOWED_AVATAR_MIMES,
  AUTH_EXPIRATION_SECONDS,
  BLOSSOM_AUTH_KIND,
  DEFAULT_AVATAR_MAX_BYTES,
  __testing,
  uploadAvatar,
} from '../blossomProfileMedia.js';
import { DEFAULT_BLOSSOM_SERVER } from '../nostrRelays.js';

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
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    failed += 1;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET_KEY = new Uint8Array(32).fill(0x42);
const PUBKEY_HEX = getPublicKey(SECRET_KEY);

/**
 * Minimal File-like object. Avoids depending on Node 20's global
 * `Blob` having every browser quirk implemented — we only need
 * `size`, `type`, and `arrayBuffer()` per the helper's duck-type.
 */
function fakeFile(bytes, type = 'image/png') {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    size: buf.byteLength,
    type,
    arrayBuffer() {
      // Return a *fresh* ArrayBuffer copy so the helper's
      // `new Uint8Array(...)` view does not share the original
      // backing store. Matches the contract of browser File.
      const copy = new ArrayBuffer(buf.byteLength);
      new Uint8Array(copy).set(buf);
      return Promise.resolve(copy);
    },
  };
}

/**
 * Decode the `Authorization: Nostr <b64>` header back into a parsed
 * event. Lets tests inspect what we actually sent over the wire.
 */
function decodeAuthHeader(header) {
  assert.ok(header.startsWith('Nostr '), `expected Nostr scheme, got ${header}`);
  const b64 = header.slice('Nostr '.length);
  const json = typeof globalThis.atob === 'function'
    ? globalThis.atob(b64)
    : Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(json);
}

/**
 * Build a `fetch` mock that records calls and returns a configurable
 * response. By default it returns a successful upload echo.
 */
function makeFetchMock({ response, throwError } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (throwError) throw throwError;
    return response ?? new MockResponse({
      ok: true,
      status: 200,
      json: { sha256: '__match__', url: 'https://blossom.test/abc.png', size: 123, type: 'image/png' },
    });
  };
  return Object.assign(fn, { calls });
}

class MockResponse {
  constructor({ ok = true, status = 200, statusText = 'OK', json: jsonBody, text: textBody }) {
    this.ok = ok;
    this.status = status;
    this.statusText = statusText;
    this._json = jsonBody;
    this._text = textBody;
  }
  async json() {
    if (this._json === undefined) throw new Error('no json body');
    if (typeof this._json === 'string') throw new Error(this._json); // throw token
    return this._json;
  }
  async text() {
    return this._text ?? '';
  }
}

console.log('blossomProfileMedia');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

await test('BLOSSOM_AUTH_KIND is 24242 (BUD-02)', () => {
  assert.equal(BLOSSOM_AUTH_KIND, 24242);
});

await test('DEFAULT_AVATAR_MAX_BYTES is 5 MB', () => {
  assert.equal(DEFAULT_AVATAR_MAX_BYTES, 5 * 1024 * 1024);
});

await test('AUTH_EXPIRATION_SECONDS is 5 minutes (300s)', () => {
  assert.equal(AUTH_EXPIRATION_SECONDS, 300);
});

await test('ALLOWED_AVATAR_MIMES is the frozen image-only list', () => {
  assert.ok(Object.isFrozen(ALLOWED_AVATAR_MIMES));
  assert.deepEqual([...ALLOWED_AVATAR_MIMES], [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  ]);
});

// ---------------------------------------------------------------------------
// sha256Hex (internal helper)
// ---------------------------------------------------------------------------

await test('sha256Hex returns 64 lowercase hex chars', async () => {
  const hex = await __testing.sha256Hex(new Uint8Array([1, 2, 3]));
  assert.match(hex, /^[0-9a-f]{64}$/);
});

await test('sha256Hex is deterministic', async () => {
  const a = await __testing.sha256Hex(new Uint8Array([1, 2, 3]));
  const b = await __testing.sha256Hex(new Uint8Array([1, 2, 3]));
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// Auth-header shape
// ---------------------------------------------------------------------------

await test('buildAuthHeader produces a valid signed kind:24242 event', () => {
  const header = __testing.buildAuthHeader(
    { action: 'upload', hash: 'a'.repeat(64), server: 'https://blossom.test', expiration: 1700000300 },
    SECRET_KEY,
  );
  const event = decodeAuthHeader(header);
  assert.equal(event.kind, 24242);
  assert.equal(event.pubkey, PUBKEY_HEX);
  assert.equal(event.content, 'Authorize upload');
  assert.equal(verifyEvent(event), true);
});

await test('buildAuthHeader emits t / expiration / x / server tags in that order', () => {
  const header = __testing.buildAuthHeader(
    { action: 'upload', hash: 'a'.repeat(64), server: 'https://blossom.test', expiration: 1700000300 },
    SECRET_KEY,
  );
  const event = decodeAuthHeader(header);
  assert.deepEqual(event.tags, [
    ['t', 'upload'],
    ['expiration', '1700000300'],
    ['x', 'a'.repeat(64)],
    ['server', 'https://blossom.test'],
  ]);
});

await test('buildAuthHeader omits the x tag when no hash is supplied', () => {
  const header = __testing.buildAuthHeader(
    { action: 'list', hash: null, server: 'https://blossom.test', expiration: 1700000300 },
    SECRET_KEY,
  );
  const event = decodeAuthHeader(header);
  assert.ok(event.tags.every((t) => t[0] !== 'x'));
});

// ---------------------------------------------------------------------------
// Validation (cheap checks before any network)
// ---------------------------------------------------------------------------

await test('uploadAvatar rejects a non-File argument', async () => {
  await assert.rejects(
    () => uploadAvatar({}, SECRET_KEY, { fetch: makeFetchMock() }),
    /Blob\/File-like/,
  );
});

await test('uploadAvatar rejects a non-32-byte secret key', async () => {
  await assert.rejects(
    () => uploadAvatar(fakeFile(new Uint8Array([1])), new Uint8Array(31), { fetch: makeFetchMock() }),
    /32-byte Uint8Array/,
  );
});

await test('uploadAvatar rejects files larger than maxBytes before reading them', async () => {
  let arrayBufferCalled = false;
  const oversize = {
    size: 6 * 1024 * 1024,
    type: 'image/png',
    arrayBuffer() {
      arrayBufferCalled = true;
      return Promise.resolve(new ArrayBuffer(0));
    },
  };
  const fetchMock = makeFetchMock();
  await assert.rejects(
    () => uploadAvatar(oversize, SECRET_KEY, { fetch: fetchMock }),
    (err) => err.code === 'AVATAR_TOO_LARGE',
  );
  assert.equal(arrayBufferCalled, false, 'should reject before reading bytes');
  assert.equal(fetchMock.calls.length, 0, 'no network call should fire');
});

await test('uploadAvatar rejects unsupported MIME types', async () => {
  const fetchMock = makeFetchMock();
  await assert.rejects(
    () => uploadAvatar(
      fakeFile(new Uint8Array([1, 2, 3]), 'image/heic'),
      SECRET_KEY,
      { fetch: fetchMock },
    ),
    (err) => err.code === 'AVATAR_UNSUPPORTED_MIME',
  );
  assert.equal(fetchMock.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

await test('uploadAvatar PUTs to {server}/upload with file bytes', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const fileHash = await __testing.sha256Hex(bytes);
  const fetchMock = makeFetchMock({
    response: new MockResponse({
      ok: true,
      json: { sha256: fileHash, url: 'https://blossom.test/x.png', size: 4, type: 'image/png' },
    }),
  });
  const result = await uploadAvatar(
    fakeFile(bytes, 'image/png'),
    SECRET_KEY,
    { fetch: fetchMock, server: 'https://blossom.test' },
  );

  assert.equal(fetchMock.calls.length, 1);
  const [{ url, init }] = fetchMock.calls;
  assert.equal(url, 'https://blossom.test/upload');
  assert.equal(init.method, 'PUT');
  assert.equal(init.headers['Content-Type'], 'image/png');
  assert.ok(init.headers.Authorization.startsWith('Nostr '));
  // Body is the raw file bytes:
  assert.ok(init.body instanceof Uint8Array);
  assert.deepEqual([...init.body], [1, 2, 3, 4]);

  // Return shape matches the contract.
  assert.deepEqual(result, {
    url: 'https://blossom.test/x.png',
    hash: fileHash,
    mime: 'image/png',
    size: 4,
    server: 'https://blossom.test',
  });
});

await test('uploadAvatar uses DEFAULT_BLOSSOM_SERVER when no server is passed', async () => {
  const bytes = new Uint8Array([9, 9]);
  const fileHash = await __testing.sha256Hex(bytes);
  const fetchMock = makeFetchMock({
    response: new MockResponse({
      ok: true,
      json: { sha256: fileHash, url: `${DEFAULT_BLOSSOM_SERVER}/y.png`, size: 2, type: 'image/png' },
    }),
  });
  await uploadAvatar(fakeFile(bytes), SECRET_KEY, { fetch: fetchMock });
  assert.equal(fetchMock.calls[0].url, `${DEFAULT_BLOSSOM_SERVER}/upload`);
});

await test('uploadAvatar strips a trailing slash from a custom server URL', async () => {
  const bytes = new Uint8Array([1]);
  const fileHash = await __testing.sha256Hex(bytes);
  const fetchMock = makeFetchMock({
    response: new MockResponse({
      ok: true,
      json: { sha256: fileHash, url: 'https://blossom.test/abc.png', size: 1, type: 'image/png' },
    }),
  });
  const result = await uploadAvatar(
    fakeFile(bytes),
    SECRET_KEY,
    { fetch: fetchMock, server: 'https://blossom.test/' },
  );
  assert.equal(fetchMock.calls[0].url, 'https://blossom.test/upload');
  assert.equal(result.server, 'https://blossom.test');
});

await test('uploadAvatar binds the auth event to the exact file hash + server', async () => {
  const bytes = new Uint8Array([7, 7, 7]);
  const fileHash = await __testing.sha256Hex(bytes);
  const fetchMock = makeFetchMock({
    response: new MockResponse({
      ok: true,
      json: { sha256: fileHash, url: 'https://blossom.test/h.png', size: 3, type: 'image/png' },
    }),
  });
  await uploadAvatar(
    fakeFile(bytes, 'image/png'),
    SECRET_KEY,
    { fetch: fetchMock, server: 'https://blossom.test', now: () => 1_700_000_000_000 },
  );

  const event = decodeAuthHeader(fetchMock.calls[0].init.headers.Authorization);
  // x tag matches the file we read; server tag matches the URL we PUT to.
  const xTag = event.tags.find((t) => t[0] === 'x');
  const serverTag = event.tags.find((t) => t[0] === 'server');
  const expirationTag = event.tags.find((t) => t[0] === 'expiration');
  const tTag = event.tags.find((t) => t[0] === 't');
  assert.equal(xTag[1], fileHash);
  assert.equal(serverTag[1], 'https://blossom.test');
  assert.equal(tTag[1], 'upload');
  // Expiration is now + 300s, where `now` was injected as 1.7e12 ms.
  assert.equal(expirationTag[1], String(1_700_000_000 + 300));
});

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

await test('uploadAvatar throws AVATAR_HASH_MISMATCH when server returns a different sha256', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const fetchMock = makeFetchMock({
    response: new MockResponse({
      ok: true,
      json: { sha256: 'f'.repeat(64), url: 'https://x.test/a.png', size: 3, type: 'image/png' },
    }),
  });
  await assert.rejects(
    () => uploadAvatar(fakeFile(bytes), SECRET_KEY, { fetch: fetchMock, server: 'https://x.test' }),
    (err) => err.code === 'AVATAR_HASH_MISMATCH',
  );
});

await test('uploadAvatar throws AVATAR_UPLOAD_FAILED on HTTP error', async () => {
  const fetchMock = makeFetchMock({
    response: new MockResponse({ ok: false, status: 413, statusText: 'Too Large', text: 'over limit' }),
  });
  await assert.rejects(
    () => uploadAvatar(fakeFile(new Uint8Array([1])), SECRET_KEY, { fetch: fetchMock }),
    (err) => err.code === 'AVATAR_UPLOAD_FAILED' && err.status === 413,
  );
});

await test('uploadAvatar throws AVATAR_NETWORK_ERROR when fetch itself rejects', async () => {
  const fetchMock = makeFetchMock({ throwError: new Error('DNS failed') });
  await assert.rejects(
    () => uploadAvatar(fakeFile(new Uint8Array([1])), SECRET_KEY, { fetch: fetchMock }),
    (err) => err.code === 'AVATAR_NETWORK_ERROR' && /DNS failed/.test(err.message),
  );
});

await test('uploadAvatar throws AVATAR_BAD_RESPONSE on malformed JSON', async () => {
  const fetchMock = makeFetchMock({
    response: new MockResponse({ ok: true, json: 'unexpected end of input' }), // throw token
  });
  await assert.rejects(
    () => uploadAvatar(fakeFile(new Uint8Array([1])), SECRET_KEY, { fetch: fetchMock }),
    (err) => err.code === 'AVATAR_BAD_RESPONSE',
  );
});

await test('uploadAvatar throws AVATAR_BAD_RESPONSE when JSON omits the url field', async () => {
  const fetchMock = makeFetchMock({
    response: new MockResponse({ ok: true, json: { sha256: 'whatever' } }),
  });
  await assert.rejects(
    () => uploadAvatar(fakeFile(new Uint8Array([1])), SECRET_KEY, { fetch: fetchMock }),
    (err) => err.code === 'AVATAR_BAD_RESPONSE',
  );
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
