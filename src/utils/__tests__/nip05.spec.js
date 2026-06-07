/**
 * NIP-05 resolver tests.
 *
 * The resolver is the entry point every "find someone by their
 * handle" flow depends on. Coverage here pins the spec-correct
 * parsing, the fetch contract, and every typed-error path so the
 * UI never has to string-match the message field.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/nip05.spec.js
 */

import { strict as assert } from 'node:assert';
import {
  DEFAULT_RESOLVE_TIMEOUT_MS,
  NIP05_ERROR,
  parseNip05,
  resolveNip05,
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
    if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    failed += 1;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SATOSHI_HEX = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
const SATOSHI_NPUB = 'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m';

/**
 * Construct a `fetch`-like that satisfies the resolver's shape: it
 * records every call and returns a configurable `Response`. We
 * mirror only the surface area the resolver actually consumes — no
 * need to mock `headers`, `redirect`, etc.
 */
function fakeFetch({ ok = true, status = 200, body = {}, throwError = null } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (throwError) throw throwError;
    return new MockResponse({ ok, status, body });
  };
  fn.calls = calls;
  return fn;
}

class MockResponse {
  constructor({ ok, status, body }) {
    this.ok = ok;
    this.status = status;
    this._body = body;
  }
  async json() {
    if (this._body === '__throw_on_json__') {
      throw new SyntaxError('Unexpected token');
    }
    return this._body;
  }
}

// ---------------------------------------------------------------------------
// parseNip05
// ---------------------------------------------------------------------------

console.log('nip05');

await test('parseNip05 splits a well-formed identifier', () => {
  assert.deepEqual(parseNip05('satoshi@example.com'), {
    local: 'satoshi',
    domain: 'example.com',
  });
});

await test('parseNip05 lowercases the local part (spec: case-insensitive)', () => {
  assert.deepEqual(parseNip05('Satoshi@example.com'), {
    local: 'satoshi',
    domain: 'example.com',
  });
});

await test('parseNip05 lowercases the domain (DNS is case-insensitive)', () => {
  assert.deepEqual(parseNip05('satoshi@EXAMPLE.com'), {
    local: 'satoshi',
    domain: 'example.com',
  });
});

await test('parseNip05 trims surrounding whitespace', () => {
  assert.deepEqual(parseNip05('  satoshi@example.com  '), {
    local: 'satoshi',
    domain: 'example.com',
  });
});

await test('parseNip05 rewrites a bare domain to `_@domain`', () => {
  assert.deepEqual(parseNip05('example.com'), {
    local: '_',
    domain: 'example.com',
  });
});

await test('parseNip05 accepts dots, hyphens, and underscores in the local part', () => {
  assert.deepEqual(parseNip05('a.b-c_d@example.com'), {
    local: 'a.b-c_d',
    domain: 'example.com',
  });
});

await test('parseNip05 rejects an empty input', () => {
  assert.throws(
    () => parseNip05(''),
    (err) => err.code === NIP05_ERROR.INVALID_FORMAT,
  );
});

await test('parseNip05 rejects non-string input', () => {
  assert.throws(
    () => parseNip05(42),
    (err) => err.code === NIP05_ERROR.INVALID_FORMAT,
  );
  assert.throws(
    () => parseNip05(null),
    (err) => err.code === NIP05_ERROR.INVALID_FORMAT,
  );
});

await test('parseNip05 rejects multiple @ characters', () => {
  assert.throws(
    () => parseNip05('a@b@c.com'),
    (err) => err.code === NIP05_ERROR.INVALID_FORMAT,
  );
});

await test('parseNip05 rejects whitespace inside the local part', () => {
  assert.throws(
    () => parseNip05('name space@example.com'),
    (err) => err.code === NIP05_ERROR.INVALID_FORMAT,
  );
});

await test('parseNip05 rejects domains without a TLD', () => {
  assert.throws(
    () => parseNip05('satoshi@localhost'),
    (err) => err.code === NIP05_ERROR.INVALID_FORMAT,
  );
});

await test('parseNip05 rejects an empty local part (@domain.com)', () => {
  assert.throws(
    () => parseNip05('@example.com'),
    (err) => err.code === NIP05_ERROR.INVALID_FORMAT,
  );
});

