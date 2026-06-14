# 🦉 ARK_ME: Arkade wallet, testing state

> The honest status of BuhoGO's **Arkade (Ark L2)** wallet backend, and how you can help us ship it clean.

[← README](README.md) · [Developer Guide](Developer.md) · [Contribute](CONTRIBUTING.md)

- **Pull request:** [#177 "Arkade (Ark L2) wallet"](https://github.com/Buho-Ecosystem/Buho_go/pull/177)
- **Branch:** `ark`
- **State:** **Draft.** Feature-complete in code, build-green, unit specs pass. **Not yet verified on a real device against mainnet.**

This is where we want help from the FOSS community. The code is written. What it needs now is real-world testing and a couple of clear decisions. Read on.

---

## TL;DR

| Area | In code | Verified on mainnet device |
| --- | --- | --- |
| Create wallet (BIP-39 + BIP-86 Taproot key) | ✅ | ⏳ |
| Restore (unified, auto-detects Spark vs Arkade by on-chain activity) | ✅ | ⏳ |
| `ark1` → `ark1` send/receive (instant, near-zero fee) | ✅ | ⏳ |
| Lightning send/receive via Boltz swaps | ✅ | ⚠️ unproven, see [the one big risk](#-the-one-big-risk-dual-sdk-versions) |
| On-chain receive (boarding) + send (Ramps offboard) | ✅ | ⏳ |
| VTXO liveness (renew / recover, in-app loop) | ✅ | ⏳ |
| App-wide parity: switcher, settings, history, address book | ✅ | partial |
| Auxiliary paths: auto-withdraw, internal transfer, batch, kiosk, shop | ✅ | ⏳ |
| i18n (en, de, es) | ✅ | n/a |

✅ written and building · ⏳ needs a real device + small mainnet amounts · ⚠️ has a known risk to resolve first

---

## What is Arkade, and why add it

Arkade is a **Bitcoin L2 built on the Ark protocol**. Funds are **VTXOs** (virtual UTXOs) that settle to Bitcoin in batches. For BuhoGO this means a self-custodial wallet with:

- **Instant, near-zero-fee** transfers between Arkade addresses (`ark1…`), even when the recipient is offline.
- **On-chain Bitcoin** in and out through boarding and Ramps.
- **Lightning** through Boltz submarine swaps (Arkade has no native Lightning).

It slots in as BuhoGO's **4th wallet backend** next to Spark, NWC, and LNBits, and reuses the Spark patterns wherever it can (mnemonic based, native fast-path, encrypted seed).

> New to the protocol? Start with the [Arkade docs](https://docs.arkadeos.com/) and the [reference wallet](https://github.com/arkade-os/wallet).

---

## What is implemented

The whole plan in [`Plans WIP/ARKADE_INTEGRATION_PLAN.md`](Plans%20WIP/ARKADE_INTEGRATION_PLAN.md) has been built. Highlights:

- **Provider** `src/providers/ArkadeWalletProvider.js` implements the full `WalletProvider` contract plus the Arkade fast-path (`isArkade`, `getArkadeAddress`, `transferToArkadeAddress`), on-chain (`getBoardingAddress`, `offboardToBitcoin`), Lightning (`createInvoice`, `payInvoice`, `lookupInvoice`, `startIncomingFundsListener`), and liveness (`checkLiveness`).
- **Key derivation** `src/utils/arkadeKeys.js`: BIP-86 Taproot `m/86'/{0 mainnet | 1 test}'/0'/0/0`, fed to `SingleKey.fromPrivateKey`. Pinned by a unit test against the published BIP-86 vector, so **a BuhoGO Arkade seed restores in the official Arkade wallet too.**
- **Onboarding** keeps "Create Wallet" as Spark; Arkade is a clear option on the welcome screen. Backup is deferred and nudged once the wallet holds funds.
- **Restore** is unified (`src/pages/RestorePage.vue`): a 12-word phrase cannot reveal which chain it belongs to, so it probes both Spark and Arkade for activity and restores where the funds actually are.
- **Lightning over Boltz** with `swapManager` and `IndexedDbSwapRepository` on by default: reverse swaps auto-claim, failed submarine swaps auto-refund, both survive an app restart.
- **App-wide parity** via a shared theme-aware `src/components/ArkadeLogo.vue` (orange `#F14317` light, purple `#351791` dark), with Arkade branches across the switcher, settings, transaction history, address book, and every auxiliary payment path.

---

## ⚠️ The one big risk: dual SDK versions

This is the single most important thing to resolve before trusting Lightning on mainnet.

- The app pins **`@arkade-os/sdk@^0.3.13`**.
- The swap layer **`@arkade-os/boltz-swap@^0.3.38`** declares and nests its **own `@arkade-os/sdk@0.4.33`**.

So the `Wallet` instance we hand to `ArkadeSwaps` is a **different major version** than the swap layer was built against. It is structurally typed, so it compiles and runs, but it is flagged as the highest risk for **intermittent Lightning failures** (claim/refund signing, settlement-event parsing).

**The decision to make:** align the versions. Either

1. bump the app to the `0.4.x` SDK (a real migration: `sendBitcoin` → `send`, adopt `MnemonicIdentity`, `settlementConfig`, `getVtxoManager`), or
2. pin a `0.3`-based `boltz-swap`.

We want to **test Lightning on a real device first**, then choose. Native `ark1` and on-chain paths do not depend on the swap layer and are not affected by this.

---

## Other known issues and open questions

- **Boltz endpoint (resolved, but worth knowing).** We pin the **generic** `https://api.boltz.exchange`, not the docs' `https://api.ark.boltz.exchange`. The dedicated host's swap WebSocket never opened in testing (timed out 3/3), which stalled swaps. Both hosts serve the same mainnet ARK↔BTC pairs. Re-test the dedicated host's WebSocket before ever switching back.
- **Android WebView (the Phase-0 spike, still unconfirmed on hardware):** verify that `EventSource`/SSE streams to `arkade.computer`, that `IndexedDB` persists across restart, and that `crypto.getRandomValues` exists before the SDK loads.
- **Boltz robustness follow-ups (recommended, not yet done):** subscribe to `getSwapManager().onSwapFailed/onSwapCompleted` to refresh balance and inform the user on auto-refund; confirm LN receive via the swap's own `invoice.settled`; validate amount against `getLimits()`/`getFees()` before starting a swap.
- **"Export transaction to Nostr"** is still NWC-only and would throw for Arkade if reached. Niche, low priority.
- **Transaction status booleans** (`settled` / `pending`) are missing on all provider normalizers, so pending shows as "Completed". Pre-existing across backends, fix uniformly if touched.
- **Kiosk balance diff** (Pratik's area): the kiosk stores the whole `getBalance()` object and compares with `>`, which breaks balance-delta detection. Pre-existing, affects all backends.

---

## How to test it

> [!WARNING]
> Use **mainnet with small amounts**. There is no testnet path wired by default. Lightning and on-chain move real Bitcoin.

**Get the branch running:**

```bash
git fetch origin ark
git checkout ark
npm install
npm run dev          # web, at http://localhost:9000
```

For the paths that only matter on hardware (Lightning swaps, SSE, storage persistence), build to a real Android device:

```bash
quasar build -m capacitor -T android --ide   # then run from Android Studio
```

**Mainnet checklist (tick these off in the PR):**

- [ ] Create → back up the 12 words → restore on a fresh install → balance and history return
- [ ] `ark1` → `ark1` send and receive (fast path, near-zero fee)
- [ ] Lightning **receive** (reverse swap), including **claim after the app was restarted** mid-swap
- [ ] Lightning **send** (submarine swap), including a forced failure that **auto-refunds**
- [ ] Boltz min/max boundaries: a too-small and a too-large amount both fail with clear UI
- [ ] On-chain **boarding** receive, then **Ramps offboard** to a `bc1…` address
- [ ] VTXO renewal near expiry, and recovery of recoverable balance
- [ ] Auxiliary paths: auto-withdraw (`ark1` + Lightning), internal transfer, batch send, kiosk POS, shop funding
- [ ] Android WebView: storage survives restart, SSE streams, `crypto.getRandomValues` present
- [ ] Light and dark logo and accent render correctly everywhere

Found something? Open a comment on [PR #177](https://github.com/Buho-Ecosystem/Buho_go/pull/177) with the wallet type, the exact steps, what you expected, and what happened. A screen recording is gold.

---

## How you can help

This is a great first contribution to a real Bitcoin L2, and every bit moves it toward release.

- 🧪 **Test on a real device.** Run the checklist above on mainnet with a few thousand sats. Even confirming that `ark1` send works is useful signal.
- 🔌 **Help settle the SDK version question.** If you know the Arkade or Boltz SDKs, weigh in on the [dual-version risk](#-the-one-big-risk-dual-sdk-versions). A clean `0.4.x` migration PR would be hugely welcome.
- 🛡️ **Harden the swaps.** The Boltz robustness follow-ups above are well-scoped and self-contained.
- ✍️ **Improve the words.** Onboarding, swap-fee notices, and error messages should be clear to someone who has never heard "VTXO". No jargon, no em dashes (house style).
- 🌍 **Translate** the new Arkade strings beyond en, de, es.
- 📹 **Show it working.** A short clip of an Arkade payment helps more people trust and try it.

No permission needed to start. Pick an item, comment on the PR so we do not double up, and dive in. Thank you for helping make self-custodial Bitcoin better for everyone. 🦉

---

## Quick facts

| Thing | Value |
| --- | --- |
| SDK | `@arkade-os/sdk@^0.3.13` |
| Swaps | `@arkade-os/boltz-swap@^0.3.38` |
| Ark server (mainnet) | `https://arkade.computer` |
| Esplora | `https://mempool.space/api` |
| Boltz API (pinned) | `https://api.boltz.exchange` |
| Identity | `SingleKey.fromPrivateKey` (0.3.x has no `MnemonicIdentity`) |
| Derivation | BIP-86 Taproot `m/86'/{0\|1}'/0'/0/0` |
| Accent | orange `#F14317` (light) / purple `#351791` (dark) |
| Constants live in | `src/utils/arkadeKeys.js` |

## References

- [Arkade docs](https://docs.arkadeos.com/) · [machine-readable index](https://docs.arkadeos.com/llms.txt)
- [Arkade reference wallet](https://github.com/arkade-os/wallet) (the gold-standard implementation)
- [Arkade TypeScript SDK](https://github.com/arkade-os/ts-sdk) · [API reference](https://arkade-os.github.io/ts-sdk/)
- BuhoGO's full build plan: [`Plans WIP/ARKADE_INTEGRATION_PLAN.md`](Plans%20WIP/ARKADE_INTEGRATION_PLAN.md)
</content>
