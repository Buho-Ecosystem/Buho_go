# BuhoGO — Use Cases

> Real scenarios. What to tap. Why it works.

[← README](README.md) · [Guide](Guide.md)

---

## "I want to…" cheat sheet

| I want to…                      | Do this                                                |
| ------------------------------- | ------------------------------------------------------ |
| Pay a friend                    | **Send** → paste / scan address                        |
| Get paid                        | **Receive** → share QR or Lightning address            |
| Receive from an exchange        | **Receive → Bitcoin** → share `bc1p…`                  |
| Withdraw to a hardware wallet   | **Send** → paste BTC address → choose fee              |
| Pay 5 contributors at once      | **Address Book → Batch Send**                          |
| Run a POS                       | **Settings → Kiosk Mode**                              |
| Auto-sweep to cold storage      | **Settings → Auto-Transfer**                           |
| Move funds between my wallets   | **Settings → Internal Transfer**                       |

---

## Everyday

> [!TIP]
> Both on Spark? Use the `spark1…` address — **zero fees, instant.**

<details open>
<summary><b>💸 Splitting a dinner bill</b></summary>

Friend paid. They share their Lightning address (`alice@wallet.com`). You: **Send → paste → amount → swipe**. Done in seconds. No bank app, no IBAN.

</details>

<details>
<summary><b>🎁 Tipping a creator</b></summary>

Grab their Lightning address from their bio. Send $0.50 if you want — Lightning fees make micro-tips actually viable. Creator gets 100%.

</details>

<details>
<summary><b>🌍 Money from family abroad</b></summary>

**Receive → Lightning** → send the QR via WhatsApp. Arrives in minutes regardless of country. No SWIFT, no 5-day wait, no FX cut.

</details>

<details>
<summary><b>👥 Paying multiple contributors</b></summary>

Save them in **Address Book** once. Then **Batch Send → select all → enter amounts → execute**. One flow, progress per contact, retry on failure.

</details>

---

## On-chain (Spark only)

<details open>
<summary><b>🏦 Withdrawing from an exchange</b></summary>

**Receive → Bitcoin** → copy `bc1p…` → paste in exchange withdrawal. Wait for 3 confirmations (~30 min) → tap **Claim**. Funds become Lightning-spendable instantly. No channel management.

</details>

<details>
<summary><b>🥶 Moving to cold storage</b></summary>

**Send** → paste your hardware wallet's BTC address → pick fee speed → confirm.

</details>

<details>
<summary><b>📥 Receiving a large on-chain payment</b></summary>

Same flow as the exchange case. Sender pays from anywhere, you claim when confirmed, then it's Lightning-ready.

</details>

---

## Business

> [!IMPORTANT]
> Run a POS? Combine **Kiosk Mode** + **Auto-Transfer**. Employees touch nothing sensitive; balances flow to your safe destination automatically.

<details open>
<summary><b>☕ Café POS terminal</b></summary>

**Settings → Kiosk Mode** → pick your Business wallet → set 4-digit PIN → configure tips. Employees see only the keypad. Customers scan & pay. No monthly fees, no chargebacks.

</details>

<details>
<summary><b>🍹 Tips as a service worker</b></summary>

Print the QR of your Spark address. Display at your station. Tips land directly in your wallet — no pool, no payroll wait.

</details>

<details>
<summary><b>🔁 Auto-forward POS to cold storage</b></summary>

**Settings → Auto-Transfer** → select POS wallet → threshold (e.g. 100k sats) → destination = your hardware wallet's BTC address → enable. Excess sweeps automatically.

</details>

<details>
<summary><b>💼 Freelance invoice</b></summary>

**Receive** → invoice for the agreed amount → send to client. They pay, you keep 100%. No PayPal cut, no wire fees.

</details>

---

## Travel

<details>
<summary><b>✈️ Paying in another country</b></summary>

Already have BuhoGO loaded with sats? Scan merchant QR → pay. Same money, every country. No FX surcharge, no declined-card surprises.

</details>

<details>
<summary><b>🆘 Lost your wallet abroad</b></summary>

Self-custody safety net: install BuhoGO on any device → restore with your 12 words → access funds. Find a Bitcoin ATM or P2P swap to get cash.

</details>

---

## Privacy

<details>
<summary><b>🤫 Donations off your bank statement</b></summary>

Send via Lightning to the org's address. Doesn't appear on bank statements. No data brokers in the loop.

</details>

<details>
<summary><b>🛒 Buying without surveillance ads</b></summary>

Pay merchants who accept Bitcoin instead of card. No card-network tracking → no eerie recommendations next week.

</details>

---

## Starter paths

| You are…                        | Recommended path                                                    |
| ------------------------------- | ------------------------------------------------------------------- |
| **New to Bitcoin**              | Create Spark wallet → back up seed → receive $5 → send $1 to a friend |
| **Already have a LN wallet**    | Connect via NWC → keep funds where they are, get a nicer interface  |
| **Want max security**           | Spark wallet → seed on paper in 2 locations → biometric lock → Auto-Transfer to cold storage |
| **Running a small business**    | Spark "Business" account → Kiosk Mode → Auto-Transfer to main wallet |

---

## Still stuck?

[Guide](Guide.md) · [GitHub Issues](https://github.com/Buho-Ecosystem/Buho_go/issues)
