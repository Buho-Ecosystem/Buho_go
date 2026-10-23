import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DESTINATION_PROBLEM,
  OUTCOME,
  PAUSED,
  ROUTE,
  addEvent,
  isStuckWait,
  STUCK_WAIT_MS,
  amountSats,
  destinationProblem,
  failureReason,
  normalizeAmount,
  normalizeRule,
  readDestination,
  routeFor,
  routeReserve,
  ruleStatus,
  thresholdSuggestions,
  transferAmount,
  wouldLoop,
} from '../autoTransfer.js';

const LN = 'satoshi@getalby.com';
const BTC = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const shop = { id: 'shop', type: 'spark', name: 'Shop' };
const savings = { id: 'savings', type: 'spark', name: 'Savings' };
const hub = { id: 'hub', type: 'nwc', name: 'Alby Hub', metadata: { methods: ['pay_invoice', 'make_invoice', 'get_balance'] } };
const readOnlyHub = { id: 'ro', type: 'nwc', name: 'Watch', metadata: { methods: ['pay_invoice', 'get_balance'] } };
const ark = { id: 'ark', type: 'arkade', name: 'Arkade' };
const wallets = [shop, savings, hub, readOnlyHub, ark];

test('amounts stay the way they were typed, in sats or in a fiat currency', () => {
  assert.deepEqual(normalizeAmount(500000), { sats: 500000 });
  assert.deepEqual(normalizeAmount({ sats: '1200.9' }), { sats: 1200 });
  assert.deepEqual(normalizeAmount({ fiat: 500.004, currency: 'eur' }), { fiat: 500, currency: 'EUR' });
  for (const nothing of [null, 0, { sats: 0 }, { fiat: 0, currency: 'USD' }, { fiat: 5 }]) assert.equal(normalizeAmount(nothing), null);

  const usd = (code) => (code === 'USD' ? 50000 : 0);
  assert.equal(amountSats({ sats: 1234 }, usd), 1234);
  assert.equal(amountSats({ fiat: 500, currency: 'USD' }, usd), 1_000_000, '$500 at $50,000 per bitcoin');
  assert.equal(amountSats({ fiat: 500, currency: 'EUR' }, usd), null, 'no rate: unknown, never a guess');
  assert.equal(amountSats(null, usd), 0);
});

test('a rule saved before destinations had a kind reads the same', () => {
  const old = normalizeRule({ enabled: true, thresholdSats: 100000, payoutType: 'onchain', bitcoinAddress: ` ${BTC} `, feeSpeed: 'high', lastTriggeredAt: 5 });
  assert.deepEqual(old, {
    enabled: true, threshold: { sats: 100000 }, keep: null, destination: { kind: 'bitcoin', address: BTC },
    feeSpeed: 'high', pausedReason: null, failureStreak: 0, events: [], lastTriggeredAt: 5,
  });
  assert.deepEqual(normalizeRule({ payoutType: 'lightning', lightningAddress: LN }).destination, { kind: 'lightning', address: LN });
  assert.equal(normalizeRule({ payoutType: 'spark', sparkAddress: '' }).destination, null, 'an empty address is no destination');
  assert.equal(normalizeRule({ enabled: 'yes', feeSpeed: 'ludicrous', pausedReason: 'bored' }).enabled, false);
});

test('pasted or scanned text becomes a destination only when a rule can send to it', () => {
  assert.deepEqual(readDestination(`lightning:${LN}`, 'nwc'), { kind: 'lightning', address: LN });
  assert.deepEqual(readDestination(`bitcoin:${BTC}?amount=0.1`, 'spark'), { kind: 'bitcoin', address: BTC });
  assert.equal(readDestination('lnbc10u1pj0example', 'spark'), null, 'an invoice expires: not a destination');
  assert.equal(readDestination('hello', 'spark'), null);
});

test('the route follows from both ends: Spark to Spark free, an address its own way', () => {
  assert.equal(routeFor('spark', { kind: 'wallet', walletId: 'savings' }, savings), ROUTE.SPARK);
  assert.equal(routeFor('spark', { kind: 'wallet', walletId: 'hub' }, hub), ROUTE.LIGHTNING);
  assert.equal(routeFor('nwc', { kind: 'wallet', walletId: 'savings' }, savings), ROUTE.LIGHTNING);
  assert.equal(routeFor('spark', { kind: 'bitcoin', address: BTC }), ROUTE.BITCOIN);
  assert.equal(routeFor('spark', { kind: 'lightning', address: LN }), ROUTE.LIGHTNING);
  assert.equal(routeReserve(ROUTE.SPARK, 1_000_000), 0);
  assert.equal(routeReserve(ROUTE.BITCOIN, 1_000_000), 0, 'on-chain uses its quote instead');
  assert.equal(routeReserve(ROUTE.LIGHTNING, 1_000_000), 10_000);
  assert.equal(routeReserve(ROUTE.LIGHTNING, 300), 10, 'at least 10 sats');
});

