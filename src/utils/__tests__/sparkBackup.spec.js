import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sparkAccountsForBackup, sparkAccountsFromBackup, sparkNetworkFromBackup } from '../sparkBackup.js';

const spark = (accountNumber, name, metadata = {}) => ({ id: `s${accountNumber}`, type: 'spark', name, connectionData: { accountNumber }, metadata });

test('the backup lists every Spark wallet once, in account order, with its name and address', () => {
  const list = sparkAccountsForBackup([
    spark(0, 'Old one', { lud16: 'old@btc.example.com', sparkAddress: 'spark1old' }),
    { id: 'n', type: 'nwc', name: 'Alby' },
    spark(1, '  Main  ', { lud16: 'not an address' }),
    spark(3, 'Shop'),
  ]);
  assert.deepEqual(list, [
    { accountNumber: 1, name: 'Main', lud16: null, sparkAddress: null },
    { accountNumber: 3, name: 'Shop', lud16: null, sparkAddress: null },
    { accountNumber: 0, name: 'Old one', lud16: 'old@btc.example.com', sparkAddress: 'spark1old' },
  ]);
});

test('a restore reads the listed wallets and rejects anything malformed', () => {
  const payload = { spark: { accounts: [
    { accountNumber: 2, name: ' Savings ' }, { accountNumber: 2, name: 'Duplicate' }, { accountNumber: 7, name: 'Out of range' },
    { accountNumber: '1', name: 'String account' }, { accountNumber: 1, name: 42 }, { accountNumber: 0, name: 'x'.repeat(40) }, null,
  ] } };
  assert.deepEqual(sparkAccountsFromBackup(payload), [
    { accountNumber: 1, name: '' }, { accountNumber: 2, name: 'Savings' }, { accountNumber: 0, name: '' },
  ]);
});

test('an older backup is read through its exit kits; without either, the restore scans', () => {
  const older = { spark: { mnemonic: 'm' }, exitKits: [{ accountNumber: 2, sparkAddress: 'a' }, { accountNumber: 1, sparkAddress: 'b' }, { accountNumber: null }] };
  assert.deepEqual(sparkAccountsFromBackup(older), [{ accountNumber: 1, name: '' }, { accountNumber: 2, name: '' }]);
  assert.deepEqual(sparkAccountsFromBackup({ spark: { mnemonic: 'm' } }), []);
  assert.deepEqual(sparkAccountsFromBackup(null), []);
  assert.deepEqual(sparkAccountsFromBackup({ spark: { accounts: [] }, exitKits: [{ accountNumber: 1 }] }), [], 'an explicit empty list wins');
});

test('only known networks are restored', () => {
  assert.equal(sparkNetworkFromBackup({ network: 'regtest' }), 'REGTEST');
  assert.equal(sparkNetworkFromBackup({ network: 'SIGNET' }), 'MAINNET');
  assert.equal(sparkNetworkFromBackup(undefined), 'MAINNET');
});
