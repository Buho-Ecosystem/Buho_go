/**
 * Address utility functions
 * Shared across components for consistent address handling
 */

/**
 * Truncate an address for display
 * Shows first 10 and last 8 characters with ellipsis
 * @param {string} address - The full address
 * @param {number} startChars - Characters to show at start (default: 10)
 * @param {number} endChars - Characters to show at end (default: 8)
 * @returns {string} Truncated address or empty string if invalid
 */
export function truncateAddress(address, startChars = 10, endChars = 8) {
  if (!address) return '';
  const minLength = startChars + endChars + 3; // +3 for "..."
  if (address.length <= minLength) return address;
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Validate if a string looks like a valid Lightning address
 * @param {string} address - The address to validate
 * @returns {boolean}
 */
export function isValidLightningAddress(address) {
  if (!address || typeof address !== 'string') return false;
  // Lightning address format: user@domain.com
  const lightningAddressRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return lightningAddressRegex.test(address);
}

/**
 * Validate if a string looks like a Spark address
 * @param {string} address - The address to validate
 * @returns {boolean}
 */
export function isValidSparkAddress(address) {
  if (!address || typeof address !== 'string') return false;
  // Spark addresses start with 'sp1'
  return address.startsWith('sp1') && address.length > 10;
}

/**
 * Validate if a string looks like a Bitcoin address
 * @param {string} address - The address to validate
 * @returns {boolean}
 */
export function isValidBitcoinAddress(address) {
  if (!address || typeof address !== 'string') return false;
  // Basic validation for common Bitcoin address formats
  // P2PKH (starts with 1), P2SH (starts with 3), Bech32 (starts with bc1)
  const btcAddressRegex = /^(1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{39,59})$/;
  return btcAddressRegex.test(address);
}
