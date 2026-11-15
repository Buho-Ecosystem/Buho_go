/**
 * The pipeline a contact payment runs through: the wallet page in its
 * payment-only mode (see ContactPaymentHost).
 *
 * It is page-sized, and the layout that hosts contact payments also serves
 * the public profile and the setup screens, which never pay. So it is
 * fetched on its own, not with the layout, and warmed up wherever a payment
 * is one tap away.
 */
let pipeline = null;

/** The component, fetched once. A fetch that failed is tried again by the next call. */
export function loadContactPaymentPipeline() {
  pipeline ||= import('../pages/Wallet.vue').catch((error) => {
    pipeline = null;
    throw error;
  });
  return pipeline;
}

/** Fetch it ahead of the tap, so the sheet opens at once. Never throws. */
export function preloadContactPaymentPipeline() {
  loadContactPaymentPipeline().catch(() => {});
}
