# NWC Connection Refactor Plan

## The Problem

BuhoGO opens **10+ simultaneous WebSocket connections** to the same NWC relay (e.g. `wss://relay.getalby.com/v1`). This causes rate limiting, failed requests ("no info event kind 13194"), and unreliable wallet behavior.

**Root cause:** 7 out of 9 NWC connection points create throwaway `NostrWebLNProvider` instances that are never closed and never reuse the store's existing connection.

---

## Current State: Where Connections Are Created

### Stored (reusable) - 2 locations
| Location | Line | Stored in | Closed properly? |
|----------|------|-----------|-----------------|
| `wallet.js` addWallet() | 997 | `connectionStates[walletId].nwcInstance` | Yes (on disconnect) |
| `wallet.js` connectWallet() | 1371 | `connectionStates[walletId].nwcInstance` | Yes (on disconnect) |

### Throwaway (leaked) - 7 locations
| Location | Line | Used for | Closed? |
|----------|------|----------|---------|
| `Wallet.vue` updateWalletBalance() | 1770 | getBalance() | **NO** |
| `TransactionHistory.vue` loadMore() | 1147 | listTransactions() | **NO** |
| `TransactionDetails.vue` fetchNWCTransaction() | 778 | listTransactions() | **NO** |
| `ReceiveModal.vue` getPaymentMonitoringProvider() | 661 | payment monitoring | **NO** |
| `ReceiveModal.vue` generateInvoice() | 989 | makeInvoice() | **NO** |
| `PaymentModal.vue` sendNWCPayment() | 575 | sendPayment() (via LightningPaymentService) | **NO** |
| `Wallet.vue` (via LightningPaymentService) | multiple | LNURL handling | **NO** |

---

## The Fix: Central NWC Connection Manager

### Principle
One NWC WebSocket per wallet. All components share it via the store.

### Step 1: Add a getter to wallet.js

The store already has `connectionStates[walletId].nwcInstance` and getter methods (`getActiveNWCInstance`, `getNWCInstance`). These need to be the **only** way components access NWC.

```js
// Already exists but underused:
getActiveNWCInstance() → returns connectionStates[activeWalletId].nwcInstance
getNWCInstance(walletId) → returns connectionStates[walletId].nwcInstance
```

No new store code needed. The getters exist. The problem is that components ignore them.

### Step 2: Replace throwaway instances in components

Each throwaway `new NostrWebLNProvider(...)` + `.enable()` gets replaced with the store's instance:

#### Wallet.vue - updateWalletBalance() (line 1770)
```
BEFORE: const nwc = new NostrWebLNProvider({...}); await nwc.enable();
AFTER:  const nwc = this.walletStore.getActiveNWCInstance();
        if (!nwc) return; // not connected
```

#### TransactionHistory.vue - loadMore() (line 1147)
```
BEFORE: const nwc = new NostrWebLNProvider({...}); await nwc.enable();
AFTER:  const nwc = this.walletStore.getActiveNWCInstance();
        if (!nwc) { /* show reconnect prompt */ return; }
```

#### TransactionDetails.vue - fetchNWCTransaction() (line 778)
```
BEFORE: const nwc = new NostrWebLNProvider({...}); await nwc.enable();
AFTER:  const nwc = this.walletStore.getActiveNWCInstance();
        if (!nwc) { /* show error */ return; }
```

#### ReceiveModal.vue - generateInvoice() (line 989)
```
BEFORE: const nwc = new NostrWebLNProvider({...}); await nwc.enable();
AFTER:  const nwc = this.walletStore.getActiveNWCInstance();
        if (!nwc) { /* show error */ return; }
```

#### ReceiveModal.vue - getPaymentMonitoringProvider() (line 661)
```
BEFORE: rawProvider = new NostrWebLNProvider({...}); await rawProvider.enable();
AFTER:  rawProvider = this.walletStore.getActiveNWCInstance();
```

