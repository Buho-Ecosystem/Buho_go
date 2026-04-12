# BuhoGO Developer Guide

Technical documentation for developers contributing to BuhoGO.

Back to [README](README.md) | For users: [User Guide](Guide.md)

<br>

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Wallet Provider System](#wallet-provider-system)
4. [L1 Bitcoin Integration](#l1-bitcoin-integration)
5. [State Management](#state-management)
6. [Key Components](#key-components)
7. [Boot Files](#boot-files)
8. [Adding Features](#adding-features)
9. [Styling Guidelines](#styling-guidelines)
10. [Building for Mobile](#building-for-mobile)
11. [Testing](#testing)

<br>

## Architecture Overview

BuhoGO is built with Vue.js 3 and the Quasar Framework. The application follows a provider pattern for wallet operations, allowing different wallet types (Spark, NWC, LNBits) to implement a common interface.

### Core Technologies

| Layer | Technology | Purpose |
|-------|------------|---------|
| UI Framework | Vue.js 3 | Component-based UI |
| Component Library | Quasar | Pre-built components, theming |
| State Management | Pinia | Centralized reactive state |
| Routing | Vue Router | SPA navigation |
| Build | Vite | Fast development and builds |
| Lightning (Spark) | @buildonspark/spark-sdk | Self-custodial wallet |
| Lightning (NWC) | @getalby/sdk | Wallet connect protocol |
| Lightning (LNBits) | LNBits REST API | Direct API integration |
| Mobile | Capacitor | Android builds |

### Data Flow

```
User Action
    |
    v
Vue Component
    |
    v
Pinia Store (wallet.js, addressBook.js, autoWithdraw.js, transactionMetadata.js)
    |
    v
Wallet Provider (SparkWalletProvider, NWCWalletProvider, LNBitsWalletProvider)
    |
    v
External SDK/API (@buildonspark/spark-sdk, @getalby/sdk, or LNBits REST API)
```

<br>

## Project Structure

```
src/
  boot/
    axios.js               # HTTP client setup
    deep-links.js           # URI scheme handling (lightning:, bitcoin:, lnurl)
    i18n.js                 # Internationalization setup
    iconify.js              # Icon library
    kiosk.js                # Navigation guard for kiosk mode
    safe-area.js            # Android notch/gesture bar detection

  components/
    AddressBookQuickModal.vue  # Quick contact access
    BatchSendModal.vue         # Multi-contact batch payments
    InternalTransferModal.vue  # Transfer between wallets
    KioskPinPad.vue            # 4-digit PIN entry for kiosk
    L1BitcoinReceive.vue       # On-chain Bitcoin deposit UI
    L1BitcoinWithdraw.vue      # On-chain Bitcoin withdrawal UI
    MnemonicDisplay.vue        # Seed phrase display
    MnemonicOrderVerify.vue    # Tap-to-order seed verification
    PaymentModal.vue           # Payment confirmation dialog
    PinEntryDialog.vue         # PIN input component
    ReceiveModal.vue           # Invoice/address generation
    SendModal.vue              # Payment input and scanning

  pages/
    AddressBook.vue            # Contact management
    IndexPage.vue              # NWC connection page
    KioskDashboard.vue         # Point of sale interface
    LNBitsSetupPage.vue        # LNBits wallet setup
    NWCSetupPage.vue           # NWC wallet setup
    Settings.vue               # App settings
    SparkRestorePage.vue       # Seed phrase restore flow
    SparkSetupPage.vue         # New Spark wallet creation
    SparkSuccessWizard.vue     # Post-setup onboarding
    TransactionDetails.vue     # Single transaction view
    TransactionHistory.vue     # Transaction list with filters
    Wallet.vue                 # Main wallet dashboard
    WelcomePage.vue            # Initial wallet type selection

  providers/
    WalletProvider.js          # Abstract base class
    SparkWalletProvider.js     # Spark wallet implementation
    NWCWalletProvider.js       # NWC wallet implementation
    LNBitsWalletProvider.js    # LNBits wallet implementation
    WalletFactory.js           # Provider creation and payment parsing

  stores/
    wallet.js                  # Wallet state, kiosk config, encryption
    addressBook.js             # Contact management
    autoWithdraw.js            # Threshold-based auto payouts
    transactionMetadata.js     # Notes, tags, contact linking per TX

  utils/
    addressUtils.js            # Address formatting/validation
    amountFormatting.js        # Sat/fiat conversion and display
    biometric.js               # Fingerprint/face auth wrapper
    eventBus.js                # Component event communication
    fiatRates.js               # Bitcoin price fetching
    haptics.js                 # Vibration feedback
    lightning.js               # Lightning payment utilities
    share.js                   # OS share API wrapper

  css/
    app.css                    # Global styles, safe-area variables, theming

  i18n/                        # Translations (en, de, es)
  router/                      # Route definitions
```

<br>

## Wallet Provider System

The provider pattern abstracts wallet operations so components do not need to know which wallet type is active.

### Base Provider Interface

`WalletProvider.js` defines the interface all providers must implement:

```javascript
class WalletProvider {
  // Identity
  getType()              // Returns 'spark', 'nwc', or 'lnbits'
  isSpark()              // Boolean check

  // Connection
  connect()              // Establish connection
  disconnect()           // Clean up resources

  // Balance and Info
  getBalance()           // Returns { balance, pending, tokenBalances }
  getInfo()              // Returns wallet metadata

  // Payments
  createInvoice({ amount, description, expiry })
  payInvoice({ invoice, maxFee })
  lookupInvoice(paymentHash)
  getTransactions({ limit, offset })

  // Spark-specific (no-op in NWC/LNBits)
  getSparkAddress()
  transferToSparkAddress(sparkAddress, amount)
  payLightningAddress(lightningAddress, amountSats, comment)

  // L1 Bitcoin (Spark-only)
  getL1DepositAddress()
  getPendingDeposits()
  getClaimFeeQuote(txId, outputIndex)
  claimDeposit(txId, quoteData, outputIndex)
  refundDeposit(txId, outputIndex)
  getWithdrawalFeeQuote(amountSats, address)
  withdrawToL1({ amountSats, destinationAddress, speed })
  getWithdrawalStatus(requestId)
}
```

### SparkWalletProvider

Implements the full interface using `@buildonspark/spark-sdk`:

```javascript
// Initialization requires mnemonic (after device key decryption)
await provider.initializeWithMnemonic(mnemonic)

// Zero-fee Spark transfer
await provider.transferToSparkAddress('spark1...', 10000)

// Pay Lightning address (fetches invoice via LNURL)
await provider.payLightningAddress('user@domain.com', 5000, 'Payment note')

// L1 Bitcoin Operations
const address = await provider.getL1DepositAddress()  // Returns bc1p...
const deposits = await provider.getPendingDeposits()
await provider.claimDeposit(txId, quoteData)
await provider.withdrawToL1({ amountSats, destinationAddress, speed })
```

Multi-account support: each Spark mnemonic creates Business (account 1) and Personal (account 0) wallets. The derivation path is `m/8797555'/accountNumber'/keyType'`.

### NWCWalletProvider

Wraps `@getalby/sdk` NostrWebLNProvider:

```javascript
const provider = new NWCWalletProvider(walletId, {
  nwcUrl: 'nostr+walletconnect://...'
})
await provider.connect()

const balance = await provider.getBalance()
await provider.payInvoice({ invoice: 'lnbc...' })
```

### LNBitsWalletProvider

Connects directly to LNBits via REST API:

```javascript
const provider = new LNBitsWalletProvider(walletId, {
  serverUrl: 'https://demo.lnbits.com',
  walletId: 'abc123...',
  adminKey: 'xyz789...'
})
await provider.connect()

const balance = await provider.getBalance()
await provider.payInvoice({ invoice: 'lnbc...' })
const invoice = await provider.createInvoice({ amount: 1000, description: 'Test' })
```

**API Endpoints Used:**
- `GET /api/v1/wallet` - Get wallet info and balance
- `POST /api/v1/payments` - Create invoice or pay invoice
- `GET /api/v1/payments/{hash}` - Check payment status
- `GET /api/v1/payments` - List transactions
- `POST /api/v1/payments/decode` - Decode invoice

**Authentication:** All requests include the `X-Api-Key` header with the Admin API key.

### WalletFactory

Utility functions for provider creation and payment parsing:

```javascript
import { createWalletProvider, parsePaymentDestination } from '@/providers/WalletFactory'

// Create appropriate provider based on wallet data
const provider = createWalletProvider(walletId, walletData)

// Parse any payment format
const result = parsePaymentDestination('lnbc10u1...')
// Returns: { type: 'bolt11', invoice: '...', amount: 1000 }

const result = parsePaymentDestination('spark1qw3...')
// Returns: { type: 'spark_address', address: 'spark1qw3...' }
```

**Supported address prefixes:**
- New format: `spark1` (mainnet), `sparkrt1` (regtest), `sparkt1` (testnet), `sparks1` (signet)
- Legacy: `sp1` (mainnet), `tsp1` (testnet), `sprt1` (regtest)

<br>

## L1 Bitcoin Integration

Spark wallets support on-chain Bitcoin (Layer 1) deposits and withdrawals.

### Architecture

```
On-Chain Bitcoin
       |
       v
Bitcoin Network (mempool.space API for monitoring)
       |
       v
Spark SDK (deposit address, claim, withdraw)
       |
       v
L1BitcoinReceive.vue / L1BitcoinWithdraw.vue
       |
       v
Spark Balance (available for Lightning)
```

### L1 Constants

Defined in `SparkWalletProvider.js`:

```javascript
const BITCOIN_L1 = {
  REQUIRED_CONFIRMATIONS: 3,
  MIN_DEPOSIT_SATS: 500,
  DEFAULT_MEMPOOL_API: 'https://mempool.space/api',
  TYPICAL_TX_VBYTES: 140
}
```

### Deposit Flow (Receiving On-Chain)

1. `getL1DepositAddress()` returns a P2TR (Taproot) address, static and reusable
2. `getPendingDeposits()` polls mempool.space for UTXOs
3. `getClaimFeeQuote(txId, outputIndex)` returns fee and credit amount
4. `claimDeposit(txId, quoteData, outputIndex)` finalizes the deposit

### Withdrawal Flow (Sending On-Chain)

1. `getWithdrawalFeeQuote(amountSats, address)` returns `{ slow, medium, fast, expiresAt }`
2. `withdrawToL1({ amountSats, destinationAddress, speed, feeQuoteId })` executes
3. `getWithdrawalStatus(requestId)` tracks completion

<br>

## State Management

### Wallet Store (`stores/wallet.js`)

Central store for all wallet operations and kiosk configuration.

**Key Actions**
```javascript
// Wallet management
addSparkWallet({ mnemonic, name, network })
addNWCWallet({ nwcUrl, name })
addLNBitsWallet({ serverUrl, walletId, adminKey, name })
removeWallet(walletId)
setActiveWallet(walletId)

// Spark security
getDecryptedMnemonic(walletId)  // Decrypt with device key

// Kiosk
setKioskEnabled(enabled)
setKioskWalletId(walletId)
setKioskTipEnabled(enabled)
setKioskTipValues(values)       // Array of 3 percentages
setKioskRoundUpEnabled(enabled)
setKioskDisplayCurrency(currency)
```

**Key Getters**
```javascript
activeWallet          // Current wallet object
activeBalance         // Balance for active wallet
isActiveWalletSpark
isActiveWalletNWC
isActiveWalletLNBits
activeSparkAddress
hasSparkWallet
```

### AddressBook Store (`stores/addressBook.js`)

```javascript
{
  id: 'addr-123...',
  name: 'Alice',
  address: 'alice@wallet.com',
  addressType: 'lightning',    // 'lightning', 'spark', or 'bitcoin'
  color: '#3B82F6',
  isFavorite: false,
  notes: '',
  createdAt: 1699999999999
}
```

### AutoWithdraw Store (`stores/autoWithdraw.js`)

Threshold-based automatic payouts per wallet.

```javascript
// Rule structure
{
  walletId: '...',
  enabled: true,
  threshold: 100000,           // sats
  destinationType: 'lightning', // 'lightning', 'bitcoin', or 'spark'
  destination: 'user@wallet.com',
  feeSpeed: 'MEDIUM'          // for bitcoin destinations
}
```

60-second cooldown between triggers. Minimum send: 10 sats.

### TransactionMetadata Store (`stores/transactionMetadata.js`)

Per-transaction notes, tags, and contact linking. Keyed by payment hash.

<br>

## Key Components

### SendModal.vue

Handles payment input and QR scanning.

- Camera-based QR scanning with `qr-scanner` library
- Automatic payment type detection
- Contact picker with wallet compatibility filtering
- Clipboard paste support

### ReceiveModal.vue

Generates invoices and displays receive addresses.

- Toggle between Lightning invoice, Spark address, and Bitcoin (L1)
- QR code generation
- Copy and share functionality
- Invoice expiry countdown

### BatchSendModal.vue

5-step wizard for multi-contact payments:

1. Select contacts (with search and select-all)
2. Enter amounts (same for all, or custom per contact)
3. Review totals
4. Execute payments with real-time progress
5. Summary with retry for failures

### KioskDashboard.vue

Full POS interface:

- Numeric keypad for amount entry
- Tip selection (configurable percentages)
- QR code generation for customer scanning
- Payment success/failure display
- PIN-locked owner access

### PinEntryDialog.vue

6-digit numpad input for wallet security. Supports confirm mode for new PIN setup.

### KioskPinPad.vue

4-digit numpad input for kiosk owner access.

<br>

## Boot Files

### `deep-links.js`

Handles URI schemes when the app is opened via `lightning:`, `bitcoin:`, `lnurlp://`, or `lnurlw://` links. Blocks deep links when kiosk mode is active. Deduplicates events on app resume.

### `kiosk.js`

Vue Router navigation guard. When kiosk is locked, all routes redirect to `/kiosk`. Allows wallet setup routes through even when locked. Checks localStorage as a fallback on cold start before Pinia is ready.

### `safe-area.js`

Android-specific. Detects display cutouts (notch, punch-hole camera) and gesture navigation bar height at runtime. Sets `--safe-top` and `--safe-bottom` CSS variables. Falls back to 24px top / 16px bottom when detection fails.

<br>

## Adding Features

### Adding a New Payment Type

1. Update `WalletFactory.parsePaymentDestination()` to detect the format
2. Add handling in `SendModal.determinePaymentType()`
3. Implement the payment method in relevant providers
4. Update `PaymentModal.sendPayment()` to route appropriately

### Adding a New Wallet Provider

1. Create new provider class extending `WalletProvider`
2. Implement all required interface methods
3. Update `WalletFactory.createWalletProvider()` to handle new type
4. Add wallet creation flow in a new setup page
5. Update wallet store with new add method
6. Add route in `router/routes.js`

### Adding a New Store

```javascript
// stores/newStore.js
import { defineStore } from 'pinia'

export const useNewStore = defineStore('newStore', {
  state: () => ({
    // Initial state
  }),

  getters: {
    // Computed properties
  },

  actions: {
    async initialize() {
      // Load from localStorage if needed
    },

    async persist() {
      localStorage.setItem('buhoGO_new_store', JSON.stringify(this.$state))
    }
  }
})
```

<br>

## Styling Guidelines

BuhoGO uses a consistent design system defined in `src/css/app.css`.

### Theme Classes

All components must support both themes using Quasar's dark mode detection:

```vue
<template>
  <q-card :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
    <q-btn :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'">
      Submit
    </q-btn>
  </q-card>
</template>
```

### Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Primary gradient | `#059573` to `#78D53C` | Primary buttons |
| Accent green | `#15DE72` | Success, receive amounts |
| Error red | `#FF0000` | Errors, send amounts |
| Warning | `#AFF24B` | Warnings |
| Dark background | `#0C0C0C` | Dark mode backgrounds |
| Dark input | `#171717` | Dark mode inputs |
| Light background | `#FFFFFF`, `#F8F8F8` | Light mode backgrounds |

### Border Radius

| Element | Radius |
|---------|--------|
| Cards | 24px |
| Buttons | 12-14px |
| Inputs | 12px (filled, not outlined in dark mode) |
| Menus | 16px |

### Safe Area

All fixed/absolute bottom elements must include:
```css
padding-bottom: max(Npx, env(safe-area-inset-bottom, 0px));
```

Use `var(--safe-top)` for top safe area (auto-applied to `.q-page`).

<br>

## Building for Mobile

### Android

```bash
# Build and open in Android Studio
quasar build -m capacitor -T android --ide

# Or build APK directly
quasar build -m capacitor -T android
```

Capacitor config is in `src-capacitor/capacitor.config.json`. The app registers intent filters for `lightning:`, `bitcoin:`, `lnurlp://`, and `lnurlw://` URI schemes in the Android manifest.

### iOS (Planned)

```bash
quasar build -m capacitor -T ios
npx cap open ios
```

<br>

## Testing

### Running the App Locally

```bash
# Development with hot reload
npm run dev

# Production build
npm run build

# Serve production build locally
npx serve dist/spa
```

<br>

## Security Considerations

For user-facing security info, see [Security](README.md#security) in the README.

### Spark Mnemonic Encryption

Mnemonics are encrypted using Web Crypto API with a device key (not PIN):

1. A random device key is generated on first use and stored in localStorage
2. Key is derived via PBKDF2 (100,000 iterations) with random salt
3. AES-256-GCM provides authenticated encryption with random IV
4. Stored as `salt:iv:ciphertext` (base64)

Legacy wallets that used PIN-based encryption are automatically migrated to device-key encryption.

```javascript
// Encryption flow (simplified)
const keyMaterial = await crypto.subtle.importKey('raw', deviceKeyBuffer, 'PBKDF2', false, ['deriveBits', 'deriveKey'])
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
  keyMaterial,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt']
)
const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
```

### Security Best Practices for Contributors

1. **Never log sensitive data**: No console.log of mnemonics, PINs, or private keys
2. **Clear sensitive state**: Session data is memory-only, cleared on app close
3. **Validate all inputs**: Especially payment destinations and amounts
4. **Use constant-time comparisons**: For PIN verification where applicable

<br>

## Common Issues

For user-facing troubleshooting, see [Troubleshooting](Guide.md#troubleshooting) in the User Guide.

### WebCrypto Not Available

Web Crypto API requires secure context (HTTPS or localhost). For local development, use `localhost` not IP address.

### Spark SDK Initialization Fails

- Check network setting matches intended environment (MAINNET/REGTEST)
- Verify mnemonic is valid 12-word BIP39
- Check console for specific SDK errors

### NWC Connection Timeout

- Verify NWC URL is complete and valid
- Check wallet provider service is running
- Try generating fresh NWC connection string

### LNBits Connection Issues

- Verify server URL includes protocol (`https://`)
- Check API key is Admin key, not Invoice key
- Ensure LNBits server is accessible
- For self-hosted: verify CORS is configured correctly

### Android Safe Area Issues

If content overlaps the status bar or navigation bar:
- Check `viewport-fit=cover` is set in `index.html`
- Verify `safe-area.js` boot file is loaded in `quasar.config.js`
- Use `max(Npx, env(safe-area-inset-bottom, 0px))` on fixed bottom elements
- Check responsive media queries don't clobber safe area padding with shorthand

<br>

## Resources

- [Vue.js Documentation](https://vuejs.org/)
- [Quasar Framework](https://quasar.dev/)
- [Pinia State Management](https://pinia.vuejs.org/)
- [Spark SDK](https://github.com/buildonspark/spark-sdk)
- [Alby SDK (NWC)](https://github.com/getAlby/js-sdk)
- [NIP-47 Specification](https://github.com/nostr-protocol/nips/blob/master/47.md)
- [LNBits API](https://demo.lnbits.com/docs)
- [Capacitor Documentation](https://capacitorjs.com/docs)

<br>

## Related Documentation

- [README](README.md) - Project overview, features, and quick start
- [User Guide](Guide.md) - Step-by-step instructions for end users
- [Use Cases](use_cases.md) - Real-world scenarios and examples