// ---------------------------------------------------------------------------
// resolveNip05 — happy paths
// ---------------------------------------------------------------------------

await test('resolveNip05 fetches /.well-known/nostr.json with the lowercased local part', async () => {
  const fetch = fakeFetch({ body: { names: { satoshi: SATOSHI_HEX } } });
  await resolveNip05('Satoshi@Example.com', { fetch });
  assert.equal(fetch.calls.length, 1);
  assert.equal(
    fetch.calls[0].url,
    `https://example.com/.well-known/nostr.json?name=satoshi`,
  );
  assert.equal(fetch.calls[0].init.method, 'GET');
});

await test('resolveNip05 returns { pubkey, npub, relays:[] } when the user is registered', async () => {
  const fetch = fakeFetch({ body: { names: { satoshi: SATOSHI_HEX } } });
  const out = await resolveNip05('satoshi@example.com', { fetch });
  assert.deepEqual(out, {
    pubkey: SATOSHI_HEX,
    npub: SATOSHI_NPUB,
    relays: [],
  });
});

await test('resolveNip05 surfaces relay hints when the server provides them', async () => {
  const fetch = fakeFetch({
    body: {
      names: { satoshi: SATOSHI_HEX },
      relays: {
        [SATOSHI_HEX]: ['wss://relay.example.com', 'wss://other.example'],
      },
    },
  });
  const out = await resolveNip05('satoshi@example.com', { fetch });
  assert.deepEqual(out.relays, ['wss://relay.example.com', 'wss://other.example']);
});

await test('resolveNip05 filters out non-WebSocket entries from the relays array', async () => {
  const fetch = fakeFetch({
    body: {
      names: { satoshi: SATOSHI_HEX },
      relays: {
        [SATOSHI_HEX]: ['wss://good.example', 'https://nope.example', '', null, 'wss://also-good'],
      },
    },
  });
  const out = await resolveNip05('satoshi@example.com', { fetch });
  assert.deepEqual(out.relays, ['wss://good.example', 'wss://also-good']);
});

await test('resolveNip05 ignores a malformed relays map without failing the lookup', async () => {
  const fetch = fakeFetch({
    body: {
      names: { satoshi: SATOSHI_HEX },
      relays: 'not an object',
    },
  });
  const out = await resolveNip05('satoshi@example.com', { fetch });
  assert.deepEqual(out.relays, []);
});

await test('resolveNip05 matches the local part case-insensitively against the server response', async () => {
  // Server stores the name with mixed case; spec says lookup is
  // case-insensitive both directions.
  const fetch = fakeFetch({ body: { names: { Satoshi: SATOSHI_HEX } } });
  const out = await resolveNip05('satoshi@example.com', { fetch });
  assert.equal(out.pubkey, SATOSHI_HEX);
});

await test('resolveNip05 lowercases the returned pubkey for consistency', async () => {
  // Some servers return upper-case hex. Storage layer expects
  // lowercase everywhere.
  const fetch = fakeFetch({ body: { names: { satoshi: SATOSHI_HEX.toUpperCase() } } });
  const out = await resolveNip05('satoshi@example.com', { fetch });
  assert.equal(out.pubkey, SATOSHI_HEX);
});

await test('resolveNip05 handles bare-domain identifiers via the `_@domain` shortcut', async () => {
  const fetch = fakeFetch({ body: { names: { _: SATOSHI_HEX } } });
  const out = await resolveNip05('example.com', { fetch });
  assert.equal(out.pubkey, SATOSHI_HEX);
  // The fetch URL must still carry name=_
  assert.equal(
    fetch.calls[0].url,
    'https://example.com/.well-known/nostr.json?name=_',
  );
});

// ---------------------------------------------------------------------------
// resolveNip05 — failure paths
// ---------------------------------------------------------------------------

await test('resolveNip05 throws NIP05_INVALID_FORMAT for unparseable input', async () => {
  await assert.rejects(
    () => resolveNip05('not a valid identifier', { fetch: fakeFetch() }),
    (err) => err.code === NIP05_ERROR.INVALID_FORMAT,
  );
});

