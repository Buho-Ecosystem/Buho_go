# Spark Wallet Integration - Comprehensive Plan

## Overview

Integrate Spark self-custodial Bitcoin wallet alongside the existing NWC wallet system in BuhoGO. This involves:
1. First-time onboarding flow to choose wallet type
2. Full Spark SDK implementation for Lightning payments
3. Unified UI/UX that harmonizes both wallet types

---

## Research Summary: Spark Wallet

### What is Spark?
- **Bitcoin Layer 2** solution using statechain protocol
- **Self-custodial** - users control their own keys via mnemonic
- **Lightning Network compatible** - send/receive Lightning without running a node
- **Zero-fee transfers** between Spark wallets
- **Unilateral exit** - withdraw to L1 Bitcoin without operator permission

### Spark SDK
```bash
npm install @buildonspark/spark-sdk
```

**Core initialization:**
```typescript
import { SparkWallet } from "@buildonspark/spark-sdk";

const { wallet, mnemonic } = await SparkWallet.initialize({
  mnemonicOrSeed: "optional-existing-mnemonic",
  options: { network: "MAINNET" } // or "REGTEST"
});
```

### Key API Methods

| Category | Methods |
|----------|---------|
| **Core** | `getSparkAddress()`, `getBalance()`, `getIdentityPublicKey()` |
| **Lightning** | `createLightningInvoice()`, `payLightningInvoice()`, `getLightningSendFeeEstimate()` |
| **Transfers** | `transfer()`, `transferTokens()`, `getTransfers()`, `getTransfer()` |
| **Deposits** | `getSingleUseDepositAddress()`, `getStaticDepositAddress()`, `claimDeposit()` |
| **Withdrawals** | `withdraw()`, `getWithdrawalFeeQuote()` |
| **Invoices** | `createSatsInvoice()`, `fulfillSparkInvoice()`, `querySparkInvoices()` |

### Self-Custody Model
- 12/24-word BIP-39 mnemonic for key derivation
- Pre-signed exit transactions for trustless withdrawals
- 1-of-n trust model with FROST threshold signatures
- Perfect forward security for past transactions

---

## Decisions Summary

| Question | Decision |
|----------|----------|
| Mnemonic Security | Encrypted localStorage with PIN (no backend) |
| Backup Verification | Mandatory - verify 3 random words |
| Initial Features | Lightning + Spark-to-Spark transfers (L1 features in future) |
| Persistence | Encrypted local storage, PIN per session |
| **Spark Wallet Limit** | **Only ONE Spark wallet at a time** |
| **Wallet Deletion** | **User can delete wallet and create new one** |

---

## MVP Scope (Lightning + Spark Transfers)

For the initial release, we focus on:
- ✅ Create/restore Spark wallet
- ✅ PIN-encrypted mnemonic storage
- ✅ Mandatory backup verification
- ✅ Lightning invoice creation (receive)
- ✅ Lightning invoice payment (send)
- ✅ Balance display
- ✅ Wallet switching (Spark ↔ NWC)
- ✅ Spark-to-Spark transfers
- ✅ Delete wallet (with confirmation)
- ✅ Only ONE Spark wallet at a time
- ❌ L1 Bitcoin deposits (future)
- ❌ L1 Bitcoin withdrawals (future)
- ❌ Token support (future)

---

## Current Architecture Analysis

### Existing Wallet System
- **Store**: `/src/stores/wallet.js` - Pinia store, already supports multiple wallets
- **Service**: `/src/utils/lightning.js` - Payment processing, wallet-agnostic
- **UI**: `/src/pages/Wallet.vue` - Main wallet page
- **Onboarding**: `/src/pages/IndexPage.vue` - NWC connection flow

### Key Insight: Architecture Already Supports Multiple Wallet Types
The current system uses:
- Wallet objects with `id`, `type`, `name`, `connectionData`, `metadata`
- Separate `balances{}` and `connectionStates{}` keyed by wallet ID
- `LightningPaymentService` class that accepts connection in constructor
- Wallet switcher component for multiple wallets