#### PaymentModal.vue - sendNWCPayment() (line 575)
```
BEFORE: const lightningService = new LightningPaymentService(activeWallet.nwcString);
AFTER:  Use store's NWC instance directly for sendPayment()
        OR pass the existing nwcInstance to LightningPaymentService instead of URL
```

### Step 3: LightningPaymentService refactor

This class creates its own `NostrWebLNProvider` in the constructor. Two options:

**Option A (minimal):** Accept an existing NWC instance instead of a URL string:
```js
constructor(nwcOrUrl) {
  if (typeof nwcOrUrl === 'string') {
    this.nwc = new NostrWebLNProvider({ nostrWalletConnectUrl: nwcOrUrl });
    this.ownsConnection = true;
  } else {
    this.nwc = nwcOrUrl;
    this.ownsConnection = false;
  }
}

close() {
  if (this.ownsConnection && this.nwc) this.nwc.close();
}
```

**Option B (clean):** Remove LightningPaymentService for NWC entirely. It was designed as a wrapper, but the store's NWC instance can do everything directly. Only keep it for LNURL processing which doesn't need an NWC connection.

**Recommendation:** Option A is safer. Less refactoring, no risk of breaking LNURL flows.

### Step 4: Proper cleanup

Add `.close()` calls where connections are replaced:

```js
// In connectWallet() before creating new instance:
const existingNwc = this.connectionStates[walletId]?.nwcInstance;
if (existingNwc) {
  try { existingNwc.close(); } catch {} 
}
```

Add cleanup in component `beforeUnmount()` hooks for any local references (though they won't need it if sharing the store's instance).

### Step 5: Reconnection handling

When a shared NWC instance loses connection (relay drops WebSocket), the store should:
1. Detect the disconnection (NWC SDK emits events or throws on next call)
2. Set `connectionStates[walletId].connected = false`
3. Attempt one reconnect with backoff
4. If reconnect fails, show a toast: "Wallet disconnected. Tap to reconnect."

This replaces the current behavior where each component independently tries to create a new connection (causing the spam).

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/stores/wallet.js` | Close old instance before creating new in connectWallet(). Add reconnect logic. |
| `src/pages/Wallet.vue` | Replace `new NostrWebLNProvider` in updateWalletBalance() with store getter |
| `src/pages/TransactionHistory.vue` | Replace `new NostrWebLNProvider` in loadMore() with store getter |
| `src/pages/TransactionDetails.vue` | Replace `new NostrWebLNProvider` in fetchNWCTransaction() with store getter |
| `src/components/ReceiveModal.vue` | Replace both `new NostrWebLNProvider` calls with store getter |
| `src/components/PaymentModal.vue` | Pass store's NWC instance to LightningPaymentService |
| `src/utils/lightning.js` | Accept existing NWC instance in constructor (Option A) |

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Shared instance gets closed by one component | All components lose connection | Only the store manages lifecycle. Components never call `.close()` |
| Store instance not ready when component needs it | Component gets null | Always check `if (!nwc) return` with user-friendly fallback |
| Concurrent calls on same instance | NWC SDK handles this (NIP-47 is request/response) | No action needed |
| Relay temporarily down | Single connection fails, affects everything | Reconnect logic with backoff in store |

---

## Migration Path

1. **Phase 1:** Fix the leaks. Add `.close()` after use for all throwaway instances. This alone will cut connections from 10+ to ~3.
2. **Phase 2:** Replace throwaway instances with store getter. Cuts to 1 connection per wallet.
3. **Phase 3:** Add reconnection handling in store for robustness.

Phase 1 can ship immediately as a quick win. Phase 2 is the real fix. Phase 3 is polish.

---

## Phase 1: Quick Win — Close Throwaway Instances

Minimal changes. Add `try { nwc.close() } catch {}` after every throwaway usage. No architecture changes, no new patterns. Just stop leaking WebSockets.

### 1. Wallet.vue — updateWalletBalance() (line ~1770)

```js
// BEFORE:
const nwc = new NostrWebLNProvider({ nostrWalletConnectUrl: activeWallet.nwcString });
await nwc.enable();
const balance = await nwc.getBalance();
// nwc is never closed

