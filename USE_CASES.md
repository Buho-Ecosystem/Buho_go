# BuhoGO Use Cases

> Real scenarios. What to tap. Why it works.

[← README](README.md) · [User Guide](Guide.md)

---

## "I want to…" cheat sheet

| I want to…                      | Do this                                                |
| ------------------------------- | ------------------------------------------------------ |
| Pay a friend                    | **Send** → paste or scan their address                 |
| Pay someone on Nostr            | **Send** → paste their npub or `name@domain`           |
| Send to a phone number          | **Send** → type the number (Kenya and Zambia)          |
| Get paid                        | **Receive** → share your QR or Lightning address       |
| Receive from an exchange        | **Receive → Bitcoin** → share `bc1p…`                  |
| Move to a hardware wallet       | **Send** → paste BTC address → choose fee              |
| Pay several people at once      | **Address Book → Batch Send**                          |
| Find a shop that takes Bitcoin  | **Map**                                                |
| Learn Bitcoin and earn sats     | **Learn & Earn**                                       |
| Run a point of sale             | **Settings → Kiosk Mode**                              |
| Auto-sweep to cold storage      | **Settings → Auto-Transfer**                           |
| Move funds between my wallets   | **Settings → Internal Transfer**                       |

---

## Everyday

> [!TIP]
> Both on Spark? Use the `spark1…` address for zero fees, instantly.

<details open>
<summary><b>💸 Splitting a dinner bill</b></summary>

Your friend shares their Lightning address (`alice@wallet.com`). You tap **Send**, paste it, enter the amount, swipe. Done in seconds. No bank app, no IBAN. BuhoGO even shows their wallet's logo so you know it landed at the right place.

</details>

<details>
<summary><b>📱 Sending to a phone number</b></summary>

In Kenya or Zambia, just type the recipient's phone number into **Send**. BuhoGO recognises it and routes the payment through the local partner. No address to copy, no app the other person needs to install first.

</details>

<details>
<summary><b>🟣 Paying someone on Nostr</b></summary>

Got their npub or a `name@domain` handle from their profile? Paste it into **Send**. BuhoGO looks up where to pay and shows you who you are about to zap before you confirm.

</details>

<details>
<summary><b>🎁 Tipping a creator</b></summary>

Grab their Lightning address from their bio. Send $0.50 if you like. Lightning fees make micro-tips actually viable, and the creator keeps 100%.

</details>

<details>
<summary><b>🌍 Money from family abroad</b></summary>

**Receive → Lightning**, then share the QR over WhatsApp. It arrives in minutes regardless of country. No SWIFT, no five-day wait, no foreign-exchange cut.

</details>

<details>
<summary><b>👥 Paying multiple people</b></summary>

Save them in the **Address Book** once. Then **Batch Send → select all → enter amounts → review → send**. One flow, progress for each person, retry if one fails.

</details>

---

## Spend it in the real world

<details open>
<summary><b>🗺️ Finding a place that takes Bitcoin</b></summary>

Open the **Map**. It shows cafes, shops, and services near you that accept Bitcoin. Search by name, filter by category, and pay straight from your wallet once you arrive.

</details>

<details>
<summary><b>✈️ Paying while travelling</b></summary>

Already loaded with sats? Scan the merchant's QR and pay. Same money in every country. No foreign-exchange surcharge, no declined-card surprises.

</details>

---

## Learn Bitcoin and earn sats

<details open>
<summary><b>🎓 Learn & Earn</b></summary>

Open **Learn & Earn** for a guided, bite-size course on Bitcoin and Lightning. Every question you answer correctly earns you one sat. Once you have built up enough, claim them straight into your wallet. It is the rare lesson that pays you back.

</details>

---

## On-chain (Spark only)

<details open>
<summary><b>🏦 Withdrawing from an exchange</b></summary>

**Receive → Bitcoin**, copy the `bc1p…` address, and paste it into the exchange withdrawal. Wait for 3 confirmations (around 30 minutes), then tap **Claim**. The funds become Lightning-spendable instantly. No channel management.

</details>

<details>
<summary><b>🥶 Moving to cold storage</b></summary>

**Send**, paste your hardware wallet's BTC address, pick a fee speed, confirm.

</details>

<details>
<summary><b>📥 Receiving a large on-chain payment</b></summary>

Same flow as the exchange case. The sender pays from anywhere, you claim once it is confirmed, and then it is Lightning-ready.

</details>

---

## Business

> [!IMPORTANT]
> Running a point of sale? Combine **Kiosk Mode** with **Auto-Transfer**. Employees touch nothing sensitive, and balances flow to your safe destination automatically.

<details open>
<summary><b>☕ Café point of sale</b></summary>

**Settings → Kiosk Mode**, pick your Business wallet, set a 4-digit PIN, and configure tips. Employees see only the keypad. Customers scan and pay. No monthly fees, no chargebacks.

</details>

<details>
<summary><b>🍹 Tips as a service worker</b></summary>

Print the QR of your Spark address and display it at your station. Tips land directly in your wallet. No pool, no payroll wait.

</details>

<details>
<summary><b>🔁 Auto-forward takings to cold storage</b></summary>

**Settings → Auto-Transfer**, select your point-of-sale wallet, set a threshold (say 100,000 sats), set the destination to your hardware wallet's BTC address, and enable it. Anything above the threshold sweeps automatically.

</details>

<details>
<summary><b>💼 Freelance invoice</b></summary>

**Receive**, create an invoice for the agreed amount, and send it to your client. They pay, you keep 100%. No PayPal cut, no wire fees.

</details>

---

## Travel and safety

<details open>
<summary><b>✅ Knowing your payment is safe</b></summary>

When a destination is **Branta verified**, BuhoGO shows a badge before you send, confirming the address really belongs to who you think. Combined with the wallet-logo recognition on the send screen, you get a clear "this is right" moment before you part with money.

</details>

<details>
<summary><b>🆘 Lost your phone abroad</b></summary>

Self-custody is the safety net. Install BuhoGO on any device, restore with your 12 words, and your funds are back. Find a Bitcoin ATM or a peer-to-peer swap to turn them into cash.

</details>

---

## Privacy

<details>
<summary><b>🤫 Donations off your bank statement</b></summary>

Send over Lightning to the organisation's address. It does not show up on a bank statement, and there are no data brokers in the loop.

</details>

<details>
<summary><b>🛒 Buying without surveillance ads</b></summary>

Pay merchants who accept Bitcoin instead of card. No card-network tracking, so no eerie recommendations the following week.

</details>

---

## Starter paths

| You are…                        | Recommended path                                                    |
| ------------------------------- | ------------------------------------------------------------------- |
| **New to Bitcoin**              | Create a Spark wallet, back up the seed, receive $5, send $1 to a friend |
| **Already have a LN wallet**    | Connect via NWC, keep your funds where they are, enjoy a nicer interface |
| **Want maximum security**       | Spark wallet, seed on paper in two locations, biometric lock, Auto-Transfer to cold storage |
| **Running a small business**    | Spark "Business" account, Kiosk Mode, Auto-Transfer to your main wallet |

---

## Still stuck?

[User Guide](Guide.md) · [GitHub Issues](https://github.com/Buho-Ecosystem/Buho_go/issues)
</content>
