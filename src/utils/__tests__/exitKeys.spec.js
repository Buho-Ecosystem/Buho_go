import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deriveExitAddresses, deriveFundingKey, p2wpkhAddress, parseBitcoinAddress, classifyDestination, exitKeyPath,
} from '../exitKeys.js';

// BIP-84 reference vectors (bitcoin/bips, bip-0084.mediawiki).
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FIRST = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const SECOND = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
const FIRST_PUBKEY = '0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c';

test('destination and fee money addresses follow BIP-84 receive indexes 0 and 1', () => {
  const keys = deriveExitAddresses(MNEMONIC);
  assert.equal(keys.destination.address, FIRST);
  assert.equal(keys.destination.path, "m/84'/0'/0'/0/0");
  assert.equal(keys.funding.address, SECOND);
  assert.equal(keys.funding.path, "m/84'/0'/0'/0/1");
  assert.equal(exitKeyPath('regtest', 0), "m/84'/1'/0'/0/0");
});

test('the fee money key is a 32-byte secret whose public key matches its address', () => {
  const funding = deriveFundingKey(MNEMONIC);
  assert.equal(funding.privateKey.length, 32);
  assert.equal(funding.address, SECOND);
  assert.match(funding.publicKeyHex, /^0[23][0-9a-f]{64}$/);
  assert.equal(p2wpkhAddress(Uint8Array.from(Buffer.from(FIRST_PUBKEY, 'hex'))), FIRST);
});

test('only plain Bitcoin addresses are recognised', () => {
  assert.deepEqual(parseBitcoinAddress(FIRST), { address: FIRST, type: 'p2wpkh', network: 'mainnet' });
  assert.equal(parseBitcoinAddress(FIRST.toUpperCase()).address, FIRST);
  assert.equal(parseBitcoinAddress('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr').type, 'p2tr');
  assert.equal(parseBitcoinAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2').type, 'p2pkh');
  assert.equal(parseBitcoinAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy').type, 'p2sh');
  assert.equal(parseBitcoinAddress('bcrt1qcr8te4kr609gcawutmrza0j4xv80jy8zzqfy5k')?.network, undefined);
  for (const bad of ['', 'alice@example.com', 'spark1pgssxvvv', 'lnbc1pjxyz', FIRST.slice(0, -1) + 'x', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyU']) {
    assert.equal(parseBitcoinAddress(bad), null, bad);
  }
});

test('the destination refuses other networks and the wallet’s own Spark deposit address', () => {
  const deposit = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
  assert.deepEqual(classifyDestination(` ${FIRST} `, { excluded: [deposit] }), { ok: true, address: FIRST, type: 'p2wpkh' });
  assert.deepEqual(classifyDestination(deposit, { excluded: [deposit.toUpperCase()] }), { ok: false, reason: 'spark_deposit' });
  assert.deepEqual(classifyDestination(FIRST, { network: 'regtest' }), { ok: false, reason: 'wrong_network' });
  assert.deepEqual(classifyDestination('alice@example.com'), { ok: false, reason: 'not_onchain' });
});
