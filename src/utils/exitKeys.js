/**
 * On-chain keys for the emergency exit, derived from the Spark wallet's own
 * recovery words on the standard BIP-84 path (native SegWit). Any ordinary
 * Bitcoin wallet that restores the same words finds this money without
 * BuhoGO, which is the whole point of an exit.
 *
 * Each Spark wallet (one Breez account under the shared words) owns two
 * addresses, both on the receive chain so a standard gap-limit scan
 * discovers them:
 *   - destination  where the final sweep pays out
 *   - fee money    where the person sends the small on-chain amount that
 *                  pays the exit's mining fees; its key signs the
 *                  fee-paying child transactions (CPFP)
 *
 * Per account, so two wallets exiting at once never mistake each other's
 * fee money or fan-out outputs for their own:
 *   account 1      m/84'/{coin}'/0'/0/0  and  /0/1   (unchanged since launch)
 *   account n>=2   /0/(2n-2)             and  /0/(2n-1)
 *   account 0      /0/10                 and  /0/11
 * All twelve indices sit well inside the usual gap limit of 20.
 *
 * The private key leaves this module only for the fee money, and only at
 * signing time. Nothing here is logged or persisted.
 */

import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { bech32, bech32m } from 'bech32';
import { SPARK_ACCOUNT_ORDER, isSparkAccountNumber } from './sparkAccounts.js';

const NETWORKS = Object.freeze({
  mainnet: { coinType: 0, hrp: 'bc', p2pkh: 0x00, p2sh: 0x05 },
  regtest: { coinType: 1, hrp: 'bcrt', p2pkh: 0x6f, p2sh: 0xc4 },
});

/** Account 0 came last to the slot table, so its pair sits after account 5's. */
const ACCOUNT_ZERO_INDICES = Object.freeze({ destination: 10, funding: 11 });

function networkParams(network) {
  const params = NETWORKS[network];
  if (!params) throw new Error(`Unsupported network: ${network}`);
  return params;
}

/** The receive-chain indices one Spark account's exit uses. */
export function exitKeyIndices(accountNumber) {
  if (!isSparkAccountNumber(accountNumber)) throw new Error(`Unsupported Spark account: ${accountNumber}`);
  if (accountNumber === 0) return ACCOUNT_ZERO_INDICES;
  return Object.freeze({ destination: 2 * accountNumber - 2, funding: 2 * accountNumber - 1 });
}

export function exitKeyPath(network, index) {
  return `m/84'/${networkParams(network).coinType}'/0'/0/${index}`;
}

/** Both paths of one account's exit, no key material. */
export function exitKeyPaths(network, accountNumber) {
  const indices = exitKeyIndices(accountNumber);
  return { destination: exitKeyPath(network, indices.destination), funding: exitKeyPath(network, indices.funding) };
}

/**
 * Every fee money path the app can ever have handed out on a network. A
 * stored path outside this set never reaches the deriver, so a damaged or
 * edited ledger cannot make signing use some other key under the words.
 */
function knownFundingPaths(network) {
  return new Set(SPARK_ACCOUNT_ORDER.map(account => exitKeyPaths(network, account).funding));
}

function hash160(bytes) {
  return ripemd160(sha256(bytes));
}

/** Native SegWit v0 address for a compressed public key. */
export function p2wpkhAddress(publicKey, network = 'mainnet') {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 33) {
    throw new Error('Expected a 33-byte compressed public key');
  }
  const { hrp } = networkParams(network);
  return bech32.encode(hrp, [0, ...bech32.toWords(hash160(publicKey))]);
}

function deriveNode(root, path) {
  const node = root.derive(path);
  if (!node.publicKey || !node.privateKey) throw new Error('Key derivation failed');
  return node;
}

/** One account's two exit addresses, no private material. */
export function deriveExitAddresses(mnemonic, { network = 'mainnet', accountNumber } = {}) {
  const paths = exitKeyPaths(network, accountNumber);
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic));
  const destination = deriveNode(root, paths.destination);
  const funding = deriveNode(root, paths.funding);
  return {
    destination: { address: p2wpkhAddress(destination.publicKey, network), path: paths.destination },
    funding: {
      address: p2wpkhAddress(funding.publicKey, network),
      path: paths.funding,
      publicKeyHex: bytesToHex(funding.publicKey),
    },
  };
}

/**
 * The fee money address of every account under the words. An exit must never
 * pay into one of these: the sweep would land on money another exit counts
 * as its own fee money.
 */
