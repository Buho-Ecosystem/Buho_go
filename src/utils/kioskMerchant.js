import { satsToFiat } from './amountKeypad.js';
import { fiatToSats } from './fiatCurrencies.js';

export const KIOSK_MERCHANT_VERSION = 1;
export const KIOSK_MERCHANT_KEY = 'buhoGO_kiosk_merchant_v1';
export const LEGACY_KIOSK_PARKED_KEY = 'buhoGO_kiosk_parked_sales';
export const KIOSK_BUNDLE_KIND = 'buhogo-kiosk-backup';
const MAX_TEXT = 160;
/**
 * How long a register request is still checked after it expires: a payment
 * already on its way when the code expired can still arrive. After this one
 * last strict check decides, and checking stops.
 */
export const KIOSK_LATE_PAYMENT_GRACE_MS = 10 * 60 * 1000;
const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;

export function kioskError(code, message) {
  return Object.assign(new Error(message), { code });
}
export const cloneKiosk = value => JSON.parse(JSON.stringify(value));
export const newKioskId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
const fail = message => { throw kioskError('KIOSK_INVALID_DATA', message); };
export function kioskText(value, fallback = '', max = MAX_TEXT) {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback;
}
export function kioskIdentity(value, max = 256) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value !== value.trim() || value.length > max) fail('The saved payment identity is not valid.');
  return value;
}
export function kioskCurrency(value = 'USD') {
  const currency = String(value).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail('Choose a valid price currency.');
  try { new Intl.NumberFormat('en', { style: 'currency', currency }).format(0); } catch { fail('Choose a valid price currency.'); }
  return currency;
}
export function kioskCount(value, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) fail('Use a valid whole amount.');
  return value;
}
const timestamp = value => { kioskCount(value); if (value > 8_640_000_000_000_000) fail('The saved date is not valid.'); return value; };
const safeSum = (a, b) => kioskCount(a + b);
const decimalMinor = minor => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
const minorForSats = (sats, rate) => rate > 0 ? Math.round(satsToFiat(sats, rate) * 100) : null;

export function normalizeKioskProduct(value, currency) {
  if (!value || typeof value !== 'object') fail('Choose a valid product.');
  const name = kioskText(value.name);
  if (!name) fail('Give the product a name.');
  const productCurrency = kioskCurrency(value.currency || currency);
  if (currency && productCurrency !== currency) fail('Products keep the catalog currency.');
  return { id: kioskIdentity(value.id) || newKioskId('product'), name, category: kioskText(value.category), priceMinor: kioskCount(value.priceMinor, { positive: true }), currency: productCurrency };
}

/** A basket stores the unit the merchant actually entered; sats never pass through cents. */
export function normalizeKioskItem(value, currency) {
  if (!value || typeof value !== 'object') fail('Choose a valid basket item.');
  const name = kioskText(value.name);
  if (!name) fail('Give the item a name.');
  const unit = value.unit || (Number.isSafeInteger(value.unitSats) ? 'sats' : 'fiat');
  if (!['fiat', 'sats'].includes(unit)) fail('Choose the item unit.');
  const item = { id: kioskIdentity(value.id) || newKioskId('item'), productId: kioskIdentity(value.productId), name, category: kioskText(value.category), qty: kioskCount(value.qty ?? 1, { positive: true }), unit, currency: kioskCurrency(value.currency || currency || 'USD') };
  if (item.qty > 1_000_000) fail('The item quantity is too large.');
  if (unit === 'fiat') {
    item.priceMinor = kioskCount(value.priceMinor, { positive: true });
    if (currency && item.currency !== currency) fail('A basket cannot mix price currencies.');
    kioskCount(item.priceMinor * item.qty, { positive: true });
  } else {
    item.unitSats = kioskCount(value.unitSats, { positive: true });
    kioskCount(item.unitSats * item.qty, { positive: true });
  }
  if (value.lineSats != null) item.lineSats = kioskCount(value.lineSats);
  if (value.lineMinor != null) item.lineMinor = kioskCount(value.lineMinor);
  else if (Object.hasOwn(value, 'lineMinor')) item.lineMinor = null;
  return item;
}

