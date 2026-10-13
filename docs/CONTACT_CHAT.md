# Contact chat (money requests + encrypted messages)

This document is the technical contract every part of the feature is built
against. Keep it current when a contract changes; open work is in section 13.

## 1. What it is

A per-contact screen where two people **request and send money** and exchange
short **end-to-end encrypted messages**. Money first: text is a note on a payment
or a reply, never the point. The wallet must not turn into a messenger.

- Transport: Nostr NIP-17 private direct messages (NIP-59 gift wrap, NIP-44 v2).
- Identity: the identity in use (`stores/identity.js`): a BuhoGO identity
  (NIP-06 key), an imported secret key, or one that signs in another app (NIP-07
  extension, NIP-46 remote signer; section 5a). The identity is independent
  from wallets, so Spark (Breez), Arkade, NWC and LNbits users get the same
  feature set.
- Library: `nostr-core` (already a dependency). Gaps are wrapped locally and filed
  upstream (see section 11).

Non-goals: group chats, sending files, read receipts, typing
indicators, push while the app is closed.

## 2. Product rules (from the reviewed design)

1. Build **on top of** existing UI. Existing screens keep their layout. New:
   the chat screen, unread badges, one "Messages" row in the address book.
2. Chat screen (`/address-book/:id/chat`):
   - Header: back · avatar · name (a bell-off when muted) · "End-to-end
     encrypted" (or "Payments only") · menu. Tapping the name opens the existing
     contact page (`/address-book/:id`), whose "Between you" section is the
     payment history (both directions).
   - Body: messages, request cards, and payments as a subtle grey line.
   - Bottom bar, no modes: the message field (grows to five lines) above
     `[↙ Request] [↗ Send]`. A partner without an inbox gets the two buttons
     only. A disabled button says why, right above it.
   - One filled button per screen: a pending request's Pay. Request and Send
     are the quiet pair in light mode; an expired request's "Send anyway" is
     quiet too.
3. Contacts with a Nostr profile: tapping the row opens the chat. Contacts saved
   with only a name and an address keep the address book as it was before the
   chat (row opens their page, Pay pays); a stale chat link to one goes on to
   their page.
3a. Messages live in the address book: one "Messages" row at the top lists every
   conversation (contacts first, then "Not in your contacts"). The menu badge
   counts unread messages from contacts only, so strangers cannot raise it; the
   Messages row counts everyone.
3b. What the partner sees is confirmed first (HIG, destructive actions): Block,
   Decline ("Decline ₿ 1,000 for Pizza?") and "Cancel request" share one
   confirmation dialog. Remind works once a day, then reads "Reminded".
3c. A request can be typed in sats or the preferred fiat currency (the confirm
   sheet's unit pill); the request itself is always in sats. Dates follow the
   app's language, not the device's.
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
  dmSigner.js       the chat signer: key on this phone or a signer app, one async interface
  sessionKey.js     in-memory identity key cache with wipe rules (local signer)
  transport.js      relay connections with automatic NIP-42 AUTH
  inbox.js          coordinator: subscribe, sync, outbox, retries
  requests.js       profile-address preflight, payer-side address lookup and invoice pull
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
| request | 14 | `["p", recipient]`, `["buho", "request", "1"]`, `["amount", "<msat>"]`, `["lud16", "<address>"]`, `["valid_until", "<unix>"]`, optional `["note", "<text>"]` | `💸 Payment request: 12,000 sats – Pizza\nPay to: anna@btc.mybuho.de` |
| status | 14 | `["p", recipient]`, `["e", requestId, "", "reply"]`, `["buho", "status", "<paid\|declined\|cancelled\|reminder>", "1"]`, optional `["preimage", "<hex>"]` | `✅ Paid: 12,000 sats` (or `✅ Paid`) / `✖️ Declined the payment request` / `↩️ Withdrew the payment request` / `🔔 Reminder: payment request still open` |
| payment | 14 | `["p", recipient]`, `["buho", "payment", "1"]`, `["amount", "<msat>"]`, optional `["note", "<text>"]`, `["preimage", "<hex>"]`, `["e", requestId, "", "reply"]`, optional `["verify", "<url>"]` | `↗ Sent 5,000 sats – Coffee` |
| reaction | 7 | `["e", targetId]`, `["p", partner]`, `["k", "14"]` | the emoji |

No NIP-40 `expiration` tag on rumors or wraps: other clients and relays would
delete the history. A request is only a notice: it carries no invoice, but the
amount, the requester's Lightning address (`lud16`, required) and
`["valid_until", "<unix>"]` (created_at + 30 days). The fallback line lets a
person in another NIP-17 client pay the address by hand. In a reaction the `p`
tag names the conversation partner (NIP-17 room membership), also when
reacting to one's own message.

Parsing rules (`protocol.parseRumor`):
- Unknown or invalid `buho` payloads degrade to a plain text message (the
  fallback content) and are flagged `degraded: true`. They never get a pay action.
- A request is valid only if: `amount` is a positive whole-sat msat value,
  `lud16` is a Lightning address and `valid_until` is a unix time after the
  request's `created_at`. Otherwise it degrades to text. Expiry (`valid_until`
  passed) is evaluated at render time.
