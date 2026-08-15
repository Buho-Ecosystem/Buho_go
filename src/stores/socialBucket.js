/**
 * Social Bucket store.
 *
 * The bucket is where money sent to a person's username lands before they move
 * it to a wallet. It exists because a new identity has no Lightning address and
 * cannot invent one, so without it the whole "pay me by name" promise is dead on
 * arrival for every new user.
 *
 * Two things make up the balance:
 *
 *   waiting   payments npub.cash is holding as ecash, known from the quotes API
 *   held      proofs we have already minted but not yet moved, usually change
 *             from a previous sweep or the result of an interrupted one
 *
 * `held` is bearer money. It is encrypted with the same device key that protects
 * the recovery phrase and written to disk the instant it exists, because a proof
 * that lives only in memory is a proof one crash away from being gone.
 *
 * This store deliberately does NOT model a wallet: no send, no receive, no
 * history, no addresses of its own. The only outgoing operation is "move it all
 * to a wallet the user already has".
 */

import { defineStore } from 'pinia';
import { encryptString, decryptString } from '../utils/deviceCrypto.js';
import { bytesToHex } from '../utils/identityCrypto.js';
import {
  fetchQuotes,
  npubCashAddress,
  isNpubCashAddress,
  NpubCashError,
} from '../services/npubCash.js';
import {
  mintQuotes,
  meltToInvoice,
  pruneSpentProofs,
  sumProofs,
  MIN_SWEEP_SATS,
} from '../services/socialBucket.js';

const STORAGE_KEYS = Object.freeze({
  META: 'buhoGO_social_bucket_v1',
  PROOFS: 'buhoGO_social_bucket_proofs_v1',
});

/** Bump on a breaking change to the persisted shape. */
const META_VERSION = 1;

/** Quotes older than this are assumed collected; keeps the sync payload small. */
const QUOTE_LOOKBACK_DAYS = 90;