export function itemTotalSats(item, rate = 0) {
  if (item.lineSats != null) return item.lineSats;
  if (item.unit === 'sats') return kioskCount(item.unitSats * item.qty);
  if (!(rate > 0)) throw kioskError('KIOSK_RATE_UNAVAILABLE', 'A recent Bitcoin price is needed for these products.');
  return kioskCount(fiatToSats(decimalMinor(item.priceMinor * item.qty), rate));
}
export function itemTotalMinor(item, rate = 0) {
  if (Object.hasOwn(item, 'lineMinor')) return item.lineMinor;
  return item.unit === 'sats' ? minorForSats(item.unitSats * item.qty, rate) : kioskCount(item.priceMinor * item.qty);
}

/** Convert the combined fiat subtotal once; allocate its rounding residue to immutable lines. */
export function priceBasket(values, { currency = 'USD', rate = 0 } = {}) {
  currency = kioskCurrency(currency);
  rate = Number(rate);
  if (!Number.isFinite(rate) || rate < 0) fail('Use a valid Bitcoin price.');
  const items = values.map(value => normalizeKioskItem(value, currency));
  const fiatItems = items.filter(item => item.unit === 'fiat');
  if (fiatItems.length && !(rate > 0)) throw kioskError('KIOSK_RATE_UNAVAILABLE', 'A recent Bitcoin price is needed for these products.');
  const fiatMinor = fiatItems.reduce((sum, item) => safeSum(sum, item.priceMinor * item.qty), 0);
  const fiatSats = rate > 0 ? kioskCount(fiatToSats(decimalMinor(fiatMinor), rate)) : 0;
  let allocated = 0;
  for (const item of items) {
    item.lineSats = item.unit === 'sats' ? item.unitSats * item.qty : fiatToSats(decimalMinor(item.priceMinor * item.qty), rate);
    item.lineMinor = item.unit === 'sats' ? minorForSats(item.lineSats, rate) : item.priceMinor * item.qty;
    if (item.unit === 'fiat') allocated += item.lineSats;
  }
  // Each line was rounded down. Their small remainder belongs to the quoted order, not another charge.
  let remainder = fiatSats - allocated;
  for (const item of fiatItems) {
    if (remainder <= 0) break;
    item.lineSats += 1;
    remainder -= 1;
  }
  if (remainder !== 0) fail('The basket could not be priced consistently.');
  const baseSats = items.reduce((sum, item) => safeSum(sum, item.lineSats), 0);
  const subtotalMinor = items.every(item => item.lineMinor != null) ? items.reduce((sum, item) => safeSum(sum, item.lineMinor), 0) : null;
  return { items, currency, rate: rate || null, baseSats, subtotalMinor };
}

export function buildSaleSnapshot({ items = [], currency = 'USD', rate = 0, walletId, walletName = '', tipSats = 0, roundUpSats = 0, tipPercent = null, method = '', label = '' }) {
  if (!kioskIdentity(walletId)) fail('Choose the receiving wallet.');
  const priced = priceBasket(items, { currency, rate });
  if (!priced.items.length) fail('Add an item or amount first.');
  tipSats = kioskCount(tipSats);
  roundUpSats = kioskCount(roundUpSats);
  const totalSats = kioskCount(priced.baseSats + tipSats + roundUpSats, { positive: true });
  const tipMinor = minorForSats(tipSats, rate);
  const roundUpMinor = minorForSats(roundUpSats, rate);
  const totalMinor = priced.subtotalMinor == null ? null : safeSum(priced.subtotalMinor, tipMinor + roundUpMinor);
  return { ...priced, walletId: kioskIdentity(walletId), walletName: kioskText(walletName), method: kioskText(method), label: kioskText(label), tipSats, roundUpSats, totalSats, tipMinor, roundUpMinor, totalMinor, tipPercent: Number.isFinite(tipPercent) ? tipPercent : null };
}

