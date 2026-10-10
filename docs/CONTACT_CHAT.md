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
| request | 14 | `["p", recipient]`, `["buho", "request", "1"]`, `["amount", "<msat>"]`, `["bolt11", "<invoice>"]`, optional `["note", "<text>"]`, `["lud16", "<address>"]` | `💸 Payment request: 12,000 sats – Pizza\nlightning:<invoice>` |
| status | 14 | `["p", recipient]`, `["e", requestId, "", "reply"]`, `["buho", "status", "<paid\|declined\|cancelled\|reminder>", "1"]`, optional `["preimage", "<hex>"]` | `✅ Paid: 12,000 sats` (or `✅ Paid`) / `✖️ Declined the payment request` / `↩️ Withdrew the payment request` / `🔔 Reminder: payment request still open` |
| payment | 14 | `["p", recipient]`, `["buho", "payment", "1"]`, `["amount", "<msat>"]`, optional `["note", "<text>"]`, `["preimage", "<hex>"]`, `["e", requestId, "", "reply"]` | `↗ Sent 5,000 sats – Coffee` |
| reaction | 7 | `["e", targetId]`, `["p", partner]`, `["k", "14"]` | the emoji |

No NIP-40 `expiration` tag on rumors or wraps: other clients and relays would
delete the history. A request's lifetime is **not** its invoice's: see
section 8a. Requests carry `["valid_until", "<unix>"]` (BuhoGO: created_at +
30 days) and, always when the requester has one, `["lud16", …]`. In a
reaction the `p` tag names the conversation partner (NIP-17 room
membership), also when reacting to one's own message.

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
| Own DM inbox (kind 10050) | `wss://auth.nostr1.com`, `wss://nos.lol`, `wss://relay.primal.net` (see measurement below) |
| Publish own 10050 / discover others' 10050 | `DEFAULT_RELAYS` + `wss://purplepag.es` (+ contact relay hints) |
| Send to a contact | every relay in **their** 10050; delivered when ≥ 1 relay accepts |
| Contact without 10050 | no message (NIP-17); a request is shared as a payment link |

Inbox relay choice (measured 2026-10-10 with a test wrap on 29 relays):
`auth.nostr1.com` was the only free relay that hides kind 1059 from strangers
and serves it after NIP-42 AUTH; it accepts writes after AUTH with any key.
`relay.damus.io` and `relay.nostr.net` refuse 1059 reads but their AUTH is
broken server-side ("relay needs serviceUrl to be configured"), so nothing
can be read there; they also nest the prefix (`ERROR: auth-required: …`).
`nos.lol` and `relay.primal.net` accept and serve wraps without AUTH (content
stays encrypted; only "this pubkey receives wraps" is public). Three
operators keep a single outage from cutting off money requests. Revisit when
damus/nostr.net fix AUTH.

Inbox subscription: `{ kinds: [1059], '#p': [me], since: lastSync - 2 days }`
(gift wrap timestamps are randomised up to two days into the past; duplicates
are removed by rumor id).

AUTH must be invisible:
- `boot/dm-inbox.js` pre-warms inbox connections at app start.
- `transport.js` uses its own `nostr-core` `Relay` instances (separate from the
  shared public pool, so the identity never authenticates public queries) and
  sets `onauth` **before** `connect()`.
- Two roles, never mixed, so a relay in both sets gets two sockets:
  **read** connections (own inbox only) answer a challenge at once with the
  identity; **write** connections (every publish, self copies included)
  answer at once with an **ephemeral** key per connection, so no relay learns
  who writes.
- On `CLOSED "auth-required:…"` it authenticates and re-subscribes; on
  `OK false "auth-required:…"` it authenticates and re-sends once; after a
  reconnect it re-authenticates and restores subscriptions. A failed AUTH
  marks that relay `auth-failed` and it is not retried until the next
  connection; the other relays carry on.
- The identity key is loaded once per session (`sessionKey.js`) and kept only in
  memory. It is wiped (bytes zeroed) on app lock, identity change, identity
  reset and after 10 minutes in the background.

## 6. Module contracts (`src/services/dm/`)

All functions are pure or take their collaborators as arguments (pool, wallet
store, clock) so they can be unit tested without network or Pinia.

- `constants.js` — `KIND` (`DM: 14, REACTION: 7, SEAL: 13, GIFT_WRAP: 1059,
  DM_RELAYS: 10050, MUTE_LIST: 10000, AUTH: 22242`), `DM_INBOX_RELAYS`
  (auth.nostr1.com, nos.lol, relay.primal.net; section 5),
  `DM_DISCOVERY_RELAYS`, `PROTOCOL_VERSION = '1'`, `MAX_TEXT_LENGTH` (2,000),
  `MAX_NOTE_LENGTH` (200), `MAX_RUMOR_BYTES` (40,000), `SINCE_SLACK_SECONDS`
  (2 days), `INBOX_RELAY_CACHE_TTL_MS` (24 h), `MAX_INBOX_RELAYS_PER_CONTACT`
  (5), `KEY_IDLE_WIPE_MS` (10 min). All frozen.
