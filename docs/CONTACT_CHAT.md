# Contact chat (money requests + encrypted messages)

Status: in implementation on `feat/contact-chat`. This document is the technical
contract every part of the feature is built against. Keep it current when a
contract changes.

## 1. What it is

A per-contact screen where two people **request and send money** and exchange
short **end-to-end encrypted messages**. Money first: text is a note on a payment
or a reply, never the point. The wallet must not turn into a messenger.

- Transport: Nostr NIP-17 private direct messages (NIP-59 gift wrap, NIP-44 v2).
- Identity: the existing BuhoGO identity (`stores/identity.js`, NIP-06 key). The
  identity is independent from wallets, so Spark (Breez), Arkade, NWC and LNbits
  users get the same feature set.
- Library: `nostr-core` (already a dependency). Gaps are wrapped locally and filed
  upstream (see section 11).

Non-goals: group chats, file messages (kind 15), read receipts, typing
indicators, push while the app is closed.

## 2. Product rules (from the reviewed design)

1. Build **on top of** existing UI. Existing screens keep their layout. New:
   the chat screen, badges, one identity row, the "Pay with" field.
2. Chat screen (`/address-book/:id/chat`):
   - Header: back · avatar · name · "🔒 End-to-end encrypted" (or "Payments only")
     · ⋮. Tapping the name opens the existing contact page (`/address-book/:id`),
     whose "Between you" section is the payment history (now both directions).
   - Body: messages, request cards, and payments as a subtle grey line.
   - Bottom bar: `[↙ Request] [↗ Send] [💬]`. 💬 swaps to a text field, ₿ swaps back.
3. Tapping a contact in the address book opens the chat.
4. Every payment surface gets a **"Pay with"** field listing all connected wallets
   (active first, balance shown, unusable ones disabled with a reason). The
   paying wallet is threaded through the send pipeline; the active wallet is
   never switched as a side effect.
5. The "Pay request" sheet shows no "amount in invoice" row. Invoice checks run
   silently and only surface as an error state on the card.
6. AUTH and relay handling are invisible to the user. No dialogs, no waiting.
7. No relay settings for normal users (rule from `utils/nostrRelays.js`).

## 3. Architecture

```
UI        pages/ContactChatPage.vue · components/chat/*
          + small additions: AddressBook (sections, badges), MenuOverlay (badge),
            IdentityHomePage (Messages row + sheet), ContactProfilePage (history),
            PaymentConfirmSheet ("Pay with")
Store     stores/messages.js            threads, statuses, unread, outbox (per identity)
Boot      boot/dm-inbox.js              lifecycle (like boot/profile-sync.js)
Services  services/dm/                  pure modules, no Pinia, unit tested
  constants.js      kinds, relay sets, limits
  errors.js         DmError + codes, NIP-01 relay reason parser
  protocol.js       BuhoGO convention v1: build and parse rumors
  giftWrap.js       seal + wrap one rumor for recipients and self
  openWrap.js       unwrap + integrity checks
  inboundPolicy.js  spam / abuse gates around unwrap
  inboxRelays.js    kind 10050: build own list, resolve others' lists (cached)
  sessionKey.js     in-memory identity key cache with wipe rules
  transport.js      relay connections with automatic NIP-42 AUTH
  inbox.js          coordinator: subscribe, sync, outbox, retries
  requests.js       invoices for requests, payment watching, status messages
Existing  identity · profile · addressBook · transactionMetadata · wallet providers
          · notifications (local notifications + toasts)
```

Dependency direction: UI → store → services → nostr-core. Services never import
Vue, Pinia or i18n; they return data and error codes. Strings live in the UI.

## 4. Protocol: BuhoGO convention v1

All application messages are NIP-17 rumors (unsigned events), sealed (kind 13)
and gift-wrapped (kind 1059) individually for every recipient **and** the sender
(self copy). `content` always carries a human-readable English fallback so other
NIP-17 clients (0xchat, Amethyst, …) show something sensible.

