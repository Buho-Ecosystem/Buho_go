/**
 * Turning transactions into a record someone else can read.
 *
 * This is the one place in the app where being wrong is worse than being
 * incomplete. The file goes to an accountant or a tax office, and a number
 * that looks authoritative but is not is a liability. So the rules here are
 * stricter than anywhere else in the codebase:
 *
 *   - A field we cannot establish is EMPTY, never zero and never a guess.
 *     Zero is a claim; empty is an admission.
 *   - A figure is only reported in a unit we can prove it is in.
 *   - The fiat value comes from the rate recorded at settlement, or from a
 *     historical price looked up for that day. Today's rate NEVER stands in
 *     for either — a Bitcoin balance restated at today's price is the single
 *     most common way one of these documents becomes false.
 *
 * The three columns that decide whether this is a tax record or just a
 * receipt are the amount, the rate used, and the fiat value at the time.
 * PSD2 reg. 46(2)(d) asks for "the exchange rate used and the amount before
 * conversion"; HMRC asks for the value "as at the date of the transaction";
 * the IRS asks for fair market value at receipt. Miss any one of the three
 * and the reader has to redo the work.
 *
 * Pure module: rows in, text out. No stores, no network, no clock.
 */

import { txTimeMs } from './time.js';

/** Sats in one bitcoin. */
const SATS_PER_BTC = 100000000;

/**
 * A transaction we can state a fee for.
 *
 * An internal transfer between the user's own wallets is not a fee the user
 * paid to anyone, and a row whose fee was never measured reports none rather
 * than reporting zero — the two are different facts and only one of them is
 * true here.
 */
function feeSatsOf(tx) {
  if (!tx || typeof tx !== 'object') return null;

  // A normalised transaction always carries `feeSats`, and its value of null
  // is a statement: Arkade reports no fee figure at all, so the fee is
  // UNKNOWN. Falling through to the raw `fee` here would answer that with 0,
  // which claims the payment was free — a different fact, and not the true
  // one. So the key being present settles it, whatever it holds.
  const raw = 'feeSats' in tx ? tx.feeSats : tx.fee;
  if (raw === null || raw === undefined || raw === '') return null;
  const fee = Number(raw);
  return Number.isFinite(fee) && fee >= 0 ? fee : null;
}

/**
 * A positive sats figure, or null when the field is absent or unusable.
 *
 * Zero sats is treated as no figure on purpose: no provider in this app
 * settles a zero-value payment, so a zero here means a field that was never
 * populated, and printing "0" would state something the record does not know.
 */
function satsOrNull(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Math.abs(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * What the other side of the payment received (or sent).
 *
 * Deliberately `recipientSats` rather than the raw `amount`, because `amount`
 * does not mean the same thing across providers: Spark's includes the fee,
 * LNbits' and NWC's exclude it, and Arkade reports only a single total. The
 * normaliser has already reconciled those into one meaning; reading `amount`
 * here would undo that and quietly overstate what a Spark send delivered by
 * the size of its fee.
 */
function amountSatsOf(tx) {
  return satsOrNull(tx?.recipientSats) ?? satsOrNull(tx?.amount);
}

/**
 * What the wallet actually moved: the amount plus whatever the fee was.
 *
 * The figure someone reconciling a balance needs, and the one that differs
 * from the amount by exactly the fee — stated as its own column so neither
 * has to be inferred by adding two others together.
 */
function totalSatsOf(tx) {
  return satsOrNull(tx?.totalSats) ?? satsOrNull(tx?.amount);
}

/** ISO 8601 in UTC: unambiguous, fixed-width, and it sorts lexicographically. */
function isoUtc(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return '';
  return new Date(t).toISOString();
}

/** The wall-clock time the user experienced, kept beside the UTC one. */
function localTime(ms, locale) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return '';
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      dateStyle: 'short', timeStyle: 'short',
    }).format(t);
  } catch {
    return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  }
}

