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
 * `held` is bearer money. It is encrypted locally and written to disk the
 * instant it exists, then mirrored as NIP-60 encrypted events on the owner's
 * Nostr relays. The local copy protects an interrupted operation; the relay
 * copy makes the same 12-word identity sufficient for device recovery.
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
import {
  fetchNip60WalletState,
  mergeCashuProofs,
  publishNip60WalletState,
} from '../services/nostrCashuWallet.js';

const STORAGE_KEYS = Object.freeze({
  META: 'buhoGO_social_bucket_v1',
  PROOFS: 'buhoGO_social_bucket_proofs_v1',
  NIP60_WALLET: 'buhoGO_social_bucket_nip60_wallet_v1',
});

/** Bump on a breaking change to the persisted shape. */
const META_VERSION = 1;

/** Quotes older than this are assumed collected; keeps the sync payload small. */
const QUOTE_LOOKBACK_DAYS = 90;

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

function normalizeOwnerPubkey(pubkey) {
  const normalized = typeof pubkey === 'string' ? pubkey.trim().toLowerCase() : '';
  return HEX_PUBKEY_RE.test(normalized) ? normalized : null;
}

function profileStorageKey(base, pubkey) {
  return pubkey ? `${base}:${pubkey}` : base;
}

function hasStoredBucket(pubkey) {
  return Object.values(STORAGE_KEYS).some(
    (base) => localStorage.getItem(profileStorageKey(base, pubkey)) !== null,
  );
}

function serializedMeta(state, ownerPubkey = state.ownerPubkey) {
  return JSON.stringify({
    version: META_VERSION,
    ownerPubkey,
    mintUrl: state.mintUrl,
    collectedQuoteIds: state.collectedQuoteIds.slice(-500),
    lastSyncAt: state.lastSyncAt,
    heldPaymentCount: Math.max(0, Number(state.heldPaymentCount) || 0),
    nip60TokenEventIds: state.nip60TokenEventIds,
    nip60BackupPending: state.nip60BackupPending,
    nip60LastBackedUpAt: state.nip60LastBackedUpAt,
  });
}

// Only one profile may claim the unscoped pre-upgrade bucket. Without this
// in-process latch, a very fast account switch during the first migration
// could copy the same bearer proofs into two profile namespaces.
let legacyMigrationOwner = null;

