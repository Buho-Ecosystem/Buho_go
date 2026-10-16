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
- `store.refreshNwcDetails()` asks the wallet again on every refresh: name, grants, Lightning address, spending limit, and whether it answered (`store.nwcStatus`). This also repairs wallets saved before these details were read correctly. Reconnect in Settings only says "Reconnected" when the wallet answered.

## Paying: only on proof

Every NWC payment goes through `src/services/nwcPayment.js` (`payWithNwc`): the main send flow, batch send, auto-withdraw, internal transfer, the username marketplace and the shop.

- Paid means the returned preimage hashes to the invoice's payment hash.
- No reply, a publish that was not acknowledged, or a generic `INTERNAL`/`OTHER` error is an unknown outcome, not a failure: the invoice is looked up a few times. A record the wallet marks settled counts as paid; marked failed counts as failed.
- Still unknown after the last lookup: `NWC_PAYMENT_UNCONFIRMED`, and the person is asked to check their wallet before paying again. A payment is never sent a second time on its own.
- A request that never left (no wallet behind the relay, relay unreachable) is a plain failure.
- When the wallet shares a spending limit, a payment above what is left stops before it is sent, with the amount left and the reset date.

Receiving polls gently (`NWC_POLLING` in `ReceiveModal.vue`): each lookup can wake the owner's phone.

## Errors in words

`src/utils/nwcErrors.js` gives every NIP-47 error code a sentence and a next step (spending limit used up, not allowed, connection removed, rate limited, no answer, relay unreachable, not confirmed). `utils/userErrors.translateErrorCode` asks it first, so every error surface shows the same words. Only errors carrying the SDK's NWC codes are read by message, so an unrelated timeout is never taken for an NWC one.

## Checks

- Unit: `nwcConnection`, `nwcWallet`, `nwcErrors`, `nwcPayment`, `nwcProbe`, plus the paying-wallet and store specs.
- Browser: `node scripts/check-nwc-connect.mjs` against `pnpm dev --port 9031` (or `NWC_BASE_URL`): every connect step with a stand-in wallet, the Settings details, Home with a receive-only connection, dark mode and German at 320 px.
