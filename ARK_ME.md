# 🦉 Arkade wallet (Ark L2)

> How BuhoGO's **Arkade** wallet backend works: a self-custodial Bitcoin L2 wallet built on the Ark protocol, sitting alongside Spark, NWC, and LNBits.

[← README](README.md) · [Developer Guide](Developer.md) · [Contribute](CONTRIBUTING.md)

> [!TIP]
> Arkade is BuhoGO's newest backend. It is built, aligned on the current SDK, and shipping. If you know the Arkade or Boltz stack, a second pair of eyes is always welcome. Please review it and [open an issue or PR](https://github.com/Buho-Ecosystem/Buho_go/issues) if you spot anything.

---

## What is Arkade

Arkade is a **Bitcoin L2 built on the Ark protocol**. Funds are held as **VTXOs** (virtual UTXOs) that settle to Bitcoin in batches. For BuhoGO this means a self-custodial wallet with:

- **Instant, near-zero-fee** transfers between Arkade addresses (`ark1…`), even when the recipient is offline.
- **On-chain Bitcoin** in and out through boarding and Ramps offboard.
- **Lightning** send and receive through Boltz submarine swaps (Arkade has no native Lightning).

It is BuhoGO's **4th wallet backend** next to Spark, NWC, and LNBits, and reuses the Spark patterns wherever it can: mnemonic-based, a native fast path, and an encrypted seed that never leaves the device.

Only **one** Arkade wallet exists per install (unlike Spark, which derives a Business and Personal pair from one seed).

