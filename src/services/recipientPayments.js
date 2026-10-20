/**
 * recipientPayments — the payments made to one recipient, joined from every
 * wallet: a receipt's "Payments to this recipient" and a contact's
 * "Between you".
 *
 *  - Outgoing: a payment counts when its own address, the recipient address
 *    in its metadata or its Pay again record matches one of the recipient's
 *    addresses, or when the metadata link names the contact.
 *  - Incoming: only when the metadata link names the contact. An incoming
 *    payment's address is the user's OWN, so matching it would attach
 *    unrelated payments.
 *
 * Matching only decides what is listed; nothing here pays. Each wallet
 * answers with the first page of its own history, or with the list History
 * last showed when it has no provider in the store, fails, or takes longer
 * than a few seconds (a relay round trip). Nothing older than that page is
 * read, so the result says when a wallet may hold more.
 */

import { normalizeTx } from './txNormalizer.js';
import { TX_CACHE_LIMIT, readCachedTransactions } from '../utils/txCache.js';

const PAGE_SIZE = 100;
/** How long one wallet may take before its cached list answers instead. */
const WALLET_TIMEOUT_MS = 4000;
const UNSETTLED = new Set(['pending', 'failed', 'expired']);

const normalized = (value) => String(value || '').trim().toLowerCase();

/** A payment's time in ms since epoch, from whichever field its provider sets; 0 when none parses. */
export function paymentTimeMs(tx) {
  const raw = tx?.settled_at ?? tx?.created_at ?? tx?.timestamp ?? tx?.time;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw < 1e12 ? raw * 1000 : raw;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * True when a payment belongs to the recipient.
 *
 * @param {object} tx  normalized payment
 * @param {object|null} meta  its metadata record
 * @param {{ aliases: Set<string>, contactId?: string|null }} recipient  aliases lower-cased
 */
export function matchesRecipient(tx, meta, { aliases, contactId = null }) {
  const linked = Boolean(contactId) && meta?.contactId === contactId;
  if (tx?.type === 'incoming') return linked;
  if (tx?.type !== 'outgoing') return false;
  return linked || [tx.lnaddress, meta?.recipientAddress, meta?.payAgain?.address]
    .some((address) => address && aliases.has(normalized(address)));
}

/**
 * Settled payments to (and, for a contact, from) one recipient, newest first.
 *
 * @param {object} input
 * @param {object[]} input.wallets  the wallet store's wallets
 * @param {object} input.providers  wallet id -> provider
 * @param {(txId: string, walletId: string) => object|null} input.metadataFor
 * @param {string[]} input.addresses  every address the recipient is known by
 * @param {string|null} [input.contactId]
 * @param {(walletId: string) => object[]} [input.readCache]
 * @returns {Promise<{ payments: object[], complete: boolean }>} each payment with
 *   `walletId`, `sourceKey`, `amountSats` and `timeMs`; `complete` is false when
 *   a wallet answered with a full page, so older payments may exist
 */
export async function loadRecipientPayments({
  wallets = [],
  providers = {},
  metadataFor,
  addresses = [],
  contactId = null,
  readCache = readCachedTransactions,
  timeoutMs = WALLET_TIMEOUT_MS,
}) {
  const aliases = new Set(addresses.filter(Boolean).map(normalized));
  if (!contactId && !aliases.size) return { payments: [], complete: true };

  let complete = true;
  const history = async (wallet) => {
    const provider = providers?.[wallet.id];
    if (typeof provider?.getTransactions === 'function') {
      let timer = null;
      try {
        const result = await Promise.race([
          provider.getTransactions({ limit: PAGE_SIZE, offset: 0 }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
        ]);
        const page = Array.isArray(result) ? result : (result?.transactions || []);
        // Exactly one page: there may be more. A provider that ignores the
        // limit answers with its whole history.
        if (page.length === PAGE_SIZE) complete = false;
        return page;
      } catch {
        // Fall through to what History last showed.
      } finally {
        clearTimeout(timer);
      }
    }
    const cached = readCache(wallet.id) || [];
    if (cached.length >= TX_CACHE_LIMIT) complete = false;
    return cached;
  };

  const batches = await Promise.all(wallets.map(async (wallet) => {
    try {
      const raw = await history(wallet);
      return raw.flatMap((entry) => {
        const tx = normalizeTx(entry, { walletType: wallet.type });
        if (UNSETTLED.has(tx.status)) return [];
        if (!matchesRecipient(tx, metadataFor(tx.id, wallet.id), { aliases, contactId })) return [];
        return [{
          ...tx,
          walletId: wallet.id,
          sourceKey: `${wallet.id}:${tx.id || tx.timestamp}`,
          amountSats: tx.recipientSats || Math.abs(Number(tx.amount) || 0),
          timeMs: paymentTimeMs(tx),
        }];
      });
    } catch {
      return [];
    }
  }));

  return { payments: batches.flat().sort((a, b) => b.timeMs - a.timeMs), complete };
}

/**
 * How often and how much was paid: outgoing payments only.
 *
 * @param {object[]} payments  from loadRecipientPayments
 * @returns {{ count: number, totalSats: number, sinceMs: number }}
 */
export function summarizePayments(payments) {
  const sent = payments.filter((payment) => payment.type === 'outgoing');
  return {
    count: sent.length,
    totalSats: sent.reduce((sum, payment) => sum + (payment.amountSats || 0), 0),
    sinceMs: sent.reduce((first, payment) => (payment.timeMs && (!first || payment.timeMs < first) ? payment.timeMs : first), 0),
  };
}
