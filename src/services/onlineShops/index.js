/**
 * Online-shops directory service — barrel export.
 *
 * A curated directory of online businesses that accept Bitcoin, merged from
 * BitcoinListings.org + the BTCPay Server Directory (the "Shops" list) plus an
 * opt-in Nostr NIP-15 "markets" facet. Discover a shop, visit it in-app and pay
 * at its checkout, or pay a Lightning address directly with BuhoGO.
 */

export {
  SHOP_CATEGORIES,
  SHOP_CATEGORY_ICONS,
  SHOP_CATEGORY_LABELS,
  SHOP_SOURCE_PRIORITY,
  mapCategory,
  normalizeHost,
  codeToFlag,
  mergeShops,
  sortShops,
} from './shop.js';

export { fetchDirectoryShops, fetchMarketShops } from './aggregator.js';
export { letterAvatar, faviconUrl } from './logo.js';