export const useSocialBucketStore = defineStore('socialBucket', {
  state: () => ({
    hydrated: false,
    hydrateRunId: 0,

    /** Profile that owns every local field below. Never shared across accounts. */
    ownerPubkey: null,

    /** Paid quotes not yet minted, from the last sync. */
    waitingQuotes: [],

    /** Paid receipts returned by the latest sync, including already moved ones. */
    recentReceipts: [],

    /** Minted proofs not yet moved to a wallet. Persisted encrypted. */
    heldProofs: [],

    /**
     * Number of received payments represented by held proofs. Proofs may be
     * split or consolidated, so their array length is not a payment count.
     */
    heldPaymentCount: null,

    /** Mint the held proofs belong to. One mint at a time by construction. */
    mintUrl: null,

    /** Quote ids already minted, so a re-sync never double counts them. */
    collectedQuoteIds: [],

    /** NIP-60 wallet metadata, encrypted locally and on Nostr relays. */
    nip60Wallet: null,

    /** Active kind:7375 events replaced/deleted by the next state transition. */
    nip60TokenEventIds: [],

    /** A local proof change still needs at least one relay acknowledgement. */
    nip60BackupPending: false,
    nip60LastBackedUpAt: null,

    lastSyncAt: null,
    isSyncing: false,
    syncOwnerPubkey: null,
    syncRunId: 0,
    isSweeping: false,
    /** 'checking' | 'collecting' | 'sending' while a sweep is active. */
    sweepStage: null,

    /** Last failure, for the one place in the UI that reports it. */
    lastError: null,
  }),

  getters: {
    /** Sats waiting at npub.cash, not yet minted. */
    waitingSats(state) {
      const waiting = Array.isArray(state.waitingQuotes) ? state.waitingQuotes : [];
      return waiting.reduce((t, q) => t + (Number(q.amount) || 0), 0);
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

    /** Unpaid receipts, independent of their amounts or proof count. */
    paymentCount(state) {
      const waiting = Array.isArray(state.waitingQuotes) ? state.waitingQuotes : [];
      return waiting.length + Math.max(0, Number(state.heldPaymentCount) || 0);
    },

    /** Below this a melt costs more than it moves. */
    canSweep() {
      return this.balanceSats >= MIN_SWEEP_SATS && !this.isSweeping;
    },
  },

  actions: {
    async hydrate({ pubkey } = {}) {
      const requestedOwner = normalizeOwnerPubkey(pubkey);
      if (
        this.isSweeping
        && requestedOwner
        && this.ownerPubkey
        && requestedOwner !== this.ownerPubkey
      ) {
        const err = new Error('Cannot switch Social Bucket profile during payout');
        err.code = 'SOCIAL_BUCKET_BUSY';
        throw err;
      }
      if (this.hydrated && (!requestedOwner || this.ownerPubkey === requestedOwner)) return;

      const hydrateRunId = this.hydrateRunId + 1;
      this.hydrateRunId = hydrateRunId;

      const hasScoped = requestedOwner ? hasStoredBucket(requestedOwner) : false;
      const hasLegacy = hasStoredBucket(null);
      const migrateLegacy = Boolean(
        requestedOwner
        && !hasScoped
        && hasLegacy
        && (!legacyMigrationOwner || legacyMigrationOwner === requestedOwner),
      );
      if (migrateLegacy) legacyMigrationOwner = requestedOwner;
      const releaseLegacyClaim = () => {
        if (legacyMigrationOwner === requestedOwner) legacyMigrationOwner = null;
      };
      const hydrationIsStale = () => (
        this.hydrateRunId !== hydrateRunId || this.ownerPubkey !== requestedOwner
      );

      // A profile switch changes the entire ownership domain. Keep the old
      // profile's persisted copy intact and clear only reactive memory before
      // hydrating the target profile.
      this._clearHydratedState();
      this.ownerPubkey = requestedOwner;

      const sourceOwner = migrateLegacy ? null : requestedOwner;
      try {
        const raw = localStorage.getItem(profileStorageKey(STORAGE_KEYS.META, sourceOwner));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.version === META_VERSION) {
            if (parsed.ownerPubkey && parsed.ownerPubkey !== requestedOwner) {
              throw new Error('Social Bucket owner does not match storage scope');
            }
            this.mintUrl = parsed.mintUrl ?? null;
            this.collectedQuoteIds = Array.isArray(parsed.collectedQuoteIds)
              ? parsed.collectedQuoteIds.slice(-500)
              : [];
            this.lastSyncAt = parsed.lastSyncAt ?? null;
            this.heldPaymentCount = Number.isFinite(Number(parsed.heldPaymentCount))
              ? Math.max(0, Number(parsed.heldPaymentCount))
              : null;
            this.nip60TokenEventIds = Array.isArray(parsed.nip60TokenEventIds)
              ? parsed.nip60TokenEventIds.filter((id) => typeof id === 'string')
              : [];
            this.nip60BackupPending = Boolean(parsed.nip60BackupPending);
            this.nip60LastBackedUpAt = parsed.nip60LastBackedUpAt ?? null;
          }
        }

        const envelope = localStorage.getItem(profileStorageKey(STORAGE_KEYS.PROOFS, sourceOwner));
        if (envelope) {
          const json = await decryptString(envelope);
          if (hydrationIsStale()) {
            releaseLegacyClaim();
            return;
          }
          const proofs = JSON.parse(json);
          if (Array.isArray(proofs)) this.heldProofs = proofs;
        }

        const nip60Envelope = localStorage.getItem(
          profileStorageKey(STORAGE_KEYS.NIP60_WALLET, sourceOwner),
        );
        if (nip60Envelope) {
          const json = await decryptString(nip60Envelope);
          if (hydrationIsStale()) {
            releaseLegacyClaim();
            return;
          }
          const wallet = JSON.parse(json);
          if (wallet && typeof wallet.privkey === 'string' && Array.isArray(wallet.mints)) {
            this.nip60Wallet = wallet;
          }
        }

        // Older persisted buckets predate the count. We cannot reconstruct
        // their exact receipt count from split proofs, but one actionable
        // payment is more honest than hiding held money altogether.
        if (this.heldPaymentCount === null) {
          this.heldPaymentCount = this.heldProofs.length ? 1 : 0;
        }
      } catch (err) {
        releaseLegacyClaim();
        if (hydrationIsStale()) return;
        // Never block the app on this. Worst case the bucket looks empty until
        // the next sync, and the proofs stay on disk for a later read.
        console.warn('[social-bucket] hydrate failed:', err);
        this.hydrated = false;
        return;
      }
      if (hydrationIsStale()) {
        releaseLegacyClaim();
        return;
      }
      this.hydrated = true;

      if (migrateLegacy) {
        // The pre-NIP-60 store had no owner field. The active profile at the
        // first upgraded launch is the only safe owner we can assign it to.
        const proofPlaintext = this.heldProofs.length
          ? JSON.stringify(this.heldProofs)
          : null;
        const walletPlaintext = this.nip60Wallet
          ? JSON.stringify(this.nip60Wallet)
          : null;
        const meta = serializedMeta(this, requestedOwner);
        try {
          const [proofEnvelope, walletEnvelope] = await Promise.all([
            proofPlaintext ? encryptString(proofPlaintext) : null,
            walletPlaintext ? encryptString(walletPlaintext) : null,
          ]);
          if (proofEnvelope) {
            localStorage.setItem(
              profileStorageKey(STORAGE_KEYS.PROOFS, requestedOwner),
              proofEnvelope,
            );
          }
          if (walletEnvelope) {
            localStorage.setItem(
              profileStorageKey(STORAGE_KEYS.NIP60_WALLET, requestedOwner),
              walletEnvelope,
            );
          }
          // Metadata is the migration commit marker and is written last.
          localStorage.setItem(profileStorageKey(STORAGE_KEYS.META, requestedOwner), meta);
          for (const base of Object.values(STORAGE_KEYS)) localStorage.removeItem(base);
        } catch (err) {
          // Remove a partial scoped write and keep the legacy copy intact so
          // migration can retry without selecting an incomplete destination.
          for (const base of Object.values(STORAGE_KEYS)) {
            localStorage.removeItem(profileStorageKey(base, requestedOwner));
          }
          console.warn('[social-bucket] legacy storage migration failed:', err);
          this.hydrated = false;
          throw err;
        } finally {
          releaseLegacyClaim();
        }
      }
    },

    _clearHydratedState() {
      this.waitingQuotes = [];
      this.recentReceipts = [];
      this.heldProofs = [];
      this.heldPaymentCount = null;
      this.mintUrl = null;
      this.collectedQuoteIds = [];
      this.nip60Wallet = null;
      this.nip60TokenEventIds = [];
      this.nip60BackupPending = false;
      this.nip60LastBackedUpAt = null;
      this.lastSyncAt = null;
      this.lastError = null;
      this.sweepStage = null;
      this.hydrated = false;
    },

    _persistMeta() {
      localStorage.setItem(
        profileStorageKey(STORAGE_KEYS.META, this.ownerPubkey),
        serializedMeta(this),
      );
    },

    /**
     * Write proofs to disk, encrypted. Awaited by every caller that has just
     * created them: this is the line that decides whether an interrupted sweep
     * loses money or not.
     */
    async _persistProofs() {
      const owner = this.ownerPubkey;
      const storageKey = profileStorageKey(STORAGE_KEYS.PROOFS, owner);
      if (!this.heldProofs.length) {
        localStorage.removeItem(storageKey);
        return;
      }
      const plaintext = JSON.stringify(this.heldProofs);
      const envelope = await encryptString(plaintext);
      localStorage.setItem(storageKey, envelope);
    },

    async _persistNip60Wallet() {
      if (!this.nip60Wallet) return;
      const owner = this.ownerPubkey;
      const storageKey = profileStorageKey(STORAGE_KEYS.NIP60_WALLET, owner);
      const plaintext = JSON.stringify(this.nip60Wallet);
      const envelope = await encryptString(plaintext);
      localStorage.setItem(storageKey, envelope);
    },

    /**
     * Merge relay state into the local crash-safe copy. Only one mint is
     * imported because the Social Bucket intentionally remains an inbox, not a
     * general multi-mint wallet. A clean restore can select the sole remote
     * mint; otherwise npub.cash/local metadata identifies the bucket's mint.
     */
    async _restoreNip60State(
      state,
      preferredMint,
      { validateProofs = pruneSpentProofs } = {},
    ) {
      if (!state) return;
      const restoreOwner = this.ownerPubkey;
      if (state.wallet) {
        this.nip60Wallet = state.wallet;
        await this._persistNip60Wallet();
        if (this.ownerPubkey !== restoreOwner) return;
      }

      const groups = Array.isArray(state.tokensByMint) ? state.tokensByMint : [];
      const targetMint = preferredMint
        || this.mintUrl
        || (groups.length === 1 ? groups[0].mint : null);
      if (!targetMint) return;

      const remote = groups.find((group) => group.mint === targetMint);
      if (!remote) {
        // Existing local proofs may predate NIP-60 and still need publishing.
        if (this.heldProofs.length && this.mintUrl === targetMint) {
          this.nip60BackupPending = true;
          this._persistMeta();
        }
        return;
      }
      if (this.heldProofs.length && this.mintUrl && this.mintUrl !== targetMint) {
        console.warn('[social-bucket] ignored NIP-60 proofs from a different mint');
        return;
      }

      const remoteProofs = mergeCashuProofs(remote.proofs);
      const merged = mergeCashuProofs(this.heldProofs, remoteProofs);
      let live;
      try {
        // Relay data is only a candidate. The mint remains authoritative about
        // whether a bearer proof is still spendable.
        live = await validateProofs({
          proofs: merged,
          mintUrl: targetMint,
          requireCheck: true,
        });
      } catch (err) {
        console.warn('[social-bucket] deferred NIP-60 restore until mint validation:', err);
        return;
      }
      if (this.ownerPubkey !== restoreOwner) return;

      this.mintUrl = targetMint;
      this.heldProofs = live;
      this.nip60TokenEventIds = remote.eventIds;
      // If local-only proofs were merged, or stale relay proofs were pruned,
      // publish a corrected snapshot while the identity key is available.
      this.nip60BackupPending = !state.wallet
        || live.length !== remoteProofs.length
        || merged.length !== remoteProofs.length;
      if (live.length && !(Number(this.heldPaymentCount) > 0)) {
        this.heldPaymentCount = Math.max(1, remote.eventIds.length);
      }
      if (!live.length) this.heldPaymentCount = 0;
      await this._persistProofs();
      this._persistMeta();
    },

    /** Publish the current local proof snapshot without touching npub.cash. */
    async _backupNip60(secretKey, history = {}) {
      if (!this.mintUrl) return { ok: false, reason: 'NO_MINT' };
      const backupOwner = this.ownerPubkey;
      try {
        const result = await publishNip60WalletState({
          secretKey,
          mint: this.mintUrl,
          proofs: this.heldProofs,
          previousTokenEventIds: this.nip60TokenEventIds,
          wallet: this.nip60Wallet,
          direction: history.direction,
          amount: history.amount,
        });
        if (this.ownerPubkey !== backupOwner) {
          return { ...result, appliedLocally: false };
        }
        this.nip60Wallet = result.wallet;
        if (result.stateAccepted) this.nip60TokenEventIds = result.tokenEventIds;
        this.nip60BackupPending = !result.ok;
        if (result.ok) this.nip60LastBackedUpAt = Date.now();
        await this._persistNip60Wallet();
        this._persistMeta();
        if (!result.ok) console.warn('[social-bucket] NIP-60 backup incomplete:', result.reason);
        return result;
      } catch (err) {
        if (this.ownerPubkey !== backupOwner) {
          return { ok: false, reason: 'PROFILE_CHANGED', appliedLocally: false };
        }
        this.nip60BackupPending = true;
        this._persistMeta();
        console.warn('[social-bucket] NIP-60 backup failed:', err);
        return { ok: false, reason: 'NIP60_BACKUP_FAILED' };
      }
    },

    /**
     * Ask npub.cash what has arrived.
     *
     * Read only and cheap. Safe to call on app open and whenever the user looks
     * at the Get paid screen.
     */
    async sync({
      identityStore,
      quoteFetcher = fetchQuotes,
      nip60Fetcher = fetchNip60WalletState,
    } = {}) {
      if (!identityStore?.bootstrapped) return;

      const pubkeyHex = normalizeOwnerPubkey(identityStore.nostrPubkeyHex);
      if (!pubkeyHex) return;
      if (this.isSyncing && this.syncOwnerPubkey === pubkeyHex) return;

      const runId = this.syncRunId + 1;
      this.syncRunId = runId;
      this.syncOwnerPubkey = pubkeyHex;

      this.isSyncing = true;
      this.lastError = null;
      try {
        await this.hydrate({ pubkey: pubkeyHex });

        let secretKey;
        const since = Math.floor(
          (Date.now() - QUOTE_LOOKBACK_DAYS * 86_400_000) / 1000,
        );

        let quotes;
        let nip60State = null;
        try {
          secretKey = await identityStore.getNostrSecretKeyBytes();
          const [quoteResult, nip60Result] = await Promise.allSettled([
            quoteFetcher({ secretKey, pubkeyHex, since }),
            nip60Fetcher({ secretKey, pubkey: pubkeyHex }),
          ]);
          if (quoteResult.status === 'rejected') throw quoteResult.reason;
          if (this.syncRunId !== runId || this.ownerPubkey !== pubkeyHex) return;
          quotes = quoteResult.value;
          if (nip60Result.status === 'fulfilled') nip60State = nip60Result.value;

          // History and actionable balance are different views. ISSUED quotes
          // have already been collected, but remain valid receipts for the
          // one-week profile-address history.
          this.recentReceipts = quotes.filter(isReceipt);

          const collected = new Set(this.collectedQuoteIds);
          this.waitingQuotes = quotes.filter(
            (q) => isPaid(q) && !collected.has(q.quoteId),
          );

          // The mint comes from npub.cash quote metadata. ISSUED receipts are
          // intentionally included here: after a clean device restore they
          // identify which NIP-60 wallet balance belongs to this inbox.
          const quoteMint = this.waitingQuotes.find((q) => q.mintUrl)?.mintUrl
            || this.recentReceipts.find((q) => q.mintUrl)?.mintUrl;
          if (quoteMint && !this.mintUrl) this.mintUrl = quoteMint;

          await this._restoreNip60State(nip60State, this.mintUrl || quoteMint);
          if (this.syncRunId !== runId || this.ownerPubkey !== pubkeyHex) return;
          if (this.heldProofs.length && (this.nip60BackupPending || !this.nip60TokenEventIds.length)) {
            await this._backupNip60(secretKey);
          }
        } finally {
          if (secretKey) secretKey.fill(0);
        }

        if (this.syncRunId !== runId || this.ownerPubkey !== pubkeyHex) return;

        this.lastSyncAt = Date.now();
        this._persistMeta();
      } catch (err) {
        if (this.syncRunId !== runId || this.ownerPubkey !== pubkeyHex) return;
        this.lastError = err instanceof NpubCashError ? err.code : 'SYNC_FAILED';
        console.warn('[social-bucket] sync failed:', err);
      } finally {
        if (this.syncRunId === runId) {
          this.isSyncing = false;
          this.syncOwnerPubkey = null;
        }
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
      this.sweepStage = 'checking';
      this.lastError = null;
      let secretKey;

      try {
        await this.hydrate({ pubkey: identityStore.nostrPubkeyHex });
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
            if (!live.length) {
              this.heldPaymentCount = 0;
              this._persistMeta();
            }
            await this._backupNip60(secretKey);
          }
        }

        // 2. Mint whatever is still waiting.
        if (this.waitingQuotes.length) {
          this.sweepStage = 'collecting';
          const mintUrl =
            this.waitingQuotes.find((q) => q.mintUrl)?.mintUrl || this.mintUrl;

          const { proofs, minted, failed } = await mintQuotes({
            quotes: this.waitingQuotes,
            privkeyHex,
            mintUrl,
          });

          if (proofs.length) {
            this.mintUrl = mintUrl;
            this.heldProofs = mergeCashuProofs(this.heldProofs, proofs);
            // Persist before anything else can throw.
            await this._persistProofs();
            this.nip60BackupPending = true;
          }

          if (minted.length) {
            this.heldPaymentCount = Math.max(0, Number(this.heldPaymentCount) || 0)
              + minted.length;
            this.collectedQuoteIds = [...this.collectedQuoteIds, ...minted];
            this.waitingQuotes = this.waitingQuotes.filter(
              (q) => !minted.includes(q.quoteId),
            );
            this._persistMeta();
          }

          if (proofs.length) {
            await this._backupNip60(secretKey, {
              direction: 'in',
              amount: sumProofs(proofs),
            });
          }

          // "Move everything" is one promise to the user. Minted proofs are
          // safely persisted above, but do not send a smaller amount to the
          // destination when any incoming payment could not be collected.
          // A retry resumes from the persisted proofs and remaining quotes.
          if (failed.length) {
            const reason = proofs.length ? 'MINT_PARTIAL' : 'MINT_FAILED';
            this.lastError = reason;
            return { ok: false, reason, remaining: this.balanceSats };
          }
        }

        if (!this.heldProofs.length) return { ok: false, reason: 'EMPTY' };
        if (sumProofs(this.heldProofs) < MIN_SWEEP_SATS) {
          return { ok: false, reason: 'TOO_SMALL' };
        }

        // 3. Melt into the destination wallet.
        this.sweepStage = 'sending';
        const { paid, fee, change } = await meltToInvoice({
          proofs: this.heldProofs,
          mintUrl: this.mintUrl,
          privkeyHex,
          createInvoice,
        });

        // Change is real money. Keep it for next time.
        this.heldProofs = change;
        await this._persistProofs();
        this.heldPaymentCount = 0;
        this._persistMeta();
        await this._backupNip60(secretKey, {
          direction: 'out',
          amount: paid,
        });

        return { ok: true, moved: paid, fee };
      } catch (err) {
        if (secretKey && this.heldProofs.length && this.mintUrl) {
          await this._backupNip60(secretKey);
        }
        console.warn('[social-bucket] sweep failed:', err);
        this.lastError = err?.code || 'SWEEP_FAILED';
        return { ok: false, reason: err?.code || 'SWEEP_FAILED' };
      } finally {
        if (secretKey) secretKey.fill(0);
        this.sweepStage = null;
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
      const owner = this.ownerPubkey;
      for (const base of Object.values(STORAGE_KEYS)) {
        localStorage.removeItem(profileStorageKey(base, owner));
      }
      this._clearHydratedState();
      this.ownerPubkey = null;
    },
  },
});

/** npub.cash reports state as a string; treat anything paid-ish as paid. */
function isPaid(quote) {
  const state = String(quote?.state || '').toUpperCase();
  if (state === 'ISSUED') return false; // already collected by someone
  return state === 'PAID' || Boolean(quote?.paidAt);
}

function isReceipt(quote) {
  const state = String(quote?.state || '').toUpperCase();
  return state === 'PAID' || state === 'ISSUED' || Boolean(quote?.paidAt);
}

export { npubCashAddress, isNpubCashAddress, MIN_SWEEP_SATS };
