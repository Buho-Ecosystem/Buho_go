# Feature Plan: Spark Accounts (Business / Personal)

## Overview

Allow a single Spark wallet to have **multiple accounts** derived from the same mnemonic using different `accountNumber` values. The primary use case is a merchant who wants separated Business and Personal funds backed by one seed phrase.

**User-facing language:** We call these **"Accounts"** — never "sub-wallets" or "account numbers." Users see "Your Spark Wallet has 2 accounts: Business and Personal." One backup covers everything.

## How it works (Spark SDK)

```javascript
// Same mnemonic, different accountNumber → completely separate wallet
const { wallet } = await SparkWallet.initialize({
  mnemonicOrSeed: mnemonic,
  accountNumber: 1,  // default for mainnet
  options: { network: 'MAINNET' }
});

const { wallet: wallet2 } = await SparkWallet.initialize({
  mnemonicOrSeed: mnemonic,
  accountNumber: 2,
  options: { network: 'MAINNET' }
});
```

**Derivation path:** `m/8797555'/accountNumber'/keyType'`

Each account has its own Identity Key, Spark address, Signing Keys, and balance. No cryptographic link between accounts — they are fully isolated wallets that happen to share a seed.

**Critical:** Mainnet default is `accountNumber: 1`. We must always store and pass this explicitly.

## Relationship to Multiple Spark Wallets

| | Multiple Spark Wallets | Accounts |
|---|---|---|
| **Mnemonics** | Different mnemonic per wallet | Same mnemonic, different `accountNumber` |
| **Backup** | Each wallet needs separate backup | One backup covers all accounts |
| **PIN** | Shared PIN encrypts different mnemonics | Shared PIN, same mnemonic |
| **Identity** | Completely unrelated wallets | Related wallets (same seed family) |
| **Use case** | Separate funds, separate seeds | Business/Personal separation, one seed |

Accounts are a **child concept** of a parent Spark wallet. In the wallet store, a parent Spark wallet can have 1+ accounts.

## UI Design (decided)

### Principle: invisible until needed

- A Spark wallet with **one account** looks exactly like it does today — no "accounts" UI, no extra labels
- The accounts feature only appears when the user explicitly adds a second account
- No migration renames, no forced labels on existing wallets

### WalletSwitcher: expandable parent with account children

When a Spark wallet has 2+ accounts, it becomes expandable in the WalletSwitcher:

```
Wallet Switcher:
┌──────────────────────────────────┐
│ Spark                            │
│                                  │
│ ⚡ Spark Wallet         175k sats│  ← combined balance, tap to expand
│   ┌────────────────────────────┐ │
│   │ 💼 Business     125k sats ✓│ │  ← active account
│   │ 👤 Personal      50k sats  │ │  ← tap to switch
│   └────────────────────────────┘ │
│                                  │
│ ⚡ Spark Wallet 2       30k sats │  ← single account, no expand
│                                  │
│ NWC                              │
│ 🔗 Alby Wallet          80k sats│
└──────────────────────────────────┘
```

**Behavior:**
- Tapping the **parent wallet row** expands/collapses the account list
- Tapping an **account row** switches to it (becomes the active wallet+account)
- The parent shows **combined balance** of all its accounts
- Single-account wallets work exactly like today — no expand, no accounts UI
- The currently active account gets a checkmark

### Main wallet screen: no toggles

The main Wallet.vue screen shows whichever account is active. No pill toggles, no tabs. The wallet name in the header shows context when accounts exist:
- Single account: "Spark Wallet" (like today)
- Multiple accounts: "Spark Wallet — Business"

### Payment context awareness

- **Send confirmation:** "Sending from **Business**"
- **Receive modal:** Shows the active account's Spark address
- **Transaction history:** Filtered by account (transactions are per Spark address)

## Data Model

### Parent Spark wallet with accounts

```javascript
{
  id: 'wallet-1709510400000-a1b2c3d4e',
  type: 'spark',
  name: 'Spark Wallet',
  connectionData: {
    encryptedMnemonic: '...',
    network: 'MAINNET',
    accountNumber: 1  // the primary account number
  },
  metadata: {
    hasBackedUp: true,
    sparkAddress: 'spark1abc...',  // primary account address
    cachedBalance: 125000,         // primary account balance
    // NEW: additional accounts (only present when user adds accounts)
    accounts: [
      {
        accountNumber: 2,
        name: 'Personal',
        sparkAddress: 'spark1xyz...',
        cachedBalance: 50000,
        balanceUpdatedAt: 1709510400000
      }
    ],
    activeAccountNumber: 1  // which account is currently selected
  }
}
```

### Design decisions

- **No migration for existing wallets.** The primary account (accountNumber 1) uses the existing fields (`sparkAddress`, `cachedBalance`). The `accounts` array only appears when a second account is added.
- **`accounts` array stores only additional accounts.** The primary account data stays in its original location — zero risk of breaking existing functionality.
- **`activeAccountNumber`** defaults to `connectionData.accountNumber` (the primary). Only set explicitly when accounts exist.

### Why not separate wallet objects?

Accounts share a mnemonic. If they were separate wallet objects:
- Each would store a copy of `encryptedMnemonic` — redundant and fragile
- PIN change would need to find and update all related wallets
- Backup status would be inconsistent
- The "one seed = one backup" benefit would be invisible to the user

