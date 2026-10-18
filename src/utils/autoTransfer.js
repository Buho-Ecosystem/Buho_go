/**
 * Auto-Transfer rules: what a rule is, where it may send, how much it moves,
 * and what its recent activity says. Pure: stores/autoWithdraw.js runs the
 * transfers, the screens word them.
 *
 * A rule reads as a sentence:
 *
 *   When <wallet> holds more than <threshold>,
 *   move everything (no keep) or everything above <keep>
 *   to <destination>.
 *
 * Amounts are kept the way they were typed: `{ sats }`, or `{ fiat,
 * currency }` for "more than $500". A fiat amount is converted with the
 * rate of the moment the rule runs, so it keeps meaning $500 while the
 * price moves; without a recent rate the rule waits instead of guessing.
 *
 * The destination is another wallet on this phone or an address. The
 * payment route follows from the two ends, never from a choice the person
 * makes: Spark to Spark is free, a Bitcoin address goes on-chain, anything
 * else pays over Lightning.
 */

import { canWalletPay, canWalletReceiveLightning } from './walletCapabilities.js';
import { classifyDestination, normalizeDestination } from './clipboardSuggestion.js';

export const DESTINATION_KIND = Object.freeze({
  WALLET: 'wallet',
  LIGHTNING: 'lightning',
  SPARK: 'spark',
  ARKADE: 'arkade',
  BITCOIN: 'bitcoin',
});

export const ROUTE = Object.freeze({
  SPARK: 'spark',
  ARKADE: 'arkade',
  LIGHTNING: 'lightning',
  BITCOIN: 'bitcoin',
});

/** Below this a transfer is not worth making. */
export const MIN_TRANSFER_SATS = 10;

/**
 * Held back on routes whose fee is only known once paid (Lightning, Arkade):
 * 1% of the amount, at least 10 sats. Spark-to-Spark is free and quotes
 * nothing; on-chain uses the quote for the chosen speed instead.
 */
export const ROUTE_RESERVE_RATE = 0.01;
export const ROUTE_RESERVE_MIN_SATS = 10;

/** A fiat amount is converted only with a rate at most this old. */
export const MAX_RATE_AGE_MINUTES = 60;

/** A rule pauses itself after this many failures in a row. */
export const PAUSE_AFTER_FAILURES = 5;
export const MAX_EVENTS = 20;

export const PAUSED = Object.freeze({
  FAILURES: 'failures',
  MOVED: 'moved',
  DESTINATION_REMOVED: 'destination_removed',
});

export const OUTCOME = Object.freeze({ SENT: 'sent', SKIPPED: 'skipped', FAILED: 'failed' });

/** Why a destination cannot be used for a wallet's rule. */
export const DESTINATION_PROBLEM = Object.freeze({
  MISSING: 'missing',
  SELF: 'self',
  LOOP: 'loop',
  CANNOT_PAY: 'cannot_pay',
  CANNOT_RECEIVE: 'cannot_receive',
  UNKNOWN: 'unknown',
});

const KIND_BY_PAYMENT_TYPE = {
  lightning_address: DESTINATION_KIND.LIGHTNING,
  spark_address: DESTINATION_KIND.SPARK,
  arkade_address: DESTINATION_KIND.ARKADE,
  bitcoin_address: DESTINATION_KIND.BITCOIN,
};

// The payment types canWalletPay understands, per destination kind.
const PAYMENT_TYPE_BY_KIND = {
  [DESTINATION_KIND.LIGHTNING]: 'lightning_address',
  [DESTINATION_KIND.SPARK]: 'spark_address',
  [DESTINATION_KIND.ARKADE]: 'arkade_address',
  [DESTINATION_KIND.BITCOIN]: 'bitcoin_address',
};

const OLD_PAYOUT_KINDS = {
  lightning: [DESTINATION_KIND.LIGHTNING, 'lightningAddress'],
  spark: [DESTINATION_KIND.SPARK, 'sparkAddress'],
  arkade: [DESTINATION_KIND.ARKADE, 'arkadeAddress'],
  onchain: [DESTINATION_KIND.BITCOIN, 'bitcoinAddress'],
};

const count = (value) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * An amount as typed: `{ sats }` or `{ fiat, currency }` (upper-case code).
 * Anything else, or nothing above zero, is null.
 */
export function normalizeAmount(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return count(raw) ? { sats: count(raw) } : null;
  const fiat = Number(raw.fiat);
  if (Number.isFinite(fiat) && fiat > 0 && raw.currency) {
    return { fiat: Math.round(fiat * 100) / 100, currency: String(raw.currency).toUpperCase() };
  }
  return count(raw.sats) ? { sats: count(raw.sats) } : null;
}

/**
 * Sats for an amount. `rateFor(currency)` gives fiat per bitcoin, or a
 * falsy value when no usable rate is known; then a fiat amount is null.
 */
