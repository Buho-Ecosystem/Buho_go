/**
 * A wallet's own Lightning address: the one place that reads it, so Receive,
 * Settings, the profile's Get paid sheet and the refund row agree.
 *
 * The check is the one Receive and Settings always used: `name@domain.tld`,
 * nothing more, so an address with an international domain still shows.
 * Whatever is shared with a service is checked again, strictly, where it is
 * shared (utils/lud18.payerIdentifier).
 *
 * Pure: the caller passes the wallet and the store's live wallet info.
 */

/** The address as written, trimmed, when it reads as one. */
function address(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  const parts = text.split('@')
  const looksRight = parts.length === 2 && parts[0].length > 0 && parts[1].includes('.')
    && !text.includes('://') && !/\s/.test(text)
  return looksRight ? text : null
}

/** The `lud16` parameter of an NWC connection string. */
function lud16FromConnection(nwcUrl) {
  if (typeof nwcUrl !== 'string' || !nwcUrl) return null
  try {
    const parsed = new URL(nwcUrl.replace('nostr+walletconnect://', 'http://'))
    return address(parsed.searchParams.get('lud16'))
  } catch {
    return null
  }
}

/**
 * Where it is read from:
 *   - Spark: the live wallet info first, the persisted metadata copy while
 *     the wallet is locked or not connected yet.
 *   - Every other wallet: `metadata.lud16`, the slot every setup writes (an
 *     NWC connection's lud16, an LNbits pay link). An older version could
 *     save it with the connection string glued on; the address is cut back
 *     out of that.
 *   - An NWC wallet added before the address was kept: the `lud16`
 *     parameter of its connection string.
 *
 * @param {object|null|undefined} wallet
 * @param {object} [walletInfos]  the store's live wallet info, by wallet id
 * @returns {string|null} a `name@domain` address, or null
 */
export function walletLightningAddress(wallet, walletInfos = {}) {
  if (!wallet || typeof wallet !== 'object') return null
  if (wallet.type === 'spark') {
    return address(walletInfos?.[wallet.id]?.lightningAddress) || address(wallet.metadata?.lud16)
  }
  const stored = wallet.metadata?.lud16
  const fromMetadata = address(stored)
    || (typeof stored === 'string' && stored.includes('@') ? address(stored.split(/nostr[+\s]/)[0]) : null)
  return fromMetadata || lud16FromConnection(wallet.nwcUrl || wallet.connectionData?.nwcUrl)
}
