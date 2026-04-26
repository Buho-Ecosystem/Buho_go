# BuhoGO — User Guide

> Everything you need to use BuhoGO. Skim the table, jump to your section.

[← README](README.md) · [Use Cases](USE_CASES.md) · [Developers](Developer.md)

---

## Pick your wallet

| You want…                                  | Choose      |
| ------------------------------------------ | ----------- |
| Full ownership, on-chain BTC, zero-fee Spark | **Spark**   |
| Use your existing Lightning wallet         | **NWC**     |
| Connect to your own LNBits server          | **LNBits**  |

> [!WARNING]
> Only **Spark** can send/receive on-chain Bitcoin and do zero-fee Spark transfers. NWC and LNBits are Lightning-only.

---

## Setup

<details>
<summary><b>🟣 Spark Wallet (self-custody)</b></summary>

1. **Create Wallet** on the welcome screen
2. Write down the **12-word seed phrase** — offline, on paper, twice
3. Verify the words in order
4. Done. You now have a **Business** and **Personal** account from the same seed

> [!CAUTION]
> Lose the seed → lose the coins. There is no recovery, no support line. Back it up *before* you receive funds.

</details>

<details>
<summary><b>🟢 NWC (Nostr Wallet Connect)</b></summary>

1. In your existing wallet (Alby, Primal, Mutiny…), generate an NWC connection string
2. In BuhoGO: **Connect Wallet → NWC**
3. Paste the string or scan the QR
4. Done

</details>

<details>
<summary><b>🟡 LNBits</b></summary>

1. Open your LNBits wallet, copy the **Admin API key** (not Invoice key)
2. In BuhoGO: **Connect Wallet → LNBits**
3. Enter `https://your-server.com` and the Admin key
4. Done

</details>

---

## Receive

| Tab          | Address looks like  | When to use                          |
| ------------ | ------------------- | ------------------------------------ |
| Lightning    | `lnbc…` invoice     | Default — fastest, smallest fees     |
| Spark        | `spark1…`           | Free transfer from another Spark user |
| Bitcoin (L1) | `bc1p…`             | From an exchange / cold wallet (Spark only) |

> [!NOTE]
> L1 deposits need **3 confirmations** (~30 min). Then tap **Claim** to make funds Lightning-spendable.

---

## Send

Open **Send**, then **scan / paste / pick a contact**. BuhoGO auto-detects the format:

| Input | Detected as |
| --- | --- |
| `lnbc…` | Lightning invoice |
| `name@domain.com` | Lightning address |
| `lnurl…` | LNURL |
| `spark1…` | Spark address (Spark wallets only) |
| `bc1…` / `bc1p…` | On-chain (Spark wallets only) |
| `bitcoin:…?lightning=…` | BIP-21 (chooses Lightning if possible) |

Confirm amount → swipe to send.

---

## Power features

| Feature              | Where                              | What it does                                              |
| -------------------- | ---------------------------------- | --------------------------------------------------------- |
| **Batch Send**       | Address Book → batch icon          | Pay many contacts in one flow with progress tracking      |
| **Internal Transfer**| Settings → Transfer Between Wallets | Move sats between your own wallets                       |
| **Auto-Transfer**    | Settings → Auto-Transfer           | Sweep funds to a destination when balance crosses a threshold |
| **Kiosk Mode**       | Settings → Kiosk Mode              | Lock the app to a PIN-protected POS keypad                |
| **Address Book**     | Main menu                          | Save contacts (Lightning / Spark / on-chain) with colors  |

---

## Kiosk Mode in 30 seconds

1. **Settings → Kiosk Mode**
2. Pick destination wallet
3. Set a 4-digit owner PIN
4. (Optional) Enable tips, round-up, choose currency
5. **Start Kiosk Mode**

Employees see only the keypad. Owner PIN unlocks settings. Deep links are blocked while locked.

---

## Switching wallets

Tap the wallet name at the top of the home screen → pick another wallet. Each wallet keeps its own balance, history, and auto-transfer rules.

---

## Settings worth knowing

| Setting               | What it controls                                             |
| --------------------- | ------------------------------------------------------------ |
| Theme                 | Dark / Light (remembered)                                    |
| Language              | EN / DE / ES                                                 |
| Display currency      | Sats or fiat (USD, EUR, …)                                   |
| Biometric unlock      | Fingerprint / face on Android                                |
| Show seed phrase      | View your Spark seed (re-entry of PIN required)              |
| Lightning Address     | LNBits wallets only — claim a `you@server` handle            |

---

## Troubleshooting

> [!TIP]
> 90% of issues are: wrong network, wrong key type, no internet. Check those first.

<details>
<summary><b>Spark</b></summary>

- **Can't restore?** Verify you typed all 12 words correctly, in order.
- **Balance shows 0 after claim?** Wait for 3 confirmations on the deposit, then re-tap Claim.
- **L1 withdrawal stuck?** Fee quotes expire. Re-quote and resubmit.

</details>

<details>
<summary><b>NWC</b></summary>

- **Connection failed?** Regenerate the NWC string in your source wallet.
- **Payments rejected?** Check the budget / permissions on the NWC connection.

</details>

<details>
<summary><b>LNBits</b></summary>

- **Connection failed?** URL must include `https://`. Try opening it in a browser first.
- **401 / 403?** You used the Invoice key instead of the Admin key.
- **CORS errors (self-hosted)?** Allow your BuhoGO origin in the LNBits config.

</details>

<details>
<summary><b>App / device</b></summary>

- **QR scanner won't open?** Grant camera permission in OS settings.
- **App crashes on launch?** Force-close, reopen. If persistent: reinstall — *back up your seed first*.
- **Status bar overlap (Android)?** Update to the latest version; safe-area was fixed.

</details>

---

## Tips for new users

1. **Backup before funding.** Never receive sats to a wallet you haven't backed up.
2. **Send $1 first.** Test the flow before moving real money.
3. **Verify addresses.** Bitcoin transactions are final — no chargebacks.
4. **Start with Spark + NWC.** Self-custody for savings, NWC for daily-driver flexibility.

---

## Get help

- 🐛 [GitHub Issues](https://github.com/Buho-Ecosystem/Buho_go/issues) — bugs and feature requests
- 💬 Open a discussion if you're unsure whether it's a bug
- 📖 [Use Cases](USE_CASES.md) — examples for common scenarios