- `errors.js` — the only error type services throw:
  `new DmError(code, message?, { cause?, details? })` with `code` from the frozen
  `DM_ERROR` map (`INVALID_ARGUMENT`, `MESSAGE_TOO_LARGE`, `NO_IDENTITY`,
  `KEY_WIPED`, `NO_INBOX_RELAYS`, `NO_RELAY_ACCEPTED`, `RELAY_UNAVAILABLE`,
  `AUTH_FAILED`, `TIMEOUT`, `INVALID_INVOICE`, `WALLET_CANNOT_INVOICE`,
  `WALLET_CANNOT_PAY`, `SECRET_KEY_IN_TEXT`); an unknown code throws a `TypeError`. `message` is
  developer text, never shown; `details` holds small non-secret facts (relay
  URL, counts). Catch with `DmError.is(err, code?)`. Relay replies:
  `RELAY_REASON` (the NIP-01 prefixes `duplicate`, `pow`, `blocked`,
  `rate-limited`, `invalid`, `restricted`, `mute`, `error` and NIP-42
  `auth-required`), `parseRelayReason(reason) → { prefix | null, message }`
  (never throws), `isAuthRequired(reason | parsed)` (also one nested
  level under `error:`, as relay.damus.io and relay.nostr.net send it),
  `isRetryableRelayReason(prefix)` (`rate-limited`, `error`, `auth-required`)
  and `isDeliveredRelayReason({ ok, reason })` (accepted or `duplicate`).
- `protocol.js` — `MESSAGE_TYPE`, `REQUEST_STATUS`, template builders
  (`buildTextTemplate`, `buildRequestTemplate`, `buildStatusTemplate`,
  `buildPaymentTemplate`, `buildReactionTemplate`) returning `EventTemplate`s
  (they validate and throw `DmError`), `containsSecretKey(text)` (an `nsec1…`
  or `ncryptsec1…` in the text; `buildTextTemplate` refuses it with
  `SECRET_KEY_IN_TEXT`), and `parseRumor(rumor, { me }) → ChatMessage | null`
  (never throws; `null` for kinds other than 14/7, group messages, notes to
  self, malformed rumors, incoming rumors not addressed to `me` and invalid
  reactions). Builders and parser share one set of validators; an invalid
  `buho` payload degrades to text. A payment's preimage is optional (Spark
  transfers, Arkade and some NWC wallets have none).
  Lengths are counted in Unicode code points.
- `giftWrap.js` — `sealAndWrap({ template, senderSecretKey, recipients,
  selfCopy = true }) → { rumor, wraps: [{ recipient, self, event }] }`: one
  rumor (one id), sealed and wrapped per recipient, self copy last; rumor JSON
  over `MAX_RUMOR_BYTES` → `MESSAGE_TOO_LARGE`.
- `openWrap.js` — `openGiftWrap(event, recipientSecretKey, { me }) →
  { ok: true, rumor, sender } | { ok: false, reason }` (reasons:
  `not-gift-wrap`, `not-addressed`, `undecryptable`, `invalid-seal`,
  `impersonation`, `invalid-rumor`, `id-mismatch`). Built on `nip44`
  primitives (not `nip59.unwrap`) so every failure has a precise reason;
  never throws.
- `inboundPolicy.js` — `createWrapGate()` (before unwrap: kind 1059, content
  ≤ 87,472 chars = largest NIP-44 payload, ≤ 1 h in the future, not expired,
  no duplicate wrap id) and `createRumorGate({ me, isBlocked, rate })` (after
  unwrap: kind 14/7, sender not blocked, not expired, no duplicate rumor id,
  optional per-sender `rate: { max, windowMs }` that never applies to `me`;
  the inbox uses a rate only for live events, not for backfill). Both on
  `nostr-core` `policy.pipe`, returning `PolicyResult`.
