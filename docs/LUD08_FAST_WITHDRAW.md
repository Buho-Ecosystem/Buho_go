# LUD-08 fast withdrawal: implementation and impact

Issue [#265](https://github.com/Buho-Ecosystem/Buho_go/issues/265), implemented independently of LUD-23 on `feat/lud08-fast-withdraw` against `dev` (`f3a824b`).

## Protocol behavior

The [LUD-08 specification](https://github.com/lnurl/luds/blob/luds/08.md) lets a service embed withdrawal metadata in a decoded LNURL. `fetchLNURLInfo` now checks that metadata before making its initial GET. Complete valid parameters go through the same `withdrawInfo` adapter as fetched LUD-03 metadata. Incomplete or malformed inline data triggers the existing GET exactly once and uses the server's response.

The pure parser requires one occurrence of each required field, the exact withdrawal tag, a nonempty opaque challenge, a secure absolute callback, and safe integer millisatoshi bounds in ascending order. Empty descriptions are valid. Callback parameters, description text, and case-sensitive tokens survive decoding. A supplied Bolt Card PIN threshold must be a valid positive integer; otherwise the shortcut is abandoned. HTTPS and the HTTP onion exception are accepted; this change adds no Tor transport.

LUD-03 challenges are arbitrary strings, not the 32-byte hexadecimal challenge required by LNURL-auth or LUD-23. Zero balances remain zero. Whole-satoshi invoice bounds round inward; a range containing only one redeemable integer amount becomes fixed, while a range containing none cannot be confirmed.

The shortcut ends at the review screen. Invoice creation, explicit confirmation, PIN authorization, the single callback with its existing 90-second timeout, payment monitoring, and success handling retain their existing execution path. No retry of that callback is introduced. Removing raw dispatcher logging keeps one-time voucher data out of that console message.

The specification describes fast withdrawal for inter-app links and cautions against generating large QR codes. BuhoGO uses its shared resolver for already received LNURLs, regardless of their entry point; this change does not generate or promote fast-withdraw QR codes.

## App-wide impact

| Flow | Behavior |
| --- | --- |
| Native `lightning:` links, `lnurl:` wrappers, LUD-17 `lnurlw:` links | Existing delivery/classification feeds the shared resolver; complete parameters skip metadata IO. |
| NFC foreground and cold/background delivery | Existing reader/buffer flow reaches the same resolver. Plain HTTPS NFC URLs keep their existing fallback classification. |
| Send scan, manual input, paste, clipboard | Existing LNURL intake reaches the shortcut. Only real Lightning addresses are lowercased, so an `@` inside a URL description cannot corrupt the callback or challenge. |
| Receive → Redeem scanner | The entered receive amount survives into review when it fits the advertised range. |
| Spark, LNbits, NWC | All share metadata resolution and review; their existing invoice providers remain responsible for execution. Arkade's existing unavailable-Lightning restriction is unchanged. |
| Locked kiosk | Native link/NFC handlers discard owner payment intents. KioskDashboard has no withdrawal intake or separate metadata resolver to update. |
| LNURL-pay, auth, LUD-23 | Their tags never use the fast-withdraw parser. Existing routing remains responsible for them. |
| PIN-protected cards | Valid inline thresholds survive into the existing PIN flow; ambiguous thresholds fetch authoritative metadata instead. |
| Empty or sub-satoshi-only balance | Review explains why redemption is unavailable and disables confirmation. |

## Apple-guided review experience

[Apple HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) and [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) guide the presentation. These are application design choices within BuhoGO's existing Quasar UI, not a claim that a web sheet is a native UIKit component.

Redeem remains one focused review: amount, service domain, receiving wallet, and an explicit action. It is a bottom sheet on phones and centered on larger screens. The leading Close control is labeled Cancel for assistive technology; Cancel, Escape, backdrop, and a downward swipe on the header dismiss unsubmitted review. Dismissal is blocked while submitting. There is no decorative grabber implying unsupported resizing. The sheet has a labeled heading and amount field, larger touch targets, scalable review text, a scrollable content area, and a reachable confirmation action. Empty-balance explanations and wallet context are translated into English, German, and Spanish.

## Validation

- `npm test`: existing regression suite plus 22 parser and production-method integration tests, covering each carrier, zero metadata calls on the fast path, exactly one fallback GET, amount bounds, PIN thresholds, native cold delivery and kiosk guards, provider-independent review, and unchanged callback parameters/timeout.
- `node scripts/check-lud08.mjs`: browser fixtures exercise the real Wallet page and Redeem sheet, amount editing/fixed amounts, Receive prefill, zero-balance explanation, cancellation, submission-state protection, fallback, and Send URL preservation. Localized headings and viewport bounds are asserted for light/dark phone/tablet layouts and 200% text at 320px width.
- `npm run build`: production SPA build.

Run browser checks after `pnpm dev --port 9003`; set `LUD08_BASE_URL` if using another origin. Screenshots default to `/private/tmp/lud08-review`, configurable with `LUD08_OUTPUT`. External traffic is blocked, and invoice creation/submission are prohibited in the UI fixtures. No live withdrawals are performed.

Physical NFC/camera delivery, device keyboards, VoiceOver/TalkBack, real provider payouts, and Tor connectivity remain device/integration validation tasks. Automated native coverage uses controlled bridges.

## Compatibility with LUD-23

An isolated checkout combined this implementation with PR #281 (`c4ec5c3`). The full regression suite, production build, and both browser scripts passed on the combined source. The two PRs remain independent against `dev`. When merging them in sequence, preserve both test commands, the new locale entries and address-request dictionary, both Wallet imports, and the LUD-23 dispatcher guard; these are the overlapping text changes resolved for the compatibility check.