export function emptyKioskDraft(currency = 'USD') {
  return { items: [], amountRaw: '', amountUnit: 'sats', exactSats: null, currency: kioskCurrency(currency) };
}
export function normalizeKioskDraft(value, currency) {
  const draft = value || {};
  const amountRaw = typeof draft.amountRaw === 'string' ? draft.amountRaw : '';
  const amountUnit = draft.amountUnit === 'fiat' ? 'fiat' : 'sats';
  if (amountRaw.length > 24 || amountRaw && !/^\d*(?:\.\d{0,2})?$/.test(amountRaw)) fail('The saved amount is not valid.');
  if (amountUnit === 'sats' && amountRaw.includes('.')) fail('Bitcoin amounts use whole sats.');
  const draftCurrency = kioskCurrency(draft.currency || currency);
  if (currency && draftCurrency !== currency) fail('A basket keeps its original price currency.');
  const items = (draft.items || []).map(item => normalizeKioskItem(item, currency));
  if (new Set(items.map(item => item.id)).size !== items.length) fail('The basket contains duplicate items.');
  return { items, amountRaw, amountUnit, exactSats: draft.exactSats == null ? null : kioskCount(draft.exactSats), currency: draftCurrency };
}
export function kioskDraftHasValue(draft) {
  return !!draft?.items?.length || Number(draft?.amountRaw) > 0 || draft?.exactSats > 0;
}
export function emptyKioskMerchant(currency = 'USD') {
  return { version: KIOSK_MERCHANT_VERSION, revision: 0, setupCompleted: false, catalogCurrency: kioskCurrency(currency), entryMode: 'amount', products: [], categories: [], savedBaskets: [], draft: emptyKioskDraft(currency), activeOrderId: null, orders: [] };
}

const ATTEMPT_STATES = new Set(['creating', 'uncertain', 'waiting', 'expired', 'failed', 'paid']);
export function normalizeKioskOrder(value) {
  if (!value || !kioskIdentity(value.id) || !kioskIdentity(value.walletId)) fail('The saved sale is incomplete.');
  const currency = kioskCurrency(value.currency);
  const items = (value.items || []).map(item => normalizeKioskItem(item, currency));
  if (!items.length) fail('The saved sale has no items.');
  const baseSats = kioskCount(value.baseSats);
  const tipSats = kioskCount(value.tipSats || 0);
  const roundUpSats = kioskCount(value.roundUpSats || 0);
  const totalSats = kioskCount(value.totalSats, { positive: true });
  if (baseSats + tipSats + roundUpSats !== totalSats) fail('The saved sale total does not match.');
  if (items.some(item => item.lineSats == null) || items.reduce((sum, item) => safeSum(sum, item.lineSats), 0) !== baseSats) fail('The saved items do not match the sale.');
  if (value.rate != null && (!Number.isFinite(value.rate) || value.rate <= 0)) fail('The saved Bitcoin price is not valid.');
  const quoted = priceBasket(items, { currency, rate: value.rate || 0 });
  if (items.some((item, index) => item.lineSats !== quoted.items[index].lineSats || item.lineMinor !== quoted.items[index].lineMinor)) fail('The saved item prices do not match the quoted sale.');
  if (new Set(items.map(item => item.id)).size !== items.length) fail('The saved sale contains duplicate items.');
  const result = { id: kioskIdentity(value.id), createdAt: timestamp(value.createdAt), paidAt: value.paidAt == null ? null : timestamp(value.paidAt), currency, rate: value.rate > 0 ? Number(value.rate) : null, items, baseSats, tipSats, roundUpSats, totalSats, walletId: kioskIdentity(value.walletId), walletName: kioskText(value.walletName), method: kioskText(value.method), label: kioskText(value.label), tipPercent: Number.isFinite(value.tipPercent) ? value.tipPercent : null, status: value.status === 'uncertain' ? 'failed' : ['preparing', 'waiting', 'expired', 'failed', 'paid'].includes(value.status) ? value.status : 'preparing', activeAttemptId: kioskIdentity(value.activeAttemptId), duplicatePayment: !!value.duplicatePayment, legacy: !!value.legacy, attempts: [] };
  for (const key of ['subtotalMinor', 'tipMinor', 'roundUpMinor', 'totalMinor']) result[key] = value[key] == null ? null : kioskCount(value[key]);
  if (result.totalMinor != null && ([result.subtotalMinor, result.tipMinor, result.roundUpMinor].some(value => value == null) || result.subtotalMinor + result.tipMinor + result.roundUpMinor !== result.totalMinor)) fail('The receipt amounts do not add up.');
  if (result.subtotalMinor !== quoted.subtotalMinor || result.tipMinor !== minorForSats(tipSats, result.rate) || result.roundUpMinor !== minorForSats(roundUpSats, result.rate)) fail('The receipt prices do not match the frozen quote.');
  const ids = new Set();
  for (const raw of value.attempts || []) {
    if (!raw || !kioskIdentity(raw.id) || ids.has(raw.id) || !ATTEMPT_STATES.has(raw.status)) fail('The saved payment attempt is invalid.');
    if (raw.walletId !== result.walletId || raw.amountSats !== totalSats) fail('The payment attempt belongs to a different sale.');
    ids.add(raw.id);
    // An older version kept a request that never came back as 'uncertain'. It
    // was never shown, so nobody can have paid it: it reads as not charged.
    const attempt = { id: kioskIdentity(raw.id), walletId: result.walletId, amountSats: totalSats, status: raw.status === 'uncertain' ? 'failed' : raw.status, createdAt: timestamp(raw.createdAt), paymentHash: kioskIdentity(raw.paymentHash), paymentRequest: kioskIdentity(raw.paymentRequest, 8192), invoiceId: kioskIdentity(raw.invoiceId), transactionId: kioskIdentity(raw.transactionId), expiresAt: raw.expiresAt == null ? null : timestamp(raw.expiresAt), paidAt: raw.paidAt == null ? null : timestamp(raw.paidAt), settledSats: raw.settledSats == null ? null : kioskCount(raw.settledSats, { positive: true }), reason: /^[A-Z0-9_-]{1,80}$/i.test(raw.reason || '') ? raw.reason : null };
    if (['waiting', 'expired', 'paid'].includes(attempt.status) && (!attempt.paymentHash || !attempt.paymentRequest)) fail('The saved invoice is incomplete.');
    if (attempt.status === 'paid' && attempt.settledSats != null && attempt.settledSats !== totalSats) fail('The settled amount does not match.');
    result.attempts.push(attempt);
  }
  if (result.activeAttemptId && !ids.has(result.activeAttemptId)) fail('The active payment attempt is missing.');
  const paid = result.attempts.filter(attempt => attempt.status === 'paid');
  if (result.status === 'paid' && !paid.length) fail('A paid sale needs a confirmed attempt.');
  if (paid.length && result.status !== 'paid') fail('A confirmed payment must remain paid.');
  return result;
}

