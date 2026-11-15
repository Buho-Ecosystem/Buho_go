# Bitrefill shop

Spend → Bitrefill opens Bitrefill's own shop, the [Bitrefill Widget](https://www.bitrefill.com/playground/), inside BuhoGO. Bitrefill runs the catalog, the checkout and the voucher delivery. BuhoGO opens the frame and pays the invoice the widget hands over, from any of the user's wallets, on the same confirm sheet as every other payment. The order then shows in the widget and arrives by email.

The widget's look is Bitrefill's. Only the documented `theme` and `hl` follow the app; no custom styles are injected.

## Before it works for everyone

Bitrefill approves each integration. Until BuhoGO is approved, the widget answers "Unverified Bitrefill Integration" for `utm_source=buhogo`. So the shop is **off by default**: a build without `VITE_BITREFILL_ENABLED=true` keeps the "Bitrefill is on its way" sheet on the Spend row, and `/bitrefill` leads back to Spend (`bitrefillEnabledOnly` in `router/routes.js`).

Build-time values in `services/bitrefill/widget.js`:

| Variable | Default | What it is |
|---|---|---|
| `VITE_BITREFILL_ENABLED` | off | `true` opens the shop. Leave it unset until Bitrefill approved the integration |
| `VITE_BITREFILL_UTM_SOURCE` | `buhogo` | The name Bitrefill approves. A local build can use Bitrefill's demo source, `bitrefill_demo`, which passes their check |
| `VITE_BITREFILL_REF` | empty | BuhoGO's referral code, credited on every purchase. Left out of the URL while empty |

Approval must cover the web app (`https://go.mybuho.de`) and the Android app, whose frame address is `https://localhost` (`androidScheme: https`).

## The flow

| Step | Who | What |
|---|---|---|
| First open | BuhoGO | `BitrefillEmailSheet` asks for the email Bitrefill sends the vouchers to ("Email for your vouchers", field "Send vouchers to", button "Use this email"): once, suggested from the backup account's email, "Not now" allowed. Stored encrypted with the device key (`deviceCrypto`). The header's mail button changes it later: the sheet then says the change applies to the next order and reloads the shop, and removing it asks first |
| Shopping | Bitrefill | `embed.bitrefill.com/?ref&utm_source&paymentMethods=lightning&showPaymentInfo=false&theme&hl&email`. With `email`, Bitrefill skips its own email step |
| Confirm | Bitrefill | With `showPaymentInfo=false` the widget shows "Final confirmation"; the user's tap sends `payment_intent` with the invoice |
| Pay | BuhoGO | `PaymentConfirmSheet`: Bitrefill as recipient with the product under its name, the paying wallet (the default wallet from Settings when it can pay), the price countdown, the fee and the total when the wallet can quote them (Spark), and always the slide. `services/bitrefill/pay.js` pays: NWC through `payWithNwc` with the store's `nwcPayOptions`, Spark capped at the quoted fee, every other backend through `payInvoice({ invoice })`. The payment is named "Bitrefill" in History and carries the order's reference as its note |
| After | Bitrefill | `invoice_update` (`payment_detected`) and `invoice_complete`; the widget shows the voucher, sealed until revealed, and emails it |

## What the app says, and when

Paid means settled. The app never calls an order paid because a wallet call returned.

| What happened | What the user gets | Ledger |
|---|---|---|
| The wallet settled the payment | The sheet's finished state, the success haptic, "Paid. Bitrefill is preparing your order." | `paid` |
| The wallet answered "still on its way" | The sheet closes, "This payment is on its way. Your order shows in the shop as soon as it arrives." No haptic | `attempted` |
| The widget then reports it paid | "Paid. Bitrefill is preparing your order.", the success haptic | `paid` |
| The outcome cannot be told | The sheet closes, "We couldn't confirm this payment. Check History before ordering again." (NWC: its own "not confirmed" explanation), the warning haptic | `attempted` |
| The wallet refused, certainly | The wallet's error, the error haptic; the sheet stays for another try | `failed` |
| Bitrefill reports the order delivered | "Your order is ready. It shows in the shop and arrives by email." | note `delivery` |
| Bitrefill took the money and could not deliver | One plain line under the header, "Bitrefill could not deliver an order. Follow the refund steps in the shop, or in the email from Bitrefill.", kept until dismissed, also on the next visit | note `delivery: refund` |
| Bitrefill refunded | "Bitrefill refunded this order." | note `refunded` |

Leaving while an order is on screen or still unresolved asks first ("Leave the shop?"). The header's back button always leads to Spend, whatever the frame did to the browser history.

## Rules

