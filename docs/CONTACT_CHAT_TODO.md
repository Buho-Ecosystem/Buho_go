# Contact chat — open work

Working list for `feat/contact-chat`. The contract is `docs/CONTACT_CHAT.md`;
this file only tracks what is still to do. Update it with every commit that
closes or adds an item.

Last update: 2026-10-11.

## Done (committed on this branch)

| Commit | What |
|---|---|
| 9f8ada1 | i18n: "About" → "Über uns" / "Sobre nosotros" |
| f35bff7 | Contact page: payments in both directions under "Between you" |
| 7f34040 | Chat contract doc, `services/dm/constants.js`, `errors.js` |
| 5881333 | Notifications: `messages` channel, stable ids, tap routing, `app:locked` |
| ab1d3a6 | "Pay with": paying wallet picker, `sendingWalletId` through the send pipeline |
| 2ac8889 | Inbox relay resolver (LAN hosts refused), in-memory session key |
| 40fe743 | Protocol v1, gift wrap / open wrap, inbound gates, new inbox relays |
| c65de68 | Relay transport with invisible NIP-42 AUTH (read/write roles) |
| 41d3f15 | Messages store + encrypted per-identity storage |
| b68d41a | Spark `createInvoice` honours an expiry |
| ae3b120 | Request invoices and payment detection for all four wallet types |
| b339bea | Inbox coordinator (receive, send, outbox, own 10050 list) |
| 8488c75 | Chat runtime + boot lifecycle (`useChatRuntime()`, `boot/dm-inbox.js`, `utils/appLock.js`) |

## Open

### 1. Chat UI components (in progress, uncommitted)
`src/components/chat/*` (ChatHeader, MessageBubble, MessageMenu, RequestCard,
PaymentLine, MoneyBar, Composer, RequestSheet, ReceiveWalletField,
DaySeparator, UnknownSenderBanner, ChatThread, chatFormat.js, chatTokens.css)
and `src/components/__tests__/chatComponents.spec.js`. The agent stopped at
a rate limit while finishing RequestCard, MoneyBar, Composer and
UnknownSenderBanner. To do: finish, review against
`prototypes/chat-c-review/index.html` (light/dark screenshots), commit.
Product rule: the pay-request card/sheet has **no** "amount in invoice" row.

### 2. Chat page and routes
- `pages/ContactChatPage.vue` on `/address-book/:id/chat`: header (tap name →
  `/address-book/:id`), thread, money bar. Uses only `useChatRuntime()` and
  `useMessagesStore()`.
- Read the requester's own card state from `runtime.requestState(id)`, not
  `store.requestStatus` (the store only accepts `paid` from the payer).
- Pay: hand the request's invoice to the existing pipeline
  (`usePayContact` → `Wallet.vue ?action=pay_contact`) with `walletId`
  (the "Pay with" choice), then `runtime.announcePayment(...)` on success.
- Send: existing pay-contact flow, then `announcePayment`.
- Contact without inbox relays (`partnerReachability === 'missing'`):
  header "Payments only", composer hidden, requests shared as a payment link.
- Unknown senders: route `/messages/:pubkey` (used by notifications) →
  chat with UnknownSenderBanner (add contact / block).

### 3. Small additions to existing screens (no layout changes)
- AddressBook: tap contact → chat; unread badges; "Unknown" section.
- MenuOverlay: unread badge.
- IdentityHomePage: "Messages" row + sheet (thread list).
- Settings → notifications: messages switch (`setMessagesEnabled`).

### 4. i18n (en-US, de, es) — add all keys in one pass
Collected so far (literal `@` must be written `{'@'}`):

| en-US | de | es |
|---|---|---|
| Payments between you and {name}. | Zahlungen zwischen dir und {name}. | Pagos entre tú y {name}. |
| Lightning unavailable | Lightning nicht verfügbar | Lightning no disponible |
| Spark wallets only | Nur Spark-Wallets | Solo billeteras Spark |
| Arkade wallets only | Nur Arkade-Wallets | Solo billeteras Arkade |
| Spark or Arkade only | Nur Spark oder Arkade | Solo Spark o Arkade |
| Not enough balance | Nicht genug Guthaben | Saldo insuficiente |
| Unavailable | Nicht verfügbar | No disponible |
| Not enough balance in {wallet} - choose another wallet or send less | Nicht genug Guthaben in {wallet} - wähle eine andere Wallet oder sende weniger | Saldo insuficiente en {wallet}: elige otra billetera o envía menos |
| {wallet} is unavailable right now - choose another wallet | {wallet} ist gerade nicht verfügbar - wähle eine andere Wallet | {wallet} no está disponible ahora: elige otra billetera |
| Messages | Nachrichten | Mensajes |
| New message | Neue Nachricht | Nuevo mensaje |
| Requested {amount} | Hat {amount} angefordert | Solicitó {amount} |
| Sent you {amount} | Hat dir {amount} gesendet | Te envió {amount} |
| Paid your request | Hat deine Anfrage bezahlt | Pagó tu solicitud |
| Declined your request | Hat deine Anfrage abgelehnt | Rechazó tu solicitud |
| Withdrew a request | Hat eine Anfrage zurückgezogen | Retiró una solicitud |
| Reminder: a request is still open | Erinnerung: eine Anfrage ist noch offen | Recordatorio: una solicitud sigue abierta |

Plus: the chat UI component keys (from the UI agent report), copy for the
DM_ERROR codes the UI shows (WALLET_CANNOT_INVOICE, INVALID_INVOICE,
WALLET_CANNOT_PAY, INVOICE_EXPIRED, NO_INBOX_RELAYS, NO_RELAY_ACCEPTED,
SECRET_KEY_IN_TEXT), "Receive in", "money lands in {wallet}" (Arkade
requests settle in the Spark wallet behind the profile address),
"unconfirmed" (foreign address without LUD-21 verify).
Remove the now-unused key "Payments you made to this contact." (en-US/de/es).

### 5. QA
- Playwright script `scripts/check-contact-chat.mjs`: simulated relays, all
  four wallet types, light/dark, de/en/es, large text.
- Full `npm test` against the baseline (known pre-existing failures on main:
  `walletLifetimes.spec.js` "removing a grouped wallet…" and
  `identity.spec.js` hanging; `nostrRelays.spec.js` eager test is timing
  sensitive under load).
- Production build (`quasar build`) and an Android device run.

### 6. Known limitations / follow-ups
- Android cold start: a notification tap after the process was killed
  probably opens the start screen (plugin only handles `onNewIntent`); verify
  on a device, fix natively if confirmed.
- After a lock, a relay that re-challenges AUTH is marked `auth-failed` until
  it reconnects (no API to retry AUTH on unlock).
- `SendModal` and the clipboard strip still gate on the active wallet.
- Balances of non-active NWC/LNbits wallets may be stale in "Pay with".
- Contact relay hints (`nostr_relay_hints`) are not yet passed to sends.
- Fee-reserve constants exist in `payingWallets.js` and
  `Nip05MarketplaceSheet.vue` (one import would dedupe).
- Pre-existing `console.log` of the pending payment in `Wallet.vue`
  `confirmPayment` logs invoices (not introduced here).
- Re-check relay.damus.io / relay.nostr.net AUTH (broken server-side on
  2026-10-10) and add them back to `DM_INBOX_RELAYS` once fixed.
- Replace local workarounds when nostr-core #72–#75 ship.
