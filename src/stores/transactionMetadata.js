import { defineStore } from 'pinia'
import { useAddressBookStore } from './addressBook.js'
import { fiatRatesService } from '../utils/fiatRates.js'

// A receive is only stamped with "today's rate" when it is genuinely fresh —
// this is the whole guardrail against ever backfilling a historical
// transaction with a rate it didn't actually settle at.
const FIAT_STAMP_WINDOW_MS = 10 * 60 * 1000

// How long a pending contact link survives in the queue. This must
// outlive "send now, open history days later" — the link is the only
// bridge between the send (where we know the recipient but not the
// provider-assigned tx id) and the tx list (where the id appears). A
// short TTL silently dropped these links before the user looked, which
// is exactly why old sends showed a generic icon instead of the
// contact. Matching precision does NOT come from the TTL — it comes
// from PENDING_LINK_TIME_WINDOW_MS below, which pins the link to a tx
// created within minutes of `sentAt`. So we can keep links for a long
// time cheaply; the queue is also size-capped on enqueue.
const PENDING_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Hard cap on the queue so the long TTL can't let unmatched links
// (e.g. sends whose tx never surfaced) grow without bound.
const MAX_PENDING_LINKS = 200

// How far apart a tx's timestamp may be from the pending link's
// `sentAt` for us to consider them the same payment. The tx list's
// `timestamp` is usually within a few seconds of the send call, but
// Spark settlement can lag, so 5 minutes catches everything in practice
// without being so wide it can swallow an unrelated next send.
const PENDING_LINK_TIME_WINDOW_MS = 5 * 60 * 1000

// ---------------------------------------------------------------------------
// Storage key — wallet-scoped metadata
//
// Transaction ids are only unique WITHIN a wallet: when both sides of a
// payment live in this app (a send from one wallet and a receive on
// another wallet that fronts the same node, or an internal transfer
// between two of our own wallets) both transactions share the same
// payment hash, and therefore the same provider-assigned id. Keying the
// metadata map by the bare id let a note/tag/contact/successAction
// written for one side silently leak onto the other. Composing the
// wallet id into the key is the fix.
// ---------------------------------------------------------------------------

/**
 * Build the storage key for a transaction's metadata record.
 *
 * Returns the bare `txId` when `walletId` is falsy — that is exactly the
 * legacy (pre-scoping) key shape, which is what lets every read call
 * site fall back to records already on disk with no migration step.
 *
 * Private to this module — every read/write goes through this (or
 * `_resolveMetadata`, below) rather than building the key inline.
 *
 * @param {string} txId
 * @param {string} [walletId]
 * @returns {string}
 */
function _key(txId, walletId) {
  return walletId ? `${walletId}::${txId}` : txId
}

/**
 * Inverse of `_key`: split a storage key back into its parts. A
 * composite key splits into both `walletId` and `txId`; a legacy bare
 * key (no wallet id was known when it was written) yields
 * `walletId: null`.
 *
 * @param {string} key
 * @returns {{txId: string, walletId: string|null}}
 */
function _splitKey(key) {
  const sep = key.indexOf('::')
  if (sep === -1) return { txId: key, walletId: null }
  return { walletId: key.slice(0, sep), txId: key.slice(sep + 2) }
}

/**
 * Resolve a transaction's metadata record: the wallet-scoped composite
 * key first, falling back to the legacy bare `txId` key so every record
 * already on disk keeps working with no migration. The legacy bare-key
 * record is read-only from this point on — a write always lands on the
 * composite key once a walletId is available (see the `set*` actions
 * below); nothing ever writes to the bare key again.
 *
 * @param {object} state - the store's reactive state (has `.metadata`)
 * @param {string} txId
 * @param {string} [walletId]
 * @returns {object|null}
 */
function _resolveMetadata(state, txId, walletId) {
  if (walletId) {
    const scoped = state.metadata[_key(txId, walletId)]
    if (scoped) return scoped
  }
  return state.metadata[txId] || null
}

