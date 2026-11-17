# Kiosk PoS implementation review

Implementation base: `dev` at `675cc3fedcff5ace4c685e8e316eb841d9655cf3`. The original working checkout was preserved. [Approved behavior](../KIOSK_POS_PLAN.md) · [Architecture and recovery](../KIOSK_MODE.md).

## Delivered behavior

- Optional illustrated introduction, eligible receiving wallet and currency defaults, repeated owner PIN and explicit register entry.
- Existing large Amount presentation through the shared keypad; tap the amount to switch units without losing canonical sats. Switching to Products moves a typed amount into a visible basket row.
- Local products/categories, quantities, saved baskets and continuous virtual lists. Search opens on demand and restores browsing position.
- One IndexedDB merchant store for drafts, immutable receipts and linked requests. The former parked-sale watcher is retired. Draft writes do not rewrite historical orders.
- Request identity persisted before QR, exact wallet/hash confirmation, uncertain creation recovery, verified expired replacements, late/duplicate payment accounting and active-order ownership across owner navigation.
- Local sales, labels, itemized CSV and register JSON backup/empty-register restore. Staff can open/export the current confirmed receipt. Printing is offered in browsers; native printing is not advertised.
- Owner withdrawals reuse the existing destination chooser, payment host, fee preparation and review. Max budgets an enforced allowance where possible. Native Bitcoin fee review and existing Auto-Transfer destination/speed rules are retained.
- Salted PIN and verified native recovery; no logo-tap bypass. Kiosk preferences report success only after durable save and roll back failed writes.

No backend, shared inventory, ecash payment path or global Settings redesign was added. Supported wallet/provider names identify actual capabilities; external product comparisons are not part of these artifacts.

## Adversarial findings and corrections

The Red Team inspected implementation independently. The Blue Team reproduced payment findings using the real store/runtime before changing them. Additional mounted-app checks found integration failures that isolated storage tests did not reveal.

| Finding | Correction and evidence |
|---|---|
| Fiat basket and live entry could differ by one sat | One aggregate pricing path for Charge and the immutable request; shared integer fiat conversion; mixed-entry regression |
| Tiny sats changed through fiat display rounding | Canonical integer sats survive display switches; ineffective keys preserve them; exact 1/8/10/101 tests |
| Expired requests replaced without a fresh check | Strict recheck of all issued attempts; failed/unknown/paid results and stale confirmations block replacement |
| Owner navigation released an issued basket for another charge | Preserve active-order ownership across context changes, including creation races; only explicit Next customer clears ownership/draft |
| Resuming another request could overwrite a draft | Runtime conflict guard plus owner precheck before locking |
| Entry unit reset between ordinary sales | Preserve unit on clear/save/next/reload |
| Connection failure stranded input | Staff-safe reconnect action and online/visibility recovery |
| Stale-tab recovery repeated rejected writes | Reload authoritative records and retain the unsaved local draft as a deduplicated recovered basket |
| Destructive clearing and inaccessible current receipt | Confirm clearing; staff current-receipt view and export |
| Card/QR payer origin could not be proved | Record the confirmed payment as Lightning; service acceptance never becomes paid proof |
| Failed owner configuration could appear saved | Durable serialized kiosk preference writes and rollback; device authentication revalidates its session |
| Development action proxies lost persistence ownership | Key repositories/queues by canonical store state; proxy regressions and actual mounted setup/checkout |
| Owner dialog forms were visible but not clickable | Standard Quasar card wrappers, verified through visible product creation and modal actions |
| Long catalogs/history rendered every row | Native virtual scrolling, complete filtered export scope and measured continuous navigation |

## Reproducible verification

Final automated checks use Node 24.11.1. No separate lint or TypeScript checking command is configured in this JavaScript application; the production build and existing source/style checks cover the available pipeline.

Run the application with `npm run dev -- --port 9100`, then:

```sh
npm test
npm run build
npm run check:kiosk
npm run check:kiosk-storage
npm run check:kiosk-layout
npm run check:kiosk-withdraw
```

The browser runners block external services and inject scripted providers. They use actual Vue components, router, stores, IndexedDB and shared payment surfaces. They do not establish funded settlement. Measurements are in [checkout](kiosk-checkout.json), [layout](kiosk-layout.json) and [withdrawal](kiosk-withdraw.json); screenshots under `docs/images/kiosk-pos/` were captured from the implemented application. The layout runner uses deliberately populated UI fixtures, separate from checkout settlement evidence.

## Final results

| Check | Result |
|---|---|
| Complete `npm test` pipeline | Passed on Node 24.11.1, including wallet, kiosk, batch/internal transfer and Auto-Transfer regressions |
| Production build | Passed on Node 24.11.1; SDK chunk-size notices were emitted |
| Actual checkout browser journey | Passed, zero page errors; visible setup, product authoring, exact units, owner continuity, late settlement, reload, receipt download, basket resume and route guard |
| Withdrawal browser journey | Six cases passed; zero outgoing submissions and zero page errors |
| Real IndexedDB | Six checks passed, including 10,000 records and zero order rewrites for a draft edit |
| Growth, owner dialogs and mobile layouts | Passed; 1,000 products/10,000 orders windowed; ordinary Save/Close clicks; translated compact welcome; measured text contrast 6.32:1 light and 9.02:1 dark |
| Independent final adversarial audit | No remaining demonstrated P0/P1 in the reviewed scope; 85 independently run targeted tests passed |
| Source checks | 38 JavaScript files passed syntax checks; 11 changed Vue files compiled; diff whitespace check passed |

The final screenshot review additionally corrected receipt action contrast and measured its bottom spacing and internal scroll containment. These browser results are separate from the unverified physical and funded scenarios below.

## Limits requiring physical or controlled merchant validation

- No live funds moved. Live provider settlement, service/routing fee behavior and Bitcoin withdrawal execution were not tested with funded accounts.
- Native Android NFC/card interactions, device authentication prompts and native file saving were not exercised on physical hardware.
- Chromium mobile viewports, keyboard commands and translated layouts were exercised. Physical iPhone/Android keyboards, VoiceOver/TalkBack and 200% system text still require device checks.
- Large-data tests demonstrate DOM windowing and storage behavior on this development machine. They do not establish the proposed latency targets on a lower/mid-range Android device.
- No novice merchant study was performed. The proposed usability targets remain targets, not results or certification.
- The web cannot offer verified forgotten-PIN recovery. It requires the existing PIN; native device verification is the supported recovery path.
- Merchant records remain device-local and separate from wallet recovery. Keep a register JSON backup before clearing device/browser data. Unknown request creation without a returned identifier remains unresolved rather than being automatically recreated.
