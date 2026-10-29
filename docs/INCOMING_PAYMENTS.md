# Incoming payments

BuhoGO says "Bitcoin received" for every wallet type the same way: as soon as the app learns of a payment, once per payment, with that payment's own amount, and a tap opens that payment. Spark has worked like this since #295; LNbits, NWC and Arkade wallets follow the same path, also when they are not the wallet on screen.

[← Feature records](README.md)

## One rule: a live signal is only a reason to look

```
live channel or trigger  ->  read the wallet's history  ->  receipt ledger  ->  delivery  ->  toast / Home screen / notification
```

- **Receipt ledger** (`services/paymentReceipts.js`). Decides per payment id, never by balance difference. The first read of a wallet only sets its baseline. A catch-up announces only receipts newer than the wallet's last complete read, or ones it saw pending before. Sends are kept under their own key, so a wallet paying its own invoice (one hash for both halves) still gets its receipt. A payment may name earlier ids (`aliases`); seen under one, seen. `catchUpReceipts` pages back with `{ offset, limit }` until the last read is covered, at most 10 pages.
- **Delivery** (`services/paymentReceiptsApp.js`). One ledger for the device, the app's visibility history, and `deliverReceipt`: it sets `walletStore.lastReceipt`, and posts a system notification for a payment that settled while the app was out of sight. `IncomingPaymentHost` watches `lastReceipt` synchronously, because one catch-up can deliver several receipts in a row.
- **Spark** keeps its lifecycle (`services/sparkLifecycle.js`): SDK events and catch-up, through the same ledger and delivery.
- **LNbits, NWC, Arkade** are watched by `services/walletWatch.js` (below).

A balance that went up only asks the watch to look (`store.noticeIncomingPayment` → `walletWatch().hint`). It is announced from the rise itself only for an NWC connection that may not read its history.

## The wallet watch

`services/walletWatch.js` grew out of the Auto-Transfer watch and still serves it: a wallet with a switched-on rule has its balance read on every round.

- **Which wallets:** every wallet the Spark lifecycle does not own, whichever is on screen, except one on its way off the phone.
- **Triggers:** start, every 60 s while the app runs, return to the app, back online, a live channel's hint, a balance seen rising elsewhere, wallets added (`store._noteWalletsChanged` → `sync`).
- **One run per wallet:** connect, keep its live channel open on the current connection, read the newest 20 payments into the ledger, look up any payment a hint named that the page did not reach, then read the balance when something arrived or left (or a rule waits for it).
- **Order and failure:** overlapping triggers share one run plus at most one follow-up. Every step has a 30 s deadline, so one silent server never holds up the other wallets. A failed run retries after 2, 5, 15 and 30 s, then waits for the round; a failed history read never holds up the balance read. A wallet that refuses its history (`RESTRICTED`, `NOT_IMPLEMENTED`, `UNAUTHORIZED`), or whose history fails 3 times in a row while the device is online, is left to its balance for the session and its ledger entries are cleared, so a later session starts from a new baseline instead of announcing twice.
- **Hints:** a live channel's message triggers a run at once, then at most one run every 3 s; at most 5 named payments are looked up per run. Anyone who knows an LNbits channel's key can post into it, so a message is never proof.
- **Channels:** each opens on the connection the store holds and moves with it on reconnect; removal and full reset close it. One that failed to open is tried again on return, back online, or 5 minutes later.

What it cannot do: run while Android has the app frozen or closed. The read on return catches up, and delivery then posts the system notification. Push while closed is #276.

## Per wallet type

| | Live channel | History read | Lookup by hash |
|---|---|---|---|
| LNbits | websocket `/api/v1/ws/<invoice key>` | `listPayments` (throws on failure) | `getPayment` |
| NWC | NWC-02 `payment_received`, when the connection was granted it | `listNwcPayments` (`list_transactions`, unpaid excluded) | `findNwcPayment` (`lookup_invoice`, only records with `state`) |
| Arkade | the SDK's contract stream (`vtxo_received`) | `getTransactions({ offset, limit })` | none, payments carry no hash |