function timeZoneName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/**
 * Round to 2 decimals as a string, or '' when there is nothing to state.
 *
 * The null check is explicit and load-bearing: Number(null) is 0 and
 * Number('') is 0, so leaning on Number.isFinite alone turns "we could not
 * establish this" into a confident 0.00 — the exact claim this module exists
 * to refuse.
 */
function money(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '';
}

/**
 * Flatten one transaction into the fields the report carries.
 *
 * @param {object} tx        a normalised transaction (services/txNormalizer.js)
 * @param {object} ctx
 * @param {string} ctx.walletName    which wallet it belongs to
 * @param {object|null} ctx.rate     { currency, rate, source, at } or null
 * @param {string} [ctx.counterparty]
 * @param {string} [ctx.locale]
 * @returns {object} one report row
 */
export function toReportRow(tx, ctx = {}) {
  const { walletName = '', rate = null, counterparty = '', locale = '' } = ctx;

  const ms = txTimeMs(tx);
  const sats = amountSatsOf(tx);
  const hasSats = sats !== null;
  const fee = feeSatsOf(tx);
  const total = totalSatsOf(tx);

  // The fiat value is only ever the amount multiplied by the rate that
  // applied THEN. No rate, no value — the column stays empty and the summary
  // says how many rows that happened to.
  const fiatValue = rate && hasSats ? (sats / SATS_PER_BTC) * rate.rate : null;

  return {
    // When
    dateUtc: isoUtc(ms),
    dateLocal: localTime(ms, locale),
    timeZone: timeZoneName(),

    // Where from
    wallet: walletName,

    // What kind of movement
    direction: tx?.type === 'incoming' ? 'Received' : 'Sent',
    status: tx?.status || '',

    // How much
    amountSats: hasSats ? sats : null,
    amountBtc: hasSats ? (sats / SATS_PER_BTC).toFixed(8) : '',
    feeSats: fee,
    totalSats: total,

    // What it was worth then
    fiatCurrency: rate?.currency || '',
    fiatValueAtTime: money(fiatValue),
    btcPriceAtTime: rate ? money(rate.rate) : '',
    rateSource: rate?.source || '',
    rateTimeUtc: rate?.at ? isoUtc(rate.at) : '',

    // What it was
    description: tx?.description || tx?.memo || '',
    counterparty,

    // How to find it again
    transactionId: tx?.id || '',
    paymentHash: tx?.paymentHash || '',
    preimage: tx?.preimage || '',
    invoice: tx?.bolt11 || tx?.payment_request || '',
  };
}

/** Column order, and the heading each one carries. One list, so the CSV and
 *  the XML can never drift apart. */
export const REPORT_COLUMNS = Object.freeze([
  ['dateUtc', 'Date (UTC)'],
  ['dateLocal', 'Date (local)'],
  ['timeZone', 'Time zone'],
  ['wallet', 'Wallet'],
  ['direction', 'Direction'],
  ['status', 'Status'],
  ['amountSats', 'Amount (sats)'],
  ['amountBtc', 'Amount (BTC)'],
  ['feeSats', 'Fee (sats)'],
  ['totalSats', 'Total incl. fee (sats)'],
  ['fiatCurrency', 'Currency'],
  ['fiatValueAtTime', 'Value at time'],
  ['btcPriceAtTime', 'BTC price at time'],
  ['rateSource', 'Rate source'],
  ['rateTimeUtc', 'Rate timestamp (UTC)'],
  ['description', 'Description'],
  ['counterparty', 'Counterparty'],
  ['transactionId', 'Transaction ID'],
  ['paymentHash', 'Payment hash'],
  ['preimage', 'Preimage'],
  ['invoice', 'Invoice'],
]);

/**
 * Escape one CSV field per RFC 4180.
 *
 * The leading-character guard is not decoration: a description beginning
 * =, +, - or @ is executed as a formula by Excel and Sheets the moment the
 * file is opened. A payment memo is exactly the kind of user-supplied string
 * that carries one. Prefixing a tab neutralises it and still reads.
 */
