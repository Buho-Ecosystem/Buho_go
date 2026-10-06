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
  NATIVE_STRIKES_TO_PERSIST,
  createEngineMemory,
  createScanErrorGate,
  isFatalScanErrorMessage,
  isStructuralNativeFailure,
  shouldFallBackToWeb,
  shouldRetryNativeAfterWebFailure,
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

test('structural failures are the plugin or decoder being unusable; start failures are ambiguous', () => {
  assert.equal(isStructuralNativeFailure(NATIVE_ERROR.UNAVAILABLE), true);
  assert.equal(isStructuralNativeFailure(NATIVE_ERROR.DECODER_FAILED), true);
  assert.equal(isStructuralNativeFailure(NATIVE_ERROR.START_FAILED), false);
  assert.equal(isStructuralNativeFailure(NATIVE_ERROR.START_TIMEOUT), false);
  assert.equal(isStructuralNativeFailure(NATIVE_ERROR.PERMISSION_DENIED), false);
  assert.equal(isStructuralNativeFailure(undefined), false);
});

test('a failed web start retries native only when native was skipped and permission is not the problem', () => {
  const busy = Object.assign(new Error('Could not start video source'), { name: 'NotReadableError' });
  const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
  const insecure = Object.assign(new Error('insecure'), { name: 'SecurityError' });
  assert.equal(shouldRetryNativeAfterWebFailure({ triedNative: false, nativeAvailable: true, webError: busy }), true);
  assert.equal(shouldRetryNativeAfterWebFailure({ triedNative: false, nativeAvailable: true, webError: new Error('x') }), true);
  assert.equal(shouldRetryNativeAfterWebFailure({ triedNative: true, nativeAvailable: true, webError: busy }), false);
  assert.equal(shouldRetryNativeAfterWebFailure({ triedNative: false, nativeAvailable: false, webError: busy }), false);
  assert.equal(shouldRetryNativeAfterWebFailure({ triedNative: false, nativeAvailable: true, webError: denied }), false);
  assert.equal(shouldRetryNativeAfterWebFailure({ triedNative: false, nativeAvailable: true, webError: insecure }), false);
});

test('engine memory starts out trusting native', () => {
  const memory = createEngineMemory({ storage: memStorage(), appVersion: '1.9.2' });
  assert.equal(memory.isNativeDemoted(), false);
  assert.equal(memory.peek(), null);
});

test('any failure demotes native for the rest of the session', () => {
  const memory = createEngineMemory({ storage: memStorage(), now: () => 1000, appVersion: '1.9.2' });
  memory.recordNativeFailure(NATIVE_ERROR.START_FAILED);
  assert.equal(memory.isNativeDemoted(), true);
  assert.deepEqual(memory.peek(), { at: 1000, version: '1.9.2', reason: NATIVE_ERROR.START_FAILED, strikes: 1 });
});

test('a single ambiguous failure does not survive a restart', () => {
  // The healthy-phone case: camera held by another app, or a slow cold start.
  const storage = memStorage();
  for (const code of [NATIVE_ERROR.START_FAILED, NATIVE_ERROR.START_TIMEOUT]) {
    storage.map.clear();
    createEngineMemory({ storage, now: () => 1000, appVersion: '1.9.2' }).recordNativeFailure(code);
    const nextLaunch = createEngineMemory({ storage, now: () => 2000, appVersion: '1.9.2' });
    assert.equal(nextLaunch.isNativeDemoted(), false, code);
  }
});

test('repeated ambiguous failures across launches are remembered', () => {
  const storage = memStorage();
  createEngineMemory({ storage, now: () => 1000, appVersion: '1.9.2' }).recordNativeFailure(NATIVE_ERROR.START_TIMEOUT);
  const second = createEngineMemory({ storage, now: () => 2000, appVersion: '1.9.2' });
  assert.equal(second.isNativeDemoted(), false);
  second.recordNativeFailure(NATIVE_ERROR.START_TIMEOUT);
  const third = createEngineMemory({ storage, now: () => 3000, appVersion: '1.9.2' });
  assert.equal(third.isNativeDemoted(), true);
  assert.equal(third.peek().strikes, NATIVE_STRIKES_TO_PERSIST);
});

test('strikes count launches: repeated failures in one session add a single strike', () => {
  const storage = memStorage();
  const session = createEngineMemory({ storage, now: () => 1000, appVersion: '1.9.2' });
  session.recordNativeFailure(NATIVE_ERROR.START_FAILED);
  session.recordNativeFailure(NATIVE_ERROR.START_FAILED);
  session.recordNativeFailure(NATIVE_ERROR.START_TIMEOUT);
  assert.equal(session.peek().strikes, 1);
  assert.equal(createEngineMemory({ storage, now: () => 2000, appVersion: '1.9.2' }).isNativeDemoted(), false);
});