test('a transfer moves what is above the amount kept, less the fee, and nothing before the threshold', () => {
  const rule = { thresholdSats: 500_000, route: ROUTE.SPARK };
  assert.equal(transferAmount({ ...rule, balanceSats: 500_000 }), 0, 'at the threshold: not yet');
  assert.equal(transferAmount({ ...rule, balanceSats: 612_400 }), 612_400, 'everything, nothing held back between Spark wallets');
  assert.equal(transferAmount({ ...rule, keepSats: 100_000, balanceSats: 612_400 }), 512_400);
  assert.equal(transferAmount({ ...rule, route: ROUTE.LIGHTNING, keepSats: 100_000, balanceSats: 612_400 }), 512_400 - 5_124);
  assert.equal(transferAmount({ ...rule, route: ROUTE.BITCOIN, feeSats: 1_400, balanceSats: 612_400 }), 611_000);
  assert.equal(transferAmount({ ...rule, keepSats: 612_395, balanceSats: 612_400 }), 0, 'under 10 sats: not worth it');
  assert.equal(transferAmount({ ...rule, keepSats: 700_000, balanceSats: 612_400 }), 0, 'keeping more than it holds');
  assert.equal(transferAmount({ ...rule, balanceSats: Number.NaN }), 0);
  assert.equal(transferAmount({ ...rule, thresholdSats: 0, balanceSats: 9e9 }), 0, 'no threshold: never');
});

test('a destination must be one this wallet can pay, and never itself or a loop', () => {
  const check = (source, destination, rules = {}) => destinationProblem({ source, destination, wallets, rules });
  assert.equal(check(shop, { kind: 'wallet', walletId: 'savings' }), null);
  assert.equal(check(shop, { kind: 'wallet', walletId: 'shop' }), DESTINATION_PROBLEM.SELF);
  assert.equal(check(shop, { kind: 'wallet', walletId: 'gone' }), DESTINATION_PROBLEM.MISSING);
  assert.equal(check(shop, { kind: 'wallet', walletId: 'ro' }), DESTINATION_PROBLEM.CANNOT_RECEIVE, 'a connection that cannot create invoices');
  assert.equal(check(ark, { kind: 'wallet', walletId: 'savings' }), DESTINATION_PROBLEM.CANNOT_PAY, 'Arkade Lightning is paused');
  assert.equal(check(hub, { kind: 'spark', address: 'sp1x' }), DESTINATION_PROBLEM.CANNOT_PAY);
  assert.equal(check(hub, { kind: 'lightning', address: LN }), null);
  assert.equal(check(shop, { kind: 'bitcoin', address: BTC }), null);
  assert.equal(check(ark, { kind: 'bitcoin', address: BTC }), DESTINATION_PROBLEM.CANNOT_PAY, 'not from a rule yet');
  assert.equal(check(ark, { kind: 'lightning', address: LN }), DESTINATION_PROBLEM.CANNOT_PAY);
  assert.equal(check(shop, { kind: 'lightning' }), DESTINATION_PROBLEM.UNKNOWN);

  const rules = { savings: { enabled: true, destination: { kind: 'wallet', walletId: 'hub' } }, hub: { enabled: true, destination: { kind: 'wallet', walletId: 'shop' } } };
  assert.equal(check(shop, { kind: 'wallet', walletId: 'savings' }, rules), DESTINATION_PROBLEM.LOOP, 'shop → savings → hub → shop');
  assert.equal(wouldLoop('shop', { kind: 'wallet', walletId: 'savings' }, { ...rules, hub: { ...rules.hub, enabled: false } }), false, 'a paused rule breaks the chain');
});

test('failures are named in a few words', () => {
  assert.equal(failureReason({ code: 'NWC_PAYMENT_UNCONFIRMED' }), 'unconfirmed');
  assert.equal(failureReason({ counterparty: true, message: 'Amount too small' }), 'refused');
  assert.equal(failureReason(new Error('Insufficient balance')), 'insufficient');
  assert.equal(failureReason(new Error('Could not resolve Lightning address')), 'unreachable');
  assert.equal(failureReason(new Error('Request timed out')), 'offline');
  assert.equal(failureReason(new Error('???')), 'other');
});

