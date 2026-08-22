/**
 * txNormalizer - the single canonical transaction shape shared by
 * TransactionHistory, TransactionDetails and Wallet's last-transaction
 * preview.
 *
 * Before this module, each of those three pages carried its own copy of
 * the "provider raw tx -> UI tx" mapping (see TX_METADATA_RESEARCH.md).
 * That triplication is why the three surfaces drifted: outgoing amounts
 * were computed with one formula that happened to be correct for Spark
 * (whose SDK amount already includes the fee) and silently wrong for
 * LNbits/NWC (whose amount excludes it), Developer Details only ever had
 * data for NWC, and lnurlp comments never made it out of `extra`.
 *
 * `normalizeTx()` is now the one place that turns a provider's raw
 * `getTransactions()` row into what every template reads. It stays
 * backward compatible with the original shape (id, type, description,
 * memo, settled_at, fee, status, sparkTransfer, rawType, payment_request,
 * extra) and layers the richer fields on top.
 *
 * Pure and synchronous — no store, no network, no wallet connection. A
 * page that wants a stored fiatAtSettlement snapshot merged in (for the
 * providers that don't hand us one directly) reads it from
 * transactionMetadata's getter and passes it through `options.fiatAtSettlement`;
 * this module never fabricates one itself.
 */

const SATS_PER_BTC = 100000000;

/**
 * Resolve a provider's raw direction string (which varies: Spark/LNbits/NWC
 * use 'receive'/'send', Arkade already uses 'incoming'/'outgoing') to the
 * canonical 'incoming' | 'outgoing' the rest of the app expects.
 */
function resolveDirection(rawType, amount) {
  const t = String(rawType || '').toLowerCase();
  if (t === 'receive' || t === 'received' || t === 'incoming') return 'incoming';
  if (t === 'send' || t === 'sent' || t === 'outgoing') return 'outgoing';
  // Defensive last resort for a provider that forgets to set a direction —
  // mirrors the same fallback already used elsewhere in the app.
  return Number(amount) > 0 ? 'incoming' : 'outgoing';
}

/**
 * Resolve a raw expiry field to absolute ms since epoch, or null.
 *
 * Accepted forms (what the list endpoints actually send):
 *   - ISO datetime string — LNbits' /payments list ("2026-07-13T13:41:07+00:00")
 *   - unix SECONDS (number) — NWC's `expires_at`
 *   - unix MILLISECONDS (number) — defensive, in case a provider pre-scales
 *
 * A small number would be a relative seconds-from-created figure, which no
 * list endpoint we consume sends — ignore it rather than misread it as a
 * 1970 timestamp and mark every pending invoice expired.
 */