export const useTransactionMetadataStore = defineStore('transactionMetadata', {
  state: () => ({
    // Map of storage key (`${walletId}::${txId}`, or a legacy bare
    // `txId`) to metadata object.
    metadata: {},
    // Queue of outgoing payments whose tx-id we don't know yet. Each
    // entry remembers the contact we sent to so when the new tx
    // appears in the list we can stamp it without having to derive
    // the id from the provider response (which varies by wallet — NWC
    // returns only `preimage`, Spark returns a payment id that isn't
    // the transfer id, etc.).
    pendingContactLinks: [],
    // True once initialize() has loaded (or attempted to load) both
    // localStorage-backed collections. Callers that can run before the
    // normal boot path (kiosk in particular boots on a separate path
    // that may bypass the usual store init) must lazily initialize
    // before touching pendingContactLinks — otherwise an early caller's
    // empty in-memory queue would get persisted over, and silently
    // clobber, whatever was already on disk.
    initialized: false
  }),

  getters: {
    /**
     * Get metadata for a specific transaction. Reads the wallet-scoped
     * composite record first, falling back to the legacy bare-txId
     * record — see `_resolveMetadata`. `walletId` is optional so a
     * caller not yet passing one still gets the legacy read behavior
     * (no warning logged either way; only writes require a walletId).
     *
     * @param {string} txId
     * @param {string} [walletId]
     * @returns {object|null}
     */
    getMetadataForTransaction: (state) => (txId, walletId) => {
      return _resolveMetadata(state, txId, walletId)
    },

    /**
     * Get contact for a transaction (returns full contact object from
     * address book), scoped to `walletId`. Resolution order:
     *   1. An explicit contactId — a manual "Assign contact" choice wins.
     *   2. A manual "Remove contact" (contactCleared) — stay anonymous
     *      even if the address would otherwise resolve to a contact.
     *   3. The durable recipientAddress, resolved LIVE against the
     *      address book. This is what makes "add the contact later and
     *      every past payment to that address lights up" work, with no
     *      re-scan or re-stamp: the avatar/name simply follow the book.
     *
     * @param {string} txId
     * @param {string} [walletId]
     * @returns {object|null}
     */
    getContactForTransaction: (state) => (txId, walletId) => {
      const metadata = _resolveMetadata(state, txId, walletId)
      if (!metadata) return null

      const addressBookStore = useAddressBookStore()
      if (metadata.contactId) return addressBookStore.getEntryById(metadata.contactId)
      if (metadata.contactCleared) return null
      if (metadata.recipientAddress) return addressBookStore.findContactByAddress(metadata.recipientAddress)
      return null
    },

    /**
     * Get tags for a transaction, scoped to `walletId`.
     * @param {string} txId
     * @param {string} [walletId]
     * @returns {string[]}
     */
    getTagsForTransaction: (state) => (txId, walletId) => {
      const metadata = _resolveMetadata(state, txId, walletId)
      return metadata?.tags || []
    },

    /**
     * Get note for a transaction, scoped to `walletId`.
     * @param {string} txId
     * @param {string} [walletId]
     * @returns {string}
     */
    getNoteForTransaction: (state) => (txId, walletId) => {
      const metadata = _resolveMetadata(state, txId, walletId)
      return metadata?.customNote || ''
    },

    /**
     * Get the LUD-09 successAction (the recipient's post-payment message)
     * attached to a transaction, scoped to `walletId`, already resolved
     * for display.
     * @param {string} txId
     * @param {string} [walletId]
     * @returns {object|null}
     */
    getSuccessActionForTransaction: (state) => (txId, walletId) => {
      const metadata = _resolveMetadata(state, txId, walletId)
      return metadata?.successAction || null
    },

    /**
     * Get the LUD-21 verify URL stamped on a transaction, scoped to
     * `walletId`, so Tx Details can re-poll to confirm fiat delivery.
     * null when the send had none.
     * @param {string} txId
     * @param {string} [walletId]
     * @returns {string|null}
     */
    getVerifyUrlForTransaction: (state) => (txId, walletId) => {
      const metadata = _resolveMetadata(state, txId, walletId)
      return metadata?.verifyUrl || null
    },

    /**
     * Get the cached LUD-21 delivery status for a transaction (receipt +
     * recipient), scoped to `walletId`, stored once a poll confirmed
     * delivery so later views need no re-poll. null until confirmed.
     * @param {string} txId
     * @param {string} [walletId]
     * @returns {object|null}
     */
    getDeliveryStatusForTransaction: (state) => (txId, walletId) => {
      const metadata = _resolveMetadata(state, txId, walletId)
      return metadata?.deliveryStatus || null
    },

    /**
     * Get the stored BTC-price-at-settlement snapshot for a transaction
     * ({ currency, amount, rate, capturedAt }), scoped to `walletId`, for
     * the providers that don't hand us one directly (everyone except
     * LNbits — see txNormalizer.js). null until a send or a fresh receive
     * stamps one.
     * @param {string} txId
     * @param {string} [walletId]
     * @returns {object|null}
     */
    getFiatAtSettlementForTransaction: (state) => (txId, walletId) => {
      const metadata = _resolveMetadata(state, txId, walletId)
      return metadata?.fiatAtSettlement || null
    },

    /**
     * Get the free-text label stamped on a transaction by a non-address-book
     * send path (internal transfer, batch send, kiosk sale), scoped to
     * `walletId`. null when unset.
     * @param {string} txId
     * @param {string} [walletId]
     * @returns {string|null}
     */
    getLabelForTransaction: (state) => (txId, walletId) => {
      const metadata = _resolveMetadata(state, txId, walletId)
      return metadata?.label || null
    },

    /**
     * Get the machine-readable source enum stamped on a transaction
     * ('internal-transfer' | 'batch' | 'kiosk'), scoped to `walletId`.
     * null when unset.
     * @param {string} txId
     * @param {string} [walletId]
     * @returns {string|null}
     */
    getSourceForTransaction: (state) => (txId, walletId) => {
      const metadata = _resolveMetadata(state, txId, walletId)
      return metadata?.source || null
    },

    /**
     * Get the resolved Nostr counterparty avatar stamped on a transaction
     * at send time ({ kind: 'nostr', npub, picture }; picture may be
     * null), scoped to `walletId`. null when unset.
     * @param {string} txId
     * @param {string} [walletId]
     * @returns {object|null}
     */
    getCounterpartyAvatarForTransaction: (state) => (txId, walletId) => {
      const metadata = _resolveMetadata(state, txId, walletId)
      return metadata?.counterpartyAvatar || null
    },

    /**
     * Get the Branta merchant verification stamped on a transaction at
     * send time ({ name, logoUrl, logoLightUrl, verifyUrl }), scoped to
     * `walletId`. null when the destination wasn't Branta-verified (or
     * verification was off) at send time.
     * @param {string} txId
     * @param {string} [walletId]
     * @returns {object|null}
     */
    getMerchantVerificationForTransaction: (state) => (txId, walletId) => {
      const metadata = _resolveMetadata(state, txId, walletId)
      return metadata?.merchantVerification || null
    },

    /**
     * Get the curated point-of-sale breakdown stamped on a transaction by
     * the kiosk sale path ({ baseSats, tipSats, tipPercent, roundUp,
     * discountSats, itemCount, totalSats }), scoped to `walletId`. null
     * when unset (not a kiosk sale, or the invoice never reached a
     * positive total).
     * @param {string} txId
     * @param {string} [walletId]
     * @returns {object|null}
     */
    getSaleBreakdownForTransaction: (state) => (txId, walletId) => {
      const metadata = _resolveMetadata(state, txId, walletId)
      return metadata?.saleBreakdown || null
    },

    /**
     * Get all transactions that have a specific tag, across every wallet.
     * Storage keys are wallet-scoped composite keys (or legacy bare
     * txIds), so a bare txId string is no longer enough on its own to
     * identify a record — callers get both parts back so a follow-up
     * read/write can still be scoped correctly. `walletId` is null for a
     * legacy record that predates wallet scoping.
     * @param {string} tag
     * @returns {{txId: string, walletId: string|null}[]}
     */
    getTransactionsWithTag: (state) => (tag) => {
      return Object.keys(state.metadata)
        .filter(key => state.metadata[key]?.tags?.includes(tag))
        .map(key => _splitKey(key))
    },

    /**
     * Get all transactions linked to a specific contact, across every
     * wallet. Same `{ txId, walletId }` shape as getTransactionsWithTag,
     * for the same reason.
     * @param {string} contactId
     * @returns {{txId: string, walletId: string|null}[]}
     */
    getTransactionsForContact: (state) => (contactId) => {
      return Object.keys(state.metadata)
        .filter(key => state.metadata[key]?.contactId === contactId)
        .map(key => _splitKey(key))
    },

    // Get all used tags (for autocomplete/suggestions). Reads values, not
    // keys, so wallet-scoped composite keys are already transparent to it
    // — no change needed for wallet scoping.
    getAllTags: (state) => {
      const tagsSet = new Set()
      Object.values(state.metadata).forEach(meta => {
        if (meta.tags) {
          meta.tags.forEach(tag => tagsSet.add(tag))
        }
      })
      return Array.from(tagsSet).sort()
    }
  },

  actions: {
    // Initialize store from localStorage. Agnostic to whether keys in the
    // persisted blob are legacy bare txIds or wallet-scoped composite
    // keys — it's just a JSON blob either way, so both shapes load as-is.
    async initialize() {
      try {
        const savedMetadata = localStorage.getItem('buhoGO_transaction_metadata')
        if (savedMetadata) {
          this.metadata = JSON.parse(savedMetadata)
        }
      } catch (error) {
        console.error('Error loading transaction metadata:', error)
        this.metadata = {}
      }
      try {
        const savedPending = localStorage.getItem('buhoGO_pending_contact_links')
        if (savedPending) {
          const parsed = JSON.parse(savedPending)
          // Drop stale entries on load so a crash mid-send can't leave
          // a zombie link hanging around forever.
          const now = Date.now()
          this.pendingContactLinks = Array.isArray(parsed)
            ? parsed.filter((link) => now - (link?.sentAt || 0) < PENDING_LINK_TTL_MS)
            : []
        }
      } catch (error) {
        console.error('Error loading pending contact links:', error)
        this.pendingContactLinks = []
      }
      this.initialized = true
    },

    /**
     * Queue a pending link for an in-flight send. Called from the
     * Wallet's confirmPayment success path before we know the
     * provider-assigned tx id. `consumePendingContactLinks` resolves
     * the queue against the tx list on the next refresh.
     *
     * `recipientAddress` is required; `contactId` is optional. We queue
     * a link for EVERY saveable outgoing send, not only ones to a known
     * contact, so the recipient address gets stamped onto the tx no
     * matter what. That durable address is what later lets a contact
     * added/edited after the fact resolve live (see getContactForTransaction).
     *
     * Ordinary links are idempotent for the same (contactId,
     * recipientAddress, amountSats, walletId) combination within the TTL
     * window — a rage-tap won't accidentally claim two unrelated outgoing
     * txs. Per-payment links deliberately opt out of that de-duplication.
     *
     * `label` (free display text, e.g. "Transfer to Business") and `source`
     * (machine-readable enum: 'internal-transfer' | 'batch' | 'kiosk') let
     * non-address-book send paths annotate the tx once it surfaces, the same
     * way a recipient address does for the main send flow. `direction`
     * defaults to 'outgoing' (matching every other field here); pass
     * 'incoming' for the receiving half of a flow (e.g. the credit side of
     * an internal transfer, or a kiosk sale).
     *
     * `counterpartyAvatar` ({ kind: 'nostr', npub, picture }, picture may be
     * null) carries the resolved Nostr identity behind a bare npub/nprofile/
     * NIP-05 send, so the tx row + details hero can show the person's real
     * picture instead of a generic icon. Per-payment like label/source (see
     * below) — never merged into an existing link.
     *
     * `merchantVerification` ({ name, logoUrl, logoLightUrl, verifyUrl })
     * carries the Branta-verified merchant identity behind the send (see
     * runBrantaVerification/lookupBrantaVerification in Wallet.vue), so Tx
     * Details can show "you paid a verified merchant" on the receipt, not
     * only on the confirm screen before sending. Per-payment like
     * counterpartyAvatar above — never merged into an existing link.
     *
     * `saleBreakdown` (subtotal/tip/round-up/discount/item-count/total)
     * carries the curated point-of-sale breakdown a kiosk sale captured at
     * invoice-creation time (see KioskDashboard.vue's saleBreakdownSnapshot
     * — parking or resetting the register clears the live POS state before
     * a payment settles, so the kiosk snapshots a plain object up front
     * instead of recomputing one here). Per-payment like label/source/
     * counterpartyAvatar above — never merged into an existing link.
     *
     * `perPayment` opts an otherwise plain address/contact link out of
     * de-duplication. Interactive contact sends use it because two valid
     * sends can have the same recipient and amount.
     *
     * `walletId` is the wallet whose transaction list will show the tx once
     * it surfaces — consumePendingContactLinks(transactions, walletId) only
     * drains a link whose walletId matches (or that carries none at all, a
     * legacy queue entry from before this scoping existed). This is what
     * keeps, for example, an internal transfer's two legs from
     * cross-contaminating: see wallet.js's transferBetweenWallets, which
     * queues the outgoing leg with the source wallet's id and the incoming
     * leg with the destination's.
     */
    async enqueuePendingContactLink({
      contactId,
      recipientAddress,
      amountSats,
      successAction = null,
      verifyUrl = null,
      label = null,
      source = null,
      counterpartyAvatar = null,
      merchantVerification = null,
      saleBreakdown = null,
      perPayment = false,
      direction = 'outgoing',
      walletId = null,
    }) {
      // A caller may run before the normal boot path initializes this store
      // (kiosk in particular). Load whatever is already on disk first so we
      // never overwrite it with an empty in-memory queue.
      if (!this.initialized) await this.initialize()

      // Queue when there's anything to stamp once the tx surfaces: a recipient
      // address (for live contact resolution), a LUD-09 successAction (the
      // recipient's post-payment message), a LUD-21 verify URL (so Tx Details
      // can re-confirm fiat delivery later), a label/source (batch, internal
      // transfer, kiosk), and/or a kiosk saleBreakdown.
      if (!recipientAddress && !successAction && !verifyUrl && !label && !source && !merchantVerification && !saleBreakdown) return
      const now = Date.now()
      const normalisedAddress = recipientAddress
        ? String(recipientAddress).toLowerCase().trim()
        : ''
      const amount = Number(amountSats) || 0
      const normalisedDirection = direction === 'incoming' ? 'incoming' : 'outgoing'
      const normalisedWalletId = walletId || null

      // Drop stale entries first.
      this.pendingContactLinks = this.pendingContactLinks.filter(
        (link) => now - (link.sentAt || 0) < PENDING_LINK_TTL_MS,
      )

      // A link carrying a LUD-09 successAction, a LUD-21 verify URL, an
      // explicit per-payment flag, a label/source, a counterpartyAvatar, a
      // merchantVerification, or a saleBreakdown is PER-PAYMENT (each send
      // has its own message, receipt, annotation, resolved identity, verified
      // merchant, or POS breakdown), so it must never be merged or collapsed.
      // This matters especially for batch/kiosk, where two unrelated payments
      // can easily share the same recipient + amount.
      const isPerPayment = !!perPayment || !!successAction || !!verifyUrl || !!label || !!source || !!counterpartyAvatar || !!merchantVerification || !!saleBreakdown
      if (!isPerPayment) {
        // A plain link (recipient address, maybe a contactId) is either a
        // double-submit or a post-save "add the contactId" upgrade. Merge it
        // into an existing link for the same recipient + amount + wallet
        // rather than appending a duplicate: this upgrades the original link
        // (keeping any successAction / verifyUrl it already carries) with the
        // contactId instead of stranding it, and still collapses genuine
        // double-submits. Scoped by walletId too, so the same recipient +
        // amount sent from two different wallets around the same time stays
        // two distinct links.
        const existing = this.pendingContactLinks.find(
          (link) => link.recipientAddress === normalisedAddress
            && link.amountSats === amount
            && (link.walletId || null) === normalisedWalletId,
        )
        if (existing) {
          if (contactId && !existing.contactId) existing.contactId = contactId
          await this.persistPendingLinks()
          return
        }
      }

      this.pendingContactLinks.push({
        contactId: contactId || null,
        recipientAddress: normalisedAddress,
        amountSats: amount,
        successAction: successAction || null,
        verifyUrl: verifyUrl || null,
        label: label || null,
        source: source || null,
        counterpartyAvatar: counterpartyAvatar || null,
        merchantVerification: merchantVerification || null,
        saleBreakdown: saleBreakdown || null,
        perPayment: !!perPayment,
        direction: normalisedDirection,
        walletId: normalisedWalletId,
        sentAt: now,
      })
      // Bound the queue: with a long TTL, links for sends that never
      // produced a visible tx would otherwise accumulate. Keep the most
      // recent ones — the freshest sends are the ones worth resolving.
      if (this.pendingContactLinks.length > MAX_PENDING_LINKS) {
        this.pendingContactLinks = this.pendingContactLinks.slice(-MAX_PENDING_LINKS)
      }
      await this.persistPendingLinks()
      console.log(
        '[txMetadata] queued contact link',
        { contactId, recipientAddress: normalisedAddress, amountSats: amount, label, source, direction: normalisedDirection, walletId: normalisedWalletId },
        'queue size:',
        this.pendingContactLinks.length,
      )
    },

    /**
     * Drain the pending queue against a list of transactions belonging to
     * `walletId`, tagging txs that fall inside the time window of a queued
     * link. Only links whose `walletId` matches the one passed here — or
     * that carry no walletId at all (a legacy queue entry from before this
     * scoping existed, which still matches anything so nothing already
     * queued is stranded) — are considered; a link queued for a different
     * wallet is left untouched in the queue for that wallet's own refresh
     * to consume later. This is the fix for the internal-transfer case
     * that motivated wallet-scoping: without it, the incoming leg could be
     * drained against whichever wallet's list happened to refresh first.
     *
     * Direction is per-link: the default 'outgoing' links only ever match
     * outgoing txs (as always), while a link queued with direction
     * 'incoming' (transfer credit side, kiosk sale) only matches incoming
     * txs.
     *
     * Matching strategy: for each pending link, pick the newest
     * unassigned same-direction tx whose timestamp is within the window.
     * Amount is used only as a *tie-breaker* when multiple txs match
     * the window — never as a hard filter — because providers report
     * the send amount inconsistently (fees included vs not, sign
     * flipped on some rails, rounding on Spark, etc.). The looser
     * match is fine in practice: a user almost never has two sends
     * in flight within five minutes that they want linked to
     * different contacts.
     *
     * Idempotent — once a link is consumed it disappears, and txs
     * that already have a contactId are skipped.
     *
     * @param {object[]} transactions - the owning wallet's own tx list
     * @param {string} [walletId] - the wallet `transactions` belongs to
     * @returns {Promise<number>} count of links consumed
     */
    async consumePendingContactLinks(transactions, walletId) {
      // Same lazy-init guard as enqueue: a caller on a separate boot path
      // (kiosk) must load the persisted queue before it can safely read or
      // rewrite it.
      if (!this.initialized) await this.initialize()

      if (!Array.isArray(transactions) || transactions.length === 0) return 0
      if (!this.pendingContactLinks || this.pendingContactLinks.length === 0) return 0

      const now = Date.now()
      let remaining = this.pendingContactLinks.filter(
        (link) => now - (link.sentAt || 0) < PENDING_LINK_TTL_MS,
      )

      let matched = 0
      let mutated = remaining.length !== this.pendingContactLinks.length

      // A tx is "stamped" once it has a contactId, a recipientAddress, a
      // successAction, a label, or a source, so a later link can't re-claim
      // a tx an earlier link already resolved. Scoped to `walletId` so a
      // record belonging to a DIFFERENT wallet that happens to share this
      // tx id is never consulted.
      const isStamped = (tx) => {
        const m = _resolveMetadata(this, tx.id, walletId)
        return !!(m?.contactId || m?.recipientAddress || m?.successAction || m?.label || m?.source)
      }

      const isOutgoingTx = (tx) => {
        const t = (tx.type || '').toLowerCase()
        if (t === 'send' || t === 'sent' || t === 'outgoing') return true
        if (t === 'receive' || t === 'received' || t === 'incoming') return false
        return Number(tx.amount || 0) < 0
      }

      // Unstamped candidates, newest first, split by direction — a link
      // with direction 'incoming' (e.g. the credit half of an internal
      // transfer, a kiosk sale) only ever matches incoming txs; every other
      // link keeps matching outgoing only, same as before.
      const buildCandidates = (wantIncoming) => transactions
        .filter((tx) => {
          if (!tx?.id) return false
          if (isStamped(tx)) return false
          return isOutgoingTx(tx) !== wantIncoming
        })
        .map((tx) => ({ tx, timeMs: this._resolveTxTimeMs(tx) }))
        .sort((a, b) => b.timeMs - a.timeMs)

      const outgoingCandidates = buildCandidates(false)
      const incomingCandidates = buildCandidates(true)

      // Track which candidate ids we've already claimed in this pass.
      const claimed = new Set()

      // Only links that belong to this wallet — or predate wallet-scoping
      // entirely (no walletId recorded) — are eligible this pass. Walk
      // newest-first too, so an older link doesn't snatch the freshest tx
      // away from a more-recent send.
      const linksByRecency = [...remaining]
        .filter((link) => !link.walletId || link.walletId === walletId)
        .sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0))

      for (const link of linksByRecency) {
        const linkSentAt = link.sentAt || 0
        const pool = link.direction === 'incoming' ? incomingCandidates : outgoingCandidates
        // In-window candidates that nobody else has claimed yet.
        const eligible = pool.filter(({ tx, timeMs }) => {
          if (claimed.has(tx.id)) return false
          if (!timeMs) return true
          return Math.abs(timeMs - linkSentAt) <= PENDING_LINK_TIME_WINDOW_MS
        })
        if (eligible.length === 0) continue

        // Amount match. Providers report a send's amount inconsistently
        // (fee included or not), so compare against the normalized
        // recipient amount when the caller passed normalized txs, and
        // fall back to the raw amount, accepting a couple of sats of
        // slack for the fee semantics we cannot see from here.
        const amountMatches = ({ tx }) => {
          if (!link.amountSats) return false
          const candidates = [tx.recipientSats, tx.totalSats, tx.amount]
            .map((v) => Math.abs(Number(v) || 0))
            .filter((v) => v > 0)
          return candidates.some((v) => Math.abs(v - link.amountSats) <= 2)
        }

        // A link carrying only a label/source (internal transfer, kiosk
        // sale, batch send) has no address to prove which tx it belongs
        // to, so the amount is the ONLY evidence we have. Without a
        // match, stay silent rather than stamping "Transfer from
        // Personal" onto an unrelated payment that happened to land in
        // the same five-minute window. An address-bearing link keeps the
        // looser newest-in-window fallback it always had: the address it
        // stamps is the thing the user cares about, and a send is far
        // more reliably the newest outgoing tx than a receive is.
        const needsAmountProof = !link.recipientAddress && (link.label || link.source)
        const exact = eligible.find(amountMatches)
        if (needsAmountProof && !exact) continue

        const pick = exact || eligible[0]

        try {
          // Always stamp the durable recipient address; stamp the
          // contactId only when we knew it at send time. With the
          // address recorded, the contact resolves live thereafter even
          // if it was added/edited after this send. Every stamp is scoped
          // to `walletId` — the wallet whose list `transactions` came from.
          if (link.recipientAddress) {
            await this.setRecipientAddressForTransaction(pick.tx.id, walletId, link.recipientAddress)
          }
          if (link.contactId) {
            await this.setContactForTransaction(pick.tx.id, walletId, link.contactId)
          }
          if (link.successAction) {
            await this.setSuccessActionForTransaction(pick.tx.id, walletId, link.successAction)
          }
          if (link.verifyUrl) {
            await this.setVerifyUrlForTransaction(pick.tx.id, walletId, link.verifyUrl)
          }
          if (link.label) {
            await this.setLabelForTransaction(pick.tx.id, walletId, link.label)
          }
          if (link.source) {
            await this.setSourceForTransaction(pick.tx.id, walletId, link.source)
          }
          if (link.counterpartyAvatar) {
            await this.setCounterpartyAvatarForTransaction(pick.tx.id, walletId, link.counterpartyAvatar)
          }
          if (link.merchantVerification) {
            await this.setMerchantVerificationForTransaction(pick.tx.id, walletId, link.merchantVerification)
          }
          if (link.saleBreakdown) {
            await this.setSaleBreakdownForTransaction(pick.tx.id, walletId, link.saleBreakdown)
          }
          claimed.add(pick.tx.id)
          remaining = remaining.filter((l) => l !== link)
          mutated = true
          matched += 1
        } catch (err) {
          console.warn('[txMetadata] failed to stamp tx from pending link:', err)
        }
      }

      if (mutated) {
        this.pendingContactLinks = remaining
        await this.persistPendingLinks()
      }
      if (matched > 0 || linksByRecency.length > 0) {
        console.log(
          '[txMetadata] consumePendingContactLinks:',
          { matched, remaining: remaining.length, candidates: outgoingCandidates.length + incomingCandidates.length, txCount: transactions.length, walletId: walletId || null },
        )
      }
      return matched
    },

    /**
     * Tx timestamps come from different fields depending on the
     * provider — Spark uses `createdTime`, NWC uses `settled_at`,
     * the normalised path on TransactionHistory writes `timestamp`.
     * Returns ms since epoch, or 0 when nothing parses.
     */
    _resolveTxTimeMs(tx) {
      const raw = tx?.timestamp ?? tx?.settled_at ?? tx?.createdTime ?? tx?.created_at ?? null
      if (raw == null) return 0
      if (typeof raw === 'number') {
        // Seconds vs ms — values below 1e12 are seconds.
        return raw < 1e12 ? raw * 1000 : raw
      }
      const t = Date.parse(raw)
      return Number.isFinite(t) ? t : 0
    },

    async persistPendingLinks() {
      try {
        localStorage.setItem(
          'buhoGO_pending_contact_links',
          JSON.stringify(this.pendingContactLinks),
        )
      } catch (error) {
        console.error('Error saving pending contact links:', error)
      }
    },

    /**
     * Stamp a contact on a transaction, scoped to `walletId` (storage key
     * `${walletId}::${txId}` — see `_key`). A write always requires a
     * walletId: without one this is a no-op that logs a warning rather
     * than throwing, so a metadata bug can never interrupt a payment path.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {string} contactId
     * @returns {Promise<object|null>}
     */
    async setContactForTransaction(txId, walletId, contactId) {
      try {
        if (!txId) {
          throw new Error('Transaction ID is required')
        }
        if (!walletId) {
          console.warn('[txMetadata] setContactForTransaction: missing walletId, skipping write', { txId })
          return null
        }

        const key = _key(txId, walletId)
        // Initialize metadata object if it doesn't exist
        if (!this.metadata[key]) {
          this.metadata[key] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now()
          }
        }

        // Update contact ID. Assigning a real contact also lifts any
        // prior manual "removed" flag, so re-assigning after a removal
        // sticks instead of being suppressed by live resolution.
        this.metadata[key].contactId = contactId
        if (contactId) this.metadata[key].contactCleared = false
        this.metadata[key].updatedAt = Date.now()

        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error setting contact for transaction:', error)
        throw error
      }
    },

    /**
     * Stamp the durable recipient address on a transaction, scoped to
     * `walletId`. This is the fact that survives — getContactForTransaction
     * resolves it live against the address book, so a contact added later
     * still lights up past payments to the same address. Never overwrites
     * an address that's already set. Requires a walletId (see
     * setContactForTransaction) — a missing one warns and no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {string} address
     * @returns {Promise<object|null>}
     */
    async setRecipientAddressForTransaction(txId, walletId, address) {
      try {
        if (!txId || !address) return null
        if (!walletId) {
          console.warn('[txMetadata] setRecipientAddressForTransaction: missing walletId, skipping write', { txId })
          return null
        }
        const key = _key(txId, walletId)
        if (!this.metadata[key]) {
          this.metadata[key] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now(),
          }
        }
        if (this.metadata[key].recipientAddress) return this.metadata[key]
        this.metadata[key].recipientAddress = String(address).toLowerCase().trim()
        this.metadata[key].updatedAt = Date.now()
        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error setting recipient address for transaction:', error)
        return null
      }
    },

    /**
     * Stamp a free-text label on a transaction (e.g. "Transfer to Business",
     * "Kiosk sale"), scoped to `walletId`, from a non-address-book send
     * path. Same never-overwrite pattern as setRecipientAddressForTransaction
     * — the first stamp wins. Requires a walletId — a missing one warns
     * and no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {string} label
     * @returns {Promise<object|null>}
     */
    async setLabelForTransaction(txId, walletId, label) {
      try {
        if (!txId || !label) return null
        if (!walletId) {
          console.warn('[txMetadata] setLabelForTransaction: missing walletId, skipping write', { txId })
          return null
        }
        const key = _key(txId, walletId)
        if (!this.metadata[key]) {
          this.metadata[key] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now(),
          }
        }
        if (this.metadata[key].label) return this.metadata[key]
        this.metadata[key].label = label
        this.metadata[key].updatedAt = Date.now()
        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error setting label for transaction:', error)
        return null
      }
    },

    /**
     * Stamp the machine-readable source enum on a transaction
     * ('internal-transfer' | 'batch' | 'kiosk'), scoped to `walletId`.
     * Same never-overwrite pattern as setRecipientAddressForTransaction —
     * the first stamp wins. Requires a walletId — a missing one warns and
     * no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {string} source
     * @returns {Promise<object|null>}
     */
    async setSourceForTransaction(txId, walletId, source) {
      try {
        if (!txId || !source) return null
        if (!walletId) {
          console.warn('[txMetadata] setSourceForTransaction: missing walletId, skipping write', { txId })
          return null
        }
        const key = _key(txId, walletId)
        if (!this.metadata[key]) {
          this.metadata[key] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now(),
          }
        }
        if (this.metadata[key].source) return this.metadata[key]
        this.metadata[key].source = source
        this.metadata[key].updatedAt = Date.now()
        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error setting source for transaction:', error)
        return null
      }
    },

    /**
     * Stamp the resolved Nostr counterparty avatar on a transaction
     * ({ kind: 'nostr', npub, picture }; picture may be null when the
     * profile carried no image), scoped to `walletId`. Lets the tx row +
     * details hero show the real person behind a bare npub/nprofile/
     * NIP-05 send. Same never-overwrite pattern as
     * setRecipientAddressForTransaction — the first stamp wins. Requires
     * a walletId — a missing one warns and no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {object} avatar
     * @returns {Promise<object|null>}
     */
    async setCounterpartyAvatarForTransaction(txId, walletId, avatar) {
      try {
        if (!txId || !avatar) return null
        if (!walletId) {
          console.warn('[txMetadata] setCounterpartyAvatarForTransaction: missing walletId, skipping write', { txId })
          return null
        }
        const key = _key(txId, walletId)
        if (!this.metadata[key]) {
          this.metadata[key] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now(),
          }
        }
        if (this.metadata[key].counterpartyAvatar) return this.metadata[key]
        this.metadata[key].counterpartyAvatar = avatar
        this.metadata[key].updatedAt = Date.now()
        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error setting counterpartyAvatar for transaction:', error)
        return null
      }
    },

    /**
     * Stamp the Branta merchant verification resolved at send time
     * ({ name, logoUrl, logoLightUrl, verifyUrl }), scoped to `walletId`.
     * Lets Tx Details show "you paid a verified merchant" on the receipt,
     * not only on the confirm screen before sending. Same never-overwrite
     * pattern as setCounterpartyAvatarForTransaction — the first stamp
     * wins. Requires a walletId — a missing one warns and no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {object} verification
     * @returns {Promise<object|null>}
     */
    async setMerchantVerificationForTransaction(txId, walletId, verification) {
      try {
        if (!txId || !verification) return null
        if (!walletId) {
          console.warn('[txMetadata] setMerchantVerificationForTransaction: missing walletId, skipping write', { txId })
          return null
        }
        const key = _key(txId, walletId)
        if (!this.metadata[key]) {
          this.metadata[key] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now(),
          }
        }
        if (this.metadata[key].merchantVerification) return this.metadata[key]
        this.metadata[key].merchantVerification = verification
        this.metadata[key].updatedAt = Date.now()
        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error setting merchantVerification for transaction:', error)
        return null
      }
    },

    /**
     * Stamp the curated point-of-sale breakdown captured at kiosk
     * invoice-creation time ({ baseSats, tipSats, tipPercent, roundUp,
     * discountSats, itemCount, totalSats }) on a transaction, scoped to
     * `walletId`. Same never-overwrite pattern as
     * setRecipientAddressForTransaction — the first stamp wins. Requires
     * a walletId — a missing one warns and no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {object} breakdown
     * @returns {Promise<object|null>}
     */
    async setSaleBreakdownForTransaction(txId, walletId, breakdown) {
      try {
        if (!txId || !breakdown) return null
        if (!walletId) {
          console.warn('[txMetadata] setSaleBreakdownForTransaction: missing walletId, skipping write', { txId })
          return null
        }
        const key = _key(txId, walletId)
        if (!this.metadata[key]) {
          this.metadata[key] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now()
          }
        }
        if (this.metadata[key].saleBreakdown) return this.metadata[key]
        this.metadata[key].saleBreakdown = breakdown
        this.metadata[key].updatedAt = Date.now()
        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error setting saleBreakdown for transaction:', error)
        return null
      }
    },

    /**
     * Manual "Remove contact", scoped to `walletId`. Clears the explicit
     * contactId AND records that the user wants this tx to stay
     * anonymous, so live address resolution won't immediately re-attach
     * the same contact. Requires a walletId — a missing one warns and
     * no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @returns {Promise<object|null>}
     */
    async clearContactForTransaction(txId, walletId) {
      try {
        if (!txId) return null
        if (!walletId) {
          console.warn('[txMetadata] clearContactForTransaction: missing walletId, skipping write', { txId })
          return null
        }
        const key = _key(txId, walletId)
        if (!this.metadata[key]) {
          this.metadata[key] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now(),
          }
        }
        this.metadata[key].contactId = null
        this.metadata[key].contactCleared = true
        this.metadata[key].updatedAt = Date.now()
        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error clearing contact for transaction:', error)
        throw error
      }
    },

    /**
     * Set note for a transaction, scoped to `walletId`. Requires a
     * walletId (see setContactForTransaction) — a missing one warns and
     * no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {string} note
     * @returns {Promise<object|null>}
     */
    async setNoteForTransaction(txId, walletId, note) {
      try {
        if (!txId) {
          throw new Error('Transaction ID is required')
        }
        if (!walletId) {
          console.warn('[txMetadata] setNoteForTransaction: missing walletId, skipping write', { txId })
          return null
        }

        const key = _key(txId, walletId)
        if (!this.metadata[key]) {
          this.metadata[key] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now()
          }
        }

        // Update note (max 500 characters)
        this.metadata[key].customNote = (note || '').trim().substring(0, 500)
        this.metadata[key].updatedAt = Date.now()

        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error setting note for transaction:', error)
        throw error
      }
    },

    /**
     * Persist a resolved LUD-09 successAction (the recipient's post-payment
     * message) on a transaction, scoped to `walletId`. Stored
     * already-resolved — the `aes` variant is decrypted at payment time,
     * while the preimage is in hand — so Tx Details can re-display it
     * later without needing the preimage again. (A decrypted `aes` secret
     * therefore rests in localStorage — the same on-device trust model as
     * the preimage / notes this store already keeps.) Requires a walletId
     * — a missing one warns and no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {object} successAction
     * @returns {Promise<object|null>}
     */
    async setSuccessActionForTransaction(txId, walletId, successAction) {
      try {
        if (!txId) throw new Error('Transaction ID is required')
        if (!successAction) return _resolveMetadata(this, txId, walletId)
        if (!walletId) {
          console.warn('[txMetadata] setSuccessActionForTransaction: missing walletId, skipping write', { txId })
          return null
        }

        const key = _key(txId, walletId)
        if (!this.metadata[key]) {
          this.metadata[key] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now()
          }
        }

        this.metadata[key].successAction = successAction
        this.metadata[key].updatedAt = Date.now()

        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error setting successAction for transaction:', error)
        throw error
      }
    },

    /**
     * Persist the LUD-21 verify URL on a transaction, scoped to
     * `walletId`, so Tx Details can re-poll for fiat delivery. Same
     * on-device trust model as notes/successAction. Requires a walletId —
     * a missing one warns and no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {string} verifyUrl
     * @returns {Promise<object|null>}
     */
    async setVerifyUrlForTransaction(txId, walletId, verifyUrl) {
      try {
        if (!txId) throw new Error('Transaction ID is required')
        if (!verifyUrl) return _resolveMetadata(this, txId, walletId)
        if (!walletId) {
          console.warn('[txMetadata] setVerifyUrlForTransaction: missing walletId, skipping write', { txId })
          return null
        }
        const key = _key(txId, walletId)
        if (!this.metadata[key]) {
          this.metadata[key] = { contactId: null, customNote: '', tags: [], updatedAt: Date.now() }
        }
        this.metadata[key].verifyUrl = verifyUrl
        this.metadata[key].updatedAt = Date.now()
        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error setting verifyUrl for transaction:', error)
        throw error
      }
    },

    /**
     * Cache a confirmed LUD-21 delivery status (receipt + recipient),
     * scoped to `walletId`, so later Tx Details views render instantly and
     * offline without re-polling. Requires a walletId — a missing one
     * warns and no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {object} deliveryStatus
     * @returns {Promise<object|null>}
     */
    async setDeliveryStatusForTransaction(txId, walletId, deliveryStatus) {
      try {
        if (!txId) throw new Error('Transaction ID is required')
        if (!deliveryStatus) return _resolveMetadata(this, txId, walletId)
        if (!walletId) {
          console.warn('[txMetadata] setDeliveryStatusForTransaction: missing walletId, skipping write', { txId })
          return null
        }
        const key = _key(txId, walletId)
        if (!this.metadata[key]) {
          this.metadata[key] = { contactId: null, customNote: '', tags: [], updatedAt: Date.now() }
        }
        this.metadata[key].deliveryStatus = deliveryStatus
        this.metadata[key].updatedAt = Date.now()
        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error setting deliveryStatus for transaction:', error)
        throw error
      }
    },

    /**
     * Persist a BTC-price-at-settlement snapshot on a transaction, scoped
     * to `walletId`. Never overwrites an existing snapshot — the first
     * stamp is the closest to the actual settlement moment and later ones
     * can only be staler. Requires a walletId — a missing one warns and
     * no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {object} snapshot
     * @returns {Promise<object|null>}
     */
    async setFiatAtSettlementForTransaction(txId, walletId, snapshot) {
      try {
        if (!txId || !snapshot) return null
        if (!walletId) {
          console.warn('[txMetadata] setFiatAtSettlementForTransaction: missing walletId, skipping write', { txId })
          return null
        }
        const key = _key(txId, walletId)
        if (this.metadata[key]?.fiatAtSettlement) return this.metadata[key]
        if (!this.metadata[key]) {
          this.metadata[key] = { contactId: null, customNote: '', tags: [], updatedAt: Date.now() }
        }
        this.metadata[key].fiatAtSettlement = snapshot
        this.metadata[key].updatedAt = Date.now()
        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error setting fiatAtSettlement for transaction:', error)
        return null
      }
    },

    /**
     * Stamp fresh transactions with the current BTC rate as their
     * price-at-settlement, scoped to `walletId`, for providers that don't
     * report one themselves (everyone except LNbits). "Fresh" is strict:
     * the tx must have settled within FIAT_STAMP_WINDOW_MS of right now.
     * Anything older is left alone forever — a historical transaction must
     * never be backfilled with today's rate, showing no value beats
     * showing a wrong one.
     *
     * Called from the shared tx-load paths right after normalization.
     *
     * @param {object[]} transactions
     * @param {string} walletId
     * @param {string} currency
     * @returns {Promise<number>} count of transactions stamped
     */
    async stampFreshTransactions(transactions, walletId, currency) {
      if (!Array.isArray(transactions) || transactions.length === 0) return 0
      const cur = String(currency || 'USD').toUpperCase()
      if (!fiatRatesService.ratesAvailable) return 0
      const rate = fiatRatesService.rates[cur]
      if (!rate) return 0

      const now = Date.now()
      let stamped = 0
      for (const tx of transactions) {
        if (!tx?.id) continue
        if (tx.fiatAtSettlement) continue
        if ((tx.status || 'completed') !== 'completed') continue
        if (_resolveMetadata(this, tx.id, walletId)?.fiatAtSettlement) continue
        const settledMs = this._resolveTxTimeMs(tx)
        if (!settledMs || now - settledMs > FIAT_STAMP_WINDOW_MS) continue

        const sats = Number(tx.recipientSats ?? Math.abs(tx.amount || 0))
        if (!Number.isFinite(sats) || sats <= 0) continue

        await this.setFiatAtSettlementForTransaction(tx.id, walletId, {
          currency: cur,
          amount: (sats / 100000000) * rate,
          rate,
          capturedAt: now,
        })
        stamped += 1
      }
      return stamped
    },

    /**
     * Set tags for a transaction, scoped to `walletId`. Requires a
     * walletId (see setContactForTransaction) — a missing one warns and
     * no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {string[]} tags
     * @returns {Promise<object|null>}
     */
    async setTagsForTransaction(txId, walletId, tags) {
      try {
        if (!txId) {
          throw new Error('Transaction ID is required')
        }
        if (!walletId) {
          console.warn('[txMetadata] setTagsForTransaction: missing walletId, skipping write', { txId })
          return null
        }

        const key = _key(txId, walletId)
        if (!this.metadata[key]) {
          this.metadata[key] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now()
          }
        }

        // Validate and limit tags (max 2 tags as per user requirement)
        const validTags = Array.isArray(tags) ? tags : []
        const limitedTags = validTags.slice(0, 2).map(tag => tag.trim()).filter(tag => tag.length > 0)

        this.metadata[key].tags = limitedTags
        this.metadata[key].updatedAt = Date.now()

        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error setting tags for transaction:', error)
        throw error
      }
    },

    /**
     * Add a single tag to a transaction, scoped to `walletId` (respects
     * the 2-tag limit).
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {string} tag
     * @returns {Promise<object|null>}
     */
    async addTagToTransaction(txId, walletId, tag) {
      try {
        const currentTags = this.getTagsForTransaction(txId, walletId)

        // Don't add if already exists
        if (currentTags.includes(tag)) {
          return _resolveMetadata(this, txId, walletId)
        }

        // Don't add if already at limit (2 tags)
        if (currentTags.length >= 2) {
          throw new Error('Maximum 2 tags allowed per transaction')
        }

        const newTags = [...currentTags, tag]
        return await this.setTagsForTransaction(txId, walletId, newTags)
      } catch (error) {
        console.error('Error adding tag to transaction:', error)
        throw error
      }
    },

    /**
     * Remove a tag from a transaction, scoped to `walletId`.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {string} tag
     * @returns {Promise<object|null>}
     */
    async removeTagFromTransaction(txId, walletId, tag) {
      try {
        const currentTags = this.getTagsForTransaction(txId, walletId)
        const newTags = currentTags.filter(t => t !== tag)
        return await this.setTagsForTransaction(txId, walletId, newTags)
      } catch (error) {
        console.error('Error removing tag from transaction:', error)
        throw error
      }
    },

    /**
     * Update all metadata fields at once, scoped to `walletId`. Requires a
     * walletId (see setContactForTransaction) — a missing one warns and
     * no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @param {object} metadata
     * @returns {Promise<object|null>}
     */
    async updateTransactionMetadata(txId, walletId, metadata) {
      try {
        if (!txId) {
          throw new Error('Transaction ID is required')
        }
        if (!walletId) {
          console.warn('[txMetadata] updateTransactionMetadata: missing walletId, skipping write', { txId })
          return null
        }

        const key = _key(txId, walletId)
        // Initialize if doesn't exist
        if (!this.metadata[key]) {
          this.metadata[key] = {
            contactId: null,
            customNote: '',
            tags: [],
            updatedAt: Date.now()
          }
        }

        // Update fields that are provided
        if (metadata.contactId !== undefined) {
          this.metadata[key].contactId = metadata.contactId
        }
        if (metadata.customNote !== undefined) {
          this.metadata[key].customNote = (metadata.customNote || '').trim().substring(0, 500)
        }
        if (metadata.tags !== undefined) {
          const validTags = Array.isArray(metadata.tags) ? metadata.tags : []
          this.metadata[key].tags = validTags.slice(0, 2).map(tag => tag.trim()).filter(tag => tag.length > 0)
        }

        this.metadata[key].updatedAt = Date.now()

        await this.persistMetadata()
        return this.metadata[key]
      } catch (error) {
        console.error('Error updating transaction metadata:', error)
        throw error
      }
    },

    /**
     * Clear all metadata for a transaction, scoped to `walletId`. Deletes
     * only the composite key — a legacy bare-key record (if this tx also
     * has one from before wallet-scoping existed) is read-only and is
     * left untouched, per the same rule that governs every write in this
     * store. Requires a walletId — a missing one warns and no-ops.
     *
     * @param {string} txId
     * @param {string} walletId
     * @returns {Promise<void>}
     */
    async clearMetadataForTransaction(txId, walletId) {
      try {
        if (!txId) {
          throw new Error('Transaction ID is required')
        }
        if (!walletId) {
          console.warn('[txMetadata] clearMetadataForTransaction: missing walletId, skipping write', { txId })
          return
        }

        delete this.metadata[_key(txId, walletId)]
        await this.persistMetadata()
      } catch (error) {
        console.error('Error clearing transaction metadata:', error)
        throw error
      }
    },

    /**
     * Clear all metadata for a specific contact (useful when contact is
     * deleted), across every wallet's records. Unaffected by wallet
     * scoping — this scans by the `contactId` VALUE, not by key, so
     * wallet-scoped composite keys and legacy bare keys are both handled
     * identically with no change needed here.
     *
     * @param {string} contactId
     * @returns {Promise<void>}
     */
    async clearMetadataForContact(contactId) {
      try {
        let changed = false
        Object.keys(this.metadata).forEach(key => {
          if (this.metadata[key].contactId === contactId) {
            this.metadata[key].contactId = null
            this.metadata[key].updatedAt = Date.now()
            changed = true
          }
        })

        if (changed) {
          await this.persistMetadata()
        }
      } catch (error) {
        console.error('Error clearing metadata for contact:', error)
        throw error
      }
    },

    // Persist metadata to localStorage
    async persistMetadata() {
      try {
        localStorage.setItem('buhoGO_transaction_metadata', JSON.stringify(this.metadata))
      } catch (error) {
        console.error('Error saving transaction metadata:', error)
        throw new Error('Failed to save transaction metadata')
      }
    },

    // Clear all metadata (for troubleshooting/reset)
    async clearAll() {
      this.metadata = {}
      localStorage.removeItem('buhoGO_transaction_metadata')
    },

    // Import metadata from backup
    async importMetadata(metadataObject) {
      try {
        if (typeof metadataObject !== 'object') {
          throw new Error('Invalid metadata format')
        }

        this.metadata = { ...this.metadata, ...metadataObject }
        await this.persistMetadata()

        return Object.keys(metadataObject).length
      } catch (error) {
        console.error('Error importing metadata:', error)
        throw error
      }
    },

    // Export metadata (for backup)
    exportMetadata() {
      return JSON.parse(JSON.stringify(this.metadata))
    }
  }
})