export function amountSats(amount, rateFor = () => 0) {
  if (!amount) return 0;
  if (amount.sats != null) return count(amount.sats);
  const rate = Number(rateFor(amount.currency));
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return Math.round((amount.fiat / rate) * 1e8);
}

/**
 * A saved rule in today's shape. Rules saved before destinations had a
 * kind (`payoutType` plus one address field per route) read the same way.
 */
export function normalizeRule(raw = {}) {
  let destination = raw.destination || null;
  if (!destination && raw.payoutType !== undefined) {
    const [kind, field] = OLD_PAYOUT_KINDS[raw.payoutType] || OLD_PAYOUT_KINDS.lightning;
    const address = String(raw[field] || '').trim();
    destination = address ? { kind, address } : null;
  }
  return {
    enabled: raw.enabled === true,
    threshold: normalizeAmount(raw.threshold ?? raw.thresholdSats),
    keep: normalizeAmount(raw.keep ?? raw.keepSats),
    destination,
    feeSpeed: ['low', 'medium', 'high'].includes(raw.feeSpeed) ? raw.feeSpeed : 'medium',
    pausedReason: Object.values(PAUSED).includes(raw.pausedReason) ? raw.pausedReason : null,
    failureStreak: count(raw.failureStreak),
    events: Array.isArray(raw.events) ? raw.events.slice(0, MAX_EVENTS) : [],
    lastTriggeredAt: raw.lastTriggeredAt ?? null,
  };
}

/**
 * Read pasted or scanned text as a destination for a wallet of `walletType`.
 * @returns {{ kind: string, address: string }|null} null when it is none of
 *   the kinds a rule can send to (invoices expire, so they are not one)
 */
export function readDestination(text, walletType) {
  const type = classifyDestination(text, walletType);
  const kind = KIND_BY_PAYMENT_TYPE[type];
  if (!kind) return null;
  const { cleaned } = normalizeDestination(text, walletType);
  return cleaned ? { kind, address: cleaned } : null;
}

/** How a transfer from a wallet of `sourceType` to `destination` travels. */
export function routeFor(sourceType, destination, destinationWallet = null) {
  switch (destination?.kind) {
    case DESTINATION_KIND.SPARK: return ROUTE.SPARK;
    case DESTINATION_KIND.ARKADE: return ROUTE.ARKADE;
    case DESTINATION_KIND.BITCOIN: return ROUTE.BITCOIN;
    case DESTINATION_KIND.WALLET:
      return sourceType === 'spark' && destinationWallet?.type === 'spark' ? ROUTE.SPARK : ROUTE.LIGHTNING;
    default: return ROUTE.LIGHTNING;
  }
}

/** Sats held back for the fee on routes without a quote. */
export function routeReserve(route, amountSats) {
  if (route === ROUTE.SPARK || route === ROUTE.BITCOIN) return 0;
  return Math.max(ROUTE_RESERVE_MIN_SATS, Math.ceil(count(amountSats) * ROUTE_RESERVE_RATE));
}

/**
 * How much a transfer moves from `balanceSats`: what is above `keepSats`,
 * less the fee (`feeSats` when quoted, else the route's reserve). 0 when the
 * rule does not apply yet or nothing worth sending is left.
 */
export function transferAmount({ balanceSats, thresholdSats, keepSats = 0, route, feeSats = null }) {
  const balance = Number(balanceSats);
  if (!Number.isFinite(balance) || !thresholdSats || balance <= thresholdSats) return 0;
  const available = Math.floor(balance) - count(keepSats);
  if (available <= 0) return 0;
  const fee = feeSats == null ? routeReserve(route, available) : count(feeSats);
  const amount = available - fee;
  return amount >= MIN_TRANSFER_SATS ? amount : 0;
}

/**
 * Following rules from `startId` through wallet destinations, does the money
 * come back to `startId`? A loop would move the same sats around forever.
 * `rules` maps wallet id to rule; `proposed` is the destination being chosen.
 */
export function wouldLoop(startId, proposed, rules) {
  let next = proposed?.kind === DESTINATION_KIND.WALLET ? proposed.walletId : null;
  const seen = new Set();
  while (next && !seen.has(next)) {
    if (next === startId) return true;
    seen.add(next);
    const rule = rules?.[next];
    next = rule?.enabled && rule.destination?.kind === DESTINATION_KIND.WALLET ? rule.destination.walletId : null;
  }
  return false;
}

/**
 * Why `destination` cannot take transfers from `source`, or null when it can.
 * @param {object} input
 * @param {object} input.source        the wallet the rule belongs to
 * @param {object} input.destination   { kind, address } or { kind: 'wallet', walletId }
 * @param {object[]} input.wallets     the wallets on this phone
 * @param {Record<string, object>} input.rules  every saved rule, for loops
 */