// AFTER:
const nwc = new NostrWebLNProvider({ nostrWalletConnectUrl: activeWallet.nwcString });
try {
  await nwc.enable();
  const balance = await nwc.getBalance();
  // ... use balance ...
} finally {
  try { nwc.close(); } catch {}
}
```

### 2. TransactionHistory.vue — loadMore() (line ~1147)

```js
// BEFORE:
const nwc = new NostrWebLNProvider({ nostrWalletConnectUrl: activeWallet.nwcString });
await nwc.enable();
const txResponse = await nwc.listTransactions({ ... });
// nwc is never closed

// AFTER:
const nwc = new NostrWebLNProvider({ nostrWalletConnectUrl: activeWallet.nwcString });
try {
  await nwc.enable();
  const txResponse = await nwc.listTransactions({ ... });
  // ... process transactions ...
} finally {
  try { nwc.close(); } catch {}
}
```

### 3. TransactionDetails.vue — fetchNWCTransaction() (line ~778)

```js
// BEFORE:
const nwc = new NostrWebLNProvider({ nostrWalletConnectUrl: activeWallet.nwcString });
await nwc.enable();
const txResponse = await nwc.listTransactions({ ... });
// nwc is never closed

// AFTER:
const nwc = new NostrWebLNProvider({ nostrWalletConnectUrl: activeWallet.nwcString });
try {
  await nwc.enable();
  const txResponse = await nwc.listTransactions({ ... });
  // ... find transaction ...
} finally {
  try { nwc.close(); } catch {}
}
```

### 4. ReceiveModal.vue — generateInvoice() (line ~989)

```js
// BEFORE:
const nwc = new NostrWebLNProvider({ nostrWalletConnectUrl: activeWallet.nwcString });
await nwc.enable();
const invoice = await nwc.makeInvoice({ ... });
// nwc is never closed

// AFTER:
const nwc = new NostrWebLNProvider({ nostrWalletConnectUrl: activeWallet.nwcString });
try {
  await nwc.enable();
  const invoice = await nwc.makeInvoice({ ... });
  // ... use invoice ...
} finally {
  try { nwc.close(); } catch {}
}
```

### 5. ReceiveModal.vue — getPaymentMonitoringProvider() (line ~661)

This one is trickier because the connection is used for ongoing monitoring. Add cleanup in `beforeUnmount` or when monitoring completes:

```js
// In the component's beforeUnmount or modal close handler:
if (this._monitorNwc) {
  try { this._monitorNwc.close(); } catch {}
  this._monitorNwc = null;
}
```

### 6. wallet.js — connectWallet() (line ~1371)

Close the old instance before creating a new one:

```js
// BEFORE:
const nwc = new NostrWebLNProvider({ nostrWalletConnectUrl: wallet.nwcUrl });

// AFTER:
const existingNwc = this.connectionStates[walletId]?.nwcInstance;
if (existingNwc) {
  try { existingNwc.close(); } catch {}
}
const nwc = new NostrWebLNProvider({ nostrWalletConnectUrl: wallet.nwcUrl });
```

### What this achieves

- Connections are closed after each one-off operation
- Old connections are cleaned up before reconnecting
- Cuts active WebSockets from 10+ to ~2-3 at any time
- No architectural changes needed
- Safe to ship immediately

### What this does NOT fix

- Still creates a new WebSocket for every operation (slow, wasteful)
- Still opens a connection just to close it seconds later
- Phase 2 (store getter reuse) is needed for the proper 1-connection-per-wallet solution

---

## Expected Result

- 1 WebSocket connection per NWC wallet (down from 10+)
- No rate limiting from relay
- Faster operations (no connection setup overhead per action)
- Proper cleanup on wallet disconnect/removal
- Reconnection handling when relay drops