await test('resolveNip05 throws NIP05_NETWORK_ERROR when fetch itself rejects', async () => {
  const fetch = fakeFetch({ throwError: new Error('DNS failure') });
  await assert.rejects(
    () => resolveNip05('satoshi@example.com', { fetch }),
    (err) => err.code === NIP05_ERROR.NETWORK && /DNS failure/.test(err.message),
  );
});

await test('resolveNip05 throws NIP05_HTTP_ERROR on a non-2xx response', async () => {
  const fetch = fakeFetch({ ok: false, status: 404, body: {} });
  await assert.rejects(
    () => resolveNip05('satoshi@example.com', { fetch }),
    (err) => err.code === NIP05_ERROR.HTTP && /404/.test(err.message),
  );
});

await test('resolveNip05 throws NIP05_BAD_RESPONSE on JSON parse failure', async () => {
  const fetch = fakeFetch({ body: '__throw_on_json__' });
  await assert.rejects(
    () => resolveNip05('satoshi@example.com', { fetch }),
    (err) => err.code === NIP05_ERROR.BAD_RESPONSE,
  );
});

await test('resolveNip05 throws NIP05_BAD_RESPONSE when names object is missing', async () => {
  const fetch = fakeFetch({ body: { something: 'else' } });
  await assert.rejects(
    () => resolveNip05('satoshi@example.com', { fetch }),
    (err) => err.code === NIP05_ERROR.BAD_RESPONSE,
  );
});

await test('resolveNip05 throws NIP05_NOT_FOUND when local part is absent from names', async () => {
  const fetch = fakeFetch({ body: { names: { someoneelse: SATOSHI_HEX } } });
  await assert.rejects(
    () => resolveNip05('satoshi@example.com', { fetch }),
    (err) => err.code === NIP05_ERROR.NOT_FOUND,
  );
});

await test('resolveNip05 throws NIP05_PUBKEY_INVALID for a non-hex pubkey', async () => {
  const fetch = fakeFetch({ body: { names: { satoshi: 'definitely not hex' } } });
  await assert.rejects(
    () => resolveNip05('satoshi@example.com', { fetch }),
    (err) => err.code === NIP05_ERROR.PUBKEY_INVALID,
  );
});

await test('resolveNip05 throws NIP05_PUBKEY_INVALID for a too-short hex pubkey', async () => {
  const fetch = fakeFetch({ body: { names: { satoshi: 'a'.repeat(63) } } });
  await assert.rejects(
    () => resolveNip05('satoshi@example.com', { fetch }),
    (err) => err.code === NIP05_ERROR.PUBKEY_INVALID,
  );
});

// ---------------------------------------------------------------------------
// resolveNip05 — cancellation + timeout
// ---------------------------------------------------------------------------

await test('resolveNip05 respects an AbortSignal fired by the caller', async () => {
  const controller = new AbortController();
  // Fetch that resolves slowly enough for us to abort first.
  const fetch = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
  const promise = resolveNip05('satoshi@example.com', {
    fetch,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(
    () => promise,
    (err) => err.code === NIP05_ERROR.CANCELLED,
  );
});

await test('resolveNip05 honours a short opts.timeoutMs', async () => {
  // Fetch that never resolves naturally — only the resolver's
  // internal timeout abort can end it.
  const fetch = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
  await assert.rejects(
    () => resolveNip05('satoshi@example.com', { fetch, timeoutMs: 30 }),
    (err) => err.code === NIP05_ERROR.NETWORK && /timed out/.test(err.message),
  );
});

await test('DEFAULT_RESOLVE_TIMEOUT_MS is a positive finite number', () => {
  assert.ok(Number.isFinite(DEFAULT_RESOLVE_TIMEOUT_MS));
  assert.ok(DEFAULT_RESOLVE_TIMEOUT_MS > 0);
});

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

await test('NIP05_ERROR is a frozen catalogue of stable string codes', () => {
  assert.ok(Object.isFrozen(NIP05_ERROR));
  for (const v of Object.values(NIP05_ERROR)) {
    assert.equal(typeof v, 'string');
    assert.match(v, /^NIP05_/);
  }
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
