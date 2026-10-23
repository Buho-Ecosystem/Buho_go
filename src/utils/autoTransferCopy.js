/**
 * The words Auto-Transfer uses, in one place, so every screen says the same
 * thing the same short way. Pure: callers pass `t` (vue-i18n), the locale,
 * the wallets and the app's sats format.
 *
 * Copy rules: a rule explains itself as a sentence; a status is a few words;
 * a reason is one short sentence. No routes (Lightning, Spark, on-chain) and
 * no "withdrawal" for what is a transfer.
 */

import { formatSatoshis } from './amountFormatting.js';
import { abbreviateDestination } from './clipboardSuggestion.js';
import { DESTINATION_KIND, OUTCOME, PAUSED, isStuckWait, ruleStatus } from './autoTransfer.js';

/**
 * @typedef {object} CopyContext
 * @property {(key: string, values?: object) => string} t
 * @property {string} [locale]
 * @property {boolean} [bip177]   the app's ₿ format (else "sats")
 * @property {object[]} [wallets]
 */

/** An amount as typed: "$500.00" or "₿ 500,000" / "500,000 sats". */
export function formatRuleAmount(amount, { locale = 'en-US', bip177 = true } = {}) {
  if (!amount) return '';
  if (amount.fiat != null) {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: amount.currency }).format(amount.fiat);
    } catch {
      return `${amount.fiat} ${amount.currency}`;
    }
  }
  return formatSatoshis(amount.sats, bip177);
}

export function formatSats(sats, { bip177 = true } = {}) {
  return formatSatoshis(Math.max(0, Math.floor(Number(sats) || 0)), bip177);
}

/** What the destination is called, short enough for one line. */
export function destinationLabel(destination, { wallets = [] } = {}) {
  if (!destination) return '';
  if (destination.kind === DESTINATION_KIND.WALLET) return wallets.find((w) => w.id === destination.walletId)?.name || '';
  if (destination.name) return destination.name;
  if (destination.kind === DESTINATION_KIND.LIGHTNING) return destination.address;
  return abbreviateDestination(destination.address, { head: 8, tail: 6 });
}

/** "3 hours ago", "yesterday", in the person's language. */
export function whenText(at, { locale = 'en-US', now = Date.now() } = {}) {
  if (!at) return '';
  const seconds = Math.round((at - now) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month']];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return unit === 'second' ? format.format(0, 'second') : format.format(Math.round(value), unit);
    value /= size;
  }
  return format.format(Math.round(value), 'year');
}

/**
 * Why a rule did not move money, as one short sentence. `wallet` is the
 * rule's wallet, `destination` its destination's label.
 */
export function reasonText(reason, { t, wallet = '', destination = '', detail = null }) {
  switch (reason) {
    case 'unreachable': return t('{name} didn\'t answer.', { name: destination });
    case 'offline': return t('There was no connection.');
    case 'insufficient': return t('There wasn\'t enough left for the fee.');
    case 'refused': return t('{name} refused it.', { name: destination });
    case 'unconfirmed': return t('It may have gone through, so check {name} first.', { name: destination });
    case 'balance_unverified': return balanceUnverifiedText(detail, { t, wallet });
    case 'no_rate': return t('Waiting for an exchange rate.');
    case 'below_minimum': return t('Too little to move.');
    case 'cannot_pay': return t('{name} can\'t pay this destination right now.', { name: wallet });
    case 'cannot_receive': return t('{name} can\'t receive payments.', { name: destination });
    case 'missing': return t('{name} is no longer on this phone.', { name: destination || t('The destination') });
    case 'loop': return t('It would send the money back to {name}.', { name: wallet });
    case 'self':
    case 'unknown': return t('Choose another destination.');
    default: return t('It didn\'t go through.');
  }
}

/**
 * Why the balance could not be confirmed, from the cause kept with the
 * entry (stores/autoWithdraw.js). Unknown causes keep the general sentence.
 */
function balanceUnverifiedText(detail, { t, wallet }) {
  const cause = String(detail || '');
  if (cause === 'BREEZ_SYNC_TIMEOUT') return t('Checking the balance took too long.');
  if (cause === 'BREEZ_SYNC_UNVERIFIED') return t('The network didn\'t answer the balance check.');
  if (/not connected/i.test(cause) && wallet) return t('{name} isn\'t connected.', { name: wallet });
  return t('The balance couldn\'t be checked.');
}

/**
 * The rule as one sentence: "When Shop holds more than ₿ 500,000, move
 * everything above ₿ 100,000 to Savings."
 */
