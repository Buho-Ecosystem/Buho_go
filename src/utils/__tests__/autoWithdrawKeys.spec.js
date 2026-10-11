import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migratePocketConfigKeys } from '../autoWithdrawKeys.js';

const spark = (id, accountNumber, envelope = 'env-1') => ({ id, type: 'spark', connectionData: { accountNumber, encryptedMnemonic: envelope } });

test('a rule saved for a former pocket moves to the wallet holding that account now, switched off', () => {
  const wallets = [spark('parent', 1), spark('pocket-wallet', 2), spark('other-phrase', 2, 'env-2'), { id: 'nwc', type: 'nwc' }];
  const rule = { enabled: true, thresholdSats: 5000 };
  const { configs, moved, dropped } = migratePocketConfigKeys({ 'parent:2': rule, parent: { enabled: false }, nwc: { enabled: true } }, wallets);
  assert.deepEqual(Object.keys(configs).sort(), ['nwc', 'parent', 'pocket-wallet']);
  assert.deepEqual(configs['pocket-wallet'], { enabled: false, thresholdSats: 5000 }, 'a dormant rule never starts sending by itself');
  assert.equal(rule.enabled, true, 'the saved rule is not mutated');
  assert.deepEqual(moved, ['parent:2']);
  assert.deepEqual(dropped, []);
});

test('rules no wallet can run are dropped, and a rule already on the new wallet wins', () => {
  const wallets = [spark('parent', 1), spark('pocket-wallet', 2)];
  const kept = { enabled: true, thresholdSats: 1 };
  const result = migratePocketConfigKeys({ 'gone:2': {}, 'parent:5': {}, 'parent:2': { enabled: true, thresholdSats: 9 }, 'pocket-wallet': kept }, wallets);
  assert.equal(result.configs['pocket-wallet'], kept);
  assert.deepEqual(result.dropped.sort(), ['gone:2', 'parent:2', 'parent:5']);
});

test('nothing to migrate leaves the rules as they are', () => {
  const configs = { a: { enabled: true } };
  assert.deepEqual(migratePocketConfigKeys(configs, [spark('a', 1)]), { configs, moved: [], dropped: [] });
});
