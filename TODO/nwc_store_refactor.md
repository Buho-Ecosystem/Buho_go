# NWC Connection Refactor — Adopt Alby Go's Pattern

## Status

- ✅ **Canonical wrapper exists.** `src/providers/NWCWalletProvider.js` is the proper home for an NWC connection. The store creates one per wallet via `WalletFactory`.
- ⏳ **12 leaky sites.** Five raw `new NostrWebLNProvider(...)` instantiations and seven `new LightningPaymentService(activeWallet.nwcString)` instantiations, each of which spawns its own WebSocket.
- ⏳ **No central error path.** Each call site try/catches independently. iOS-backgrounding edge case isn't handled anywhere today.
- ⏳ **No `ensureNWCConnected()` helper.** `ensureSparkConnected()` (`wallet.js:1868`) and `ensureLNBitsConnected(walletId)` (`wallet.js:1913`) exist; NWC has no equivalent, so a shared-instance fetch after cold start / dropped socket / app resume returns `null` instead of reconnecting transparently.

---

## Why this is a topic

BuhoGO opens 10+ simultaneous WebSocket connections to the same NWC relay (`wss://relay.getalby.com/v1`, etc.) for a single active wallet. Symptoms:

- Relay rate-limits us → `"no info event kind 13194"` errors, failed invoices, intermittent payment failures.
- Every NWC action pays the WebSocket handshake cost (≈ 100–300 ms).
- Reconnection toasts and orphaned subscriptions on background → foreground transitions.

---

## Reference: how Alby Go does it

Alby's own production mobile wallet ([getAlby/go](https://github.com/getAlby/go)) solves this with three pieces:

1. **One `NWCClient` per wallet in the store.** Component code never instantiates.
2. **One central fetcher wrapper** (`lib/createNwcFetcher.ts`) wraps every NWC request, handles the iOS WebSocket-on-background sever, and routes errors through one toast path.
3. **No explicit `.close()` after each call.** The connection lives for the wallet's lifetime; the SDK handles transient drops. On wallet switch they replace the reference and let GC reap the old one.

We mirror this. The full Alby Go references are pinned in the project memory file `reference_alby_go_nwc_pattern.md`.

### Specific patterns to copy verbatim (read after the first pass)

After reading the full source of Alby Go's relevant files, three behaviours are worth lifting beyond the high-level architecture:

**A. `lastAppStateChangeTime` lives in the store, not in a module.**
In `lib/state/appStore.ts` they keep `lastAppStateChangeTime: number` as state and expose `setLastAppStateChangeTime(now)`. The fetcher reads it via `useAppStore.getState().lastAppStateChangeTime` at both call boundaries. Reasons we copy: testable (mockable in unit tests), introspectable via devtools, survives HMR in dev, matches our existing Pinia-state convention.

**B. Receive monitor: capability detect → subscribe-or-poll, with a single `polling` kill switch.**
In `components/CreateInvoice.tsx` the monitor effect:
1. Calls `nwcClient.getWalletServiceInfo()` to inspect `notifications`.
2. If `payment_received` is supported → `subscribeNotifications(handler, ["payment_received"])`. Stores the returned `unsubscribe` callback.
3. Otherwise falls back to a `while (polling) { lookupInvoice(...); sleep 3000 }` loop.
4. The success handler sets `polling = false` and calls `unsubscribe?.()` — same kill switch for both paths.
5. The `useEffect` cleanup function also sets `polling = false` and calls `unsubscribe?.()`.

This is more robust than the "just track the unsub handle" guidance I had originally. We adopt it for `ReceiveModal.vue:1213` (see Step 5e).

**C. Atomic wallet switch — one place owns the replacement.**
`setSelectedWalletId` in `appStore.ts:320-329` calls `set({ selectedWalletId, nwcClient: getNWCClient(selectedWalletId) })` in one shot. The reference is replaced atomically; no in-between state where the active id points at a wallet whose client doesn't exist yet. They don't `.close()` because RN's GC + the SDK clean up the orphaned client. We close explicitly (Capacitor's WebSocket lifecycle is touchier than RN's) but the principle holds: switching active wallet should be one atomic action, not a sequence of `setActiveWalletId(...) → connectWallet(...)` calls that other code might see mid-flight.

---

## Full site inventory (verified)

### Send flows (NWC `payInvoice` / `sendPayment`)

| File | Line | Function | Path today | Action |
|---|---|---|---|---|
| `src/pages/Wallet.vue` | 3379 | `sendNWCPayment` | `new LightningPaymentService(activeWallet.nwcString)` | Pass shared NWC instance |
| `src/components/PaymentModal.vue` | 249 | `sendLightningPayment` (NWC branch) | `new LightningPaymentService(activeWallet.nwcString)` | Pass shared NWC instance |
| `src/components/BatchSendModal.vue` | 1215 | per-recipient send | `new LightningPaymentService(nwcString)` | Pass shared NWC instance |
| `src/stores/wallet.js` | 2226-2229 | `transferBetweenWallets` (internal) | via `NWCWalletProvider.payInvoice` | ✅ already shared |
| `src/stores/autoWithdraw.js` | 273-275 | auto-withdraw | reads `connectionStates[id]?.nwcInstance` | ✅ already shared |

### Receive flows (NWC `makeInvoice`)

