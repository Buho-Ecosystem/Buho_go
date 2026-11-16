# BuhoGO PoS — final design and implementation plan

**Decision date:** 2026-11-16. **Owner refinements:** preserve the current Amount UI, switch entry units by tapping the amount without an extra icon, expand receipt items, and expose supported on-chain Auto-Transfer destinations. **Status:** approved behavior reference; implementation and verification are recorded in [the implementation review](reviews/KIOSK_POS_IMPLEMENTATION.md). This plan is the behavior reference; the temporary HTML is not payment or recovery evidence. [Current implementation](KIOSK_MODE.md) · [Auto-Transfer](AUTO_TRANSFER.md).

## Decision

Proceed with a welcoming, local-first register built around BuhoGO's existing wallets, illustrations and payment flows. Keep a short path to taking a payment, fast product selection, explicit payment status and optional transfers. Improve the proposed BuhoGO experience through fewer setup decisions, one compact toolbar, readable continuous lists and useful recovery actions.

**Approve the interaction direction; implement the payment and data guarantees before releasing it.** A polished HTML simulation does not establish safe payment behavior. The red review found arithmetic, duplicate-request, persistence and owner-access risks that the earlier geometry checks did not cover. The decisions below resolve how they must behave; the release checks prove that behavior in the real app.

## What is included

| Build now | Boundary |
|---|---|
| Guided merchant setup | Eligible existing receiving wallet and existing currency preselected; owner PIN; no new account |
| Local products, categories, prices and baskets | One device; no stock counts, reservations, shared inventory or synchronization |
| Sales, labels, itemized exports | Records actually available on this device; original sale values retained |
| Manual withdrawal and Auto-Transfer access | Reuse the app's payment confirmation, destination checks and rule engine |
| Clear payment guidance and connection states | QR on the web; supported Lightning-card NFC only in the Android app |
| Existing BuhoGO visual language | Manrope, existing theme roles, grouped rows, sheets, PIN pad and original illustrations |

Cashu/ecash, mint setup, ecash offline settlement, ecash NFC, external catalog synchronization, shared catalogs and the overall Settings reorganization remain deferred. Product variants, barcodes, VAT/tax configuration, returns/refunds and catalog imports are separate scope decisions. This release is not a claim of full retail/compliance feature parity. Keep a catalog repository boundary so future synchronization can be added without exposing unfinished controls now.

**No bolt/lightning glyphs in new UI.** This also applies to Charge. Payment rail names may appear when necessary to identify an accepted payment request.

## Design rationale

The approved decisions use familiar BuhoGO components and the following Apple guidance. These are design choices, not certification. Apple's dimensions are points; **44 CSS px** is our web hit-target criterion.

