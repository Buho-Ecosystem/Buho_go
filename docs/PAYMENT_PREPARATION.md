# Payment review and the default wallet

[← Feature records](README.md)

Paying a contact opens the payment sheet on the screen where the person tapped. The recipient and a request’s known amount appear immediately. The same sheet moves from preparing to review; Home never appears in between. A free amount can be entered while details load.

The design follows Apple’s guidance for [typography](https://developer.apple.com/design/human-interface-guidelines/typography), [writing](https://developer.apple.com/design/human-interface-guidelines/writing), [loading](https://developer.apple.com/design/human-interface-guidelines/loading), [progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators), [sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), and [settings](https://developer.apple.com/design/human-interface-guidelines/settings): preserve context, use indeterminate progress for unknown work, keep the wallet chooser inside the task, and provide a persistent setting for an infrequent choice.

## Shared payment review

Scanned, pasted and contact payments use one review sheet. The header contains an icon for closing the sheet (a chevron when returning from a child view), Send and a wallet selector sized to its contents. The amount leads, with its denomination/lock and fiat conversion centered together immediately below it, followed by one recipient card, the available fee summary and the existing Send or slide-to-send action. Anonymous recipients remain **Bitcoin payment**, using the original orange Bitcoin logo; saved contacts and known businesses keep their names and avatars. The default screen shows the recipient and, when useful, a readable address. Protocol labels and badges, including Lightning bolts, stay out of the recipient card. Payment types, networks and encoded destinations are available through the info button in Payment details; the amount and recipient carry the visual emphasis.

Wallet selection and **Payment details** are child views inside that same sheet. The wallet list includes names, types, balances, the selected state and reasons a wallet cannot pay. Details contains the full payment request/address, Copy, the payment type/network, message and useful metadata. Returning keeps the amount, denomination, comment and selected wallet. The exact signed Spark invoice is kept separately from its durable recipient address.

**Bitcoin on-chain speed selection and the SDK fee breakdown stay directly visible on the main payment screen.** The existing fee-selection UI is unchanged. The main sheet remains the confirmation step; fixed requests stay locked and existing send/slide thresholds remain in place.

Numeric fees and totals are shown only for valid SDK-prepared quotes. Native Spark zero fees are confirmed by an SDK prepare; the existing zero-fee execution guard remains. Percentage guesses and execution caps are not displayed as actual fees. When a provider cannot quote in advance, the sheet says “Fee calculated when sending.” and omits a numerical fee/total. Amountless Lightning invoices are quoted for the entered amount. The reviewed quote is retained through submission rather than being reset by amount/metadata watchers. Confirmation waits while an available SDK quote is being fetched; an unavailable fee is explicitly identified when preparation finishes. Quote ownership prevents old wallet/amount/address responses or errors from replacing the current quote; incomplete SDK on-chain quotes are rejected before mapping.

The header and action stay outside the scrolling body. Mobile visual-viewport handling keeps the controls above a keyboard without shrinking content during pinch zoom.

## Header navigation

Matching text Cancel/Back controls in form-sheet headers use familiar icons: an x dismisses the task and a chevron returns to its previous view. Each control retains its accessible name, handler and busy/disabled guard, with a 44px touch target and visible focus/press states. This is applied consistently to default-wallet settings, request wallet selection, adding a wallet, moving an address, kiosk wallet/PIN and Auto-Transfer headers. Existing page headers already using icon navigation are retained. Footer Cancel/Back decisions, primary Done/Save actions and payment-cancellation actions keep their words.

## Entry points

`usePayContact` is the common handoff for Address Book/Quick Pay, chat Send and Pay, expired-request Send anyway, Waiting for you, public-profile payments, existing-contact identity-card scans, receipt/history Pay again, and contact selection inside Home’s Send sheet. A request hands over its known preview before fetching its invoice. Ordinary typed/scanned Send and external payment links retain their existing intake and payment execution.

## Lifecycle and ownership

`paymentFlow` holds one volatile intent; no destination, invoice or draft is persisted. `ContactPaymentHost` mounts the canonical Wallet payment controller in payment-only mode under MainLayout, leaving the source page mounted. That mode omits Home and skips Home’s initialization, intake watchers and background polling. It waits for saved wallet configuration, while provider connections and balance sync continue independently.

| Phase | Behavior |
|---|---|
| Preparing | Recipient/known amount, skeleton details, indeterminate progress, Cancel. Additional explanatory text after eight seconds; no artificial delay. |
| Error | Brief inline error and Retry; the entered amount remains. |
| Ready | Existing confirmation, fee, refund and slide rules. Wallet choice is a child view of the same sheet. |
| Sending | The paying wallet is pinned; Cancel, duplicate confirmations and replacement intents are refused. |
| Complete | Existing receipt and optional Save Contact flow retain ownership until dismissed. On-chain submission retains the existing provider notification monitor. |
| Choosing default | Optional popup after the receipt has fully closed. It can be dismissed or replaced without affecting the completed payment. |

Each preparation attempt captures a lease. Results are checked after every asynchronous resolution and before mutation. Cancel, navigation, identity changes, app lock and kiosk/address-sharing transitions invalidate uncommitted work. A retry owns a new attempt. Late responses cannot reopen or overwrite another payment. Once a send begins, context changes cannot move its debit to another wallet.

## Default wallet

The device-local `paymentPreferences` store is separate from Home’s active wallet. Selection precedence is an explicit caller wallet (for example Pay again), then the preferred payment wallet, then the existing Automatic selection.

After a completed payment, the receipt closes before a separate popup asks “Use {wallet} for future payments?” with Use {wallet} and Not now. It appears only once and never interrupts review or sending. Pending, failed, cancelled and explicitly assigned-wallet payments do not trigger it. If Save Contact is opened, that task finishes first. The popup uses the wallet that actually paid and closes on navigation, identity changes or locking. The in-sheet chooser applies only to the current payment. Settings → Wallet → Default wallet offers Automatic and configured wallets, with a close icon and Save.

A missing, disconnected, incompatible or insufficient preferred wallet stays explicit. The sheet explains the problem and offers Choose another wallet; it never silently substitutes another payer. Removing a wallet retains its preference until the person changes it. A failed durable save preserves the old setting and shows a short retry message in the same popup or Settings sheet. The preference stores no balance, address or credential.

## Validation

`npm test` includes SDK fee validation and quote races, preference persistence, intent ownership, dispatcher cancellation and UI transition tests alongside the existing send/refund/PIN/kiosk/batch/internal-transfer/Auto-Transfer coverage. `npm run check:payment-preparation` runs the real app against simulated relays, LNURL endpoints and wallet providers. It exercises held responses, retry/cancel/supersession, request handoff, wallet choices, missing/insufficient/unavailable preferences, an in-flight debit pinned to one wallet, and narrow layouts with enlarged text in English, German and Spanish. No real funds or external messages are used.

Run the browser check with a local development server:

```sh
pnpm dev --port 9012
# In another terminal (adjust the URL if the port is already in use):
PAYMENT_PREPARATION_BASE_URL=http://localhost:9012 npm run check:payment-preparation
```

`npm run check:payment-sheet` uses the same local-server convention with `PAYMENT_SHEET_BASE_URL`. It covers scanned/pasted Lightning/LNURL, fixed and amountless invoices, native Spark addresses/invoices, on-chain fee selection, incompatible/insufficient wallets, complete-copy details, unsupported requests, actual/unknown/stale fee states, draft preservation, enlarged translations and a keyboard-sized visual viewport. All providers are simulated.

Screenshots live in [images/payment-preparation](images/payment-preparation/) and [images/payment-sheet](images/payment-sheet/).

| Screen | Light | Dark |
|---|---|---|
| Payment review | [View](images/payment-sheet/01-invoice-light.png) | [View](images/payment-sheet/01-invoice-dark.png) |
| Payment details | [View](images/payment-sheet/01b-invoice-details-light.png) | [View](images/payment-sheet/01b-invoice-details-dark.png) |
| Spark invoice | [View](images/payment-sheet/06-spark-invoice-light.png) | [View](images/payment-sheet/06-spark-invoice-dark.png) |
| On-chain speed and fees | [View](images/payment-sheet/07-bitcoin-light.png) | [View](images/payment-sheet/07-bitcoin-dark.png) |
| Keyboard viewport | [View](images/payment-sheet/11-keyboard-visual-viewport-light.png) | [View](images/payment-sheet/11-keyboard-visual-viewport-dark.png) |
| Settings header icons | [View](images/payment-sheet/13-settings-navigation-light.png) | [View](images/payment-sheet/13-settings-navigation-dark.png) |
| PIN back and close icons | [View](images/payment-sheet/14-pin-navigation-light.png) | [View](images/payment-sheet/14-pin-navigation-dark.png) |
| Preparing | [View](images/payment-preparation/01-preparing-light.png) | [View](images/payment-preparation/01-preparing-dark.png) |
| Ready | [View](images/payment-preparation/02-ready-light.png) | [View](images/payment-preparation/02-ready-dark.png) |
| Retry | [View](images/payment-preparation/03-retry-light.png) | [View](images/payment-preparation/03-retry-dark.png) |
| One-off wallet | [View](images/payment-preparation/04-one-off-wallet-light.png) | [View](images/payment-preparation/04-one-off-wallet-dark.png) |
| Settings | [View](images/payment-preparation/05-settings-light.png) | [View](images/payment-preparation/05-settings-dark.png) |
| Request | [View](images/payment-preparation/06-request-ready-light.png) | [View](images/payment-preparation/06-request-ready-dark.png) |
| After-payment popup | [View](images/payment-preparation/12-default-wallet-popup-light.png) | [View](images/payment-preparation/12-default-wallet-popup-dark.png) |
| Wallet chooser | [View](images/payment-preparation/13-wallet-picker-light.png) | [View](images/payment-preparation/13-wallet-picker-dark.png) |
| Settings picker | [View](images/payment-preparation/14-settings-picker-light.png) | [View](images/payment-preparation/14-settings-picker-dark.png) |

The question and buttons use short, familiar words. Regular question text surrounds a bold wallet name; the main action is bold, while the explanation and Not now stay regular. This makes the wallet and the decision easy to scan. This is an optional settings choice, so the popup waits until the payment task is complete; it uses no warning or error styling.

Enlarged text examples: [German wallet chooser](images/payment-preparation/09-large-picker-de-light.png), [Spanish Settings](images/payment-preparation/10-large-settings-es-dark.png), [German popup](images/payment-preparation/15-large-default-popup-de-light.png), [Spanish popup](images/payment-preparation/15-large-default-popup-es-dark.png).

The shared payment review is also captured at 320px with 200% text: [German payment review](images/payment-sheet/08-large-de-light.png), [Spanish details](images/payment-sheet/09-details-es-dark.png) and [German wallet choices](images/payment-sheet/10-wallets-de-dark.png). The [layout-resize keyboard example](images/payment-sheet/12-keyboard-layout-viewport-dark.png) complements the visual-viewport examples above. These are browser simulations; native-device visual validation was not run.
