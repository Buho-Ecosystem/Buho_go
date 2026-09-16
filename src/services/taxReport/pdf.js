/**
 * The transaction report, laid out on real PDF pages.
 *
 * This document goes to an accountant or a tax office, so it is built to the
 * conventions they already read rather than to the app's own screen language:
 *
 *  - ORDER: identity, period, summary, then the line items. Summary BEFORE
 *    the detail — that ordering is consistent across bank and processor
 *    statements, and it is what lets a reader decide in five seconds whether
 *    they need the table at all.
 *
 *  - THE TRIPLE THAT MATTERS: amount, the rate used, and the value at the
 *    time, on every line. A statement missing any one of the three sends the
 *    reader back to do the work themselves.
 *
 *  - PAGE GEOMETRY: rendered on A4, but paginated against the height of US
 *    Letter. Letter is shorter and wider, A4 taller and narrower; fitting the
 *    content box inside both means the same page breaks hold on either stock,
 *    so a Letter variant is a one-line change that can never drop a row.
 *
 *  - DATES are ISO 8601 in the table, whatever the app's language. It is the
 *    only format that sorts lexicographically, it is fixed width, and it
 *    removes the most expensive ambiguity in cross-border bookkeeping: 03/04
 *    is two different days.
 *
 *  - BRAND, SPARINGLY. Green appears in three places: the rule under the
 *    header, the table head as a pale tint, and the rule above the totals.
 *    Figures are always black. A document whose numbers are brand-coloured
 *    reads as marketing, and a number that reads as marketing reads as a
 *    claim rather than a fact. It also has to survive a photocopier, which is
 *    where most statements end up.
 *
 *  - REAL TEXT, REAL FONT. The built-in PDF faces cover Windows ANSI only,
 *    and a payment memo can contain anything. Manrope — the app's own face —
 *    is embedded, so the document is both correct and recognisably BuhoGO.
 *
 * No I/O: fonts and logo arrive as bytes, so this module is unit-testable
 * under plain node and cannot stall on a network.
 */

// ── Geometry, in PDF points (72 per inch) ───────────────────────────────────

const A4 = { width: 595.28, height: 841.89 };
const LETTER_HEIGHT = 792;
const MARGIN = { top: 48, right: 42.52, bottom: 56.69, left: 42.52 };

/** 510.24pt — inside Letter's width with room on both sides. */
const CONTENT_WIDTH = A4.width - MARGIN.left - MARGIN.right;

/** Derived from Letter, not A4. Break against the shorter stock and the
 *  layout stays valid on both. */
const BOTTOM_LIMIT = MARGIN.top + (LETTER_HEIGHT - MARGIN.top - MARGIN.bottom);

const T = {
  title: 17, subtitle: 10, section: 8, label: 7.5, value: 9,
  tableHead: 7.5, body: 8.5, total: 9.5, grandTotal: 11, footer: 7,
};

const ROW_HEIGHT = 16;
const HEAD_HEIGHT = 21;

// BuhoGO's palette. The darker green is the one used on paper: #15DE72 is
// built for a dark screen and is too light to read on white.
const BRAND = '#15A35B';
const INK = '#000000';
const INK_SOFT = '#595959';
const INK_FAINT = '#8C8C8C';
const TINT = '#EAF7F0';
const RULE = { hair: 0.25, thin: 0.5, total: 0.75 };

/** Thrown for the failures a caller can explain to a user. */
export class ReportPdfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReportPdfError';
  }
}

/**
 * Widths sum to CONTENT_WIDTH. Description is the elastic column; the rest
 * are sized to their widest plausible value so figures never reflow. The
 * rate column is sized for JPY, whose BTC price runs to eight digits.
 */
