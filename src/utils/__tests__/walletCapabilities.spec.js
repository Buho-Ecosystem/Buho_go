/**
 * walletCapabilities — capability-matrix tests.
 *
 * Coverage focus:
 *   - both vocabularies (send-pipeline payment types and address-book
 *     addressTypes) collapse to the same rail
 *   - the wallet × rail matrix matches the product rules (Spark-only,
 *     Arkade-only, on-chain via Spark or Arkade, Lightning everywhere)
 *   - hints exist exactly for the rails that can be blocked
 *
 * Run directly with Node:
 *   node src/utils/__tests__/walletCapabilities.spec.js
 */

import { strict as assert } from 'node:assert';
import {
  destinationKind,
  canWalletPay,
  walletSwitchHint,
} from '../walletCapabilities.js';

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

const t = (key) => key; // identity translate — assert on the English key

test('both vocabularies collapse to the same rail', () => {
  assert.equal(destinationKind('spark'), 'spark');
  assert.equal(destinationKind('spark_address'), 'spark');
  assert.equal(destinationKind('arkade'), 'arkade');
  assert.equal(destinationKind('arkade_address'), 'arkade');
  assert.equal(destinationKind('bitcoin'), 'bitcoin');
  assert.equal(destinationKind('bitcoin_address'), 'bitcoin');
});

test('lightning is the permissive default rail', () => {
  for (const type of [
    'lightning', 'lnurl', 'lightning_address', 'lightning_invoice',
    'phone_number', 'bip21', 'unknown', undefined, null, '',
  ]) {
    assert.equal(destinationKind(type), 'lightning', `type: ${type}`);
  }
});

test('wallet × rail matrix', () => {
  const WALLETS = ['spark', 'arkade', 'lnbits', 'nwc'];
  const expectations = {
    spark_address: { spark: true, arkade: false, lnbits: false, nwc: false },
    arkade_address: { spark: false, arkade: true, lnbits: false, nwc: false },
    bitcoin_address: { spark: true, arkade: true, lnbits: false, nwc: false },
    lightning_address: { spark: true, arkade: true, lnbits: true, nwc: true },
  };
  for (const [type, byWallet] of Object.entries(expectations)) {
    for (const wallet of WALLETS) {
      assert.equal(
        canWalletPay(wallet, type),
        byWallet[wallet],
        `${wallet} × ${type}`,
      );
    }
  }
});

test('contact addressTypes gate identically to payment types', () => {
  assert.equal(canWalletPay('nwc', 'spark'), canWalletPay('nwc', 'spark_address'));
  assert.equal(canWalletPay('spark', 'bitcoin'), canWalletPay('spark', 'bitcoin_address'));
  assert.equal(canWalletPay('lnbits', 'lnurl'), true);
});

test('switch hints exist exactly for blockable rails', () => {
  assert.equal(walletSwitchHint('spark_address', t), 'Switch to your Spark wallet to pay this address');
  assert.equal(walletSwitchHint('arkade', t), 'Switch to your Arkade wallet to pay this address');
  assert.equal(walletSwitchHint('bitcoin_address', t), 'Switch to a Spark or Arkade wallet to send Bitcoin');
  assert.equal(walletSwitchHint('lightning_address', t), '');
  assert.equal(walletSwitchHint('unknown', t), '');
});

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