| File | Line | Function | Path today | Action |
|---|---|---|---|---|
| `src/pages/Wallet.vue` | 2709 | `createInvoiceForWithdraw` (NWC branch) | `new LightningPaymentService(activeWallet.nwcString)` | Pass shared NWC instance |
| `src/components/ReceiveModal.vue` | 1543 | invoice generation | raw `new NostrWebLNProvider(...)` | Use `runNwc(nwc => nwc.makeInvoice(...))` |
| `src/stores/wallet.js` | 2208 | internal transfer makeInvoice | via `NWCWalletProvider.makeInvoice` | ✅ already shared |

### Payment monitoring (long-lived subscriptions)

| File | Line | Function | Path today | Action |
|---|---|---|---|---|
| `src/components/ReceiveModal.vue` | 1213 | `getPaymentMonitoringProvider` | raw `new NostrWebLNProvider(...)` | Use shared NWC instance via `runNwc({ walletId })`; track `unsub` handle |
| `src/pages/Wallet.vue` | 2843 | monitoring fallback (when no provider) | `new LightningPaymentService(activeWallet.nwcString)` | Reach for shared NWC instance; the fallback should never need to instantiate |
| `src/providers/NWCWalletProvider.js` | 351 | `subscribeNotifications` | uses canonical `this.nwcClient` | ✅ correct |

### Input resolution (LNURL / Lightning Address — DOES NOT NEED NWC)

These four sites parse a string into a payment intent. The current `LightningPaymentService` design spawns an NWC connection in its constructor regardless of whether it's needed.

| File | Line | Function | Action |
|---|---|---|---|
| `src/pages/Wallet.vue` | 3041 | LNURL resolve in scan handler | After `LightningPaymentService` refactor, pass `null` for NWC |
| `src/pages/Wallet.vue` | 3065 | Lightning address resolve | Same |
| `src/components/PaymentModal.vue` | 250 | `processPaymentInput` | Same |
| `src/components/BatchSendModal.vue` | 1216 | `processPaymentInput` | Same |

### Read-only inspection (balance / info / listTransactions)

| File | Line | Function | Path today | Action |
|---|---|---|---|---|
| `src/pages/Wallet.vue` | 2255 | `updateWalletBalance` | raw throwaway | `await runNwc(nwc => nwc.getBalance())` |
| `src/pages/TransactionHistory.vue` | 1305 | `loadMore` | raw throwaway | `await runNwc(nwc => nwc.listTransactions(...))` |
| `src/pages/TransactionDetails.vue` | 779 | `fetchNWCTransaction` | raw throwaway | `await runNwc(nwc => nwc.listTransactions(...))` |
| `src/stores/wallet.js` | 1238, 1280-1281, 1612, 1720-1721 | `addWallet` / `connectWallet` / `updateWalletData` | store-owned | ✅ correct |

### Already correct (canonical paths, untouched)

| File | Why correct |
|---|---|
| `src/providers/WalletFactory.js:50` | Creates `NWCWalletProvider` (the wrapper around the shared instance) |
| `src/providers/NWCWalletProvider.js:40, 67, 112-413` | The canonical class. `this.nwc` (NWC provider) + `this.nwcClient` (for notifications) are both created once per wallet. |
| `src/stores/wallet.js:1238, 1280-1281, 1612, 1720-1721` | Store creates and stores the instance via `connectionStates[walletId].nwcInstance`. Reuses it on subsequent calls. |
| `src/stores/wallet.js:2208-2229` | Internal transfer goes through `NWCWalletProvider` methods. |
| `src/stores/autoWithdraw.js:273-275` | Peeks at `connectionStates[walletId]?.nwcInstance` directly. Slightly leaky (skips the abstraction) but functionally shares the connection. After the refactor, this becomes `runNwc(fn, { walletId })`. |

---

## The plan, in implementation order

Order is important: each step keeps the codebase compiling and shippable. Commit boundaries are sensible.

### Step 0 — Add `ensureNWCConnected(walletId)` + app-state tracking to `wallet.js`

**Foundation. Do this first.** Without it, `runNwc()` will throw `WALLET_NOT_CONNECTED` after every cold start, dropped socket, or app resume. Mirrors the existing `ensureLNBitsConnected` pattern (`wallet.js:1913`).

Two additions: the helper action AND a small piece of state for app-state tracking (Alby Go puts this on the store; we do the same).

**State (add to the `state()` block):**

```js
// Tracks the last app-state change (background → foreground etc.).
// `runNwc` compares against this when an NWC request fails — if the
// timestamp moved during the in-flight call, the OS likely severed
// the WebSocket and the failure should be swallowed quietly.
// Mirrors Alby Go's `lastAppStateChangeTime` in `appStore.ts:217`.
lastAppStateChangeTime: 0,
```

**Action:**

