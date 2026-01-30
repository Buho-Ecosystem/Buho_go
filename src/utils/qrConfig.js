/**
 * QR Code configuration utilities
 * Centralized QR code options for consistent styling across the app
 */

/**
 * Default QR code size
 */
export const QR_SIZE = 240;

/**
 * Default QR code colors
 */
export const QR_COLORS = {
  dark: '#000000',
  light: '#ffffff'
};

/**
 * Get standard QR code options
 * @param {Object} overrides - Optional overrides for default options
 * @returns {Object} QR code options
 */
export function getQrOptions(overrides = {}) {
  return {
    width: QR_SIZE,
    margin: 0,
    color: { ...QR_COLORS },
    ...overrides
  };
}

/**
 * Get QR code options with custom size
 * @param {number} size - QR code width in pixels
 * @returns {Object} QR code options
 */
export function getQrOptionsWithSize(size) {
  return getQrOptions({ width: size });
}

/**
 * Get responsive QR size based on screen width
 * Used for modals and full-screen views
 * @param {number} screenWidth - Current screen width
 * @returns {number} Optimal QR code size
 */
export function getResponsiveQrSize(screenWidth) {
  if (screenWidth <= 320) {
    return Math.min(screenWidth - 80, 200);
  } else if (screenWidth <= 375) {
    return Math.min(screenWidth - 70, 240);
  } else if (screenWidth <= 414) {
    return Math.min(screenWidth - 60, 270);
  }
  return 280;
}

/**
 * Get responsive QR options based on screen width
 * @param {number} screenWidth - Current screen width
 * @returns {Object} QR code options
 */
export function getResponsiveQrOptions(screenWidth) {
  return getQrOptions({ width: getResponsiveQrSize(screenWidth) });
}

/**
 * Format value for QR code with appropriate URI scheme
 * @param {string} value - The raw value
 * @param {string} type - Type of address ('lightning', 'bitcoin', 'spark')
 * @returns {string} Formatted URI
 */
export function formatQrValue(value, type) {
  if (!value) return '';

  switch (type) {
    case 'lightning':
      // Lightning invoices: use lightning: prefix with uppercase for better QR efficiency
      return `lightning:${value.toUpperCase()}`;
    case 'bitcoin':
      // Bitcoin addresses: use bitcoin: URI scheme
      return `bitcoin:${value}`;
    case 'spark':
    default:
      // Spark and other addresses: use as-is
      return value;
  }
}