- **Only the widget frame is heard.** A message counts when its origin is `https://embed.bitrefill.com` AND its source is the frame's own window (`parseWidgetMessage`). A page the widget opens, or the app itself, cannot start a payment.
- **The invoice decides.** Amount, expiry and identity are read from the invoice, never taken from the message. Only a mainnet invoice is paid. When the message states an amount in BTC, it must be the invoice's amount (one sat of rounding); otherwise the order is refused.
- **One invoice is paid at most once.** `services/bitrefill/storage.js` keeps a ledger on the phone, found by the invoice's payment hash first and the widget's order id second, so the same invoice under another order id is the same payment. `claim` checks and records `attempted` in one step before the invoice reaches the wallet (on the web also across tabs, through a Web Lock). An invoice that is `paid` or `attempted` is never handed to a wallet again.
- **Only a definite refusal frees an invoice.** `isDefiniteRefusal` in `pay.js`: the invoice never reached a wallet, the wallet reported the payment failed, an NWC wallet refused (`payWithNwc` turns every unknown outcome into "unconfirmed" itself), the fee was above the shown limit, or an LNbits server answered with a plain refusal. Every other error is unknown: the page waits up to 4 s for the widget to report the payment, then asks the paying wallet by payment hash (`probeBitrefillPayment`). Not found is not "failed".
- **Unresolved attempts are settled later.** Every time the shop opens, attempts still `attempted` are looked up in the wallet that paid them. Paid and failed are recorded; anything else stays blocked.
- **An expired price is never paid**, and neither is one with less than 15 s left (`EXPIRY_MARGIN_SECONDS`): on intent, on confirm, and again after the wallet connected. The countdown reaching that point, or `invoice_update: expired`, closes the sheet and says so.
- **The sheet cannot be closed out of a payment.** Its close button does nothing while a payment is out or its finished state shows, and no second order replaces the one on screen.
- **Lightning only.** `paymentMethods=lightning`; any other method in an intent is refused. Arkade wallets cannot pay it and show as unable in the wallet picker.
- **Kiosk mode cannot reach it**, like every route (`boot/kiosk.js`).

## Cookies

The widget keeps its checkout session in a cookie inside the frame, a third-party cookie to the app's WebView.

- **Android.** WebViews refuse third-party cookies by default, and the app keeps that default. `FrameCookiesPlugin` turns them on while the shop page is mounted and off when it leaves (`services/bitrefill/frameCookies.js`), so no other remote content the app shows can set or read one. Nothing is persisted: a new WebView starts with the default.
- **iOS. Open device check.** WKWebView blocks cross-site cookies in frames through its tracking prevention, and there is no per-screen switch. If the widget loses its session between steps on an iPhone, the options are the `NSCrossWebsiteTrackingUsageDescription` setting (a system toggle the user must turn on) or asking Bitrefill for a cookie-less session. Not checked on a device.
- **Web.** The browser decides; browsers that block third-party cookies may show the same loss of session. Not checked.

## Checks

- `src/services/bitrefill/__tests__/widget.spec.js`: the URL, the message filter, the invoice of an intent (mainnet only, amount check), refunds and delivery, the ledger (payment hash, claim, old entries), the email at rest.
- `src/services/bitrefill/__tests__/pay.spec.js`: what a wallet's answer means (settled, on its way, failed) for Spark-shaped and LNbits-shaped results, the expiry margin, which errors free an invoice, asking a wallet by payment hash.
- `src/pages/__tests__/bitrefillPage.spec.js`: the page's outcomes end to end with a stand-in wallet, never paying twice, the price, the refund line, leaving, the email.
- `npm run check:bitrefill`: a browser run. Part 1 uses the real widget (email step, documented parameters, encrypted email); `BITREFILL_MOCK_ONLY=1` skips it. Part 2 puts a stand-in widget at the real origin and pays with a stand-in wallet. Start the dev server with `VITE_BITREFILL_ENABLED=true VITE_BITREFILL_UTM_SOURCE=bitrefill_demo` first.

Still open, all needing a device or the real service:

- The widget's real messages: the unit of `paymentAmount`, and the values of `deliveryStatus` and `refundNeeded` in `invoice_complete`. The app reads them as documented and leaves anything it cannot read unjudged.
- Cookies on Android (the scoped switch on a real phone), on iOS and in browsers that block third-party cookies.
- Keyboard avoidance for the email sheet and for fields inside the frame.
- A funded payment from each wallet type.

## Not yet

Signing in to a Bitrefill account (the widget hides Login), voucher codes kept in BuhoGO, and reopening past orders all need Bitrefill: the widget's messages carry neither the code nor the order's access token. Asked of Bitrefill in the integration proposal. The widget's theme and language are set when it loads and do not follow a change made while the shop is open, because reloading it would empty the cart.
