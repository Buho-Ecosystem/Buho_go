import '../../__tests__/memoryStorage.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExitDriver, ExitError } from '../emergencyExit.js';
import { isActive } from '../../utils/exitLedger.js';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const DESTINATION = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const FUNDING = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
const CHAIN = [
  { kind: 'fanOut', txid: 'F', txHex: 'f', dependsOn: [], status: 'unconfirmed' },
  { kind: 'node', txid: 'N', txHex: 'n', cpfpTxHex: 'nc', dependsOn: ['F'], status: 'unconfirmed' },
  { kind: 'refund', txid: 'R', txHex: 'r', cpfpTxHex: 'rc', csvTimelockBlocks: 100, dependsOn: ['N'], status: 'unconfirmed' },
  { kind: 'sweep', txid: 'S', txHex: 's', dependsOn: ['R'], status: 'unconfirmed' },
];

function harness({ recoverable = 89700, fundingSat = 8500 } = {}) {
  const chain = { tip: 1000, statuses: {}, utxos: [], broadcasts: [], fees: { medium: 4, slow: 2 } };
  const provider = {
    isConnected: true, calls: { prepare: [], build: [] },
    async prepareUnilateralExit(request) {
      provider.calls.prepare.push(request);
      return { recoverableValueSat: recoverable, totalFeeSat: 8800, fanoutFeeSat: 300, singleUtxoFundingSat: fundingSat, feeRateSatPerVbyte: request.feeRateSatPerVbyte, destination: request.destination, leaves: recoverable ? [{ leafId: 'a', value: 50000 }, { leafId: 'b', value: 39700 }] : [] };
    },
    async buildUnilateralExit(request) { provider.calls.build.push(request); return { recoverableValueSat: recoverable, totalFeeSat: 8800, leaves: [{ leafId: 'a' }, { leafId: 'b' }], transactions: CHAIN }; },
    async getBalanceSatsLocal() { return 99600; },
  };
  const exits = {};
  const ledger = { exitFor: id => exits[id] || null, set: exit => (exits[exit.walletId] = exit), remove: id => { delete exits[id]; }, get activeExits() { return Object.values(exits).filter(isActive); } };
  const reminders = { scheduled: [], cancelled: [], async schedule(args) { this.scheduled.push(args); return true; }, async cancel(id) { this.cancelled.push(id); } };
  const esplora = {
    async recommendedFees() { return chain.fees; },
    async utxos() { return chain.utxos; },
    async tipHeight() { if (chain.tipError) throw new Error(chain.tipError); return chain.tip; },
    async txStatus(txid) { return chain.statuses[txid] || { known: false, confirmed: false }; },
    async broadcastPackage(hexes) { chain.broadcasts.push(hexes); return {}; },
    async broadcastTx(hex) { chain.broadcasts.push([hex]); return 'ok'; },
  };
  let clock = 1_700_000_000_000;
  const signers = [];
  const driver = createExitDriver({
    getWallet: id => (id === 'w1' ? { id: 'w1', name: 'Personal', connectionData: { network: 'MAINNET' } } : null),
    getProvider: id => (id === 'w1' ? provider : null),
    getMnemonic: async () => MNEMONIC,
    ledger, esplora, reminders,
    createSigner: async key => { signers.push(key); return { signPsbt: async b => b }; },
    now: () => clock,
  });
  return { driver, provider, chain, ledger, reminders, signers, exits, tick: ms => { clock += ms; } };
}

test('start quotes at the medium fee tier, derives both addresses from the words, and is idempotent', async () => {
  const h = harness();
  const exit = await h.driver.start('w1');
  assert.equal(exit.stage, 'fund');
  assert.equal(exit.destination.address, DESTINATION);
  assert.equal(exit.destination.source, 'derived');
  assert.equal(exit.funding.address, FUNDING);
  assert.equal(exit.funding.requiredSat, 8500);
  assert.equal(h.provider.calls.prepare[0].feeRateSatPerVbyte, 4);
  assert.equal(await h.driver.start('w1'), exit);
  await assert.rejects(() => harness({ recoverable: 0 }).driver.start('w1'), error => error instanceof ExitError && error.code === 'NOTHING_TO_EXIT');
});

test('a custom destination re-quotes and must be a plain Bitcoin address', async () => {
  const h = harness();
  await h.driver.start('w1');
  const custom = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
  const exit = await h.driver.setDestination('w1', custom);
  assert.deepEqual(exit.destination, { address: custom, source: 'custom' });
  assert.equal(h.provider.calls.prepare.at(-1).destination, custom);
  await assert.rejects(() => h.driver.setDestination('w1', 'alice@example.com'), error => error.code === 'DESTINATION_NOT_ONCHAIN');
  await assert.rejects(() => h.driver.setDestination('w1', custom, { excluded: [custom] }), error => error.code === 'DESTINATION_SPARK_DEPOSIT');
});