- An incoming `payment` message never proves a payment. The chat shows an
  incoming payment line only when the own wallet confirms it
  (`sha256(preimage) === paymentHash` of an incoming transaction, otherwise
  amount + time window). Without a match it renders as a normal message.
- The optional `verify` tag of a `payment` carries the LUD-21 verify URL of the
  invoice that was paid (section 8a). It must be `https:` and at most
  `MAX_VERIFY_URL_LENGTH` (1,000) characters; anything else is dropped (the
  payment itself stays intact, it is just not verifiable that way). The URL is
  untrusted: the receiver fetches it only on the host of its own Lightning
  address.
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
- Roles, never mixed, so a relay in both sets gets two sockets:
  **read** connections (own inbox only) answer a challenge at once with the
  identity; **write** connections (every publish, self copies included)
  answer at once with an **ephemeral** key per connection, so no relay learns
  who writes. Some inbox relays take gift wraps from senders they know only
  (NIP-59, spam section): a copy such a relay refuses for who wrote it
  (`restricted:`, or an AUTH it did not accept) goes once more to that relay
  alone over an **identity write** connection, which answers AUTH with the
  identity. That relay then learns who wrote that copy; no other relay does.
  `resetIdentity()` closes identity write connections with the read ones.
- On `CLOSED "auth-required:…"` it authenticates and re-subscribes; on
  `OK false "auth-required:…"` it authenticates and re-sends once; after a
  reconnect it re-authenticates and restores subscriptions. A failed AUTH
  marks that relay `auth-failed` and it is not retried until the next
  connection; the other relays carry on.
- A key on this phone is loaded once per session (`sessionKey.js`) and kept
  only in memory. It is wiped (bytes zeroed) on app lock, identity change,
  identity reset and after 10 minutes in the background.

## 5a. Identities that sign in another app (NIP-07, NIP-46)

Every seal, decrypt and AUTH goes through `dmSigner.js`, so the chat works the
same for a key on this phone and for a signer app. What changes with a signer
app (patterns from Lotus, Coracle/welshman, Amethyst, NDK, noStrudel):

- Opt-in: receiving starts only after the person taps "Turn on messages"
  (`signerAppMessages`, per identity). The notice asks them to choose "always
  allow", so the app asks once, not per message. Sending works without it.
- Calls: a message costs 2 signer calls per copy (NIP-44 encrypt + seal
  signature; recipient and self copy), opening one costs 2 decrypts. The wrap
  itself always uses a throwaway local key.
- At most 1 request at a time for an extension (each may prompt), 3 for a
  remote signer; 30 s per request (`SIGNER_TIMEOUT_MS`).
- Nothing is lost: a locked or hidden app, a signer that is away
  (`SIGNER_UNAVAILABLE`), declines (`SIGNER_DENIED`)
  or lacks NIP-44 (`SIGNER_UNSUPPORTED`) keeps the wrap waiting and the cursor
  in place. The store's `signerHold` tells the notice why; "Try again" or
  coming back to the app opens the waiting wraps.
- After a refusal no background request goes out until the person retries or
  sends something themselves (no prompt loop).
- A remote signer that wants approval on its own page (NIP-46 `auth_url`) is
  not refusing: the request keeps waiting, and `boot/signer-approval.js` names
  the page's host in a toast with Open. It never opens on its own. The 30 s
  per request still applies; work that timed out meanwhile goes again on Try
  again or when the app comes back.
- Nothing is asked while the app is in the background.
- Each wrap is decrypted once: `handledWraps` remembers wraps already dealt
  with across restarts (the inbox re-reads two days on every start).
- The runtime's signer is pinned to its identity: after a switch it is never
  asked again.