/**
 * The register as saved. With `setAside`, a record that no longer reads (an
 * order, basket or product) is set aside instead of closing the whole
 * register: it stays in storage and in the backup, as `{ kind, record }`.
 */
export function normalizeKioskMerchant(value, currency = 'USD', { setAside = false } = {}) {
  if (!value || typeof value !== 'object' || value.version !== KIOSK_MERCHANT_VERSION) throw kioskError('KIOSK_STORAGE_UNREADABLE', 'These register records could not be read. Keep a backup before replacing them.');
  const state = emptyKioskMerchant(value.catalogCurrency || currency);
  const aside = [];
  // One unreadable record must not lock the register, nor one twin of a record that read.
  const readable = (kind, list, read, identity = item => item.id) => {
    const seen = new Set();
    return list.flatMap(raw => {
      try {
        const item = read(raw);
        if (seen.has(identity(item))) fail('The saved register contains duplicate entries.');
        seen.add(identity(item));
        return [item];
      } catch (error) {
        if (!setAside) throw error;
        aside.push({ kind, record: raw });
        return [];
      }
    });
  };
  state.revision = kioskCount(value.revision || 0);
  state.setupCompleted = !!value.setupCompleted;
  state.entryMode = value.entryMode === 'products' ? 'products' : 'amount';
  for (const key of ['products', 'categories', 'savedBaskets', 'orders']) if (!Array.isArray(value[key])) fail('The saved register is incomplete.');
  state.products = readable('products', value.products, product => normalizeKioskProduct(product, state.catalogCurrency));
  state.categories = value.categories.map(category => kioskText(category)).filter(Boolean);
  if (new Set(state.categories).size !== state.categories.length) fail('The saved catalog contains duplicate entries.');
  state.draft = normalizeKioskDraft(value.draft, state.catalogCurrency);
  state.savedBaskets = readable('savedBaskets', value.savedBaskets, basket => {
    if (!kioskText(basket.id) || !kioskText(basket.name)) fail('A saved basket is incomplete.');
    return { id: kioskIdentity(basket.id), name: kioskText(basket.name), createdAt: kioskCount(basket.createdAt), draft: normalizeKioskDraft(basket.draft, state.catalogCurrency) };
  });
  const proofs = new Set();
  state.orders = readable('orders', value.orders, raw => {
    const order = normalizeKioskOrder(raw);
    const keys = order.attempts.filter(attempt => attempt.paymentHash).map(attempt => JSON.stringify([attempt.walletId, attempt.paymentHash]));
    if (keys.some(key => proofs.has(key)) || new Set(keys).size !== keys.length) fail('An invoice is assigned to more than one sale.');
    keys.forEach(key => proofs.add(key));
    return order;
  });
  state.activeOrderId = kioskIdentity(value.activeOrderId);
  if (state.activeOrderId && !state.orders.some(order => order.id === state.activeOrderId)) {
    if (!setAside) fail('The active sale could not be found.');
    state.activeOrderId = null;
  }
  if (setAside) state.setAside = aside;
  return state;
}