export function ruleSentence(rule, walletName, ctx) {
  const values = {
    wallet: walletName,
    threshold: formatRuleAmount(rule.threshold, ctx),
    keep: formatRuleAmount(rule.keep, ctx),
    destination: destinationLabel(rule.destination, ctx),
  };
  return rule.keep
    ? ctx.t('When {wallet} holds more than {threshold}, move everything above {keep} to {destination}.', values)
    : ctx.t('When {wallet} holds more than {threshold}, move everything to {destination}.', values);
}

/**
 * The status under a rule in the list, and on Home's line:
 * { text, tone: 'good' | 'warn' | 'muted' | '' }.
 */
export function statusText(rule, ctx) {
  const status = ruleStatus(rule);
  if (status.kind === 'attention') {
    if (rule.pausedReason === PAUSED.FAILURES) return { text: ctx.t('Paused after failed tries'), tone: 'warn' };
    if (isStuckWait(status.event)) return { text: ctx.t("Can't check the balance"), tone: 'warn' };
    return { text: status.event?.outcome === OUTCOME.FAILED ? ctx.t('Couldn\'t send') : ctx.t('Can\'t send'), tone: 'warn' };
  }
  if (status.kind === 'paused') return { text: ctx.t('Paused'), tone: 'muted' };
  if (status.kind === 'sent') {
    return {
      text: ctx.t('Moved {amount} · {when}', { amount: formatSats(status.event.amount, ctx), when: whenText(status.event.at, ctx) }),
      tone: 'good',
    };
  }
  return { text: ctx.t('Over {amount}', { amount: formatRuleAmount(rule.threshold, ctx) }), tone: '' };
}

/** Why a rule is paused, when the app paused it (a footer on its page). */
export function pausedText(rule, ctx) {
  switch (rule.pausedReason) {
    case PAUSED.FAILURES: return ctx.t('Paused after {count} failed tries in a row.', { count: rule.failureStreak || 5 });
    case PAUSED.MOVED: return ctx.t('Paused after an update. Check where it sends, then turn it on.');
    case PAUSED.DESTINATION_REMOVED: return ctx.t('Paused: where it sent is no longer on this phone.');
    default: return '';
  }
}

/** One line of recent activity: { title, detail, value, tone }. */
export function eventRow(event, ctx, names = {}) {
  const when = whenText(event.at, ctx);
  if (event.outcome === OUTCOME.SENT) {
    return { title: formatSats(event.amount, ctx), detail: when, value: ctx.t('Sent'), tone: 'good' };
  }
  const reason = reasonText(event.reason, { t: ctx.t, ...names, detail: event.detail ?? null });
  if (event.outcome === OUTCOME.FAILED) return { title: ctx.t('Couldn\'t send'), detail: `${when} · ${reason}`, value: '', tone: 'warn' };
  return { title: ctx.t('Waited'), detail: `${when} · ${reason}`, value: '', tone: 'muted' };
}

/**
 * What a rule needing attention says (its page and Home's sheet), or null:
 * { line, title, text, canRetry }. `line` is Home's one-line notice.
 */
export function attentionCopy(rule, { walletName, balanceSats = 0 }, ctx) {
  const status = ruleStatus(rule);
  if (status.kind !== 'attention') return null;
  const destination = destinationLabel(rule.destination, ctx) || ctx.t('the destination');
  const reason = reasonText(status.event?.reason, { t: ctx.t, wallet: walletName, destination, detail: status.event?.detail ?? null });
  if (isStuckWait(status.event)) {
    return {
      line: ctx.t("Auto-Transfer can't check {name}'s balance", { name: walletName }),
      title: ctx.t("Can't check the balance"),
      text: `${reason} ${ctx.t('{amount} stays in {name}.', { amount: formatSats(balanceSats, ctx), name: walletName })}`,
      canRetry: true,
    };
  }
  if (rule.pausedReason === PAUSED.FAILURES) {
    return {
      line: ctx.t('Auto-Transfer paused · {name}', { name: walletName }),
      title: ctx.t('Paused after failed tries'),
      text: status.event ? reason : '',
      canRetry: true,
    };
  }
  if (status.event?.outcome === OUTCOME.FAILED) {
    return {
      line: ctx.t("Auto-Transfer couldn't send to {name}", { name: destination }),
      title: ctx.t("Couldn't send to {name}", { name: destination }),
      text: `${reason} ${ctx.t('{amount} stays in {name}.', { amount: formatSats(balanceSats, ctx), name: walletName })}`,
      canRetry: true,
    };
  }
  return {
    line: ctx.t("Auto-Transfer can't send from {name}", { name: walletName }),
    title: ctx.t("Can't send to {name}", { name: destination }),
    text: reason,
    canRetry: false,
  };
}