---

## Implementation Plan

### Phase 1: Onboarding Flow (First-Time User Experience)

#### 1.1 Create Welcome/Choice Screen
**New File**: `/src/pages/WelcomePage.vue`

```
┌─────────────────────────────────┐
│         [BuhoGO Logo]           │
│                                 │
│    Welcome to BuhoGO            │
│    Your Bitcoin Lightning Wallet│
│                                 │
│  ┌───────────────────────────┐  │
│  │  ⚡ Self-Custody Wallet   │  │
│  │  Full control of your     │  │
│  │  Bitcoin with Spark       │  │
│  │  [Create / Restore]       │  │
│  └───────────────────────────┘  │
│                                 │
│  ┌───────────────────────────┐  │
│  │  🔗 Connect External      │  │
│  │  Link your existing       │  │
│  │  wallet via NWC           │  │
│  │  [Connect Wallet]         │  │
│  └───────────────────────────┘  │
│                                 │
└─────────────────────────────────┘
```

#### 1.2 Spark Wallet Creation Flow
**New File**: `/src/pages/SparkSetupPage.vue`

**Step 1: Create or Restore**
- "Create New Wallet" → Generate mnemonic
- "Restore Existing" → Enter mnemonic

**Step 2: Mnemonic Backup (for new wallets)**
- Display 12/24 words
- Require user to verify 3 random words
- Warning about importance of backup

**Step 3: Set PIN**
- User sets 4-6 digit PIN for encryption
- PIN used to encrypt mnemonic in localStorage

**Step 4: Set Wallet Name**
- Optional custom name (default: "Spark Wallet")

**Step 5: Complete**
- Initialize Spark SDK
- Redirect to main wallet page

#### 1.3 Update Router
**File**: `/src/router/routes.js`

```javascript
const routes = [
  { path: '/', component: () => import('pages/WelcomePage.vue') },
  { path: '/spark-setup', component: () => import('pages/SparkSetupPage.vue') },
  { path: '/nwc-setup', component: () => import('pages/IndexPage.vue') },
  { path: '/wallet', component: () => import('pages/Wallet.vue') },
  // ... existing routes
];
```

#### 1.4 First Launch Detection
**File**: `/src/stores/wallet.js`

```javascript
getters: {
  isFirstLaunch: (state) => state.wallets.length === 0,
  hasSparkWallet: (state) => state.wallets.some(w => w.type === 'spark'),
  hasNWCWallet: (state) => state.wallets.some(w => w.type === 'nwc'),
}
```

---

### Phase 2: Spark Wallet Provider

#### 2.1 Create Wallet Provider Interface
**New File**: `/src/providers/WalletProvider.js`

```javascript
/**
 * Abstract base class for wallet providers
 */
export class WalletProvider {
  async enable() { throw new Error('Not implemented'); }
  async getBalance() { throw new Error('Not implemented'); }
  async getInfo() { throw new Error('Not implemented'); }
  async sendPayment(invoice) { throw new Error('Not implemented'); }
  async createInvoice(amount, description) { throw new Error('Not implemented'); }
  async getTransactions(options) { throw new Error('Not implemented'); }
  close() { throw new Error('Not implemented'); }

  // Spark-specific methods (optional - only implemented by SparkWalletProvider)
  async getSparkAddress() { return null; } // Override in Spark provider
  async transferToSparkAddress(address, amount) { throw new Error('Not supported'); }
  isSparkAddress(address) { return false; }
}
```

#### 2.2 Implement Spark Provider
**New File**: `/src/providers/SparkWalletProvider.js`