## 6. Module contracts (`src/services/dm/`)

All functions are pure or take their collaborators as arguments (pool, wallet
store, clock) so they can be unit tested without network or Pinia.

- `constants.js` — `KIND` (`DM: 14, REACTION: 7, SEAL: 13, GIFT_WRAP: 1059,
  DM_RELAYS: 10050, MUTE_LIST: 10000, AUTH: 22242`), `DM_INBOX_RELAYS`
  (auth.nostr1.com, nos.lol, relay.primal.net; section 5),
  `DM_DISCOVERY_RELAYS`, `PROTOCOL_VERSION = '1'`, `MAX_TEXT_LENGTH` (2,000),
  `MAX_NOTE_LENGTH` (200), `REQUEST_LIFETIME_SECONDS` (30 days), `MAX_RUMOR_BYTES` (40,000), `SINCE_SLACK_SECONDS`
  (2 days), `INBOX_RELAY_CACHE_TTL_MS` (24 h), `MAX_INBOX_RELAYS_PER_CONTACT`
  (5), `KEY_IDLE_WIPE_MS` (10 min). All frozen.
- `errors.js` — the only error type services throw:
  `new DmError(code, message?, { cause?, details? })` with `code` from the frozen
  `DM_ERROR` map (`INVALID_ARGUMENT`, `MESSAGE_TOO_LARGE`, `NO_IDENTITY`,
  `KEY_WIPED`, `NO_INBOX_RELAYS`, `NO_RELAY_ACCEPTED`, `RELAY_UNAVAILABLE`,
  `AUTH_FAILED`, `TIMEOUT`, `INVALID_INVOICE`,
  `SECRET_KEY_IN_TEXT`, `NO_PAYMENT_ADDRESS`, `PAYMENT_ADDRESS_UNREACHABLE`,
  `INVOICE_FETCH_FAILED`, `AMOUNT_OUT_OF_RANGE`); an unknown code throws a `TypeError`. `message` is
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
- `dmSigner.js` — `createLocalDmSigner({ pubkey, sessionKey })` and
  `createExternalDmSigner({ pubkey, acquire, isLocked, isHidden, maxParallel,
  timeoutMs })` → `{ pubkey, external, nip44Encrypt(peer, text),
  nip44Decrypt(peer, payload), signEvent(template), allowAgain, wipe,
  wipeAfter, cancelWipe, isLoaded, dispose }`; `toDmError(err)` maps signer
  app errors (section 5a).
- `giftWrap.js` — `async sealAndWrap({ template, signer, recipients,
  selfCopy = true }) → { rumor, wraps: [{ recipient, self, event, seal }] }`:
  one rumor (one id), sealed by the signer and wrapped per recipient, self
  copy last; rumor JSON over `MAX_RUMOR_BYTES` → `MESSAGE_TOO_LARGE`; a seal
  not signed by the sender → `NO_IDENTITY`. `rewrap(seal, recipient)` makes a
  fresh wrap (new throwaway key and timestamp) without the signer.
- `openWrap.js` — `async openGiftWrap(event, signer, { me }) →
  { ok: true, rumor, sender } | { ok: false, reason }` (reasons:
  `not-gift-wrap`, `not-addressed`, `undecryptable`, `invalid-seal`,
  `impersonation`, `invalid-rumor`, `id-mismatch`). Built on the signer's
  NIP-44 decrypt (not `nip59.unwrap`) so every failure has a precise reason;
  throws only when the signer cannot answer now (`isSignerWait`).
