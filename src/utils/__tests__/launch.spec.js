import assert from 'node:assert/strict';
import { test } from 'node:test';

// Each test loads a fresh copy: the launch is once per session (module state).
let copy = 0;
const fresh = () => import(`../launch.js?copy=${++copy}`);

test('the first home screen claims the launch once; coming back home does not replay it', async () => {
  globalThis.window = {};
  const launch = await fresh();
  assert.equal(launch.claimLaunch(), true);
  assert.equal(launch.isLaunchClaimed(), true);
  assert.equal(launch.claimLaunch(), false);
});

test('a launch already released (the app opened elsewhere) is never claimed', async () => {
  globalThis.window = {};
  globalThis.document = { getElementById: () => ({ remove() { globalThis.removed = true; } }) };
  const launch = await fresh();
  await launch.releaseLaunch();
  assert.equal(globalThis.removed, true, 'the launch frame goes');
  assert.equal(launch.claimLaunch(), false);
  assert.equal(launch.releaseLaunch(), launch.releaseLaunch(), 'released exactly once');
  delete globalThis.document;
});

test('the screenshot harness gets the launch only when it asks for it', async () => {
  globalThis.window = { __AUDIT__: { theme: 'light' } };
  assert.equal((await fresh()).claimLaunch(), false);
  globalThis.window = { __AUDIT__: { theme: 'light', launch: true } };
  assert.equal((await fresh()).claimLaunch(), true);
});