test('recent activity keeps 20 events, newest first, and one line for a repeated wait', () => {
  let events = [];
  events = addEvent(events, { at: 1, outcome: OUTCOME.SENT, amount: 5 });
  events = addEvent(events, { at: 2, outcome: OUTCOME.SKIPPED, reason: 'no_rate' });
  events = addEvent(events, { at: 3, outcome: OUTCOME.SKIPPED, reason: 'no_rate' });
  assert.deepEqual(events.map((e) => e.at), [3, 1]);
  events = addEvent(events, { at: 4, outcome: OUTCOME.SKIPPED, reason: 'balance_unverified' });
  assert.equal(events.length, 3);
  for (let i = 0; i < 30; i++) events = addEvent(events, { at: 10 + i, outcome: OUTCOME.SENT, amount: i });
  assert.equal(events.length, 20);
  assert.equal(events[0].at, 39);
});

test('a repeated wait keeps when it began and its latest cause (#430)', () => {
  let events = [];
  events = addEvent(events, { at: 100, outcome: OUTCOME.SKIPPED, reason: 'balance_unverified', detail: 'BREEZ_SYNC_TIMEOUT' });
  events = addEvent(events, { at: 200, outcome: OUTCOME.SKIPPED, reason: 'balance_unverified', detail: 'BREEZ_SYNC_UNVERIFIED' });
  events = addEvent(events, { at: 300, outcome: OUTCOME.SKIPPED, reason: 'balance_unverified' });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { at: 300, since: 100, outcome: OUTCOME.SKIPPED, reason: 'balance_unverified', detail: 'BREEZ_SYNC_UNVERIFIED' });
});

test('a balance that cannot be checked for 10 minutes needs the person; other waits do not (#430)', () => {
  const now = 50 * 60e3;
  const waiting = (since, reason = 'balance_unverified') => ({ enabled: true, events: [{ at: now, since, outcome: OUTCOME.SKIPPED, reason }] });
  assert.equal(ruleStatus(waiting(now - 2 * 60e3), { now }).kind, 'waiting', 'a short wait is just a wait');
  assert.equal(ruleStatus(waiting(now - STUCK_WAIT_MS), { now }).kind, 'attention');
  assert.equal(ruleStatus(waiting(now - 60 * 60e3, 'no_rate'), { now }).kind, 'waiting', 'waiting for a rate is fine');
  assert.equal(ruleStatus({ ...waiting(now - STUCK_WAIT_MS), enabled: false }, { now }).kind, 'paused');
  assert.equal(isStuckWait({ at: now, outcome: OUTCOME.SKIPPED, reason: 'balance_unverified' }, now), false, 'a first entry starts the clock');
});

test('a rule says where it stands', () => {
  assert.deepEqual(ruleStatus({ enabled: true, events: [] }), { kind: 'waiting' });
  const sent = { at: 1, outcome: OUTCOME.SENT, amount: 9 };
  assert.deepEqual(ruleStatus({ enabled: true, events: [{ at: 2, outcome: OUTCOME.SKIPPED }, sent] }), { kind: 'sent', event: sent }, 'a wait does not hide the last transfer');
  const failed = { at: 3, outcome: OUTCOME.FAILED, reason: 'offline' };
  assert.equal(ruleStatus({ enabled: true, events: [failed, sent] }).kind, 'attention');
  assert.equal(ruleStatus({ enabled: false, pausedReason: PAUSED.FAILURES, events: [failed] }).kind, 'attention');
  assert.deepEqual(ruleStatus({ enabled: false, pausedReason: PAUSED.MOVED, events: [] }), { kind: 'paused', reason: PAUSED.MOVED });
  assert.deepEqual(ruleStatus({ enabled: false, events: [sent] }), { kind: 'paused', reason: null });
});

test('suggested amounts are the next round steps above the balance', () => {
  assert.deepEqual(thresholdSuggestions(184_250), [250_000, 500_000, 1_000_000]);
  assert.deepEqual(thresholdSuggestions(0), [10_000, 25_000, 50_000]);
  assert.deepEqual(thresholdSuggestions(500_000), [1_000_000, 2_500_000, 5_000_000]);
});

// ---- The words (utils/autoTransferCopy.js) ---------------------------------

import { attentionCopy, destinationLabel, eventRow, formatRuleAmount, reasonText, ruleSentence, statusText, whenText } from '../autoTransferCopy.js';

const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? name);
const ctx = { t, locale: 'en-US', bip177: false, wallets: [shop, savings], now: 10_000_000 };

test('a rule reads as one sentence, in the units it was typed in', () => {
  const rule = { threshold: { sats: 500_000 }, keep: { fiat: 50, currency: 'USD' }, destination: { kind: 'wallet', walletId: 'savings' } };
  assert.equal(ruleSentence(rule, 'Shop', ctx), 'When Shop holds more than 500,000 sats, move everything above $50.00 to Savings.');
  assert.equal(ruleSentence({ ...rule, keep: null }, 'Shop', ctx), 'When Shop holds more than 500,000 sats, move everything to Savings.');
  assert.equal(formatRuleAmount({ sats: 1234 }, { bip177: true }), '₿ 1,234');
  assert.equal(formatRuleAmount({ fiat: 500, currency: 'EUR' }, { locale: 'de-DE' }).replace(/\s/g, ' '), '500,00 €');
  assert.equal(destinationLabel({ kind: 'bitcoin', address: BTC }), 'bc1qxy2k…hx0wlh');
  assert.equal(destinationLabel({ kind: 'lightning', address: LN, name: 'Satoshi' }), 'Satoshi');
});

