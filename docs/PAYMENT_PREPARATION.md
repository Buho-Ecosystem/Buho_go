# Contact payments and the default wallet

[← Feature records](README.md)

Paying a contact opens the payment sheet on the screen where the person tapped. The recipient and a request’s known amount appear immediately. The same sheet moves from preparing to review; Home never appears in between. A free amount can be entered while details load.

The design follows Apple’s guidance for [typography](https://developer.apple.com/design/human-interface-guidelines/typography), [writing](https://developer.apple.com/design/human-interface-guidelines/writing), [loading](https://developer.apple.com/design/human-interface-guidelines/loading), [progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators), [sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), and [settings](https://developer.apple.com/design/human-interface-guidelines/settings): preserve context, use indeterminate progress for unknown work, keep the wallet chooser inside the task, and provide a persistent setting for an infrequent choice.

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

After a completed payment, the receipt closes before a separate popup asks “Use {wallet} for future payments?” with Use {wallet} and Not now. It appears only once and never interrupts review or sending. Pending, failed, cancelled and explicitly assigned-wallet payments do not trigger it. If Save Contact is opened, that task finishes first. The popup uses the wallet that actually paid and closes on navigation, identity changes or locking. The in-sheet chooser applies only to the current payment. Settings → Wallet → Default wallet offers Automatic and configured wallets, with Cancel and Save.

A missing, disconnected, incompatible or insufficient preferred wallet stays explicit. The sheet explains the problem and offers Choose another wallet; it never silently substitutes another payer. Removing a wallet retains its preference until the person changes it. A failed durable save preserves the old setting and shows a short retry message in the same popup or Settings sheet. The preference stores no balance, address or credential.

## Validation

`npm test` includes preference persistence, intent ownership, dispatcher cancellation and UI transition tests alongside the existing send/refund/PIN/kiosk/batch/internal-transfer/Auto-Transfer coverage. `npm run check:payment-preparation` runs the real app against simulated relays, LNURL endpoints and wallet providers. It exercises held responses, retry/cancel/supersession, request handoff, wallet choices, missing/insufficient/unavailable preferences, an in-flight debit pinned to one wallet, and narrow layouts with enlarged text in English, German and Spanish. No real funds or external messages are used.

Run the browser check with a local development server:

```sh
pnpm dev --port 9012
# In another terminal (adjust the URL if the port is already in use):
PAYMENT_PREPARATION_BASE_URL=http://localhost:9012 npm run check:payment-preparation
```

Screenshots live in [images/payment-preparation](images/payment-preparation/).

| Screen | Light | Dark |
|---|---|---|
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
