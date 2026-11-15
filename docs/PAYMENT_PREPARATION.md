# Payment review and the default wallet

[← Feature records](README.md)

Paying a contact opens the payment sheet on the screen where the person tapped. The recipient and a request’s known amount appear immediately. The same sheet moves from preparing to review; Home never appears in between. A free amount can be entered while details load.

The design follows Apple’s guidance for [typography](https://developer.apple.com/design/human-interface-guidelines/typography), [writing](https://developer.apple.com/design/human-interface-guidelines/writing), [loading](https://developer.apple.com/design/human-interface-guidelines/loading), [progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators), [sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), and [settings](https://developer.apple.com/design/human-interface-guidelines/settings): preserve context, use indeterminate progress for unknown work, keep the wallet chooser inside the task, and provide a persistent setting for an infrequent choice.

## Shared payment review

Scanned, pasted and contact payments use one review sheet. The header contains an icon for closing the sheet (a chevron when returning from a child view), Send and a wallet selector sized to its contents. The amount leads in its own card, with its denomination/lock and fiat conversion centered together immediately below it. The optional note, the fee and the total share one summary card above the existing Send or slide-to-send action: the note first, then the fee with the total directly under it. Anonymous recipients remain **Bitcoin payment**, using the original orange Bitcoin logo; saved contacts keep their names and avatars. A matched business uses its logo, with its name and verification available through Payment details. The default screen shows the recipient and, when useful, a readable address: a payment address in full, and a pasted Bitcoin, Spark or Arkade address by its first and last characters, since that is how a person compares it before an irreversible send. Encoded requests (invoices, payment links) name nothing a person can compare, so they stay in Payment details. Protocol labels and badges, including Lightning bolts, stay out of the recipient card; the amount and recipient carry the visual emphasis.

Amount entry respects locale decimal separators and validates grouping before conversion. Fixed amounts use grouped presentation without changing their canonical satoshis. BTC entry converts decimal digits exactly, including 0.00000029 BTC → 29 sats. The amount, fees, total and slide confirmation use the same denomination preference. Invalid or ambiguous input remains editable with Send disabled.

Wallet selection and **Payment details** are child views inside that same sheet. The wallet list includes names, types, balances, the paying wallet's mark and reasons a wallet cannot pay. One tap on a wallet that can pay chooses it for this payment and returns to the review; a wallet that cannot pay keeps its reason in its row and a tap on it changes nothing. A balance that is still being read pulses in its row. Details contains the full destination with Copy, named in plain words by its own row (Payment request, Payment link, Payment address or Address), the message and useful metadata. A network is named only where it decides what a person can do: Spark, Arkade, and Bitcoin for a payment on the Bitcoin network itself. Returning keeps the amount, denomination, comment and selected wallet. The exact signed Spark invoice is kept separately from its durable recipient address.

**Bitcoin on-chain speed selection and the SDK fee breakdown stay directly visible on the main payment screen.** The existing fee-selection UI is unchanged. The main sheet remains the confirmation step; fixed requests stay locked and existing send/slide thresholds remain in place.

What a payment costs is said before it is confirmed, in one fee slot with the total under it:

| What is known | Network fee | Total |
|---|---|---|
| A valid SDK-prepared quote | the fee | amount plus fee |
| A limit the payment is held to (a Spark wallet paying a payment address or a payment link, whose invoice exists only after the confirm; an LNbits wallet paying an invoice with an amount, held by its server to the fee reserve that server states for it) | Up to the limit | Up to amount plus limit |
| A Spark transfer the SDK prepared with a fee of zero | Free · instant | the amount |
| Nothing beforehand (a wallet that cannot quote: an NWC wallet, which no limit can be set for, and an LNbits wallet whose server states no fee reserve or which pays an address or a link; and a transfer between Arkade addresses, which has no quote) | “Fee calculated when sending.” | the amount “+ fee” |
| A quote on its way, or the payment still being made ready | a placeholder in the same slot | a placeholder |

A percentage guess is never shown as a number, and a fee that comes later is named, never added into the sum. The slot and the total keep their place through all of these states, so nothing below them moves when a quote lands. The existing zero-fee execution guard remains.

A contact payment that is still being made ready already shows the rows of the ready review with their values still to come: the limits line under the amount, the note row for a payment address, the fee and the total. The commit control's place says “Getting ready to pay…” and there is nothing to press yet. The sheet therefore keeps its height when the payment is ready; only a payment address that takes no note gives its held row back. Amountless Lightning invoices are quoted for the entered amount. The reviewed quote is retained through submission rather than being reset by amount/metadata watchers. Confirmation waits while an available SDK quote is being fetched; an unavailable fee is explicitly identified when preparation finishes. Quote ownership prevents old wallet/amount/address responses or errors from replacing the current quote; incomplete SDK on-chain quotes are rejected before mapping.

The header and action stay outside the scrolling body. Mobile visual-viewport handling keeps the controls above a keyboard without shrinking content during pinch zoom; it listens only while the sheet is open. With the keyboard up the review takes a compact form (the same rows with less air), so the amount, the recipient, the fee and the total all stay in view above it.

## Header navigation

Matching text Cancel/Back controls in form-sheet headers use familiar icons: an x dismisses the task and a chevron returns to its previous view. Each control retains its accessible name, handler and busy/disabled guard, with a 44px touch target and visible focus/press states. This is applied consistently to default-wallet settings, request wallet selection, adding a wallet, moving an address, kiosk wallet/PIN and Auto-Transfer headers. Existing page headers already using icon navigation are retained. Footer Cancel/Back decisions, primary Done/Save actions and payment-cancellation actions keep their words.

## Entry points

`usePayContact` is the common handoff for Address Book/Quick Pay, chat Send and Pay, expired-request Send anyway, Waiting for you, public-profile payments, existing-contact identity-card scans, receipt/history Pay again, and contact selection inside Home’s Send sheet. A request hands over its known preview before fetching its invoice. Ordinary typed/scanned Send and external payment links retain their existing intake and payment execution.

## Lifecycle and ownership

`paymentFlow` holds one volatile intent; no destination, invoice or draft is persisted. `ContactPaymentHost` mounts the canonical Wallet payment controller in payment-only mode under MainLayout, leaving the source page mounted. That mode omits Home and skips Home’s initialization, intake watchers and background polling. It waits for saved wallet configuration, while provider connections and balance sync continue independently. The controller is the wallet page, so the host fetches it on its own (`contactPaymentPipeline.js`) and never with the layout, which also serves the public profile and setup screens; every surface that can pay a contact warms it up when it mounts. If it cannot be fetched (the web app, offline), the tap is given back with a short notice.

| Phase | Behavior |
|---|---|
| Preparing | Recipient/known amount, skeleton details, indeterminate progress, Cancel. Additional explanatory text after eight seconds; no artificial delay. |
| Error | The reason in its own words (the destination's, or the chat request's) and Try again; the entered amount remains. A reason another try cannot change (a link that is no payment, a request that is over) offers Close instead. |
| Ready | Existing confirmation, fee, refund and slide rules. Wallet choice is a child view of the same sheet. |
| Sending | The paying wallet is pinned; Cancel, duplicate confirmations and replacement intents are refused. |
| Complete | Existing receipt and optional Save Contact flow retain ownership until dismissed. On-chain submission retains the existing provider notification monitor. |
| Choosing default | Optional popup after the receipt has fully closed. It can be dismissed or replaced without affecting the completed payment. |

Each preparation attempt captures a lease. Results are checked after every asynchronous resolution and before mutation. Cancel, navigation, identity changes, app lock and kiosk/address-sharing transitions invalidate uncommitted work. A retry owns a new attempt. Late responses cannot reopen or overwrite another payment. The intent's abort signal reaches the request lookup, so a cancelled payment asks the recipient's address for nothing more. Once a send begins, context changes cannot move its debit to another wallet. From the confirm to the end of that send, however it ends, the `paymentFlow` store says app-wide that a payment is being sent (`paymentBeingSent`, for Home and contact payments alike), and the identity in use cannot change: the identity store refuses every switch, new identity, restore and erase, and the identity screens show those controls unavailable with one line saying why, until the payment has ended. The hold has no timer of its own: it ends when the send does, and how long a send may take is bounded by the send pipeline (`utils/paymentOutcome.js`).

## Default wallet

The device-local `paymentPreferences` store is separate from Home’s active wallet. Selection precedence is an explicit caller wallet (for example Pay again), then the preferred payment wallet, then the existing Automatic selection.

After a completed payment, the receipt closes before a separate popup asks “Use {wallet} when you pay contacts?” with Use {wallet} and Not now, and says that it becomes the default wallet for payments to contacts. It is offered only to someone who picked the paying wallet in the sheet: a payment that went out from the automatic pick asks nothing. It never interrupts review or sending. Pending, failed, cancelled and explicitly assigned-wallet payments do not trigger it. If Save Contact is opened, that task finishes first. Not now is remembered; Escape or a tap beside the popup decides nothing, so the offer may come again after a later payment. The popup shows the mark of the wallet that actually paid and closes on navigation, identity changes or locking. The in-sheet chooser applies only to the current payment. Settings → Wallet → Default wallet offers Automatic and configured wallets, with a close icon and Save.

A default wallet that is disconnected or short on funds stays selected: the sheet explains the problem and offers Choose another wallet. A default wallet that cannot reach this kind of destination at all steps aside for the automatic pick, and one line in the sheet says which wallet pays this time; the preference itself is kept. A default wallet that is removed from this phone or disconnected for good returns the preference to Automatic, and the offer may be made again. Wallets that could not be read from storage never clear the preference. A failed durable save preserves the old setting and shows a short retry message in the same popup or Settings sheet. The preference stores no balance, address or credential.

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
