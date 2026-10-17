import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probeNwcConnection } from '../nwcProbe.js';
import { NWC_ERROR } from '../../utils/nwcErrors.js';

const PK = 'b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4';
const SECRET = '71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c';
const URL1 = `nostr+walletconnect://${PK}?relay=wss%3A%2F%2Frelay.getalby.com%2Fv1&relay=wss%3A%2F%2Frelay.backup.example&secret=${SECRET}&lud16=shop%40getalby.com`;
const sdk = (message, code) => Object.assign(new Error(message), { code });

function client(script) {
  const calls = { info: 0, closed: false };
  return {
    calls,
    getInfo: async () => { calls.info += 1; return script.info(calls.info); },
    getBalance: async () => script.balance(),
    getBudget: async () => script.budget(),
    getWalletServiceInfo: async () => script.service(),
    close: () => { calls.closed = true; },
  };
}

test('a full answer: name, balance, address, grants, limit, every relay', async () => {
  const c = client({
    info: () => ({ alias: 'Alby Hub', pubkey: '02node', network: 'mainnet', methods: ['pay_invoice', 'make_invoice', 'get_balance', 'get_budget'], notifications: ['payment_received'] }),
    balance: () => ({ balance: 48_210_000 }),
    budget: () => ({ total_budget: 100_000_000, used_budget: 12_400_000, renews_at: 1_800_000_000 }),
  });
  const probe = await probeNwcConnection(URL1, { createClient: () => c });
  assert.equal(probe.alias, 'Alby Hub');
  assert.equal(probe.balanceSats, 48210);
  assert.equal(probe.lud16, 'shop@getalby.com');
  assert.equal(probe.limit.remainingSats, 87600);
  assert.deepEqual(probe.relays, ['wss://relay.getalby.com/v1', 'wss://relay.backup.example']);
  assert.match(probe.normalized, /relay=.*relay=/, 'the stored form keeps both relays');
  assert.equal(c.calls.closed, true);
});

test('a connection without balance access is still a connection', async () => {
  const c = client({ info: () => ({ alias: 'Coinos', methods: ['make_invoice', 'lookup_invoice'] }), balance: () => { throw new Error('must not be asked'); } });
  const probe = await probeNwcConnection(URL1, { createClient: () => c });
  assert.equal(probe.balanceSats, null);
  assert.equal(probe.limit, null);
});

test('a slow wallet is asked twice before it counts as silent', async () => {
  let waited = false;
  const c = client({ info: (n) => { if (n === 1) throw sdk('reply timeout: x', 'INTERNAL'); return { alias: 'Phone wallet', methods: ['pay_invoice'] }; } });
  const probe = await probeNwcConnection(URL1, { createClient: () => c, onWaiting: () => { waited = true; } });
  assert.equal(probe.alias, 'Phone wallet');
  assert.equal(waited, true);
  assert.equal(c.calls.info, 2);
});

test('silence twice is "no answer"; no wallet behind the relay too', async () => {
  const silent = client({ info: () => { throw sdk('reply timeout: x', 'INTERNAL'); } });
  await assert.rejects(probeNwcConnection(URL1, { createClient: () => silent }), (e) => e.code === NWC_ERROR.NO_ANSWER);
  const empty = client({ info: () => { throw new Error('no info event (kind 13194) returned from relay'); } });
  await assert.rejects(probeNwcConnection(URL1, { createClient: () => empty }), (e) => e.code === NWC_ERROR.NO_ANSWER);
  assert.equal(empty.calls.info, 1, 'not asked again: there is nobody to wait for');
});

test('an unreachable relay is said as such', async () => {
  const c = client({ info: () => { throw sdk('Failed to connect to wss://relay.getalby.com/v1', 'OTHER'); } });
  await assert.rejects(probeNwcConnection(URL1, { createClient: () => c }), (e) => e.code === NWC_ERROR.RELAY_UNREACHABLE);
});

test('a connection that may not ask who it is reads its grants from the info event', async () => {
  const c = client({
    info: () => { throw sdk('not allowed', 'RESTRICTED'); },
    service: () => ({ capabilities: ['make_invoice'], notifications: [] }),
  });
  const probe = await probeNwcConnection(URL1, { createClient: () => c });
  assert.deepEqual(probe.methods, ['make_invoice']);
  assert.equal(probe.alias, '');
});

test('the wallet\'s own refusals pass through; a bad string never reaches the network', async () => {
  const c = client({ info: () => { throw sdk('expired', 'UNAUTHORIZED'); } });
  await assert.rejects(probeNwcConnection(URL1, { createClient: () => c }), (e) => e.code === 'UNAUTHORIZED');
  let built = false;
  await assert.rejects(probeNwcConnection('not a connection', { createClient: () => { built = true; } }), (e) => e.code === 'NWC_INVALID');
  assert.equal(built, false);
});
