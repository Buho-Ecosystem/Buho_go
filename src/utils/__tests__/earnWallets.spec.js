/** Learn & Earn payout-wallet eligibility tests. */

import { strict as assert } from 'node:assert';
import {
  findEarnPayoutWallet,
  getEarnPayoutWallets,
  isEarnPayoutWallet,
} from '../earnWallets.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

const wallets = [
  { id: 'spark', type: 'spark' },
  { id: 'arkade', type: 'Arkade' },
  { id: 'lnbits', type: 'lnbits' },
  { id: 'nwc', type: 'nwc' },
];

test('Arkade is never an eligible Learn & Earn payout wallet', () => {
  assert.equal(isEarnPayoutWallet(wallets[1]), false);
  assert.deepEqual(getEarnPayoutWallets(wallets).map((wallet) => wallet.id), ['spark', 'lnbits', 'nwc']);
});

test('a saved Arkade selection is rejected instead of redirected', () => {
  assert.equal(findEarnPayoutWallet(wallets, 'arkade'), null);
  assert.equal(findEarnPayoutWallet(wallets, 'spark')?.id, 'spark');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
