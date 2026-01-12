# BuhoGO - Spark Integration UI/UX Plan

## Goal

Integrate Spark wallet into BuhoGO's **existing UI/UX** with minimal changes. Keep the current look and feel, just add Spark wallet support.

---

## Current State

- Welcome screen with NWC connection
- Wallet page with balance, send/receive
- Settings with wallet management
- Wallet switcher (chip on home → modal)

---

## Constraints

- **Only ONE Spark wallet at a time** (multiple NWC wallets allowed)
- User can **delete wallet** and create a new one
- After deleting Spark wallet, can create another Spark wallet

---

## Setup Scenarios

| # | Scenario | First Wallet | Additional |
|---|----------|--------------|------------|
| 1 | Spark only | Create/restore Spark | - |
| 2 | NWC only | Connect NWC | - |
| 3 | Spark + NWC | Create Spark | Add NWC later in settings |
| 4 | NWC + Spark | Connect NWC | Add Spark later in settings |
| 5 | Multiple NWC | Connect NWC | Add more NWC in settings |

**Note:** If user already has a Spark wallet and wants to add another, they must first delete the existing one.

---

## Integration Approach

### First Launch: Simple Choice

**Minimal change to current flow:**

Replace current IndexPage with a simple choice screen:

```
┌─────────────────────────────────────┐
│                                     │
│         [BuhoGO Logo]               │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  ⚡ Create Wallet            │   │
│  │     Self-custody             │   │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  🔗 Connect Wallet           │   │
│  │     Via NWC                  │   │
│  └─────────────────────────────┘    │
│                                     │
│        ↩ Restore from backup        │
│                                     │
└─────────────────────────────────────┘
```

- "Create Wallet" → Spark setup flow
- "Connect Wallet" → Existing NWC flow (IndexPage)
- "Restore" → Spark restore with seed phrase

---

### Spark Setup Flow

Keep it simple, 4 screens:

**1. Show Seed Phrase**
```
┌─────────────────────────────────────┐
│  ← Back                             │
│                                     │
│  Save Your Seed Phrase              │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  1. word   5. word   9. word │   │
│  │  2. word   6. word  10. word │   │
│  │  3. word   7. word  11. word │   │
│  │  4. word   8. word  12. word │   │
│  └─────────────────────────────┘    │
│                                     │
│  ⚠️ Write these down. Never share.  │
│                                     │
│           [I Saved It →]            │
│                                     │
└─────────────────────────────────────┘
```

**2. Verify (3 words)**
```
┌─────────────────────────────────────┐
│  ← Back                             │
│                                     │
│  Verify Your Backup                 │
│                                     │
│  Word #3: ___________               │
│  Word #7: ___________               │
│  Word #11: __________               │
│                                     │
│           [Verify →]                │
│                                     │
└─────────────────────────────────────┘
```

**3. Set PIN**
```
┌─────────────────────────────────────┐
│  ← Back                             │
│                                     │
│  Set Your PIN                       │
│                                     │
│        ● ● ● ● ○ ○                  │
│                                     │
│     [  1  ] [  2  ] [  3  ]         │
│     [  4  ] [  5  ] [  6  ]         │
│     [  7  ] [  8  ] [  9  ]         │
│     [  ⌫ ] [  0  ] [  ✓  ]         │
│                                     │
└─────────────────────────────────────┘
```

**4. Done → Redirect to Wallet**

---

### NWC Setup Flow

**Keep existing IndexPage flow unchanged.** Just accessed via "Connect Wallet" button.

---

### Adding Wallet Later (Settings)

In Settings → Wallets section, add button:

```
WALLETS
───────────────────────────────
⚡ My Spark Wallet        ✓
🔗 Alby

[+ Add Wallet]
```

Tapping "+ Add Wallet" shows same choice:
- Create Spark Wallet
- Connect NWC Wallet
- Restore from Backup

---

### Wallet Switcher (Home Screen)

**Keep current implementation.** Just add wallet type icons:

```
┌─────────────────────────────────────┐
│          Switch Wallet              │
│  ───────────────────────────        │
│  ⚡ My Spark Wallet    125,000  ✓   │
│  🔗 Alby                50,000      │
│  🔗 Work               10,000       │
│                                     │
│  [+ Add Wallet]                     │
└─────────────────────────────────────┘
```