test('a structural failure later in the same session still persists', () => {
  const storage = memStorage();
  const session = createEngineMemory({ storage, now: () => 1000, appVersion: '1.9.2' });
  session.recordNativeFailure(NATIVE_ERROR.START_FAILED);
  session.recordNativeFailure(NATIVE_ERROR.DECODER_FAILED);
  assert.deepEqual(session.peek(), { at: 1000, version: '1.9.2', reason: NATIVE_ERROR.DECODER_FAILED, strikes: 1 });
  assert.equal(createEngineMemory({ storage, now: () => 2000, appVersion: '1.9.2' }).isNativeDemoted(), true);
  // …and a later ambiguous failure in that session does not downgrade it.
  session.recordNativeFailure(NATIVE_ERROR.START_FAILED);
  assert.equal(session.peek().reason, NATIVE_ERROR.DECODER_FAILED);
});

test('a structural failure is remembered across restarts at once', () => {
  for (const code of [NATIVE_ERROR.DECODER_FAILED, NATIVE_ERROR.UNAVAILABLE]) {
    const storage = memStorage();
    createEngineMemory({ storage, now: () => 1000, appVersion: '1.9.2' }).recordNativeFailure(code);
    assert.equal(createEngineMemory({ storage, now: () => 2000, appVersion: '1.9.2' }).isNativeDemoted(), true, code);
  }
});

test('a native success clears both the session and the stored record', () => {
  const storage = memStorage();
  const memory = createEngineMemory({ storage, appVersion: '1.9.2' });
  memory.recordNativeFailure(NATIVE_ERROR.DECODER_FAILED);
  memory.restoreNative();
  assert.equal(memory.isNativeDemoted(), false);
  assert.equal(storage.map.has(ENGINE_MEMORY_KEY), false);
  // The strike count starts over after a success.
  memory.recordNativeFailure(NATIVE_ERROR.START_FAILED);
  assert.equal(memory.peek().strikes, 1);
});

test('an app update re-probes native and restarts the strike count', () => {
  const storage = memStorage();
  const old = createEngineMemory({ storage, now: () => 1000, appVersion: '1.9.2' });
  old.recordNativeFailure(NATIVE_ERROR.DECODER_FAILED);
  assert.equal(createEngineMemory({ storage, now: () => 2000, appVersion: '1.9.2' }).isNativeDemoted(), true);
  const updated = createEngineMemory({ storage, now: () => 2000, appVersion: '1.9.3' });
  assert.equal(updated.isNativeDemoted(), false);
  updated.recordNativeFailure(NATIVE_ERROR.START_FAILED);
  assert.deepEqual(updated.peek(), { at: 2000, version: '1.9.3', reason: NATIVE_ERROR.START_FAILED, strikes: 1 });
});

test('without a build version the memory still expires on its TTL', () => {
  const storage = memStorage();
  let now = 0;
  createEngineMemory({ storage, now: () => now, ttlMs: 500 }).recordNativeFailure(NATIVE_ERROR.DECODER_FAILED);
  const later = createEngineMemory({ storage, now: () => now, ttlMs: 500 });
  now = 499;
  assert.equal(later.isNativeDemoted(), true);
  now = 501;
  assert.equal(later.isNativeDemoted(), false);
});

test('records from before strike counting are treated as a single strike', () => {
  const legacy = JSON.stringify({ at: 1000, version: '1.9.2', reason: NATIVE_ERROR.START_TIMEOUT });
  const storage = memStorage({ [ENGINE_MEMORY_KEY]: legacy });
  const memory = createEngineMemory({ storage, now: () => 2000, appVersion: '1.9.2' });
  assert.equal(memory.isNativeDemoted(), false);
  memory.recordNativeFailure(NATIVE_ERROR.START_TIMEOUT);
  assert.equal(memory.peek().strikes, 2);
  const structural = memStorage({ [ENGINE_MEMORY_KEY]: JSON.stringify({ at: 1000, version: '1.9.2', reason: NATIVE_ERROR.DECODER_FAILED }) });
  assert.equal(createEngineMemory({ storage: structural, now: () => 2000, appVersion: '1.9.2' }).isNativeDemoted(), true);
});

test('corrupt or missing storage never blocks the native attempt or throws', () => {
  const corrupt = createEngineMemory({ storage: memStorage({ [ENGINE_MEMORY_KEY]: '{not json' }) });
  assert.equal(corrupt.isNativeDemoted(), false);
  const wrongShape = createEngineMemory({ storage: memStorage({ [ENGINE_MEMORY_KEY]: '"string"' }) });
  assert.equal(wrongShape.isNativeDemoted(), false);
  const none = createEngineMemory({ storage: null });
  assert.equal(none.isNativeDemoted(), false);
  assert.doesNotThrow(() => none.recordNativeFailure('x'));
  // No storage: the session layer still keeps the retry loop from repeating.
  assert.equal(none.isNativeDemoted(), true);
  assert.doesNotThrow(() => none.restoreNative());
  assert.equal(none.isNativeDemoted(), false);
  const throwing = createEngineMemory({
    storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } },
  });
  assert.equal(throwing.isNativeDemoted(), false);
  assert.doesNotThrow(() => throwing.recordNativeFailure('x'));
  assert.doesNotThrow(() => throwing.restoreNative());
});
