/**
 * Arkade (Ark L2) key material — the single source of truth for turning a
 * BIP-39 recovery phrase into the SDK identity BuhoGO signs Arkade
 * transactions with.
 *
 * The derivation MUST match the official Arkade wallet so a phrase backed up
 * in BuhoGO restores everywhere (and a phrase from the official wallet
 * restores here). Getting this wrong silently produces a *valid but empty*
 * wallet on a different key — i.e. funds the user can't see. So we mirror the
 * reference implementation byte-for-byte rather than inventing a path.
 *
 * Canonical derivation — from arkade-os/wallet `src/lib/mnemonic.ts` and the
 * SDK's `MnemonicIdentity.fromMnemonic` (added in SDK >= 0.4):
 *
 *   seed   = mnemonicToSeedSync(phrase)                  // BIP-39, no passphrase
 *   master = HDKey.fromMasterSeed(seed)                  // BIP-32
 *   node   = master.derive(`m/86'/${coinType}'/0'`)      // BIP-86 (Taproot) account 0
 *               .deriveChild(0)                           //   external chain
 *               .deriveChild(0)                           //   address index 0
 *   identity = SingleKey.fromPrivateKey(node.privateKey)  // raw 32-byte key
 *
 * `coinType` is 0 on mainnet (BIP-44 "Bitcoin") and 1 otherwise, exactly the
 * reference wallet's `isMainnet ? 0 : 1`. Ark is Taproot-based, hence BIP-86.
 *
 * The installed SDK (0.3.x) exposes only `SingleKey` (raw key); 0.4+ adds
 * `MnemonicIdentity.fromMnemonic` which wraps this same path. Keeping the
 * derivation here means a future SDK bump is a drop-in swap with identical
 * keys — no migration, no re-derivation, no lost funds.
 *
 * Mirrors the BIP-32 derivation style already used by `identityCrypto.js`
 * (the Nostr identity), so the two seed-derived key paths read alike.
 */

import {
  mnemonicToSeedSync,
  generateMnemonic as bip39GenerateMnemonic,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { SingleKey } from '@arkade-os/sdk';

/**
 * Mainnet Ark server (Arkade OS). Mainnet has been the SDK default since
 * v0.4.8; we pin it explicitly so the build is unambiguous. Stored per-wallet
 * in `connectionData.arkServerUrl` so a future testnet/self-hosted build can
 * override it without touching this constant.
 */
export const ARKADE_MAINNET_SERVER = 'https://arkade.computer';

/**
 * Mainnet Boltz endpoint for Arkade Lightning swaps. We pin the GENERIC Boltz
 * `https://api.boltz.exchange` (also boltz-swap@0.3.38's own default).
 *
 * The Arkade docs point at the dedicated `https://api.ark.boltz.exchange`, but
 * verified empirically (2026-06-10): that host's swap WebSocket
 * `wss://api.ark.boltz.exchange/v2/ws` NEVER opens (times out every attempt),
 * so the SwapManager can't track settlement and every Lightning swap stalls —
 * which is the WS-reconnect storm + "Load failed" seen on-device. The generic
 * host serves the SAME mainnet ARK<->BTC pairs (identical limits, same
 * reverse-swap hash, even a lower submarine fee), full CORS, AND a working WS.
 * Pinned explicitly so a future package-default change can't silently move us
 * back to the broken host. (Re-verify if Arkade fixes api.ark's WS.)
 */
export const ARKADE_BOLTZ_API_URL = 'https://api.boltz.exchange';

/**
 * SDK `NetworkName` for the Ark server BuhoGO ships with. `'bitcoin'` is
 * mainnet. Kept as a constant so flipping to a testnet build is a one-line
 * change. Address HRP follows the server's network: `ark1…` (bitcoin) vs
 * `tark1…` (testnet/regtest).
 */
export const ARKADE_DEFAULT_NETWORK = 'bitcoin';

/** True when the given SDK `NetworkName` is Bitcoin mainnet. */
export function isMainnetNetwork(network) {
  return (network || ARKADE_DEFAULT_NETWORK) === 'bitcoin';
}

/**
 * Generate a fresh 12-word BIP-39 recovery phrase (128 bits of entropy).
 * 12 words matches the rest of BuhoGO (Spark, the restore grid's 12 slots).
 */
export function generateArkadeMnemonic() {
  // @scure/bip39 `generateMnemonic(wordlist, strength = 128)` → 12 words.
  return bip39GenerateMnemonic(wordlist);
}

/**
 * True if the phrase is a valid BIP-39 English mnemonic (word list + checksum).
 * @param {unknown} mnemonic
 * @returns {boolean}
 */
export function isValidArkadeMnemonic(mnemonic) {
  if (typeof mnemonic !== 'string') return false;
  try {
    return validateMnemonic(mnemonic.trim().toLowerCase(), wordlist);
  } catch {
    return false;
  }
}

/**
 * Derive the raw 32-byte Arkade signing key from a recovery phrase.
 * @param {string} mnemonic
 * @param {{ isMainnet?: boolean }} [opts]
 * @returns {Uint8Array} 32-byte private key
 */
export function deriveArkadePrivateKey(mnemonic, { isMainnet = true } = {}) {
  const phrase = (mnemonic || '').trim().toLowerCase();
  if (!validateMnemonic(phrase, wordlist)) {
    throw new Error('Invalid recovery phrase');
  }
  const seed = mnemonicToSeedSync(phrase);
  const master = HDKey.fromMasterSeed(seed);
  const coinType = isMainnet ? 0 : 1;
  const node = master
    .derive(`m/86'/${coinType}'/0'`)
    .deriveChild(0)
    .deriveChild(0);
  if (!node.privateKey) {
    throw new Error('Key derivation produced no private key');
  }
  return node.privateKey;
}

/**
 * Build the Arkade SDK identity (`SingleKey`) from a recovery phrase.
 * @param {string} mnemonic
 * @param {{ isMainnet?: boolean }} [opts]
 * @returns {import('@arkade-os/sdk').SingleKey}
 */
export function arkadeIdentityFromMnemonic(mnemonic, opts) {
  return SingleKey.fromPrivateKey(deriveArkadePrivateKey(mnemonic, opts));
}