function columns(currency) {
  const cur = currency || '';
  const cols = [
    { key: 'date', label: 'Date (UTC)', width: 78, align: 'left' },
    { key: 'wallet', label: 'Wallet', width: 62, align: 'left' },
    { key: 'type', label: 'Type', width: 40, align: 'left' },
    { key: 'description', label: 'Description', width: 114.24, align: 'left' },
    { key: 'sats', label: 'Amount (sats)', width: 60, align: 'right' },
    { key: 'fee', label: 'Fee', width: 32, align: 'right' },
    { key: 'rate', label: cur ? `Rate (${cur})` : 'Rate', width: 58, align: 'right' },
    { key: 'value', label: cur ? `Value (${cur})` : 'Value', width: 66, align: 'right' },
  ];

  // The widths must fill the content box exactly. Getting this wrong does not
  // throw — it silently shifts every column right of the mistake and pushes
  // the last one off the page, which is the kind of fault that ships.
  const total = cols.reduce((n, c) => n + c.width, 0);
  if (Math.abs(total - CONTENT_WIDTH) > 0.01) {
    throw new ReportPdfError(
      `Report column widths sum to ${total.toFixed(2)}pt, expected ${CONTENT_WIDTH.toFixed(2)}pt.`,
    );
  }
  return cols;
}

/**
 * Thousands separated by an ordinary space, and it has to be the ordinary one.
 *
 * Every typographically nicer option was tried and each fails in the PDF:
 * Manrope has no glyph for U+2009 or U+202F, so they render as .notdef — a
 * blank three quarters of an em wide that strews the digits across the
 * column. U+00A0 is in the font but draws as a visible box. Only U+0020 is
 * both present and blank in every face.
 *
 * The line-break risk a plain space normally carries does not apply here:
 * every cell is measured and placed by `cell()` rather than handed to
 * pdfkit's layout, so there is nothing left to break.
 */
function group(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
}

/** Two decimals with grouped thousands, or '' for a figure we do not have. */
function money(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const [whole, frac] = n.toFixed(2).split('.');
  return `${Number(whole).toLocaleString('en-US').replace(/,/g, ' ')}.${frac}`;
}

/**
 * A BTC price, to whole units. The cents on an exchange rate are noise in a
 * column this narrow, and the figure that actually matters — the value at the
 * time — carries its own two decimals one column to the right.
 */
function rateFigure(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? group(Math.round(n)) : '';
}

/** `2026-08-27 14:30` — date and minute, which is all a statement needs. */
function tableDate(iso) {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '';
}

