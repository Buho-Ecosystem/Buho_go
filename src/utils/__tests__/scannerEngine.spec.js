/**
 * scannerEngine — engine-selection policy tests.
 *
 * The camera itself needs a device; what must never regress in CI is the
 * policy that decides when the native MLKit engine is unusable and the
 * overlay should fall back to the in-webview qr-scanner engine, and how
 * long that decision is remembered. Storage and clocks are injected.
 *
 * Run directly with Node:
 *   node --test src/utils/__tests__/scannerEngine.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ENGINE_MEMORY_KEY,
  NATIVE_ERROR,
  createEngineMemory,
  createScanErrorGate,
  isFatalScanErrorMessage,
  shouldFallBackToWeb,
  withTimeout,
} from '../scannerEngine.js';

function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

test('permission refusals never fall back; every other native failure does', () => {
  const denied = Object.assign(new Error('no'), { code: NATIVE_ERROR.PERMISSION_DENIED });
  assert.equal(shouldFallBackToWeb(denied), false);
  for (const code of [NATIVE_ERROR.UNAVAILABLE, NATIVE_ERROR.START_FAILED, NATIVE_ERROR.START_TIMEOUT, NATIVE_ERROR.DECODER_FAILED]) {
    assert.equal(shouldFallBackToWeb(Object.assign(new Error('x'), { code })), true, code);
  }
  assert.equal(shouldFallBackToWeb(new Error('uncoded')), true);
  assert.equal(shouldFallBackToWeb(undefined), true);
});

test('fatal scanError messages point at Google-side machinery', () => {
  assert.equal(isFatalScanErrorMessage('Waiting for the barcode module to be downloaded. Please wait.'), true);
  assert.equal(isFatalScanErrorMessage('Failed to load deprecated vision dynamite module'), true);
  assert.equal(isFatalScanErrorMessage('Google Play services is not available on this device'), true);
  assert.equal(isFatalScanErrorMessage('Failed to init thin barcode scanner.'), true);
  assert.equal(isFatalScanErrorMessage('Image is too small'), false);
  assert.equal(isFatalScanErrorMessage(''), false);
  assert.equal(isFatalScanErrorMessage(undefined), false);
});

test('scan-error gate trips at once on a fatal message, and only once', () => {
  const gate = createScanErrorGate();
  assert.equal(gate.onError('Waiting for the barcode module to be downloaded.'), true);
  assert.equal(gate.tripped, true);
  assert.equal(gate.onError('Waiting for the barcode module to be downloaded.'), false);
});

test('scan-error gate needs a run of ordinary errors before tripping', () => {
  const gate = createScanErrorGate({ threshold: 3 });
  assert.equal(gate.onError('frame dropped'), false);
  assert.equal(gate.onError('frame dropped'), false);
  assert.equal(gate.onError('frame dropped'), true);
  assert.equal(gate.onError('frame dropped'), false);
});

test('scan-error gate ignores errors once the engine has decoded something', () => {
  const gate = createScanErrorGate({ threshold: 1 });
  gate.onDecoded();
  assert.equal(gate.onError('Waiting for the barcode module to be downloaded.'), false);
  assert.equal(gate.tripped, false);
});

test('withTimeout passes a prompt result through and clears its timer', async () => {
  let cleared = false;
  const value = await withTimeout(Promise.resolve('ok'), 1000, {
    setTimeoutFn: () => 'timer',
    clearTimeoutFn: (t) => { cleared = t === 'timer'; },
  });
  assert.equal(value, 'ok');
  assert.equal(cleared, true);
});

test('withTimeout rejects with the coded error when the deadline fires first', async () => {
  let fire;
  const never = new Promise(() => {});
  const pending = withTimeout(never, 6000, {
    code: NATIVE_ERROR.START_TIMEOUT,
    setTimeoutFn: (fn) => { fire = fn; return 1; },
    clearTimeoutFn: () => {},
  });
  fire();
  await assert.rejects(pending, (err) => err.code === NATIVE_ERROR.START_TIMEOUT && /6000/.test(err.message));
});

test('engine memory starts out trusting native', () => {
  const memory = createEngineMemory({ storage: memStorage(), appVersion: '1.9.2' });
  assert.equal(memory.isNativeDemoted(), false);
  assert.equal(memory.peek(), null);
});

test('a demotion is remembered with its reason and cleared by restore', () => {
  const storage = memStorage();
  const memory = createEngineMemory({ storage, now: () => 1000, appVersion: '1.9.2' });
  memory.demoteNative(NATIVE_ERROR.START_TIMEOUT);
  assert.equal(memory.isNativeDemoted(), true);
  assert.deepEqual(memory.peek(), { at: 1000, version: '1.9.2', reason: NATIVE_ERROR.START_TIMEOUT });
  memory.restoreNative();
  assert.equal(memory.isNativeDemoted(), false);
  assert.equal(storage.map.has(ENGINE_MEMORY_KEY), false);
});

test('an app update re-probes native', () => {
  const storage = memStorage();
  createEngineMemory({ storage, now: () => 1000, appVersion: '1.9.2' }).demoteNative('x');
  assert.equal(createEngineMemory({ storage, now: () => 2000, appVersion: '1.9.2' }).isNativeDemoted(), true);
  assert.equal(createEngineMemory({ storage, now: () => 2000, appVersion: '1.9.3' }).isNativeDemoted(), false);
});

test('without a build version the memory still expires on its TTL', () => {
  const storage = memStorage();
  let now = 0;
  const memory = createEngineMemory({ storage, now: () => now, ttlMs: 500 });
  memory.demoteNative('x');
  now = 499;
  assert.equal(memory.isNativeDemoted(), true);
  now = 501;
  assert.equal(memory.isNativeDemoted(), false);
});

test('corrupt or missing storage never blocks the native attempt or throws', () => {
  const corrupt = createEngineMemory({ storage: memStorage({ [ENGINE_MEMORY_KEY]: '{not json' }) });
  assert.equal(corrupt.isNativeDemoted(), false);
  const wrongShape = createEngineMemory({ storage: memStorage({ [ENGINE_MEMORY_KEY]: '"string"' }) });
  assert.equal(wrongShape.isNativeDemoted(), false);
  const none = createEngineMemory({ storage: null });
  assert.doesNotThrow(() => none.demoteNative('x'));
  assert.doesNotThrow(() => none.restoreNative());
  assert.equal(none.isNativeDemoted(), false);
  const throwing = createEngineMemory({
    storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } },
  });
  assert.doesNotThrow(() => throwing.demoteNative('x'));
  assert.equal(throwing.isNativeDemoted(), false);
});
