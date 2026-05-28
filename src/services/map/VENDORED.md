# Vendored: Bitcoin Map data layer

The files in this directory (`btcmap.js`, `overpass.js`, `btcpay.js`, `osm.js`,
`places.js`) and the store `src/stores/mapPlaces.js` are **vendored** (copied in,
not a dependency) from:

- **Source:** https://github.com/pratik227/bitcoinmap
- **Vendored on:** 2026-05-28

## Why vendored

The map ships as a self-contained BuhoGO feature with no runtime dependency on
the external repo. We own these files. The trade-off is manual re-sync when the
upstream improves.

## BuhoGO-local changes (do not lose on re-sync)

- `verifiedAt` threaded through every source + the merge + the feature
  collection (freshness chip in the detail sheet). Upstream BTC Map carries
  `updated_at`; OSM/Overpass carry `check_date:*`.
- `online: true` flag on BTCPay records so the UI labels online-only merchants
  distinctly instead of implying a storefront at the synthetic centroid.
- `places.js` adds `distanceMeters()`, `CATEGORY_BUCKET_ICONS`.
- `stores/mapPlaces.js` (renamed from upstream `stores/places.js`): adds
  `userLocation`, the distance-sorted `listPlaces` getter, the viewport-scoped
  `visibleCount`, and the `favoritesOnly` filter. Imports point at
  `../services/map/*`.

## What lives in BuhoGO, NOT here

The UI (map view, bottom sheet, list, detail, filters) is **not** a straight
port — it was rebuilt for BuhoGO's bottom-sheet UX, theme tokens, i18n, and
Capacitor handoffs. See `src/pages/MapPage.vue` and `src/components/map/`.

## Re-sync checklist

When pulling upstream data-layer improvements:
1. Diff upstream `src/services/*.js` against these files.
2. Re-apply the BuhoGO-local changes listed above.
3. Keep import paths pointing at `../services/map/`.
4. Rebuild + smoke the map.
