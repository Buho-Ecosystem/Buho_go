# Notifications: research and implementation plan

Status: implementation in progress, one draft PR for [#467](https://github.com/Buho-Ecosystem/Buho_go/issues/467). This document specifies the complete first release. It does not describe an already available feature.

## Product decision

People get one familiar **Notifications** area. They turn notifications on, choose what they want, and connect a register by scanning a code. BuhoGO manages delivery addresses, keys, relay selection, topics, trust and retries.

The first release covers **register sales to the owner** and **payment requests**. It includes receiving inside the Android app. A companion notification app is an interoperability option for developers, never a prerequisite in the normal flow. This supersedes the earlier idea of shipping manual public-key/topic/relay configuration first.

Keep in-app notices, notifications on this device, and publication to another device separate internally. Present their settings by purpose, not transport. A disabled notification permission on a register must not prevent delivery to its owner's phone.

## Evidence and its limits

Research checked on 2026-11-06. These findings come from source and official documentation, not a live delivery or battery benchmark.

### Protocol implementations actually verified

| Implementation | Evidence | Consequence for BuhoGO |
|---|---|---|
| [Original proposal](https://github.com/vcavallo/nstrfy.sh/blob/57c581904e79b71fc4d572a4d4b643bcf9fa6362/NIP-DRAFT.md) | Kind 7741; NIP-44 payload; recipient `p`, unique `d`, recommended expiration; notification topics and actions | Adopt its wire format, without exposing protocol controls in product UI |
| [CLI publisher](https://github.com/vcavallo/nstrfy.sh/blob/57c581904e79b71fc4d572a4d4b643bcf9fa6362/nstrfy.sh) | Publishes encrypted/addressed and public events; defaults to a one-hour lifetime | Interoperability fixture for sending, not an application dependency |
| [Web receiver](https://github.com/vcavallo/nstrfy.sh/blob/57c581904e79b71fc4d572a4d4b643bcf9fa6362/nostr-notify-web/app.js) | Subscribes through page JavaScript; decrypts with NIP-07; shows browser notifications | A working reference receiver, not proof of closed-browser delivery |
| [Hosted send endpoint](https://github.com/vcavallo/nstrfy.sh/blob/57c581904e79b71fc4d572a4d4b643bcf9fa6362/nostr-notify-web/api/send.js) | Receives plaintext JSON and encrypts/signs on the server with a demo key | BuhoGO publishes directly; the demo endpoint is not our private delivery service |
| [Android subscriber](https://github.com/vcavallo/nstrfy-android/blob/8ddc77034ca719040dcce759d37bcdc5905de9f7/app/src/main/java/io/heckel/ntfy/service/NostrConnection.kt) | Persistent sockets; inbox/public filters; sender checks; subscriptions begin at the current time | Native reception is viable; implement persistent catch-up rather than copying the fresh-only subscription |
| [Android parser](https://github.com/vcavallo/nstrfy-android/blob/8ddc77034ca719040dcce759d37bcdc5905de9f7/app/src/main/java/io/heckel/ntfy/msg/NostrNotificationParser.kt) and [notification UI](https://github.com/vcavallo/nstrfy-android/blob/8ddc77034ca719040dcce759d37bcdc5905de9f7/app/src/main/java/io/heckel/ntfy/msg/NotificationService.kt) | Parses priorities, topics, links and view/HTTP actions; opens URLs with Android intents | Payment links are feasible; BuhoGO first supports safe navigation, not HTTP commands |

GitHub repository/code searches and web searches for `nstrfy`, `KIND_NSTRFY`, and kind 7741 did not independently verify a separate application's implementation beyond this project family. That search limitation does not imply no other implementations exist. Amethyst's Quartz library is used by the Android receiver; this alone does not establish that Amethyst implements this notification kind. Add other applications to the compatibility matrix only after inspecting their send/receive path.

### Established interaction patterns

| Primary source | Finding | Product decision |
|---|---|---|
| [Android permission guidance](https://developer.android.com/develop/ui/compose/notifications/notification-permission#request_the_permission_in_context) | Ask following an understandable user action and check current permission | Explain the benefit at enable time; respect refusal; provide Open phone settings when blocked |
| [Android notification design](https://developer.android.com/design/ui/mobile/guides/home-screen/notifications) | Concise relevant notices, meaningful actions, grouping, privacy, removal of stale notices | One alert per event, private lock-screen preview by default, purpose-based categories; tapping opens the relevant item |
| [Android channels](https://developer.android.com/develop/ui/compose/notifications/channels) | People retain control over category importance | Keep channel identities stable; sender priority cannot override user choices |
| [Signal linked devices](https://support.signal.org/hc/en-us/articles/360007320551-Linked-Devices) | Named devices can be reviewed and unlinked in Settings | Show a simple connected-register list with a disconnect action; do not expose credentials |
| [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | Status changes must be available to assistive technology without moving focus | Announce pairing/testing/error states through a live status region; preserve focus and user input |
| [Android background-start restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start) and [user stopping](https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping) | Background services have platform restrictions and people can stop them | Start receiving from a visible enable action; recover permitted restarts; never promise delivery after force-stop |

QR pairing below is our design decision, not a mechanism supplied by this proposal or proven by the linked Signal article.

## Complete first-release experience

### Notifications on this phone

Keep the existing Settings entry and shared sheet/row styles. Use the same typography, spacing, icons, interaction feedback and light/dark tokens as neighbouring settings. The first screen shows:

- **Allow notifications**: the person's choice for this phone.
- **Payments received**: existing local payment notices.
- **Requests and messages**: preserve existing local chat controls; new external publication initially covers requests only.
- **Register sales**: shown when a register is connected.
- **Connected registers**: friendly names, last successful test, Disconnect.
- **Send a test notification**: a real round trip to the phone, not just a local toast.

The same high-level preferences control both local and external reception for a category. Delivery mechanisms remain separate beneath them. Existing saved preferences migrate without silently turning on background reception. In-app cards remain available when phone notifications are off.

Enable sequence: person taps Turn on; explain the benefit in one sentence; request OS permission; prepare the receiver; register its address; perform the encrypted round trip. Show On only when receiving is ready. External identity signers may require approval for publishing the address; refusal leaves a recoverable setup state.

Use familiar states and one relevant action:

| Condition | Copy direction | Action |
|---|---|---|
| Ready | On | Turn off |
| Person disabled | Off | Turn on |
| OS blocked | Notifications are off in your phone settings. | Open phone settings |
| Temporary network failure | Waiting for a connection | Retry when the network returns |
| Setup did not finish | Finish setting up notifications | Continue |
| Receiver explicitly stopped by Android/user | Open BuhoGO to receive notifications again. | Resume from a visible action |

Recovery copy appears only where there is evidence for that condition. Do not infer a stopped receiver from a quiet inbox. Brief reconnects do not generate alerts about the notification service itself. A platform-required foreground-service notice uses ordinary language and a Pause action; hiding complexity does not mean hiding an OS-required running-service indicator.

Keep security expectations visible in plain language: private previews by default, a single Show details choice, and the existing app lock before opening private content. No urgent/DND bypass for these two use cases. Tapping a notice opens the record; include a second action only when it does something different.

### Connect a register

1. In owner mode on the register, choose **Sales alerts → Connect your phone**.
2. Show a short-lived QR code and the instruction **Scan with BuhoGO on your phone**.
3. The owner's existing scanner opens **Connect this register?** with a friendly register name. Enable receiving here if needed.
4. Confirm the matching short code on the two devices. Bind both device keys, receiver address and pairing challenge to that confirmation.
5. Send a test through the actual relay/receiver path. Report **Connected** only after the owner's phone acknowledges the challenge.
6. Both devices show the connected name and a simple on/off control. The phone can revoke the register at any time, including when the register is offline.

A pairing offer expires after five minutes, is consumed once and requires owner access to create/confirm. QR contents contain a temporary pairing public key, random secret challenge, relay hints and expiry. The response is encrypted to that key. Use a separate pairing message schema; it is not a sale notification and does not trigger a system alert. Persist the confirmed relationship before claiming success. A local-only sale ID or route must never be presented as an owner-phone record unless that record is actually available there.

### Payment requests

Existing single and shared requests continue to use their current durable NIP-17 delivery. Once the recipient's request is accepted by a relay, its feature adapter may enqueue one encrypted notification to an opted-in recipient. No extra sender setup or new step in the request flow.

The recipient app publishes its notification capability automatically when setup completes. Senders verify the identity binding and discover/copy it in the background. A recipient without an enabled compatible address still gets the ordinary request; do not turn a request into an error or claim external delivery succeeded.

Tap opens the exact sender/request reference after unlock and loads authoritative request state. An expired, replaced, already paid or unavailable request gets the existing appropriate state, never a fresh payment prompt. Group requests notify per share, with existing request IDs retained across retries. Register/owner pairing, request references and recipient discovery are BuhoGO integration mechanisms around the draft, not additional requirements imposed on other kind-7741 clients.

## Architecture and ownership

```text
Confirmed kiosk sale ── kiosk adapter ─┐
                                    ├─ notification policy → encrypted outbox → Nostr
Published payment request ─ adapter ─┘                                  │
                                                                        ▼
Existing cards/toasts ← foreground delivery ← receive validation ← Android receiver
Existing OS delivery ← canonical notice ID ─┘
```

| Owner | Responsibility |
|---|---|
| Existing toast/card services | In-app presentation; never acquire push credentials |
| Existing local notification service/store | Device permission, existing channel migration and tap handling |
| `services/nostrPush/protocol.js` | Kind 7741, payload limits, signature/hash checks, NIP-44 envelope and expiry |
| `services/nostrPush/outbox.js` | Durable signed ciphertext jobs, local idempotency, bounded retention and retries |
| `services/nostrPush/publisher.js` | Shared relay fan-out, deadlines and acceptance results |
| `services/nostrPush/registration.js` | Verified capability records, expiry, revocation and cached discovery |
| `services/nostrPush/pairing.js` | One-use QR challenge and confirmed register relationships |
| `services/nostrPush/runtime.js` | Explicit dependency injection, lifecycle and cancellation |
| Feature adapters | Verified trigger, destination, translated copy, reference and lifetime |
| `stores/nostrPush.js` | Setup state, named devices and publication status; no payment decisions |
| Native notification package | Receiver transport, dedicated key storage, catch-up, channel posting and bridge |
| `boot/nostr-push.js` | Only app/store/native wiring; one lifecycle owner |

Protocol and delivery modules import no Vue, Pinia, wallet provider or chat runtime. Feature operations call injected callbacks; views never build Nostr events. Add feature adapters only for implemented event types. Reuse `nostr-core` for JavaScript crypto and existing relay infrastructure. Do not introduce a second JavaScript Nostr stack.

The Android receiver must operate without a WebView or an unlocked wallet. Evaluate the pinned Quartz native dependency used by nstrfy as the first implementation candidate, behind one native crypto adapter. Measure SDK compatibility, APK footprint, R8 and interoperability before adopting it. Native reception requires a native crypto dependency because page JavaScript is not an Android background service; this is the justified exception to reusing our JavaScript library. No handwritten cryptography and no Kotlin UI rewrite. If the native dependency/lifecycle spike fails, resolve it within this draft before exposing setup.

### Address registration and privacy

Use one receiver per active identity/installation initially. A device creates a dedicated notification key, protected by Android Keystore storage and scoped to that identity. Wallet/recovery keys never enter the receiver. A register uses a dedicated restricted-purpose notification sender key so owner lock does not unlock the social identity.

Automatic request discovery uses an identity-signed addressable application-data event (kind 30078, `d=buhogo:notification-address:v1`). This is a BuhoGO extension, not part of the draft. Its versioned content contains the receiver public key, validated relay URLs, supported topics and expiry, with no secret or friendly device name. Publish through the existing discovery relay set; refresh on use and before expiration; validate event ID/signature, author, kind, `d` and expiry before caching. Treat conflicting equal-timestamp records deterministically. An empty newer record withdraws the address.

The public binding reveals notification opt-in and links the receiver key to the social identity. Kind-7741 delivery also exposes sender/recipient metadata. Record this in the privacy documentation; do not describe the service as anonymous. Supporting several phones later needs a versioned bounded device list and independent revocation, not an unannounced change to the singleton semantics. On identity switch, stop the old receiver before enabling another identity; a failed withdrawal never overrides local revocation.

Local disabled/muted/blocked state always wins. Native receiving maintains only trusted contact keys and explicitly paired registers, plus bounded pre-decryption rate/size limits. Unknown senders cannot generate a generic notification as a workaround. Separate receiver and identity keys mean enabling notifications does not grant access to chat decryption or spending.

### Reliability contract

- A semantic source ID plus destination produces one local job. Generate a random wire `d` value; keep source IDs out of public event tags.
- Save the signed encrypted event before publication; retry the identical event and ID without reacquiring the signer. Retain bounded deduplication history after acceptance/expiry.
- Disable/disconnect/identity removal cancel pending jobs in that scope. A generation check prevents late async results from restoring cancelled work.
- At least one explicit relay acceptance means Published internally, not delivered to a person. Only a dedicated test/pairing challenge has an acknowledgement; do not invent general read receipts.
- Use the draft's one-hour default lifetime; requests are capped at their own expiry. Retry with bounded backoff and stop at expiry. Reconnection never floods the person with stale requests or historical sales.
- Receiver catch-up uses persisted per-relay high-water marks with an overlap window and a bounded ID ledger. Advance the cursor only after safe processing; reject expired/invalid/untrusted events before decryption and presentation.
- Foreground local handling and native background delivery share canonical source references so the same event produces at most one user interruption. Read/mute state and disabled categories propagate to native storage.
- Native notices use signed sender identity and local trusted labels, not sender-provided display names. Private navigation waits for unlock and rechecks identity/record state. Incoming payloads cannot authorize payment, launch arbitrary HTTP requests, or load remote icons.

## Implementation sequence within the single PR

1. **Research and contract**: this decision record, named sources, frozen wire fixtures, protocol validation and real NIP-44/signature tests.
2. **Native viability**: background receiver/Keystore prototype, dependency/build-size results, release-build checks and screen-off delivery on a device without Google services. Keep it behind an internal gate.
3. **Reliable core**: outbox, registration, native bridge, cursor/deduplication, revocation and lifecycle tests.
4. **Complete setup**: existing Notifications sheet, state machine, contextual permission, actual test round trip, accessible pairing and plain recovery copy in English/German/Spanish.
5. **Kiosk integration**: extract one shared verified completion operation for active/parked/card sales; wire the owner adapter there, independently of page success animation.
6. **Request integration**: one callback after durable per-recipient request publication; automatic capability discovery; exact-reference deep links and reconciliation.
7. **Release evidence**: full regression suite, browser/native captures, acceptance matrix and owner/new-developer walkthrough. Remove the gate only when the complete supported flow passes.

Later adapters may cover ordinary chat, other receipt sources and suitable wallet alerts. A notification format does not itself observe every external wallet payment or run wallet settlement in the background. Native iOS/APNs and closed-browser Web Push need their own transport integration; this PR preserves current local behavior there and never labels that behavior as closed-app receiving. Web registers can publish to the Android owner phone once paired.

## Acceptance and review gates

- [ ] No keys, relay URLs, event kinds, topic names or transport selector in normal setup.
- [ ] Reuse existing settings/card/toast styles; capture light/dark, narrow screen, larger text and reduced motion.
- [ ] Existing saved choices migrate; declining OS permission keeps in-app requests/sales usable.
- [ ] Android enable/disable, OS revoke/regrant, background restriction and user stop have accurate recoverable states.
- [ ] Wrong/replayed/expired pairing offers cannot connect; disconnect blocks the old register while it is offline.
- [ ] Active, parked and card sales produce one remote job per verified sale, including after restart; old history does not become a new sale.
- [ ] Requests handle partial groups, failed publication, signer refusal, restart, expiry/replacement/payment and missing recipient capability.
- [ ] Retry, expiry, storage failure, connection loss, delayed responses and scope removal do not affect payment/request success or leak another identity's notice.
- [ ] Verify a foreign CLI event in BuhoGO and a BuhoGO event in nstrfy-android, with synthetic keys and no funds. Test unsupported extras safely.
- [ ] At least one ordinary Android and one Android without Google services: screen off, UI removed, service process death, reboot, offline recovery and explicit force-stop. Record versions, delivery latency and battery observations.
- [ ] Test Android release/R8 build, notification tap after cold start, app lock and malicious URLs/payloads.
- [ ] Run `npm test`, affected browser checks and native checks; document actual results separately from pending device work.
- [ ] A new developer can find a source trigger, adapter, queued job and receive decision using this document alone.

No setup entry or new promise ships while its supported end-to-end flow is incomplete. The PR remains draft until the release gates have evidence; green protocol tests alone do not establish background delivery.

## Current implementation status

The initial commit adds this plan and the isolated encrypted-event contract/tests. No boot registration, preference migration, receiver, setup UI or feature adapter is enabled yet. Those are the remaining implementation steps above, not completed features. The initial PR must not claim #467 is finished.

Initial validation: `npm test` completed successfully, and the final focused protocol run passes 19 cases. Those exercise real signatures and NIP-44, independently constructed event envelopes, tampering, wrong recipients, default-deny trust, exact expiration, payload/action limits, a broken encryption signer, signer mutation and identity switching. Device delivery, actual nstrfy interoperability, native dependency viability and new UI captures remain pending.
