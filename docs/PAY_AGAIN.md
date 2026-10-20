# Pay again

A completed payment to a recipient that can be paid again offers Pay again:
swipe its row in History to the left (a full swipe, past half the row), or
tap the Pay again row at the end of its Transaction Details. Both hand the
recipient to the one send pipeline, the same hand-over as a contact tap, with
the last amount filled in. The user still sees the confirm sheet and always
confirms on the slide, whatever the amount. Nothing is paid by the swipe.

## Payments to this recipient

On a receipt for a recipient that can be paid again, the To row and More
options open how often and how much was paid to it: the amount sent (fees
left out, fiat at today's rate) and the number of payments since the first,
then each payment by month (each opens its receipt, the one you came from
always listed and marked), and Pay again. Nothing is added to the receipt but
the row's chevron. The list joins the first page of every wallet's history
(or the list History last showed, for a wallet without a provider or whose
provider fails) through `services/recipientPayments.js`, the same matching a
contact's "Between you" uses. When a wallet answered with a full page, older
payments may exist, so the figures say "recently" instead of "since".

## What can be paid again

Only what the user chose to pay, recorded by the main send flow at send time
(`Wallet.vue` `payAgainRecordFor`):

- a Lightning address, including a phone-number payout;
- a reusable pay link (LUD-11, `disposable: false`), the link that was paid;
- a Spark or Arkade address;
- a Bitcoin (on-chain) address, typed, pasted or from a code that carries
  only the address. Reusing it is the user's choice, as when typing it again.

Never: an invoice, a Spark invoice, a payment code that names one order (an
amount, a Lightning invoice or offer, a native `spark=`/`ark=` address, a
payjoin endpoint or a `req-` parameter next to it), a verified business, a
till or checkout code, a Nostr profile's address (it can
change; the profile is resolved again next time), batch sends, kiosk sales,
transfers between own wallets, Auto-Transfer and purchases.

An on-chain send has no address stamp to be matched by, so its record is
queued on its own with the id the send returned (Spark: the withdrawal id;
Arkade: the transaction id) and waits for exactly that payment; the History
row keeps its "Bitcoin sent" title.

The amount is the amount the user entered: what the recipient was sent, not
the fee-inclusive total (an Arkade on-chain send takes its network fee out of
that amount).
When the user paid in the recipient's own currency (LUD-21) from a wallet
that sends it as such (Spark, Arkade, LNbits), that amount is kept too, and
the sheet starts in that currency while the recipient still offers it and
the amount is within its limits. Otherwise it starts in sats.

## Why the record needs proof

Other stamps on a payment (recipient address, contact, service identity) can
be matched to it by time or guessed. A wrong label is harmless; a wrong
recipient on Pay again would be a payment to the wrong place. So the record
carries the ids the send returned (Spark payment id, LNbits and NWC payment
hash, preimage), and `consumePendingContactLinks` stamps it only on the
payment that carries one of them. Without that proof the payment simply has
no Pay again. Payments made before this shipped have none, except the LUD-11
row Transaction Details has always offered (`withPayLink`), which the History
swipe leaves out because that link can be stamped by time alone.

## Code boundaries

- `utils/payAgain.js`: the record, its proof, and `payAgainTarget` (the one decision).
- `stores/transactionMetadata.js`: queues the record with the send, stamps it on proof.
- `composables/usePayContact.js` `payAgain`: the hand-over (`prefillAmount`, `prefillPayout`, `repeat=1`, return route).
- `Wallet.vue`: records the send, reads the hand-over, `repeat` forces the slide.
- `TransactionHistory.vue`: the swipe (Quasar slide item, slot only on rows that qualify).
- `TransactionDetails.vue`: the Pay again row; the To row and More options open the payments.
- `services/recipientPayments.js`: the payments to one recipient, shared with a contact's "Between you".
- `RecipientPaymentsSheet.vue`: the totals, the list, Pay again.

## Checks

- Unit: `payAgain`, `transactionMetadata` (proof only), `usePayContact`, `recipientPayments`, `walletFlow` (record, exclusions, hand-over, sheet).
- Browser: `node scripts/check-pay-again.mjs` against `pnpm dev --port 9036` (or `PAY_AGAIN_BASE_URL`): which rows slide, a short swipe springs back, a full swipe and the Details row open the sheet with the last amount and the slide and come back, light, dark and German.
- Device: that each wallet type's payments get the record (the ids line up; Arkade's on-chain id is unverified), Android's back-gesture edge.

Screens: `docs/images/pay-again/`, from `scripts/check-pay-again.mjs`.
