# Use cases for `receiverIdentityPubkey`

> Brainstorm doc — three concrete product ideas that lean on Spark's
> `createLightningInvoice({ receiverIdentityPubkey })` parameter.
> The key property: **Buho mints the invoice, but the sats settle
> directly into another Spark user's wallet — Buho never custodies.**
> Source: https://docs.spark.money/wallet-sdk/lightning/deposit#creating-invoices-for-other-spark-users

---

## What `receiverIdentityPubkey` actually does

When you call `wallet.createLightningInvoice({ amountSats, receiverIdentityPubkey })`,
the resulting BOLT11 is payable on the Lightning Network like any other
invoice — but the settlement target is the Spark identity whose pubkey
you passed, not the wallet that called the SDK.

That single primitive unlocks a class of features where one device or
service generates invoices on behalf of another user, with **zero trust
required** — the creator can't redirect, skim, or hold the funds.

---

## Use case 1 — Non-custodial Lightning Address (`alice@buho.app`)

**Problem.** Users want a human-readable Lightning Address (`alice@buho.app`)
they can publish on Twitter/Nostr/business cards. Today, every Lightning
Address either points at a custodial service (which can vanish with the
funds) or requires the user's own server to be online when an invoice is
requested. Mobile wallets fail the second test the moment the screen
locks.

**How `receiverIdentityPubkey` fixes it.** A small Buho-hosted endpoint
(LNURL-pay backend) holds nothing but a username → pubkey directory.
When someone resolves `alice@buho.app`, the endpoint calls
`createLightningInvoice({ receiverIdentityPubkey: alice.pubkey })` from
a service wallet. The invoice it returns settles directly into Alice's
Spark wallet — Buho never sees the sats, can't freeze them, can't
front-run them. Alice's phone can be turned off; the deposit lands the
moment she next opens the app.

**Why users care.**
- Real Lightning Address that works while the phone is locked or offline.
- No custodial risk — provably non-custodial by Spark's own guarantees.
- One-time setup: pick a username, done.

**Notes for implementation.** Needs a directory service (username →
pubkey), LNURL-pay HTTP shim, and rate limiting. The service wallet
that calls the SDK can be a single Buho-operated Spark wallet — its
balance never changes because nothing settles there.

---

## Use case 2 — Split-pay invoices for shared bills, podcasts, bands

**Problem.** Three friends share rent. A two-person podcast splits tips
50/50. A four-piece band splits gig pay. Today the "designated treasurer"
collects everything and has to remember to pay everyone back — friction,
trust, and a tax headache.

**How `receiverIdentityPubkey` fixes it.** A Buho "Split" object is a
list of `{ pubkey, share }` entries. When someone scans the split's QR
to pay 10,000 sats, Buho calls `createLightningInvoice` once per
recipient with the right `amountSats` and `receiverIdentityPubkey`,
then bundles them as either:
- a single LNURL-pay endpoint that returns multiple invoices in
  sequence (sender's wallet pays each), or
- BIP-353/multi-payment style where the sender's wallet handles the
  fan-out.

Every share lands in the right wallet on the first try. No
treasurer, no IOUs, no Venmo screenshots.

**Why users care.**
- "Set it once, never reconcile again" energy.
- Works for rent, group dinners, band gigs, family allowances.
- Receipts for everyone, automatically.

**Notes.** The Buho client can do all of this on-device — the splits
list lives in the local addressbook. No backend needed for the v1.

---

## Use case 3 — **Buho Beam: tap-to-pay between Buho phones** ⚡ (the hype one)

**The pitch.** Two Buho users, two phones, one tap. No QR codes, no
Lightning Address lookups, no copy-paste. Hold them together → sats
move. It feels like AirDrop. It works like Lightning. It's mathematically
non-custodial.

**How it works.**
1. **Discovery.** Each Buho phone advertises its Spark identity pubkey
   over BLE / NFC / a local Wi-Fi mDNS broadcast (configurable per
   user). No keys, no signing material — just the public identity.
2. **Trigger.** Sender opens "Beam," types an amount, taps the receiver
   phone (or picks them from a nearby-list).
3. **Invoice on the fly.** The sender's wallet calls
   `createLightningInvoice({ amountSats, receiverIdentityPubkey })`
   using the receiver's pubkey it just discovered.
4. **Pay.** The sender pays its own freshly-minted invoice. Spark
   settles directly to the receiver. End-to-end latency: under a second.

**Why this is hype-generating.**
- **Visceral demo moment.** Hold two phones together at a conference
  booth. Sats land. Crowd reacts. Twitter clip writes itself.
- **Reuses iconic UX.** "AirDrop for sats" is an instant cognitive hook
  — no one needs the technology explained.
- **Differentiated.** No other Lightning wallet does on-device,
  invoice-on-demand, non-custodial peer-to-peer-by-proximity. The
  combination is uniquely possible because of `receiverIdentityPubkey`.
- **Story for press.** "Buho is the first wallet where you can pay
  someone you've never met, with no server in the middle, by tapping
  your phones together." Headline writes itself.

**Why users care.**
- Splitting the bar tab without anyone reading out an invoice.
- Tipping a busker without typing a Lightning Address.
- Conference swag claims, meetup raffle payouts, on-stage tips.
- Zero counterparty risk: the invoice is created locally, paid locally,
  settles non-custodially.

**Notes.**
- Discovery is the hard part — pick BLE for "near me," NFC for "tap,"
  mDNS for "same Wi-Fi." Ship NFC first; it's the iconic moment.
- Receiver opt-in: a "Beam mode" toggle that times out after N minutes
  so the pubkey isn't broadcast indefinitely.
- Optional: signed nonce challenge to prevent pubkey spoofing on shared
  Wi-Fi (a malicious phone advertising someone else's pubkey would
  cause a successful payment to the wrong person — though they'd still
  receive it non-custodially, which is "wrong recipient" rather than
  "stolen funds").

---

## Honourable mentions

Not fleshed out, but worth noting for later:

- **Spark Drops** — creator publishes `[{pubkey, amount}]`, Buho mints
  one invoice per entry, anyone can pay the bundle to airdrop to the
  list. Feels like a community giveaway primitive.
- **Pre-paid event tabs** — organizer collects pubkeys at the door,
  sponsor pays a master invoice, attendees' drinks are auto-credited
  during the event.
- **Subscription receipts** — recurring payments where each cycle's
  invoice is minted with the subscriber's pubkey, so a hosted billing
  service can never hold the recipient's funds.