```javascript
import { SparkWallet } from '@buildonspark/spark-sdk';
import { WalletProvider } from './WalletProvider';

export class SparkWalletProvider extends WalletProvider {
  constructor() {
    super();
    this.wallet = null;
    this.mnemonic = null;
  }

  /**
   * Initialize new wallet or restore from mnemonic
   */
  async initialize(mnemonic = null, network = 'MAINNET') {
    const result = await SparkWallet.initialize({
      mnemonicOrSeed: mnemonic,
      options: { network }
    });
    this.wallet = result.wallet;
    this.mnemonic = result.mnemonic;
    return { mnemonic: this.mnemonic };
  }

  async enable() {
    if (!this.wallet) throw new Error('Wallet not initialized');
    return true;
  }

  async getBalance() {
    const { balance, tokenBalances } = await this.wallet.getBalance();
    return {
      balance: Number(balance), // Convert bigint to number (sats)
      tokenBalances
    };
  }

  async getInfo() {
    const address = await this.wallet.getSparkAddress();
    const pubkey = await this.wallet.getIdentityPublicKey();
    return {
      alias: 'Spark Wallet',
      pubkey,
      sparkAddress: address,
      network: 'mainnet',
      methods: ['pay_invoice', 'make_invoice', 'get_balance', 'get_info']
    };
  }

  async getSparkAddress() {
    return await this.wallet.getSparkAddress();
  }

  // Spark-to-Spark Transfers (Zero-fee) - MVP
  async transferToSparkAddress(sparkAddress, amountSats) {
    const result = await this.wallet.transfer({
      receiverSparkAddress: sparkAddress,
      amountSats: amountSats
    });

    return {
      transferId: result.id,
      amount: amountSats,
      status: result.status,
      fee: 0 // Zero fee for Spark-to-Spark
    };
  }

  // Check if address is a Spark address
  isSparkAddress(address) {
    // Spark addresses start with 'sp1' (mainnet) or 'tsp1' (testnet)
    return address && (address.startsWith('sp1') || address.startsWith('tsp1'));
  }

  // Lightning Operations (MVP Focus)
  async createInvoice(amountSats, description) {
    const invoice = await this.wallet.createLightningInvoice({
      amountSats: amountSats,
      memo: description
    });
    return {
      payment_request: invoice.invoice,
      payment_hash: invoice.id,
      amount: amountSats,
      description,
      status: invoice.status
    };
  }

  async payInvoice(bolt11Invoice, maxFeeSats = 100) {
    // Get fee estimate first
    const feeEstimate = await this.wallet.getLightningSendFeeEstimate({
      encodedInvoice: bolt11Invoice
    });

    // Pay the invoice
    const result = await this.wallet.payLightningInvoice({
      invoice: bolt11Invoice,
      maxFeeSats: maxFeeSats
    });

    return {
      preimage: result.preimage,
      payment_hash: result.id,
      fee: feeEstimate,
      status: result.status
    };
  }

  // Event handling for incoming payments
  setupPaymentListener(callback) {
    this.wallet.on('transfer:claimed', (transferId, updatedBalance) => {
      callback({
        type: 'payment_received',
        transferId,
        newBalance: Number(updatedBalance)
      });
    });
  }

  async getTransactions(options = {}) {
    const transfers = await this.wallet.getTransfers({
      limit: options.limit || 50,
      offset: options.offset || 0
    });
    return transfers;
  }

  close() {
    if (this.wallet) {
      this.wallet.cleanupConnections();
    }
  }
}
```

#### 2.3 Implement NWC Provider (Refactor Existing)
**New File**: `/src/providers/NWCWalletProvider.js`

```javascript
import { NostrWebLNProvider } from '@getalby/sdk';
import { WalletProvider } from './WalletProvider';

export class NWCWalletProvider extends WalletProvider {
  constructor(nwcUrl) {
    super();
    this.nwcUrl = nwcUrl;
    this.nwc = null;
  }

  async enable() {
    this.nwc = new NostrWebLNProvider({
      nostrWalletConnectUrl: this.nwcUrl
    });
    await this.nwc.enable();
    return true;
  }

  async getBalance() {
    const result = await this.nwc.getBalance();
    return { balance: result.balance };
  }

  async getInfo() {
    return await this.nwc.getInfo();
  }

  async createInvoice(amountSats, description, expiry = 3600) {
    return await this.nwc.makeInvoice({
      amount: amountSats,
      description,
      expiry
    });
  }

  async payInvoice(bolt11Invoice) {
    return await this.nwc.sendPayment(bolt11Invoice);
  }

  async getTransactions(options = {}) {
    return await this.nwc.listTransactions(options);
  }

  close() {
    if (this.nwc) {
      this.nwc.close();
    }
  }
}
```

