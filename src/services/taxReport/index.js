/**
 * The transaction report, from "the user tapped Create" to a file in their
 * hands.
 *
 * The pieces are kept apart on purpose — `collect` knows nothing about
 * formats, `rows` knows nothing about wallets, `pdf` takes bytes and returns
 * bytes — and this is the only module that knows they belong together.
 *
 * Building the report happens once and produces `rows`; the format is chosen
 * afterwards. That ordering matters: gathering the history and looking up
 * historical rates is by far the slowest part, and a user who wants both a
 * PDF for their accountant and a CSV for their spreadsheet should not wait
 * through it twice.
 */

import { collectTransactions, filterForReport } from './collect.js';
import { txTimeMs } from './time.js';
import { createRateLookup, rateFromSnapshot, supportsCurrency } from './rates.js';
import { toReportRow, toCsv, toXml, summarise } from './rows.js';
import { deliverReport } from './delivery.js';

/** Where the report fonts and mark live. Shipped with the app rather than
 *  fetched from a CDN: a tax record is the last thing that should depend on
 *  a font server being reachable. */
const ASSETS = {
  regular: '/fonts/Manrope-Report-Regular.ttf',
  semibold: '/fonts/Manrope-Report-SemiBold.ttf',
  logo: '/buho-mark-512.png',
};

let assetCache = null;

async function loadBytes(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Fetched once per session; the files never change under us. */
async function loadAssets() {
  if (assetCache) return assetCache;
  const [regular, semibold] = await Promise.all([
    loadBytes(ASSETS.regular),
    loadBytes(ASSETS.semibold),
  ]);
  // A missing mark must never stop a report being produced.
  let logo = null;
  try {
    logo = await loadBytes(ASSETS.logo);
  } catch {
    logo = null;
  }
  assetCache = { fonts: { regular, semibold }, logo };
  return assetCache;
}

/** `buhogo-report-2026-01-01_2026-08-27.pdf` */
function filenameFor(meta, extension) {
  const from = (meta.periodFromIso || '').slice(0, 10);
  const to = (meta.periodToIso || '').slice(0, 10);
  const span = from && to ? `${from}_${to}` : (meta.generatedIso || '').slice(0, 10);
  return `buhogo-report-${span || 'export'}.${extension}`;
}

/**
 * Gather everything the report needs. The slow half of the feature.
 *
 * @param {object} input
 * @param {object[]} input.wallets    the wallets the user picked
 * @param {Record<string, object>} [input.providers] already-live, by wallet id
 * @param {(wallet) => Promise<object|null>} [input.connect] opens one that is not
 * @param {(raw, ctx) => object} input.normalize
 * @param {(txId: string, walletId: string) => object|null} [input.snapshotFor]
 *   the rate the app recorded at settlement, when it has one
 * @param {(txId: string, walletId: string) => string} [input.counterpartyFor]
 * @param {string} input.currency
 * @param {{ fromMs: number|null, toMs: number|null }} input.period
 * @param {string} [input.locale]
 * @param {(p: object) => void} [input.onProgress]
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<{ rows, summary, meta }>}
 */
export async function buildReport({
  wallets,
  providers,
  connect,
  normalize,
  snapshotFor,
  counterpartyFor,
  currency,
  period = { fromMs: null, toMs: null },
  locale,
  onProgress,
  signal,
} = {}) {
  const cur = String(currency || '').toUpperCase();

  onProgress?.({ phase: 'collecting', done: 0, total: 1 });
  const collected = await collectTransactions({
    wallets, providers, connect, normalize, signal,
    onProgress: (p) => onProgress?.({ phase: 'collecting', ...p }),
  });

  const kept = filterForReport(collected.rows, period);

  // Rates second, and only for what survived the filter: looking one up for a
  // transaction outside the period would be work nobody asked for.
  const lookup = createRateLookup({ currency: cur });
  const rows = [];
  let done = 0;
  for (const tx of kept) {
    if (signal?.aborted) break;
    const ms = txTimeMs(tx);
    const rate = rateFromSnapshot(snapshotFor?.(tx.id, tx.walletId), cur)
      || await lookup.at(ms);
    rows.push(toReportRow(tx, {
      walletName: tx.walletName,
      rate,
      counterparty: counterpartyFor?.(tx.id, tx.walletId) || '',
      locale,
    }));
    done += 1;
    if (done % 10 === 0) onProgress?.({ phase: 'pricing', done, total: kept.length });
  }
  onProgress?.({ phase: 'pricing', done: rows.length, total: kept.length });

  const summary = summarise(rows);
  const generated = new Date();

  return {
    rows,
    summary,
    meta: {
      title: 'Transaction report',
      subtitle: 'BuhoGO',
      currency: cur,
      currencySupported: supportsCurrency(cur),
      walletsLabel: collected.readWallets.join(', '),
      periodFromIso: period.fromMs ? new Date(period.fromMs).toISOString() : '',
      periodToIso: period.toMs ? new Date(period.toMs).toISOString() : '',
      generatedIso: generated.toISOString(),
      readWallets: collected.readWallets,
      failedWallets: collected.failedWallets,
      truncatedWallets: collected.truncatedWallets,
      // Per wallet, so the sheet can show what each one actually gave rather
      // than a single sentence covering all of them.
      walletResults: collected.walletResults,
      // Stated on the document itself, not just in the UI: whoever reads the
      // file later has no other way to know the picture is partial.
      failedNote: collected.failedWallets.length
        ? `${collected.failedWallets.join(', ')} could not be read, so no transactions from ${collected.failedWallets.length > 1 ? 'them' : 'it'} appear here.`
        : '',
      truncatedNote: collected.truncatedWallets.length
        ? `${collected.truncatedWallets.join(', ')} has more history than this report covers; the oldest transactions are not included.`
        : '',
    },
  };
}

/**
 * Turn a built report into one file and hand it over.
 *
 * @param {object} report from buildReport
 * @param {'pdf'|'csv'|'xml'} format
 * @returns {Promise<{ saved, shared, filename, path? }>}
 */
export async function exportReport(report, format) {
  const meta = report?.meta || {};
  const filename = filenameFor(meta, format);
  const title = `BuhoGO report ${(meta.periodFromIso || meta.generatedIso || '').slice(0, 10)}`.trim();

  if (format === 'csv') {
    const result = await deliverReport({ filename, data: toCsv(report.rows), kind: 'csv', title });
    return { ...result, filename };
  }

  if (format === 'xml') {
    const result = await deliverReport({
      filename, data: toXml(report.rows, meta), kind: 'xml', title,
    });
    return { ...result, filename };
  }

  const { renderReportPdf } = await import('./pdf.js');
  const { fonts, logo } = await loadAssets();
  const periodLabel = meta.periodFromIso
    ? `${meta.periodFromIso.slice(0, 10)} to ${(meta.periodToIso || meta.generatedIso).slice(0, 10)}`
    : 'All transactions';
  const bytes = await renderReportPdf(
    { ...report, meta: { ...meta, periodLabel } },
    { fonts, logo: logo || undefined },
  );
  const result = await deliverReport({ filename, data: bytes, kind: 'pdf', title });
  return { ...result, filename };
}

export { standardPeriods } from './collect.js';
export { supportsCurrency, SUPPORTED_CURRENCIES } from './rates.js';
