/**
 * sensitiveClipboard.js tests.
 *
 * The module is small but security-critical: timer semantics, replacement
 * behaviour, and cancellation are all things that drift silently without
 * coverage. Tests use real `setTimeout` with short durations (≤80ms) so
 * the suite finishes in under a second.
 *
 * Run with the Node runtime directly:
 *   node src/utils/__tests__/sensitiveClipboard.spec.js
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// ---------------------------------------------------------------------------
// Browser globals shim — must be installed before the module under test
// loads its first clipboard call.
// ---------------------------------------------------------------------------

/**
 * Mock clipboard surface. Each call appends to `writes` so a test can
 * inspect not just the latest value but the full sequence (e.g. to
 * verify that a wipe really fired after the user's text).
 */
const clipboard = {
  writes: [],
  async writeText(text) {
    this.writes.push(text);
  },
  reset() {
    this.writes = [];
  },
};

// Node 25 exposes `navigator` as a getter-only property, so direct
// assignment fails. defineProperty replaces the descriptor cleanly.
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard },
  writable: true,
  configurable: true,
});

const { copySensitive, cancelPendingSensitiveClear } = await import(
  '../sensitiveClipboard.js'
);

let passed = 0;
let failed = 0;

async function test(name, fn) {
  // Clean module-level state between tests so a leftover timer from a
  // previous case can't contaminate the next one.
  cancelPendingSensitiveClear();
  clipboard.reset();
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('sensitiveClipboard');

// ---------------------------------------------------------------------------
// Happy-path writes
// ---------------------------------------------------------------------------

await test('copySensitive writes the secret to the clipboard immediately', async () => {
  await copySensitive('nsec1secret', { durationMs: 80 });
  assert.equal(clipboard.writes.length, 1);
  assert.equal(clipboard.writes[0], 'nsec1secret');
  cancelPendingSensitiveClear();
});

await test('copySensitive returns a handle exposing durationMs and cancel', async () => {
  const handle = await copySensitive('x', { durationMs: 80 });
  assert.equal(handle.durationMs, 80);
  assert.equal(typeof handle.cancel, 'function');
  cancelPendingSensitiveClear();
});

await test('copySensitive defaults to 30_000 ms when no duration given', async () => {
  const handle = await copySensitive('x');
  assert.equal(handle.durationMs, 30_000);
  cancelPendingSensitiveClear();
});

// ---------------------------------------------------------------------------
// Auto-wipe semantics
// ---------------------------------------------------------------------------

await test('the wipe timer overwrites the clipboard with empty string', async () => {
  await copySensitive('nsec1secret', { durationMs: 30 });
  await wait(60); // generous buffer over the 30ms timer
  // Writes sequence: ['nsec1secret', '']
  assert.equal(clipboard.writes.length, 2);
  assert.equal(clipboard.writes[1], '');
});

await test('the wipe does not fire before durationMs elapses', async () => {
  await copySensitive('nsec1secret', { durationMs: 80 });
  await wait(20);
  assert.equal(clipboard.writes.length, 1); // still only the user's write
  cancelPendingSensitiveClear();
});

await test('a wipe failure is swallowed silently', async () => {
  // Simulate `writeText` rejecting on the wipe call only. The original
  // write must still succeed; the failed wipe must not become an
  // unhandled rejection.
  let firstCall = true;
  const origWrite = clipboard.writeText.bind(clipboard);
  clipboard.writeText = async function (text) {
    if (firstCall) {
      firstCall = false;
      return origWrite(text);
    }
    throw new Error('clipboard locked (simulated)');
  };

  let unhandled = null;
  const onUnhandled = (err) => { unhandled = err; };
  process.on('unhandledRejection', onUnhandled);

  await copySensitive('nsec1secret', { durationMs: 30 });
  await wait(60);

  process.off('unhandledRejection', onUnhandled);
  clipboard.writeText = origWrite;
  assert.equal(unhandled, null, 'wipe failure should not become unhandled');
});

// ---------------------------------------------------------------------------
// Replacement + cancellation
// ---------------------------------------------------------------------------

await test('a second copySensitive replaces the first wipe timer', async () => {
  await copySensitive('first', { durationMs: 30 });
  // Replace immediately — the first timer should be cancelled so the
  // first wipe never overwrites the second value with an empty string.
  await copySensitive('second', { durationMs: 80 });

  await wait(50); // past the first timer's deadline
  // Writes sequence so far: ['first', 'second'] — no wipe yet.
  assert.deepEqual(clipboard.writes, ['first', 'second']);

  await wait(60); // past the second timer's deadline
  assert.deepEqual(clipboard.writes, ['first', 'second', '']);
});

await test('cancel() before the timer fires aborts the wipe', async () => {
  const handle = await copySensitive('x', { durationMs: 40 });
  handle.cancel();
  await wait(80);
  assert.equal(clipboard.writes.length, 1); // user write only — no wipe
});

await test('cancel() is a no-op once the timer has fired', async () => {
  const handle = await copySensitive('x', { durationMs: 20 });
  await wait(50);
  // Timer has fired; handle.cancel() should not throw and should not
  // alter the clipboard further.
  handle.cancel();
  assert.equal(clipboard.writes.length, 2); // user + wipe
});

await test('cancel() from a stale handle does not affect the active timer', async () => {
  // First copy returns a handle. A second copy replaces the timer.
  // Calling cancel on the stale handle must NOT cancel the second
  // timer — otherwise a component that re-copies and discards the old
  // handle would lose its auto-clear.
  const stale = await copySensitive('first', { durationMs: 30 });
  await copySensitive('second', { durationMs: 50 });
  stale.cancel();
  await wait(80);
  // Second timer ran and wiped:
  assert.deepEqual(clipboard.writes, ['first', 'second', '']);
});

await test('cancelPendingSensitiveClear() aborts any active wipe', async () => {
  await copySensitive('x', { durationMs: 30 });
  cancelPendingSensitiveClear();
  await wait(60);
  assert.equal(clipboard.writes.length, 1);
});

await test('cancelPendingSensitiveClear() is a no-op when nothing is scheduled', () => {
  // Idempotent; safe to call from teardown without checking state first.
  cancelPendingSensitiveClear();
  cancelPendingSensitiveClear();
  // No throw is the assertion.
});


// Enforce the browser contract, rather than a permissive writeText mock.
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let inClick = false;
let requests = 0;
globalThis.ClipboardItem = class {
  constructor(data) { this.content = data['text/plain']; }
};
clipboard.write = function ([item]) {
  requests++;
  assert.ok(inClick, 'browser write must start before returning from the click');
  return item.content.then(async blob => { this.writes.push(await blob.text()); });
};
function click(fn) {
  inClick = true;
  try { return fn(); } finally { inClick = false; }
}

await test('asynchronous secrets reserve clipboard access synchronously', async () => {
  const source = deferred();
  const before = requests;
  const copy = click(() => copySensitive(() => source.promise));
  assert.equal(requests, before + 1);
  assert.deepEqual(clipboard.writes, []);
  source.resolve('dummy secret');
  await copy;
  assert.deepEqual(clipboard.writes, ['dummy secret']);
});

await test('plain text also starts its write before the click returns', async () => {
  const copy = copySensitive('dummy secret');
  assert.deepEqual(clipboard.writes, ['dummy secret']);
  await copy;
});

await test('a rejected secret is not copied and a retry works', async () => {
  const copy = click(() => copySensitive(async () => { throw new Error('locked'); }));
  await assert.rejects(copy, /locked/);
  assert.deepEqual(clipboard.writes, []);
  await click(() => copySensitive(async () => 'retry'));
  assert.deepEqual(clipboard.writes, ['retry']);
});

await test('a superseded asynchronous secret is never supplied to the clipboard', async () => {
  const source = deferred();
  const first = click(() => copySensitive(() => source.promise));
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await Promise.resolve();
  await click(() => copySensitive(async () => 'newer'));
  source.resolve('stale');
  await rejected;
  assert.deepEqual(clipboard.writes, ['newer']);
});

await test('permission rejection does not leave an unhandled source rejection', async () => {
  const original = clipboard.write;
  const source = deferred();
  let content;
  clipboard.write = ([item]) => {
    content = item.content;
    return Promise.reject(new DOMException('denied', 'NotAllowedError'));
  };
  try {
    await assert.rejects(copySensitive(() => source.promise), { name: 'NotAllowedError' });
    source.reject(new Error('locked later'));
    await assert.rejects(content, /locked later/);
    await wait(10);
    assert.deepEqual(clipboard.writes, []);
  } finally { clipboard.write = original; }
});

await test('unsupported async clipboard does not request the secret', async () => {
  const Item = globalThis.ClipboardItem;
  delete globalThis.ClipboardItem;
  let requested = false;
  try {
    await assert.rejects(copySensitive(async () => { requested = true; return 'secret'; }), /unavailable/);
    assert.equal(requested, false);
  } finally { globalThis.ClipboardItem = Item; }
});

await test('an old acknowledgment cannot replace the newer clipboard-clear timer', async () => {
  const original = clipboard.writeText;
  const acknowledgment = deferred();
  clipboard.writeText = function (text) {
    this.writes.push(text);
    return text === 'first' ? acknowledgment.promise : Promise.resolve();
  };
  try {
    const first = copySensitive('first', { durationMs: 20 });
    const rejected = assert.rejects(first, { name: 'AbortError' });
    await copySensitive('second', { durationMs: 60 });
    acknowledgment.resolve();
    await rejected;
    await wait(35);
    assert.deepEqual(clipboard.writes, ['first', 'second']);
    await wait(50);
    assert.deepEqual(clipboard.writes, ['first', 'second', '']);
  } finally { clipboard.writeText = original; }
});

// Load the actual helper with the native bridge stubbed, as in component tests.
function nativeHelper(write) {
  const source = readFileSync(new URL('../sensitiveClipboard.js', import.meta.url), 'utf8');
  const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } });
  const module = { exports: {} };
  const dependencies = {
    '@capacitor/core': { Capacitor: { isNativePlatform: () => true } },
    '@capacitor/clipboard': { Clipboard: { write } },
  };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

await test('native copy waits for the secret and clears through the native bridge', async () => {
  const writes = [];
  const native = nativeHelper(async ({ string }) => writes.push(string));
  const source = deferred();
  try {
    const copy = native.copySensitive(() => source.promise, { durationMs: 20 });
    assert.deepEqual(writes, []);
    source.resolve('native dummy');
    await copy;
    assert.deepEqual(writes, ['native dummy']);
    await wait(50);
    assert.deepEqual(writes, ['native dummy', '']);
    assert.deepEqual(clipboard.writes, []);
  } finally { native.cancelPendingSensitiveClear(); }
});

await test('native source cancellation never reaches the clipboard bridge', async () => {
  const native = nativeHelper(() => assert.fail('must not write'));
  await assert.rejects(native.copySensitive(async () => { throw new Error('cancelled'); }), /cancelled/);
  assert.deepEqual(clipboard.writes, []);
});

await test('native clipboard failure does not fall through to browser copying', async () => {
  const native = nativeHelper(async () => { throw new Error('native denied'); });
  await assert.rejects(native.copySensitive('native dummy'), /native denied/);
  assert.deepEqual(clipboard.writes, []);
});

cancelPendingSensitiveClear();

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