function csvField(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `\t${s}`;
  if (/["\n\r,]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {object[]} rows from toReportRow
 * @returns {string} RFC 4180 text with CRLF endings and a UTF-8 BOM, so Excel
 *   on Windows reads the accents instead of mangling them.
 */
export function toCsv(rows) {
  const head = REPORT_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const body = (rows || []).map((row) =>
    REPORT_COLUMNS.map(([key]) => csvField(row[key])).join(','));
  return `﻿${[head, ...body].join('\r\n')}\r\n`;
}

/** XML text escaping, plus stripping the control characters XML 1.0 forbids. */
function xmlText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    // Explicit escapes, never literal control characters: a literal class
    // is unreadable in review, and one stray byte turns it into a range
    // that strips ordinary punctuation out of every description.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * The same rows as XML, for bookkeeping software that ingests it.
 *
 * Empty fields are omitted rather than written as empty elements: an absent
 * element reads as "not known", where `<feeSats></feeSats>` invites being
 * parsed as zero.
 */
export function toXml(rows, meta = {}) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<buhogoReport>'];

  lines.push('  <meta>');
  for (const [key, value] of Object.entries(meta)) {
    if (value === null || value === undefined || value === '') continue;
    lines.push(`    <${key}>${xmlText(value)}</${key}>`);
  }
  lines.push('  </meta>');

  lines.push('  <transactions>');
  for (const row of rows || []) {
    lines.push('    <transaction>');
    for (const [key] of REPORT_COLUMNS) {
      const value = row[key];
      if (value === null || value === undefined || value === '') continue;
      lines.push(`      <${key}>${xmlText(value)}</${key}>`);
    }
    lines.push('    </transaction>');
  }
  lines.push('  </transactions>');
  lines.push('</buhogoReport>');
  return `${lines.join('\n')}\n`;
}

/**
 * Totals for the summary block.
 *
 * Received and sent are kept apart rather than netted: a net figure hides
 * turnover, and turnover is the number a tax return asks for.
 *
 * `missingRates` counts rows whose value at the time could not be
 * established, so the document can say so out loud instead of quietly
 * totalling a subset and presenting it as the whole.
 */
export function summarise(rows) {
  let receivedSats = 0;
  let sentSats = 0;
  let feeSats = 0;
  let receivedFiat = 0;
  let sentFiat = 0;
  let missingRates = 0;
  let currency = '';
  let firstMs = null;
  let lastMs = null;

  for (const row of rows || []) {
    const sats = Number(row.amountSats) || 0;
    const isReceived = row.direction === 'Received';
    if (isReceived) receivedSats += sats;
    else sentSats += sats;
    feeSats += Number(row.feeSats) || 0;

    const fiat = row.fiatValueAtTime === '' ? null : Number(row.fiatValueAtTime);
    if (fiat === null || !Number.isFinite(fiat)) {
      missingRates += 1;
    } else {
      if (isReceived) receivedFiat += fiat;
      else sentFiat += fiat;
      if (!currency) currency = row.fiatCurrency;
    }

    const t = row.dateUtc ? Date.parse(row.dateUtc) : NaN;
    if (Number.isFinite(t)) {
      if (firstMs === null || t < firstMs) firstMs = t;
      if (lastMs === null || t > lastMs) lastMs = t;
    }
  }

  return {
    count: (rows || []).length,
    receivedSats,
    sentSats,
    netSats: receivedSats - sentSats,
    feeSats,
    receivedFiat: receivedFiat.toFixed(2),
    sentFiat: sentFiat.toFixed(2),
    netFiat: (receivedFiat - sentFiat).toFixed(2),
    currency,
    missingRates,
    firstUtc: firstMs === null ? '' : new Date(firstMs).toISOString(),
    lastUtc: lastMs === null ? '' : new Date(lastMs).toISOString(),
  };
}