| Type | Rumor kind | Tags | Fallback content |
|---|---|---|---|
| text | 14 | `["p", recipient]`, optional `["e", replyToId, "", "reply"]` | the text |
| request | 14 | `["p", recipient]`, `["buho", "request", "1"]`, `["amount", "<msat>"]`, `["bolt11", "<invoice>"]`, optional `["lud16", "<address>"]`, `["expiration", "<unix>"]` | `💸 Payment request: 12,000 sats – Pizza\nlightning:<invoice>` |
| status | 14 | `["p", recipient]`, `["e", requestId, "", "reply"]`, `["buho", "status", "<paid\|declined\|cancelled\|reminder>", "1"]`, optional `["preimage", "<hex>"]` | `✅ Paid: 12,000 sats` / `Declined` / `Withdrawn` / `Reminder` |
| payment | 14 | `["p", recipient]`, `["buho", "payment", "1"]`, `["amount", "<msat>"]`, optional `["preimage", "<hex>"]`, optional `["e", requestId, "", "reply"]` | `↗ Sent 5,000 sats – Coffee` |
| reaction | 7 | `["e", targetId]`, `["p", targetAuthor]`, `["k", "14"]` | the emoji |

Parsing rules (`protocol.parseRumor`):
- Unknown or invalid `buho` payloads degrade to a plain text message (the
  fallback content) and are flagged `degraded: true`. They never get a pay action.
- A request is valid only if: `amount` is a positive integer msat value; `bolt11`
  decodes with `nostr-core` `bolt11.decode`; the invoice amount equals `amount`;
  the invoice network is mainnet. Expiry is evaluated at render time
  (`invoice.expiresAt`, `expiration` tag); an expired request is shown as expired.
- An incoming `payment` message never proves a payment. The chat shows an
  incoming payment line only when the own wallet confirms it
  (`sha256(preimage) === paymentHash` of an incoming transaction, otherwise
  amount + time window). Without a match it renders as a normal message.
- Text length is capped at `MAX_TEXT_LENGTH` (2,000 chars). The rumor JSON is
  capped at `MAX_RUMOR_BYTES` (40,000). NIP-44 encrypts at most 65,535 bytes,
  but the binding limit is the gift wrap's: it encrypts the seal, which already
  carries the rumor's ciphertext in base64. Measured with nostr-core 1.0.4, the
  largest rumor that still wraps is 40,960 bytes.

## 5. Relays and AUTH

| Purpose | Relays |
|---|---|
| Own DM inbox (kind 10050) | `wss://auth.nostr1.com`, `wss://relay.damus.io`, `wss://relay.nostr.net` (all serve kind 1059 only after NIP-42 AUTH; measured 2026-10-09) |
| Publish own 10050 / discover others' 10050 | `DEFAULT_RELAYS` + `wss://purplepag.es` (+ contact relay hints) |
| Send to a contact | every relay in **their** 10050; delivered when ≥ 1 relay accepts |
| Contact without 10050 | no message (NIP-17); a request is shared as a payment link |

Inbox subscription: `{ kinds: [1059], '#p': [me], since: lastSync - 2 days }`
(gift wrap timestamps are randomised up to two days into the past; duplicates
are removed by rumor id).

AUTH must be invisible:
- `boot/dm-inbox.js` pre-warms inbox connections at app start.
- `transport.js` uses its own `nostr-core` `Relay` instances (separate from the
  shared public pool, so the identity never authenticates public queries) and
  sets `onauth` **before** `connect()`.
- On `CLOSED "auth-required:…"` it authenticates and re-subscribes; on
  `OK false "auth-required:…"` it authenticates and re-sends once; after a
  reconnect it re-authenticates and restores subscriptions.
- Foreign inbox relays that require AUTH for writing get an **ephemeral** key per
  connection, so they never learn who writes.
- The identity key is loaded once per session (`sessionKey.js`) and kept only in
  memory. It is wiped (bytes zeroed) on app lock, identity change, identity
  reset and after 10 minutes in the background.

## 6. Module contracts (`src/services/dm/`)

All functions are pure or take their collaborators as arguments (pool, wallet
store, clock) so they can be unit tested without network or Pinia.

- `constants.js` — `KIND` (`DM: 14, REACTION: 7, SEAL: 13, GIFT_WRAP: 1059,
  DM_RELAYS: 10050, MUTE_LIST: 10000, AUTH: 22242`), `DM_INBOX_RELAYS`,
  `DM_DISCOVERY_RELAYS`, `PROTOCOL_VERSION = '1'`, `MAX_TEXT_LENGTH` (2,000),
  `MAX_NOTE_LENGTH` (200), `MAX_RUMOR_BYTES` (40,000), `SINCE_SLACK_SECONDS`
  (2 days), `INBOX_RELAY_CACHE_TTL_MS` (24 h), `MAX_INBOX_RELAYS_PER_CONTACT`
  (5), `KEY_IDLE_WIPE_MS` (10 min). All frozen.