- `inboundPolicy.js` — `createWrapGate()` (before unwrap: kind 1059, content
  ≤ 87,472 chars = largest NIP-44 payload, ≤ 1 h in the future, not expired,
  no duplicate wrap id) and `createRumorGate({ me, isBlocked, rate })` (after
  unwrap: kind 14/7 (and 15, a file from another app, shown as "Sent a file" without its link), sender not blocked, not expired, no duplicate rumor id,
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
  inbox wires it to the chat signer). `subscribe(relays, filters, {
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
  request,                   // { amountSats, note, lud16, validUntil } | null
  status,                    // { requestId, value, preimage } | null
  payment,                   // { amountSats, note, preimage (or null), requestId, verifyUrl (or null) } | null
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
- Outbox for messages written offline; flushed by `inbox.js` when online. It
  keeps the signed seals: a delivery more than `rewrapAfterMs` (5 min) after
  the wraps were made goes out in fresh wraps, because an old wrap's
  randomised timestamp can lie before what the recipient reads (their last
  sync minus two days) and relays would never serve it. The self copy goes to
  every relay we read, including a list the person has from another app.
- Receiving through a signer app: a wrap the signer fails on while it answers
  other work gets a strike; after `MAX_WRAP_STRIKES` (3) it counts as
  unreadable, so it never holds back later messages.
- A partner's inbox list is looked up on the discovery relays and contact
  hints, then, if they answered without one, on the partner's NIP-65 write
  relays.
- History is paged: a relay answers one batch (we ask for
  `HISTORY_PAGE_LIMIT`, 500; relays cap it at their own limit), so after a
  relay's batch the inbox asks for older pages with `until` = the oldest wrap
  seen (inclusive) until a page brings nothing new, at most
  `MAX_HISTORY_PAGES` (20). The cursor passes a relay only once its walk is
  done; a failed page leaves the cursor where it was.
- Sync cursor (`lastSyncAt`), blocked pubkeys, per-contact mute flags.
- Blocks follow the person (`services/dm/muteList.js`): the blocked keys are
  kept in step with their NIP-51 mute list (kind 10000) on the discovery
  relays, as Lotus and 0xchat keep theirs. The store logs block and unblock
  changes not yet saved (`blockChanges`); a sync on start and after each
  change reads the newest list, writes those changes into it (a block goes in
  the private NIP-44 part, an unblock leaves both parts) and keeps every
  other entry (words, hashtags, threads). A list read completely is the
  truth, with the unsaved changes on top. A list with a private part this
  device cannot read (NIP-04, a signer that refused) is never rewritten and
  only adds blocks; no relay answering decides nothing. Blocks made before
  this sync existed are published on the first sync. A signer app is only
  asked once the person turned messages on.
- Handled wraps (`handledWraps`, wrap id → created_at): never decrypted
  twice; pruned once older than the inbox window, at most 5,000.
- Signer apps: `signerAppMessages` (opt-in, persisted) and `signerHold` (why
  messages wait, not persisted).
- Persistence: encrypted with `utils/deviceCrypto.encryptString`, stored in
  IndexedDB (same pattern as `utils/kitStorage.js`), debounced writes, pruning
  of old messages.

## 8. Money

Requesting (a notice, no invoice):
- The request names the **profile Lightning address** (`stores/profile.js`,
  `lud16`; `boot/payment-address.js` fills it with the Spark address or an
  npub.cash bucket). There is no receiving-wallet choice: Spark, NWC, LNbits
  and Arkade users all request the same way, and the sheet shows a quiet
  "To: <address>" row that opens the sheet where the address is changed. Without
  an address the sheet explains it and offers to set one up.
- **Preflight** before sending (`requests.checkOwnAddress`): the address must
  answer LNURL-pay (`https://<domain>/.well-known/lnurlp/<name>`) and accept the
  amount (min/maxSendable). Errors: `NO_PAYMENT_ADDRESS`,
  `PAYMENT_ADDRESS_UNREACHABLE`, `AMOUNT_OUT_OF_RANGE`. Only then is the request
  sent; nothing is created or watched.
- **Detect paid:** the payer's `payment` message (requestId, optional preimage)
  and `paid` status are matched against the requester's own wallet ledger;
  when no wallet of theirs shows the money, the LUD-21 verify URL of the payment
  is asked on the domain of their own address (section 8a).

Paying a request / sending:
- When the payer taps Pay, the app creates the invoice: it fetches the
  requester's current kind 0 profile and takes its `lud16` (else the one signed
  in the request), pulls an invoice via LNURL-pay for exactly the amount and
  checks it silently (`bolt11.decode`, section 8a).
- Hand over to the existing pipeline (`payContactDestination` →
  `onPaymentDetected` → `PaymentConfirmSheet` → slide to send) with the chosen
  `sendingWalletId`.

| | Spark (Breez) | NWC | LNbits | Arkade |
|---|---|---|---|---|
| Messages | ✓ | ✓ | ✓ | ✓ |
| Request | ✓ via profile address | ✓ via profile address | ✓ via profile address | ✓ via profile address |
| Pay / send | ✓ | ✓ with `pay_invoice` | ✓ | disabled: Lightning unavailable |
| Detect paid | ledger match of the payer's claim, else LUD-21 on the address | same | same | same (ledger if the wallet lists incoming payments) |

## 8a. Paying a request (no dead ends)

