# Business checks and saved verification

[← Feature records](README.md)

Before sending, BuhoGO can match a payment destination to a business registered with [Branta](https://branta.pro). A matched business is the recipient: its logo, its name and the line "Verified business" with the seal sit in the recipient row of the payment review. The paid screen says "To <name>" with the same mark and seal, and History and the receipt keep the name. Unmatched, unsupported or unavailable checks keep the ordinary recipient; they are not errors.

One name and one icon are used everywhere: "Business check" for the feature and its view (Settings, the sheet, the receipt), "Verified business" for the state, and the seal.

The review keeps BuhoGO's colors, typography, wallet selector and confirmation gestures. Fee, optional note and total are grouped in one card. Bitcoin on-chain speed selection and its SDK fee breakdown remain directly visible, with their existing controls.

## Verification when requested

| Context | Entry and behavior |
|---|---|
| Before paying | Tapping the recipient row opens the business check in the same sheet; Back returns to the review. Info opens Payment details, which has a Business check row too; Back from there returns to details. Amount, wallet and note are unchanged either way. |
| After paying | The seal in the receipt header opens the saved business check as a bottom sheet over the receipt, like the page's other sheets. Done, Escape, a swipe or Back closes it. No new Branta lookup is made. |

BrantaVerificationDetails is shared by both hosts. Current and historical wording differ. New snapshots contain the historical check time; older records without a timestamp never receive an invented time. Missing artwork uses the business's initial next to its name, never a generic mark.

The external record opens only when View Branta record is tapped; it is a secondary link, never the screen's main action. Invalid URLs are omitted. A failed explicit open offers a short retry message, without a diagnostic report. The receipt's sheet is an ordinary dialog: it owns Back, Escape and focus return, and the page has no back handling of its own.

Branta's wordmark (`public/images/branta/wordmark-on-light.svg`) is the original from <https://www.branta.pro/brand/wordmark-on-light.svg>, bundled so the check view never requests provider branding over the network. Paths, proportions and colours are unchanged. In the dark theme it sits on a quiet light plate; it is not filtered or recoloured. Brand guidance: <https://www.branta.pro/brand>.

## SDK and destination binding

The public, read-only adapter uses pinned Branta JavaScript SDK 4.3.0 and its verify API. No publishing key or merchant backend is included.

Original request/proof parameters remain intact. Duplicate proof or destination keys, including encoded spellings, are rejected instead of normalized into a different payment. A match qualifies only when a decrypted matched destination belongs to the payment supplying the business identity. Conflicting owners and incomplete responses remain ordinary.

| Existing BuhoGO route | Verification boundary |
|---|---|
| Lightning invoice | Exact invoice actually paid. |
| Arkade address | Exact address, on every wallet BuhoGO can pay it from. |
| Bitcoin request with Branta proof | Preserve the full code for SDK decryption, then bind the selected destination. |
| Unified request | A matching sibling destination does not verify the selected route. |
| Spark-optimized Lightning | No identity when the SDK does not expose a matching native destination. Routing is not changed to obtain verification. |
| First-party BuhoGO requests and curated retail | Existing exclusions remain. |
| Unsupported/unexposed destinations | Ordinary payment behavior. SDK version alone does not establish new Spark/network support. |

The same SDK preparation that selects the route reports that route (`preparedRoute`). If a refreshed Spark preparation selects another destination before debit, the provider's `onPreparedRoute` callback stops submission (`PAYMENT_REVIEW_REQUIRED`) and the sheet returns with one plain line saying the business check is not available. It does not alter routing, send automatically or bypass fee limits. The provider knows nothing about the check itself.

Logo and record URLs must be on the configured Branta origin. The SDK enforces the same rule for logos (it refuses a record whose logo is on another origin), so this does not drop real artwork.

## Timing and ownership

All of it lives in `src/services/brantaVerification.js`. `createBrantaVerification` is one lookup session for one payment request: it retains the original input, the lookup generation, the binding to wallet, amount and route, and a latched changed-code result. `createBrantaReview` is what the sheet needs around it: which destination is actually paid, the business accepted at confirm, the guard on the prepared route and the snapshot for the receipt. The wallet page supplies live facts, watches one key and reads the result from the payment; it holds no check state. The check writes only its result (`branta`, `brantaMismatch`) to the payment object: the page re-estimates fees whenever that object changes, so the route a wallet prepared is kept beside it, not on it.

The foreground wait is bounded at two seconds; the lookup deadline is ten seconds. Cached answers have a bounded lifetime. A late normal match cannot replace the settled presentation under a finger.

Stale checks refresh at confirmation. What happens then:

| At confirm | Result |
|---|---|
| Same business as reviewed, or still no match | The payment is sent. |
| A check that only now finished and found a business | The payment is sent; the paid screen and the receipt name the business. The destination is the one the person confirmed. |
| Another business than the one reviewed | The send stops. The row shows the new business and one line says "The recipient changed. Review it before sending." |
| The reviewed business cannot be confirmed again | The send stops once. One line says the business check is not available; the next tap sends, without the claim. There is no loop. |
| The recheck is still unanswered (slow link) | The reviewed business is kept and the payment is sent. The sheet does not flicker to the checking state. |
| A changed code | The payment stops. There is no Send action. |

The accepted snapshot is fixed for the attempt; later SDK events cannot substitute another business. Cancellation, replacement, wallet changes, disposal and a completed send invalidate old work. Changed-code results block Send and dominate wallet/details child views.

The changed-code screen says Ask for a new code, explains that the code changed and reassures that nothing was sent. There is no Send action or bypass.

## Historical records and privacy

A saved check keeps what a receipt shows: the business's name, logos and description, the check time, the environment and the record URL. The paid destination and SDK fields are not saved with it. The existing transaction metadata store is reused. A verified business is attached only to the payment its ids prove (the wallet's payment id, hash or preimage, or the invoice's payment hash), in the wallet that paid; amount or time alone never attach one. When no payment proves it within ten minutes, only the claim is dropped: contact, address, label and refund address are stamped as for any other send. A first accepted historical identity is not silently replaced; history never runs a fresh verification.

Record URLs may contain decryption fragments. They stay in local transaction metadata and are not added to payment notes or diagnostic logging. The existing metadata backup API includes the saved snapshot, so such backups remain private payment data. Record/logo URLs require HTTPS and the exact configured Branta origin; credentials and arbitrary record paths are refused.

The SDK performs client-side encrypted lookups. This does not justify absolute anonymity claims: services and image hosts observe ordinary network metadata. Offline artwork is best effort; saved names and check data remain readable without it.

Settings → Advanced → Business check retains the persisted preference and defaults. Its short footer avoids an absolute privacy promise. Production builds use Production; Staging can be selected only in development.

## Other payment paths

| Path | Business check | Amount entry |
|---|---|---|
| Kiosk | Not used; kiosk has its own pages and never mounts the review sheet. | Unchanged. |
| Bolt Card redeem | Not checked (a redeem is a receive). It uses the same sheet, so the amount entry rules apply. | Shared util. |
| Batch send | Not checked, as before. | Shared util: a comma is never dropped. |
| Transfer between own wallets | Not checked; both sides are the person's own. | Shared util: a decimal is refused, never cut off. |
| Auto-Transfer, shop purchases | Not checked, as before. | No typed amount at send time. |

## Amount correctness

Amounts are written one way on every screen: in the phone's number format, like the balance, the paid screen, the receipt and History. The formatter is `src/utils/amountFormatting.js` (`paymentAmountParts`, `formatPaymentAmount`, `formatFiatAmount`); the fiat line under the amount uses it too, so separators never mix on one sheet. Raw entered values and canonical satoshis remain separate. Hero, denomination, fees, total and slide use consistent units, including the existing Bitcoin-format preference. A fixed amount shown in fiat keeps its approximate sign. The tap action is simply Send.

Entry (`src/utils/paymentAmountInput.js`) reads the decimal separators of both the app language and the phone, because the keypad's decimal key follows the phone. It validates grouping and fractional precision without stripping punctuation into a different value. 10,5 stays 10.5, not 105, also with the app in English; grouped whole sats stay whole. One mark followed by one or two digits is a decimal. Three digits after a single mark could be thousands or a decimal where both readings exist, so that input is refused. Ambiguous or malformed input stays editable with Send disabled. The field itself always writes the phone's decimal mark, also while it is being typed in (`formatPaymentAmountDraft`); only the grouping waits until the field is left. A decimal the field wrote keeps its meaning while digits are added after it, so 1,234 BTC typed on a German phone stays 1.234 BTC. Entering the field drops the grouping at once and keeps the caret, or a whole selection, on the same digits, so typing over a selected amount replaces it.

BTC-to-satoshi conversion uses decimal digits and integer arithmetic: 0.00000029 BTC remains exactly 29 sats instead of losing a sat to binary floating-point multiplication. Existing payout, refund, card, quote and slide rules remain authoritative. A nonzero fiat fee smaller than a display cent is not mislabeled zero.

## Validation

- Adapter, timing, exact destination binding, provider pre-debit and merchant-metadata association regressions join the existing full suite.
- Payment-sheet tests cover exact conversion, grouped display, unit changes, payouts/refunds, unknown fees, child-view restoration and changed-code precedence.
- Receipt tests cover the saved check as a sheet, context resets and stale loads.
- The Branta browser harness uses the real public SDK with a local verifier and simulated wallet providers. No funds or external messages are sent.
- Payment-sheet, payment-preparation and full contact-chat browser checks retain money/state assertions.
- Screenshots cover current/historical details, review, changed codes, ordinary fallback, artwork failure, translations/enlarged text and both themes. Native-device acceptance is separate.

Run `npm test` and `npm run build` for the regression suite and production compilation. With a local dev server on port 9019, run:

```sh
BRANTA_BASE_URL=http://localhost:9019 npm run check:branta
PAYMENT_SHEET_BASE_URL=http://localhost:9019 npm run check:payment-sheet
PAYMENT_PREPARATION_BASE_URL=http://localhost:9019 npm run check:payment-preparation
CONTACT_CHAT_BASE_URL=http://localhost:9019 npm run check:contact-chat
```

## What can go wrong, and what stops it

| Risk | What stops it |
|---|---|
| One verified destination brands another route or sibling payment | The decrypted destination must match its owning business and the route the wallet actually prepared. Ambiguous owners remain ordinary payments. |
| A quote expires and Spark selects another route during submission | The prepared route is checked before the debit. The attempt is refused for another review, without disconnecting the wallet or reporting an error. |
| A late result changes the recipient under a finger | One lookup session is bound to request, wallet, amount and route, and its settled view is fixed. Changed-code results latch and block submission. |
| Returning to a route whose check had settled lets another route's late answer show | Every bind supersedes older waits, including the shortcut for a settled route. |
| A stale or changed business is silently accepted | Stale checks refresh at confirmation; another business requires review. Invalid or expired records cannot create a permanent match. |
| A receipt inherits branding from another payment | Wallet-scoped proof of the payment is required; time or amount alone, incoming payments and unscoped legacy records never qualify. The first accepted snapshot is kept. |
| Losing the seal costs a payment its contact | Only the claim waits for proof; the rest of the metadata is stamped as for any send. |
| A receipt shows a previous context while loading | The check is bound to the loaded route and wallet; stale loads are discarded and the sheet closes when the context changes. |
| Locale input changes the amount | Decimal and grouping structure is validated for the app language and the phone; ambiguous input is refused and stays editable. |
| Floating-point BTC conversion loses a satoshi | Decimal digits are converted with integer arithmetic. |
| Missing artwork, an offline service or unsupported routes block an ordinary payment | Initials or the ordinary recipient are shown; no-match and unavailable checks stay quiet. Only a changed code blocks. |
| External records or logos introduce unsafe URLs | Only the configured HTTPS Branta origin is accepted; credentials and other paths are refused. Records open only on request. |

Funded payments and native-device acceptance remain separate release checks.

### App screenshots

These are captures of the implemented Vue app using simulated businesses, providers and payments, made by `npm run check:branta`.

| View | Light | Dark |
|---|---|---|
| Business on the payment review | [View](images/branta-review/01-review-light.png) | [View](images/branta-review/01-review-dark.png) |
| Payment details | [View](images/branta-review/01b-payment-details-light.png) | [View](images/branta-review/01b-payment-details-dark.png) |
| Business check before paying | [View](images/branta-review/02-current-verification-light.png) | [View](images/branta-review/02-current-verification-dark.png) |
| Payment complete | [View](images/branta-review/06-sent-light.png) | [View](images/branta-review/06-sent-dark.png) |
| Receipt | [View](images/branta-review/07-receipt-light.png) | [View](images/branta-review/07-receipt-dark.png) |
| Saved business check | [View](images/branta-review/08-saved-verification-light.png) | [View](images/branta-review/08-saved-verification-dark.png) |
| Changed code | [View](images/branta-review/03-changed-code-light.png) | [View](images/branta-review/03-changed-code-dark.png) |
| Artwork unavailable | [View](images/branta-review/04-artwork-fallback-light.png) | [View](images/branta-review/04-artwork-fallback-dark.png) |
| German, 320px and 200% text | [Review](images/branta-review/09-large-review-de-light.png) | [Proof](images/branta-review/10-large-proof-de-dark.png) |
| German BTC amounts | [View](images/branta-review/05-amount-de-btc-bip177-light.png) | [View](images/branta-review/05-amount-de-btc-bip177-dark.png) |
| Existing on-chain speed/fee selection | [View](images/payment-sheet/07-bitcoin-light.png) | [View](images/payment-sheet/07-bitcoin-dark.png) |

Navigation follows the platform's sheet guidance: a child view inside the sheet with Back, and a sheet with Done over a page.