```js
/**
 * Update the app-state-change timestamp. Called by App.vue's existing
 * `appStateChange` listener so `runNwc` can detect "request started
 * before background → failed because OS killed the socket → don't
 * surface it as a real error."
 */
setLastAppStateChangeTime(now) {
  this.lastAppStateChangeTime = now
},

/**
 * Ensure an NWC wallet has a live connection and return the NWC
 * instance. Mirrors `ensureSparkConnected` / `ensureLNBitsConnected`
 * so every NWC call site can get a usable socket in one call without
 * worrying about lifecycle state.
 *
 * Cheap getter once connected. On cold start, after `disconnect()`,
 * or when the relay dropped the WebSocket, this re-runs `connectWallet`
 * which rebuilds the `NostrWebLNProvider` and stores it on
 * `connectionStates[walletId].nwcInstance`.
 *
 * @param {string} [walletId] - Optional wallet ID; defaults to active.
 * @returns {Promise<Object>} Live NWC instance
 * @throws {Error} If the wallet is not NWC or connection fails
 */
async ensureNWCConnected(walletId) {
  const targetId = walletId || this.activeWalletId
  const wallet = this.wallets.find((w) => w.id === targetId)
  if (!wallet || wallet.type !== WALLET_TYPES.NWC) {
    throw new Error('Not an NWC wallet')
  }

  const existing = this.connectionStates[targetId]?.nwcInstance
  if (existing && this.connectionStates[targetId]?.connected) {
    return existing
  }

  await this.connectWallet(targetId)
  const nwc = this.connectionStates[targetId]?.nwcInstance
  if (!nwc) throw new Error('NWC wallet could not be connected.')
  return nwc
},
```

**Hint:** place `ensureNWCConnected` directly after `ensureLNBitsConnected` for visual parity. `setLastAppStateChangeTime` can go near the other small setters. `WALLET_TYPES.NWC` is imported from `../providers/WalletFactory` (already imported in `wallet.js`).

### Step 1 — `nwcFetcher.js` helper

New file `src/utils/nwcFetcher.js`:

```js
import { useWalletStore } from '../stores/wallet'

/**
 * Run an NWC request against a wallet's shared instance.
 *
 * Centralises:
 *   - reconnect-on-demand via `ensureNWCConnected` (cold start, dropped
 *     socket, app resume — caller never sees a null instance)
 *   - iOS-backgrounding swallow (OS severs WebSocket on background;
 *     first call after resume can fail spuriously). Detection mirrors
 *     Alby Go's pattern: compare walletStore.lastAppStateChangeTime
 *     before/after the fetch — if it moved, the OS likely killed the
 *     socket mid-flight.
 *
 * Throws:
 *   - Error('wallet-not-connected') when reconnect fails
 *   - Error('app-backgrounded') when the failure looks like an OS-level
 *     WebSocket sever (caller decides whether to retry silently or hide)
 *   - the original error otherwise (so the global payment-error dialog
 *     still shows the upstream prose)
 *
 * @template T
 * @param {(nwc: any) => Promise<T>} fn
 * @param {object} [opts]
 * @param {string} [opts.walletId] - Target wallet; defaults to active.
 *                                   Pass explicit for background flows
 *                                   (auto-withdraw) and per-wallet
 *                                   subscriptions (ReceiveModal monitor)
 *                                   so a mid-flight wallet switch can't
 *                                   redirect them.
 * @returns {Promise<T>}
 */
export async function runNwc(fn, opts = {}) {
  const walletStore = useWalletStore()

  let nwc
  try {
    nwc = await walletStore.ensureNWCConnected(opts.walletId)
  } catch (e) {
    const err = new Error('wallet-not-connected')
    err.code = 'WALLET_NOT_CONNECTED'
    err.cause = e
    throw err
  }

  // Snapshot the app-state-change timestamp before the call. If it
  // moves during fn(), the OS likely severed the WebSocket and the
  // failure should be classified as transient.
  const stateAtStart = walletStore.lastAppStateChangeTime
  try {
    return await fn(nwc)
  } catch (error) {
    if (stateAtStart !== walletStore.lastAppStateChangeTime) {
      const err = new Error('app-backgrounded')
      err.code = 'APP_BACKGROUNDED'
      err.cause = error
      throw err
    }
    throw error
  }
}
```

**Hint — actual method names in the store:**
- `getActiveNWC()` at `wallet.js:1821` (NOT `getActiveNWCInstance`)
- `getNWC(walletId)` at `wallet.js:1833`
- `getProvider(walletId)` at `wallet.js:1844` (requires walletId)
- `getActiveProvider()` at `wallet.js:1858`

We bypass the bare getters and use `ensureNWCConnected` (new in Step 0) for the reconnect-on-demand behaviour. The fetcher reads `lastAppStateChangeTime` directly off the store — no module-level state. This keeps `runNwc` pure (no hidden module side effects) and makes the backgrounding detection mockable in tests.

### Step 2 — Wire `setLastAppStateChangeTime` into App.vue (one line)

`src/App.vue` already listens to `appStateChange` (for the biometric lock). Add one call inside the existing handler:

```js
// existing import is fine — useWalletStore is already imported.
// inside the existing handler body:
stateListener = await CapApp.addListener('appStateChange', ({ isActive }) => {
  store.setLastAppStateChangeTime(Date.now())
  // existing biometric-lock logic stays unchanged
})
```

**Hint:** the existing listener is in `App.vue` `onMounted` around line 73. `store` is already in scope (the `setup()` `const store = useWalletStore()` line). Don't refactor the biometric logic — just add the one call at the top of the handler. Mirrors Alby Go's `context/UserInactivity.tsx` which calls `useAppStore.getState().setLastAppStateChangeTime(now)` in the same handler that gates security/inactivity.