- `errors.js` — the only error type services throw:
  `new DmError(code, message?, { cause?, details? })` with `code` from the frozen
  `DM_ERROR` map (`INVALID_ARGUMENT`, `MESSAGE_TOO_LARGE`, `NO_IDENTITY`,
  `KEY_WIPED`, `NO_INBOX_RELAYS`, `NO_RELAY_ACCEPTED`, `RELAY_UNAVAILABLE`,
  `AUTH_FAILED`, `TIMEOUT`, `INVALID_INVOICE`, `WALLET_CANNOT_INVOICE`,
  `WALLET_CANNOT_PAY`); an unknown code throws a `TypeError`. `message` is
  developer text, never shown; `details` holds small non-secret facts (relay
  URL, counts). Catch with `DmError.is(err, code?)`. Relay replies:
  `RELAY_REASON` (the NIP-01 prefixes `duplicate`, `pow`, `blocked`,
  `rate-limited`, `invalid`, `restricted`, `mute`, `error` and NIP-42
  `auth-required`), `parseRelayReason(reason) → { prefix | null, message }`
  (never throws), `isAuthRequired(reason | parsed)`,
  `isRetryableRelayReason(prefix)` (`rate-limited`, `error`, `auth-required`)
  and `isDeliveredRelayReason({ ok, reason })` (accepted or `duplicate`).
- `protocol.js` — `MESSAGE_TYPE`, `REQUEST_STATUS`, template builders
  (`buildTextTemplate`, `buildRequestTemplate`, `buildStatusTemplate`,
  `buildPaymentTemplate`, `buildReactionTemplate`) returning `EventTemplate`s,
  and `parseRumor(rumor, { me }) → ChatMessage`.
- `giftWrap.js` — `sealAndWrap({ template, senderSecretKey, recipients,
  selfCopy = true }) → { rumor, wraps: [{ recipient, event }] }`.
- `openWrap.js` — `openGiftWrap(event, recipientSecretKey, { me }) →
  { ok: true, rumor, sender } | { ok: false, reason }` (reasons:
  `not-gift-wrap`, `undecryptable`, `invalid-seal`, `impersonation`,
  `id-mismatch`, `not-addressed`).
- `inboundPolicy.js` — `createWrapGate()` (before unwrap) and
  `createRumorGate({ isBlocked, ratePerMinute })` (after unwrap) on top of
  `nostr-core` `policy`.
- `inboxRelays.js` — `buildInboxRelayListEvent(relays, secretKey)`,
  `parseInboxRelayList(event)`, `createInboxRelayResolver({ pool,
  discoveryRelays, ttlMs, now })`.
- `sessionKey.js` — `createSessionKey({ load, now, idleWipeMs })` →
  `{ get(), peekPubkey(), wipe(reason), touch() }`.
- `transport.js` — `createDmTransport({ getIdentityKey, WebSocket, reconnect,
  publishTimeoutMs, onStatus })` → `{ subscribe, publish, status, close }`.
- `inbox.js`, `requests.js` — see sections 7 and 8.

`ChatMessage` (normalised, what the store keeps):

```js
{
  id, kind, type,            // 'text' | 'request' | 'status' | 'payment' | 'reaction'
  sender, recipient,         // hex pubkeys
  createdAt,                 // unix seconds (rumor created_at)
  text,                      // display text (fallback for degraded messages)
  replyTo,                   // rumor id or null
  request,                   // { amountSats, note, bolt11, paymentHash, lud16, expiresAt } | null
  status,                    // { requestId, value, preimage } | null
  payment,                   // { amountSats, note, preimage, requestId } | null
  reaction,                  // { targetId, emoji } | null
  degraded,                  // true when a buho payload was invalid
}
```

## 7. Store and persistence (`stores/messages.js`)

- Scoped to the active identity pubkey; switching identity loads another scope
  and never mixes data (pattern: `addressBook._adoptSyncIdentity`).
- Threads keyed by contact pubkey: messages sorted by `createdAt`, unread count,
  last read time, per-message local state (`delivery: queued | sending | sent |
  failed`, reactions).
- Requests indexed by id with derived status (`pending | paid | declined |
  cancelled | expired`).