/** Migrate known parked invoice identities; never infer a paid sale from amount/time. */
export function migrateLegacyKioskParked(saved, currency = 'USD') {
  if (!Array.isArray(saved)) fail('The previous waiting payments could not be read.');
  return saved.map((sale, index) => {
    const invoice = sale?.invoiceData;
    if (!invoice?.walletId || !invoice?.paymentHash || !invoice?.paymentRequest) fail('A previous waiting payment is incomplete.');
    const totalSats = kioskCount(invoice.amountSats, { positive: true });
    const old = sale.saleBreakdown || {};
    const baseSats = Number.isSafeInteger(old.baseSats) && old.baseSats > 0 && old.baseSats <= totalSats ? old.baseSats : totalSats;
    const extras = totalSats - baseSats;
    const createdAt = Number.isSafeInteger(sale.parkedAt) ? sale.parkedAt : Date.now();
    const id = kioskText(sale.id) || `legacy-${index}-${invoice.paymentHash}`;
    return normalizeKioskOrder({ id, createdAt, currency, walletId: invoice.walletId, walletName: '', method: '', label: '', baseSats, tipSats: old.roundUp ? 0 : extras, roundUpSats: old.roundUp ? extras : 0, totalSats, legacy: true, status: sale.finalChecked ? 'expired' : 'waiting', activeAttemptId: `${id}-invoice`, items: [{ id: `${id}-amount`, name: 'Amount', qty: 1, unit: 'sats', unitSats: baseSats, currency, lineSats: baseSats, lineMinor: null }], attempts: [{ id: `${id}-invoice`, walletId: invoice.walletId, amountSats: totalSats, status: sale.finalChecked ? 'expired' : 'waiting', createdAt, paymentHash: invoice.paymentHash, paymentRequest: invoice.paymentRequest, invoiceId: invoice.invoiceId || invoice.invoice_id || null, expiresAt: Number.isSafeInteger(invoice.expiresAt || invoice.expires_at) ? invoice.expiresAt || invoice.expires_at : null }] });
  });
}

export function formatKioskMoney(minor, currency, locale = 'en-US') {
  if (minor == null) return '';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: kioskCurrency(currency), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
}

/**
 * What a sale is called in lists: its label, else its items. One line reads
 * "Latte" or "3 × Latte"; more lines read "Latte and 11 more", so a basket of
 * twelve is not taken for one coffee.
 */
export function kioskSaleTitle(sale, t) {
  if (sale?.label) return sale.label;
  const [first, ...rest] = sale?.items || [];
  if (!first) return t('Sale');
  if (rest.length) return t('{name} and {n} more', { name: first.name, n: rest.length });
  return first.qty > 1 ? `${first.qty} × ${first.name}` : first.name;
}

/**
 * How a paid sale was paid, for its details and the export: 'card' or 'qr'
 * when the register saw it, null when it did not (a sale paid while the
 * register was elsewhere, or saved by a version that did not record it).
 */
export function kioskPaymentMethod(sale) {
  return sale?.status === 'paid' && ['card', 'qr'].includes(sale.method) ? sale.method : null;
}

/**
 * Count copy with a singular key, the app's way of saying "1 sale" and
 * "{n} sales" (the locale files hold no plural forms). The number uses the
 * locale's grouping, so it reads like the amounts beside it: "10,000 sales".
 */
export function kioskCountLabel(t, n, one, many, locale) {
  return n === 1 ? t(one) : t(many, { n: new Intl.NumberFormat(locale || undefined).format(n) });
}

/**
 * The figures one receipt shows, for the screen and for the shared text alike.
 * A sale typed in Bitcoin only is shown in Bitcoin; anything priced in fiat is
 * shown in the currency it was sold in.
 */
