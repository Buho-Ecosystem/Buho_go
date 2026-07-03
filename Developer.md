# BuhoGO Developer Guide

> The whole architecture in one read. Code over prose.

[← README](README.md) · [Contribute](CONTRIBUTING.md) · [User Guide](Guide.md)

---

## Stack

| Layer | Choice |
| --- | --- |
| UI | Vue 3 + Quasar |
| State | Pinia |
| Build | Vite |
| Mobile | Capacitor (Android shipped, iOS planned) |
| Lightning | `@buildonspark/spark-sdk` · `@getalby/sdk` · LNBits REST |
| Nostr | [nostr-core](https://nostr-core.netlify.app/) for all Nostr work (identity, NIP-05, pay-to-Nostr) |

## Data flow

```
Component → Pinia store → WalletProvider → SDK / REST API
```

Every wallet operation routes through a **provider**, so components stay wallet-agnostic. Send and receive UI never knows whether it is talking to Spark, NWC, or LNBits.

---

## Repository layout

```
src/
├── boot/         # axios, i18n, deep-links, kiosk guard, safe-area, nfc, theme, cloud-backup
├── components/   # Send/Receive sheets, PaymentConfirmSheet, Batch send, Kiosk PIN pad, map/*, L1 UI
├── pages/        # Wallet, Settings, KioskDashboard, MapPage, Earn* (Learn & Earn), setup pages
├── providers/    # WalletProvider (base) + Spark/NWC/LNBits + WalletFactory
├── services/     # walletBrands, nostrRecipient, nip05, map/* data sources, lnAddressServices
├── stores/       # wallet, addressBook, autoWithdraw, mapPlaces, earn, bitcoinPreferences, identity…
├── utils/        # address, amount, branta, biometric, lightning, nostr*, map*, fiatRates…
├── data/         # earn-quizzes.<locale>.json (Learn & Earn content)
├── i18n/         # en-US, de, es
└── css/app.css   # design tokens, safe-area vars, themes
```

---

## Wallet Provider pattern

> [!NOTE]
> A **4th backend, Arkade (Ark L2)**, is in progress on [PR #177](https://github.com/Buho-Ecosystem/Buho_go/pull/177) (branch `ark`). It is feature-complete in code and needs real-device mainnet testing. If you want to help ship it, read **[ARK_ME.md](ARK_ME.md)**.

All providers implement the same interface (`src/providers/WalletProvider.js`):

```js
class WalletProvider {
  getType()                                       // 'spark' | 'nwc' | 'lnbits'
  connect() / disconnect()
  getBalance()                                    // { balance, pending, tokenBalances }
  createInvoice({ amount, description, expiry })
  payInvoice({ invoice, maxFee })
  getTransactions({ limit, offset })

  // Spark-only (no-op elsewhere)
  getSparkAddress()
  transferToSparkAddress(addr, amount)
  payLightningAddress(addr, sats, comment)

  // L1 (Spark-only)
  getL1DepositAddress()
  getPendingDeposits()
  claimDeposit(txId, quoteData, outputIndex)
  withdrawToL1({ amountSats, destinationAddress, speed })
}
```

<details>
<summary><b>SparkWalletProvider</b></summary>

```js
await provider.initializeWithMnemonic(mnemonic)         // after device-key decrypt
await provider.transferToSparkAddress('spark1…', 10000) // zero fee
await provider.payLightningAddress('a@b.com', 5000)
```

Each seed yields **Business** (account 1) and **Personal** (account 0). Derivation: `m/8797555'/account'/keyType'`.

</details>

<details>
<summary><b>NWCWalletProvider</b></summary>

```js
const p = new NWCWalletProvider(walletId, { nwcUrl: 'nostr+walletconnect://…' })
await p.connect()
await p.payInvoice({ invoice: 'lnbc…' })
```

</details>

<details>
<summary><b>LNBitsWalletProvider</b></summary>

```js
const p = new LNBitsWalletProvider(walletId, {
  serverUrl: 'https://demo.lnbits.com',
  walletId: '…',
  adminKey: '…',
})
```

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/wallet` | balance and info |
| `POST /api/v1/payments` | create invoice / pay |
| `GET /api/v1/payments/{hash}` | status |
| `GET /api/v1/payments` | history |
| `POST /api/v1/payments/decode` | decode invoice |

Auth header: `X-Api-Key: <admin>`.

</details>

### WalletFactory

```js
import { createWalletProvider, parsePaymentDestination } from '@/providers/WalletFactory'

const provider = createWalletProvider(walletId, walletData)
parsePaymentDestination('lnbc10u1…')  // { type: 'bolt11', invoice, amount }
parsePaymentDestination('spark1qw3…') // { type: 'spark_address', address }
```

Spark address prefixes: `spark1` (mainnet) · `sparkt1` / `sparkrt1` / `sparks1` (testnet/regtest/signet) · legacy `sp1` / `tsp1` / `sprt1`.

---

## How a payment destination is resolved

The send flow is intentionally **one screen**: `SendModal.vue` raises `onPaymentDetected`, and `PaymentConfirmSheet.vue` shows what you are about to pay before you swipe. No separate compose-then-confirm step. Several resolvers feed it:

| Input | Resolved by | Result shown |
| --- | --- | --- |
| Invoice / LN address / LNURL / on-chain / Spark | `WalletFactory.parsePaymentDestination()` | Payment type and amount |
| Known LN-address domain | `services/walletBrands.js` → `matchWalletBrand(domain)` | Wallet logo and name (Blink, Primal, Phoenix, Strike, …) |
| `npub…` / `nprofile…` / NIP-05 | `services/nostrRecipient.js` + `utils/nostr*` | Nostr name and avatar |
| Phone number (Kenya, Zambia) | `SendModal` number detection + local partner | Country-formatted recipient |
| Any destination | `utils/branta.js` → `lookupBrantaVerification({ qrText })` | Branta verified badge (see `BrantaVerifiedBadge.vue`) |

> [!TIP]
> Adding a new "pay anyone" target usually means a new resolver here plus a row in `PaymentConfirmSheet`, not a change to the providers.

> [!IMPORTANT]
> **Building anything Nostr-related?** Use **[nostr-core](https://nostr-core.netlify.app/)** first, not `nostr-tools` or other libraries. It is the library BuhoGO standardises on.
> If the helper you need is missing, open a PR on **nostr-core** and mention it is for **BuhoGO**. We will review it quickly and pull it in.

---

## L1 Bitcoin (Spark)

```
On-chain BTC → mempool.space (monitor) → Spark SDK (claim/withdraw) → Lightning-spendable
```

**Constants** (in `SparkWalletProvider.js`):

| Constant | Value |
| --- | --- |
| `REQUIRED_CONFIRMATIONS` | 3 |
| `MIN_DEPOSIT_SATS` | 500 |
| `DEFAULT_MEMPOOL_API` | `https://mempool.space/api` |
| `TYPICAL_TX_VBYTES` | 140 |

**Deposit:** `getL1DepositAddress()` (P2TR, reusable) → `getPendingDeposits()` → `getClaimFeeQuote()` → `claimDeposit()`.

**Withdraw:** `getWithdrawalFeeQuote()` → `withdrawToL1({ speed: 'slow' | 'medium' | 'fast' })` → `getWithdrawalStatus()`.

---

## The Bitcoin map

`pages/MapPage.vue` is the orchestrator. `stores/mapPlaces.js` aggregates several public datasets and caches them:

```
mapPlaces.js
├── services/map/btcmap.js          # BTC Map
├── services/map/overpass.js        # OpenStreetMap (Overpass)
├── services/map/btcpay.js          # BTCPay directory
├── services/map/blink.js           # Blink map
├── services/map/bitcoinjungle.js   # Bitcoin Jungle
└── services/map/moneybadger.js     # MoneyBadger
```

The `MapView` component is a dumb surface. The bottom sheet (`MapBottomSheet`) is a distance-sorted nearby list. Geolocation, formatting, and directions live in `utils/mapGeolocation.js`, `utils/mapFormat.js`, and `utils/mapDirections.js`. "Online" sources load lazily, not on map open.

---

## Learn & Earn

A guided, Duolingo-style course. Content is data, not code: `src/data/earn-quizzes.<locale>.json`.

```js
// stores/earn.js
state: { completedQuestions, pendingSats, totalEarned }
getters: { totalQuestions, totalCompleted, overallProgress, allCompleted }
```

One correct answer earns one sat into `pendingSats`. Users claim accumulated sats to their wallet, rate-limited to **one claim per 30 minutes**. Pages: `EarnMap` (the path), `EarnSection`, `EarnQuiz`, `EarnSummary` (claim screen).

---

## Stores

<details>
<summary><b>wallet.js</b>: wallet CRUD, kiosk config, encryption</summary>

```js
addSparkWallet({ mnemonic, name, network })
addNWCWallet({ nwcUrl, name })
addLNBitsWallet({ serverUrl, walletId, adminKey, name })
setActiveWallet(id)
getDecryptedMnemonic(id)        // device-key AES-256-GCM

setKioskEnabled / WalletId / TipEnabled / TipValues / RoundUpEnabled / DisplayCurrency
```

Getters: `activeWallet`, `activeBalance`, `isActiveWalletSpark`, `activeSparkAddress`, …

</details>

<details>
<summary><b>addressBook.js</b></summary>

```js
{ id, name, address, addressType: 'lightning'|'spark'|'bitcoin', color, isFavorite, notes, createdAt }
```

</details>

<details>
<summary><b>autoWithdraw.js</b>: threshold sweeps</summary>

```js
{ walletId, enabled, threshold, destinationType, destination, feeSpeed }
```

60-second cooldown. Minimum send 10 sats.

</details>

<details>
<summary><b>Other stores</b></summary>

| Store | Job |
| --- | --- |
| `mapPlaces` / `mapBasemap` / `mapFavorites` / `mapMeetups` / `mapUnits` | Bitcoin map data, base layer, favourites, meetups, units |
| `earn` | Learn & Earn progress and claimable sats |
| `bitcoinPreferences` | Send-side preferences, including Branta verification |
| `identity` / `profile` | Nostr identity and profile |
| `transactionMetadata` | Notes, tags, and contact link, keyed by payment hash |

</details>

---

## Boot files

| File | Job |
| --- | --- |
| `deep-links.js` | Handle `lightning:`, `bitcoin:`, `lnurlp://`, `lnurlw://`. Blocked while kiosk is locked. |
| `kiosk.js` | Router guard: redirects all routes to `/kiosk` when locked; checks localStorage on cold start. |
| `safe-area.js` | Android notch / gesture-bar detection → `--safe-top`, `--safe-bottom` CSS vars. |
| `nfc.js` | NFC tap to read payment data. Routes through the same `onPaymentDetected` path as scanning. |
| `theme.js` | Applies the saved dark/light theme on boot. |
| `cloud-backup.js` | Optional encrypted backup hooks. |

---

## Security

**Spark seed encryption** uses AES-256-GCM, with a key derived via PBKDF2 (100k iterations, SHA-256) from a per-device random key. Stored as `salt:iv:ciphertext` (base64). Legacy PIN-encrypted wallets auto-migrate.

```js
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
  keyMaterial,
  { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
)
```

> [!IMPORTANT]
> Contributor rules:
> 1. **Never** log mnemonics, PINs, private keys, NWC strings, or LNBits keys.
> 2. Session-only state must clear on app close.
> 3. Validate every payment input (destination and amount) at the boundary.
> 4. Web Crypto needs a secure context. Use `localhost`, not LAN IPs.

---

## Styling

Design tokens live in `src/css/app.css`. Every component must support both themes:

```vue
<q-card :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
```

| Token | Value |
| --- | --- |
| Primary gradient | `#059573` → `#78D53C` |
| Accent green | `#15DE72` |
| Error red | `#FF0000` |
| Dark bg / input | `#0C0C0C` / `#171717` |
| Light bg | `#FFFFFF` / `#F8F8F8` |
| Card radius | 24px |
| Button radius | 12 to 14px |

**Safe area** for fixed or absolute bottom elements:

```css
padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
```

`var(--safe-top)` is auto-applied to `.q-page`.

---

## Adding things

<details>
<summary><b>A new payment type</b></summary>

1. `WalletFactory.parsePaymentDestination()` to detect the format
2. `SendModal` to wire the UI and raise `onPaymentDetected`
3. Implement it on the relevant providers
4. `PaymentConfirmSheet` to show the right recipient and route the send

</details>

<details>
<summary><b>A new wallet provider</b></summary>

1. New class extending `WalletProvider`
2. Implement the interface (no-op what does not apply)
3. Register it in `WalletFactory.createWalletProvider()`
4. Add a setup page, a route, and a store action

</details>

<details>
<summary><b>A new Pinia store</b></summary>

```js
import { defineStore } from 'pinia'
export const useNewStore = defineStore('newStore', {
  state: () => ({}),
  actions: {
    initialize() { /* hydrate from localStorage */ },
    persist()    { localStorage.setItem('buhoGO_new_store', JSON.stringify(this.$state)) },
  },
})
```

</details>

<details>
<summary><b>A new map data source</b></summary>

1. Add a fetcher in `src/services/map/` that returns places in the shared shape
2. Wire it into `stores/mapPlaces.js`
3. Decide whether it loads on map open or lazily

</details>

---

## Build

```bash
npm run dev          # hot reload at :9000
npm run build        # → dist/spa
npx serve dist/spa   # preview prod build

quasar build -m capacitor -T android        # APK
quasar build -m capacitor -T android --ide  # open Android Studio
```

Capacitor config: `src-capacitor/capacitor.config.json`. Intent filters for `lightning:` / `bitcoin:` / `lnurlp://` / `lnurlw://` are declared in the Android manifest.

---

## Common dev gotchas

| Symptom | Likely cause |
| --- | --- |
| `crypto.subtle is undefined` | Insecure context. Use `localhost`, not `192.168.x.x` |
| Spark SDK init throws | Wrong network in wallet vs SDK config, or invalid BIP-39 |
| NWC times out | Stale connection string, or NWC service down |
| LNBits 401 | You used the Invoice key. It needs Admin |
| LNBits CORS | Add your origin to the LNBits server config |
| Map shows nothing | Location permission denied, or a data source is unreachable |
| Android content under status bar | `viewport-fit=cover` missing, or a media query overrode safe-area padding |

---

## Resources

[Vue 3](https://vuejs.org/) · [Quasar](https://quasar.dev/) · [Pinia](https://pinia.vuejs.org/) · [Spark SDK](https://github.com/buildonspark/spark-sdk) · [Alby SDK](https://github.com/getAlby/js-sdk) · [nostr-core](https://nostr-core.netlify.app/) · [Arkade docs](https://docs.arkadeos.com/) · [NIP-47](https://github.com/nostr-protocol/nips/blob/master/47.md) · [LNBits API](https://demo.lnbits.com/docs) · [Capacitor](https://capacitorjs.com/docs)

> Working on the Arkade backend? See **[ARK_ME.md](ARK_ME.md)** for its testing state and open tasks.
</content>
