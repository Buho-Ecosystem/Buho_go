/**
 * What the clipboard can offer.
 *
 * One home for "would this string get somewhere if the user pasted it into
 * Send", shared by the Send sheet's chip and the home screen's strip so the
 * two never disagree. Pure functions: the active wallet's type comes in as
 * an argument, so the rule is testable without a store.
 */
import { parseBip21, selectBip21Destination, extractLnFallbackParam } from './bip21.js';
import {
  isSilentPaymentAddress,
  nativeRailsFromBip21,
  isSparkAddress,
  isArkadeAddress,
  isBolt12Offer,
  isLightningInvoice,
  isLnurl,
  isBitcoinAddress,
  isLightningAddress,
  stripWrapperScheme,
} from './addressUtils.js';
import { canWalletPay } from './walletCapabilities.js';
import { classifyIdentifier } from './nostrLookup.js';
import { recognizePhoneNumber } from '../services/lnAddressServices/phoneNumbers.js';

/** Longer than any destination this wallet understands; keeps a pasted novel out of the classifier. */
export const MAX_CLIPBOARD_LENGTH = 4096;

/**
 * Unwrap a destination to the bare string the classifiers understand.
 *
 * A unified (BIP21) code offers several rails; pick one the ACTIVE wallet
 * can actually pay before falling back to the generic preference order.
 * Without this, an Arkade wallet reading bitcoin:?lightning=..&ark=..
 * classifies as a (blocked) Lightning invoice and never reaches the ark
 * leg it pays natively. An http(s) "fallback URL" carrying the LNURL in a
 * `lightning=` query param (LNbits / Fossa ATMs) is reduced to that LNURL,
 * and a `lightning:` / `lnurl:` wrapper is stripped.
 *
 * @param {string} input
 * @param {string|null} walletType  active wallet type ('spark', 'arkade', 'nwc', 'lnbits') or null
 * @returns {{ cleaned: string, bip21: object|null }}
 */
export function normalizeDestination(input, walletType) {
  const trimmed = (input || '').trim();

  const bip21 = parseBip21(trimmed);
  if (bip21) {
    const rails = nativeRailsFromBip21(bip21);
    if (walletType === 'spark' && rails.spark) return { cleaned: rails.spark, bip21 };
    if (walletType === 'arkade') {
      if (rails.ark) return { cleaned: rails.ark, bip21 };
      // No ark leg: the on-chain base is still payable (Ramps offboard),
      // while the lightning leg is not - prefer what works.
      if (bip21.address) return { cleaned: bip21.address, bip21 };
    }
    const destination = selectBip21Destination(bip21);
    return { cleaned: destination ? destination.value : '', bip21 };
  }

  const lnFallback = extractLnFallbackParam(trimmed);
  if (lnFallback) return { cleaned: lnFallback, bip21: null };

  return { cleaned: stripWrapperScheme(trimmed), bip21: null };
}

/**
 * The payment type of a destination, or 'unknown'.
 * @param {string} input
 * @param {string|null} walletType
 */
export function classifyDestination(input, walletType) {
  const { cleaned } = normalizeDestination(input, walletType);
  if (!cleaned) return 'unknown';

  if (isSilentPaymentAddress(cleaned)) return 'silent_payment';
  if (isSparkAddress(cleaned)) return 'spark_address';
  if (isArkadeAddress(cleaned)) return 'arkade_address';
  if (isBolt12Offer(cleaned)) return 'bolt12_offer';
  if (isLightningInvoice(cleaned)) return 'lightning_invoice';
  if (isLightningAddress(cleaned)) return 'lightning_address';
  if (isLnurl(cleaned)) return 'lnurl';
  if (isBitcoinAddress(cleaned)) return 'bitcoin_address';
  return 'unknown';
}

/**
 * Would this string get somewhere if the user pasted it? Mirrors the Send
 * field's detection set (rails + Nostr identities + payout phone numbers),
 * minus BOLT12 and silent payments (recognized but unpayable - suggesting
 * them would only advertise a dead end), and gated on the same wallet
 * capability check the field enforces.
 *
 * @param {string} text
 * @param {string|null} walletType
 */
export function isSuggestibleDestination(text, walletType) {
  const trimmed = (text || '').trim();
  if (!trimmed || trimmed.length > MAX_CLIPBOARD_LENGTH) return false;

  const paymentType = classifyDestination(trimmed, walletType);
  if (paymentType === 'bolt12_offer' || paymentType === 'silent_payment') return false;
  if (paymentType !== 'unknown') return canWalletPay(walletType, paymentType);

  const nostrKind = classifyIdentifier(stripWrapperScheme(trimmed));
  if (nostrKind === 'npub' || nostrKind === 'nprofile') return true;
  return !!recognizePhoneNumber(trimmed);
}

/**
 * Middle ellipsis for showing a destination in one line: enough of both
 * ends to recognise a code, never a wall of characters.
 * @param {string} text
 */
export function abbreviateDestination(text, { head = 14, tail = 10 } = {}) {
  const value = (text || '').trim();
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * What to call the clipboard's contents on the offer strip, as an i18n key.
 * Names the thing in the app's own words (address, payment request,
 * Nostr profile, phone number), never the rail that carries it.
 *
 * @param {string} text
 * @param {string|null} walletType
 * @returns {string} i18n key
 */
export function offerLabelKey(text, walletType) {
  const trimmed = (text || '').trim();
  switch (classifyDestination(trimmed, walletType)) {
    case 'lightning_invoice':
    case 'lnurl':
      return 'Copied payment request';
    case 'unknown':
      break;
    default:
      return 'Copied address';
  }
  const nostrKind = classifyIdentifier(stripWrapperScheme(trimmed));
  if (nostrKind === 'npub' || nostrKind === 'nprofile') return 'Copied Nostr profile';
  if (recognizePhoneNumber(trimmed)) return 'Copied phone number';
  return 'Copied address';
}

/** Where the fingerprint of the last offered clipboard text lives. */
export const OFFERED_STORAGE_KEY = 'buhoGO_clipboard_offered';

/**
 * A short, stable fingerprint of `text` (32-bit FNV-1a, as hex). Not
 * cryptographic and not meant to be: it only has to tell "the same text
 * again" from "something new", and it keeps the clipboard's own contents
 * off the disk.
 *
 * @param {string} text
 */
export function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * Was this exact text the last one offered? The answer survives restarts
 * and route changes, so an address that sits in the clipboard for days is
 * offered once, not on every visit to the home screen.
 *
 * @param {string} text
 * @param {Storage|null} [storage]  injectable for tests
 */
export function hasBeenOffered(text, storage = defaultStorage()) {
  try {
    return !!storage && storage.getItem(OFFERED_STORAGE_KEY) === fingerprint(text);
  } catch {
    return false;
  }
}

/**
 * Record `text` as offered. Only the last one is kept: anything new in the
 * clipboard is new, even if it was offered before that.
 *
 * @param {string} text
 * @param {Storage|null} [storage]  injectable for tests
 */
export function rememberOffered(text, storage = defaultStorage()) {
  try {
    storage?.setItem(OFFERED_STORAGE_KEY, fingerprint(text));
  } catch {
    // Storage unavailable: the offer simply repeats next time.
  }
}