By nesting accounts inside the parent, the relationship is explicit.

## Implementation Phases

### Phase 1: Account infrastructure (store logic)

**wallet.js:**
1. Add `addAccount(walletId, name)` method
   - Decrypt mnemonic, init provider with next `accountNumber`, get Spark address
   - Push to `wallet.metadata.accounts` array
   - Set `activeAccountNumber` if not already set
2. Add `switchAccount(walletId, accountNumber)` method
   - Set `wallet.metadata.activeAccountNumber`
   - Swap the active provider reference
   - Update balance display
3. Add `removeAccount(walletId, accountNumber)` method
   - Only if balance is 0 (or user confirms)
   - Cannot remove the primary account
4. Provider keying: store providers as `walletId:accountNumber`
5. Balance tracking: `balances[walletId:accountNumber]` for additional accounts
6. `connectSparkWallet()`: also connect additional accounts when PIN available
7. Getters:
   - `activeAccountNumber(walletId)` — returns active account number
   - `walletAccounts(walletId)` — returns all accounts (primary + additional)
   - `hasAccounts(walletId)` — true if wallet has 2+ accounts
   - `combinedBalance(walletId)` — sum of all account balances

**SparkWalletProvider.js:**
- Already supports `accountNumber` from the multi-wallet implementation. No changes needed.

### Phase 2: WalletSwitcher — expandable accounts

**WalletSwitcher.vue:**
1. For wallets with `hasAccounts`: show expand/collapse chevron
2. On expand: render account rows indented under the parent
3. Parent row shows combined balance
4. Account row shows individual balance + checkmark for active
5. Tapping account row calls `switchAccount()` and closes switcher
6. Tapping parent row toggles expand (does NOT switch wallet)
7. Single-account wallets: no chevron, tap switches wallet like today

### Phase 3: Wallet header context

**Wallet.vue:**
1. When active Spark wallet has accounts: show "Wallet Name — Account Name" in header
2. Single-account wallets: show just "Wallet Name" (no change)

### Phase 4: Account management (Settings)

**Settings.vue:**
1. New "Accounts" section under Spark wallet settings (only visible when accounts exist or as "Add Account" entry point)
2. List accounts with name, Spark address (truncated), balance
3. "Add Account" button → name input (default: "Personal") → creates
4. Edit account name (inline)
5. Delete account (only if balance is 0, cannot delete primary)
6. Backup section: "This seed phrase covers all accounts in this wallet"

### Phase 5: Context awareness

1. **Send confirmation:** "Sending from **Business**" (show account name when accounts exist)
2. **Receive modal:** Show active account's Spark address
3. **Auto-withdraw:** Per-account config (key by `walletId:accountNumber`)

### Phase 6: Internal transfers (nice-to-have, can come later)

Free Spark-to-Spark transfers between accounts:
```javascript
await businessProvider.transferToSparkAddress(personalSparkAddress, amount);
```
Add a "Transfer between accounts" shortcut — select source, destination, amount. Zero fee.

## Edge Cases

1. **Restore from seed:** When restoring, we restore the primary account (accountNumber 1). If the user had additional accounts, they can re-add them manually (accounts don't auto-discover — the mnemonic alone doesn't tell us how many accounts existed).
2. **Delete account:** Only allowed if balance is 0. Otherwise show "Transfer funds first." Cannot delete the primary account — delete the whole wallet instead.
3. **Maximum accounts:** Soft limit of 5.
4. **Same-name accounts:** Allowed but warned. Names are cosmetic.
5. **Locked wallet:** All accounts lock/unlock together (same mnemonic, same PIN).
6. **Backup messaging:** "This seed phrase covers all accounts (Business, Personal, ...)."
7. **Delete wallet with accounts:** Deleting the parent wallet removes all its accounts. Warn user with account count.

## Files to modify

| File | Changes |
|------|---------|
| `src/stores/wallet.js` | Account CRUD, provider keying, `switchAccount()`, balance aggregation, getters |
| `src/components/WalletSwitcher.vue` | Expandable parent rows, account sub-rows |
| `src/pages/Wallet.vue` | Header shows "Wallet — Account" when accounts exist |
| `src/pages/Settings.vue` | Account management section |
| `src/components/ReceiveModal.vue` | Show active account's Spark address |
| `src/components/SendModal.vue` | "Sending from [account name]" context |
| `src/stores/autoWithdraw.js` | Per-account config (key by `walletId:accountNumber`) |

## Implementation order

1. **Phase 1** — Store logic. Account CRUD, provider keying, balance tracking.
2. **Phase 2** — WalletSwitcher expandable UI.
3. **Phase 3** — Wallet header context.
4. **Phase 4** — Settings management.
5. **Phase 5** — Context awareness (send/receive).
6. **Phase 6** — Internal transfers (later).

## Resolved decisions

- **Terminology:** "Accounts" (not sub-wallets)
- **UI approach:** WalletSwitcher with expandable parent (not pill toggles)
- **Migration:** None. Feature is invisible until user adds a second account.
- **Default names:** Primary account keeps its name. Second account defaults to "Personal."
- **Colors:** Not in v1. Name-only distinction.
