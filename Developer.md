# BuhoGO — Developer Guide

> Architecture in one read. Code samples over prose.

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

## Data flow

```
Component → Pinia store → WalletProvider → SDK / REST API
```

All wallet operations route through a **provider** so components stay wallet-agnostic.

---

## Repository layout

```
src/
├── boot/         # axios, i18n, deep-links, kiosk guard, safe-area
├── components/   # Send/Receive/Payment modals, Kiosk PIN pad, L1 UI…
├── pages/        # Wallet, Settings, KioskDashboard, Setup pages…
├── providers/    # WalletProvider (base) + Spark/NWC/LNBits + Factory
├── stores/       # wallet, addressBook, autoWithdraw, transactionMetadata
├── utils/        # address, amount, biometric, lightning, fiatRates…
├── i18n/         # en, de, es
└── css/app.css   # design tokens, safe-area vars, themes
```

---

## Wallet Provider pattern

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

Each seed yields **Business** (account 1) + **Personal** (account 0). Derivation: `m/8797555'/account'/keyType'`.

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
| `GET /api/v1/wallet` | balance + info |
| `POST /api/v1/payments` | create invoice / pay |
| `GET /api/v1/payments/{hash}` | status |
| `GET /api/v1/payments` | history |
| `POST /api/v1/payments/decode` | decode invoice |

Auth: `X-Api-Key: <admin>`.

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

## Stores

<details>
<summary><b>wallet.js</b> — wallet CRUD, kiosk config, encryption</summary>

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
<summary><b>autoWithdraw.js</b> — threshold sweeps</summary>

```js
{ walletId, enabled, threshold, destinationType, destination, feeSpeed }
```

60-second cooldown. Min send 10 sats.

</details>

<details>
<summary><b>transactionMetadata.js</b> — notes/tags/contact link, keyed by payment hash</summary>
</details>

---

## Boot files

| File | Job |
| --- | --- |
| `deep-links.js` | Handle `lightning:`, `bitcoin:`, `lnurlp://`, `lnurlw://`. Blocked while kiosk is locked. |
| `kiosk.js` | Router guard: redirects all routes to `/kiosk` when locked; checks localStorage on cold start. |
| `safe-area.js` | Android notch / gesture-bar detection → `--safe-top`, `--safe-bottom` CSS vars. |

---

## Security

**Spark seed encryption** — AES-256-GCM, key derived via PBKDF2 (100k iterations, SHA-256) from a per-device random key. Stored as `salt:iv:ciphertext` (base64). Legacy PIN-encrypted wallets auto-migrate.

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
> 3. Validate all payment inputs (destination + amount) at the boundary.
> 4. Web Crypto needs a secure context — use `localhost`, not LAN IPs.

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
| Button radius | 12–14px |

**Safe area** — fixed/absolute bottom elements:

```css
padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
```

`var(--safe-top)` is auto-applied to `.q-page`.

---

## Adding things

<details>
<summary><b>A new payment type</b></summary>

1. `WalletFactory.parsePaymentDestination()` — detect format
2. `SendModal.determinePaymentType()` — wire UI
3. Implement on relevant providers
4. `PaymentModal.sendPayment()` — route correctly

</details>

<details>
<summary><b>A new wallet provider</b></summary>

1. New class extending `WalletProvider`
2. Implement the interface (no-op what doesn't apply)
3. Register in `WalletFactory.createWalletProvider()`
4. Add a setup page + route + store action

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
| `crypto.subtle is undefined` | Insecure context — use `localhost`, not `192.168.x.x` |
| Spark SDK init throws | Wrong network in wallet vs SDK config, or invalid BIP-39 |
| NWC times out | Stale connection string, or NWC service down |
| LNBits 401 | You used the Invoice key — needs Admin |
| LNBits CORS | Add your origin to LNBits server config |
| Android content under status bar | `viewport-fit=cover` missing, or media query overrode safe-area padding |

---

## Resources

[Vue 3](https://vuejs.org/) · [Quasar](https://quasar.dev/) · [Pinia](https://pinia.vuejs.org/) · [Spark SDK](https://github.com/buildonspark/spark-sdk) · [Alby SDK](https://github.com/getAlby/js-sdk) · [NIP-47](https://github.com/nostr-protocol/nips/blob/master/47.md) · [LNBits API](https://demo.lnbits.com/docs) · [Capacitor](https://capacitorjs.com/docs)
