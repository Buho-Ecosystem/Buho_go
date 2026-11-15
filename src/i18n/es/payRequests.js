// Paying a Lightning address or LNURL: what the app says when the recipient's service can't be paid, and the fee limit on a Lightning payment. Keep the same keys in all three locales.
// {min}, {max}, {amount}, {fee} and {limit} arrive formatted with their unit (₿ or sats, as in settings).
export default {
  "The recipient's service declined. Nothing was sent.": "El servicio del destinatario rechazó el pago. No se envió nada.",
  "This link can't receive a payment.": "Este enlace no puede recibir un pago.",
  "The recipient's payment details aren't valid. Ask them for another way to pay.": "Los datos de pago del destinatario no son válidos. Pídele otra forma de pagar.",
  "This recipient accepts {min} to {max}.": "Este destinatario acepta de {min} a {max}.",
  "This recipient only accepts {amount}.": "Este destinatario solo acepta {amount}.",
  "The recipient no longer takes payments in {currency}. Send the amount in Bitcoin instead.": "El destinatario ya no acepta pagos en {currency}. Indica el importe en Bitcoin.",
  "The recipient didn't send a valid payment request. Nothing was sent.": "El destinatario no envió una solicitud de pago válida. No se envió nada.",
  "The recipient asked for a different amount than you confirmed. Nothing was sent.": "El destinatario pidió un importe distinto del que confirmaste. No se envió nada.",
  "The recipient's payment request had expired. Nothing was sent. Try again.": "La solicitud de pago del destinatario había caducado. No se envió nada. Vuelve a intentarlo.",
  "The recipient's service tried to redirect this payment. Nothing was sent. Ask them for another way to pay.": "El servicio del destinatario intentó redirigir este pago. No se envió nada. Pídele otra forma de pagar.",
  "The service is busy. Wait a few minutes, then try again.": "El servicio está ocupado. Espera unos minutos y vuelve a intentarlo.",
  "The network fee would be {fee}, more than the {limit} limit. Nothing was sent. Try again later.": "La comisión de red sería de {fee}, por encima del límite de {limit}. No se envió nada. Vuelve a intentarlo más tarde.",
  "Up to {amount}": "Hasta {amount}",
};