#### 2.4 Wallet Factory
**New File**: `/src/providers/WalletFactory.js`

```javascript
import { SparkWalletProvider } from './SparkWalletProvider';
import { NWCWalletProvider } from './NWCWalletProvider';

export class WalletFactory {
  static create(type, config) {
    switch (type) {
      case 'spark':
        return new SparkWalletProvider();
      case 'nwc':
        return new NWCWalletProvider(config.nwcUrl);
      default:
        throw new Error(`Unknown wallet type: ${type}`);
    }
  }
}
```

---

### Phase 3: Update Wallet Store

#### 3.1 Extended Wallet Object Structure
**File**: `/src/stores/wallet.js`

```javascript
// Wallet object now includes type
wallet = {
  id: 'wallet-xxx',
  type: 'spark' | 'nwc',
  name: 'My Spark Wallet',
  isActive: boolean,
  isDefault: boolean,
  createdAt: timestamp,
  lastUsed: timestamp,

  // Type-specific data
  connectionData: {
    // For NWC:
    nwcUrl: 'nostr+walletconnect://...',

    // For Spark:
    encryptedMnemonic: '...', // Encrypted with user PIN
    network: 'MAINNET'
  },

  metadata: {
    alias: string,
    pubkey: string,
    sparkAddress: string, // Only for Spark
    network: string,
    methods: string[],
    lud16: string // Lightning address (NWC only)
  }
}
```

#### 3.2 New Store Actions
```javascript
actions: {
  // Add Spark wallet
  async addSparkWallet(walletData) {
    const provider = new SparkWalletProvider();
    const { mnemonic } = await provider.initialize(
      walletData.mnemonic,
      walletData.network || 'MAINNET'
    );

    const info = await provider.getInfo();
    const { balance } = await provider.getBalance();

    const wallet = {
      id: this.generateWalletId(),
      type: 'spark',
      name: walletData.name || 'Spark Wallet',
      isActive: this.wallets.length === 0,
      isDefault: this.wallets.length === 0,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      connectionData: {
        encryptedMnemonic: await this.encryptMnemonic(mnemonic, walletData.pin),
        network: walletData.network || 'MAINNET'
      },
      metadata: {
        alias: info.alias,
        pubkey: info.pubkey,
        sparkAddress: info.sparkAddress,
        network: info.network,
        methods: info.methods
      }
    };

    this.wallets.push(wallet);
    this.balances[wallet.id] = balance;
    this.connectionStates[wallet.id] = {
      connected: true,
      provider: provider
    };

    if (wallet.isActive) {
      this.activeWalletId = wallet.id;
    }

    await this.persistState();
    return { wallet, mnemonic }; // Return mnemonic for backup
  },

  // Get provider for any wallet type
  async getWalletProvider(walletId, pin = null) {
    const wallet = this.wallets.find(w => w.id === walletId);
    if (!wallet) throw new Error('Wallet not found');

    // Check if already connected
    if (this.connectionStates[walletId]?.provider) {
      return this.connectionStates[walletId].provider;
    }

    // Create new provider
    const provider = WalletFactory.create(wallet.type, wallet.connectionData);

    if (wallet.type === 'spark') {
      if (!pin) throw new Error('PIN required for Spark wallet');
      const mnemonic = await this.decryptMnemonic(wallet.connectionData.encryptedMnemonic, pin);
      await provider.initialize(mnemonic, wallet.connectionData.network);
    }

    await provider.enable();

    this.connectionStates[walletId] = {
      connected: true,
      provider: provider
    };

    return provider;
  },

  // Encrypt mnemonic with PIN using Web Crypto API
  async encryptMnemonic(mnemonic, pin) {
    const encoder = new TextEncoder();
    const data = encoder.encode(mnemonic);

    // Derive key from PIN
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(pin),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    // Combine salt + iv + encrypted data
    const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encrypted), salt.length + iv.length);

    return btoa(String.fromCharCode(...result));
  },

  async decryptMnemonic(encryptedBase64, pin) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const encrypted = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));

    const salt = encrypted.slice(0, 16);
    const iv = encrypted.slice(16, 28);
    const data = encrypted.slice(28);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(pin),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    return decoder.decode(decrypted);
  }
}
```

