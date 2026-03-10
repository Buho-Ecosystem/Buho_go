# Feature Plan: Multiple Spark Wallets

## Overview

Allow users to create and manage **multiple independent Spark wallets**, each with its own mnemonic, PIN, Spark address, and balance. This is analogous to how users can already add multiple NWC or LNBits wallets.

## Current Limitation

`wallet.js` line 582 enforces a single Spark wallet:
```javascript
if (this.hasSparkWallet) {
  throw new Error('Spark wallet already exists');
}
```

The `hasSparkWallet` getter (line 270) returns `true` if **any** wallet has `type === 'spark'`, blocking a second one.

## Architecture

### What changes

| Component | Current | After |
|-----------|---------|-------|
| `hasSparkWallet` getter | Blocks second Spark wallet | Remove or repurpose — no longer a gate |
| `sparkWallet` getter | Returns single Spark wallet | Remove or deprecate — use `sparkWallets` (array) |
| `addSparkWallet()` | Rejects if one exists | Always allows (no Spark-specific limit) |
| Wallet naming | Hardcoded `'Spark Wallet'` | User-provided name, default `'Spark Wallet 2'` etc. |
| PIN management | Single `sessionPin` for one Spark wallet | Per-wallet PIN or shared PIN (see decision below) |
| SparkSetupPage | Redirects away if Spark exists | Always accessible |

### What stays the same

- Wallet object schema — no changes needed
- `connectionData.encryptedMnemonic` — each wallet stores its own
- Wallet switching via `switchActiveWallet()` — already supports any wallet type
- WalletSwitcher UI — already renders a list, just needs minor tweaks
- Balance tracking, connection states, providers — all keyed by `walletId`, already multi-wallet ready

## Key Decision: PIN Strategy

### Option A: Shared PIN (recommended)
- One PIN unlocks all Spark wallets
- When adding a second Spark wallet, user must enter existing PIN to confirm, then the new mnemonic is encrypted with the same PIN
- Simpler UX, one unlock = all Spark wallets available
- **Tradeoff:** If PIN is compromised, all Spark wallets are exposed

**Recommendation:** Option A. One PIN for all Spark wallets. The mnemonic is the real secret; the PIN is convenience security for the device.

## Implementation Steps

### Phase 1: Remove single-wallet restriction

**wallet.js:**
1. Remove the `hasSparkWallet` check in `addSparkWallet()` (line 582)
2. Add a `sparkWallets` getter that returns all Spark wallets (array)
3. Keep `hasSparkWallet` but rename to `hasAnySparkWallet` for clarity
4. Auto-increment wallet name: `'Spark Wallet'`, `'Spark Wallet 2'`, etc.

### Phase 2: Shared PIN for all Spark wallets

**wallet.js:**
1. When adding a second Spark wallet: encrypt its mnemonic with the existing `sessionPin`
2. If `sessionPin` is not available (locked), prompt user for PIN first
3. On unlock: decrypt all Spark wallets with the same PIN
4. `connectSparkWallet()` already takes `(walletId, pin)` — no change needed
5. Add `connectAllSparkWallets(pin)` convenience method

**PIN change flow:**
1. User changes PIN → re-encrypt ALL Spark wallet mnemonics with new PIN
2. Current `changePin()` must iterate over all Spark wallets

### Phase 3: UI — Setup flow

**SparkSetupPage.vue:**
1. Remove redirect when Spark wallet exists
2. Add "Add another Spark wallet" entry point from Settings or WalletSwitcher
3. If adding a second wallet and session is locked: prompt for PIN first
4. Wallet name input field (with sensible default)

**SparkRestorePage.vue:**
1. Same — allow restore even if a Spark wallet exists
2. User enters mnemonic → system checks it's not a duplicate (compare Spark addresses)
3. Encrypted with existing PIN (shared PIN model)

### Phase 4: UI — Wallet management

**WalletSwitcher.vue:**
1. Already lists all wallets — works as-is
2. Add visual grouping: Spark wallets shown together, then NWC, then LNBits
3. Each Spark wallet shows its own balance and lock state

**Settings.vue:**
1. Spark settings section becomes per-wallet (show settings for active Spark wallet)
2. "Manage Wallets" shows all wallets with delete option
3. Seed phrase backup/view is per-wallet (each has its own mnemonic)
4. Backup status (`hasBackedUp`) becomes per-wallet: `wallet.metadata.hasBackedUp`

### Phase 5: Edge cases

1. **Delete a Spark wallet:** Remove from store, clear provider. If it was the only Spark wallet and user deletes it, `hasAnySparkWallet` returns false → onboarding can show Spark setup again
2. **All Spark wallets locked:** Show PIN prompt once, unlock all
3. **Duplicate mnemonic detection:** On create/restore, derive Spark address and compare against existing wallets. Warn if duplicate.
4. **Auto-withdraw:** Each Spark wallet has independent auto-withdraw config (already per-wallet in `autoWithdraw.js`)
5. **BackupBanner:** Show if ANY Spark wallet is not backed up which has funds

## Data Model — No schema changes

```javascript
// Existing wallet object works as-is for multiple Spark wallets:
{
  id: 'wallet-1709510400000-a1b2c3d4e',
  type: 'spark',
  name: 'Spark Wallet',        // User-changeable
  connectionData: {
    encryptedMnemonic: '...',   // Unique per wallet
    network: 'MAINNET'
  },
  metadata: {
    sparkAddress: 'spark1...',  // Unique per wallet
    cachedBalance: 50000,
    hasBackedUp: false           // NEW: per-wallet backup tracking
  }
}
```

## Migration

- `hasBackedUp` moves from store-level to `wallet.metadata.hasBackedUp`
- On first load after update: copy store-level `hasBackedUp` to the existing Spark wallet's metadata
- No breaking changes to localStorage schema

## Files to modify

| File | Changes |
|------|---------|
| `src/stores/wallet.js` | Remove single-wallet gate, add `sparkWallets` getter, shared PIN logic, `connectAllSparkWallets()`, migrate `hasBackedUp` |
| `src/providers/SparkWalletProvider.js` | No changes needed |
| `src/pages/SparkSetupPage.vue` | Remove Spark-exists redirect, add name input |
| `src/pages/SparkRestorePage.vue` | Allow restore when Spark exists, duplicate detection |
| `src/pages/Settings.vue` | Per-wallet Spark settings, per-wallet backup status |
| `src/components/WalletSwitcher.vue` | Visual grouping by wallet type |
| `src/components/BackupBanner.vue` | Check per-wallet `hasBackedUp` |
| `src/stores/autoWithdraw.js` | Already per-wallet — no changes |

## Estimated scope

- **wallet.js**: Medium — mostly removing restrictions + adding convenience methods
- **UI**: Medium — SparkSetupPage, Settings, WalletSwitcher tweaks
- **Risk**: Low — existing multi-wallet infrastructure (NWC/LNBits) already works, Spark follows the same pattern