`PAYMENTS` in `walletWatch.js` maps each type to these; `WalletProvider.js` lists the optional methods.

### LNbits

- LNbits pushes every settled payment to `/api/v1/ws/<key>`, with the key in the address, and logs that address. The channel therefore uses the wallet's **invoice key** (reads and receives, never spends), never the admin key.
- Wallets only stored the admin key. `getInvoiceKey()` sends an empty `PATCH /api/v1/wallet` with it once: LNbits 0.12.12, 1.0, 1.3 and 1.6 return the wallet with its keys and change nothing but its "updated" time. An answer for another wallet is refused. The key is kept next to the admin key (`connectionData.invoiceKey`) and left out of backups, since it can be asked for again.
- No replay and no client heartbeat: a socket that closed is opened again on the next run (`revive`), and the round reads what it missed.
- `getPayment` reads `updated_at` as the time it was paid, for the ledger only. List rows keep the time History and the tax report show.

### NWC (`@getalby/sdk` 9)

- `watchNwcPayments` uses the SDK's own subscription: each relay reconnects with backoff, and closing the connection ends it. On return to the app it subscribes afresh, so a relay waiting out a long backoff opens now; between returns only when no relay is connected.
- The SDK sends no heartbeat, so a socket that dies without closing goes unnoticed until the next request; the minute round covers it.
- A connection that advertises notifications may still send none (Zeus does so); the history read decides either way. Wallets without `list_transactions` are announced from their balance.

### Arkade

- The SDK's contract stream also reports change, renewals, recovered outputs and boarding conversions, so it is only a hint; the history decides, where change and renewals are no receipt.
- A boarding deposit keeps its on-chain transaction id from the mempool on. Earlier versions, and the SDK's own batch row while the chain catches up, named it by its commitment transaction: the row carries that id in `aliases`, the ledger treats it as the same payment, `TransactionDetails` resolves it, and notes and labels kept under it move to the new id once (`transactionMetadata.adoptTransactionId`).
- A deposit is announced when it can be spent, never at mempool.

## The Receive sheet

