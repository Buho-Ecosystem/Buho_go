# Contact chat — open work

Working list for `feat/contact-chat`. The contract is `docs/CONTACT_CHAT.md`;
this file only tracks what is still to do. Update it with every commit that
closes or adds an item.

Last update: 2026-10-11 (after a03f696).

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
| cbeca21 | Chat screen components |
| 5626a3a | Contact chat page, pay seam (`payment:sent`), routes |
| 76a4a04 | Entry points: address book, menu badge, identity Messages sheet, Settings switch |
| 1090ebf | Requests paid from the chat appear under "Between you" |
| a03f696 | Translations en/de/es |

## Open

### 1. Chat UI components — DONE (cbeca21)
`src/components/chat/*` (ChatHeader, MessageBubble, MessageMenu, RequestCard,
PaymentLine, MoneyBar, Composer, RequestSheet, ReceiveWalletField,
DaySeparator, UnknownSenderBanner, ChatThread, chatFormat.js, chatTokens.css)
and `src/components/__tests__/chatComponents.spec.js`. The agent stopped at
a rate limit while finishing RequestCard, MoneyBar, Composer and
UnknownSenderBanner. To do: finish, review against
`prototypes/chat-c-review/index.html` (light/dark screenshots), commit.
Product rule: the pay-request card/sheet has **no** "amount in invoice" row.

### 2. Chat page and routes — DONE (5626a3a)
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

### 3. Small additions to existing screens — DONE (76a4a04) (AddressBook, AddressBookList/Entry, MenuOverlay, IdentityHomePage, Settings, chat/MessagesSheet.vue, chat/threadRows.js, chatEntryPoints.spec.js)
- AddressBook: tap contact → chat; unread badges; "Unknown" section.
- MenuOverlay: unread badge.
- IdentityHomePage: "Messages" row + sheet (thread list).
- Settings → notifications: messages switch (`setMessagesEnabled`).

### 4. i18n (en-US, de, es) — DONE (a03f696)
Existing translations kept where a key already existed; check in the app:
de "Sending" = "Senden" (reads like the verb in the delivery state),
de "Pay" = "Bezahlen", es "Expired" = "Vencida".

Keys as added:
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