function resolveExpiryMs(tx) {
  const raw = tx.expiry ?? tx.expires_at ?? null;
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    if (raw >= 1e12) return raw;
    if (raw >= 1e9) return raw * 1000;
    return null;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/**
 * LNbits stamps the fiat value + BTC rate on the payment record itself,
 * so unlike every other provider we never have to estimate this after the
 * fact — just read it off the raw record. Field semantics (verified against
 * live lnbits.de records): `wallet_btc_rate` is the fiat price of one BTC
 * (what a human calls "the BTC price"), while `wallet_fiat_rate` is the
 * inverse-ish sats-per-fiat-unit figure — NOT the price. When only the
 * latter is present, recover the price as 1e8 / wallet_fiat_rate.
 * Returns null when any piece is missing or malformed; never invents a
 * partial reading.
 */
export function extractLnbitsFiatAtSettlement(extra) {
  if (!extra || typeof extra !== 'object') return null;
  const currency = extra.wallet_fiat_currency;
  const amount = Number(extra.wallet_fiat_amount);
  let rate = Number(extra.wallet_btc_rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    const satsPerFiat = Number(extra.wallet_fiat_rate);
    rate = Number.isFinite(satsPerFiat) && satsPerFiat > 0 ? SATS_PER_BTC / satsPerFiat : NaN;
  }
  if (!currency || !Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) {
    return null;
  }
  return { currency, amount, rate };
}

/**
 * Split a raw provider amount/fee pair into recipientSats / feeSats /
 * totalSats per that provider's own accounting semantics:
 *
 *   - Spark: the SDK's transfer amount already INCLUDES the fee (it's the
 *     gross value moved between the user's leaves and the SSP), so what the
 *     recipient actually got is amount minus fee.
 *   - LNbits / NWC: the reported amount EXCLUDES the fee — it's exactly what
 *     the recipient received (or, for a send, what we intended to deliver) —
 *     so the total deducted from the wallet is amount plus fee.
 *   - Arkade: only a single total is ever reported; there is no separate fee
 *     figure to subtract, so feeSats is null (not 0 — 0 would claim
 *     "free", which we don't know) and recipientSats === totalSats === amount.
 */
export function computeAmounts(walletType, amount, fee) {
  const gross = Math.abs(Number(amount) || 0);

  if (walletType === 'arkade') {
    return { recipientSats: gross, feeSats: null, totalSats: gross };
  }

  const feeSats = Number.isFinite(Number(fee)) ? Math.max(0, Number(fee)) : 0;

  if (walletType === 'spark') {
    return { recipientSats: Math.max(0, gross - feeSats), feeSats, totalSats: gross };
  }

  // LNbits / NWC (and any unrecognised provider — this is the safer default).
  return { recipientSats: gross, feeSats, totalSats: gross + feeSats };
}

/**
 * An `extra` bag that arrived as a JSON string, parsed into an object.
 * Returns null for anything that is not parseable object JSON — a
 * malformed bag costs us one optional field, never a rendered row.
 *
 * @param {unknown} raw
 * @returns {object|null}
 */
function parseExtraBag(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the payer's LUD-12 comment from wherever the provider put it.
 *
 * Two explicit, typed sources, in order of how directly they name the
 * thing:
 *
 *   - NIP-47's `metadata` object (NWC). The spec gives the comment its
 *     own key alongside `payer_data`, `recipient_data` and `nostr`; see
 *     `Nip47TransactionMetadata` in @getalby/sdk. The SDK spreads the
 *     whole record through `mapNip47TransactionToTransaction`, and our
 *     NWC provider spreads it again, so it arrives here untouched.
 *   - `extra.comment` (LNbits), written by the lnurlp extension for the
 *     Lightning address we create with a comment allowance. Accepted
 *     both as an object and as the JSON string some LNbits deployments
 *     return, so the comment survives either shape.
 *
 * A bare `description` is still never read as a comment. Some NWC
 * backends do put one there, but others put the invoice memo there, and
 * guessing between them would attribute text to a payer who never wrote
 * it. The typed field above removes any need to guess.
 *
 * @param {object} tx - raw provider transaction
 * @param {object|null} extra - the record's `extra` bag when it is already an object
 * @returns {string|null}
 */
function resolveComment(tx, extra) {
  const metadata = (tx.metadata && typeof tx.metadata === 'object') ? tx.metadata : null;
  const bag = extra || parseExtraBag(tx.extra);
  const candidates = [
    metadata && metadata.comment,
    bag && bag.comment,
    tx.comment
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Turn a provider's raw transaction row into the canonical shape.
 *
 * @param {object} rawTx - whatever the wallet provider's getTransactions()
 *   (or a single-item lookup built the same way) returned for this row.
 * @param {object} [options]
 * @param {string} [options.walletType] - 'spark' | 'arkade' | 'lnbits' | 'nwc'
 * @param {object|null} [options.fiatAtSettlement] - a previously-stored
 *   snapshot ({ currency, amount, rate }) to fall back to when the provider
 *   itself doesn't hand us one (everyone except LNbits). Never fabricated
 *   here — pass null/omit when none is on file.
 * @returns {object} canonical transaction
 */
export function normalizeTx(rawTx, options = {}) {
  const { walletType = null, fiatAtSettlement: fiatOverride = null } = options;
  const tx = rawTx || {};

  const type = (tx.type === 'incoming' || tx.type === 'outgoing')
    ? tx.type
    : resolveDirection(tx.type, tx.amount);

  const description = tx.description || tx.memo || '';
  const settledAt = tx.settled_at ?? tx.timestamp ?? null;
  const createdAt = tx.created_at ?? tx.time ?? settledAt;

  const { recipientSats, feeSats, totalSats } = computeAmounts(walletType, tx.amount, tx.fee);

  const extra = (tx.extra && typeof tx.extra === 'object') ? tx.extra : null;
  const providerFiat = walletType === 'lnbits' ? extractLnbitsFiatAtSettlement(extra) : null;

  // A pending incoming invoice whose expiry already passed will never be
  // paid — surface it as 'expired' instead of leaving it pending forever.
  // Only ever a downgrade of 'pending': completed/failed stay untouched,
  // and an outgoing payment's expiry says nothing about ITS state (the
  // invoice we paid expiring later doesn't unsettle the payment).
  let status = tx.status || 'completed';
  if (status === 'pending' && type === 'incoming') {
    const expiryMs = resolveExpiryMs(tx);
    if (expiryMs && expiryMs < Date.now()) status = 'expired';
  }

  return {
    // Preserve anything a provider already attached (expiry, tag, webhook,
    // senderNpub added later by a page, etc.) so nothing already relied
    // upon downstream gets dropped just because this module doesn't know
    // its name.
    ...tx,

    // --- fields the existing templates already read (kept stable) ---
    id: tx.id,
    type,
    amount: tx.amount || 0,
    description,
    memo: tx.memo || description,
    settled_at: settledAt,
    fee: tx.fee || 0,
    status,
    sparkTransfer: tx.sparkTransfer || false,
    rawType: tx.rawType || null,
    payment_request: tx.payment_request || tx.bolt11 || null,
    extra,

    // --- new canonical fields ---
    created_at: createdAt,
    paymentHash: tx.paymentHash || tx.payment_hash || null,
    preimage: tx.preimage || null,
    bolt11: tx.bolt11 || tx.payment_request || null,
    // LUD-12 comment, from an explicit typed field only. See resolveComment.
    comment: resolveComment(tx, extra),
    tag: tx.tag || null,
    lnaddress: (extra && extra.lnaddress) || null,

    recipientSats,
    feeSats,
    totalSats,

    fiatAtSettlement: providerFiat || fiatOverride || null,
  };
}

export { SATS_PER_BTC };
export default normalizeTx;
