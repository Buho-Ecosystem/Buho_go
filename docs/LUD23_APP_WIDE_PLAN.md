# LUD-23: app-wide implementation and UX plan

Status: implemented on `feat/lud23-address-sharing`, based on inspection of `dev` at `f3a824b` on 2026-09-20. The following contract and impact map guided implementation; the verification record below distinguishes automated checks from remaining device validation.

Issue: [#268](https://github.com/Buho-Ecosystem/Buho_go/issues/268). Implement in its own branch and PR against `dev`. Issue #265 remains a separate branch and PR.

## Design contract

LUD-23 defines protocol behavior. Apple HIG guides contextual presentation, dismissal, accessibility, and permission clarity. Nostr Design guides simplicity, user control, understandable language, and feedback. The UI below is our application of those sources, not a prescribed screen from either design guide.

- [LUD-23 specification](https://github.com/lnurl/luds/blob/luds/23.md)
- [Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- [Apple HIG: Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy)
- [Nostr Design: Guiding Principles](https://nostrdesign.org/docs/guiding-principles/)
- [Nostr Design: Error Handling](https://nostrdesign.org/docs/how-to/error-handling/)

The normal flow is **open or scan → review one consent sheet → Share address → Address shared → Done**. The sheet shows the actual callback domain, the service's description, and the exact Lightning address to be submitted. Use a prominent “Share address” action and a clear Cancel action. Dismissal before submission declines. The only decision in the normal flow is consent; address selection follows the identity's established payment-address policy.

Present a bottom sheet on phones and an appropriately sized centered surface on larger screens, consistent with BuhoGO. Close the initiating scanner/sheet before presenting consent. Preserve its parent context and relevant draft. Support long domains and addresses, large text, safe areas, keyboard and screen-reader operation, reduced motion, and light/dark themes. Do not use a logo as proof of a service's identity. Render the service description as untrusted plain text, visually distinct from app instructions.

## Entry-point coverage

| Entry point | Current code / finding | Required behavior |
| --- | --- | --- |
| Home → Send → Scan | `SendModal.vue` uses `QrScanSheet.vue`, with native `ScannerOverlay.vue` or web camera decoding. Send has its own classifier and payment-capability gate. | Detect address requests before payment normalization and capability checks; stop camera, close Send, open shared consent. |
| Send → Paste, typed input, clipboard chip | `SendModal.vue` has separate detection, processing, and automatic advancement paths. | Recognize every supported LUD-23 carrier consistently. Use “Address request” language. Advancing may resolve the request and open consent, but never shares. |
| Home clipboard offer | `clipboardSuggestion.js` labels LNURLs as payment requests; `ClipboardSuggestion.vue` always says “Send”; Wallet opens Send to consume the offer. | Recognize locally identifiable address requests without a network read. Show “Copied address request” with “Review”. Open shared consent directly. Preserve offer-once, lock, visibility, and storage-failure behavior. iOS keeps explicit Paste. |
| Encoded LNURL on clipboard | A bech32 carrier alone does not mean payment. LUD-23's tag can be inspected after local decoding. | Decode and classify locally. For a genuinely unresolved LNURL, use neutral “Copied link” / “Open” copy rather than promising a payment. No background request to discover clipboard intent. |
| Other app / browser / system-camera handoff | `boot/deep-links.js` parses through `WalletFactory`, requires `activeWallet`, buffers on `pendingDeepLink`, then routes to Wallet. | Accept the spec's `lightning:addressRequest?...` and wrapped encoded LNURL forms. Buffer an address-sharing intent independently of payment wallets and providers. Process warm and cold launches once, after unlock and identity readiness. |
| Android NFC while app is open | `boot/nfc.js` handles native reader events, including HTTPS LNURL candidates; currently requires an active wallet. | Route valid address requests to shared consent, including requests discovered through metadata. Never submit merely because a tag was tapped. |
| Android NFC cold/background launch | `NfcDispatchActivity.java` and `AndroidManifest.xml` intentionally limit supported URI schemes. | Verify LUD-23 carried by the already supported `lightning:` / `lnurl:` schemes. Preserve scoped dispatch; do not claim arbitrary HTTPS tags. Plain HTTPS foreground reading and cold-start dispatch have different coverage. |
| Receive → Redeem scanner | `Wallet.vue` classifies the result using `parsePaymentDestination` and sends it to the general dispatcher. | If a person scans an address request here, close the scanner and show the same sharing sheet. Clear any staged withdrawal amount; no invoice or withdrawal should start. |
| Identity → Sign in → Scan/Paste | `identity/IdentitySignInSheet.vue` and `AddSiteSheet.vue` currently accept LUD-04 only. | Recognize LUD-23 and hand off to the sharing sheet. Return to Identity on dismissal. Do not record a connected site or imply the person signed in. |
| Address Book → Add → Scan or manual LNURL | `AddContactScan.vue`, `AddressBookModal.vue`, and the address-book store currently accept generic LNURLs as reusable contact destinations. | Recognize a sharing request and hand off to consent while preserving the contact draft. Never save its one-time URL as a contact. Revalidate at the store/import boundary so non-UI callers cannot introduce it as a payment address. |
| Existing contact / Nostr profile → Pay | Contacts and Nostr `lud06` values can provide LNURLs through route-query or Send handoffs. | Treat this as a payment-only context: reject an address request with an understandable explanation. A contact's payment metadata must not change “pay this person” into “share my address”. |
| Map, Spend, shops and public profile payment buttons | These pass payment destinations into Wallet or its pending-intent channel. | Preserve payment-only intent and apply the same non-payable-request rejection if unexpected metadata is encountered. Normal payment buttons do not need new UI. |
| Batch send and automatic transfers | Batch has its own LNURL resolver; automatic payments and providers also resolve payment endpoints. | Reject `addressRequest` before an invoice or submission callback. Never open consent from an automatic/background payment job. Test backend/tag guards, including paths that currently only check for a callback. |
| Wallet setup / restoration scanners | NWC and LNbits setup scanners, plus the legacy `IndexPage.vue` scanner, expect connection/setup material. | Keep the scoped task. A LUD-23 request is not a wallet connection: explain the mismatch and keep the setup flow available. No implicit sharing or wallet creation. Check route reachability before editing legacy code. |
| Kiosk / cashier mode | `boot/kiosk.js`, deep links, and NFC guard owner operations. | Block address sharing while owner access is locked, including direct global-handler calls. Do not queue requests for surprise presentation when the owner later unlocks. Normal support resumes in owner mode. |

General scan/paste actions may discover a different supported request type and explain it with the consent sheet. Payment destinations supplied by a contact, merchant, batch, or background job must remain constrained to the task the user initiated.

## Shared implementation boundaries

1. **Pure parsing and validation** — proposed `utils/lud23.js`: recognize supported carriers, decode once, validate the request and fetched details, derive the callback domain, and construct the submission URL. No UI, clipboard access, identity mutation, or submission during parsing.
2. **Request resolution and submission** — proposed `services/addressRequest.js`: use the shared LNURL HTTP transport; fetch details only where required; return typed results/errors. Approval is a separate, explicit operation.
3. **Intent coordination** — proposed transient store/composable: carry source context, request identity, lifecycle state, and the identity/address reviewed by the user. Recognize sharing before entering payment-specific work. Use explicit allowed purposes for generic intake versus payment/setup intake; do not turn `canWalletPay` into a sharing permission check.
4. **One consent component** — proposed `AddressRequestSheet.vue`, hosted at app level alongside existing global experiences. It must work from Identity or another route without mounting Wallet or connecting a provider. Coordinate with app lock, update dialogs, and existing sheets.
5. **Thin entry-point adapters** — Send, Redeem, Identity scanner, contact intake, deep links, NFC, and clipboard hand the request to that coordinator. Preserve ordinary payment/auth branches and task-specific guards.

The shared low-level scanners should continue emitting decoded text. Request meaning belongs to their callers and the shared classifier, not the camera implementation.

## Protocol acceptance requirements

- Support the bech32 LNURL carrier, supported wrappers, decoded tagged request URLs used by in-app intake, and the explicit `lightning:addressRequest?...` form. Preserve case-sensitive query values and callback tokens; do not lowercase the entire input because its description contains `@`.
- Require the initial `addressRequest` intent and a 32-byte hexadecimal `k1`. When callback is inline, description is required. When callback is absent, retrieve metadata and require matching `tag` and `k1` plus valid callback and description. A JSON response without the required initial request context is not sufficient for strict-spec acceptance.
- Validate fields and reject ambiguous duplicate security-critical parameters. Preserve legitimate callback query parameters while setting the approved `k1` and `address` exactly once.
- Show the callback's domain even when it differs from the original request domain; the spec does not require same-origin callbacks. Do not silently follow a submission redirect to an undisclosed recipient. Assess redirect control in native HTTP and browser fetch before finalizing transport changes.
- Honor HTTPS and the spec's HTTP onion exception in validation. Check actual Tor routing and platform cleartext restrictions; accepting an onion URL alone does not establish working Tor transport. Record any unsupported transport explicitly rather than claiming full platform coverage.
- Approval sends a GET to the callback with the address. Only an explicit valid `status: "OK"` response confirms success. Handle `ERROR`, malformed responses, transport failure, and timeouts distinctly.
- No signing, authentication, payment execution, “always allow”, automatic approval, or connected-site record. The spec makes sharing contingent on consent.

## Identity, lifecycle, and privacy

Use the active identity's valid established `profile.lud16`, with the existing managed default rules: custom address wins; preferred Spark address (currently Business, then Personal); Social Bucket fallback. Reuse/extract existing resolution logic from `boot/payment-address.js` and the profile/wallet stores. Do not change the preference to the currently selected spending wallet.

Hydrate identity/profile before displaying the address. A valid custom address can be shared without connecting its wallet. If the configured address is malformed, explain the problem and offer existing setup/editing rather than silently choosing a different destination. If identity setup is necessary, return to review and require approval afterward. Resolving a sharing request must not itself publish or rewrite a Nostr profile.

Bind consent to the displayed identity, address, callback, and challenge. Identity switching or address changes invalidate unsubmitted consent; stale async results must not revive it. Prevent double taps and repeated scan/NFC events from generating duplicate submissions. Do not replace a sheet's contents with a second request while the person is reviewing it; keep one active request and ask the person to reopen the second afterward.

Suggested states: resolving → review → submitting → confirmed / rejected / outcome unknown, with decline possible before submission. A metadata fetch can be cancelled or safely retried; sending the address cannot be undone by dismissing UI. On timeout or CORS failure after submission, explain that receipt could not be confirmed. No automatic replay of the same challenge and no claim that nothing was shared. Ask the person to check the service or obtain a fresh request. Refetching an unchanged URL does not guarantee a fresh challenge.

Suspend presentation and approval while locked or backgrounded. Retain only the minimum transient state needed across native handoff/route changes. Do not persist request URLs or addresses as clipboard history, payment history, analytics, or recovery data. Audit existing Wallet payload logging and transport errors so callbacks/challenges are redacted. Sharing creates no transaction; any later incoming payment follows normal transaction handling.

## Files expected to change or receive regression coverage

| Area | Existing files |
| --- | --- |
| Classification and normalization | `src/utils/addressUtils.js`, `src/providers/WalletFactory.js`, `src/utils/lightning.js`, `src/utils/clipboardSuggestion.js` |
| General entry points | `src/components/SendModal.vue`, `src/components/ClipboardSuggestion.vue`, `src/pages/Wallet.vue`, `src/boot/deep-links.js`, `src/boot/nfc.js` |
| Identity / contact intake | `src/components/AddSiteSheet.vue`, `src/components/identity/IdentitySignInSheet.vue`, `src/components/AddressBook/AddContactScan.vue`, `src/components/AddressBook/AddressBookModal.vue`, `src/stores/addressBook.js` |
| Address defaults | `src/stores/profile.js`, `src/stores/wallet.js`, `src/boot/payment-address.js`, `src/services/npubCash.js` |
| Global presentation / lifecycle | `src/App.vue`, `src/components/UpdateExperience.vue`, `src/boot/kiosk.js`, current `pendingDeepLink` consumers |
| Payment-only boundaries | `src/components/BatchSendModal.vue`, `src/services/nostrPaymentTarget.js`, `src/stores/autoWithdraw.js`, payment metadata consumers in providers |
| HTTP and errors | `src/utils/lnurlHttp.js`, `src/utils/userErrors.js`, `src/utils/logRedaction.js` |
| Native delivery verification | Android `AndroidManifest.xml`, `NfcDispatchActivity.java`, `MainActivity.java`; iOS `Info.plist`; existing `src/utils/nfc.js` and scanner wrappers |
| Localization | All enabled locale dictionaries in `src/i18n/` |

This is an impact inventory, not a requirement to edit every listed file. Some need only regression checks. Existing Android/iOS `lightning:` scheme registrations already cover the spec's scheme; verify delivery before adding manifest changes. No new generic HTTPS app-link claim or platform-wide share target is required.

## Verification before the PR is ready

- Parser/service tests: inline and fetched details; each carrier; uppercase LNURL; mixed-case callback tokens; descriptions containing `@`; missing/duplicate fields; mismatched tag/challenge; callback parameters; insecure URL and onion policy; differing callback domain; redirects; OK/ERROR/invalid JSON; no request on decline and no submission before approval.
- Integration tests: each applicable row in the entry-point table, including Android cold/warm NFC delivery paths and native deep links; no-wallet and Arkade-active cases; preserving payment-only boundaries; contacts cannot save one-time requests; existing auth, withdraw, pay, BIP21, Nostr profile and clipboard behavior.
- Lifecycle tests: delayed hydration, lock/unlock, app backgrounding, route changes, unmount, identity/address changes, duplicate events, overlapping requests, setup-and-return, double tap, late network completion, and uncertain submission.
- UI review: small phone and tablet/desktop, dark/light themes, all enabled languages, long service descriptions/domains/addresses, 200% text, keyboard/screen reader, focus return, reachable actions, reduced motion, and one sheet at a time.
- Transport/platform checks: native HTTP and browser CORS behavior; actual Android and iOS device delivery; explicit record of Tor support. Web/PWA scan and paste work with reachable, CORS-compatible services. OS camera opening a PWA is not guaranteed by the existing native scheme registrations.
- Run the existing test suite and production build. Report automated coverage separately from physical-device verification. No live address submission is needed for protocol tests; use controlled fixtures/endpoints.

## Relationship to #265

LUD-08 fast withdrawal remains independent: extract/validate inline withdrawal metadata before the existing first GET and feed the same Redeem flow. Both PRs touch input dispatch, so keep their parsers separate, merge in sequence, and rerun pay/withdraw/auth/address-request routing checks on the combined `dev`. #265 must not become a dependency for LUD-23 support.

## Implementation and verification record

The shared parser, HTTP service, transient consent session, Pinia coordinator, and app-level sheet implement the boundaries above. The existing profile default is extracted into a pure helper shared with the wallet store. Sharing reads hydrated public identity/profile metadata and does not connect a wallet, mutate a profile, or create a payment/sign-in record.

Send, clipboard, Redeem, Identity intake, contact intake, deep links, and NFC use the same consent session. Contact handoff preserves the draft. Wallet setup scanners explain the mismatch and remain in setup. Contact storage/import, Nostr payment targets, merchant handoffs, batch send, automatic transfers, public-profile payments, donations, and individual invoice resolvers retain payment-only behavior. Invoice resolvers validate the returned `payRequest` tag before using its callback, including a second fetch after amount selection.

Approval binds the exact displayed address to the validated callback and challenge. App lock, foreground state, kiosk access, identity changes, competing dialogs, setup, and late asynchronous completion gate presentation and approval. A callback challenge is marked consumed synchronously before submission and remains consumed in memory across reopening, callback-path changes, or hexadecimal casing changes. Metadata connection failures can be retried; submitted outcomes cannot. Restarting the app clears transient state, so the service must also enforce its single-use challenge.

| Evidence | Coverage |
| --- | --- |
| `npm test` | Existing regression suite plus 42 protocol, session, transport, native-entry, and address-default tests. Fixtures verify no submission before approval, no duplicate/replayed callback, safe late results, cancellation, redirect policy, validation, and wallet-independent intake. |
| `node scripts/check-lud23.mjs` with local dev server | Rendered consent with no connected wallet, cancel/approve, exact callback parameters, address change, lock/unlock, rejected/unknown results, setup/return, production entry adapters, real contact-form draft preservation, and payment resolvers rejecting unexpected sharing metadata before its callback. External traffic is blocked and responses are controlled fixtures. |
| Browser layout checks | Light/dark phone and tablet layouts, translated English/German/Spanish headings, long service descriptions, narrow 320px viewport with 200% text, no horizontal clipping, and reachable actions with at least 44px targets. |
| `npm run build` | Production SPA compilation. |

Reproduce browser checks with `pnpm dev --port 9002` followed by `node scripts/check-lud23.mjs`. Optional `LUD23_BASE_URL` and `LUD23_OUTPUT` select the server and screenshot directory; screenshots default to `/private/tmp/lud23-review`. Tests use synthetic public identity metadata and never send a real address to a live service.

Native cold/warm deep-link and NFC bridge behavior is exercised with controlled bridges, not physical Android/iOS devices. Camera hardware, OS delivery, native accessibility, and screen-reader behavior still need device validation. Existing scheme registrations are unchanged. HTTPS is supported; HTTP onion URLs pass the spec's transport validation, but the app adds no Tor transport and real onion connectivity is unverified. Web services must allow CORS. Timeouts, redirects, and unreadable submission responses deliberately report an uncertain outcome instead of claiming success or retrying.