### Step 3 — Refactor `LightningPaymentService` to take an NWC instance

This is the highest-blast-radius change. It must land in one commit alongside its callers (next step) so the build stays green.

**Current state (`src/utils/lightning.js`):**
- Line 70: constructor takes an `nwcConnectionString`
- Line 75: `this.nwc = new NostrWebLNProvider({ nostrWalletConnectUrl })`
- Line 78: `this.enabled = false`
- Line 86: `enable()` calls `await this.nwc.enable()` and sets `this.enabled = true`
- Line 96: `close()` calls `this.nwc.close()` — **catastrophic** if `this.nwc` is the store's shared instance
- Lines 320, 345, 436, 473, 482, 497: `await this.enable()` calls

**New shape:**

```js
class LightningPaymentService {
  /**
   * Accepts either:
   *   - A shared NWC instance from the store (preferred)
   *   - A connection URL string (legacy / standalone use)
   *   - null for resolution-only flows (processPaymentInput, LNURL/
   *     address parsing don't need a wallet connection at all)
   *
   * When given an instance, this service does NOT own the connection:
   *   - .close() becomes a no-op (the store owns lifecycle)
   *   - .enable() becomes a no-op (the store enabled it already)
   */
  constructor(nwcOrUrl) {
    if (!nwcOrUrl) {
      this.nwc = null
      this.ownsConnection = false
      this.enabled = false
    } else if (typeof nwcOrUrl === 'string') {
      // Legacy path: this service builds and owns its socket.
      this.nwc = new NostrWebLNProvider({ nostrWalletConnectUrl: nwcOrUrl })
      this.ownsConnection = true
      this.enabled = false
    } else {
      // Injected shared instance — store owns the lifecycle.
      this.nwc = nwcOrUrl
      this.ownsConnection = false
      this.enabled = true
    }
  }

  async enable() {
    if (!this.nwc) throw new Error('wallet-not-connected')
    if (this.enabled) return
    if (!this.ownsConnection) {
      // Shared instance is already enabled by the store.
      this.enabled = true
      return
    }
    await this.nwc.enable()
    this.enabled = true
  }

  close() {
    // Only close sockets we created ourselves. Closing the store's
    // singleton would kill the connection for every other consumer.
    if (this.ownsConnection && this.nwc && typeof this.nwc.close === 'function') {
      this.nwc.close()
    }
    this.enabled = false
  }

  // ... sendPayment / createInvoice / lookupInvoice etc. stay as-is.
  // Resolution methods (processPaymentInput, processLNURL, ...) must
  // not touch this.nwc.
}
```

**Verification grep after refactor:**
```
grep -n "this.nwc" src/utils/lightning.js
```
Every `this.nwc` reference should be either inside `enable`/`close` (lifecycle) or inside a method that genuinely needs a wallet connection (`createInvoice`, `sendPayment`, `lookupInvoice`, `listTransactions`). Resolution methods (`processPaymentInput`, `processLNURL`, `processLightningAddress`, etc.) must not touch it.

**Audit any `.close()` callers**: After this change, anyone who used to call `lightningService.close()` on an instance built from a URL string still gets the original behaviour (we own it, we close it). Anyone who builds the service from a shared instance gets a no-op. If a caller relied on `close()` to free the socket and the same call site is now passing the shared instance, document why that's safe (the store owns the close).

### Step 4 — Update all `LightningPaymentService` callers (same commit as Step 3)

Pattern for callers that need NWC (send / createInvoice / monitor):

```js
// BEFORE:
const lightningService = new LightningPaymentService(activeWallet.nwcString)
await lightningService.sendPayment(...)

// AFTER:
const nwc = await this.walletStore.ensureNWCConnected()
const lightningService = new LightningPaymentService(nwc)
await lightningService.sendPayment(...)
// No .close() — the store owns the connection.
```

Pattern for callers that only resolve input:

```js
// BEFORE:
const lightningService = new LightningPaymentService(activeWallet.nwcString)
const paymentData = await lightningService.processPaymentInput(address)

// AFTER:
const lightningService = new LightningPaymentService(null)
const paymentData = await lightningService.processPaymentInput(address)
```

**Sites to convert (exact list):**

| File | Line | Branch (send/receive/monitor/resolve) | NWC needed? |
|---|---|---|---|
| `src/pages/Wallet.vue` | 2709 | `createInvoiceForWithdraw` (receive) | yes |
| `src/pages/Wallet.vue` | 2843 | monitoring fallback | yes |
| `src/pages/Wallet.vue` | 3041 | LNURL resolve in scan | **no** (pass `null`) |
| `src/pages/Wallet.vue` | 3065 | LN-address resolve | **no** (pass `null`) |
| `src/pages/Wallet.vue` | 3379 | `sendNWCPayment` | yes |
| `src/components/PaymentModal.vue` | 249, 250, 251 | resolve + send (same instance) | yes for send; resolve doesn't care |
| `src/components/BatchSendModal.vue` | 1215, 1216, 1217 | resolve + send | yes (same instance for resolve + send) |

**Hint for PaymentModal/BatchSendModal:** the same `LightningPaymentService` instance is used for `processPaymentInput` AND `sendPayment` within the same flow. Pass the shared NWC instance — resolution methods just ignore it.

### Step 5 — Replace the 5 raw `NostrWebLNProvider` throwaways