test('a status is a few words; times are relative and translated', () => {
  const now = 10_000_000;
  assert.deepEqual(statusText({ enabled: true, threshold: { sats: 500_000 }, events: [] }, ctx), { text: 'Over 500,000 sats', tone: '' });
  assert.deepEqual(statusText({ enabled: true, events: [{ at: now - 3 * 3600e3, outcome: 'sent', amount: 178_722 }] }, { ...ctx, now }), { text: 'Moved 178,722 sats · 3 hours ago', tone: 'good' });
  assert.equal(statusText({ enabled: true, events: [{ at: 1, outcome: 'failed', reason: 'offline' }] }, ctx).text, "Couldn't send");
  assert.equal(statusText({ enabled: true, events: [{ at: 1, outcome: 'skipped', reason: 'cannot_pay' }] }, ctx).text, "Can't send");
  assert.equal(statusText({ enabled: false, pausedReason: 'failures', events: [] }, ctx).text, 'Paused after failed tries');
  assert.equal(statusText({ enabled: false, events: [] }, ctx).text, 'Paused');
  assert.equal(whenText(now - 26 * 3600e3, { locale: 'de-DE', now }), 'gestern');
  assert.equal(whenText(now, { now }), 'now');
});

test('every reason is one short sentence, and never says "withdrawal" or names a route', () => {
  const reasons = ['unreachable', 'offline', 'insufficient', 'refused', 'unconfirmed', 'balance_unverified', 'no_rate', 'below_minimum', 'cannot_pay', 'cannot_receive', 'missing', 'loop', 'self', 'unknown', 'other'];
  for (const reason of reasons) {
    const text = reasonText(reason, { t, wallet: 'Shop', destination: 'Savings' });
    assert.match(text, /^[^.]+\.$/, `${reason}: one sentence`);
    assert.doesNotMatch(text, /withdraw|lightning|spark|on-chain|—/i, reason);
  }
  assert.deepEqual(eventRow({ at: 10_000_000 - 60e3, outcome: 'failed', reason: 'offline' }, ctx), { title: "Couldn't send", detail: '1 minute ago · There was no connection.', value: '', tone: 'warn' });
});

test('a balance that could not be checked says why when the cause is known (#430)', () => {
  const said = (detail) => reasonText('balance_unverified', { t, wallet: 'Shop', detail });
  assert.equal(said('BREEZ_SYNC_TIMEOUT'), 'Checking the balance took too long.');
  assert.equal(said('BREEZ_SYNC_UNVERIFIED'), "The network didn't answer the balance check.");
  assert.equal(said('Spark wallet is not connected'), "Shop isn't connected.");
  assert.equal(said(null), "The balance couldn't be checked.");
  for (const detail of ['BREEZ_SYNC_TIMEOUT', 'BREEZ_SYNC_UNVERIFIED', 'Spark wallet is not connected', 'SOMETHING_ELSE']) {
    assert.match(said(detail), /^[^.]+\.$/);
    assert.doesNotMatch(said(detail), /withdraw|lightning|spark|on-chain|—/i, detail);
  }
  const row = eventRow({ at: 10_000_000, outcome: 'skipped', reason: 'balance_unverified', detail: 'BREEZ_SYNC_TIMEOUT' }, ctx);
  assert.equal(row.detail, 'now · Checking the balance took too long.');
});

test('a rule stuck on its balance check is a warning with Try Again (#430)', () => {
  const now = Date.now();
  const rule = { enabled: true, threshold: { sats: 15_000 }, destination: { kind: 'wallet', walletId: 'savings' }, events: [{ at: now, since: now - STUCK_WAIT_MS - 1, outcome: 'skipped', reason: 'balance_unverified', detail: 'BREEZ_SYNC_TIMEOUT' }] };
  assert.deepEqual(statusText(rule, ctx), { text: "Can't check the balance", tone: 'warn' });
  const copy = attentionCopy(rule, { walletName: 'Shop', balanceSats: 15_962 }, ctx);
  assert.equal(copy.line, "Auto-Transfer can't check Shop's balance");
  assert.equal(copy.canRetry, true);
  assert.match(copy.text, /^Checking the balance took too long\. 15,962 sats stays in Shop\.$/);
});
