/**
 * NIP-60 persistence for the Social Bucket.
 *
 * npub.cash remains responsible for receiving payments and exposing mint
 * quotes. This module starts one step later: once a quote has become Cashu
 * proofs, it mirrors the bearer data to the owner's Nostr relays so restoring
 * the same identity can recover it. Every payload is NIP-44 encrypted to self
 * by nostr-core; relays see an event envelope, never the proofs.
 *
 * NIP-60 is an interoperable wallet, not an app-private backup. We therefore
 * use its standard wallet, token, deletion and history events without adding a
 * BuhoGO-only format. Local encrypted storage remains the immediate durability
 * layer; relay writes are a redundant recovery layer and never alter npub.cash
 * quote state.
 */

import {
  createHistoryEvent,
  createTokenDeleteEvent,
  createTokenEvent,
  createWalletEvent,
  generateSecretKey,
  getWalletFilters,
  parseTokenEvent,
  parseWalletEvent,
  TOKEN_KIND,
  verifyEvent,
  WALLET_KIND,
} from 'nostr-core';
import {
  DEFAULT_RELAYS,
  getRelayPool,
  publishToRelaysEager,
} from '../utils/nostrRelays.js';
import { compareEventFreshness } from '../utils/nostrFetch.js';

export const DEFAULT_NIP60_TIMEOUT_MS = 4000;

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeRelays(relays) {
  const source = Array.isArray(relays) && relays.length ? relays : DEFAULT_RELAYS;
  return [...new Set(source.filter((relay) => typeof relay === 'string' && /^wss?:\/\//i.test(relay)))];
}

function validOwnedEvent(event, pubkey, expectedKind) {
  if (!event || event.kind !== expectedKind || event.pubkey !== pubkey) return false;
  try {
    return verifyEvent(event) === true;
  } catch {
    return false;
  }
}

function proofKey(proof) {
  if (!proof || typeof proof !== 'object') return '';
  return [proof.id, proof.amount, proof.secret, proof.C].join('\u0000');
}

/** Merge proof arrays without ever counting the same bearer proof twice. */
export function mergeCashuProofs(...collections) {
  const merged = [];
  const seen = new Set();
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const proof of collection) {
      const key = proofKey(proof);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(proof);
    }
  }
  return merged;
}

async function queryEvents(pool, relays, filter, timeoutMs) {
  try {
    const events = await pool.querySync([...relays], filter, { maxWait: timeoutMs });
    return Array.isArray(events) ? events : [];
  } catch (err) {
    console.warn('[nip60] relay query failed:', err);
    return [];
  }
}

/**
 * Fetch and reconcile the NIP-60 state authored by one Nostr profile.
 *
 * Deletion events and every token event's `del` field are applied across the
 * union returned by all relays. This prevents an older relay copy from
 * resurrecting proofs that a newer state transition already consumed.
 */
export async function fetchNip60WalletState({
  secretKey,
  pubkey,
  pool = getRelayPool(),
  relays = DEFAULT_RELAYS,
  timeoutMs = DEFAULT_NIP60_TIMEOUT_MS,
} = {}) {
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
    throw new TypeError('secretKey must be 32 bytes');
  }
  if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(pubkey)) {
    throw new TypeError('pubkey must be a 64-character lowercase hex key');
  }
  if (!pool || typeof pool.querySync !== 'function') {
    throw new TypeError('pool must implement querySync');
  }

  const urls = normalizeRelays(relays);
  const [walletFilter, tokenFilter] = getWalletFilters(pubkey);
  const deleteFilter = {
    kinds: [5],
    authors: [pubkey],
    '#k': [String(TOKEN_KIND)],
  };
  const [walletEvents, tokenEvents, deleteEvents] = await Promise.all([
    queryEvents(pool, urls, walletFilter, timeoutMs),
    queryEvents(pool, urls, tokenFilter, timeoutMs),
    queryEvents(pool, urls, deleteFilter, timeoutMs),
  ]);

  const seenWalletIds = new Set();
  const validWallets = walletEvents
    .filter((event) => {
      if (!validOwnedEvent(event, pubkey, WALLET_KIND) || seenWalletIds.has(event.id)) {
        return false;
      }
      seenWalletIds.add(event.id);
      return true;
    })
    .sort(compareEventFreshness);
  let wallet = null;
  let walletEvent = null;
  for (const event of validWallets) {
    try {
      wallet = parseWalletEvent(event, secretKey);
      walletEvent = event;
      break;
    } catch (err) {
      console.warn('[nip60] could not decrypt wallet event:', err);
    }
  }

  const removedIds = new Set();
  for (const event of deleteEvents) {
    if (!validOwnedEvent(event, pubkey, 5)) continue;
    for (const tag of event.tags || []) {
      if (Array.isArray(tag) && tag[0] === 'e' && typeof tag[1] === 'string') {
        removedIds.add(tag[1]);
      }
    }
  }

  const parsedTokens = [];
  const seenTokenIds = new Set();
  for (const event of tokenEvents) {
    if (!validOwnedEvent(event, pubkey, TOKEN_KIND) || seenTokenIds.has(event.id)) continue;
    seenTokenIds.add(event.id);
    try {
      const token = parseTokenEvent(event, secretKey);
      parsedTokens.push({ event, token });
      for (const id of token.del || []) removedIds.add(id);
    } catch (err) {
      console.warn('[nip60] could not decrypt token event:', err);
    }
  }

  const byMint = new Map();
  for (const { event, token } of parsedTokens) {
    if (removedIds.has(event.id)) continue;
    const current = byMint.get(token.mint) || { mint: token.mint, proofs: [], eventIds: [] };
    current.proofs = mergeCashuProofs(current.proofs, token.proofs);
    current.eventIds.push(event.id);
    byMint.set(token.mint, current);
  }

  return {
    wallet,
    walletEvent,
    tokensByMint: [...byMint.values()],
    removedEventIds: [...removedIds],
  };
}

