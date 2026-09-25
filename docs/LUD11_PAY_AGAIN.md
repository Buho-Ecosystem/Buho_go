# LUD-11 pay again and service payees: implementation and impact

Issue [#266](https://github.com/Buho-Ecosystem/Buho_go/issues/266), implemented on `flow_improvement` against `dev`.

## Protocol behavior

The [LUD-11 specification](https://github.com/lnurl/luds/blob/luds/11.md) lets a payRequest answer `disposable: false` to say its LNURL is reusable. BuhoGO reads the field only on the invoice response (`src/utils/lnurlPay.js isStoreablePayLink`); absent, null or `true` keeps the link single-use, which is what every link was before the field existed. The field is read in `Wallet.vue fetchLNURLInvoice` for Spark, Arkade and LNbits and in `lightning.js payLNURL` for NWC.

A storeable link becomes a durable address for the send: it is stamped in one canonical form, lowercase LUD-01 bech32 of the service URL (`src/utils/addressUtils.js canonicalLnurl`), so every carrier of the same link (`lnurl1…` in any case, a `lightning:` wrapper, a LUD-17 `lnurlp://` link) resolves to one string that the address book's case-folding lookups match, while a LUD-17 path keeps its case. When the service also names its Lightning address in its [LUD-06](https://github.com/lnurl/luds/blob/luds/06.md) metadata (`text/identifier`), that address is stamped instead, because it is what other apps and the shared contacts understand. A one-shot link stamps nothing. Only the invoice callback can authorize reuse; earlier metadata cannot override its decision.

The LUD-06 metadata is parsed once (`src/utils/lnurlMetadata.js`): `text/plain`, `text/long-desc`, `text/identifier` or `text/email` (only when it validates as a Lightning address), and a `image/png;base64` or `image/jpeg;base64` logo capped at 96 KB before decoding. Malformed entries yield nulls. The logo is downscaled to 96 × 96 and kept in a local registry keyed by address (`src/stores/serviceImages.js`, 40 entries, 32 KB each); it never enters the shared contacts doc, the Lotus mirror or a backup payload.

## App-wide impact

| Flow | Behavior |
| --- | --- |
| Single send from scan, paste, clipboard strip, NFC, deep link (Spark, Arkade, LNbits, NWC) | A storeable service is stamped as the recipient with its name and a service avatar, so the tx row, the last-transaction card and Transaction Details show who was paid before any contact exists. |
| Post-send save offer | Offered for a storeable service like for any recipient. The preview shows the service logo or the storefront glyph and the domain; the name is prefilled from the service description. |
| Address book | The saved entry is `addressType: 'lnurl'` (or `lightning` when the service named its address) with `service` metadata. Rows show "domain · payment link" instead of a bech32 blob; the profile shows the domain and reveals the full link on tap. Pay uses the same dispatcher and confirm sheet as every send. |
| Manual add | A pasted LNURL is canonicalized and the service is asked once to describe itself (no invoice is created). Manual and post-send saving share identifier promotion, retaining the original pay link as a local lookup alias. |
| Transaction Details | One "Pay again" row for a completed send whose service marked its link reusable, routed through the wallet page's dispatcher so the confirm sheet still asks. |
| Contacts history | "Between you" matches by the stamped canonical address, so a service's payments group under its entry. |
| Batch send | Ignores the field on purpose: a batch fans out to addresses that are already durable and has no per-payment surface to repeat from. |
| Lightning-address sends | Unchanged: the address is already durable, so the field is not needed there. Their LUD-06 logo is not captured; the avatar chain would pick it up from the registry if a later change registers it. |
| Locked kiosk | No send intake; unaffected. |

## Apple-guided experience

A service is a payee, not a new kind of object: it lives in the same list, on the same row and profile, and pays through the same button. Its picture-less fallback is one dedicated glyph (`tabler:building-store`) in the same grey disc people get for the silhouette, never a person's mark. Copy names outcomes ("Pay Corner Coffee"), not mechanisms; the address line says where a link points and what it is. The Pay again row is a single 44 pt control with a disclosure indicator, in the existing details card.

## Validation

- `node src/utils/__tests__/lnurlMetadata.spec.js`: every LUD-06 entry type, malformed input, identifier validation, image mime and size caps, text cleaning and the title fallback.
- `node src/utils/__tests__/addressUtils.spec.js`: canonical form across carriers, idempotence, refused schemes, credentials, fragments and bad checksums; Tor hosts; domain extraction.
- `node src/stores/__tests__/addressBook.spec.js`: a canonical service link resolves through `findContactByAddress` in any case and keeps its sanitized metadata.
- `node src/stores/__tests__/transactionMetadata.spec.js`: a reusable link stamps only the matching send, per wallet; a service avatar resolves its picture through the registry, which refuses anything but a small image data URL.
- `node scripts/check-lud11.mjs`: browser fixtures: the payee row and profile of a service entry (glyph, domain line, Pay through the dispatcher with one fetch and no invoice), the avatar switching to a registered logo, the Pay again row in Transaction Details, and en-US/de/es in light/dark at 390 px and 320 px with 200% text.

## Review follow-up

Pending Spark service payments retain their recipient, reusable link and provider payment ID. The metadata queue matches that ID before any amount/time heuristic, including after restart or delayed settlement. Pay again stays hidden for pending and failed transactions. Contact history recognizes both the promoted Lightning identifier and its saved pay-link alias.

`node --test src/pages/__tests__/walletFlow.spec.js` covers disposable-response precedence, pending sends, completed-only repeat actions and contact history aliases. The store specs cover restart, delayed settlement and stable-ID precedence. Browser checks assert real text enlargement, readable names and 44 px Pay targets in all three locales. Evidence: `output/pr287-fixes/INDEX.md`.

## Visual follow-up

Confirmation preserves the saved service name and logo (or storefront fallback), with the service domain under the name. The exact payment link remains available under Details. Unsaved LNURLs use their validated metadata description or domain; this is display identity, not merchant verification.

Receipts show existing notes as text. More contains note editing with explicit Save/Cancel, contact assignment/removal and technical details. The tag selector is removed; existing stored metadata remains intact. Favorites is a secondary action in the contact profile's More menu.

Voucher editing gives removal its own row, keeping the identity readable at 200% text. The removal alert scales its title, warning and actions together, keeps actions visible and initially focuses Cancel. Screenshots and browser evidence: `output/pr287-visual-fixes/index.html`.
