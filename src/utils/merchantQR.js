/**
 * South African Retailer QR Code Detection & Conversion
 *
 * Detects QR codes from SA retail POS systems (MoneyBadger/CryptoQR network)
 * and converts EMVCo QR data to Lightning addresses for payment.
 *
 * Phase 1: "PnP Path" - Convert EMVCo QR codes to lightning addresses via cryptoqr.net
 * Phase 2: Full MoneyBadger Scanner API integration (future)
 *
 * Supported retailers: Pick n Pay, Checkers, Shoprite, Woolworths (Ecentric),
 * Zapper, SnapScan, ScanToPay, and direct MoneyBadger/CryptoQR codes.
 */

export const SA_RETAIL_SOURCE = 'sa_retail';

const CRYPTOQR_DOMAIN = 'cryptoqr.net';

/** Longer than any till code. */
const MAX_QR_LENGTH = 2048;

/**
 * Merchant configurations with detection patterns, display info, and logo paths.
 *
 * Patterns run on whatever a camera reads: repeats are never nested, and text
 * past MAX_QR_LENGTH never reaches them.
 *
 * `emvco: true` means the QR contains EMVCo MPM data that can be converted
 * to a lightning address directly (Phase 1 - PnP Path).
 *
 * `emvco: false` means the QR is URL-based and requires the MoneyBadger
 * Scanner API for processing (Phase 2).
 */
const merchants = [
  {
    id: 'picknpay',
    displayName: 'Pick n Pay',
    logo: '/sa_retailers/picknpay.png',
    pattern: /za\.co\.electrum\.picknpay/i,
    emvco: true,
  },
  {
    id: 'ecentric',
    displayName: 'Ecentric Retailer',
    logo: '/sa_retailers/woolworths.png',
    pattern: /za\.co\.ecentric/i,
    emvco: true,
  },
  {
    id: 'checkers_shoprite',
    displayName: 'Checkers / Shoprite',
    logo: '/sa_retailers/checkers.png',
    pattern: /za\.co\.electrum/i,
    emvco: true,
  },
  {
    id: 'snapscan',
    displayName: 'SnapScan',
    logo: '/sa_retailers/snapscan.png',
    pattern: /snapscan/i,
    emvco: false,
  },
  {
    id: 'yoyo',
    displayName: 'Yoyo',
    logo: '/sa_retailers/moneybadger.png',
    pattern: /wigroup\.co|yoyogroup\.co/i,
    emvco: false,
  },
  {
    id: 'zapper',
    displayName: 'Zapper',
    logo: '/sa_retailers/zapper.png',
    pattern: /^(?:.*(?:zapper\.com|\.wigroup\.|payat\.io|paynow\.(?:netcash|sagepay)\.co\.za|transactionjunction\.co\.za).*|.{2}\/.{4}\/.{20}|SK-\d+-\d{23}|\d{20}|CRSTPC-\d+-\d+-\d+-\d+-\d+)$|^.*\d\.zap\.pe/i,
    emvco: false,
  },
  {
    id: 'scantopay',
    displayName: 'Scan to Pay',
    logo: '/sa_retailers/scantopay.png',
    pattern: /scantopay\.io|^\d{10}$|payat\.io|UMPQR|\.oltio\.co\.za|easypay/i,
    emvco: false,
  },
  {
    id: 'moneybadger',
    displayName: 'MoneyBadger',
    logo: '/sa_retailers/moneybadger.png',
    pattern: /cryptoqr\.net/i,
    emvco: false,
  },
];

/** The text to match, or null when it cannot be a till code. */
function tillCode(data) {
  if (typeof data !== 'string') return null;
  const code = data.trim();
  return code && code.length <= MAX_QR_LENGTH ? code : null;
}

/**
 * Check if scanned QR data matches any known SA retailer pattern.
 * Trims leading/trailing spaces before matching (per MoneyBadger docs).
 *
 * @param {string} data - Raw QR code content
 * @returns {boolean}
 */
export function isSARetailerQR(data) {
  return getMerchantInfo(data) !== null;
}

/**
 * Get the matched merchant config for a QR code.
 *
 * Note: Order matters - PnP and Ecentric are checked before the generic
 * Checkers/Shoprite (za.co.electrum) pattern to avoid false matches.
 *
 * @param {string} data - Raw QR code content
 * @returns {object|null} Merchant config or null if no match
 */
export function getMerchantInfo(data) {
  const code = tillCode(data);
  if (!code) return null;
  for (const merchant of merchants) {
    if (merchant.pattern.test(code)) {
      return {
        id: merchant.id,
        displayName: merchant.displayName,
        logo: merchant.logo,
        emvco: merchant.emvco,
      };
    }
  }
  return null;
}

/**
 * Convert an EMVCo merchant QR code to a Lightning address via cryptoqr.net.
 *
 * For EMVCo QR codes (PnP, Ecentric, Checkers/Shoprite), the full QR payload
 * is URL-encoded and used as the local part of a lightning address:
 *   `${encodeURIComponent(qrPayload)}@cryptoqr.net`
 *
 * The cryptoqr.net LNURL endpoint resolves this to a payment request.
 *
 * For URL-based QR codes (Zapper, SnapScan, etc.), returns null - these
 * require the MoneyBadger Scanner API (Phase 2).
 *
 * @param {string} qrContent - Raw QR code content
 * @returns {{ lightningAddress: string, merchant: object } | null}
 */
export function convertToLightningAddress(qrContent) {
  const merchant = getMerchantInfo(qrContent);

  if (!merchant) return null;

  if (!merchant.emvco) {
    // URL-based QR - needs Scanner API (Phase 2)
    return null;
  }

  const lightningAddress = `${encodeURIComponent(qrContent.trim())}@${CRYPTOQR_DOMAIN}`;

  return {
    lightningAddress,
    merchant,
  };
}

/**
 * Parse ZAR amount from LNURL metadata description.
 *
 * MoneyBadger/CryptoQR returns metadata descriptions like:
 *   "MBadger: cryptoqrtestscan - R1.00"
 *   "MBadger: storename - R125.50"
 *
 * @param {string} description - The text/plain metadata description
 * @returns {string|null} ZAR amount string (e.g. "1.00") or null
 */
export function parseZARFromMetadata(description) {
  if (!description) return null;
  const match = description.match(/R(\d+(?:\.\d{2})?)/);
  return match ? match[1] : null;
}