- An invoice the sheet created is registered (`incomingPayments.expectReceiveInvoice`). When the sheet confirms it, the host leaves it alone, and the ledger takes it as decided (`noteReceiptShown`), so no later read announces it again, also not after a restart.
- NWC takes verified `lastReceipt` entries matching both its wallet and invoice hash, with the actual received amount. It reuses the same synchronous receipt watcher as Arkade and adds no relay subscription. With notifications and readable history, an invoice check once a minute covers missed notifications; connections without that shared receipt path keep their existing polling. Return to the app and back online check immediately, through the same single-flight monitor. Close, wallet switch and unmount cancel the sheet's observers and discard late results. Creating its invoice uses the store's existing NIP-47 path, preserving the hash and expiry.
- An Arkade wallet's sheet shows addresses, no invoice. It takes the wallet's receipts from `lastReceipt` (only its own wallet's, only ones that arrived while it was open), and `expectReceiveFunds` keeps the host quiet about them. A renewal never confirms the sheet, because it is never a receipt.

## Home's latest transaction

Home consumes `walletStore.confirmedReceiveActivity`, independently of the
notification signal. `recordConfirmedReceive` receives verified ledger delivery,
Receive-sheet confirmation, or the existing limited-NWC balance observation.
Identity is wallet plus payment id/hash/aliases, never amount. Runtime observations
are bounded, removed with their wallet, and excluded from persisted wallet state.

`services/latestTransactionPreview.js` owns preview reconciliation; the page only
wires the selected canonical wallet, its live provider/connection and metadata.
Selection and read ownership reject late responses, including A → B → A and
provider replacement. Bursts reconcile to one actual newest transaction; duplicate
signals can enrich identity without replaying arrival. Restoring Home seeds its
recent activity without a new arrival animation.

`LatestTransactionCard` acknowledges settled funds immediately with their known
amount and “Bitcoin received”. A traveling icon highlight communicates detail
work without a loading label. Completed content enters briefly; amounts never
roll from zero. Card height stays 64 px, hidden amounts remove numeric DOM, and
reduced motion disables local animations. History remains the card's destination.

History reads have a 4-second deadline, optional metadata gets 750 ms, and receipt
motion has a total 15-second budget anchored to observation time. Missing rows
retry at 250, 750, 1500 and then 3000 ms intervals within that budget. Failure ends
in a static confirmed summary with Retry; periodic refresh remains a fallback.
Provider APIs without cancellation can finish after timeout, but cannot publish
late content. An unsupported history grant stops immediately. Empty history and
failed reads are distinct; failed reads retain known content.

`latestTransactionHistory` uses the same strict LNbits/NWC history APIs as the
receipt watch. For an identified LNbits receipt it also looks up the exact payment:
the list can carry invoice creation time, while lookup provides settlement time.
Receipt timestamp provenance stays separate from observation time. Fee-bearing
receive previews use the same credited amount as the receipt ledger; send
accounting is unchanged. LNbits credit deducts a receiver fee, while NWC reports
credited incoming amount (see the upstream [LNbits accounting](https://github.com/lnbits/lnbits/blob/main/lnbits/core/crud/payments.py)
and [Alby Hub isolated balance](https://github.com/getAlby/hub/blob/master/db/queries/get_isolated_balance.go)).
List `updated_at` is not promoted into ledger settlement
time, since a later metadata edit also changes it. When settlement ordering
cannot be verified against a competing send, Home keeps the confirmed summary
rather than replacing it with an ambiguously ordered older payment. A send proved
newer still wins. Unpaid invoices never create receive motion; an actual Arkade
boarding deposit may appear as Pending until it becomes spendable. Preview
filtering does not remove invoices from History's shared cache.

## Known limits

- A wallet that pays its own LNbits invoice lists both halves under one hash; Transaction details opens the first, which is the send. Payments from any other wallet have their own hash.
- Arkade's history read rebuilds the whole history and asks Esplora about deposit addresses; once a minute per Arkade wallet (one per install).
- The start round connects every LNbits, NWC and Arkade wallet once.

## Checks

- Home preview: `npm run check:latest-transaction` against the same local server
  as the detection check below. It runs real Home, Receive-sheet, receipt-delivery,
  store and card code with controlled remote history, records light/dark WebM
  sequences, and checks immediate acknowledgement, delayed details, timeout/retry,
  privacy, reduced motion, navigation, switching, duplicates, bursts and remounts.
  Evidence lands in `output/latest-transaction-preview`. It verifies UI behavior
  after detection, not live settlement latency. Controller, strict-adapter,
  page-wiring and receipt-delivery regressions run in `npm test`.

- Unit: `paymentReceipts`, `sparkLifecycle`, `walletWatch`, `incomingPaymentsStore` (store wiring), `lnbitsWalletProvider`, `arkadeWalletProvider`, `nwcReceive` (service and Receive sheet), `incomingPayments`, `transactionMetadata`, all in `npm test`.
- Browser: `node scripts/check-incoming-detection.mjs` against `npx quasar dev --port 9415` (or `DETECT_BASE_URL`): Arkade confirms only its own wallet's new receipts; three receipts of one catch-up add up in one toast; NWC confirms through one shared subscription without sheet polling or a duplicate announcement. NWC without notifications retains invoice polling, and a lookup-only connection checks immediately on resume. External wallet requests are blocked; the actual components, store invoice action, watch, ledger and delivery run against a scripted remote wallet.
- Live, with a real LNbits wallet and its NWC connection (2026-10-28): the invoice key fetched equals the wallet's; a payment announced 200 ms after it settled, with its own amount, while sending and receiving left the balance unchanged; heard again after the socket dropped; caught up after a restart; nothing announced twice. On NWC: a payment found in 0.6 s, a payment sent through it, the SDK resubscribing after a relay drop, and a relay that never completes its handshake failing after 3 s as a plain relay failure.
