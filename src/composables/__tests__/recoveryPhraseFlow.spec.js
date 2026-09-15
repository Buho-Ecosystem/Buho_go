import { strict as assert } from 'node:assert';
import { useRecoveryPhraseFlow } from '../useRecoveryPhraseFlow.js';

const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const make = (overrides = {}) => useRecoveryPhraseFlow({ load: async () => phrase, save: async () => {}, authorize: async () => true, ...overrides });

// Cancellation must not decrypt or populate a reopened dialog from an old request.
const auth = deferred();
let loads = 0;
const cancelled = make({ authorize: () => auth.promise, load: async () => { loads++; return phrase; } });
const opening = cancelled.start();
cancelled.reset();
auth.resolve(true);
await opening;
assert.equal(loads, 0);
assert.deepEqual(cancelled.words.value, []);

const pendingLoad = deferred();
const closed = make({ load: () => pendingLoad.promise });
const loading = closed.start();
await Promise.resolve();
closed.reset();
pendingLoad.resolve(phrase);
await loading;
assert.deepEqual(closed.words.value, []);
assert.equal(closed.step.value, 'prepare');

// Authentication failure is retryable, with no secret loaded.
let allowed = false;
const retryAuth = make({ authorize: async () => allowed });
await retryAuth.start();
assert.equal(retryAuth.error.value, 'auth');
assert.deepEqual(retryAuth.words.value, []);
allowed = true;
await retryAuth.start();
assert.equal(retryAuth.step.value, 'write');
assert.equal(retryAuth.visible.value, false);
retryAuth.check();
assert.equal(retryAuth.step.value, 'write', 'checking requires deliberate reveal');
retryAuth.reset();

// Do not claim completion after failed persistence; allow retry on the same check.
let attempts = 0;
let verified = 0;
const flow = make({ save: async () => { if (++attempts === 1) throw new Error('disk full'); }, onVerified: () => verified++ });
await flow.start();
flow.reveal();
flow.check();
await flow.confirm();
assert.equal(flow.step.value, 'check');
assert.equal(flow.error.value, 'save');
assert.equal(verified, 0);
await flow.confirm();
assert.equal(flow.step.value, 'done');
assert.equal(verified, 1);
assert.deepEqual(flow.words.value, []);
flow.reset();

// Repeated confirm taps cannot submit a second persistence operation.
const saving = deferred();
let saves = 0;
const single = make({ save: () => { saves++; return saving.promise; } });
await single.start(); single.reveal(); single.check();
const firstSave = single.confirm();
await single.confirm();
assert.equal(saves, 1);
saving.resolve(); await firstSave; single.reset();

// Back conceals the phrase; expiration conceals it without changing backup state.
const timed = make({ duration: 1 });
await timed.start(); timed.reveal(); timed.check(); timed.back();
assert.equal(timed.step.value, 'write');
assert.equal(timed.visible.value, false);
timed.reveal();
await new Promise(resolve => setTimeout(resolve, 1100));
assert.equal(timed.visible.value, false);
assert.equal(timed.step.value, 'write');
timed.reset();
console.log('recoveryPhraseFlow: cancellation, authentication, retries, double-submit and concealment passed');
