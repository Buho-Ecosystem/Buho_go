/**
 * What a failed contact save tells the person, decided by the store's error
 * code (stores/addressBook.js contactError), never by its English message.
 * Store messages are for logs: none of them is ever shown.
 *
 * @param {unknown} error
 * @param {(key: string, values?: object) => string} t
 * @returns {{ type: 'warning'|'negative', message: string, caption: string }}
 */
export function contactSaveError(error, t) {
  switch (error?.code) {
    case 'duplicate':
      return {
        type: 'warning',
        message: t('Already in your address book'),
        caption: error.existing?.name ? t('Already saved as {name}', { name: error.existing.name }) : '',
      }
    case 'invalid-address':
      return {
        type: 'negative',
        message: t('Address not recognized'),
        caption: t('Please check the address and try again'),
      }
    case 'no-payment-address':
      return {
        type: 'negative',
        message: t('No payment address'),
        caption: t('This profile cannot receive payments yet.'),
      }
    default:
      return {
        type: 'negative',
        message: t("Couldn't save contact"),
        caption: t('Please try again'),
      }
  }
}