A request is an intent ("Anna asks 3,000 sats for pizza") and only a notice:
the invoice does not exist until the payer taps Pay.

- **Request lifetime:** open until paid, declined or withdrawn, or until
  `valid_until` (created_at + `REQUEST_LIFETIME_SECONDS` = 30 days).
- **Payer creates the invoice:** "Pay" fetches the requester's CURRENT signed
  kind 0 (`nostrFetch.fetchProfile`, short timeout) and uses its `lud16` when it
  is a valid Lightning address, so an address the requester changed after
  sending is followed by new and old open requests alike. When the profile
  cannot be fetched or has no valid `lud16`, the `lud16` signed inside the
  request is used. It then pulls an invoice via LNURL-pay for exactly the
  requested amount (no LUD-12 comment: the requester's wallet would show it
  as the payment's message; the payment itself is matched, see below),
  validates it (decodes, mainnet, exact amount, not expired, within
  min/maxSendable) and hands it to the normal pipeline with "Pay with". The
  LUD-21 `verify` URL of the LNURL answer is kept when it is `https:` on the
  callback's host and rides along in the payment context, so the `payment`
  message carries it. A failed
  fetch is a clear error (`INVOICE_FETCH_FAILED`, `AMOUNT_OUT_OF_RANGE`) and
  nothing is paid. Never an address from contact data.
- **Requester confirms payment:** the payer's `payment` message (requestId,
  preimage if any) is matched against the requester's own wallet ledger
  (preimage hash, else amount + time window, one tx per claim) → the request
  becomes `paid` (verified), the tx is linked to the contact and the card says
  where it was received. The ledger match is always preferred.
- **LUD-21 for addresses outside the app** (Alby, Wallet of Satoshi, ...): when
  no ledger match exists and the payment message has a `verify` URL, the
  requester asks it, but only if it is `https:` and its host equals the domain
  of the request's signed `lud16` or of their current profile `lud16`
  (SSRF guard: no other host is ever fetched; 5 s timeout). It counts only when
  the answer is `settled: true`, the returned `pr` decodes as a mainnet invoice
  for at least the requested amount, a returned `preimage` hashes to the
  invoice's payment hash, and that payment hash has not settled another request.
  The settlement is then recorded as `{ address, paymentHash, paidAt }` (no
  wallet) and the card says "Received at <address>". Otherwise the card says
  "{name} says it's paid", muted and without the green check. Claim re-checks (ledger and LUD-21) run at 5 s,
  20 s, 60 s, on chat open and on every resume.
- **Next action in every state:**

  | State | Payer | Requester |
  |---|---|---|
  | pending | Decline · Pay | Remind · Cancel request |
  | paying (the user paid, still routing) | "Payment on its way", nothing to tap | |
  | expired (`valid_until` passed) | Send anyway (amount + note prefilled, linked to the request) | Request again (one tap, same amount + note) |

  "Send anyway" pays the address resolved the same way (current profile, else
  the signed `lud16`). A late payment linked to an expired request marks it paid
  (paid is final and wins over expired); a claim below the requested amount
  stays "not verified"; a payer's `paid` status without a payment message
  counts as a claim.
- Trade-off: the money lands in the wallet behind the requester's profile
  address; the paid card names the wallet, or the address when LUD-21 verified
  it. A payment to an address whose receipts the app can neither list nor verify
  by LUD-21 (a service without LUD-21, npub.cash bucket until claimed) stays
  "{name} says it's paid". "Send anyway" goes through the generic send
  flow, which does not carry the verify URL: such a late payment is verified by
  the ledger only.

## 9. Notifications

Reuse `services/paymentNotifications.js`, `stores/notifications.js`, the
"happened while hidden" logic (`visibilitySnapshot`) and the in-app toasts.
Additions: an Android channel `messages` next to `payments`, `extra.route` on
every notification plus a tap listener that opens it, one notification per chat
(grouped, fixed id per contact), and a per-feature toggle for messages. No
notification for self copies, blocked or muted contacts, or the chat currently
on screen.

In Settings, one Notifications row opens `NotificationsSheet`: "Allow
notifications" (the master switch, `enabled`) and, only while it is on,
"Payments received" (`paymentsEnabled`) and "Requests and messages"
(`messagesEnabled`, shown where the chat runs). Each kind only narrows the
master switch.

## 10. Security rules

