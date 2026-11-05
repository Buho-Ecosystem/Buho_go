/**
 * Wallet apps BuhoGO can open with a payment request by their own link, as
 * data.
 *
 * Where the system lists every app that can pay a lightning:/bitcoin: link
 * (android), no list is needed (services/walletApps). Where it cannot (ios),
 * "Pay from another wallet" asks about each wallet here by its own link and
 * lists the ones installed. A wallet opened by a web link instead
 * (`androidPackage`) is looked up by package on android too.
 *
 * Each wallet reads the request in one of these forms:
 *
 *   prefix        <scheme>:<request>                     <scheme>:lightning:lnbc…
 *   slashes       <scheme>://<request>                   <scheme>://lightning:lnbc…
 *   bare          <scheme>:<request minus its scheme>    <scheme>:lnbc…
 *   bare-slashes  <scheme>://<request minus its scheme>  <scheme>://lnbc…
 *   pay-link      <scheme>://pay?request=<URL-encoded>   <scheme>://pay?request=lightning%3Alnbc…
 *   web           <web><request minus its scheme>        https://<host>/<path>/lnbc…
 *
 * The pay-link form is the one BuhoGO itself answers to (utils/paymentLink.js).
 * A web link proves nothing about what is installed, so such a wallet names
 * the schemes that reveal it (`detect`) and opens only into the app, never
 * the browser.
 *
 * `pays` names the requests a wallet takes: 'lightning' (an invoice) and
 * 'bitcoin' (a BIP 321 request). A wallet is listed only for what it pays.
 * Where each form and each `pays` comes from, wallet by wallet:
 * docs/PAY_FROM_ANOTHER_WALLET.md.
 *
 * Adding a wallet: one entry here, its schemes (QUERIED_SCHEMES) in
 * Info.plist's LSApplicationQueriesSchemes, its logo in public/wallet-apps/,
 * and a web wallet's package in the Android manifest's <queries>. The spec
 * (__tests__/walletAppLinks.spec.js) checks them, and keeps the schemes
 * within the system's limit (MAX_QUERIED_SCHEMES; source in the doc).
 */

import { payLink } from './paymentLink.js';

export const LINK_FORM = Object.freeze({
  PREFIX: 'prefix',
  SLASHES: 'slashes',
  BARE: 'bare',
  BARE_SLASHES: 'bare-slashes',
  PAY_LINK: 'pay-link',
  WEB: 'web',
});

const LIGHTNING = 'lightning';
const BITCOIN = 'bitcoin';

const wallet = (id, name, scheme, form, pays, extra = {}) => Object.freeze({
  id, name, scheme, form, pays: Object.freeze(pays), logo: `/wallet-apps/${id}.png`, ...extra,
});

export const WALLET_APP_LINKS = Object.freeze([
  wallet('alby-go', 'Alby Go', 'alby', LINK_FORM.PREFIX, [LIGHTNING]),
  wallet('aqua', 'AQUA', 'aqua', LINK_FORM.PREFIX, [LIGHTNING, BITCOIN]),
  wallet('bitkit', 'Bitkit', 'bitkit', LINK_FORM.SLASHES, [LIGHTNING, BITCOIN]),
  wallet('blink', 'Blink', 'blink', LINK_FORM.BARE, [LIGHTNING]),
  wallet('blitz', 'Blitz Wallet', 'blitz', LINK_FORM.PREFIX, [LIGHTNING, BITCOIN]),
  wallet('blixt', 'Blixt', 'blixtwallet', LINK_FORM.PREFIX, [LIGHTNING]),
  wallet('bluewallet', 'BlueWallet', 'bluewallet', LINK_FORM.PREFIX, [LIGHTNING, BITCOIN]),
  wallet('cake-wallet', 'Cake Wallet', 'cakewallet', LINK_FORM.BARE, [LIGHTNING, BITCOIN]),
  wallet('cash-app', 'Cash App', null, LINK_FORM.WEB, [LIGHTNING], {
    web: 'https://cash.app/launch/lightning/',
    detect: Object.freeze(['squarecash', 'cashme']),
    androidPackage: 'com.squareup.cash',
  }),
  wallet('coinsnap', 'Coinsnap', 'coinsnap', LINK_FORM.PAY_LINK, [LIGHTNING, BITCOIN]),
  wallet('glow', 'Glow', 'glow', LINK_FORM.PREFIX, [LIGHTNING]),
  wallet('manna', 'Manna', 'manna', LINK_FORM.PREFIX, [LIGHTNING, BITCOIN]),
  wallet('muun', 'Muun', 'muun', LINK_FORM.BARE, [LIGHTNING, BITCOIN]),
  wallet('phoenix', 'Phoenix', 'phoenix', LINK_FORM.PREFIX, [LIGHTNING]),
  wallet('river', 'River', 'river', LINK_FORM.BARE_SLASHES, [LIGHTNING]),
  wallet('strike', 'Strike', 'strike', LINK_FORM.PREFIX, [LIGHTNING, BITCOIN]),
  wallet('wallet-of-satoshi', 'Wallet of Satoshi', 'walletofsatoshi', LINK_FORM.PREFIX, [LIGHTNING, BITCOIN]),
  wallet('zbd', 'ZBD', 'zebedee', LINK_FORM.PREFIX, [LIGHTNING]),
  wallet('zeus', 'ZEUS', 'zeusln', LINK_FORM.PREFIX, [LIGHTNING, BITCOIN]),
]);

/** How many schemes an app may ask the system about (Info.plist). */
export const MAX_QUERIED_SCHEMES = 25;

/** Every scheme the system is asked about: Info.plist's LSApplicationQueriesSchemes. */
export const QUERIED_SCHEMES = Object.freeze(WALLET_APP_LINKS.flatMap((entry) => entry.detect ?? [entry.scheme]));

/** What a request asks to be paid with: 'lightning', 'bitcoin', or null. */
export function requestKind(request) {
  const scheme = String(request ?? '').trim().split(':', 1)[0].toLowerCase();
  return scheme === LIGHTNING || scheme === BITCOIN ? scheme : null;
}

/** The link that opens `wallet` with `request` (a lightning:… or bitcoin:… link). */
export function walletAppLink(wallet, request) {
  const value = String(request).trim();
  const bare = value.replace(/^(lightning|bitcoin):/i, '');
  switch (wallet.form) {
    case LINK_FORM.PREFIX: return `${wallet.scheme}:${value}`;
    case LINK_FORM.SLASHES: return `${wallet.scheme}://${value}`;
    case LINK_FORM.BARE: return `${wallet.scheme}:${bare}`;
    case LINK_FORM.BARE_SLASHES: return `${wallet.scheme}://${bare}`;
    case LINK_FORM.PAY_LINK: return payLink(wallet.scheme, value);
    case LINK_FORM.WEB: return `${wallet.web}${bare}`;
    default: throw new Error(`Unknown link form: ${wallet.form}`);
  }
}

/** The links whose answer tells whether `wallet` is installed. */
export function detectionLinks(wallet, request) {
  return wallet.detect ? wallet.detect.map((scheme) => `${scheme}://`) : [walletAppLink(wallet, request)];
}
