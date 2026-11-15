/** The on-demand fetch of the contact payment pipeline (the wallet page). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadContactPaymentPipeline, preloadContactPaymentPipeline } from '../contactPaymentPipeline.js';

// Node cannot load a .vue file, so every fetch here fails: exactly the case
// the module has to survive (the web app, offline).
test('a fetch that failed is not remembered: the next tap tries again', async () => {
  const first = loadContactPaymentPipeline();
  assert.equal(loadContactPaymentPipeline(), first, 'one fetch while it is under way');
  await assert.rejects(first);
  const second = loadContactPaymentPipeline();
  assert.notEqual(second, first);
  await assert.rejects(second);
});

test('warming up never throws and leaves no unhandled rejection', async () => {
  const unhandled = [];
  const note = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', note);
  try {
    assert.equal(preloadContactPaymentPipeline(), undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', note);
  }
});