test('fee money is watched until confirmed, and the exit can be cancelled until it is signed', async () => {
  const h = harness();
  await h.driver.start('w1');
  h.chain.utxos = [{ txid: 'fee', vout: 0, value: 9000, confirmed: false }];
  assert.equal((await h.driver.tick('w1')).stage, 'fund');
  await assert.rejects(() => h.driver.confirmSend('w1'), error => error.code === 'NOT_READY');
  h.chain.utxos = [{ txid: 'fee', vout: 0, value: 9000, confirmed: true }];
  assert.equal((await h.driver.tick('w1')).stage, 'ready');
  await h.driver.cancel('w1');
  assert.equal(h.ledger.exitFor('w1'), null);
  assert.deepEqual(h.reminders.cancelled, ['w1']);
});

test('confirming signs with the fee money key and walks the chain to done', async () => {
  const h = harness();
  await h.driver.start('w1');
  h.chain.utxos = [{ txid: 'fee', vout: 0, value: 9000, confirmed: true }];
  await h.driver.tick('w1');
  let exit = await h.driver.confirmSend('w1');
  assert.equal(h.signers.length, 1);
  assert.equal(h.signers[0].length, 32);
  const build = h.provider.calls.build[0];
  assert.deepEqual(build.fundingInputs, [{ type: 'p2wpkh', txid: 'fee', vout: 0, value: 9000, pubkey: exit.funding.publicKeyHex }]);
  assert.deepEqual(h.provider.calls.prepare.at(-1).selection, { type: 'specific', leafIds: ['a', 'b'] });
  assert.equal(exit.stage, 'send');
  assert.deepEqual(h.chain.broadcasts, [['f']]);
  await assert.rejects(() => h.driver.cancel('w1'), error => error.code === 'LOCKED');

  h.chain.statuses.F = { known: true, confirmed: true, blockHeight: 1001 };
  h.chain.tip = 1001;
  exit = await h.driver.tick('w1');
  assert.deepEqual(h.chain.broadcasts.at(-1), ['n', 'nc']);
  assert.equal(exit.stage, 'send');

  h.chain.statuses.N = { known: true, confirmed: true, blockHeight: 1002 };
  h.chain.tip = 1002;
  exit = await h.driver.tick('w1');
  assert.equal(exit.stage, 'unlock');
  assert.equal(exit.unlock.height, 1102);
  assert.equal(h.reminders.scheduled.length, 1);
  assert.equal(h.reminders.scheduled[0].at, exit.unlock.estimatedAt);
  assert.equal(exit.reminderAt, exit.unlock.estimatedAt);
  assert.equal(h.chain.broadcasts.length, 2);

  h.chain.tip = 1101;
  exit = await h.driver.tick('w1');
  assert.deepEqual(h.chain.broadcasts.at(-1), ['r', 'rc']);
  assert.equal(h.reminders.scheduled.length, 1);

  h.chain.statuses.R = { known: true, confirmed: true, blockHeight: 1102 };
  h.chain.tip = 1102;
  exit = await h.driver.tick('w1');
  assert.deepEqual(h.chain.broadcasts.at(-1), ['s']);
  assert.equal(exit.stage, 'sweep');

  h.chain.statuses.S = { known: true, confirmed: true, blockHeight: 1103 };
  h.chain.tip = 1103;
  exit = await h.driver.tick('w1');
  assert.equal(exit.stage, 'done');
  assert.deepEqual(h.reminders.cancelled, ['w1']);
  assert.equal(h.ledger.activeExits.length, 0);
});

test('a chain outage is recorded and the next pass recovers; higher fees send the exit back for more fee money', async () => {
  const h = harness();
  await h.driver.start('w1');
  h.chain.utxos = [{ txid: 'fee', vout: 0, value: 9000, confirmed: true }];
  await h.driver.tick('w1');
  await h.driver.confirmSend('w1');
  h.chain.tipError = 'esplora down';
  let exit = await h.driver.tick('w1');
  assert.equal(exit.lastError, 'esplora down');
  assert.equal(exit.attempts, 1);
  assert.equal(exit.stage, 'send');
  h.chain.tipError = null;
  exit = await h.driver.tick('w1');
  assert.equal(exit.lastError, null);

  const pricier = harness({ fundingSat: 8500 });
  await pricier.driver.start('w1');
  pricier.chain.utxos = [{ txid: 'fee', vout: 0, value: 8600, confirmed: true }];
  await pricier.driver.tick('w1');
  pricier.provider.prepareUnilateralExit = async request => ({ recoverableValueSat: 89700, totalFeeSat: 12000, singleUtxoFundingSat: 11500, feeRateSatPerVbyte: request.feeRateSatPerVbyte, destination: request.destination, leaves: [{ leafId: 'a' }, { leafId: 'b' }] });
  await assert.rejects(() => pricier.driver.confirmSend('w1'), error => error.code === 'MORE_FEE_MONEY');
  assert.equal(pricier.ledger.exitFor('w1').stage, 'fund');
  assert.equal(pricier.ledger.exitFor('w1').funding.shortfallSat, 2900);
});