export function deriveAllFundingAddresses(mnemonic, { network = 'mainnet' } = {}) {
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic));
  return SPARK_ACCOUNT_ORDER.map(account => p2wpkhAddress(deriveNode(root, exitKeyPaths(network, account).funding).publicKey, network));
}

/**
 * The fee money key at the path an exit recorded when it started, for the
 * SDK's single-key CPFP signer. Signing from the recorded path, not today's
 * mapping, lets an exit begun under an older layout finish on its own key.
 * Call at signing time only.
 */
export function deriveFundingKey(mnemonic, { network = 'mainnet', path } = {}) {
  if (!knownFundingPaths(network).has(path)) throw new Error('Unknown fee money path');
  const node = deriveNode(HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)), path);
  return {
    path,
    address: p2wpkhAddress(node.publicKey, network),
    publicKeyHex: bytesToHex(node.publicKey),
    privateKey: node.privateKey,
  };
}

// ---- Address validation ----------------------------------------------------

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58checkDecode(text) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{25,35}$/.test(text)) return null;
  let value = 0n;
  for (const char of text) value = value * 58n + BigInt(BASE58.indexOf(char));
  const bytes = [];
  while (value > 0n) { bytes.unshift(Number(value & 0xffn)); value >>= 8n; }
  for (const char of text) { if (char !== '1') break; bytes.unshift(0); }
  if (bytes.length !== 25) return null;
  const payload = Uint8Array.from(bytes.slice(0, 21));
  const checksum = sha256(sha256(payload)).slice(0, 4);
  if (!checksum.every((b, i) => b === bytes[21 + i])) return null;
  return { version: payload[0], hash: payload.slice(1) };
}

function segwitDecode(text) {
  const lower = text.toLowerCase();
  if (text !== lower && text !== text.toUpperCase()) return null;
  for (const [codec, allowedVersions] of [[bech32, [0]], [bech32m, null]]) {
    try {
      const { prefix, words } = codec.decode(lower, 90);
      const version = words[0];
      if (allowedVersions ? !allowedVersions.includes(version) : version === 0) continue;
      const program = bech32.fromWords(words.slice(1));
      if (version === 0 && program.length !== 20 && program.length !== 32) return null;
      if (version === 1 && program.length !== 32) return null;
      if (program.length < 2 || program.length > 40) return null;
      return { prefix, version, program, address: lower };
    } catch { /* try the other checksum */ }
  }
  return null;
}

/**
 * Recognise a plain Bitcoin address. Returns `{ address, type, network }` or
 * null. Lightning invoices, Spark addresses and Lightning addresses are never
 * recognised: they are not places an on-chain sweep can pay.
 */
export function parseBitcoinAddress(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const segwit = segwitDecode(text);
  if (segwit) {
    const network = Object.keys(NETWORKS).find(name => NETWORKS[name].hrp === segwit.prefix);
    if (!network) return null;
    const type = segwit.version === 0
      ? (segwit.program.length === 20 ? 'p2wpkh' : 'p2wsh')
      : (segwit.version === 1 ? 'p2tr' : 'segwit');
    return { address: segwit.address, type, network };
  }
  const legacy = base58checkDecode(text);
  if (legacy) {
    for (const [network, params] of Object.entries(NETWORKS)) {
      if (legacy.version === params.p2pkh) return { address: text, type: 'p2pkh', network };
      if (legacy.version === params.p2sh) return { address: text, type: 'p2sh', network };
    }
  }
  return null;
}

/**
 * Decide whether an address may receive the exit. `excluded` carries Spark
 * deposit addresses: paying those would send the money straight back into
 * Spark. `feeAddresses` carries every exit's fee money address: the sweep
 * would be counted, and maybe spent, as fee money by another exit.
 */
export function classifyDestination(input, { network = 'mainnet', excluded = [], feeAddresses = [] } = {}) {
  const parsed = parseBitcoinAddress(input);
  if (!parsed) return { ok: false, reason: 'not_onchain' };
  if (parsed.network !== network) return { ok: false, reason: 'wrong_network' };
  const matches = candidate => String(candidate).toLowerCase() === parsed.address.toLowerCase();
  if (excluded.some(matches)) return { ok: false, reason: 'spark_deposit' };
  if (feeAddresses.some(matches)) return { ok: false, reason: 'exit_funding' };
  return { ok: true, address: parsed.address, type: parsed.type };
}
