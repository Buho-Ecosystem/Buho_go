# Business checks and saved verification

[← Feature records](README.md)

Before sending, BuhoGO can match a payment destination to a business registered with [Branta](https://branta.pro). A matched business supplies a centered, accessible logo on the payment review and success screen. Its name stays visible in History, the receipt and verification details. Unmatched, unsupported or unavailable checks keep the ordinary recipient; they are not errors.

The review keeps BuhoGO's colors, typography, wallet selector and confirmation gestures. Fee, optional note and total are grouped in one card. Bitcoin on-chain speed selection and its SDK fee breakdown remain directly visible, with their existing controls.

## Verification when requested

| Context | Entry and behavior |
|---|---|
| Before paying | Info opens Payment details. A discreet check opens the current recipient check in that same sheet. Back restores details, then the unchanged amount, wallet and note. |
| After paying | A green receipt-header check opens the saved business check inside the existing receipt page. Back restores the receipt, without a second modal or a new Branta lookup. |

BrantaVerificationDetails is shared by both hosts. Current and historical wording differ. New snapshots contain the historical check time; older records without a timestamp never receive an invented time. Branta's original wordmark is bundled locally and is not recolored. Missing artwork uses business initials, with the full name available to assistive technology and in details.

The external record opens only when View Branta record is tapped. Invalid URLs are omitted. A failed explicit open offers a short retry message, without a diagnostic report. The receipt host preserves its financial content and restores keyboard focus to the check. Header Back, Escape and history Back close the local disclosure; ordinary navigation can leave.

## SDK and destination binding

The public, read-only adapter uses pinned Branta JavaScript SDK 4.3.0 and its verify API. No publishing key or merchant backend is included.

Original request/proof parameters remain intact. Duplicate proof or destination keys, including encoded spellings, are rejected instead of normalized into a different payment. A match qualifies only when a decrypted matched destination belongs to the payment supplying the business identity. Conflicting owners and incomplete responses remain ordinary.

| Existing BuhoGO route | Verification boundary |
|---|---|
| Lightning invoice | Exact invoice actually paid. |
| Arkade address | Exact address; preserve BuhoGO's supported route rather than copying CoinSnap's wallet restriction. |
| Bitcoin request with Branta proof | Preserve the full code for SDK decryption, then bind the selected destination. |
| Unified request | A matching sibling destination does not verify the selected route. |
| Spark-optimized Lightning | No identity when the SDK does not expose a matching native destination. Routing is not changed to obtain verification. |
| First-party BuhoGO requests and curated retail | Existing exclusions remain. |
| Unsupported/unexposed destinations | Ordinary payment behavior. SDK version alone does not establish new Spark/network support. |

The same SDK preparation that selects the route supplies its verification-target metadata. If a refreshed Spark preparation selects another destination before debit, a narrow provider callback stops submission and returns to explicit review. It does not alter routing, send automatically or bypass fee limits.

## Timing and ownership

One request-scoped controller retains the original input, lookup generation, selected wallet/request/amount/route binding and a latched changed-code result. The foreground wait is bounded at two seconds; the lookup deadline is ten seconds. Cached answers have a bounded lifetime. A late normal match cannot replace the settled presentation under a finger.

Stale checks refresh before confirmation. A changed displayed identity, including a previously unknown identity, requires review again. The accepted snapshot is frozen for the attempt; later SDK events cannot substitute another business. Cancellation, replacement, wallet changes and disposal invalidate old work. Changed-code results block Send and dominate wallet/details child views.

The changed-code screen says Ask for a new code, explains that the code changed and reassures that nothing was sent. There is no Send action or bypass.

## Historical records and privacy

New snapshots retain business fields, check time, SDK version, environment and exact destination. The existing transaction metadata store is reused. Merchant metadata needs wallet-scoped transaction evidence; amount/time-only matches cannot attach a verified business. Weaker association for unrelated contact/note metadata is retained. A first accepted historical identity is not silently replaced; history never runs a fresh verification.

Record URLs may contain decryption fragments. They stay in local transaction metadata and are not added to payment notes or diagnostic logging. The existing metadata backup API includes the saved snapshot, so such backups remain private payment data. Record/logo URLs require HTTPS and the exact configured Branta origin; credentials and arbitrary record paths are refused.

The SDK performs client-side encrypted lookups. This does not justify absolute anonymity claims: services and image hosts observe ordinary network metadata. Offline artwork is best effort; saved names and check data remain readable without it.

Settings → Advanced → Business check retains the persisted preference and defaults. Its short footer avoids an absolute privacy promise. Production builds use Production; Staging can be selected only in development.

## Amount correctness

Fixed amounts use locale grouping for presentation only. Raw entered values and canonical satoshis remain separate. Hero, denomination, fees, total and slide use consistent units, including the existing Bitcoin-format preference. The tap action is simply Send.

Locale-aware entry validates grouping and fractional precision without stripping punctuation into a different value. German 10,5 stays 10.5, not 105; grouped whole sats stay whole. Ambiguous or malformed input stays editable with Send disabled.

BTC-to-satoshi conversion uses decimal digits and integer arithmetic: 0.00000029 BTC remains exactly 29 sats instead of losing a sat to binary floating-point multiplication. Existing payout, refund, card, quote and slide rules remain authoritative. A nonzero fiat fee smaller than a display cent is not mislabeled zero.

## Validation

- Adapter, timing, exact destination binding, provider pre-debit and merchant-metadata association regressions join the existing full suite.
- Payment-sheet tests cover exact conversion, grouped display, unit changes, payouts/refunds, unknown fees, child-view restoration and changed-code precedence.
- Receipt-navigation tests cover Back, ordinary navigation, context resets, Escape and focus.
- The Branta browser harness uses the real public SDK with a local verifier and simulated wallet providers. No funds or external messages are sent.
- Payment-sheet, payment-preparation and full contact-chat browser checks retain money/state assertions.
- Screenshots cover current/historical details, review, changed codes, ordinary fallback, artwork failure, translations/enlarged text and both themes. Native-device acceptance is separate.

Run `npm test` and `pnpm build` for the regression suite and production compilation. With a local dev server on port 9019, run:

```sh
BRANTA_BASE_URL=http://localhost:9019 node scripts/check-branta.mjs
PAYMENT_SHEET_BASE_URL=http://localhost:9019 npm run check:payment-sheet
PAYMENT_PREPARATION_BASE_URL=http://localhost:9019 npm run check:payment-preparation
CONTACT_CHAT_BASE_URL=http://localhost:9019 npm run check:contact-chat
```

The [red-team/blue-team review](BRANTA_REVIEW.md) records the failure cases examined and their resolutions.

### App screenshots

These are captures of the implemented Vue app using simulated businesses, providers and payments. The before image is from dev `2ac1eef`; its fixture amount differs from the after captures.

| View | Light | Dark |
|---|---|---|
| Before: business/payment review | [View](images/branta-review/before-review-light.png) | — |
| Clean business/payment review | [View](images/branta-review/01-review-light.png) | [View](images/branta-review/01-review-dark.png) |
| Payment details | [View](images/branta-review/01b-payment-details-light.png) | [View](images/branta-review/01b-payment-details-dark.png) |
| Current recipient check | [View](images/branta-review/02-current-verification-light.png) | [View](images/branta-review/02-current-verification-dark.png) |
| Payment complete | [View](images/branta-review/06-sent-light.png) | [View](images/branta-review/06-sent-dark.png) |
| Receipt | [View](images/branta-review/07-receipt-light.png) | [View](images/branta-review/07-receipt-dark.png) |
| Saved business check | [View](images/branta-review/08-saved-verification-light.png) | [View](images/branta-review/08-saved-verification-dark.png) |
| Changed code | [View](images/branta-review/03-changed-code-light.png) | [View](images/branta-review/03-changed-code-dark.png) |
| Artwork unavailable | [View](images/branta-review/04-artwork-fallback-light.png) | [View](images/branta-review/04-artwork-fallback-dark.png) |
| German, 320px and 200% text | [Review](images/branta-review/09-large-review-de-light.png) | [Proof](images/branta-review/10-large-proof-de-dark.png) |
| German BTC amounts | [View](images/branta-review/05-amount-de-btc-bip177-light.png) | [View](images/branta-review/05-amount-de-btc-bip177-dark.png) |
| Existing on-chain speed/fee selection | [View](images/payment-sheet/07-bitcoin-light.png) | [View](images/payment-sheet/07-bitcoin-dark.png) |

Design reference: [CoinSnap PR #147](https://github.com/pratik227/coinsnap/pull/147), adapted to BuhoGO's theme/providers. Navigation follows [Apple's sheet guidance](https://developer.apple.com/design/human-interface-guidelines/sheets).
