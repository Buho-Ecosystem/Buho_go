# BuhoGO Developer Guide

Technical documentation for developers contributing to BuhoGO.

Back to [README](README.md) | For users: [User Guide](Guide.md)

<br>

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Wallet Provider System](#wallet-provider-system)
4. [State Management](#state-management)
5. [Key Components](#key-components)
6. [Adding Features](#adding-features)
7. [Styling Guidelines](#styling-guidelines)
8. [Testing](#testing)

<br>

## Architecture Overview

BuhoGO is built with Vue.js 3 and the Quasar Framework. The application follows a provider pattern for wallet operations, allowing different wallet types (Spark, NWC) to implement a common interface.

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

### Data Flow

```
User Action
    |
    v
Vue Component
    |
    v
Pinia Store (wallet.js, addressBook.js)
    |
    v
Wallet Provider (SparkWalletProvider, NWCWalletProvider)
    |
    v
External SDK (@buildonspark/spark-sdk or @getalby/sdk)
```

<br>

## Project Structure

```
src/
  components/
    AddressBook/           # Contact management components
      AddressBookEntry.vue
      AddressBookList.vue
      AddressBookModal.vue
    MnemonicDisplay.vue    # Seed phrase display
    MnemonicVerify.vue     # Seed phrase verification
    PaymentModal.vue       # Payment confirmation dialog
    PinEntryDialog.vue     # PIN input component
    ReceiveModal.vue       # Invoice/address generation
    SendModal.vue          # Payment input and scanning
    WalletSwitcher.vue     # Wallet selection dropdown

  pages/
    IndexPage.vue          # NWC connection page
    Settings.vue           # App settings
    SparkRestorePage.vue   # Seed phrase restore flow
    SparkSetupPage.vue     # New Spark wallet creation
    Wallet.vue             # Main wallet dashboard
    WelcomePage.vue        # Initial wallet type selection

  providers/
    WalletProvider.js      # Abstract base class
    SparkWalletProvider.js # Spark wallet implementation
    NWCWalletProvider.js   # NWC wallet implementation
    WalletFactory.js       # Provider creation utilities

  stores/
    wallet.js              # Wallet state and operations
    addressBook.js         # Contact management

  css/
    app.css                # Global styles and theming

  i18n/                    # Internationalization files
  router/                  # Route definitions
```

<br>

## Wallet Provider System

The provider pattern abstracts wallet operations so components do not need to know which wallet type is active.

### Base Provider Interface

`WalletProvider.js` defines the interface all providers must implement:

```javascript
class WalletProvider {
  // Identity
  getType()              // Returns 'spark' or 'nwc'
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

  // Spark-specific (no-op in NWC)
  getSparkAddress()
  transferToSparkAddress(sparkAddress, amount)
  payLightningAddress(lightningAddress, amountSats, comment)
}
```

### SparkWalletProvider

Implements the full interface using `@buildonspark/spark-sdk`:

```javascript
// Initialization requires mnemonic (after PIN decryption)
await provider.initializeWithMnemonic(mnemonic)

// Zero-fee Spark transfer
await provider.transferToSparkAddress('sp1...', 10000)

// Pay Lightning address (fetches invoice via LNURL)
await provider.payLightningAddress('user@domain.com', 5000, 'Payment note')
```

### NWCWalletProvider

Wraps `@getalby/sdk` NostrWebLNProvider:

```javascript
// Connection uses NWC URL
const provider = new NWCWalletProvider(walletId, {
  nwcUrl: 'nostr+walletconnect://...'
})
await provider.connect()

// Standard operations work identically
const balance = await provider.getBalance()
await provider.payInvoice({ invoice: 'lnbc...' })
```

### WalletFactory

Utility functions for provider creation and payment parsing:

```javascript
import { createWalletProvider, parsePaymentDestination } from '@/providers/WalletFactory'

// Create appropriate provider based on wallet data
const provider = createWalletProvider(walletId, walletData)

// Parse any payment format
const result = parsePaymentDestination('lnbc10u1...')
// Returns: { type: 'bolt11', invoice: '...', amount: 1000 }

const result = parsePaymentDestination('sp1qw3...')
// Returns: { type: 'spark_address', address: 'sp1qw3...' }
```

<br>

## State Management

### Wallet Store (`stores/wallet.js`)

Central store for all wallet operations.

**State**
```javascript
{
  wallets: [],           // Array of wallet objects
  activeWalletId: null,  // Currently selected wallet
  sessionPin: null,      // PIN for current session (Spark only)
  balances: {},          // Cached balances by wallet ID
  isLoading: false,
  error: null
}
```

**Key Actions**
```javascript
// Wallet management
addSparkWallet({ mnemonic, pin, name, network })
addNWCWallet({ nwcUrl, name })
removeWallet(walletId)
setActiveWallet(walletId)

// Spark security
unlockSparkWallet(pin)           // Decrypt mnemonic, cache PIN
getDecryptedMnemonic(walletId)   // Requires unlocked state

// Wallet operations
getWalletProvider(walletId)      // Returns initialized provider
refreshBalance(walletId)
```

**Getters**
```javascript
activeWallet          // Current wallet object
activeBalance         // Balance for active wallet
isActiveWalletSpark   // Boolean check
activeSparkAddress    // Spark address (if Spark wallet)
hasSparkWallet        // Whether any Spark wallet exists
```

### AddressBook Store (`stores/addressBook.js`)

Manages saved contacts.

**State**
```javascript
{
  entries: [],         // Contact objects
  searchQuery: ''      // Filter string
}
```

**Entry Structure**
```javascript
{
  id: 'addr-123...',
  name: 'Alice',
  address: 'alice@wallet.com',      // Universal field
  addressType: 'lightning',         // 'lightning' or 'spark'
  lightningAddress: 'alice@...',    // Backward compatibility
  color: '#3B82F6',
  createdAt: 1699999999999,
  updatedAt: 1699999999999
}
```

**Key Actions**
```javascript
addEntry({ name, address, addressType, color })
updateEntry(id, updateData)
deleteEntry(id)
importEntries(entries)    // Bulk import with validation

// Validation helpers
isValidAddress(address, type)
isValidLightningAddress(address)
isValidSparkAddress(address)
detectAddressType(address)
```

<br>

## Key Components

For user-facing documentation on these features, see [Sending Bitcoin](Guide.md#sending-bitcoin) and [Receiving Bitcoin](Guide.md#receiving-bitcoin) in the User Guide.

### SendModal.vue

Handles payment input and QR scanning.

**Key Features**
- Camera-based QR scanning with `qr-scanner` library
- Automatic payment type detection
- Contact picker with wallet compatibility filtering
- Clipboard paste support

**Payment Detection Logic**
```javascript
determinePaymentType(input) {
  if (input.startsWith('sp1') || input.startsWith('tsp1')) {
    return { type: 'spark_address', sparkAddress: input }
  }
  if (input.startsWith('lnbc') || input.startsWith('lntb')) {
    return { type: 'lightning_invoice', invoice: input }
  }
  if (input.includes('@')) {
    return { type: 'lightning_address', address: input }
  }
  // ... LNURL handling
}
```

### PaymentModal.vue

Confirmation dialog before sending payments.

**Key Features**
- Shows payment details (recipient, amount, fees)
- Wallet compatibility warnings (Spark required for Spark addresses)
- Calls appropriate provider method based on payment type

### ReceiveModal.vue

Generates invoices and displays receive addresses.

**Key Features**
- Toggle between Lightning invoice and Spark address (Spark wallets)
- QR code generation with `@chenfengyuan/vue-qrcode`
- Copy and share functionality
- Invoice expiry countdown

### PinEntryDialog.vue

Numeric PIN input for Spark wallet security.

**Key Features**
- 6-digit PIN with visual feedback
- Confirm mode for new PIN setup
- Numpad interface with delete button

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
4. Add wallet creation flow in appropriate page
5. Update wallet store with new add method

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

All components should support both themes using Quasar's dark mode detection:

```vue
<template>
  <q-card :class="$q.dark.isActive ? 'card_dark_style' : 'card_light_style'">
    <q-btn :class="$q.dark.isActive ? 'dialog_add_btn_dark' : 'dialog_add_btn_light'">
      Submit
    </q-btn>
  </q-card>
</template>
```

### Common Class Reference

| Purpose | Dark Class | Light Class |
|---------|------------|-------------|
| Card container | `card_dark_style` | `card_light_style` |
| Primary button | `dialog_add_btn_dark` | `dialog_add_btn_light` |
| Secondary button | `more_btn_dark` | `more_btn_light` |
| Dialog backdrop | `dailog_dark` | `dailog_light` |
| Text input | `add_wallet_textbox_dark` | `add_wallet_textbox_light` |
| Back button | `back_btn_dark` | `back_btn_light` |
| Page title | `main_page_title_dark` | `main_page_title_light` |

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
| Buttons | 24px |
| Inputs | 20px |
| Menus | 16px |
| Back buttons | 10px |

<br>

## Testing

Review the [User Guide](Guide.md) to understand expected user flows before testing.

### Manual Testing Checklist

**Spark Wallet**
- [ ] Create new wallet with seed phrase
- [ ] Verify seed phrase backup flow
- [ ] PIN creation and unlock
- [ ] Create Lightning invoice
- [ ] Pay Lightning invoice
- [ ] Send to Spark address
- [ ] Receive to Spark address
- [ ] View seed phrase (requires PIN)
- [ ] Delete wallet

**NWC Wallet**
- [ ] Connect with valid NWC string
- [ ] Connect with QR scan
- [ ] View balance
- [ ] Create invoice
- [ ] Pay invoice
- [ ] Disconnect wallet
- [ ] Multiple wallets switching

**Address Book**
- [ ] Add Lightning address contact
- [ ] Add Spark address contact
- [ ] Edit contact
- [ ] Delete contact
- [ ] Search contacts
- [ ] Pay from contact (both types)

**Cross-Wallet**
- [ ] NWC cannot pay Spark addresses (shows warning)
- [ ] Spark can pay Lightning addresses
- [ ] Wallet switching maintains state

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

For user-facing security information and best practices, see [Security](README.md#security) in the README.

### Spark Mnemonic Encryption

Mnemonics are encrypted using Web Crypto API:

1. PIN is used to derive key via PBKDF2 (100,000 iterations)
2. Random salt and IV generated for each encryption
3. AES-256-GCM provides authenticated encryption
4. Encrypted data stored as: `salt:iv:ciphertext` (base64)

```javascript
// Encryption flow (simplified)
const keyMaterial = await crypto.subtle.importKey('raw', pinBuffer, 'PBKDF2', false, ['deriveBits', 'deriveKey'])
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
  keyMaterial,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt']
)
const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
```

### Security Best Practices

1. **Never log sensitive data**: No console.log of mnemonics, PINs, or private keys
2. **Clear sensitive state**: Session PIN is memory-only, cleared on app close
3. **Validate all inputs**: Especially payment destinations and amounts
4. **Use constant-time comparisons**: For PIN verification where applicable

<br>

## Environment Configuration

### Quasar Configuration

Key settings in `quasar.config.js`:

```javascript
build: {
  target: { browser: ['es2022'] },
  vueRouterMode: 'history'
}
```

### Capacitor (Mobile)

iOS configuration in `src-capacitor/`:

```bash
# Build for iOS
quasar build -m capacitor -T ios

# Open in Xcode
npx cap open ios
```

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

<br>

## Resources

- [Vue.js Documentation](https://vuejs.org/)
- [Quasar Framework](https://quasar.dev/)
- [Pinia State Management](https://pinia.vuejs.org/)
- [Spark SDK](https://github.com/buildonspark/spark-sdk)
- [Alby SDK (NWC)](https://github.com/getAlby/js-sdk)
- [NIP-47 Specification](https://github.com/nostr-protocol/nips/blob/master/47.md)

<br>

## Related Documentation

- [README](README.md) - Project overview, features, and quick start
- [User Guide](Guide.md) - Step-by-step instructions for end users

<br>

*Documentation maintained by the BuhoGO development team.*
