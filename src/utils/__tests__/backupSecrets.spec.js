import assert from 'node:assert/strict';
import { test } from 'node:test';
import { payloadSecrets, droppedSecrets } from '../backupSecrets.js';

const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('fingerprints identify a phrase without revealing it', () => {
  const [spark] = payloadSecrets({ spark: { mnemonic: words } });
  assert.match(spark, /^spark:[0-9a-f]{32}$/);
  assert.ok(!spark.includes('abandon'));
  assert.deepEqual(payloadSecrets({ spark: { mnemonic: ` ${words.toUpperCase()} ` } }), [spark], 'case and spacing do not matter');
  assert.deepEqual(payloadSecrets({}), []);
});

test('a phrase is dropped when the next payload no longer holds it or holds another one', () => {
  const remote = { spark: { mnemonic: words }, identity: { mnemonic: 'zoo zoo zoo' } };
  assert.deepEqual(droppedSecrets(remote, remote), []);
  assert.equal(droppedSecrets(remote, { identity: { mnemonic: 'zoo zoo zoo' } }).length, 1);
  assert.equal(droppedSecrets(remote, { spark: { mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow' }, identity: { mnemonic: 'zoo zoo zoo' } }).length, 1);
  assert.deepEqual(droppedSecrets(null, { spark: { mnemonic: words } }), []);
});
