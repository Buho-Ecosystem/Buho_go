/**
 * Recognize the consumer wallet that hosts a Lightning Address by its domain
 * and resolve it to a display name + logo, so the send sheet can show the
 * wallet's real identity (logo + username) instead of a generic, technical
 * "LNURL payment" placeholder.
 *
 * Backfall only: this layer is consulted *after* a saved contact and a
 * verified merchant, and *before* the raw/generic fallback. A contact the user
 * named themselves, or a payout service (Tando/Bitzed, see lnAddressServices),
 * always wins. Pure and synchronous — it only inspects a domain string, never
 * touches the network, and returns null for any unknown domain.
 *
 * The domain is the source of truth: it comes straight from the part after the
 * "@" of a Lightning Address (feudaltribe162@walletofsatoshi.com -> Wallet of
 * Satoshi). The caller derives that domain — directly for a typed address, or
 * by decoding a raw LNURL to its .well-known/lnurlp/<handle> endpoint.
 *
 * Logos live under /public and are served at the app root, so they're plain
 * absolute URL strings (no bundler import) — matching how /buho_logo.svg is
 * referenced elsewhere. This resolves identically in web, PWA and the
 * Capacitor build.
 *
 * Ecash wallets (Minibits, npub.cash, …) intentionally share the single Cashu
 * logo: to a sender they all read as one "ecash" family rather than distinct
 * brands.
 *
 * Adding a wallet: drop a SQUARE logo under /public/Social_Wallet_logos and add
 * one row to WALLET_BRANDS keyed by its Lightning Address domain (lowercase).
 * The avatar renders it object-fit:cover in a circle, which only works for art
 * that carries its own full-bleed background plate (an app icon): the crop then
 * removes background, never artwork. Two kinds of art need the other treatment,
 * `logoContain: true`, which fits the whole mark inside the circle instead:
 *
 *   - a wordmark (ZBD) — cropping it edge-to-edge leaves unreadable letters;
 *     pair it with `logoBg: '#hex'` (its dark brand backdrop) if it's white.
 *   - a plate-less logomark that runs to the edge of its own canvas (Alby,
 *     Wallet of Satoshi) — the circle would slice the mark itself.
 *
 * Contained art defaults to a conservative inset that keeps even a full-bleed
 * square inside the circle. When a mark's silhouette is known to stay clear of
 * its canvas corners it can sit larger: `logoInset: '<css length>'` overrides
 * that padding, so the brand reads at avatar scale instead of floating small.
 */

const SOCIAL = '/Social_Wallet_logos'
const CASHU_LOGO = '/cashu/cashuu.png'