export function kioskReceiptFigures(sale, { money, bitcoin }) {
  const items = sale.items || [];
  const bitcoinOnly = items.length > 0 && items.every((item) => item.unit === 'sats');
  const extra = (name) => (bitcoinOnly ? bitcoin(sale[`${name}Sats`]) : money(sale[`${name}Minor`], sale.currency));
  return {
    bitcoinOnly,
    total: bitcoinOnly ? bitcoin(sale.totalSats) : money(sale.totalMinor, sale.currency),
    items: items.map((item) => {
      const currency = item.currency || sale.currency;
      return item.unit === 'sats'
        ? { unit: bitcoin(item.unitSats), line: bitcoin(item.lineSats) }
        : { unit: money(item.priceMinor, currency), line: money(item.lineMinor, currency) };
    }),
    subtotal: bitcoinOnly ? bitcoin(sale.baseSats) : money(sale.subtotalMinor, sale.currency),
    tip: sale.tipSats || sale.tipMinor ? extra('tip') : null,
    roundUp: sale.roundUpSats || sale.roundUpMinor ? extra('roundUp') : null,
  };
}

/** A paid sale as plain text a customer can keep: items, extras, total and the Bitcoin received. */
export function kioskReceiptText(sale, { t, money, bitcoin, date }) {
  const figures = kioskReceiptFigures(sale, { money, bitcoin });
  const lines = [t('Receipt')];
  if (date) lines.push(date);
  lines.push('');
  (sale.items || []).forEach((item, index) => lines.push(`${item.qty} × ${item.name}  ${figures.items[index].line}`));
  if (figures.tip || figures.roundUp) {
    lines.push('', `${t('Items')}  ${figures.subtotal}`);
    if (figures.tip) lines.push(`${t('Tip')}  ${figures.tip}`);
    if (figures.roundUp) lines.push(`${t('Round-up')}  ${figures.roundUp}`);
  }
  lines.push('', `${t('Total')}  ${figures.total}`);
  if (!figures.bitcoinOnly) lines.push(`${t('Paid in Bitcoin')}  ${bitcoin(sale.totalSats)}`);
  return lines.join('\n');
}
const csvCell = value => {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export function kioskSalesCsv(orders) {
  const header = ['Sale ID', 'Created UTC', 'Paid UTC', 'Status', 'Wallet', 'Currency', 'Item', 'Category', 'Quantity', 'Unit', 'Unit price minor', 'Unit sats', 'Item sats', 'Subtotal minor', 'Tip minor', 'Round-up minor', 'Total minor', 'Total sats', 'Label', 'Method', 'Duplicate payment'];
  const rows = [header.map(csvCell).join(',')];
  for (const order of orders) order.items.forEach((item, index) => rows.push([order.id, new Date(order.createdAt).toISOString(), order.paidAt ? new Date(order.paidAt).toISOString() : '', order.status, order.walletName, order.currency, item.name, item.category, item.qty, item.unit, item.priceMinor, item.unitSats, item.lineSats, index ? '' : order.subtotalMinor, index ? '' : order.tipMinor, index ? '' : order.roundUpMinor, index ? '' : order.totalMinor, index ? '' : order.totalSats, order.label, { card: 'Bitcoin Card', qr: 'QR code' }[kioskPaymentMethod(order)] || '', order.duplicatePayment ? 'yes' : ''].map(csvCell).join(',')));
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}
export function exportKioskBundle(data) {
  const { setAside = [], ...register } = data;
  // Records set aside travel with the backup, untouched, so none is lost.
  return JSON.stringify({ kind: KIOSK_BUNDLE_KIND, version: 1, exportedAt: Date.now(), data: normalizeKioskMerchant(register), ...(setAside.length ? { setAside } : {}) });
}
export function readKioskBundle(text) {
  if (typeof text !== 'string' || text.length > MAX_BUNDLE_BYTES) fail('Choose a register backup smaller than 20 MB.');
  let bundle;
  try { bundle = JSON.parse(text); } catch { fail('This is not a readable register backup.'); }
  if (bundle.kind !== KIOSK_BUNDLE_KIND || bundle.version !== 1) fail('Choose a BuhoGO register backup.');
  const data = normalizeKioskMerchant(bundle.data);
  // Records the backup kept aside come back aside, as they were.
  const aside = Array.isArray(bundle.setAside) ? bundle.setAside.filter(entry => ['products', 'savedBaskets', 'orders'].includes(entry?.kind)) : [];
  return aside.length ? { ...data, setAside: aside } : data;
}
