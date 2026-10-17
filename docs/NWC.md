# Nostr Wallet Connect

How BuhoGO connects to a wallet over Nostr Wallet Connect (NIP-47) as a client, and the rules that keep it honest.

## Connecting: test first, name second

`src/pages/NWCSetupPage.vue`, steps in `src/components/nwc/`, all drawn by `src/components/sheets/FormSheetStep.vue`:

- **Connect** (`NWCConnectStep`): paste or scan. The connection string carries a secret that can spend, so the field is hidden like a password, with a reveal toggle.
- The connection is tested before anything is saved (`src/services/nwcProbe.js`): `get_info`, then `get_balance` and `get_budget` only when the connection may call them. A wallet that does not answer at once is asked again, because it may be an app on a phone that wakes by push; the button says "Waiting for your wallet…" meanwhile. A connection that may not call `get_info` reads its grants from the wallet's info event (kind 13194).
- **Found** (`NWCWalletFound`): the wallet's own name (alias, else the name in its Lightning address), balance or "Not shared", address, what the connection may do (`NWCCapabilities`) and its spending limit. A connection that cannot send or receive is still added, with the gap said.
- **Duplicate** (`NWCDuplicateStep`): the same wallet already here, matched by its key or Lightning address (`findSameWallet`), not by connection text. A second connection to the same wallet stays possible ("Add anyway"); the very same connection does not.
- **Problem** (`NWCConnectProblem`): which part did not answer, the relay or the wallet behind it.

Every relay in the connection string is kept (`src/utils/nwcConnection.js`); extra relays are backups. Pasted and scanned strings are stored in one normalized form.

## What a connection may do

`src/utils/nwcWallet.js` turns the methods the wallet granted into Send, Receive, Balance, History and Limit. Wallets saved before methods were stored are assumed to do all, as before.

- A connection without `pay_invoice` is never offered to pay ("Receive only" in Pay with, `utils/payingWallets.js`).
- A connection without `get_balance` shows a dash and "Balance not shared"; its balance is never asked for.
- `store.refreshNwcDetails()` asks the wallet again on every refresh: name, grants, Lightning address, spending limit, and whether it answered (`store.nwcStatus`). This also repairs wallets saved before these details were read correctly. The status never changes `connected`: a wallet on a phone can miss one 10 s question and still wake for a payment, so a single silence must not take it out of the wallet lists. Settings shows the status, offers Reconnect for a silent wallet, and only says "Reconnected" when the wallet answered.
- A connection without `make_invoice` says so on Receive before asking the wallet.
- A connection without `make_invoice` is never offered as a destination (Social Bucket, internal transfer), and one without `pay_invoice` never as a source: `store.getTransferableWallets()` marks `canReceive`, `canSend` and `receiveOnly` from `utils/walletCapabilities.canWalletReceiveLightning` and the grants.
- `store.createInvoiceOnWallet()` is the one way BuhoGO asks its own wallets to receive (Social Bucket, internal transfer, Learn & Earn payouts). For NWC it uses the connection from `connectionStates` (NWC never has a `providers` entry) and sends the memo as `defaultMemo`, the only field the SDK reads.

## Paying: only on proof

Every NWC payment goes through `src/services/nwcPayment.js` (`payWithNwc`): the main send flow, batch send, auto-withdraw, internal transfer, the username marketplace and the shop.

- Paid means the returned preimage hashes to the invoice's payment hash.
- No reply, a publish that was not acknowledged, or a generic `INTERNAL`/`OTHER` error is an unknown outcome, not a failure: the invoice is looked up a few times. A record the wallet marks settled counts as paid; marked failed counts as failed.
- Still unknown after the last lookup: `NWC_PAYMENT_UNCONFIRMED`, and the person is asked to check their wallet before paying again. A payment is never sent a second time on its own.
- A request that never left (no wallet behind the relay, relay unreachable) is a plain failure.
- When the wallet shares a spending limit, a payment above what is left is checked with the wallet once more (the person may have just raised it) and then stops before it is sent, with the amount left and the reset date. A limit whose period has ended holds nothing back (`store.nwcLimitFor`).

Receiving polls gently (`NWC_POLLING` in `ReceiveModal.vue`): each lookup can wake the owner's phone.

## Receiving: one way for every screen

`src/services/nwcReceive.js` creates an invoice on an NWC connection and tells whether it has been paid, through the connection's own NIP-47 client (`nwc.client`). The SDK's WebLN layer on top drops what a receiving screen needs: `makeInvoice` returns only the invoice text (no hash, no expiry), and `lookupInvoice` reads `{ paymentHash }`, so a plain hash or `{ payment_hash }` reaches the wallet as no hash at all.

