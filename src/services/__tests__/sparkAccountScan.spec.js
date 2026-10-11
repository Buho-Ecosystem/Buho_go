import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanSparkAccounts } from '../sparkAccountScan.js';

const evidence = (extra = {}) => ({ balanceSats: 0, paymentCount: 0, hasUnclaimedDeposit: false, lightningAddress: null, synced: true, ...extra });

test('each account is classified: used, empty, or not yet known', async () => {
  const answers = { 2: evidence({ paymentCount: 1 }), 3: evidence(), 4: evidence({ synced: false }), 5: new Error('offline') };
  const results = await scanSparkAccounts('words', {
    accounts: [2, 3, 4, 5],
    probe: async (_m, { accountNumber }) => { const a = answers[accountNumber]; if (a instanceof Error) throw a; return a; },
  });
  assert.deepEqual(results.map(r => [r.accountNumber, r.conclusive, r.used]), [[2, true, true], [3, true, false], [4, false, false], [5, false, false]]);
});

test('probes run a few at a time and report progress over the whole set', async () => {
  let running = 0, peak = 0;
  const progress = [];
  await scanSparkAccounts('words', {
    accounts: [1, 2, 3, 4, 5, 0],
    concurrency: 2,
    onProgress: p => progress.push(`${p.done}/${p.total}`),
    probe: async () => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 2)); running--; return evidence(); },
  });
  assert.equal(peak, 2);
  assert.deepEqual(progress, ['0/6', '1/6', '2/6', '3/6', '4/6', '5/6', '6/6']);
});

test('an empty list scans nothing', async () => {
  assert.deepEqual(await scanSparkAccounts('words', { accounts: [], probe: async () => { throw new Error('never'); } }), []);
});
