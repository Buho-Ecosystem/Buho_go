import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import {
  deriveExitAddresses, deriveAllFundingAddresses, deriveFundingKey, p2wpkhAddress, parseBitcoinAddress, classifyDestination, exitKeyPath, exitKeyIndices, exitKeyPaths,
} from '../exitKeys.js';
import { SPARK_ACCOUNT_ORDER } from '../sparkAccounts.js';

// BIP-84 reference vectors (bitcoin/bips, bip-0084.mediawiki).
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FIRST = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const SECOND = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
const FIRST_PUBKEY = '0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c';

/** An address straight from the BIP-84 receive chain, without the module's mapping. */
function receiveAddress(index, network = 'mainnet') {
  const coin = network === 'mainnet' ? 0 : 1;
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(MNEMONIC)).derive(`m/84'/${coin}'/0'/0/${index}`);
  return p2wpkhAddress(node.publicKey, network);
}

test('account 1 keeps BIP-84 receive indexes 0 and 1, the addresses every exit used before', () => {
  const keys = deriveExitAddresses(MNEMONIC, { accountNumber: 1 });
  assert.equal(keys.destination.address, FIRST);
  assert.equal(keys.destination.path, "m/84'/0'/0'/0/0");
  assert.equal(keys.funding.address, SECOND);
  assert.equal(keys.funding.path, "m/84'/0'/0'/0/1");
  assert.equal(exitKeyPath('regtest', 0), "m/84'/1'/0'/0/0");
});

test('every account owns its own pair on the receive chain, inside the gap limit', () => {
  const seen = new Set();
  for (const account of SPARK_ACCOUNT_ORDER) {
    const { destination, funding } = exitKeyIndices(account);
    for (const index of [destination, funding]) {
      assert.ok(index < 20, `index ${index} is found by a standard gap-limit scan`);
      assert.ok(!seen.has(index), `index ${index} belongs to one account only`);
      seen.add(index);
    }
    const keys = deriveExitAddresses(MNEMONIC, { accountNumber: account });
    assert.equal(keys.destination.address, receiveAddress(destination));
    assert.equal(keys.funding.address, receiveAddress(funding));
    assert.deepEqual(exitKeyPaths('mainnet', account), { destination: keys.destination.path, funding: keys.funding.path });
  }
  assert.deepEqual(exitKeyIndices(2), { destination: 2, funding: 3 });
  assert.deepEqual(exitKeyIndices(5), { destination: 8, funding: 9 });
  assert.deepEqual(exitKeyIndices(0), { destination: 10, funding: 11 });
  assert.equal(deriveExitAddresses(MNEMONIC, { network: 'regtest', accountNumber: 2 }).funding.address, receiveAddress(3, 'regtest'));
});

test('an exit never derives without a valid account', () => {
  for (const bad of [undefined, null, 6, -1, 1.5, '1']) {
    assert.throws(() => deriveExitAddresses(MNEMONIC, { accountNumber: bad }), /Unsupported Spark account/);
  }
});

test('every fee money address under the words is known, one per account', () => {
  const all = deriveAllFundingAddresses(MNEMONIC);
  assert.equal(all.length, SPARK_ACCOUNT_ORDER.length);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.includes(SECOND), 'account 1 fee money is the original address');
  assert.ok(!all.includes(FIRST), 'destinations are not fee money');
});

test('the fee money key is a 32-byte secret whose public key matches its address', () => {
  const funding = deriveFundingKey(MNEMONIC, { path: exitKeyPath('mainnet', 1) });
  assert.equal(funding.privateKey.length, 32);
  assert.equal(funding.address, SECOND);
  assert.match(funding.publicKeyHex, /^0[23][0-9a-f]{64}$/);
  assert.equal(p2wpkhAddress(Uint8Array.from(Buffer.from(FIRST_PUBKEY, 'hex'))), FIRST);
  assert.equal(deriveFundingKey(MNEMONIC, { path: exitKeyPaths('mainnet', 3).funding }).address, receiveAddress(5));
});

test('signing derives only from a fee money path the app hands out', () => {
  for (const path of [undefined, exitKeyPath('mainnet', 0), exitKeyPath('mainnet', 12), "m/84'/0'/1'/0/1", "m/44'/0'/0'/0/1", exitKeyPath('regtest', 1)]) {
    assert.throws(() => deriveFundingKey(MNEMONIC, { path }), /Unknown fee money path/, String(path));
  }
  assert.equal(deriveFundingKey(MNEMONIC, { network: 'regtest', path: exitKeyPath('regtest', 1) }).address, receiveAddress(1, 'regtest'));
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

test('the destination refuses any exit\'s fee money address', () => {
  const feeAddresses = deriveAllFundingAddresses(MNEMONIC);
  for (const address of feeAddresses) {
    assert.deepEqual(classifyDestination(address.toUpperCase(), { feeAddresses }), { ok: false, reason: 'exit_funding' });
  }
  assert.equal(classifyDestination(FIRST, { feeAddresses }).ok, true);
});
