/**
 * The wallets "Connect a wallet" offers, as data.
 *
 * Every screen and every pairing step reads this list; none names a wallet.
 * Adding a wallet is one entry here, its logo in public/, and its strings in
 * the three locales (src/utils/__tests__/connectWallets.spec.js checks all
 * of it). A wallet that changes its approval page changes its entry.
 *
 * How a wallet pairs (`pairing`):
 *
 *   approve-and-return  An approval page that takes BuhoGO's public key and
 *                       sends the person back (`return_to`), and announces
 *                       the new connection with an info event on its relays
 *                       (Alby Hub's /apps/new; any Hub that speaks it).
 *   approve-known       An approval page that takes the key but neither
 *                       returns nor announces. The wallet serves every
 *                       connection from one known key and relay, so BuhoGO
 *                       asks until the wallet knows the key.
 *   sheet               Its own setup sheet (`route`).
 *   manual              Paste, scan, or show a code the wallet app approves.
 *
 * `soon: true` shows the wallet apart, as a note (`about`), not a choice.
 * Strings (`subtitle`, `about`, `approval.*Label`, `approval.note`) are i18n
 * keys; `name` is a brand and stays as it is.
 */

export const PAIRING = Object.freeze({
  APPROVE_AND_RETURN: 'approve-and-return',
  APPROVE_KNOWN: 'approve-known',
  SHEET: 'sheet',
  MANUAL: 'manual',
});

/**
 * Relays a wallet-auth code asks to be answered on. Wallets that create
 * connections on an Alby Hub (Alby Go) answer on the Hub's relays, whatever
 * the code says, so these are Alby Hub's defaults.
 */
export const CODE_RELAYS = Object.freeze(['wss://relay.getalby.com', 'wss://relay2.getalby.com']);

export const CONNECT_WALLETS = Object.freeze([
  {
    id: 'albyhub',
    name: 'Alby Hub',
    logo: '/Social_Wallet_logos/alby-hub.svg',
    subtitle: 'Approve BuhoGO in your Hub',
    pairing: PAIRING.APPROVE_AND_RETURN,
    approval: {
      path: '/apps/new',
      // Its own app store lists BuhoGO under this id: name and logo there.
      appId: 'buhogo',
      locations: [{ id: 'cloud', name: 'Alby Cloud', url: 'https://my.albyhub.com' }],
      selfHosted: true,
      locationLabel: 'Your Hub',
      ownLabel: 'My own Hub',
      ownHint: 'At home or on a server',
      note: 'Your Hub opens so you can approve BuhoGO. Nothing to copy.',
      scanLabel: 'Scan a code from your Hub',
      // Where a Hub announces new connections (unless its owner changed them).
      relays: CODE_RELAYS,
    },
  },
  {
    id: 'coinos',
    name: 'Coinos',
    logo: '/Social_Wallet_logos/coinos.svg',
    subtitle: 'Approve BuhoGO in Coinos',
    pairing: PAIRING.APPROVE_KNOWN,
    // Coinos calls itself after its node ("ln.coinos.io").
    keepName: true,
    approval: {
      url: 'https://coinos.io',
      path: '/apps/new',
      note: 'Coinos opens so you can approve BuhoGO. Sign in if it asks. Nothing to copy.',
      walletPubkey: 'ba80990666ef0b6f4ba5059347beb13242921e54669e680064ca755256a1e3a6',
      relay: 'wss://relay.coinos.io',
    },
  },
  {
    id: 'lnbits',
    name: 'LNbits',
    logo: '/LNBits/lnbits-icon.svg',
    subtitle: 'Server address and key',
    pairing: PAIRING.SHEET,
    route: '/lnbits-setup',
  },
  {
    id: 'other',
    nameKey: 'Another wallet',
    icon: 'tabler:qrcode',
    subtitle: 'Scan, paste or show a code',
    pairing: PAIRING.MANUAL,
  },
  {
    id: 'buhohub',
    name: 'BuhoHub',
    logo: '/buho-mark-512.png',
    soon: true,
    about: 'The home base behind BuhoGO is on its way. Once it opens, you connect it here.',
  },
]);

/** The entry with this id, or null. */
export function connectWallet(id) {
  return CONNECT_WALLETS.find((wallet) => wallet.id === id) || null;
}

/** The choices, in order. */
export function availableWallets() {
  return CONNECT_WALLETS.filter((wallet) => !wallet.soon);
}

/** Wallets on their way, shown apart as notes. */
export function upcomingWallets() {
  return CONNECT_WALLETS.filter((wallet) => wallet.soon);
}

/** True for wallets the person approves on the wallet's own page. */
export function pairsByApproval(wallet) {
  return wallet?.pairing === PAIRING.APPROVE_AND_RETURN || wallet?.pairing === PAIRING.APPROVE_KNOWN;
}
