import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHarness, tick } from './sparkWalletHarness.js';
import { deferred } from '../../providers/__tests__/arkadeHarness.js';

function harness({ connect = async () => {}, getInfo = async () => ({ arkadeAddress: 'ark1-test' }) } = {}) {
  const providers = [];
  class ArkadeWalletProvider {
    constructor() { this.isConnected = false; this.disconnected = 0; providers.push(this); }
    async connect() { await connect(); this.isConnected = true; }
    async disconnect() { this.disconnected++; this.isConnected = false; }
    async getInfo() { return getInfo(); }
    async getBalance() { return { balance: 2100 }; }
  }
  const { store } = createHarness({ deps: { '../providers/ArkadeWalletProvider': { ArkadeWalletProvider } } });
  store.savedStateLoaded = true;
  store.persistState = async () => {};
  store.wallets = [{ id: 'ark', type: 'arkade', name: 'Arkade', metadata: {}, connectionData: { encryptedMnemonic: 'test' } }];
  return { store, providers, ArkadeWalletProvider };
}

test('concurrent Arkade connects share one provider and reuse the connected engine', async () => {
  const gate = deferred();
  const { store, providers } = harness({ connect: () => gate.promise });
  const calls = [store.ensureArkadeConnected('ark'), store.ensureArkadeConnected('ark'), store.connectArkadeWallet('ark')];
  gate.resolve();
  await Promise.all(calls);
  await store.connectArkadeWallet('ark');
  assert.equal(providers.length, 1);
  assert.equal(store.providers.ark, providers[0]);
});

test('a reconnect disposes the previous engine before replacing it', async () => {
  const { store, providers, ArkadeWalletProvider } = harness();
  const previous = new ArkadeWalletProvider();
  store.providers.ark = previous;
  await store.ensureArkadeConnected('ark');
  assert.equal(previous.disconnected, 1);
  assert.equal(store.providers.ark, providers[1]);
});

test('disconnect during initialization cancels publication and closes the late engine', async () => {
  const gate = deferred();
  const { store, providers } = harness({ connect: () => gate.promise });
  const connecting = store.connectArkadeWallet('ark');
  await tick();
  await store.disconnectWallet('ark');
  gate.resolve();
  await assert.rejects(connecting, /cancelled/);
  assert.equal(store.providers.ark, undefined);
  assert.equal(store.connectionStates.ark.connected, false);
  assert.equal(providers[0].disconnected, 1);
});

test('removal during initialization cannot resurrect the Arkade wallet', async () => {
  const gate = deferred();
  const { store, providers } = harness({ connect: () => gate.promise });
  const connecting = store.connectArkadeWallet('ark');
  store.wallets = [];
  store._bumpWalletEpoch('ark');
  gate.resolve();
  await assert.rejects(connecting, /cancelled/);
  assert.equal(store.providers.ark, undefined);
  assert.equal(store.connectionStates.ark, undefined);
  assert.equal(providers[0].disconnected, 1);
});

test('a failed warmup releases the engine and permits a clean retry', async () => {
  let fail = true;
  const { store, providers } = harness({ getInfo: async () => {
    if (fail) throw new Error('warmup failed');
    return {};
  } });
  await assert.rejects(store.connectArkadeWallet('ark'), /warmup failed/);
  assert.equal(providers[0].disconnected, 1);
  assert.equal(store.providers.ark, undefined);
  fail = false;
  await store.connectArkadeWallet('ark');
  assert.equal(providers.length, 2);
  assert.equal(store.providers.ark.isConnected, true);
});
