/**
 * diagnoseConnection: offline, no internet, or only the service down, and
 * what each probe sends.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/connectivity.spec.js
 */

import { strict as assert } from 'node:assert';
import { diagnoseConnection, PROBE_URLS, PROBE_TIMEOUT_MS } from '../connectivity.js';

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

const unreachable = () => Promise.reject(new TypeError('Failed to fetch'));

await test('no network at all: offline, and nothing is sent', async () => {
  const sent = [];
  const kind = await diagnoseConnection({ online: false, request: (url) => { sent.push(url); return unreachable(); } });
  assert.equal(kind, 'offline');
  assert.deepEqual(sent, []);
});

await test('a network that reaches no host: no internet', async () => {
  assert.equal(await diagnoseConnection({ online: true, request: unreachable }), 'no-internet');
});

await test('one host answering is enough: the internet works, the service is down', async () => {
  const request = (url) => (url === PROBE_URLS[1] ? Promise.resolve({ type: 'opaque' }) : unreachable());
  assert.equal(await diagnoseConnection({ online: true, request }), 'service');
});

await test('a probe is a bare HEAD: no credentials, no referrer, no cached answer', async () => {
  const sent = [];
  await diagnoseConnection({ online: true, request: (url, init) => { sent.push({ url, ...init }); return Promise.resolve({}); } });
  assert.deepEqual(sent.map((s) => s.url), PROBE_URLS);
  for (const s of sent) {
    assert.deepEqual(
      [s.method, s.mode, s.cache, s.credentials, s.referrerPolicy, s.body],
      ['HEAD', 'no-cors', 'no-store', 'omit', 'no-referrer', undefined],
    );
    assert.ok(s.signal instanceof AbortSignal);
  }
});

await test(`a host that never answers is given up after ${PROBE_TIMEOUT_MS} ms`, async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const started = Date.now();
  assert.equal(await diagnoseConnection({ online: true, request: hang }), 'no-internet');
  const took = Date.now() - started;
  assert.ok(took >= PROBE_TIMEOUT_MS - 50 && took < PROBE_TIMEOUT_MS + 1000, `took ${took} ms`);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
