/**
 * The watch over every wallet the Spark lifecycle does not own: live hints,
 * history read into the shared receipt ledger, each payment announced once
 * with its own amount, Auto-Transfer balances, and the schedule around them.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESUME_SETTLE_MS, RETRY_MS, WATCH_INTERVAL_MS, PAGE_SIZE, PAYMENTS, createWalletWatch } from '../walletWatch.js';
import { createReceiptLedger } from '../paymentReceipts.js';

const T0 = 1_790_000_000; // unix s
const hash = (n) => String(n).padStart(64, '0');
const receive = (id, sats, ts, extra = {}) => ({ id, type: 'receive', status: 'completed', amount: sats, fee: 0, timestamp: ts, ...extra });
const send = (id, sats, ts) => ({ id, type: 'send', status: 'completed', amount: sats, fee: 0, timestamp: ts });
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };

function memory() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

function setup({ storage = memory(), wallets: initial, online = true } = {}) {
  const clock = { t: T0 * 1000 };
  const s = () => Math.floor(clock.t / 1000);
  const wallets = initial || [
    { id: 'spark', type: 'spark' },
    { id: 'hub', type: 'nwc' },
    { id: 'kitty', type: 'lnbits' },
    { id: 'ark', type: 'arkade' },
  ];
  const history = { hub: [], kitty: [], ark: [] };
  const lookup = {};
  const rules = {};
  const noHistory = new Set();
  const fail = {};
  const owners = {};
  const channels = [];
  const calls = { connect: [], pages: [], finds: [], balances: [] };
  const timers = [];
  const delivered = [];
  let ownerVersion = 0;

  const paymentsOf = () => ({
    watch: async (owner, onHint, wallet) => {
      const channel = { walletId: wallet.id, owner, onHint, stopped: false, revived: [], stop() { this.stopped = true; }, revive(opts) { this.revived.push(opts); } };
      channels.push(channel);
      return channel;
    },
    readPage: async (owner, offset, limit, wallet) => {
      calls.pages.push([wallet.id, offset, limit]);
      if (fail[wallet.id]) throw Object.assign(new Error('no'), { code: fail[wallet.id] === true ? 'OFFLINE' : fail[wallet.id] });
      return history[wallet.id].slice(offset, offset + limit);
    },
    find: async (owner, paymentHash, wallet) => {
      calls.finds.push([wallet.id, paymentHash]);
      return lookup[paymentHash] || null;
    },
  });

  const ledger = createReceiptLedger({ storage, now: () => clock.t });
  const watch = createWalletWatch({
    wallets: () => wallets,
    connect: async (walletId) => {
      calls.connect.push(walletId);
      owners[walletId] ||= { walletId, version: ++ownerVersion };
      return owners[walletId];
    },
    paymentsOf,
    canReadHistory: (wallet) => !noHistory.has(wallet.id),
    ruleFor: (walletId) => rules[walletId] || null,
    refreshBalance: async (walletId) => { calls.balances.push(walletId); },
    ledger,
    deliver: (receipt) => delivered.push(receipt),
    isInternal: (walletId, payment) => payment.paymentHash === 'mine',
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
    now: () => clock.t,
    online: () => (typeof online === 'function' ? online() : online),
  });
  const channel = (walletId) => channels.filter((c) => c.walletId === walletId).at(-1);
  return { watch, wallets, history, lookup, rules, noHistory, fail, owners, channels, channel, calls, timers, delivered, clock, s, ledger, storage };
}

test('every wallet but Spark is watched; a start reads all at once and only sets baselines', async () => {
  const h = setup();
  h.history.kitty = [receive('old', 10, h.s() - 3600)];
  assert.deepEqual(h.watch.watched().map((w) => w.id), ['hub', 'kitty', 'ark']);
  await h.watch.start();
  assert.deepEqual(h.calls.connect.sort(), ['ark', 'hub', 'kitty']);
  assert.deepEqual(h.channels.map((c) => c.walletId).sort(), ['ark', 'hub', 'kitty'], 'one live channel per wallet');
  assert.equal(h.delivered.length, 0, 'what was there before the app looked is not news');
  assert.equal(h.timers.at(-1).ms, WATCH_INTERVAL_MS);
});

test('a hint reads the wallet: the new payment is announced once, with its own amount and id', async () => {
  const h = setup();
  await h.watch.start();
  h.clock.t += 20_000;
  h.history.kitty.unshift(receive(hash(1), 2100, h.s(), { paymentHash: hash(1) }));
  h.channel('kitty').onHint({ paymentHash: hash(1) });
  h.channel('kitty').onHint({ paymentHash: hash(1) });
  h.channel('kitty').onHint({});
  await flush();
  assert.equal(h.delivered.length, 1);
  assert.deepEqual([h.delivered[0].walletId, h.delivered[0].id, h.delivered[0].amountSats], ['kitty', hash(1), 2100]);
  assert.ok(h.calls.balances.includes('kitty'), 'the balance follows what arrived');
  const reads = h.calls.pages.filter(([id]) => id === 'kitty').length;
  assert.ok(reads <= 3, `burst of hints coalesces into a run and one follow-up (${reads} reads incl. the start)`);
  assert.equal(h.calls.finds.length, 0, 'the page already had it: no lookup');
});

test('a payment that arrived together with a send is still announced, with its own amount', async () => {
  const h = setup();
  await h.watch.start();
  h.clock.t += 10_000;
  // 1,000 + 200 - 300: the balance went down, money still arrived.
  h.history.hub.unshift(send('out', 300, h.s()), receive('in', 200, h.s()));
  h.channel('hub').onHint({});
  await flush();
  assert.deepEqual(h.delivered.map((r) => [r.id, r.amountSats]), [['in', 200]]);
});

test('a payment the pages do not reach is read by the hash its hint named; a bad hash is ignored', async () => {
  const h = setup();
  await h.watch.start();
  h.clock.t += 7_200_000;
  h.ledger.markCaughtUp('kitty', h.s() - 60);
  // An invoice made two hours ago, paid now: listed by when it was made, far down.
  h.history.kitty = Array.from({ length: PAGE_SIZE }, (_, i) => send(`s${i}`, 1, h.s() - 30 - i));
  h.lookup[hash(7)] = receive(hash(7), 500, h.s() - 7000, { settled_at: h.s(), paymentHash: hash(7) });
  h.channel('kitty').onHint({ paymentHash: hash(7).toUpperCase() });
  h.channel('kitty').onHint({ paymentHash: 'x'.repeat(64) });
  await flush();
  assert.deepEqual(h.calls.finds, [['kitty', hash(7)]]);
  assert.deepEqual(h.delivered.map((r) => [r.id, r.amountSats]), [[hash(7), 500]]);
});

test('the user\'s own transfer arrives quietly', async () => {
  const h = setup();
  await h.watch.start();
  h.clock.t += 10_000;
  h.history.kitty.unshift(receive('t1', 1000, h.s(), { paymentHash: 'mine' }));
  h.channel('kitty').onHint({});
  await flush();
  assert.equal(h.delivered.length, 0);
});

test('Arkade: change and renewals hint but bring no receipt; a deposit keeps its id and counts once it is spendable', async () => {
  const h = setup();
  await h.watch.start();
  h.clock.t += 10_000;
  // A send with change: the stream reports a new output, the history no receipt.
  h.history.ark.unshift({ id: 'sent-1', type: 'outgoing', status: 'completed', amount: 351, timestamp: h.s() });
  h.channel('ark').onHint({});
  await flush();
  assert.equal(h.delivered.length, 0);
  h.clock.t += 60_000;
  h.history.ark.unshift({ id: 'board-1', type: 'incoming', status: 'pending', amount: 50_000, timestamp: h.s() - 30 });
  h.channel('ark').onHint({});
  await flush();
  assert.equal(h.delivered.length, 0, 'confirmed on chain, not spendable yet');
  h.clock.t += 30 * 60_000;
  h.history.ark[0] = { ...h.history.ark[0], status: 'completed' };
  h.channel('ark').onHint({});
  await flush();
  assert.deepEqual(h.delivered.map((r) => [r.id, r.amountSats]), [['board-1', 50_000]], 'once, under the id it had from the start');
});

test('a wallet whose history cannot be read is left to its balance, every round', async () => {
  const h = setup();
  h.noHistory.add('hub');
  await h.watch.start();
  assert.equal(h.calls.pages.filter(([id]) => id === 'hub').length, 0);
  assert.ok(h.calls.balances.includes('hub'));
  h.timers.at(-1).fn();
  await flush();
  assert.equal(h.calls.balances.filter((id) => id === 'hub').length, 2);
});

test('Auto-Transfer: a wallet with a switched-on rule has its balance read every round; others only after activity', async () => {
  const h = setup();
  h.rules.hub = { enabled: true };
  h.rules.kitty = { enabled: false };
  await h.watch.start();
  h.timers.at(-1).fn();
  await flush();
  assert.equal(h.calls.balances.filter((id) => id === 'hub').length, 2);
  assert.equal(h.calls.balances.filter((id) => id === 'kitty').length, 0);
});

test('a failed read retries a few times, then waits for the round; nothing is announced twice', async () => {
  const h = setup({ online: false }); // the network is down: nothing to give up on
  await h.watch.start();
  h.clock.t += 10_000;
  h.history.kitty.unshift(receive('r1', 99, h.s()));
  h.fail.kitty = true;
  h.channel('kitty').onHint({});
  await flush();
  const retries = () => h.timers.filter((t) => RETRY_MS.includes(t.ms) && !t.cleared);
  for (let i = 0; i < RETRY_MS.length; i += 1) {
    const t = retries().at(-1);
    assert.equal(t.ms, RETRY_MS[i]);
    t.cleared = true;
    t.fn();
    await flush();
  }
  assert.equal(retries().length, 0, 'bounded: then the minute round');
  assert.equal(h.delivered.length, 0);
  h.fail.kitty = false;
  h.channel('kitty').onHint({});
  h.channel('kitty').onHint({});
  await flush();
  h.timers.filter((t) => t.ms === WATCH_INTERVAL_MS && !t.cleared).at(-1).fn();
  await flush();
  assert.deepEqual(h.delivered.map((r) => r.id), ['r1'], 'once, however often it is read');
});

test('one failing wallet holds up neither the others nor the next round', async () => {
  const h = setup();
  h.fail.hub = true;
  await h.watch.start();
  h.clock.t += 10_000;
  h.history.kitty.unshift(receive('k1', 5, h.s()));
  h.timers.filter((t) => t.ms === WATCH_INTERVAL_MS).at(-1).fn();
  await flush();
  assert.deepEqual(h.delivered.map((r) => r.id), ['k1']);
  assert.ok(h.timers.filter((t) => t.ms === WATCH_INTERVAL_MS).length >= 2, 'the next round is scheduled');
});

test('the channel moves with the connection; coming back revives it, a round only checks it', async () => {
  const h = setup();
  await h.watch.start();
  const first = h.channel('hub');
  h.timers.at(-1).fn();
  await flush();
  assert.deepEqual(first.revived.at(-1), { returned: false });
  h.clock.t += RESUME_SETTLE_MS;
  await h.watch.resume('resume');
  assert.deepEqual(first.revived.at(-1), { returned: true });
  // Reconnected (a new connection object): the old channel closes, a new one opens on it.
  h.owners.hub = { walletId: 'hub', version: 99 };
  h.clock.t += RESUME_SETTLE_MS;
  await h.watch.resume('online');
  assert.equal(first.stopped, true);
  assert.equal(h.channel('hub').owner.version, 99);
});

test('a removed wallet: its channel closes, and a read still running decides nothing', async () => {
  const h = setup();
  await h.watch.start();
  h.clock.t += 10_000;
  h.history.kitty.unshift(receive('late', 1, h.s()));
  const ch = h.channel('kitty');
  ch.onHint({});
  h.wallets.splice(h.wallets.findIndex((w) => w.id === 'kitty'), 1);
  h.watch.forget('kitty');
  await flush();
  assert.equal(ch.stopped, true);
  assert.equal(h.delivered.length, 0);
  ch.onHint({});
  await flush();
  assert.equal(h.delivered.length, 0, 'a late hint from a closed channel is ignored');
});

test('added wallets are watched, removed ones dropped (sync)', async () => {
  const h = setup();
  await h.watch.start();
  h.wallets.push({ id: 'new', type: 'lnbits' });
  h.history.new = [receive('before', 1, h.s() - 100)];
  h.wallets.splice(h.wallets.findIndex((w) => w.id === 'hub'), 1);
  const hubChannel = h.channel('hub');
  h.watch.sync();
  await flush();
  assert.equal(hubChannel.stopped, true);
  assert.ok(h.channel('new'));
  assert.equal(h.delivered.length, 0, 'a new wallet starts from its baseline');
});

test('a balance seen rising elsewhere asks the watch to look; Spark and a stopped watch decline', async () => {
  const h = setup();
  assert.equal(h.watch.hint('kitty'), false, 'not started: the caller decides');
  await h.watch.start();
  assert.equal(h.watch.hint('spark'), false);
  assert.equal(h.watch.hint('nope'), false);
  h.clock.t += 10_000;
  h.history.kitty.unshift(receive('b1', 42, h.s()));
  assert.equal(h.watch.hint('kitty'), true);
  await flush();
  assert.deepEqual(h.delivered.map((r) => [r.id, r.amountSats]), [['b1', 42]]);
});

test('after a restart, payments already announced stay announced', async () => {
  const storage = memory();
  const first = setup({ storage });
  await first.watch.start();
  first.clock.t += 10_000;
  first.history.kitty.unshift(receive('r1', 7, first.s()));
  first.channel('kitty').onHint({});
  await flush();
  assert.equal(first.delivered.length, 1);
  first.watch.stop();

  const again = setup({ storage });
  again.clock.t = first.clock.t + 120_000;
  again.history.kitty = [...first.history.kitty];
  again.history.kitty.unshift(receive('r2', 8, again.s() - 60)); // arrived while the app was closed
  await again.watch.start();
  assert.deepEqual(again.delivered.map((r) => r.id), ['r2']);
});

test('returning to the app reads at once; a stopped watch does nothing', async () => {
  const h = setup();
  await h.watch.start();
  const before = h.calls.pages.length;
  h.clock.t += RESUME_SETTLE_MS;
  await h.watch.resume();
  assert.equal(h.calls.pages.length, before + 3);
  assert.equal(h.timers.find((t) => t.ms === WATCH_INTERVAL_MS).cleared, true, 'the pending round is replaced, not doubled');
  h.watch.stop();
  h.clock.t += RESUME_SETTLE_MS;
  await h.watch.resume();
  assert.equal(h.calls.pages.length, before + 3);
  assert.equal(h.channels.every((c) => c.stopped), true, 'stopping closes every channel');
});

test('coming back raises several events and the thawed timer at once: one round covers them all', async () => {
  const h = setup();
  await h.watch.start();
  const before = h.calls.pages.length;
  h.clock.t += 10 * WATCH_INTERVAL_MS; // frozen in the background
  const thawed = h.timers.at(-1).fn(); // the frozen round fires on thaw
  await Promise.all([h.watch.resume(), h.watch.resume('online'), h.watch.resume(), thawed]);
  await flush();
  assert.equal(h.calls.pages.length, before + 3, 'one round, not four');
  h.clock.t += RESUME_SETTLE_MS - 1;
  await h.watch.resume();
  assert.equal(h.calls.pages.length, before + 3, 'a resume right after a round adds nothing');
});

test('a failing history read holds up neither the balance nor the rule waiting for it', async () => {
  const h = setup();
  h.rules.kitty = { enabled: true };
  h.fail.kitty = true;
  await h.watch.start();
  assert.ok(h.calls.balances.includes('kitty'), 'the rule still gets its verified balance');
  assert.ok(h.timers.some((t) => t.ms === RETRY_MS[0]), 'and the history read is tried again');
  assert.equal(h.watch.hint('kitty'), true, 'a passing failure keeps announcing by payment');
});

test('a wallet that refuses its history is left to its balance from then on', async () => {
  const h = setup();
  h.fail.hub = 'RESTRICTED';
  await h.watch.start();
  assert.equal(h.watch.hint('hub'), false, 'its balance rise is announced by the store again');
  assert.ok(!h.timers.some((t) => RETRY_MS.includes(t.ms)), 'a refusal is not retried');
  const pages = h.calls.pages.filter(([id]) => id === 'hub').length;
  h.timers.at(-1).fn();
  await flush();
  assert.equal(h.calls.pages.filter(([id]) => id === 'hub').length, pages, 'and its history is not asked for again');
  assert.equal(h.calls.balances.filter((id) => id === 'hub').length, 2, 'its balance is read every round');
});

test('a balance rise on a wallet whose history cannot be read stays with the store', async () => {
  const h = setup();
  h.noHistory.add('hub');
  await h.watch.start();
  assert.equal(h.watch.hint('hub'), false);
  assert.equal(h.watch.hint('kitty'), true);
});

test('each wallet type is read and watched through its own entry points', async () => {
  const calls = [];
  const provider = {
    watchPayments: (fn) => { calls.push(['watchPayments', typeof fn]); return { stop() {} }; },
    listPayments: (page) => { calls.push(['listPayments', page]); return []; },
    getTransactions: (page) => { calls.push(['getTransactions', page]); return []; },
    getPayment: (hash) => { calls.push(['getPayment', hash]); return null; },
  };
  await PAYMENTS.lnbits.watch(provider, () => {});
  await PAYMENTS.lnbits.readPage(provider, 20, 20);
  await PAYMENTS.lnbits.find(provider, 'h');
  await PAYMENTS.arkade.watch(provider, () => {});
  await PAYMENTS.arkade.readPage(provider, 0, 20);
  assert.equal(PAYMENTS.arkade.find, undefined, 'Arkade payments carry no hash to look up');
  assert.deepEqual(calls, [
    ['watchPayments', 'function'], ['listPayments', { offset: 20, limit: 20 }], ['getPayment', 'h'],
    ['watchPayments', 'function'], ['getTransactions', { offset: 0, limit: 20 }],
  ]);
  // NWC: a live channel only where the connection was granted notifications.
  const subscribed = [];
  const nwc = { client: { connected: true, subscribeNotifications: async (fn, types) => { subscribed.push(types); return () => {}; } } };
  assert.equal(await PAYMENTS.nwc.watch(nwc, () => {}, { metadata: { notifications: [] } }), null);
  const channel = await PAYMENTS.nwc.watch(nwc, () => {}, { metadata: { notifications: ['payment_received'] } });
  assert.deepEqual(subscribed, [['payment_received']]);
  channel.stop();
});

test('history that never answers while the network does: the balance takes over, and its ledger starts afresh', async () => {
  const h = setup();
  await h.watch.start();
  h.clock.t += 10_000;
  h.history.hub.unshift(receive('n1', 3, h.s()));
  h.fail.hub = 'INTERNAL'; // a reply timeout, again and again
  for (let i = 0; i < 3; i += 1) {
    h.timers.filter((t) => t.ms === WATCH_INTERVAL_MS && !t.cleared).at(-1).fn();
    await flush();
  }
  assert.equal(h.watch.hint('hub'), false, 'its balance rise is announced by the store from now on');
  assert.equal(h.ledger.isPrimed('hub'), false, 'forgotten: a later session primes again instead of repeating');
  assert.equal(h.delivered.length, 0);
});

test('a flood of channel messages runs at most once per spacing', async () => {
  const h = setup();
  await h.watch.start();
  h.clock.t += 60_000;
  const before = h.calls.pages.filter(([id]) => id === 'kitty').length;
  for (let i = 0; i < 50; i += 1) h.channel('kitty').onHint({ paymentHash: hash(100 + i) });
  await flush();
  const reads = h.calls.pages.filter(([id]) => id === 'kitty').length - before;
  assert.ok(reads <= 1, `one run now (${reads})`);
  assert.ok(h.calls.finds.length <= 5, 'and only a few named payments looked up');
  assert.equal(h.timers.filter((t) => !t.cleared && t.ms > 0 && t.ms <= 3000).length, 1, 'the rest wait for one spaced run');
});

test('a payment right after a round is read at once; only hinted runs are spaced', async () => {
  const h = setup();
  await h.watch.start(); // a round just ran
  h.history.kitty.unshift(receive('now', 9, h.s()));
  h.channel('kitty').onHint({});
  await flush();
  assert.deepEqual(h.delivered.map((r) => r.id), ['now'], 'no wait after the start or minute round');
});