/** Truncate to fit, with an ellipsis, so one long memo cannot break a row. */
function fit(doc, text, width) {
  const s = String(text ?? '');
  if (!s) return '';
  if (doc.widthOfString(s) <= width) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(`${s.slice(0, mid)}…`) <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${s.slice(0, lo)}…` : '';
}

/**
 * Replace what the embedded font cannot draw.
 *
 * A missing glyph is not an error in pdfkit: it silently emits .notdef, which
 * Manrope draws as a blank three quarters of an em wide. In a table of
 * figures that is invisible corruption — the reader sees a gap, not a
 * problem. A question mark is ugly and honest, which is the right trade in a
 * document somebody files.
 *
 * Only user-supplied text goes through this. Manrope covers Latin, Latin
 * Extended, Greek and Cyrillic, so in practice it fires for emoji and for
 * scripts the face never had.
 */
function printable(canDraw, text) {
  const s = String(text ?? '');
  if (!s || !canDraw) return s;
  let out = '';
  for (const ch of s) {
    out += canDraw(ch.codePointAt(0)) ? ch : '?';
  }
  return out;
}

/**
 * Draw one cell by measuring and placing it, never by handing pdfkit a width
 * and an alignment.
 *
 * Given both, pdfkit runs its line-breaking and justification machinery even
 * with lineBreak disabled, and any space in the string becomes a stretch
 * point — which turns "45 630 081" into three digits marooned across the
 * column. Measuring and positioning is deterministic, and a table is exactly
 * the place that guarantee is worth the extra line.
 */
/**
 * The Fees cell of the summary block.
 *
 * With no measured fee anywhere, "0 sats" would assert that the payments were
 * free. Arkade reports no fee figure at all, so that is an ordinary case, not
 * an edge one.
 */
function feesLabel(summary) {
  if (summary.unknownFees > 0 && !summary.feeSats) return 'not reported';
  return `${group(summary.feeSats)} sats`;
}

function cell(doc, text, x, y, width, align) {
  const s = String(text ?? '');
  if (!s) return;
  const w = doc.widthOfString(s);
  const at = align === 'right' ? x + width - w : x;
  doc.text(s, at, y, { lineBreak: false });
}

/**
 * How many rows fit on the first page and on each one after it.
 *
 * Worked out before anything is drawn, so a page break can never land
 * between a table head and its first row.
 */
function rowsPerPage(firstTop, laterTop) {
  const first = Math.max(0, Math.floor((BOTTOM_LIMIT - firstTop - HEAD_HEIGHT) / ROW_HEIGHT));
  const later = Math.max(1, Math.floor((BOTTOM_LIMIT - laterTop - HEAD_HEIGHT) / ROW_HEIGHT));
  return { first, later };
}

/**
 * Render the report.
 *
 * @param {object} data
 * @param {object} data.meta     identity, period, wallets, generated time
 * @param {object[]} data.rows   from taxReport/rows.js
 * @param {object} data.summary  from summarise()
 * @param {object} opts
 * @param {{ regular: Uint8Array, semibold: Uint8Array }} opts.fonts  Manrope
 * @param {Uint8Array} [opts.logo]  PNG bytes — pdfkit embeds PNG and JPEG only
 * @param {Date} [opts.now]         injected so a test can pin it
 * @returns {Promise<Uint8Array>}
 */
export async function renderReportPdf(data, { fonts, logo, now = new Date() } = {}) {
  if (!fonts?.regular || !fonts?.semibold) {
    throw new ReportPdfError('The report fonts were not supplied.');
  }

  // Dynamic so pdfkit's ~1.4 MB never lands in the start-up bundle: nobody
  // who does not export a report pays for it.
  const [{ default: PDFDocument }, fontkit] = await Promise.all([
    import('pdfkit'),
    import('fontkit'),
  ]);

  // Read the same bytes pdfkit will embed, purely to know what it can draw.
  let canDraw = null;
  try {
    const probe = fontkit.create(toBytes(fonts.regular));
    canDraw = (cp) => {
      const g = probe.glyphForCodePoint(cp);
      return !!g && g.id !== 0;
    };
  } catch {
    // No predicate: text goes through untouched rather than being mangled.
  }

  const meta = data?.meta || {};
  const rows = data?.rows || [];
  const summary = data?.summary || {};
  const currency = summary.currency || meta.currency || '';
  const cols = columns(currency);

  // `font: null` is required: pdfkit's constructor otherwise reaches for
  // Helvetica, and its BROWSER build ships no standard fonts — it throws
  // before a line is drawn. The node build bundles them, so this is a failure
  // that passes every desktop test and dies in the app.
  const doc = new PDFDocument({
    font: null,
    size: 'A4',
    margins: MARGIN,
    info: {
      Title: meta.title || 'BuhoGO transaction report',
      Author: 'BuhoGO',
      Subject: meta.periodLabel || '',
      CreationDate: now,
    },
  });
  // Raw bytes, so pdfkit uses its own bundled fontkit. A variation instance
  // from a standalone fontkit measures correctly and then throws when the
  // document is finalised — a failure that only surfaces at doc.end(), which
  // is why the two weights are shipped as static faces instead.
  doc.registerFont('body', toBytes(fonts.regular));
  doc.registerFont('bold', toBytes(fonts.semibold));

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const finished = new Promise((resolve) => doc.on('end', resolve));

  const L = MARGIN.left;
  const R = MARGIN.left + CONTENT_WIDTH;

  const rule = (y, colour, weight) => {
    doc.save().lineWidth(weight).strokeColor(colour)
      .moveTo(L, y).lineTo(R, y).stroke().restore();
  };

  // ── Header ────────────────────────────────────────────────────────────
  let y = MARGIN.top;
  if (logo) {
    try {
      doc.image(toBytes(logo), L, y - 2, { fit: [30, 30] });
    } catch {
      // A missing or unreadable mark must never stop a report being produced.
    }
  }
  const titleX = logo ? L + 40 : L;
  doc.font('bold').fontSize(T.title).fillColor(INK)
    .text(meta.title || 'Transaction report', titleX, y, { width: CONTENT_WIDTH - 40 });
  y += 22;
  doc.font('body').fontSize(T.subtitle).fillColor(INK_SOFT)
    .text(meta.subtitle || 'BuhoGO', titleX, y);
  y += 18;
  rule(y, BRAND, RULE.total);
  y += 16;

  // ── What this covers ──────────────────────────────────────────────────
  const facts = [
    ['Period', meta.periodLabel || ''],
    ['Wallets', meta.walletsLabel || ''],
    ['Transactions', String(summary.count ?? rows.length)],
    ['Generated', now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
  ].filter(([, v]) => v);

  const factWidth = CONTENT_WIDTH / 2;
  facts.forEach(([label, value], i) => {
    const x = L + (i % 2) * factWidth;
    const row = Math.floor(i / 2);
    const top = y + row * 26;
    doc.font('body').fontSize(T.label).fillColor(INK_FAINT).text(label, x, top);
    doc.font('bold').fontSize(T.value).fillColor(INK);
    cell(doc, fit(doc, printable(canDraw, value), factWidth - 12), x, top + 9, factWidth - 12, 'left');
  });
  y += Math.ceil(facts.length / 2) * 26 + 10;

  // ── Summary, before the detail ────────────────────────────────────────
  doc.font('bold').fontSize(T.section).fillColor(INK_SOFT).text('SUMMARY', L, y);
  y += 14;
  rule(y, INK_FAINT, RULE.hair);
  y += 10;

  const cells = [
    ['Received', `${group(summary.receivedSats)} sats`, currency ? money(summary.receivedFiat) : ''],
    ['Sent', `${group(summary.sentSats)} sats`, currency ? money(summary.sentFiat) : ''],
    ['Fees', feesLabel(summary), ''],
    ['Net', `${group(summary.netSats)} sats`, currency ? money(summary.netFiat) : ''],
  ];
  const cellWidth = CONTENT_WIDTH / cells.length;
  cells.forEach(([label, sats, fiat], i) => {
    const x = L + i * cellWidth;
    doc.font('body').fontSize(T.label).fillColor(INK_FAINT).text(label, x, y);
    doc.font('bold').fontSize(T.value).fillColor(INK);
    cell(doc, sats, x, y + 10, cellWidth - 8, 'left');
    if (fiat) {
      doc.font('body').fontSize(T.label).fillColor(INK_SOFT);
      cell(doc, `${fiat} ${currency}`, x, y + 22, cellWidth - 8, 'left');
    }
  });
  y += 40;

  // Stated, never hidden: a total that covers only part of the rows has to
  // say so, or the reader will assume it covers all of them.
  const caveats = [];
  if (summary.missingRates > 0) {
    caveats.push(`${summary.missingRates} of ${summary.count} transactions have no recorded exchange rate, so no value is stated for them and they are excluded from the ${currency || 'fiat'} totals.`);
  }
  if (summary.unknownFees > 0) {
    caveats.push(`${summary.unknownFees} of ${summary.count} transactions report no fee figure, so the fee total covers only the rest.`);
  }
  if (meta.truncatedNote) caveats.push(meta.truncatedNote);
  if (meta.failedNote) caveats.push(meta.failedNote);

  for (const note of caveats) {
    doc.font('body').fontSize(T.label).fillColor(INK_SOFT)
      .text(note, L, y, { width: CONTENT_WIDTH });
    y = doc.y + 6;
  }
  y += 4;

  // ── Table ─────────────────────────────────────────────────────────────
  const firstTop = y;
  const laterTop = MARGIN.top;
  const { first, later } = rowsPerPage(firstTop, laterTop);

  const drawHead = (top) => {
    doc.save().rect(L, top, CONTENT_WIDTH, HEAD_HEIGHT).fill(TINT).restore();
    let x = L;
    doc.font('bold').fontSize(T.tableHead).fillColor(INK_SOFT);
    for (const col of cols) {
      cell(doc, fit(doc, col.label, col.width - 8), x + 4, top + 7, col.width - 8, col.align);
      x += col.width;
    }
    return top + HEAD_HEIGHT;
  };

  const drawRow = (row, top) => {
    const values = {
      date: tableDate(row.dateUtc),
      wallet: printable(canDraw, row.wallet),
      type: row.direction,
      description: printable(canDraw, row.description || row.counterparty || ''),
      sats: group(row.amountSats),
      fee: row.feeSats === null || row.feeSats === undefined ? '' : group(row.feeSats),
      rate: rateFigure(row.btcPriceAtTime),
      value: money(row.fiatValueAtTime),
    };
    let x = L;
    doc.font('body').fontSize(T.body).fillColor(INK);
    for (const col of cols) {
      cell(doc, fit(doc, values[col.key], col.width - 8), x + 4, top + 4.5, col.width - 8, col.align);
      x += col.width;
    }
    doc.save().lineWidth(RULE.hair).strokeColor('#E3E3E3')
      .moveTo(L, top + ROW_HEIGHT).lineTo(R, top + ROW_HEIGHT).stroke().restore();
    return top + ROW_HEIGHT;
  };

  let cursor = drawHead(firstTop);
  let onPage = 0;
  let capacity = first;

  for (const row of rows) {
    if (onPage >= capacity) {
      doc.addPage();
      cursor = drawHead(laterTop);
      onPage = 0;
      capacity = later;
    }
    cursor = drawRow(row, cursor);
    onPage += 1;
  }

  if (!rows.length) {
    doc.font('body').fontSize(T.body).fillColor(INK_SOFT)
      .text('No transactions in this period.', L, cursor + 8, {
        width: CONTENT_WIDTH, align: 'center',
      });
    cursor += 24;
  }

  // ── Totals ────────────────────────────────────────────────────────────
  if (rows.length) {
    if (cursor + 40 > BOTTOM_LIMIT) {
      doc.addPage();
      cursor = MARGIN.top;
    }
    cursor += 8;
    rule(cursor, BRAND, RULE.total);
    cursor += 8;

    const netX = L + cols.slice(0, 4).reduce((n, c) => n + c.width, 0);
    doc.font('bold').fontSize(T.total).fillColor(INK);
    cell(doc, 'Net', L, cursor + 2, netX - L - 8, 'right');
    let x = netX;
    const totals = {
      sats: group(summary.netSats),
      fee: summary.unknownFees > 0 && !summary.feeSats ? '' : group(summary.feeSats),
      rate: '',
      value: currency ? money(summary.netFiat) : '',
    };
    for (const col of cols.slice(4)) {
      cell(doc, totals[col.key] || '', x + 4, cursor + 2, col.width - 8, col.align);
      x += col.width;
    }
  }

  // ── Footers, now that the page count is known ─────────────────────────
  const pages = doc.bufferedPageRange ? doc.bufferedPageRange() : { start: 0, count: 1 };
  for (let i = 0; i < pages.count; i += 1) {
    try {
      doc.switchToPage(pages.start + i);
    } catch {
      break; // not buffering pages; the single page keeps its own footer
    }
    const footY = BOTTOM_LIMIT + 14;
    doc.font('body').fontSize(T.footer).fillColor(INK_FAINT)
      .text(meta.footer || 'Generated by BuhoGO. Values are stated at the exchange rate recorded for each transaction.',
        L, footY, { width: CONTENT_WIDTH - 60, lineBreak: false, ellipsis: true })
      .text(`${i + 1} / ${pages.count}`, R - 60, footY, { width: 60, align: 'right', lineBreak: false });
  }

  doc.end();
  await finished;
  return concatBytes(chunks);
}

/** pdfkit wants raw bytes; callers may hand an ArrayBuffer or a view. */
function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(input);
}

/** Join the emitted chunks without Buffer.concat, which is node-only. */
function concatBytes(chunks) {
  const parts = chunks.map(toBytes);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