async function firstRelayAccept(pool, relays, event, timeoutMs) {
  const fanout = publishToRelaysEager(pool, relays, event, { timeoutMs });
  const accepted = await fanout.firstAccept;
  // Keep the remaining writes alive and observed without delaying the caller.
  void fanout.allSettled;
  return accepted;
}

function normalizedWallet(wallet, mint) {
  const privkey = typeof wallet?.privkey === 'string' && /^[0-9a-f]{64}$/i.test(wallet.privkey)
    ? wallet.privkey.toLowerCase()
    : toHex(generateSecretKey());
  const mints = [...new Set([
    ...(Array.isArray(wallet?.mints) ? wallet.mints : []),
    mint,
  ].filter(Boolean))];
  return { privkey, mints };
}

/**
 * Publish one atomic NIP-60 snapshot transition.
 *
 * For a non-empty balance the replacement token is accepted before deletion
 * of its predecessors begins. For an empty balance the deletion event itself
 * is the durable state. A failed relay write is reported to the caller but
 * never mutates or spends the local proofs.
 */
export async function publishNip60WalletState({
  secretKey,
  mint,
  proofs,
  previousTokenEventIds = [],
  wallet,
  direction,
  amount,
  pool = getRelayPool(),
  relays = DEFAULT_RELAYS,
  timeoutMs = DEFAULT_NIP60_TIMEOUT_MS,
} = {}) {
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
    throw new TypeError('secretKey must be 32 bytes');
  }
  if (typeof mint !== 'string' || !/^https:\/\//i.test(mint)) {
    throw new TypeError('mint must be an https URL');
  }
  if (!Array.isArray(proofs)) throw new TypeError('proofs must be an array');
  if (!pool || typeof pool.ensureRelay !== 'function') {
    throw new TypeError('pool must implement ensureRelay');
  }

  const urls = normalizeRelays(relays);
  const nextWallet = normalizedWallet(wallet, mint);
  const oldIds = [...new Set(previousTokenEventIds.filter((id) => typeof id === 'string' && id))];
  const walletEvent = createWalletEvent(nextWallet, secretKey);
  const walletAcceptPromise = firstRelayAccept(pool, urls, walletEvent, timeoutMs);

  let tokenEvent = null;
  let tokenAccepted = null;
  if (proofs.length) {
    tokenEvent = createTokenEvent({
      mint,
      proofs,
      unit: 'sat',
      del: oldIds.length ? oldIds : undefined,
    }, secretKey);
    tokenAccepted = await firstRelayAccept(pool, urls, tokenEvent, timeoutMs);
    if (!tokenAccepted) {
      return {
        ok: false,
        wallet: nextWallet,
        walletEventId: walletEvent.id,
        tokenEventIds: oldIds,
        reason: 'TOKEN_PUBLISH_FAILED',
      };
    }
  }

  let deletionAccepted = true;
  if (oldIds.length) {
    const deleteEvent = createTokenDeleteEvent(oldIds, secretKey);
    deletionAccepted = Boolean(await firstRelayAccept(pool, urls, deleteEvent, timeoutMs));
  }

  const walletAccepted = Boolean(await walletAcceptPromise);
  const createdIds = tokenEvent ? [tokenEvent.id] : [];

  if ((direction === 'in' || direction === 'out') && Number(amount) > 0) {
    const references = [
      ...oldIds.map((id) => ({ id, marker: 'destroyed' })),
      ...createdIds.map((id) => ({ id, marker: 'created' })),
    ];
    const historyEvent = createHistoryEvent({
      direction,
      amount: String(Math.round(Number(amount))),
      unit: 'sat',
      events: references,
    }, secretKey);
    // History is optional in NIP-60 and must not hold up proof durability.
    void firstRelayAccept(pool, urls, historyEvent, timeoutMs);
  }

  const stateAccepted = proofs.length ? Boolean(tokenAccepted) : deletionAccepted;
  return {
    ok: stateAccepted && walletAccepted,
    stateAccepted,
    walletAccepted,
    deletionAccepted,
    wallet: nextWallet,
    walletEventId: walletEvent.id,
    tokenEventIds: createdIds,
    tokenEventId: tokenEvent?.id || null,
    reason: stateAccepted && walletAccepted ? null : 'PARTIAL_RELAY_BACKUP',
  };
}