---

### Receive: Spark Address Support

**For Spark wallets only**, add a toggle in existing ReceiveModal:

```
┌─────────────────────────────────────┐
│          RECEIVE                    │
│                                     │
│  [Lightning ⚡]  [Spark Address]    │  ← Toggle (Spark wallets only)
│                                     │
│       ┌───────────────┐             │
│       │   [QR CODE]   │             │
│       │               │             │
│       └───────────────┘             │
│                                     │
│  Amount: ____________ sats          │
│                                     │
│  [Copy]   [Share]                   │
│                                     │
│  ─────────────────────────          │
│  💡 Spark = zero fee from           │
│     other Spark users               │
│                                     │
└─────────────────────────────────────┘
```

For NWC wallets: No toggle, just Lightning invoice (current behavior).

---

### Send: Auto-Detect Spark Address

**In existing SendModal**, add detection for Spark addresses:

```javascript
// When user enters/scans destination:
if (input.startsWith('sp1') || input.startsWith('tsp1')) {
  // Show: "Spark Transfer • Zero Fee"
  paymentType = 'spark_address';
} else if (input.startsWith('lnbc') || input.startsWith('lntb')) {
  // Show: "Lightning Invoice"
  paymentType = 'lightning_invoice';
} else if (input.includes('@')) {
  // Lightning Address → resolve to invoice
  paymentType = 'lightning_address';
}
```

UI feedback in SendModal:

```
┌─────────────────────────────────────┐
│  To: sp1abc123...                   │
│                                     │
│  ⚡ Spark Transfer                  │
│  Zero fee • Instant                 │
│                                     │
│  Amount: 10,000 sats                │
│                                     │
│           [Send →]                  │
└─────────────────────────────────────┘
```

---

### PIN Entry (Spark Wallets)

When app opens and active wallet is Spark:

```
┌─────────────────────────────────────┐
│                                     │
│         [Lock Icon]                 │
│                                     │
│      Enter PIN to unlock            │
│                                     │
│        ○ ○ ○ ○ ○ ○                  │
│                                     │
│     [  1  ] [  2  ] [  3  ]         │
│     [  4  ] [  5  ] [  6  ]         │
│     [  7  ] [  8  ] [  9  ]         │
│     [  ⌫ ] [  0  ] [  ✓  ]         │
│                                     │
└─────────────────────────────────────┘
```

- Show on app launch if Spark wallet is active
- Also show when viewing/exporting seed phrase in settings

---

### Spark Settings (In Settings Page)

For Spark wallets, add extra options:

```
SPARK WALLET
───────────────────────────────
Spark Address          [Copy]
sp1abc123def456...

View Seed Phrase       [→]    ← Requires PIN
Change PIN             [→]

───────────────────────────────
```

For NWC wallets, keep current settings.

---

## Summary of Changes

| Location | Change |
|----------|--------|
| **WelcomePage** | NEW - Simple 2-option choice screen |
| **SparkSetupPage** | NEW - 4 step flow (seed, verify, PIN, done) |
| **IndexPage** | KEEP - NWC flow unchanged |
| **ReceiveModal** | ADD - Toggle for Spark address (Spark wallets) |
| **SendModal** | ADD - Spark address detection |
| **Settings** | ADD - Wallet type indicator, Spark-specific options |
| **Wallet Switcher** | ADD - Wallet type icons (⚡/🔗) |
| **PinEntryDialog** | NEW - PIN input component |

---

## What Stays The Same

- Overall app look and feel
- Color scheme
- Navigation structure
- Transaction history
- Send/Receive modal layout
- Wallet switcher behavior
- Settings layout

---

## Routing Summary

```
/                    → WelcomePage (first launch) OR /wallet (returning)
/spark-setup         → SparkSetupPage (new Spark wallet)
/spark-restore       → SparkRestorePage (restore from seed)
/nwc-setup           → IndexPage (current NWC setup)
/wallet              → Wallet.vue (home)
/settings            → Settings.vue
```

---

## Implementation Priority

1. WelcomePage (first launch choice)
2. SparkSetupPage (seed + PIN)
3. PinEntryDialog component
4. Wallet store updates (Spark support)
5. ReceiveModal (Spark address toggle)
6. SendModal (Spark address detection)
7. Settings (Spark-specific options)