- `makeNwcInvoice`: `make_invoice` in millisats; returns the invoice, its payment hash and expiry.
- `makeNwcInvoice` falls back to the expiry written in the invoice when the wallet leaves `expires_at` out, so a screen watching it always stops.
- `lookupNwcInvoice`: `lookup_invoice` when the connection may (at most 10 s per answer), else the recent incoming payments (`list_transactions`), also when the wallet cannot find the invoice yet. A lookup-only wallet that does not know an unpaid invoice means "not yet". A connection allowed neither cannot see a payment arrive (`NWC_CONFIRM_NOT_ALLOWED`).
- **Paid means settled.** `utils/paymentMonitor.checkNWCPaymentStatus` reads `state`, `status`, `settled`/`paid` or `settled_at`, and never a preimage alone: NIP-47 allows a preimage on an unpaid invoice ("optional if unpaid"), and the LNbits NWC extension returns one (or 64 zeros) for every invoice it created. Counting it as paid would complete an unpaid kiosk sale the moment its QR appears.

The store wraps both for every wallet type: `createInvoiceDetailsOnWallet()` (invoice, hash, expiry; `createInvoiceOnWallet()` returns just the invoice) and `lookupInvoiceOnWallet()` (`{ paid, preimage, amount }`, the payment monitor's shape). The kiosk, Social Bucket, internal transfer and Learn & Earn use them; Receive uses `lookupNwcInvoice` for its payment check.

The kiosk only offers wallets that can take a payment (`walletCapabilities.kioskWalletBlocker`): able to receive, and for NWC allowed `lookup_invoice` or `list_transactions`. The others are listed, not choosable, with the reason ("Can't receive", "Can't confirm payments").

## Errors in words

`src/utils/nwcErrors.js` gives every NIP-47 error code a sentence and a next step (spending limit used up, not allowed, connection removed, rate limited, no answer, relay unreachable, not confirmed). `utils/userErrors.translateErrorCode` asks it first, so every error surface shows the same words. Only errors carrying the SDK's NWC codes are read by message, so an unrelated timeout is never taken for an NWC one.

## SDK

`@getalby/sdk` 7.0.0. `utils/nwcErrors` reads its transport failures by class, code and message; checked against the real SDK with a stand-in relay:

| What happened | SDK error | BuhoGO reads it as |
|---|---|---|
| Relay socket never opens (4.4 s) | `Nip47NetworkError` "Failed to connect to …", code `OTHER` | relay failure, nothing sent |
| No wallet behind the relay | `Error` "no info event (kind 13194)…", no code | no answer, nothing sent |
| Event sent, relay never acknowledged it, refused it, or the socket dropped at publish | `Nip47PublishError` "failed to publish: …" or `Nip47PublishTimeoutError`, code `INTERNAL` | unknown outcome: the SDK's message cannot tell these apart, and in the first the wallet may have the request |
| Request delivered, no reply | `Nip47ReplyTimeoutError` "reply timeout…", code `INTERNAL` | unknown outcome |

Reply timeouts: `get_info`, `get_balance`, `get_budget` and `list_transactions` wait 10 s; `pay_invoice`, `make_invoice` and `lookup_invoice` wait 60 s. Requests carry no `expiration` tag (also not in 8).

Not yet on 8 (#390). 8.0.3, the latest release, and upstream `master`:
- connect to a relay without a timeout (`_checkConnected` calls `ensureRelay` with no `connectionTimeout`): a relay that accepts the TCP connection but never completes the WebSocket handshake makes every request wait forever, where 7 fails after 4.4 s;
- reject a connection secret or wallet key in upper-case hex, which `utils/nwcConnection` accepts and stores as given, so saved wallets would stop connecting.

Upgrade once the first is fixed upstream, after normalizing stored hex to lower case.

## Checks

- Unit: `nwcConnection`, `nwcWallet`, `nwcErrors` (including the SDK's own error classes), `nwcPayment`, `nwcProbe`, `nwcWalletStore`, `nwcWalletProvider`, plus the paying-wallet, Social Bucket and Learn & Earn wallet specs.
- Browser: `node scripts/check-nwc-connect.mjs` against `pnpm dev --port 9031` (or `NWC_BASE_URL`): every connect step with a stand-in wallet, the Settings details, Home with a receive-only connection, dark mode and German at 320 px.
- Browser: `node scripts/check-nwc-receiving.mjs`: the Social Bucket destinations and the internal-transfer pickers with a send-only and a receive-only connection.