export const useSocialBucketStore = defineStore('socialBucket', {
  state: () => ({
    hydrated: false,

    /** Paid quotes not yet minted, from the last sync. */
    waitingQuotes: [],

    /** Minted proofs not yet moved to a wallet. Persisted encrypted. */
    heldProofs: [],

    /** Mint the held proofs belong to. One mint at a time by construction. */
    mintUrl: null,

    /** Quote ids already minted, so a re-sync never double counts them. */
    collectedQuoteIds: [],

    lastSyncAt: null,
    isSyncing: false,
    isSweeping: false,

    /** Last failure, for the one place in the UI that reports it. */
    lastError: null,
  }),

  getters: {
    /** Sats waiting at npub.cash, not yet minted. */
    waitingSats(state) {
      return state.waitingQuotes.reduce((t, q) => t + (Number(q.amount) || 0), 0);
    },

    /** Sats already minted and sitting here. */
    heldSats(state) {
      return sumProofs(state.heldProofs);
    },

    /** What the user is shown. One number, because they have one question. */
    balanceSats() {
      return this.waitingSats + this.heldSats;
    },

    hasBalance() {
      return this.balanceSats > 0;
    },

    /** Below this a melt costs more than it moves. */
    canSweep() {
      return this.balanceSats >= MIN_SWEEP_SATS && !this.isSweeping;
    },
  },

  actions: {
    async hydrate() {
      if (this.hydrated) return;
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.META);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.version === META_VERSION) {
            this.mintUrl = parsed.mintUrl ?? null;
            this.collectedQuoteIds = Array.isArray(parsed.collectedQuoteIds)
              ? parsed.collectedQuoteIds.slice(-500)
              : [];
            this.lastSyncAt = parsed.lastSyncAt ?? null;
          }
        }

        const envelope = localStorage.getItem(STORAGE_KEYS.PROOFS);
        if (envelope) {
          const json = await decryptString(envelope);
          const proofs = JSON.parse(json);
          if (Array.isArray(proofs)) this.heldProofs = proofs;
        }
      } catch (err) {
        // Never block the app on this. Worst case the bucket looks empty until
        // the next sync, and the proofs stay on disk for a later read.
        console.warn('[social-bucket] hydrate failed:', err);
      }
      this.hydrated = true;
    },

    _persistMeta() {
      localStorage.setItem(
        STORAGE_KEYS.META,
        JSON.stringify({
          version: META_VERSION,
          mintUrl: this.mintUrl,
          collectedQuoteIds: this.collectedQuoteIds.slice(-500),
          lastSyncAt: this.lastSyncAt,
        }),
      );
    },

    /**
     * Write proofs to disk, encrypted. Awaited by every caller that has just
     * created them: this is the line that decides whether an interrupted sweep
     * loses money or not.
     */
    async _persistProofs() {
      if (!this.heldProofs.length) {
        localStorage.removeItem(STORAGE_KEYS.PROOFS);
        return;
      }
      const envelope = await encryptString(JSON.stringify(this.heldProofs));
      localStorage.setItem(STORAGE_KEYS.PROOFS, envelope);
    },

    /**
     * Ask npub.cash what has arrived.
     *
     * Read only and cheap. Safe to call on app open and whenever the user looks
     * at the Get paid screen.
     */
    async sync({ identityStore } = {}) {
      if (this.isSyncing || !identityStore?.bootstrapped) return;

      this.isSyncing = true;
      this.lastError = null;
      try {
        await this.hydrate();

        const secretKey = await identityStore.getNostrSecretKeyBytes();
        const pubkeyHex = identityStore.nostrPubkeyHex;
        const since = Math.floor(
          (Date.now() - QUOTE_LOOKBACK_DAYS * 86_400_000) / 1000,
        );

        const quotes = await fetchQuotes({ secretKey, pubkeyHex, since });
        secretKey.fill(0);

        const collected = new Set(this.collectedQuoteIds);
        this.waitingQuotes = quotes.filter(
          (q) => isPaid(q) && !collected.has(q.quoteId),
        );

        // The mint comes from the quotes rather than from us: npub.cash decides
        // where the ecash lives, and it can differ per payment in principle.
        const quoteMint = this.waitingQuotes.find((q) => q.mintUrl)?.mintUrl;
        if (quoteMint && !this.mintUrl) this.mintUrl = quoteMint;

        this.lastSyncAt = Date.now();
        this._persistMeta();
      } catch (err) {
        this.lastError = err instanceof NpubCashError ? err.code : 'SYNC_FAILED';
        console.warn('[social-bucket] sync failed:', err);
      } finally {
        this.isSyncing = false;
      }
    },

    /**
     * Move everything to one of the user's wallets.
     *
     * Order matters and is not negotiable: mint, persist, then melt. Minting
     * without persisting risks losing proofs to a crash; melting before
     * persisting risks the same in the failure path.
     *
     * @param {(sats:number) => Promise<string>} createInvoice destination wallet
     * @returns {Promise<{ok:boolean, moved?:number, fee?:number, reason?:string}>}
     */
    async sweepTo({ identityStore, createInvoice }) {
      if (this.isSweeping) return { ok: false, reason: 'BUSY' };
      if (!identityStore?.bootstrapped) return { ok: false, reason: 'NO_IDENTITY' };

      this.isSweeping = true;
      this.lastError = null;
      let secretKey;

      try {
        await this.hydrate();
        secretKey = await identityStore.getNostrSecretKeyBytes();
        const privkeyHex = bytesToHex(secretKey);

        // 1. Anything already minted may have been spent by an earlier attempt.
        if (this.heldProofs.length && this.mintUrl) {
          const live = await pruneSpentProofs({
            proofs: this.heldProofs,
            mintUrl: this.mintUrl,
          });
          if (live.length !== this.heldProofs.length) {
            this.heldProofs = live;
            await this._persistProofs();
          }
        }

        // 2. Mint whatever is still waiting.
        if (this.waitingQuotes.length) {
          const mintUrl =
            this.waitingQuotes.find((q) => q.mintUrl)?.mintUrl || this.mintUrl;

          const { proofs, minted, failed } = await mintQuotes({
            quotes: this.waitingQuotes,
            privkeyHex,
            mintUrl,
          });

          if (proofs.length) {
            this.mintUrl = mintUrl;
            this.heldProofs = [...this.heldProofs, ...proofs];
            // Persist before anything else can throw.
            await this._persistProofs();
          }

          if (minted.length) {
            this.collectedQuoteIds = [...this.collectedQuoteIds, ...minted];
            this.waitingQuotes = this.waitingQuotes.filter(
              (q) => !minted.includes(q.quoteId),
            );
            this._persistMeta();
          }

          if (failed.length && !proofs.length) {
            return { ok: false, reason: 'MINT_FAILED' };
          }
        }

        if (!this.heldProofs.length) return { ok: false, reason: 'EMPTY' };
        if (sumProofs(this.heldProofs) < MIN_SWEEP_SATS) {
          return { ok: false, reason: 'TOO_SMALL' };
        }

        // 3. Melt into the destination wallet.
        const { paid, fee, change } = await meltToInvoice({
          proofs: this.heldProofs,
          mintUrl: this.mintUrl,
          privkeyHex,
          createInvoice,
        });

        // Change is real money. Keep it for next time.
        this.heldProofs = change;
        await this._persistProofs();

        return { ok: true, moved: paid, fee };
      } catch (err) {
        console.warn('[social-bucket] sweep failed:', err);
        this.lastError = err?.code || 'SWEEP_FAILED';
        return { ok: false, reason: err?.code || 'SWEEP_FAILED' };
      } finally {
        if (secretKey) secretKey.fill(0);
        this.isSweeping = false;
      }
    },

    /**
     * Wipe local state. Called when the identity is erased or switched: the
     * bucket belongs to a key, and proofs from the old one are not the new
     * identity's money to see.
     *
     * Held proofs are NOT destroyed silently by a switch, because that would
     * burn money. Callers must sweep first; this only runs on erase.
     */
    reset() {
      this.waitingQuotes = [];
      this.heldProofs = [];
      this.mintUrl = null;
      this.collectedQuoteIds = [];
      this.lastSyncAt = null;
      this.lastError = null;
      localStorage.removeItem(STORAGE_KEYS.META);
      localStorage.removeItem(STORAGE_KEYS.PROOFS);
    },
  },
});

/** npub.cash reports state as a string; treat anything paid-ish as paid. */
function isPaid(quote) {
  const state = String(quote?.state || '').toUpperCase();
  if (state === 'ISSUED') return false; // already collected by someone
  return state === 'PAID' || Boolean(quote?.paidAt);
}

export { npubCashAddress, isNpubCashAddress, MIN_SWEEP_SATS };