- Outbox for messages written offline; flushed by `inbox.js` when online.
- Sync cursor (`lastSyncAt`), blocked pubkeys (mirrored to a private NIP-51
  kind 10000 list), per-contact mute flags.
- Persistence: encrypted with `utils/deviceCrypto.encryptString`, stored in
  IndexedDB (same pattern as `utils/kitStorage.js`), debounced writes, pruning
  of old messages.

## 8. Money

Requesting (one invoice per request):
- Destination wallet defaults to the wallet behind the profile Lightning address
  (`preferredProfileLightningAddress`, normally Spark Business), otherwise the
  first wallet that can create invoices. The user can change it in the sheet.
- `provider.createInvoice({ amount, description, expiry })`; Spark (Breez) adds
  `includeSparkAddress: true` so Spark payers pay without fees. NWC only when
  `supportsMethod('make_invoice')`.
- Fallback (Arkade, NWC without `make_invoice`): invoice from the profile
  address via LNURL-pay with comment `buho:req:<id>` (LUD-12) and LUD-21
  `verify` (supported by the Breez LNURL server behind `btc.mybuho.de`).
- Detecting payment: Breez `onPaymentReceived`, NWC
  `subscribeToPaymentNotifications`, LNbits `lookupInvoice` polling, and a
  reconcile on app resume. When paid: send `status: paid`, link the transaction
  in `transactionMetadata` (contact, note, label).

Paying a request / sending:
- Decode and check the invoice silently (`bolt11.decode`).
- Hand over to the existing pipeline (`payContactDestination` →
  `onPaymentDetected` → `PaymentConfirmSheet` → slide to send) with the chosen
  `sendingWalletId`.

| | Spark (Breez) | NWC | LNbits | Arkade |
|---|---|---|---|---|
| Messages | ✓ | ✓ | ✓ | ✓ |
| Request | ✓ direct | ✓ with `make_invoice`, else fallback | ✓ direct | fallback (profile address) |
| Pay / send | ✓ | ✓ with `pay_invoice` | ✓ | disabled: Lightning unavailable |
| Detect paid | event | notification / polling | polling | – |

## 9. Notifications

Reuse `services/paymentNotifications.js`, `stores/notifications.js`, the
"happened while hidden" logic (`visibilitySnapshot`) and the in-app toasts.
Additions: an Android channel `messages` next to `payments`, `extra.route` on
every notification plus a tap listener that opens it, one notification per chat
(grouped, fixed id per contact), and a per-feature toggle for messages. No
notification for self copies, blocked or muted contacts, or the chat currently
on screen.

## 10. Security rules

- Never log decrypted content, keys or invoices (`utils/logRedaction.js`).
- Identity key bytes are zeroed on wipe and never stored by this feature.
- Reject rumors whose id does not hash to their content (upstream #73).
- Unknown senders go to an "Unknown" section; lookalike names get an impostor
  warning (nostrdesign.org guidance). Blocked senders are dropped after unwrap.
- Per-sender rate limit after unwrap; size limits before unwrap.
- A pasted `nsec` in the composer blocks sending.

## 11. Upstream (`nostr-core`) gaps

| Issue | Local workaround |
|---|---|
| [#72](https://github.com/nostr-core-org/nostr-core/issues/72) AUTH: `auth-required` kills subscriptions/publishes, no retry | `transport.js` |
| [#73](https://github.com/nostr-core-org/nostr-core/issues/73) `unwrap` trusts a forged rumor id | `openWrap.js` recomputes the id |
| [#74](https://github.com/nostr-core-org/nostr-core/issues/74) nip17 helpers: no self copy / multi-recipient / kind 7 | `giftWrap.js` + `openWrap.js` on nip59 primitives |
| [#75](https://github.com/nostr-core-org/nostr-core/issues/75) per-relay publish results, NIP-01 reason parser | `transport.js` + `errors.js` |

Replace the workaround when the upstream fix ships.

## 12. Testing

- Unit tests next to the code in `__tests__/*.spec.js` using `node:test`
  (`import { test } from 'node:test'`), registered in the `node --test` part of
  the `npm test` script.
- Transport tests use an in-memory fake WebSocket relay (AUTH challenge, CLOSED
  auth-required, OK false, drops and reconnects).
- A Playwright check script (`scripts/check-contact-chat.mjs`) drives the UI with
  simulated relays, all four wallet types, dark and light, de / en / es and large
  text.
- Requires Node ≥ 22.22 (`@quasar/app-vite`).