| Guidance | BuhoGO decision |
|---|---|
| [Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding) | Direct setup with an optional illustrated tour |
| [Entering data](https://developer.apple.com/design/human-interface-guidelines/entering-data) | Eligible wallet and existing currency preselected together |
| [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) | Compact toolbar, standard back symbol, lower-priority actions in More |
| [Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields) | Search on demand with immediate results and restored browsing context |
| [Collections](https://developer.apple.com/design/human-interface-guidelines/collections) and [scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views) | Continuous textual lists with one clear scroll region |
| [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) | Readable alternatives, keyboard confirmation, reduced motion and text enlargement |

## The experience we are committing to

### 1. First-time setup

1. Warm welcome with the existing animated PoS illustration. Primary **Set up register**; secondary **See how it works**. The optional tour can be exited immediately.
2. **Sales go straight here.** Show the selected wallet's familiar name and price currency together. Continue works without editing. Change is available when needed.
3. Choose and repeat the owner PIN using the existing keypad. No illustration competes with PIN entry. Back preserves the earlier choices.
4. **Your counter is ready.** Primary **Open register**. Product entry and Auto-Transfer are optional later tasks.

Select the previously chosen eligible kiosk wallet, otherwise the eligible active wallet, otherwise the first eligible connected wallet. Readiness must use the real `kioskWalletBlocker` checks, not a wallet brand or the existence of a saved connection. With no usable wallet, offer the existing connect/add-wallet flow and return to this step afterwards. Show a clear reason and a next action; do not announce readiness or silently switch receiving wallets.

Use the existing currency as a default. A priced catalog keeps its pricing currency; changing a display unit does not reprice products. No setup tutorial requires people to learn Spark, Arkade, NWC, invoices, providers or fee calculation.

Fresh installations open **Amount** when the catalog is empty. With products present, remember the operator's last entry mode. Existing merchants keep their receiving wallet, display unit, tip percentages, tip-enabled state and independent round-up preference. The current app defaults tips off; this enhancement does not turn them on.

### 2. Build and correct a sale

**Amount is the existing BuhoGO Kiosk screen, not the replacement layout from the earlier prototype.** Keep the large amount with its separate currency prefix, existing numpad appearance, spacing, Add/Charge row and conditional basket summary from `src/pages/KioskDashboard.vue`. The only new permanent control is the Amount/Products switch so the operator can return to the catalog. Do not add a permanent conversion panel, a second total, an extra unit-switch icon, a permanent empty-basket dock or redesigned keycaps. Keep the current Kiosk appearance while reusing the shared amount-input behavior described below; the prototype's money model is not its replacement.

Products has the same entry-mode switch, optional search and its anchored basket/Charge area. Prices and the current total are visible before charging. Product order remains stable; adding an item changes its quantity without jumping the list, closing search or showing a blocking notification.

Catalog search matches the stored name/category, updates while typing, handles case and accents, and searches the complete local catalog. Opening it begins broadly; an explicit category can narrow results. Cancel returns to the prior category and position. Empty results offer a useful reset. Empty catalogs offer an owner entry point and keep Amount available.

Basket review uses a single item scroller. Quantity controls have generous targets. Subtotal and Charge remain reachable. A 12-item basket never needs 11 Next taps. Save for later preserves the full basket, currency and prices. Resume explains a conflict with an already open basket rather than replacing it. Clear all requires confirmation or a reliable Undo; removing one item remains immediate.

**Charge** starts payment preparation. Avoid an automatic extra review screen for every ordinary product sale: the basket and total are already visible. Merchant-enabled tips/round-up appear only when configured, start unselected, show the resulting total and preserve the existing independent round-up behavior. Use one clear primary action. Do not preselect a paid tip or turn an optional setting into a first-sale requirement.

### Amount entry: tap to switch fiat / Bitcoin

**Final owner decision:** the large amount itself is the unit-switch target. One ordinary tap switches between Bitcoin entry and the fiat currency selected during setup. **No extra icon, separate toggle, settings detour, long press or double tap.** Keep the existing currency/unit label on the amount, so the active unit is unambiguous; do not add a permanent help row. The optional introduction can explain this in one sentence without adding counter controls.

Setup chooses **which fiat currency** to use (for example EUR); tapping the amount chooses **which unit is being entered right now**. These are independent. This does not change product/catalog pricing, the receiving wallet, saved basket values, previous receipts or the app's global fiat preference. Preserve an existing merchant's kiosk entry-unit preference; a fresh fiat-led setup starts in its chosen currency. New sales retain the last chosen entry unit, and restart restores the saved kiosk preference rather than silently switching it.

Reuse [`AmountKeypad.vue`](../src/components/AmountKeypad.vue) and [`utils/amountKeypad.js`](../src/utils/amountKeypad.js), including their controlled `modelValue` / `fiat`, `exactSats` and swap/edit behavior. Use a PoS presentation variant/slot if needed to retain the current Kiosk's large amount and key styling. The component's default Receive presentation and secondary swap icon are not the requested PoS layout. Do not write a second PoS input parser or conversion implementation.

| Active entry unit | Required keypad and amount behavior |
|---|---|
| Fiat | Selected currency symbol/code stays visible; decimal key uses the locale's decimal separator; preserve the shared fiat fractional-input rule (currently up to two decimals) and grouping |
| Bitcoin | Use the existing Bitcoin formatter with the denomination clearly identified; today's shared keypad edits **whole sats**, not decimal BTC. Show `000` in the decimal-key position, reject fractional input and retain integer sats |
| Tap the amount | Update the unit and key mode together without clearing the amount, moving the keypad, changing the basket or creating a payment |

A unit switch preserves the **canonical integer-sat value**. Use the shared component's `exactSats` binding to prevent rounded fiat display text from becoming a new charge amount. Tapping back restores that exact value. Only an effective edit to the number starts a new entered value; a no-op/rejected key must not clear the exact amount. Never reinterpret the unchanged characters as the other unit (for example EUR 10 must not become 10 sats).

For newly entered fiat, use the shared converter's policy rather than a second PoS rounding rule; it currently floors the conversion to whole sats. Lock the canonical amount/rate at payment preparation. An already explicit sats amount must never be reconstructed through cents. Migration tests must cover the existing Kiosk/shared-component rounding difference explicitly before replacing any calculation path.

With no fresh usable price, Bitcoin entry remains possible. Empty fiat input can switch to empty Bitcoin input without a conversion. Preserve a nonzero fiat draft when a conversion cannot be made; give a brief actionable price-unavailable message instead of guessing, showing zero or discarding the amount. Likewise, do not convert sats to fiat using an unavailable/stale rate. Once a payment is being prepared or shown, its amount is fixed; this input gesture cannot edit an issued request.

**Accessible and predictable:** implement the amount as a semantic button with a target at least 44×44 CSS px, keyboard Enter/Space support, visible keyboard focus and an accessible name naming the current and next unit. Announce the new unit/value politely. No new visible icon is needed. Other `AmountKeypad` consumers keep their current presentation.

**Feedback status: decided and recorded; implementation uses the shared component.** Acceptance checks: tap zero and a nonzero amount in both directions; verify fiat decimal key ↔ Bitcoin `000`, deletion, leading zeros, maximum length and comma-decimal locale; switch 1, 8, 10 and 101 sats to fiat and back without changing a sat; test fiat-to-sats-to-fiat and subsequent effective/no-op edits; preserve product/basket values; test an unavailable/stale price and keyboard/screen-reader operation. Closing/reopening owner settings must not silently reset the chosen currency or reinterpret an active amount.

### 3. Ask the customer to pay

Show the exact amount, one useful QR, plain guidance and a clearly different waiting/received state. Browser: **Scan with your wallet**. Android with working supported NFC: add **Hold a Lightning card against the back of this phone**. Unsupported or unavailable NFC keeps QR usable and has a concrete recovery/fallback. Do not imply ecash tap or offline settlement.

Customer card PIN and owner PIN must be unmistakably different contexts. Card authorization accepted is not payment received. Do not show success, success haptics or a completed sale until the receiving wallet confirms the payment.

**Next customer** keeps the outstanding payment record and starts an empty sale. Show a compact **Waiting payments** entry so it can be reopened. Stopping display of a code never means the invoice was revoked. Do not return the same editable basket to a second Charge while its existing request is still payable.

If a request expires, check its status before preparing a replacement. Link replacement attempts to the original order, continue checking any attempt that can still settle, and surface a late/duplicate payment for owner resolution. An unavailable status check is uncertainty, not permission to charge again automatically. Count the order once; preserve every actual money movement. We cannot guarantee that a customer will never pay two still-payable requests; the guarantee is durable tracking, no blind retry, and visible reconciliation of every received payment.

### 4. Recover without learning the architecture

| Situation | What the person sees and can do |
|---|---|
| Internet unavailable | **You're offline.** Catalog, basket and records remain available. New payments/transfers wait; existing QR and amount stay visible |
| Wallet temporarily disconnected | **Wallet disconnected.** Automatic reconnect plus a staff-safe **Try again** action; keep the sale intact |
| Saved wallet lacks required capabilities | Owner sees a concrete **Choose another wallet** path; staff cannot change the destination |
| Preparing payment | Short progress text; prevent duplicate Charge; leaving/reloading cannot create a second request silently |
| Customer paid but confirmation is delayed | **Waiting for confirmation.** Keep checking; do not instruct the customer to pay again |
| App closes or phone restarts | Resume the register, restore drafts and check outstanding requests; first-run setup does not repeat |
| Withdrawal result unknown | **Waiting for confirmation.** Keep the reservation and record; check the result before another attempt |
| Local record cannot be saved | Clearly distinguish money received from record storage trouble; keep recovery information and offer retry/export |

Use one contextual message with one meaningful next action. Technical diagnostics belong in owner details or logs, with secrets redacted. Do not show raw provider exceptions, BOLT11 strings, routing terminology or stack traces as instructions.

### 5. Review the day

Owner views share the compact title/navigation row. Full-ledger exports and administration remain owner-only; staff may view, print or share the current customer receipt without gaining access to historical records. Search is prominent only on searchable lists. Lower-frequency actions use labeled menu entries such as **Export sales** and **Open register**. Back retains meaningful context; returning from a receipt keeps the relevant activity filter and position.

Sales shows the selected period, base sales before extras, payment count, average base sale and Extras (tips plus round-up). When either extra exists, the receipt/export breaks it into Tip and Round-up; base sales + tip + round-up must equal the received total. Round-up is not silently treated as product revenue or a tax adjustment. Explain the basis with short labels. Activity is a continuous local list with compact status/date filters and search on demand. Receipt items take most of the viewport. A compact summary shows the paid amount, Paid state and date/reference in approximately two lines. Remove the large hero and permanent Items/Details segmented control. Details, labels, Print and Export are labeled More actions. Only nonzero extras require a compact breakdown; do not spend permanent space on a duplicate subtotal and a zero tip. Retain all original fields and the complete print/export data. Receipt items scroll; the confirmed total remains visible. Charts get a text summary and are never the only way to read the result.

Store an immutable sale snapshot: item name/category, quantity, original unit price/unit/currency, subtotal, tip, round-up, exact sats, exchange rate used, receiving wallet, payment method, status, identifiers and timestamps. Later catalog edits, rate updates or currency changes never rewrite a receipt. Records in different fiat currencies are filtered/labeled separately; never add unlike currencies or silently hide an earlier currency's sales.

Exports name their selected date/status/currency scope before download. Export all matching rows, not only visible ones. Include exact sats and original currency and keep sale-level values from being repeated as additive totals on every item. Protect spreadsheet text fields from formula interpretation.

At the owner catalog/export entry, say **Saved on this device** once in context. A wallet recovery phrase does not by itself restore products or itemized sales. CSV is not a full catalog/settings backup. Merchant data must be covered by an explicitly tested local/export/restore or existing encrypted-backup path; explain the actual coverage, including browser-data loss.

### 6. Move money when wanted

Keep **Withdraw now** available alongside the existing **Auto-Transfer** setup. They use the same saved, validated destination and the existing app payment/rule infrastructure. Never create a second PoS-specific rule engine or quietly enable an automatic rule.

For manual withdrawal: choose a real destination once or reuse an eligible saved one; enter an amount or choose **Max after fees**; review where it goes, what arrives, the fee/limit, total wallet debit and expected remainder; confirm accessibly; follow pending/confirmed history. A familiar fiat estimate accompanies exact sats. Fixed-amount payment requests stay fixed; insufficient balance including fees is explained, not solved by silently lowering what arrives.

No fabricated “Savings” wallet, no same-wallet destination, and no default recipient that the merchant did not choose. Capability changes invalidate the choice and give an actionable alternative. A temporary connection problem gets Retry; an unsupported route gets Change wallet/destination.

Auto-Transfer reads as a sentence: **When Shop holds more than [threshold], move everything above [keep] to [destination].** Optional details explain that the wallet's full balance counts, including receipts outside this register, and that the rule runs while BuhoGO is open and connected. Closing the app is not a guaranteed background service. Show Waiting/Paused with a reason rather than silently claiming Active.

### Supported destinations: automatic and manual are different capabilities

Auto-Transfer is **not limited to Lightning addresses**. Reuse the existing destination chooser and actual `readDestination` / `destinationProblem` rules from `src/utils/autoTransfer.js`, with the fee and speed flow in `src/components/autoTransfer/AutoTransferSheet.vue` and `src/stores/autoWithdraw.js`. The preview now includes the supported **Bitcoin address** choice for a Spark source.

| Source wallet | Manual Bitcoin send in the existing app | Automatic Bitcoin-address transfer | PoS decision |
|---|---|---|---|
| Spark | Supported | Supported | Show Bitcoin address alongside compatible wallets/Lightning destinations; expose arrival speed only after a Bitcoin address is chosen |
| Arkade | Supported through `ArkadeWalletProvider.offboardToBitcoin` / the normal Send flow | **Not wired up**: `destinationProblem` explicitly rejects Bitcoin destinations for non-Spark sources; the automatic Arkade branch sends to Arkade addresses | Do not advertise automatic on-chain transfers. Keep general manual-send capability separate from PoS receive eligibility |
| LNbits / NWC | No generic native Bitcoin send is offered by this Auto-Transfer integration | Not supported by this rule path | Do not show a Bitcoin-address choice or reinterpret it as a Lightning address |

This distinction was checked in the local source and current remote [`dev` Auto-Transfer rules](https://github.com/Buho-Ecosystem/Buho_go/blob/dev/src/utils/autoTransfer.js). Arkade's existing outgoing Bitcoin capability does not make it an eligible PoS Lightning receiving wallet. Future Arkade on-chain automation needs its quote/execution/reconciliation path implemented and tested before its UI is enabled; it is not silently included in this feature.

For Spark Bitcoin destinations, follow the existing **When / Move / To / Arrives** rule presentation. Arrival options reuse **Within an hour / About 30 minutes / Next block**, with timing explicitly an estimate. Explain once: **Faster costs more. The fee is checked at each transfer.** Hide speed for other destinations. Validate the recipient/network and obtain the native withdrawal fee quote; keep the amount left in the wallet after all fees. Do not show a Lightning percentage reserve or fee-free promise for a Bitcoin transfer. Below minimum/dust waits; a changed quote is handled by the shared execution guard.

The shared manual Send/withdraw flow must likewise preserve supported on-chain destinations and use the existing native fee/review components. Do not convert a saved automatic Bitcoin address into a Lightning address when reusing destinations. The temporary manual-withdraw simulator does not implement on-chain execution; it must not pretend to exercise that provider path.

## Fee decision

Our decision is a capability-based **Max after fees**, rechecked with the latest balance and destination limits. When a fee bound genuinely holds, amount + full bounded fee must fit within the available balance. Include provider/service charges as well as routing fees; when the complete debit cannot be bounded, do not offer a guaranteed full-balance Max. For Auto-Transfer, the keep floor applies after both. Refresh/reconfirm changed or expired quotes. Pending withdrawals reserve funds and prevent duplicate submission. Unused allowance stays in the wallet; record the actual fee when confirmed.

Where a wallet cannot bound fees, do not promise an exact retained balance, a safe full-balance Max, or “at least” a remainder. Use the app's shared truthful fee wording and supported send path; explain any limitation near Max in plain words. Receiving payments into an eligible wallet is not disabled merely because it cannot provide a bounded outgoing fee.

### Existing global fixes — rechecked, not recreated

All three issues filed in the earlier review are **closed** as of 2026-11-16:

| Follow-up | Current evidence | Integration decision |
|---|---|---|
| [#510: Spark quoted fee tolerance](https://github.com/Buho-Ecosystem/Buho_go/issues/510) | Closed via #509; remote `dev` enforces the prepared quote exactly and requests review when it increases | Reuse the shared prepared-payment contract; a safe Max must additionally budget the entire upper bound |
| [#511: LNbits/NWC fee capability](https://github.com/Buho-Ecosystem/Buho_go/issues/511) | Closed via #519 on `dev`; LNbits server reserve and unbounded NWC behavior are distinguished | Read real capabilities/fee results; do not reduce this to “all Spark yes, all others no” |
| [#512: destination minimum after fees](https://github.com/Buho-Ecosystem/Buho_go/issues/512) | Closed via #519 on `dev`; a below-minimum transfer waits rather than building a failure streak | Reuse that behavior; explain above-maximum limits and never split money automatically |

Implementation starts from verified `dev` commit `675cc3fedcff5ace4c685e8e316eb841d9655cf3`, containing the shared fee fixes. The original working checkout remains untouched. Provider stubs do not prove funded-wallet settlement behavior.

## Red team / blue team decisions

P0 means a wrong amount, money/state ambiguity or an invalid access/readiness promise can result. P1 means a normal merchant task fails or becomes unnecessarily difficult. “Specified” is not “implemented.”

| ID | Red-team challenge | Blue-team resolution / final decision | Status before production |
|---|---|---|---|
| R1 · P0 | Sats entry is rounded through fiat cents in the old HTML; extracted functions produced 1→0, 8→13, 10→13, 101→100 sats | Exact entered sats stay integer sats end-to-end; fiat is a display/rate snapshot | Mandatory arithmetic tests; never copy the prototype's simulation arithmetic |
| R2 · P0 | Cancel/retry can create another payable request for the same basket | Durable order identity, linked attempts, status check before replacement, late-payment reconciliation; Next customer starts empty | Must be implemented and integration-tested |
| R3 · P0 | Active QR, basket and setup state can be lost on reload | Persist intent/request before presenting QR; restore drafts and pending checks; handle storage failure | Must be implemented in the app; simulation reload is not payment-recovery proof |
| R4 · P0 | Changing currency relabels stored cents and hides other-currency history | Catalog pricing currency is explicit; block changes with active orders; no silent repricing; retain original receipt currency | Prototype blocks unsafe relabeling; real migration/reporting contract required |
| R5 · P0 | Prototype marked an Arkade wallet ready despite the app blocking its Lightning receive route | Shared receive + confirm eligibility; unavailable wallet never appears ready | Fixture corrected; revalidate capabilities when implementation begins |
| R6 · P0 | Current 13-logo-tap recovery bypass contradicts owner-only claims | Replace unconditional owner access with a verified existing app-lock/recovery path before exposing owner withdrawals, exports or catalog administration | Explicit release gate; no security policy silently changed by this review |
| R7 · P1 | Withdrawal defaults to a non-existent Savings wallet; impossible routes offer Retry | Real eligible destination or ask once; distinguish unsupported from temporarily unavailable | Preview uses real fixture IDs; production uses shared capabilities |
| R8 · P1 | Basket/receipt pages force repeated Next taps for an ordinary order | Single item scroller with pinned totals/actions, just like the catalog | Preview corrected; test 8–12-item orders in the app |
| R9 · P1 | Disabled “Reconnect wallet” offers no action | Automatic reconnect plus staff-safe Try again; owner-only configuration changes | Preview illustrates action; real reconnect integration required |
| R10 · P1 | Tips default changed; configured percentages and independent round-up disappeared | Preserve existing preferences/math; fresh tips off; round-up works even with tips off | Migration and all combinations are release tests; HTML does not replace existing extras implementation |
| R11 · P1 | Local-only data and save failures are understated | Explain actual backup coverage; distinguish received payment from saved receipt; tested recovery/export | Merchant-data storage/restore must be verified |
| R12 · P1 | Fiat-first merchant reaches an unexplained sats-only withdrawal form | Familiar fiat estimate, exact sats, prominent Max after fees and plain destination names | Preview and shared payment sheet must communicate the same values |
| B1 · P1 | Four compulsory-looking intro slides and a separate currency decision | Direct setup, optional tour, wallet/currency together, then PIN | Preview corrected |
| B2 · P1 | Icon-only Download/Home require guessing; slider is the sole confirmation | Labeled secondary actions; explicit Open register; accessible shared confirmation | Preview corrected; real assistive-technology checks required |
| B3 · P1 | Compact screens alone are treated as accessibility proof | Readable type, large text, reduced motion and screen-reader/keyboard paths take precedence over fixed-height aesthetics | Release tests below; no “Apple compliant” claim |

## Implementation sequence

Each slice must be reviewable and retain existing kiosk behavior. Do not implement the entire feature as one replacement of the payment engine.

1. **Verify the base and contracts.** Record the current `dev` commit containing the global fee fixes. Audit existing preferences, payment identities, parked-request persistence, owner authorization and merchant backup coverage. Add meaningful failing tests for R1–R6 before changing their behavior.
2. **Durable local merchant model.** Products/categories, integer price + currency/unit, versioned baskets, immutable sale snapshots and linked payment attempts. Storage commits must be observable; no invoice QR before its recovery record exists. Keep repository boundaries ready for future shared inventory without implementing it.
3. **Register and guided setup.** Reuse the real receiving-wallet capability checks, PIN workflow and original assets. Add compact shared owner toolbar, amount/products selection, stable search/categories and continuous basket/receipt lists. Preserve existing tips and round-up independently.
4. **Payment/recovery integration.** Reuse the incoming-payment and card flows. Connect Next customer, waiting records, restart/reconnect reconciliation, stable sale identity and late/duplicate outcomes. Browser QR and Android NFC behavior diverge only where capability requires it.
5. **Owner reports and transfers.** Build local Sales/Activity/receipts/exports from confirmed records. Link the existing Auto-Transfer settings; add manual destination/Max/review/pending flow through the shared payment sheet and provider fee contracts.
6. **Acceptance review and rollout.** Test migration, native devices, accessibility, novice tasks and the counter scenarios below. Resolve all P0 findings and document any scope limitation before real merchant use. Remove the temporary HTML only after the implementation is accepted.

## Release acceptance: observable outcomes

### Money, continuity and authority

- Enter **1, 8, 10 and 101 sats**; basket, QR invoice, confirmation, receipt and export preserve the exact amounts. Test fiat-priced products separately, mixed entries and one-time rounding of optional extras.
- Repeated Charge, delayed callbacks, card/QR races and reconnect cannot create duplicate sales. Accepted/authorizing/pending never produces success prematurely.
- Include a request-creation timeout **before the provider returns an identifier**: retain an uncertain recoverable intent, reconcile with provider history/status when possible, and never blindly regenerate.
- Kill/reload during request creation, QR display, card authorization, waiting and withdrawal. Reopen the same recoverable intent; reconcile without blindly resending. Simulate a storage-write failure before a QR and after a confirmed payment.
- Old invoice paid after Next customer/expiry/replacement is still reconciled. Two actual payments for one order are visible as an exception; neither disappears, and sales totals do not silently double.
- Reject changes to receiving wallet/currency during active orders. Invalidated wallet permissions and removed destinations get concrete next actions. Historical records never change after catalog edits.
- Staff cannot reach owner operations through browser Back, route entry, logo taps, reload, direct menu actions or switching tabs. Owner PIN recovery must require real owner verification. Card PIN is never logged or persisted.
- Existing tip percentages/enabled state, display currency and independent round-up migrate unchanged. Test tips off/on × round-up off/on, with zero/positive extras and back navigation.
- Destination matrix: Spark Bitcoin-address Auto-Transfer exposes its arrival control and fresh native fee; Lightning hides it. Arkade manual on-chain remains available in the existing Send path, while Arkade automatic on-chain stays unavailable. Reject a Bitcoin destination after a source capability change and preserve draft changes on Back.
- Bounded-fee Max includes the entire maximum debit and any keep floor. Fixed invoice amount is never reduced. Expired/increased quotes require review. Unbounded-fee routes never promise a guaranteed remainder. Below-minimum Auto-Transfer waits. Pending withdrawals remain reserved across restart.

### Handheld and accessibility

- Browser matrix: 320×568, 320×640, 360×740, 390×844, 430×932; desktop/tablet resize; both themes. These dimensions are test cases, not the complete range of supported phones.
- Normal text: compact toolbar, complete primary action and one content scroller. Amount matches the current live Kiosk design with only the entry-mode switch added; receipt summary never consumes most of the screen. Catalog, 12-item basket and receipt are browsable without page buttons. Keep layout/browsing position stable when quantities change.
- **200% text and landscape:** allow the content region to scroll; never hide essential information or shrink labels to preserve a no-scroll aesthetic. Pin the primary action only while sufficient readable content remains available.
- Real Android/iPhone soft keyboards, focus/selection, search clear/cancel/Enter, German labels and long names. Browser resize simulation does not substitute for those checks. Test Amount in short desktop preview frames as well as real phone viewports; measure the digits against their immediate clipping container, not only against the outer screen. The available component height determines keypad sizing, and the amount may never be cut off.
- Measure normal-text contrast ≥4.5:1 and essential non-text controls ≥3:1 in both themes. Main instructions/amounts must not depend on color. Inspect focus visibility and all interactive targets; project web target is at least 44×44 CSS px.
- VoiceOver/TalkBack and keyboard-only: understandable field/button names, correct owner/customer PIN context, polite waiting/received announcements, modal focus/return, and a non-drag confirmation path.
- Reduced motion keeps the original illustration's static state and readable loading feedback. Success is also communicated visually and in text; haptics are optional support.
- Physical Android NFC: supported hardware, NFC off, permissions, wrong card, card PIN, decline, disconnect and QR fallback. Browser must not offer unsupported tap-to-pay.

### Growing local data

Use a proposed maturity fixture of **1,000 products and 10,000 sales**, including mixed currencies, long names and old records. Continuous browsing may use internal list windowing; it must not force paging or retain every historical row in the DOM. On an agreed lower/mid-range Android reference device, measure provisional targets of search results within 200 ms and add/quantity feedback within 100 ms at the 95th percentile. Complete exports must contain all matching records regardless of what is rendered. Record the device/build and revise targets only with explicit evidence. These are implementation acceptance targets, not benchmarks already passed by this HTML review.

### Novice and daily-use sessions

These are proposed release targets, **not results already achieved**. Use at least five unfamiliar people, including someone with low technical confidence, plus at least two people who operate a real counter. Use a fresh app without preloaded demo products.

| Task | Pass condition |
|---|---|
| Set up with an eligible existing wallet | At least 4/5 unfamiliar people reach the register within two minutes without coaching or entering optional data |
| First payment | Every participant can identify where sales go, what the customer must do, and whether money has actually arrived; no false paid interpretation |
| Three-product sale | At least 4/5 find/add the items and correct an accidental quantity without help; no loss of position or basket |
| Busy counter | Both operators build an 8–12-item basket, save/resume it and take the next customer while another payment is pending; no lost order or accidental duplicate charge |
| Withdrawal | At least 4/5 can identify recipient, amount arriving, fee/limit and remaining balance before confirmation; no mistaken “100% means free” expectation |
| Export | Operator can export the intended period and explain that the records belong to this device; no assumption that CSV restores the whole register |

## Implementation evidence

Actual application checks, screenshots and unverified physical-device or funded-wallet scenarios are recorded with the implementation review. Simulated providers are identified explicitly.