Chat UI component keys (cbeca21; some may already exist — reuse, don't duplicate):

| en-US | de | es |
|---|---|---|
| Back | Zurück | Atrás |
| More options | Weitere Optionen | Más opciones |
| Open contact: {name} | Kontakt öffnen: {name} | Abrir contacto: {name} |
| End-to-end encrypted | Ende-zu-Ende-verschlüsselt | Cifrado de extremo a extremo |
| Payments only | Nur Zahlungen | Solo pagos |
| Not in your contacts | Nicht in deinen Kontakten | No está en tus contactos |
| Today | Heute | Hoy |
| Yesterday | Gestern | Ayer |
| You sent {amount} | Du hast {amount} gesendet | Enviaste {amount} |
| Received {amount} | {amount} erhalten | Recibiste {amount} |
| Message actions | Nachrichtenaktionen | Acciones del mensaje |
| React | Reagieren | Reaccionar |
| React with {emoji} | Mit {emoji} reagieren | Reaccionar con {emoji} |
| Reply | Antworten | Responder |
| Copy text | Text kopieren | Copiar texto |
| Send again | Erneut senden | Enviar de nuevo |
| Cancel | Abbrechen | Cancelar |
| Shown as plain text | Als Text angezeigt | Mostrado como texto |
| Reactions | Reaktionen | Reacciones |
| {emoji} {count} reactions | {emoji} {count} Reaktionen | {emoji} {count} reacciones |
| Waiting to send | Wartet auf Senden | Esperando para enviar |
| Sending | Wird gesendet | Enviando |
| Sent | Gesendet | Enviado |
| Not sent | Nicht gesendet | No enviado |
| You | Du | Tú |
| Them | Gegenüber | Contacto |
| Reply to {name} | Antwort an {name} | Respuesta a {name} |
| You requested | Du hast angefragt | Solicitaste |
| {name} requests | {name} fordert an | {name} solicita |
| Payment request | Zahlungsanfrage | Solicitud de pago |
| Valid until {when} | Gültig bis {when} | Válido hasta {when} |
| Reported paid, not verified | Als bezahlt gemeldet, nicht verifiziert | Informado como pagado, sin verificar |
| Paid | Bezahlt | Pagado |
| Declined | Abgelehnt | Rechazado |
| Withdrawn | Zurückgezogen | Retirado |
| Expired | Abgelaufen | Vencido |
| open | offen | abierta |
| This wallet cannot confirm the payment automatically. | Diese Wallet kann die Zahlung nicht automatisch bestätigen. | Esta wallet no puede confirmar el pago automáticamente. |
| This request is invalid and cannot be paid. | Diese Anfrage ist ungültig und kann nicht bezahlt werden. | Esta solicitud no es válida y no se puede pagar. |
| This request has expired. | Diese Anfrage ist abgelaufen. | Esta solicitud ha vencido. |
| This wallet cannot pay this request. Choose another wallet. | Diese Wallet kann die Anfrage nicht bezahlen. Wähle eine andere Wallet. | Esta wallet no puede pagar esta solicitud. Elige otra wallet. |
| Decline | Ablehnen | Rechazar |
| Pay | Zahlen | Pagar |
| Remind | Erinnern | Recordar |
| Withdraw | Zurückziehen | Retirar |
| Request | Anfordern | Solicitar |
| Send | Senden | Enviar |
| Write a message | Nachricht schreiben | Escribir un mensaje |
| Back to payments | Zurück zu Zahlungen | Volver a pagos |
| Message | Nachricht | Mensaje |
| Send message | Nachricht senden | Enviar mensaje |
| Cancel reply | Antwort abbrechen | Cancelar respuesta |
| This looks like a secret key | Das sieht wie ein geheimer Schlüssel aus | Esto parece una clave secreta |
| Never share it. Sending is blocked. | Teile ihn nie. Senden ist gesperrt. | No la compartas nunca. El envío está bloqueado. |
| {count} characters left | noch {count} Zeichen | quedan {count} caracteres |
| {count} characters too long | {count} Zeichen zu lang | {count} caracteres de más |
| Receive in | Empfangen in | Recibir en |
| Request from {name} | Anfrage an {name} | Solicitar a {name} |
| Request money | Geld anfordern | Solicitar dinero |
| Close | Schließen | Cerrar |
| Amount in sats | Betrag in Sats | Importe en sats |
| Note (optional) | Notiz (optional) | Nota (opcional) |
| What is it for? | Wofür ist das? | ¿Para qué es? |
| The smallest request is {amount} | Die kleinste Anfrage ist {amount} | La solicitud mínima es {amount} |
| The largest request is {amount} | Die größte Anfrage ist {amount} | La solicitud máxima es {amount} |
| Request {amount} | {amount} anfordern | Solicitar {amount} |
| Creating request | Anfrage wird erstellt | Creando solicitud |
| Only pay if you are sure who this is. | Zahle nur, wenn du sicher bist, wer das ist. | Paga solo si estás seguro de quién es. |
| The name looks like your contact {name}, but this is a different profile. Only pay if you are sure. | Der Name gleicht deinem Kontakt {name}, aber das Profil ist ein anderes. Zahle nur, wenn du sicher bist. | El nombre se parece a tu contacto {name}, pero es otro perfil. Paga solo si estás seguro. |
| Profile | Profil | Perfil |
| Add contact | Kontakt hinzufügen | Añadir contacto |
| Block | Blockieren | Bloquear |
| Nothing here yet. Request or send money to get started. | Noch nichts hier. Fordere Geld an oder sende welches. | Aún no hay nada. Solicita o envía dinero para empezar. |
| New messages | Neue Nachrichten | Mensajes nuevos |

Entry point keys (uncommitted work, see section 3):

| en-US | de | es |
|---|---|---|
| Message requests | Nachrichtenanfragen | Solicitudes de mensajes |
| No messages yet | Noch keine Nachrichten | Aún no hay mensajes |
| You requested {amount} | Du hast {amount} angefordert | Solicitaste {amount} |
| You paid the request | Du hast die Anfrage bezahlt | Pagaste la solicitud |
| You declined the request | Du hast die Anfrage abgelehnt | Rechazaste la solicitud |
| You withdrew a request | Du hast eine Anfrage zurückgezogen | Retiraste una solicitud |
| You sent a reminder | Du hast erinnert | Enviaste un recordatorio |
| Chat messages | Chat-Nachrichten | Mensajes del chat |
| Get a notification when someone writes to you. | Erhalte eine Benachrichtigung, wenn dir jemand schreibt. | Recibe una notificación cuando alguien te escriba. |
| Turn on payment notifications first. | Aktiviere zuerst die Zahlungsbenachrichtigungen. | Activa primero las notificaciones de pagos. |

Chat page keys (5626a3a):

| en-US | de | es |
|---|---|---|
| Set up your identity to use the chat. | Richte deine Identität ein, um den Chat zu nutzen. | Configura tu identidad para usar el chat. |
| {name} has no Nostr profile, so there is no chat. You can still pay them. | {name} hat kein Nostr-Profil, deshalb gibt es keinen Chat. Du kannst trotzdem bezahlen. | {name} no tiene perfil de Nostr, así que no hay chat. Aun así puedes pagarle. |
| View profile | Profil ansehen | Ver perfil |
| Mute | Stummschalten | Silenciar |
| Unmute | Stummschaltung aufheben | Dejar de silenciar |
| {name} can't receive messages yet. You can still send money. | {name} kann noch keine Nachrichten empfangen. Du kannst trotzdem Geld senden. | {name} aún no puede recibir mensajes. Aun así puedes enviar dinero. |
| {name} can't receive requests in the chat yet. | {name} kann im Chat noch keine Anfragen empfangen. | {name} aún no puede recibir solicitudes en el chat. |
| This contact can't receive requests in the chat yet. | Diese Person kann im Chat noch keine Anfragen empfangen. | Este contacto aún no puede recibir solicitudes en el chat. |
| Share your payment link instead. They can pay it from any wallet. | Teile stattdessen deinen Zahlungslink. Er funktioniert mit jeder Wallet. | Comparte tu enlace de pago. Se puede pagar desde cualquier wallet. |
| Share payment link | Zahlungslink teilen | Compartir enlace de pago |
| Block {name}? | {name} blockieren? | ¿Bloquear a {name}? |
| You will no longer receive messages or requests from them. | Du erhältst keine Nachrichten oder Anfragen mehr von dieser Person. | Ya no recibirás mensajes ni solicitudes de esta persona. |
| Blocked {name} | {name} blockiert | {name} bloqueado |
| Reminder sent | Erinnerung gesendet | Recordatorio enviado |
| Cannot create invoices | Kann keine Rechnungen erstellen | No puede crear facturas |
| {wallet} cannot create invoices. The request is paid to your profile address, which lands in {target}. | {wallet} kann keine Rechnungen erstellen. Die Anfrage wird an deine Profiladresse bezahlt und landet in {target}. | {wallet} no puede crear facturas. La solicitud se paga a tu dirección de perfil y llega a {target}. |
| {wallet} cannot create invoices. The request is paid to your profile address. | {wallet} kann keine Rechnungen erstellen. Die Anfrage wird an deine Profiladresse bezahlt. | {wallet} no puede crear facturas. La solicitud se paga a tu dirección de perfil. |
| This wallet can't create an invoice right now. Choose another wallet to receive in. | Diese Wallet kann gerade keine Rechnung erstellen. Wähle eine andere Wallet zum Empfangen. | Esta wallet no puede crear una factura ahora. Elige otra wallet para recibir. |
| The wallet returned an invalid invoice. Please try again. | Die Wallet hat eine ungültige Rechnung geliefert. Bitte versuche es erneut. | La wallet devolvió una factura no válida. Inténtalo de nuevo. |
| That message is too long. | Die Nachricht ist zu lang. | El mensaje es demasiado largo. |
| Unlock the app, then try again. | Entsperre die App und versuche es erneut. | Desbloquea la app e inténtalo de nuevo. |
| Couldn't send right now. Please try again in a moment. | Senden gerade nicht möglich. Bitte versuche es gleich noch einmal. | No se pudo enviar ahora. Inténtalo de nuevo en un momento. |

Plus: copy for the
DM_ERROR codes the UI shows (WALLET_CANNOT_INVOICE, INVALID_INVOICE,
WALLET_CANNOT_PAY, INVOICE_EXPIRED, NO_INBOX_RELAYS, NO_RELAY_ACCEPTED,
SECRET_KEY_IN_TEXT), "Receive in", "money lands in {wallet}" (Arkade
requests settle in the Spark wallet behind the profile address),
"unconfirmed" (foreign address without LUD-21 verify).
Remove the now-unused key "Payments you made to this contact." (en-US/de/es).

### 5. QA — full test run = baseline, `quasar build` OK, e2e green (b85f817)
`pnpm dev --port 9012` then `pnpm check:contact-chat` (two users, simulated
NIP-01/42 relay, all scenarios, en/de/es, light/dark, 125% text).
Not covered end-to-end yet: NWC payment execution (Wallet.vue builds its own
LightningPaymentService, no stub hook), a plain "Send" payment line (needs
an LNURL fetch). Still to do: Android device run.
- Playwright script `scripts/check-contact-chat.mjs`: simulated relays, all
  four wallet types, light/dark, de/en/es, large text.
- Full `npm test` against the baseline (known pre-existing failures on main:
  `walletLifetimes.spec.js` "removing a grouped wallet…" and
  `identity.spec.js` hanging; `nostrRelays.spec.js` eager test is timing
  sensitive under load).
- Production build (`quasar build`) and an Android device run.

### 5a. Request lifetime root fix — DONE (see docs/CONTACT_CHAT.md 8a)

### 5b. Simplify how a request gets paid — DONE (see docs/CONTACT_CHAT.md 8 and 8a)

A request is only a notice (amount, signed `lud16`, `valid_until`, optional
note) with no invoice. Requesting needs only the profile Lightning address
(`boot/payment-address.js` fills it), so it works the same for Spark, NWC,
LNbits and Arkade: a preflight checks that the address answers LNURL-pay and
accepts the amount, the sheet shows "To: <address>" or a set-up state when
there is none. The payer creates the invoice when tapping Pay, from the
requester's current kind 0 `lud16` (fallback: the signed one). Paid is detected
only by matching the payer's claim against the requester's own wallet ledger.
Removed: receiving-wallet choice, direct minting, invoice watchers, 24 h
invoice expiry, "Ask for a new request".

### 5c. LUD-21 verification for external addresses — DONE (see docs/CONTACT_CHAT.md 4, 8 and 8a)

The payer's `payment` message carries an optional `verify` tag (the LUD-21 URL
of the pulled invoice, https and same host only). When no wallet of the
requester shows the money, `settleClaims` asks that URL, but only on the domain
of the request's signed `lud16` or the current profile `lud16`
(`paymentVerification.js`). Settled, mainnet, amount at least the request,
preimage matching, hash not used before: the card reads "Received at
<address>". E2E step 3c covers it.

### 6. Known limitations / follow-ups
- Addresses whose service does not support LUD-21 stay "Reported paid, not
  verified" when their wallet is not in the app. So do payments to an npub.cash
  bucket address until the bucket is claimed into a wallet (the ledger only
  lists it then), unless npub.cash supports LUD-21 (not checked).
- "Send anyway" (generic send flow) does not carry the LUD-21 verify URL, so a
  late payment to an address outside the app is not verified.
- Muted 12px text contrast (`--text-muted`, ~3.1–3.8:1) is an app-wide
  token, below WCAG AA for small text.
- The confirm sheet calls a Lightning invoice "Bitcoin payment" (existing
  pipeline wording).
- A Spark send still pending after 60 s is not announced in the chat.
- Unknown-sender banner has no lookalike warning (needs a kind 0 fetch).
- `boot/dm-inbox.js` has its own visibility code; could reuse
  `utils/appVisibility.js`.
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
