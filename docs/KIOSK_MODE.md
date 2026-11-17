# Kiosk Mode

Kiosk Mode turns BuhoGO into a local register. Staff can build baskets, accept payments and open the current receipt. The owner PIN protects wallet administration, reports, exports and transfers.

[Feature records](README.md) · [Approved behavior](KIOSK_POS_PLAN.md)

## Entry points

- Settings → Kiosk Mode opens `/kiosk-mode` for setup and owner tools. Its query views share the native toolbar and sheets.
- `/kiosk` is the locked register. Every other route redirects here while `kioskEnabled && !kioskOwnerAccess`.
- Setup preselects an eligible receiving wallet and currency, asks for the owner PIN twice, then opens the register. The illustrated tour is optional. Products and transfers can be configured later.
- Existing receiving wallets, entry units, tip percentages and independent round-up preferences are retained. Tips remain off by default.

## Checkout and recovery

`KioskDashboard.vue` reuses `AmountKeypad.vue` for exact sats or fiat entry, retaining the register's large amount and keypad. Tapping the amount changes its input unit. Products, quantities and saved baskets use the same durable draft. Catalog currency cannot silently reprice existing products.

`stores/kioskMerchant.js` owns the catalog, drafts, saved baskets, immutable sale snapshots and linked payment attempts. `services/kioskMerchantStorage.js` commits them to IndexedDB with revision checks and strict durability where supported. Updating a draft does not rewrite historical order records. A competing window's changes cause a conflict instead of an overwrite; recovery retains the local draft as a saved basket before loading the newer state. After each commit the store posts its revision on a `BroadcastChannel`, and other windows of the same register load the newer state. A product, basket or order that cannot be read is set aside: it is not shown or counted, but stays in storage through later saves and in the register backup, and a restore brings it back set aside. Sales then say that some records cannot be read here.

`composables/useKioskPayments.js` is one detached receiving runtime per merchant store, initialized by `boot/kiosk-payments.js`. It survives leaving the register. The durable order and returned request must be saved before displaying a QR. A request that never came back from the wallet is closed as not charged: nothing can pay it, so Try again creates a new one on the same order. A returned request is checked until its expiry plus `KIOSK_LATE_PAYMENT_GRACE_MS` (10 minutes), then gets one final strict check: unpaid closes the attempt as unpaid, and no answer stops the checks with the attempt left open for Check payment again. The expiry is the later of the wallet's expiry and the request's lifetime counted from when the register saved it, so a device clock running ahead does not end a request early. A request closed as unpaid rests on one answer, so it is asked about again before Try again makes another request, and when the owner opens the sale with Check payment again. Records saved as uncertain by earlier versions never had a payment hash and load as not charged. Expired replacements use the same order and require fresh status checks of earlier requests. Returning to the app checks every waiting payment again. On the register, Check payment again shows when a check could not reach the wallet; the next answer from the wallet clears that problem. An owner's receipt offers it for a sale that may still turn out paid: waiting, expired, or closed as unpaid. Multiple paid attempts are retained as an exception while sales totals count the order once.

Success requires the selected wallet's exact invoice/hash confirmation, and a reported amount of at least the request. An NWC wallet reports what it credited after its own receive fee, so there the wallet and the hash are the proof. A card service accepting a withdrawal is not proof of payment. Card and QR share the receiving request. A paid sale records Bitcoin Card when a card was submitted for the request that settled and no card error followed, QR code when no card went to that request, and no method when a card failed on it or the sale settled while it was not the sale on the register screen. The method is set once and never changed. Browser payments use QR; supported Android hardware can additionally read Bitcoin Cards through the existing NFC bridge.

Only exact transaction IDs from verified lookup results receive transaction annotations. There is no amount/time-based attribution. The local register receipt remains authoritative if no transaction ID is available.

## Owner access and transfers

Owner access is session-only; restart locks the register. The existing salted PIN hash is retained. Five wrong owner PINs in a row are free; each further one waits 1, 5, 15, then 60 minutes (`utils/kioskPin.js`), and a try while waiting is not checked. The count and the wait are saved under their own key (`buhoGO_kiosk_pin_wait`), read before each try and written right after it, so neither a restart nor another window's save lifts them; a correct PIN, a new PIN or verified device recovery clears them. A wait longer than the tries earned, set while the clock was wrong, starts again from now. Moving the clock forward still ends a wait. The logo has no unlock gesture. Forgotten-PIN recovery requires the existing verified native device authentication; the browser has no such recovery capability and remains locked without the PIN. This is an application UI restriction, not operating-system device management or protection against someone modifying browser storage.

Payouts shows the receiving wallet's balance with Withdraw now. Owner withdrawals use the shared send sheet in withdraw mode (paste or scan, no contacts, Mobile Money or Batch Send; pasted text resolves as in Send, so a phone number still reaches a Mobile Money payout), the payment host, fee preparation and confirmation lifecycle; the review is titled Withdraw and shows a Total. The Max action refreshes balance and budgets the full enforced fee allowance where available. Unbounded-fee connections do not get a guaranteed full-balance Max. Native Bitcoin withdrawals retain the existing fee panel. Auto-Transfer uses the existing rule engine, including Bitcoin-address destinations from Spark; automatic Bitcoin transfers from Arkade remain unavailable. Rules run while the app is open and connected.

## Records and backup

Sales, labels, itemized CSV and register backup contain records available on this device. Historical prices and exchange rates do not change with the catalog. Summaries separate original fiat currencies and base sales from tips/round-up. Pending payments are not sales.

A register JSON backup includes products, baskets, order snapshots and payment request identities. Wallet credentials and the owner PIN are excluded. Restore is available only in an empty register; pending payments need their original wallet connection. Wallet recovery phrases and the app's existing wallet backups do not restore this separate merchant dataset. CSV is a report, not a restorable register backup.

## Verification

`npm test` includes domain, storage, mounted checkout, card, owner access, provider and lifecycle regressions. `npm run check:kiosk-storage` exercises actual browser IndexedDB, reload, competing writes and 10,000 orders. `npm run check:kiosk` runs the real app against explicitly scripted wallet responses; it requires a dev server. Actual screenshots and remaining physical-device/funded-wallet checks are recorded in the implementation review.
