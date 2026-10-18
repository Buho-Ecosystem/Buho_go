# BuhoGO Developer Guide

> The architecture in one read. For how a single feature works, see the [feature records](docs/README.md).

[← README](README.md) · [Contribute](CONTRIBUTING.md) · [Feature records](docs/README.md) · [User docs](https://docs-buhogo.netlify.app/)

---

## Stack

| Layer | Choice |
| --- | --- |
| UI | Vue 3 + Quasar (legacy-mode vue-i18n: use `this.$t` / `proxy.$t`, never `useI18n()`) |
| State | Pinia |
| Build | Vite (Quasar CLI) |
| Mobile | Capacitor 8, Android shipped |
| Spark | `@breeztech/breez-sdk-spark` |
| Arkade | `@arkade-os/sdk` |
| NWC | `@getalby/sdk` |
| LNbits | REST |
| Nostr | [nostr-core](https://nostr-core.netlify.app/), for every Nostr feature |

```
Component → Pinia store → WalletProvider → SDK / REST API
```

Every wallet operation goes through a **provider**, so screens never know whether they talk to Spark, Arkade, NWC or LNbits.

---

## Repository layout

```
src/
├── boot/         app start: theme, launch, i18n, wallet store, kiosk guard, deep links, NFC, chat inbox, …
├── components/   sheets and building blocks (send, receive, confirm, kiosk, autoTransfer/, sheets/, …)
├── composables/  shared component logic (contact chat, address book sync, …)
├── pages/        routed screens (Wallet = Home, Settings, KioskDashboard, AutoTransfer*, setup pages, …)
├── providers/    WalletProvider (base) + BreezSpark / Arkade / NWC / LNBits + WalletFactory
├── services/     side effects: Spark lifecycle, NWC payment, map sources, chat (dm/), tax report, …
├── stores/       Pinia stores (wallet, autoWithdraw, addressBook, identity, messages, …)
├── utils/        pure rules, each with tests in utils/__tests__/
├── data/         Learn & Earn questions per locale
├── i18n/         en-US, de, es (one file per feature area, merged in index.js)
└── css/app.css   design tokens, shared sheet styles (iform-*), themes
scripts/          check-*.mjs browser checks, device/ (Android over CDP), release helpers
docs/             feature records (docs/README.md)
store/            store listing images, not shipped in the app
```

---

## Wallet providers

All providers extend `src/providers/WalletProvider.js`:

```js
getType()                 // 'spark' | 'arkade' | 'nwc' | 'lnbits'
connect() / disconnect()
getBalance()
createInvoice({ amount, description, expiry })
payInvoice({ invoice, maxFee })
getTransactions({ limit, offset })
```

`WalletFactory.createWalletProvider(wallet)` builds one; `parsePaymentDestination(input)` reads anything pasted or scanned.

<details>
<summary><b>Spark</b>: <code>BreezSparkWalletProvider</code></summary>

The Breez SDK is the only Spark engine. One recovery phrase opens up to **six** Spark wallets, each at its own Breez account number (`SPARK_ACCOUNT_ORDER = [1, 2, 3, 4, 5, 0]` in `utils/sparkAccounts.js`, path `m/8797555'/{account}'`). A wallet added again opens the same account. Record: [docs/SPARK_WALLETS.md](docs/SPARK_WALLETS.md).

```js
await provider.initializeWithMnemonic(mnemonic)          // after the device key decrypts it
await provider.transferToSparkAddress('spark1…', 10000)  // free; refuses any quoted fee
await provider.payLightningAddress('a@b.com', 5000)
```

On-chain: `getL1DepositAddress()` → `getPendingDeposits()` → `claimDeposit()` (3 confirmations); `getWithdrawalFeeQuote()` → `withdrawToL1({ speed })`. `services/sparkLifecycle.js` keeps every Spark wallet's balance verified (start, resume, network back, timer, SDK events). The Spark emergency exit lives in `services/emergencyExit.js` ([docs/EMERGENCY_EXIT.md](docs/EMERGENCY_EXIT.md)).

</details>

<details>
<summary><b>Arkade</b>: <code>ArkadeWalletProvider</code></summary>

Self-custodial on the Ark protocol (VTXOs); one Arkade wallet per install.

| Method | Purpose |
| --- | --- |
| `getArkadeAddress()` / `transferToArkadeAddress({ arkadeAddress, amount })` | Instant `ark1` → `ark1` |
| `getBoardingAddress()` / `offboardToBitcoin({ bitcoinAddress, amount })` | On-chain receive and send (Ramps) |
| `startIncomingFundsListener(cb)` | Incoming funds |
| `checkLiveness()` | VTXO renew and recover, throttled |

- **Keys:** `MnemonicIdentity.fromMnemonic` on BIP-86 Taproot `m/86'/{0 mainnet, 1 test}'/0'/0/*` (`utils/arkadeKeys.js`, pinned by a test). A BuhoGO Arkade phrase restores in the Arkade reference wallet.
- **Server:** `https://arkade.computer` (mainnet only). Esplora: mempool.space.
- **Lightning is paused.** It rode the retired Boltz swap service; the successor (`@arkade-os/swap`) is not wired yet. `utils/walletCapabilities.js` (`canWalletPay`) keeps every screen from offering Lightning on Arkade.
- **Brand colours:** purple in light mode, red-orange in dark mode (`components/ArkadeLogo.vue`, `--arkade-*` tokens).
- References: [Arkade docs](https://docs.arkadeos.com/) · [TS SDK](https://github.com/arkade-os/ts-sdk) · [reference wallet](https://github.com/arkade-os/wallet)

</details>

<details>
<summary><b>NWC</b>: <code>NWCWalletProvider</code></summary>

A Nostr Wallet Connect (NIP-47) client. Every NWC payment goes through `services/nwcPayment.js` (`payWithNwc`), which proof-checks a payment and never resends one whose outcome is unknown. Record: [docs/NWC.md](docs/NWC.md).

</details>

<details>
<summary><b>LNbits</b>: <code>LNBitsWalletProvider</code></summary>

REST with the wallet's admin key (`X-Api-Key`): `GET /api/v1/wallet`, `POST /api/v1/payments`, `GET /api/v1/payments/{hash}`. The server must allow your origin (CORS) on the web.

</details>

---

## Sending a payment

The send flow is **one screen**: `SendModal.vue` raises `onPaymentDetected`, and `PaymentConfirmSheet.vue` shows the recipient, amount and paying wallet before the slide. Resolvers feed it:

| Input | Resolved by |
| --- | --- |
| Invoice, LN address, LNURL, on-chain, Spark, Arkade | `WalletFactory.parsePaymentDestination()` |
| Known LN-address domain (wallet logo and name) | `services/walletBrands.js` |
| `npub` / `nprofile` / NIP-05 | `services/nostrRecipient.js` |
| Phone number (Kenya, Zambia) | `services/lnAddressServices/` |
| Branta verified destination | `utils/branta.js` |

Which wallet can pay what is decided once, in `utils/walletCapabilities.js`. A new "pay anyone" target is usually a resolver plus a row in `PaymentConfirmSheet`, not a provider change.

> [!IMPORTANT]
> Building anything Nostr-related? Use [nostr-core](https://nostr-core.netlify.app/), not `nostr-tools`. If a helper is missing, open a PR there and mention it is for BuhoGO.

**Paths that move money outside the main send flow** must get every rule the main flow gets: batch send, internal transfer (`wallet.transferBetweenWallets`), Auto-Transfer (`stores/autoWithdraw.js`, [record](docs/AUTO_TRANSFER.md)), kiosk sales and Bolt Card ([record](docs/BOLT_CARD.md)).

---

## Stores

| Store | Job |
| --- | --- |
| `wallet` | Wallets, providers, balances (one write path: `applyBalance`), kiosk settings, removal ([record](docs/WALLET_REMOVAL.md)) |
| `autoWithdraw` | Auto-Transfer rules and their activity ([record](docs/AUTO_TRANSFER.md)) |
| `addressBook` | Contacts, synced over Nostr |
| `identity` / `profile` | Nostr identities and the public profile |
| `messages` | Contact chat (NIP-17) ([record](docs/CONTACT_CHAT.md)) |
| `transactionMetadata` | Notes, tags, labels and sources per transaction, scoped to a wallet |
| `exitKit` / `emergencyExit` | Spark emergency exit |
| `cloudBackup` | Encrypted Google Drive backup ([record](docs/CLOUD_BACKUP_SETUP.md)) |
| `earn` | Learn & Earn progress and claims |
| `map*` | Bitcoin map data, base layer, favourites, meetups, units |

Stores persist to `localStorage` under `buhoGO_*` keys. Never change a stored shape without reading the old one (see `normalizeRule` in `utils/autoTransfer.js` for the pattern).

---

## Security

Recovery phrases are encrypted with AES-256-GCM under a key derived (PBKDF2, 100k iterations, SHA-256) from a per-device random key. App lock and biometrics on Android go through the in-repo `AppLockPlugin`.

> [!IMPORTANT]
> 1. Never log recovery phrases, PINs, private keys, NWC strings or LNbits keys.
> 2. Validate every destination and amount at the boundary.
> 3. Web Crypto needs a secure context: use `localhost`, not a LAN IP.
> 4. Changes to a payment flow must be checked in kiosk mode too: it boots on its own path and never opens Home.

---

## Styling

Tokens live in `src/css/app.css`; every screen supports both themes. Shared sheet pieces: `.iform-sheet`, `.iform-group`, `.iform-line`, `.iform-foot` (an explanation goes in a footer under its group, not in an alert).

| Token | Light | Dark |
| --- | --- | --- |
| `--bg-primary` | `#FAF7EF` | `#0C0C0C` |
| `--text-primary` | `#1A1A1C` | `#FFFFFF` |
| `--brand-accent` | `#059573` | `#15DE72` |
| `--color-negative` | `#B42332` | `#FF939B` |

For bottom-fixed elements use `padding-bottom: max(16px, env(safe-area-inset-bottom, 0px))`. In i18n values, write a literal `@` as `{'@'}`.

---

## Build and checks

```bash
npm run dev                                  # http://localhost:9000
npm run build                                # dist/spa
npm test                                     # unit tests (node --test)
npm run check:native-plugins                 # native plugins listed in src-capacitor/package.json
node scripts/check-auto-transfer.mjs         # a browser check; others in scripts/check-*.mjs
```

Browser checks drive the real app against a dev server on the port they name, with the network cut and stand-in wallets; their screenshots land in `output/` (ignored).

**Android:**

```bash
npx quasar build -m capacitor -T android --skip-pkg
cd src-capacitor && npx cap sync android
cd android && ./gradlew :app:assembleDebug
```

Native plugins must be listed in `src-capacitor/package.json`, or they report "not implemented on android". Debug builds expose the WebView to `scripts/device/cdp.mjs` (Playwright cannot attach to Android WebView).

---

## Common gotchas

| Symptom | Likely cause |
| --- | --- |
| `crypto.subtle is undefined` | Insecure context. Use `localhost` |
| A blank page with an i18n error | `useI18n()` in legacy mode. Use `proxy.$t` |
| A Spark check reads stale data | The balance came from cache. Money moves only on a verified balance |
| NWC times out | A stale connection string, or the wallet service is down |
| LNbits 401 | The invoice key was used. It needs the admin key |
| Content under the status bar on Android | A media query overrode the safe-area padding |
| `npm test` prints its summary and never exits | Run a single spec file directly with `node --test` |

---

## Resources

[Vue 3](https://vuejs.org/) · [Quasar](https://quasar.dev/) · [Pinia](https://pinia.vuejs.org/) · [Breez SDK Spark](https://sdk-doc-spark.breez.technology/) · [Arkade](https://docs.arkadeos.com/) · [Alby SDK](https://github.com/getAlby/js-sdk) · [nostr-core](https://nostr-core.netlify.app/) · [NIP-47](https://github.com/nostr-protocol/nips/blob/master/47.md) · [LNbits API](https://demo.lnbits.com/docs) · [Capacitor](https://capacitorjs.com/docs)