export function destinationProblem({ source, destination, wallets = [], rules = {} }) {
  if (!source || !destination?.kind) return DESTINATION_PROBLEM.UNKNOWN;
  const sourceType = source.type || 'nwc';
  if (destination.kind === DESTINATION_KIND.WALLET) {
    const target = wallets.find((w) => w.id === destination.walletId);
    if (!target) return DESTINATION_PROBLEM.MISSING;
    if (target.id === source.id) return DESTINATION_PROBLEM.SELF;
    if (routeFor(sourceType, destination, target) === ROUTE.LIGHTNING) {
      if (!canWalletPay(sourceType, 'lightning_address')) return DESTINATION_PROBLEM.CANNOT_PAY;
      if (!canWalletReceiveLightning(target)) return DESTINATION_PROBLEM.CANNOT_RECEIVE;
    }
    if (wouldLoop(source.id, destination, rules)) return DESTINATION_PROBLEM.LOOP;
    return null;
  }
  const paymentType = PAYMENT_TYPE_BY_KIND[destination.kind];
  if (!paymentType || !destination.address) return DESTINATION_PROBLEM.UNKNOWN;
  if (!canWalletPay(sourceType, paymentType)) return DESTINATION_PROBLEM.CANNOT_PAY;
  // Arkade can pay a Bitcoin address in the send flow, but not from a rule yet.
  if (destination.kind === DESTINATION_KIND.BITCOIN && sourceType !== 'spark') return DESTINATION_PROBLEM.CANNOT_PAY;
  return null;
}

/** Why a transfer failed, in one of a few words the screens can say. */
export function failureReason(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  if (code === 'NWC_PAYMENT_UNCONFIRMED') return 'unconfirmed';
  if (error?.counterparty || code === 'COUNTERPARTY_ERROR') return 'refused';
  if (/insufficient|not enough|balance too low/.test(message)) return 'insufficient';
  if (/invalid .*address|no .*address configured|could not resolve|failed to fetch|not found|404/.test(message)) return 'unreachable';
  if (/timeout|timed out|network|offline|connect|unreachable|transport/.test(message)) return 'offline';
  return 'other';
}

/**
 * Add an event to a rule's recent activity, newest first. A skip with the
 * same reason as the newest event only moves its time, so a rule that waits
 * on every balance tick keeps one line, not twenty.
 */
export function addEvent(events, event) {
  const list = Array.isArray(events) ? events : [];
  const [newest] = list;
  if (event.outcome === OUTCOME.SKIPPED && newest?.outcome === OUTCOME.SKIPPED && newest.reason === event.reason) {
    return [{ ...newest, at: event.at }, ...list.slice(1)];
  }
  return [event, ...list].slice(0, MAX_EVENTS);
}

const BLOCKING = new Set(Object.values(DESTINATION_PROBLEM));

/**
 * Where a rule stands, for its row and its page:
 *   'attention' its newest transfer failed, it cannot reach its destination
 *               at all, or it paused itself after failures; `event` says why
 *   'paused'    switched off (with `reason` when the app switched it off)
 *   'sent'      it moved money; `event` is the newest transfer
 *   'waiting'   on, nothing moved yet
 * A wait (no rate yet, a balance not checked) never hides the last transfer.
 */
export function ruleStatus(rule) {
  const events = rule?.events || [];
  const newest = events.find((e) => e.outcome !== OUTCOME.SKIPPED) || null;
  if (rule?.pausedReason === PAUSED.FAILURES) return { kind: 'attention', event: newest };
  if (!rule?.enabled) return { kind: 'paused', reason: rule?.pausedReason || null };
  if (events[0]?.outcome === OUTCOME.SKIPPED && BLOCKING.has(events[0].reason)) return { kind: 'attention', event: events[0] };
  if (newest?.outcome === OUTCOME.FAILED) return { kind: 'attention', event: newest };
  if (newest?.outcome === OUTCOME.SENT) return { kind: 'sent', event: newest };
  return { kind: 'waiting' };
}

/**
 * Three round amounts a "holds more than" can start from: the first steps
 * on the 1-2.5-5 ladder above what the wallet holds now.
 */
export function thresholdSuggestions(balanceSats) {
  const ladder = [];
  for (let power = 4; power <= 9; power++) for (const step of [1, 2.5, 5]) ladder.push(step * 10 ** power);
  const above = ladder.filter((n) => n > Math.max(0, Number(balanceSats) || 0));
  return above.slice(0, 3);
}

/**
 * What a destination is called: the wallet's name, the contact's name, or
 * the address itself (the screens shorten it).
 */
export function destinationName(destination, wallets = []) {
  if (!destination) return '';
  if (destination.kind === DESTINATION_KIND.WALLET) return wallets.find((w) => w.id === destination.walletId)?.name || '';
  return destination.name || destination.address || '';
}