// domain (lowercased) -> { name, logo }. Frozen so the table is read-only.
export const WALLET_BRANDS = Object.freeze({
  // Outlined gold frame around the bolt, drawn flush to its viewBox: cropped
  // edge-to-edge the frame loses all four corners and reads as stray arcs.
  // Contained, the rounded square clears the circle at an 11% inset.
  'walletofsatoshi.com': { name: 'Wallet of Satoshi', logo: `${SOCIAL}/walletofsatoshi-icon.svg`, logoContain: true, logoInset: '11%' },
  'phoenixwallet.me':    { name: 'Phoenix',           logo: `${SOCIAL}/phoenix.png` },
  'blink.sv':            { name: 'Blink',             logo: `${SOCIAL}/blink.svg` },
  // Bare mark on transparency (3% canvas margin): the ring sits tangent to the
  // avatar rim and the lower-left tail is cut off. Its tail reaches into the
  // canvas corner, so it needs a slightly deeper inset than the frame above.
  'getalby.com':         { name: 'Alby',              logo: `${SOCIAL}/alby-go.png`, logoContain: true, logoInset: '14%' },
  'primal.net':          { name: 'Primal',            logo: `${SOCIAL}/primal.png` },
  // ZBD ships a white wordmark (no square glyph), so it needs its dark brand
  // backdrop + contain to read inside the circular avatar instead of being
  // cropped / washed out on white.
  'zbd.gg':              { name: 'ZBD',               logo: `${SOCIAL}/zbd.png`, logoBg: '#1B1A2E', logoContain: true },
  'fountain.fm':         { name: 'Fountain',          logo: `${SOCIAL}/fountain.png` },
  'wavlake.com':         { name: 'Wavlake',           logo: `${SOCIAL}/wavlake.png` },
  'wave.space':          { name: 'Wavespace',         logo: `${SOCIAL}/wavespace.png` },
  'yakihonne.com':       { name: 'YakiHonne',         logo: `${SOCIAL}/yakihonne.png` },
  'zap.stream':          { name: 'zap.stream',        logo: `${SOCIAL}/zapstream.png` },
  'damus.io':            { name: 'Damus',             logo: `${SOCIAL}/damus.png` },
  'blitzwalletapp.com':  { name: 'Blitz Wallet',      logo: `${SOCIAL}/BlitzWalet.png` },
  'strike.me':           { name: 'Strike',            logo: `${SOCIAL}/strike.png` }, // Strike's standard domain
  'strik.me':            { name: 'Strike',            logo: `${SOCIAL}/strike.png` }, // short variant seen in the wild
  // Bare logomark on transparency, taller than wide (66x85 viewBox, no
  // background plate): cropped edge-to-edge the circle takes the top and bottom
  // off the mark itself. Its silhouette clears the circle from 7% inward, so a
  // 10% inset keeps a margin and still reads at avatar size.
  'coinsnap.app':        { name: 'Coinsnap',          logo: `${SOCIAL}/coinsnap.svg`, logoContain: true, logoInset: '10%' },

  // LNbits — flagship instances. Self-hosted instances live on their own
  // domains and stay unbranded (there's no way to know them here); add any
  // community instance you want recognized as its own row.
  'lnbits.com':          { name: 'LNbits',            logo: '/LNBits/lnbits-icon.svg' },
  // The German instances run the "Business Bitcoin" brand (its own B logo).
  'lnbits.de':           { name: 'Business Bitcoin',  logo: `${SOCIAL}/BusinessBitcoin.png` },
  'timecatcher.lnbits.de': { name: 'Business Bitcoin', logo: `${SOCIAL}/BusinessBitcoin.png` },

  // Buho itself — our own hosted Lightning addresses across the brand domains.
  'mybuho.de':           { name: 'Buho',              logo: '/buho_logo_grey.svg' },
  'pay.mybuho.de':       { name: 'Buho',              logo: '/buho_logo_grey.svg' },
  'btc.mybuho.de':       { name: 'Buho',              logo: '/buho_logo_grey.svg' },

  // Ecash family — every hosted Cashu-Address provider shares the one Cashu
  // logo + name. These are the domains that actually *host* Lightning
  // Addresses; pure client wallets (eNuts, Macadamia, cashu.me, …) issue no
  // fixed @domain — they receive ecash through one of these — so there's
  // nothing to key on for them.
  'npub.cash':           { name: 'Cashu',             logo: CASHU_LOGO }, // flagship (Cashu-Address ref impl)
  'minibits.cash':       { name: 'Cashu',             logo: CASHU_LOGO }, // Minibits wallet
  'sats.contact':        { name: 'Cashu',             logo: CASHU_LOGO }, // SatsContact (Telegram delivery)
  'nutstash.app':        { name: 'Cashu',             logo: CASHU_LOGO }, // Nutstash web wallet

  // ── Pending a known Lightning Address domain ───────────────────────────
  // We have the logos below but no fixed address domain to key on yet (these
  // are Nostr clients / self-hosted servers). Drop in the real domain when we
  // learn it and the row goes live — no other change needed.
  //
  //   <amethyst domain?>  { name: 'Amethyst',  logo: `${SOCIAL}/amethyst.png` },
  //   <nostrudel domain?> { name: 'noStrudel', logo: `${SOCIAL}/nostrudel.png` },
  //   <btcpay domain?>    { name: 'BTCPay',    logo: `${SOCIAL}/btcpay.png` },
  //   <zapple domain?>    { name: 'Zapple Pay',logo: `${SOCIAL}/zapple-pay.png` },
})

/**
 * @param {string} domain  the part after "@" of a Lightning Address
 * @returns {{ name: string, logo: string } | null} brand entry, or null on miss
 */
export function matchWalletBrand(domain) {
  if (typeof domain !== 'string') return null
  return WALLET_BRANDS[domain.trim().toLowerCase()] || null
}

/**
 * The same lookup keyed by a whole Lightning Address instead of a bare domain.
 *
 * Mirrors `matchLnAddressService(address)` so a caller holding an address can
 * ask both registries the same way, and the "@" split lives in one place
 * rather than at every call site.
 *
 * @param {string} lightningAddress e.g. "satoshi@coinsnap.app"
 * @returns {{ name: string, logo: string } | null}
 */
export function matchWalletBrandByAddress(lightningAddress) {
  if (typeof lightningAddress !== 'string') return null
  const trimmed = lightningAddress.trim()
  const at = trimmed.lastIndexOf('@')
  // Require a non-empty handle and domain ("a@b" at minimum).
  if (at < 1 || at === trimmed.length - 1) return null
  return matchWalletBrand(trimmed.slice(at + 1))
}