> New to the protocol? Start with the [Arkade docs](https://docs.arkadeos.com/) and the [reference wallet](https://github.com/arkade-os/wallet).

---

## What it does

| Area | Path |
| --- | --- |
| Create wallet | BIP-39 phrase → BIP-86 Taproot identity |
| Restore | Unified restore auto-detects Spark vs Arkade by on-chain activity |
| `ark1` → `ark1` | Instant, near-zero-fee send and receive |
| Lightning | Send and receive via Boltz swaps (reverse auto-claim, submarine auto-refund) |
| On-chain | Receive via boarding, send via Ramps offboard to any `bc1…` address |
| VTXO liveness | In-app renew / recover loop keeps balances live |
| App-wide parity | Switcher, settings, transaction history, address book, all themed |
| Auxiliary paths | Auto-withdraw, internal transfer, batch send, kiosk POS, shop funding |
| i18n | English, German, Spanish |

---

## How it is built

The full build plan lives in [`Plans WIP/ARKADE_INTEGRATION_PLAN.md`](Plans%20WIP/ARKADE_INTEGRATION_PLAN.md). The key pieces:

- **Provider** `src/providers/ArkadeWalletProvider.js` implements the full `WalletProvider` contract plus the Arkade fast path (`isArkade`, `getArkadeAddress`, `transferToArkadeAddress`), on-chain (`getBoardingAddress`, `offboardToBitcoin`), Lightning (`createInvoice`, `payInvoice`, `lookupInvoice`, `startIncomingFundsListener`), and liveness (`checkLiveness`).
- **Identity and key derivation** `src/utils/arkadeKeys.js`: the SDK's own `MnemonicIdentity.fromMnemonic(phrase, { isMainnet })`, an HD identity on the BIP-86 Taproot template `m/86'/{0 mainnet | 1 test}'/0'/0/*`. A unit test pins it against the published BIP-86 vector, so **a BuhoGO Arkade seed restores in the official Arkade wallet too.**
- **Onboarding** keeps "Create Wallet" as Spark; Arkade is a clear option on the welcome screen. Backup is deferred and nudged once the wallet holds funds.
- **Restore** is unified (`src/pages/RestorePage.vue`): a 12-word phrase cannot reveal which chain it belongs to, so it probes both Spark and Arkade for activity and restores where the funds actually are.
- **Lightning over Boltz** with `swapManager` and `IndexedDbSwapRepository` on by default: reverse swaps auto-claim, failed submarine swaps auto-refund, and both survive an app restart.
- **App-wide parity** via a shared theme-aware `src/components/ArkadeLogo.vue` (orange `#F14317` light, purple `#351791` dark), with Arkade branches across the switcher, settings, transaction history, address book, and every auxiliary payment path.

---

## Good to know

- **Boltz endpoint.** BuhoGO pins the **generic** `https://api.boltz.exchange`, not the docs' dedicated `https://api.ark.boltz.exchange`. The dedicated host's swap WebSocket did not open in testing (timed out every attempt), which stalled swaps; both hosts serve the same mainnet ARK↔BTC pairs. Re-test the dedicated host's WebSocket before ever switching.
- **Boltz limits.** Lightning swaps validate against Boltz min/max before starting, so too-small and too-large amounts fail with a clear message rather than a stuck swap.
- **"Export transaction to Nostr"** is NWC-only and does not apply to Arkade. Niche, low priority.
- **Android WebView.** The SDK relies on `EventSource`/SSE to `arkade.computer`, `IndexedDB` persistence across restarts, and `crypto.getRandomValues`. These are standard in the shipped WebView; keep them in mind when debugging a device-specific issue.

---

## Try it

> [!WARNING]
> Arkade runs on **mainnet** and moves real Bitcoin. There is no testnet path wired by default. When exploring, start with small amounts.

**Run the app locally:**

```bash
npm install
npm run dev          # web, at http://localhost:9000
```

For the paths that only exercise on hardware (Lightning swaps, SSE, storage persistence), build to a real Android device:

```bash
quasar build -m capacitor -T android --ide   # then run from Android Studio
```

**A good end-to-end pass touches:**

- [ ] Create → back up the 12 words → restore on a fresh install → balance and history return
- [ ] `ark1` → `ark1` send and receive (fast path, near-zero fee)
- [ ] Lightning **receive** (reverse swap), including **claim after the app was restarted** mid-swap
- [ ] Lightning **send** (submarine swap), including a forced failure that **auto-refunds**
- [ ] Boltz min/max boundaries: a too-small and a too-large amount both fail with clear UI
- [ ] On-chain **boarding** receive, then **Ramps offboard** to a `bc1…` address
- [ ] VTXO renewal near expiry, and recovery of recoverable balance
- [ ] Auxiliary paths: auto-withdraw (`ark1` + Lightning), internal transfer, batch send, kiosk POS, shop funding
- [ ] Light and dark logo and accent render correctly everywhere

Found something? [Open an issue](https://github.com/Buho-Ecosystem/Buho_go/issues) with the exact steps, what you expected, and what happened. A screen recording is gold.

---

## Ways to help

Arkade is a great place to contribute to a real Bitcoin L2. Everything here moves it forward.

- 🧪 **Review and test.** Run the pass above on mainnet with a few thousand sats and report anything surprising.
- 🛡️ **Harden the swaps.** Subscribe to `getSwapManager().onSwapFailed / onSwapCompleted` to refresh balance and inform the user on auto-refund; confirm LN receive via the swap's own `invoice.settled`.
- ✍️ **Improve the words.** Onboarding, swap-fee notices, and error messages should be clear to someone who has never heard "VTXO". No jargon, no em dashes (house style).
- 🌍 **Translate** the Arkade strings beyond English, German, and Spanish.
- 📹 **Show it working.** A short clip of an Arkade payment helps more people trust and try it.

No permission needed to start. Comment on an issue so we do not double up, and dive in. Thank you for helping make self-custodial Bitcoin better for everyone. 🦉

---

## Quick facts

| Thing | Value |
| --- | --- |
| SDK | `@arkade-os/sdk@^0.4.41` |
| Swaps | `@arkade-os/boltz-swap@^0.3.46` |
| Ark server (mainnet) | `https://arkade.computer` |
| Esplora | `https://mempool.space/api` |
| Boltz API (pinned) | `https://api.boltz.exchange` |
| Identity | `MnemonicIdentity.fromMnemonic(phrase, { isMainnet })` |
| Derivation | BIP-86 Taproot `m/86'/{0\|1}'/0'/0/*` |
| Accent | orange `#F14317` (light) / purple `#351791` (dark) |
| Constants live in | `src/utils/arkadeKeys.js` |

## References

- [Arkade docs](https://docs.arkadeos.com/) · [machine-readable index](https://docs.arkadeos.com/llms.txt)
- [Arkade reference wallet](https://github.com/arkade-os/wallet) (the gold-standard implementation)
- [Arkade TypeScript SDK](https://github.com/arkade-os/ts-sdk) · [API reference](https://arkade-os.github.io/ts-sdk/)
</content>
</invoke>
