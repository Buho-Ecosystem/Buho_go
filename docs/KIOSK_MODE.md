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

`stores/kioskMerchant.js` owns the catalog, drafts, saved baskets, immutable sale snapshots and linked payment attempts. `services/kioskMerchantStorage.js` commits them to IndexedDB with revision checks and strict durability where supported. Updating a draft does not rewrite historical order records. A competing window's changes cause a conflict instead of an overwrite; recovery retains the local draft as a saved basket before loading the newer state.

`composables/useKioskPayments.js` is one detached receiving runtime per merchant store, initialized by `boot/kiosk-payments.js`. It survives leaving the register. The durable order and returned request must be saved before displaying a QR. Unknown creation outcomes remain uncertain and cannot be blindly resubmitted. Expired replacements use the same order and require fresh status checks of earlier requests. Late payments remain watched. Multiple paid attempts are retained as an exception while sales totals count the order once.

Success requires the selected wallet's exact invoice/hash confirmation. A card service accepting a withdrawal is not proof of payment. Card and QR share the receiving request, so receipts name the payment method as Lightning without claiming an unverified payer source. Browser payments use QR; supported Android hardware can additionally read Lightning cards through the existing NFC bridge.

Only exact transaction IDs from verified lookup results receive transaction annotations. There is no amount/time-based attribution. The local register receipt remains authoritative if no transaction ID is available.

## Owner access and transfers

Owner access is session-only; restart locks the register. The existing salted PIN hash is retained. The logo has no unlock gesture. Forgotten-PIN recovery requires the existing verified native device authentication; the browser has no such recovery capability and remains locked without the PIN. This is an application UI restriction, not operating-system device management or protection against someone modifying browser storage.

Owner withdrawals use the shared destination chooser, payment host, fee preparation and confirmation lifecycle. The Max action refreshes balance and budgets the full enforced fee allowance where available. Unbounded-fee connections do not get a guaranteed full-balance Max. Native Bitcoin withdrawals retain the existing fee panel. Auto-Transfer uses the existing rule engine, including Bitcoin-address destinations from Spark; automatic Bitcoin transfers from Arkade remain unavailable. Rules run while the app is open and connected.

## Records and backup

Sales, labels, itemized CSV and register backup contain records available on this device. Historical prices and exchange rates do not change with the catalog. Summaries separate original fiat currencies and base sales from tips/round-up. Pending payments are not sales.

A register JSON backup includes products, baskets, order snapshots and payment request identities. Wallet credentials and the owner PIN are excluded. Restore is available only in an empty register; pending payments need their original wallet connection. Wallet recovery phrases and the app's existing wallet backups do not restore this separate merchant dataset. CSV is a report, not a restorable register backup.

## Verification

`npm test` includes domain, storage, mounted checkout, card, owner access, provider and lifecycle regressions. `npm run check:kiosk-storage` exercises actual browser IndexedDB, reload, competing writes and 10,000 orders. `npm run check:kiosk` runs the real app against explicitly scripted wallet responses; it requires a dev server. Actual screenshots and remaining physical-device/funded-wallet checks are recorded in the implementation review.
