# Bitrefill shop

Spend → Bitrefill opens Bitrefill's own shop, the [Bitrefill Widget](https://www.bitrefill.com/playground/), inside BuhoGO. Bitrefill runs the catalog, the checkout and the voucher delivery. BuhoGO opens the frame and pays the Lightning invoice the widget hands over, from any of the user's wallets, on the same confirm sheet as every other payment. The voucher then shows in the widget and arrives by email.

The widget's look is Bitrefill's. Only the documented `theme` and `hl` follow the app; no custom styles are injected.

## Before it works for everyone

Bitrefill approves each integration. Until BuhoGO is approved, the widget answers "Unverified Bitrefill Integration" for `utm_source=buhogo`. Two build-time values in `services/bitrefill/widget.js`:

| Variable | Default | What it is |
|---|---|---|
| `VITE_BITREFILL_UTM_SOURCE` | `buhogo` | The name Bitrefill approves. A local build can use Bitrefill's demo source, `bitrefill_demo`, which passes their check |
| `VITE_BITREFILL_REF` | empty | BuhoGO's referral code, credited on every purchase. Left out of the URL while empty |

Approval must cover the web app (`https://go.mybuho.de`) and the Android app, whose frame address is `https://localhost` (`androidScheme: https`).

## The flow

| Step | Who | What |
|---|---|---|
| First open | BuhoGO | `BitrefillEmailSheet` asks where vouchers go: once, suggested from the backup account's email, "Not now" allowed. Stored encrypted with the device key (`deviceCrypto`). The header's mail button changes or removes it later |
| Shopping | Bitrefill | `embed.bitrefill.com/?ref&utm_source&paymentMethods=lightning&showPaymentInfo=false&theme&hl&email`. With `email`, Bitrefill skips its own email step |
| Confirm | Bitrefill | With `showPaymentInfo=false` the widget shows "Final confirmation"; the user's tap sends `payment_intent` with the BOLT11 invoice |
| Pay | BuhoGO | `PaymentConfirmSheet`: Bitrefill as recipient, the invoice memo, the paying wallet, the price countdown from the invoice's expiry. `services/bitrefill/pay.js` pays like an internal transfer: NWC through `payWithNwc`, every other backend through `payInvoice({ invoice })`, then names the payment "Bitrefill" in History |
| After | Bitrefill | `invoice_update` (`payment_detected`) and `invoice_complete`; the widget shows the voucher, sealed until revealed, and emails it |

## Rules

- **Only the widget frame is heard.** A message counts when its origin is `https://embed.bitrefill.com` AND its source is the frame's own window (`parseWidgetMessage`). A page the widget opens, or the app itself, cannot start a payment.
- **One invoice is paid at most once.** `services/bitrefill/storage.js` keeps a ledger on the phone. `attempted` is written before the invoice reaches the wallet, `paid` after. An invoice that is `paid`, or `attempted` and never came back (the app closed mid-send), is never handed to a wallet again; the user is told to check the order in the shop.
- **A refusal is checked against the widget.** When the wallet throws, the page waits up to 4 s for the widget to report the payment before calling it failed. Only then is the invoice `failed` and may be retried. An NWC "unconfirmed" outcome stays `attempted`.
- **An expired price is never paid.** The countdown reaching zero, or `invoice_update: expired`, closes the sheet.
- **Lightning only.** `paymentMethods=lightning`; any other method in an intent is refused. Arkade wallets cannot pay Lightning and show as unable in "Pay with".
- **Kiosk mode cannot reach it**, like every route (`boot/kiosk.js`).

## Android

`MainActivity` lets the WebView accept cookies set inside frames (`setAcceptThirdPartyCookies`). Without it the widget would lose its session between steps. Checked on the emulator: the widget loads with the demo source, and its consent choice survives leaving and reopening the shop.

## Checks

- `src/services/bitrefill/__tests__/widget.spec.js` (in `npm test`): the URL, the message filter, the invoice of an intent, the ledger, the email at rest.
- `npm run check:bitrefill`: the real widget (email step, documented parameters, encrypted email), then a stand-in widget at the real origin for the payment: paid once, refused, the widget's "paid" winning over a wallet error, an expired price, forged messages. Start the dev server with `VITE_BITREFILL_UTM_SOURCE=bitrefill_demo` first.

## Not yet

Signing in to a Bitrefill account (the widget hides Login), voucher codes kept in BuhoGO, and reopening past orders all need Bitrefill: the widget's messages carry neither the code nor the order's access token. Asked of Bitrefill in the integration proposal.