---

### Phase 4: Update Payment Service

#### 4.1 Unified Payment Service
**File**: `/src/utils/lightning.js`

Update `LightningPaymentService` to work with any provider:

```javascript
export class LightningPaymentService {
  constructor(provider) {
    this.provider = provider;
  }

  // All existing methods now delegate to provider
  async sendPayment(paymentData) {
    // Handle Spark-to-Spark transfers (zero-fee)
    if (paymentData.type === 'spark_address') {
      if (!this.provider.transferToSparkAddress) {
        throw new Error('Current wallet does not support Spark transfers');
      }
      return await this.provider.transferToSparkAddress(
        paymentData.sparkAddress,
        paymentData.amount
      );
    }

    // Handle Lightning invoices
    if (paymentData.type === 'lightning_invoice') {
      return await this.provider.payInvoice(paymentData.invoice);
    }
    // Handle other types...
  }

  // Check if destination is a Spark address
  isSparkAddress(address) {
    return this.provider.isSparkAddress?.(address) || false;
  }

  async createInvoice(amount, description, expiry) {
    return await this.provider.createInvoice(amount, description, expiry);
  }

  async getBalance() {
    return await this.provider.getBalance();
  }

  // Get Spark address for receiving (Spark wallets only)
  async getSparkAddress() {
    if (!this.provider.getSparkAddress) {
      return null;
    }
    return await this.provider.getSparkAddress();
  }
}
```

#### 4.2 SendModal Updates for Spark Addresses
**File**: `/src/components/SendModal.vue`

Add Spark address detection and routing:

```javascript
// In parsePaymentData method
parsePaymentData(input) {
  const cleanData = input.trim();

  // Check for Spark address (sp1... or tsp1...)
  if (cleanData.startsWith('sp1') || cleanData.startsWith('tsp1')) {
    return {
      type: 'spark_address',
      sparkAddress: cleanData,
      amount: null, // User must enter amount
      isZeroFee: true // Highlight zero-fee benefit
    };
  }

  // Existing Lightning invoice detection...
  if (cleanData.startsWith('lnbc') || cleanData.startsWith('lntb')) {
    // ... existing logic
  }

  // ... rest of existing logic
}
```

#### 4.3 ReceiveModal Updates for Spark Address
**File**: `/src/components/ReceiveModal.vue`

For Spark wallets, show both options:
- Lightning Invoice QR (for receiving from any Lightning wallet)
- Spark Address QR (for receiving from other Spark wallets, zero-fee)

```javascript
// Add toggle or tabs in ReceiveModal
data() {
  return {
    receiveMode: 'lightning', // 'lightning' | 'spark'
    sparkAddress: null
  }
},

async mounted() {
  // Fetch Spark address if available
  if (this.walletType === 'spark') {
    this.sparkAddress = await this.provider.getSparkAddress();
  }
}
```

---

### Phase 5: UI Updates

#### 5.1 Wallet Type Badge/Icon
Show wallet type in UI with appropriate icon:
- Spark: ⚡ (self-custody badge)
- NWC: 🔗 (connected badge)

#### 5.2 Spark-Specific Features in Settings
- View Spark address
- View/export mnemonic (with PIN verification)
- Change PIN

#### 5.3 Update Wallet Switcher
Show wallet type indicator for each wallet.