- Never log decrypted content, keys or invoices (`utils/logRedaction.js`).
- Identity key bytes are zeroed on wipe and never stored by this feature. A
  signer app is asked only for the identity the runtime belongs to, and every
  event it signs must carry that identity's pubkey.
- Reject rumors whose id does not hash to their content (upstream #73).
- Unknown senders go to the "Not in your contacts" section and are named by
  their npub fragment only: a claimed name is never shown, so it cannot
  impersonate a contact (nostrdesign.org guidance). Blocked senders are dropped
  after unwrap.
- Per-sender rate limit after unwrap; size limits before unwrap.
- A pasted `nsec` in the composer blocks sending.

## 11. Upstream (`nostr-core`)

nostr-core 1.0.5 ships the fixes for #72 to #75, but the chat keeps its own
code for each. The upstream helpers take a raw secret key or one AUTH key for
every connection, while the chat signs through a signer that may be another
app and authenticates each connection role with its own key. Swapping one in
needs every point below covered.

| Upstream (1.0.5) | Why the chat keeps its own code |
|---|---|
| [#72](https://github.com/nostr-core-org/nostr-core/issues/72) `authSigner` retries `auth-required` after AUTH | One key for every connection (the chat uses the identity on reads, a throwaway key on writes); misses the `ERROR: auth-required:` that damus and nostr.net send; no cap on challenges (a signer app would ask for each one); a 10 s signer timeout against the chat's 30 s; failures lose their `DmError` code. Never set `authSigner` on the transport's relays while `onauth` is set: both would retry. `transport.js` |
| [#73](https://github.com/nostr-core-org/nostr-core/issues/73) `unwrap` rejects a forged rumor id | Needs the raw key and throws one generic error; the chat decrypts through the signer and needs a reason per failure. `openWrap.js` |
| [#74](https://github.com/nostr-core-org/nostr-core/issues/74) `createMessage` / `unwrapMessage` (multi-recipient, self copy, kinds 15 and 7) | Raw key only, and it sets its own `created_at` and `p` tags over the chat's templates. `giftWrap.js` + `openWrap.js` on the nip59 primitives |
| [#75](https://github.com/nostr-core-org/nostr-core/issues/75) `publishDetailed`, `parseRelayReason` | The parser is case-sensitive, ignores a bare `duplicate` and nested reasons, and throws on a missing reason (so `publishDetailed` can reject on `OK true` without one); no first-accept, error codes, retries or per-role sockets. `transport.js` + `errors.js` |

Since 1.0.6 a remote signer is asked at `connect` for everything BuhoGO signs
with it (`BUNKER_PERMISSIONS` in `identitySigners.js`, [#83](https://github.com/nostr-core-org/nostr-core/issues/83)),
again on every reconnect. The opt-in notice still asks to always allow: an
extension has no such request, and a signer may ignore it.

## 12. Testing

- Unit tests next to the code in `__tests__/*.spec.js` using `node:test`
  (`import { test } from 'node:test'`), registered in the `node --test` part of
  the `npm test` script.
- Transport tests use an in-memory fake WebSocket relay (AUTH challenge, CLOSED
  auth-required, OK false, drops and reconnects).
- A Playwright check script (`scripts/check-contact-chat.mjs`) drives the UI with
  simulated relays and LNURL servers, scripted wallets, dark and light, de / en / es and large
  text.
- Requires Node ≥ 22.22 (`@quasar/app-vite`).

## 13. Known limitations

- Addresses whose service does not support LUD-21 stay "{name} says it's paid"
  when their wallet is not in the app. So do payments to an npub.cash bucket
  address until the bucket is claimed into a wallet (the ledger only lists it
  then).
- "Send anyway" (generic send flow) does not carry the LUD-21 verify URL, so a
  late payment to an address outside the app is verified by the ledger only.
- Muted 12px text (`--text-muted`, about 3.1 to 3.8:1) is an app-wide token,
  below WCAG AA for small text.
- relay.damus.io and relay.nostr.net AUTH was broken server-side on
  2026-10-10; add them back to `DM_INBOX_RELAYS` once fixed.
- A mute list whose private part is NIP-04 (older apps) is read for its
  public keys only and never rewritten; NIP-04 decryption is not wired into
  the chat signer.
- A thread the user started with a stranger stays under "Not in your
  contacts" (other clients count a chat you wrote to as known).
- Signer apps (section 5a): the permissions asked at `connect` (section 11)
  and an `auth_url` approval still need a check on a device with nsec.app and
  Amber.