Each site shrinks to a one-line `runNwc` call.

#### 5a. `src/pages/Wallet.vue:2255` — `updateWalletBalance`

```js
// BEFORE:
const nwc = new NostrWebLNProvider({ nostrWalletConnectUrl: activeWallet.nwcString })
await nwc.enable()
const balance = await nwc.getBalance()

// AFTER:
import { runNwc } from 'src/utils/nwcFetcher'
const balance = await runNwc(nwc => nwc.getBalance())
```

Wrap the surrounding try/catch to handle `WALLET_NOT_CONNECTED` and `APP_BACKGROUNDED` gracefully (e.g. skip the balance update silently, don't show a toast).

#### 5b. `src/pages/TransactionHistory.vue:1305` — `loadMore`

```js
// AFTER:
const txResponse = await runNwc(nwc => nwc.listTransactions({...}))
```

When `WALLET_NOT_CONNECTED` is thrown, surface the existing "tap to reconnect" state, not an error toast.

#### 5c. `src/pages/TransactionDetails.vue:779` — `fetchNWCTransaction`

```js
// AFTER:
const txResponse = await runNwc(nwc => nwc.listTransactions({...}))
```

#### 5d. `src/components/ReceiveModal.vue:1543` — invoice generation

```js
// AFTER:
const invoice = await runNwc(nwc => nwc.makeInvoice({...}))
```

#### 5e. `src/components/ReceiveModal.vue:1213` — payment monitoring (trickiest, mirror Alby Go pattern)

This one opens a **long-lived** subscription. Today it creates its own client and never tears it down. The fix is non-trivial and worth doing carefully — copy the pattern Alby Go uses in `components/CreateInvoice.tsx`:

1. Capture `walletId` at the moment monitoring starts (not at fire time — the user can switch wallets mid-flight).
2. Get the shared NWC instance via `ensureNWCConnected(walletId)`.
3. Probe `getWalletServiceInfo()` for `notifications.includes("payment_received")`.
4. If supported → subscribe and store the `unsubscribe` callback.
5. If not supported → fall back to a polling loop with a single `polling` boolean as the kill switch.
6. Component teardown sets `polling = false` and calls `unsubscribe?.()`.

```js
// Component data:
data() {
  return {
    monitorWalletId: null,
    monitorPolling: false,
    monitorUnsub: null,
  }
},

async startPaymentMonitor(invoice) {
  this.stopPaymentMonitor() // idempotent, ensure no leftover

  const activeWallet = this.walletStore.activeWallet
  this.monitorWalletId = activeWallet.id

  let nwc
  try {
    nwc = await this.walletStore.ensureNWCConnected(this.monitorWalletId)
  } catch {
    // Inline "reconnect required" state; never open a subscription on a
    // dead wallet.
    return
  }

  this.monitorPolling = true

  const handlePaymentReceived = (tx) => {
    if (!this.monitorPolling) return
    this.monitorPolling = false
    this.monitorUnsub?.()
    this.monitorUnsub = null
    this.$emit('payment-received', tx)
  }

  // Step 1: try the push-style subscription if the wallet service
  // advertises payment_received notifications.
  try {
    const info = await nwc.getWalletServiceInfo()
    if (info?.notifications?.includes('payment_received')) {
      this.monitorUnsub = await nwc.subscribeNotifications(
        (notification) => {
          if (
            notification.notification_type === 'payment_received' &&
            notification.notification.invoice === invoice
          ) {
            handlePaymentReceived(notification.notification)
          }
        },
        ['payment_received'],
      )
      return
    }
  } catch (error) {
    console.warn('subscribeNotifications failed, falling back to poll:', error)
  }

  // Step 2: fallback polling loop. 3-second interval matches Alby Go.
  while (this.monitorPolling) {
    try {
      const tx = await nwc.lookupInvoice({ invoice })
      if (tx?.state === 'settled') {
        handlePaymentReceived(tx)
        break
      }
    } catch (error) {
      // Transient (network blip, OS background); next iteration retries.
      console.warn('lookupInvoice poll failed:', error)
    }
    if (!this.monitorPolling) break
    await new Promise((r) => setTimeout(r, 3000))
  }
},

stopPaymentMonitor() {
  this.monitorPolling = false
  this.monitorUnsub?.()
  this.monitorUnsub = null
  this.monitorWalletId = null
},

beforeUnmount() {
  this.stopPaymentMonitor()
},
```

**Critical invariants:**
- `nwc` is the wallet's shared instance. **Never** call `nwc.close()` here — it would kill payments, balance, transactions, and the monitor itself for every other consumer.
- `monitorPolling` is the single source of truth for "is this monitor alive?". Both the subscription handler and the polling loop check it; both teardown paths flip it.
- `monitorWalletId` is captured once. If the user switches wallets, the captured id keeps the monitor pointed at the original wallet — `runNwc({ walletId: this.monitorWalletId })` (if needed inside the loop) routes to the right instance.

**Hint:** grep the file first to see what the existing `getPaymentMonitoringProvider` / `stopPaymentMonitor` machinery looks like and align names:

```
grep -n "subscribeNotifications\|getPaymentMonitoringProvider\|stopPaymentMonitor" src/components/ReceiveModal.vue
```

The existing code probably has hooks for "stop" already (the modal's `@before-hide` calls it). Reuse those hook names rather than introducing new ones.

### Step 6 — Wallet-switch teardown in `src/stores/wallet.js`

Close the previous NWC instance before replacing it. Two sites: `addWallet` (line ~1238) and `connectWallet` (line ~1612).

```js
// At the top of the NWC branch, before creating the new instance:
const existing = this.connectionStates[walletId]?.nwcInstance
if (existing) {
  try { existing.close() } catch {}
}
```

Also in `disconnectWallet` and `removeWallet`. Existing cleanup at `wallet.js:1656-1658` already calls `state.nwcInstance.close()`; verify it's hit on every teardown path.

**Atomic switch check (Alby Go pattern C):** find the single function that changes `activeWalletId`. In Alby Go this is `setSelectedWalletId(...)`, which atomically replaces both `selectedWalletId` and `nwcClient` in one `set()` call. Ours should behave the same: the moment `activeWalletId` flips, the new wallet's NWC instance must be available (or `null`, which `ensureNWCConnected` will rebuild on demand). If our switch path is currently spread across multiple actions (e.g. `setActiveWalletId` then a separate `connectWallet`), there's a window where consumers read `activeWalletId === walletB` but `connectionStates[walletB]?.nwcInstance === undefined`. Verify this is impossible.

```
grep -n "activeWalletId\s*=\|this.activeWalletId =" src/stores/wallet.js
```

If found scattered, consolidate into one action that does both. If the only writer is `connectWallet` (which already sets both), we're fine.

### Step 7 — Final verification before commit

Run these greps. **Each should return only the canonical files** (`NWCWalletProvider.js`, `wallet.js` store, `lightning.js` constructor):

```
grep -rn "new NostrWebLNProvider" src/
grep -rn "\.enable()" src/ | grep -i nwc
grep -rn "LightningPaymentService(" src/ | grep -v "lightning.js\|TODO"
```

Run the build:
```
pnpm run build
```

Should complete with no warnings or errors.

### Step 8 — Opportunistic fixes on the same surface

Three small fixes the reviewer flagged on files this PR already opens. Each is independent and pre-existing; folding them in keeps trust by not leaving known bugs adjacent to a refactored area.

#### 8a. `TransactionHistory.vue:1428` — pre-existing crash

```js
// BEFORE:
const provider = await this.walletStore.getProvider()  // requires walletId!
if (provider.isSpark && provider.isSpark()) { ... }

// AFTER:
const provider = this.walletStore.getActiveProvider()
if (!provider) return
if (provider.isSpark && provider.isSpark()) { ... }
```

`getProvider(walletId)` at `wallet.js:1844` requires a walletId. The call without one returns `undefined`, then `provider.isSpark` throws. Affects Spark pagination AND NWC branch selection.

#### 8b. `Wallet.vue:2701` — LNBits invoice creation parity

```js
// BEFORE:
} else if (walletType === 'lnbits') {
  const provider = this.walletStore.getActiveProvider()
  if (!provider) throw new Error('No LNbits provider available')
  result = await provider.createInvoice({ amount: amountSats, description })
}

// AFTER:
} else if (walletType === 'lnbits') {
  const provider = await this.walletStore.ensureLNBitsConnected()
  result = await provider.createInvoice({ amount: amountSats, description })
}
```

LNBits send paths already use `ensureLNBitsConnected`. Receive should too — otherwise a stale session silently fails invoice creation. Identical fix at `ReceiveModal.vue:1518` (find via `grep -n "lnbits" src/components/ReceiveModal.vue`).

---

## What this does NOT include (explicit boundaries)

These were considered and rejected to keep the change clean:

- ❌ **Aggressive reconnect loop.** Alby Go doesn't do this. `ensureNWCConnected` reconnects once on demand; further failures propagate as `WALLET_NOT_CONNECTED`. Aggressive reconnect risks DoS'ing the relay (the original problem).
- ❌ **Event bus / pub-sub for NWC events.** Not needed. Subscriptions stay direct on the client with their own `unsub()` handle.
- ❌ **Connection pool across wallets.** One wallet, one client. Multi-wallet handled by replacing the reference on switch.
- ❌ **Promise queuing.** NIP-47 already multiplexes over one WebSocket; the SDK handles concurrency.
- ❌ **Splitting `LightningPaymentService`** into separate resolver + sender classes. Constructor change + `ownsConnection` flag are enough.

---

## Known adjacent inconsistencies (out of scope, document for later)

These were noticed during the audit but are not introduced by this refactor. Calling them out so a future cleanup pass knows they exist and didn't get folded in deliberately.

- **Spark connection access mixed across components.** `Wallet.vue:3331` and `Wallet.vue:3333` use `ensureSparkConnected()` (correct). `PaymentModal.vue:206` and `ReceiveModal.vue:1502` use `getActiveProvider()` directly (no reconnect dance). Not catastrophic — Spark is more permissive about stale providers — but uneven. Future Spark-side cleanup should align these.
- **Auto-withdraw bypasses the abstraction.** `autoWithdraw.js:273-275` reads `connectionStates[walletId]?.nwcInstance` directly instead of going through `runNwc(fn, { walletId })`. Functionally correct (it does share the instance), but conceptually leaky. Easy follow-up: replace with `runNwc(fn, { walletId: configKey })`.
- **Legacy `walletState.connectedWallets` / `nwcString` / `localStorage` sync.** `Wallet.vue:2250` and similar still read mirrored state from `localStorage` rather than reading the Pinia store directly. Same surface area as this refactor but a separate concern; folding it in would balloon the diff.

---

## Files touched

| File | Change | Effort |
|---|---|---|
| `src/stores/wallet.js` | New `ensureNWCConnected(walletId)` action; close existing instance before replace in `addWallet` / `connectWallet` / disconnect paths | ~30 LOC |
| `src/utils/nwcFetcher.js` (new) | `runNwc(fn, { walletId? })` + `markAppStateChanged` helper | ~40 LOC |
| `src/App.vue` | One-line `markAppStateChanged()` in existing listener | 2 LOC |
| `src/utils/lightning.js` | `LightningPaymentService` constructor accepts instance / URL / null; `ownsConnection` flag; `enable` / `close` no-op when injected | ~25 LOC |
| `src/pages/Wallet.vue` | 6 sites: balance, createInvoice, monitor-fallback, LNURL-resolve, LN-address-resolve, send; **+ Step 8b: LNBits invoice via ensureLNBitsConnected** | ~35 LOC net |
| `src/pages/TransactionHistory.vue` | `loadMore` → `runNwc`; **+ Step 8a: `getProvider()` → `getActiveProvider()`** | ~10 LOC net |
| `src/pages/TransactionDetails.vue` | `fetchNWCTransaction` → `runNwc` | ~5 LOC net |
| `src/components/ReceiveModal.vue` | Invoice gen + monitor: share instance, track `unsub`; **+ Step 8b alignment** | ~25 LOC |
| `src/components/PaymentModal.vue` | Pass shared NWC into `LightningPaymentService` | ~3 LOC net |
| `src/components/BatchSendModal.vue` | Pass shared NWC into `LightningPaymentService` | ~3 LOC net |

Total ≈ **180 LOC net** across 10 files, no new architecture.

---

## Risk register

| Risk | Mitigation |
|---|---|
| A component calls `.close()` on the shared instance and breaks every other consumer | `LightningPaymentService.close()` is now a no-op when injected with a shared instance (`ownsConnection` flag). Components don't import `NostrWebLNProvider` directly after this change. Final grep verifies. |
| `runNwc` returns null on cold start / dropped socket / app resume | `ensureNWCConnected` runs reconnect-on-demand before returning the instance. Throws `WALLET_NOT_CONNECTED` only when reconnect itself fails — caller renders inline placeholder, no toast. |
| iOS background severs the WebSocket | `runNwc` swallows the first post-resume failure via `APP_BACKGROUNDED`. Subsequent calls hit `ensureNWCConnected` which reconnects. |
| Active-wallet switch redirects an in-flight subscription | `runNwc({ walletId })` accepts explicit target. ReceiveModal payment monitor captures `walletId` at modal-open time. |
| Subscription handle leaks in `ReceiveModal` payment monitor | Track `unsub` on a component field; call it in `beforeUnmount` and `@before-hide`. Never `.close()` the client itself. |
| `LightningPaymentService` constructor change breaks a caller I missed | Grep `LightningPaymentService(` after the refactor. Confirmed callers: `Wallet.vue` (×5), `PaymentModal.vue` (×1), `BatchSendModal.vue` (×1). |
| Resolution paths (`processPaymentInput`) accidentally still hit `this.nwc` | After constructor change, grep `this.nwc` in `lightning.js` and confirm every reference is inside `enable`/`close` or a method that's documented to need a wallet. |
| Legacy URL-string callers (if any remain) break the `ownsConnection` semantics | The constructor handles all three input shapes (instance / string / null). URL-string callers get the same own-and-close behaviour as before. |

---

## Test plan after implementation

This is a wallet — a broken payment is a trust loss. The build passing is necessary but **not sufficient**. Walk every flow against a real NWC wallet before merging.

### Pre-flight (automated)

```bash
# 1. No residual throwaways
grep -rn "new NostrWebLNProvider" src/
# Expected output: ONLY NWCWalletProvider.js (1 line) and wallet.js (2 lines)

grep -rn "LightningPaymentService(" src/
# Expected output: callers should all pass `nwc` instance or `null`, never a URL string

# 2. Build succeeds with no warnings
pnpm run build

# 3. Quick smoke import in dev console
pnpm run dev
# Open http://localhost:9000, ensure no console errors on first load
```

### Setup before manual tests

- Two NWC wallets connected (e.g. one Alby Hub, one Mutiny / ZBD / different service)
- A Spark wallet connected (Business or Personal)
- One LNbits wallet connected
- Chrome DevTools → Network tab → filter by `WS`
- A second device or browser for the receiving side
- Real BTC/sats balance on at least one wallet for live tests (testnet OK if available)

### Connection-count check (the headline result)

Steps | Expected |
---|---
Open app on Wallet view with NWC active | **1** WebSocket to the relay
Switch to a different NWC wallet | Old WebSocket closes, new one opens. Total **1**.
Switch back | Same — **1** WebSocket per active wallet
Open Wallet → Receive Modal → close it | Still **1**. No new WebSocket.
Open Wallet → tap a transaction → close | Still **1**.
Pull-to-refresh the wallet 5 times in a row | Still **1**. No spawn-per-refresh.

### Send flow — every entry point

For each NWC wallet, test each of these:

1. **Main scan-and-pay**: Wallet → Send → scan a BOLT11 invoice → confirm. Expected: payment succeeds, sent toast shows.
2. **Main scan-and-pay (LNURL)**: Wallet → Send → scan an LNURL-pay code → enter amount → confirm. Expected: payment succeeds.
3. **Main scan-and-pay (Lightning Address)**: Wallet → Send → paste `user@domain` → enter amount → confirm. Expected: payment succeeds.
4. **Contact send**: Address Book → tap contact → enter amount → confirm. Expected: payment succeeds.
5. **Batch send**: Address Book → multi-select → enter amounts → send all. Expected: all succeed (or per-row reasons shown for failures).
6. **Internal transfer (NWC → NWC)**: Wallet → Transfer → pick two NWC wallets → enter amount → confirm. Expected: success.
7. **Internal transfer (NWC → Spark)**: Same with Spark destination. Expected: success.
8. **Internal transfer (Spark → NWC)**: Same with NWC destination. Expected: success.
9. **Auto-withdraw**: Set threshold on an NWC wallet → trigger a balance change above threshold → wait. Expected: auto-payout fires, balance reduces.

### Receive flow — every entry point

1. **Plain invoice**: Wallet → Receive → enter amount → invoice appears. Pay it from a separate wallet. Expected: payment detected, success toast.
2. **Zero-amount invoice**: Wallet → Receive → leave amount empty → invoice appears. Pay any amount. Expected: payment detected.
3. **Lightning Address**: Display LN address. Pay it from a separate wallet (Strike, Phoenix, etc.). Expected: payment detected.
4. **Refresh during monitoring**: Open Receive, leave for 30s. Expected: still listening. No spurious "monitor failed" toast.
5. **LNBits invoice creation**: Switch to LNBits wallet → Receive → enter amount → invoice appears (verifies Step 8b alignment).
6. **Wallet-switch while monitor open**: Open NWC wallet → Receive → open. Switch to another NWC wallet via the picker. The first modal's subscription should keep firing for the original wallet, not redirect to the new active one. (If the modal closes on switch instead, that's also acceptable — just don't redirect silently.)

### Backgrounding (iOS-specific, but worth running on Android too)

1. Open Wallet → background the app for 30 seconds → reopen.
2. Tap the wallet to refresh. Expected: first NWC call may silently retry via `ensureNWCConnected` (handled by `APP_BACKGROUNDED`), second call succeeds. **No error toast.**
3. Re-background for 5 minutes → reopen → send a payment. Expected: works (reconnect-on-demand).
4. Background → kill app via OS → relaunch (cold start). Expected: balance loads on Wallet view via `ensureNWCConnected`.

### Wallet switching

1. Switch from NWC-A to NWC-B → balance updates. WebSocket count: 1.
2. Switch from NWC to Spark → NWC WebSocket closes. WebSocket count: 0 (Spark doesn't use the same relay).
3. Switch from Spark back to NWC → fresh WebSocket opens. WebSocket count: 1.
4. Delete an NWC wallet → its WebSocket closes immediately.

### Error scenarios

1. **Disconnected during action**: Connect NWC → unplug WiFi → tap send. Expected: error dialog with the upstream / network reason. No app crash.
2. **Invalid NWC URI**: Try to add an NWC wallet with a malformed URI. Expected: clean error in setup, no WebSocket leak.
3. **Bad recipient**: Pay a Lightning Address that doesn't exist. Expected: error dialog with upstream reason.
4. **Insufficient funds**: Try to send more than the wallet has. Expected: insufficient-funds dialog with breakdown.
5. **Transaction history pagination (Spark + NWC)**: Open transaction history with each wallet type, scroll to bottom to trigger `loadMore`. Expected: pagination works for both — verifies Step 8a fix.

### Regression scope (things that must still work)

- Spark wallet send + receive (unaffected, but verify)
- LNbits wallet send + receive (verify Step 8b doesn't break invoice creation)
- LNURL-withdraw (Boltcard tap)
- Kiosk mode (separate boot path, ensure it still authorises payments)
- Onboarding new wallet (NWC URI paste)
- Deep links (lightning:, bitcoin:, lnurlp:, lnurlw:)
- Notifications: incoming payment shows in transaction list within a few seconds (relies on `subscribeNotifications`)

### Pass criteria

The change ships only if **all** of the following are true:

- WebSocket count is 1 per active NWC wallet under every test above.
- No `"no info event kind 13194"` errors in any console during a 10-minute session.
- Every send/receive flow above succeeds end-to-end on a real wallet.
- No spurious error toasts on background → foreground.
- Spark and LNbits flows are unaffected.
- Transaction history pagination works on both Spark and NWC wallets (Step 8a).
- LNBits invoice creation succeeds after a long idle (Step 8b).

---

## Reference

[getAlby/go](https://github.com/getAlby/go) — Alby's official mobile wallet, which this plan mirrors. Specifically:
- `lib/state/appStore.ts` for the store-owned client pattern.
- `lib/createNwcFetcher.ts` for the central fetcher wrapper.
- `hooks/useBalance.ts` for the consumer pattern.

Project memory: `reference_alby_go_nwc_pattern.md`.