#### 5.4 PIN Entry Dialog
**New Component**: `/src/components/PinEntryDialog.vue`
- 4-6 digit PIN entry
- Used when opening Spark wallet each session
- Used when viewing mnemonic in settings

---

## File Structure

```
src/
├── providers/
│   ├── WalletProvider.js          # Abstract base class
│   ├── SparkWalletProvider.js     # Spark implementation
│   ├── NWCWalletProvider.js       # NWC implementation
│   └── WalletFactory.js           # Factory for creating providers
├── pages/
│   ├── WelcomePage.vue            # NEW: First-time choice screen
│   ├── SparkSetupPage.vue         # NEW: Spark wallet creation/restore
│   ├── IndexPage.vue              # MODIFY: NWC connection (rename to NWCSetupPage?)
│   └── Wallet.vue                 # MODIFY: Support both wallet types
├── stores/
│   └── wallet.js                  # MODIFY: Add Spark support, wallet types
├── utils/
│   └── lightning.js               # MODIFY: Use provider pattern
└── components/
    ├── WalletSwitcher.vue         # MODIFY: Show wallet type
    ├── ReceiveModal.vue           # MODIFY: Works with both wallet types
    ├── PinEntryDialog.vue         # NEW: PIN entry for Spark wallets
    └── MnemonicBackup.vue         # NEW: Mnemonic display/verification
```

---

## Dependencies

```json
{
  "dependencies": {
    "@buildonspark/spark-sdk": "^latest",
    "@getalby/sdk": "existing"
  }
}
```

---

## Security Considerations

### Implementation:
- Use Web Crypto API for AES-256-GCM encryption
- PBKDF2 with 100,000 iterations for key derivation from PIN
- Random salt and IV for each encryption
- Clear decrypted mnemonic from memory after wallet initialization
- Show mnemonic in settings only after PIN re-entry
- No backend required - all data in encrypted localStorage or in best case stored offline as backup from user.

---

## Verification Checklist

### Onboarding
- [ ] First launch shows WelcomePage with two options
- [ ] three pages onboarding for Spark wallet. with nice svgs and best UX practices for onboarding flow. VERY IMPORTANT.
- [ ] Spark setup creates wallet and shows mnemonic
- [ ] Mnemonic backup verification works (verify 3 random words)
- [ ] Restore from mnemonic works
- [ ] PIN setup and encryption works
- [ ] NWC setup still works as before
- [ ] Redirect to wallet page after setup

### Spark Wallet Operations
- [ ] Balance displays correctly
- [ ] Create Lightning invoice works
- [ ] Pay Lightning invoice works
- [ ] **Spark-to-Spark transfer works (zero-fee)**
- [ ] **SendModal detects Spark addresses automatically**
- [ ] **Spark address shown in receive modal**
- [ ] Transaction history loads
- [ ] PIN required on app launch for Spark wallet

### UI/UX
- [ ] Wallet type shown in wallet badge
- [ ] Wallet switcher shows both wallet types
- [ ] Settings show wallet-type-specific options
- [ ] Dark/light mode works for all new components

### Coexistence
- [ ] Will/Can have both Spark and NWC wallets
- [ ] Switching between them works
- [ ] Each wallet type uses correct provider
- [ ] Balances tracked separately

---

## Implementation Order

1. **Phase 1**: Onboarding flow (WelcomePage, SparkSetupPage, MnemonicBackup, PinEntryDialog)
2. **Phase 2**: Provider abstraction (WalletProvider, SparkWalletProvider, NWCWalletProvider, WalletFactory)
3. **Phase 3**: Store updates (wallet.js with type support, encryption)
4. **Phase 4**: Payment service updates (lightning.js)
5. **Phase 5**: UI updates (badges, wallet switcher, settings)
6. **Phase 6**: Testing & polish

---

## Future Enhancements (Post-MVP)

- L1 Bitcoin deposits (show deposit address)
- L1 Bitcoin withdrawals (with fee quotes)
- Token support (TETHER only)
- Biometric authentication (fingerprint/face)