- `inboxRelays.js` — `buildInboxRelayListTemplate(relays, { now })`,
  `parseInboxRelayList(event) → string[]` (normalised `wss://` URLs, deduped,
  capped at `MAX_INBOX_RELAYS_PER_CONTACT`), `createInboxRelayResolver({
  ensureRelay, discoveryRelays, ttlMs, missingTtlMs, timeoutMs, now })` →
  `{ resolve(pubkey, { hints, force }), peek, invalidate, snapshot, hydrate }`
  (URLs pass `normalizeInboxRelayUrl`, which refuses loopback, private,
  link-local, `.local` and `.onion` hosts so a hostile list cannot probe the
  user's network)
  resolving to `{ status: 'found' | 'missing' | 'unknown', relays, checkedAt }`
  (`missing` = at least one relay answered and none had a usable list;
  `unknown` = no relay answered, not cached; concurrent lookups share one
  query; newest event wins).
- `sessionKey.js` — `createSessionKey({ load, pubkey, setTimer, clearTimer, onWipe })`
  → `{ use(fn), wipe(reason), wipeAfter(ms), cancelWipe(), isLoaded(),
  dispose() }`. Key bytes never leave it: `use(fn)` loads once (concurrent
  calls share the load), checks the bytes belong to `pubkey`, and calls the
  **synchronous** `fn(secretKey)`. A wipe during a load discards the loaded
  bytes and rejects with `KEY_WIPED`; load failures become `NO_IDENTITY`.
  One instance per identity; the boot calls `wipeAfter(KEY_IDLE_WIPE_MS)`
  when the app is hidden and `wipe('lock')` on `app:locked`.
- `transport.js` — `createDmTransport({ signAuth, WebSocket, … , onStatus })`
  → `{ subscribe, publish, warmUp, status, resetIdentity, close }`.
  `signAuth({ relay, challenge })` signs the identity's kind 22242 (the
  inbox wires it to `sessionKey.use`). `subscribe(relays, filters, {
  onevent(event, relay), oneose(relay), onclosed(relay, reason) })` is a
  logical subscription over read connections that survives AUTH and
  reconnects until `close()`. `publish(relays, event)` returns `{
  firstAccept, allSettled }` like `publishToRelaysEager`, never rejecting;
  each result is `{ relay, ok, prefix, message, code, attempts }` (`ok` =
  delivered, `duplicate` included).
- `inbox.js`, `requests.js` — see sections 7 and 8.

`ChatMessage` (normalised, what the store keeps):

```js
{
  id, kind, type,            // 'text' | 'request' | 'status' | 'payment' | 'reaction'
  sender, recipient,         // hex pubkeys
  partner, outgoing,         // the contact's pubkey; sender === me
  createdAt,                 // unix seconds (rumor created_at)
  text,                      // display text (fallback for degraded messages)
  replyTo,                   // rumor id or null
  request,                   // { amountSats, note, bolt11, paymentHash, lud16, expiresAt } | null
  status,                    // { requestId, value, preimage } | null
  payment,                   // { amountSats, note, preimage (or null), requestId } | null
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

## 8a. Request lifetime vs. invoice expiry (no dead ends)

A request is an intent ("Anna asks 3,000 sats for pizza"); the invoice is
only the current means to pay it. Invoices expire (24 h); requests do not
end with them.

- **Request lifetime:** open until paid, declined or withdrawn, or until
  `valid_until` (created_at + `REQUEST_LIFETIME_SECONDS` = 30 days). Without
  `valid_until` (other clients): the invoice expiry, unless a `lud16` is
  present, then 30 days from created_at. `expired` means the request
  lifetime ended, never just the invoice.
- **Payer pulls a fresh invoice:** if the request's invoice has expired (or
  expires within 60 s), "Pay" fetches a new invoice from the request's signed
  `lud16` via LNURL-pay for exactly the requested amount (LUD-12 comment
  `buho:req:<reference>` when allowed), validates it (decodes, mainnet, exact
  amount, not expired, within min/maxSendable) and hands it to the normal
  pipeline with "Pay with". The user sees no difference. Out-of-range or
  LNURL failure → clear error with the next action ("Ask for a new request").
- **Requester confirms late payments:** the payer's `payment` message
  (requestId, preimage if any) is matched against the requester's own wallet
  ledger (preimage hash, else amount + time window, one tx per claim) → the
  request becomes `paid` (verified), the tx is linked to the contact and the
  card says where it was received. Without a ledger match it stays
  "Reported paid, not verified". The original-invoice watcher stops at the
  invoice expiry as before; reconcile on resume also checks claims.
- **Next action in every state:**

  | State | Payer | Requester |
  |---|---|---|
  | pending (invoice valid or not) | Decline · Pay | Remind · Withdraw |
  | expired (lifetime over) | Send anyway (amount + note prefilled, linked to the request) | Request again (one tap, same amount + note) |
  | pending, invoice expired, no `lud16` | Decline · Ask for a new request (prefilled message) | Remind · Withdraw |

  A late "Send anyway" payment linked to an expired request marks it paid
  (paid is final and wins over expired).
- Trade-off: a pulled payment lands in the wallet behind the requester's
  Lightning address (normally Spark Business), not necessarily the wallet
  chosen for the original invoice; the paid card names the wallet.

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
