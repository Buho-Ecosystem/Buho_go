// Paying a Lightning address or LNURL: what the app says when the recipient's service can't be paid. Keep the same keys in all three locales.
// {min}, {max} and {amount} arrive formatted with their unit (₿ or sats, as in settings).
export default {
  "The recipient's service declined. Nothing was sent.": "El servicio del destinatario rechazó el pago. No se envió nada.",
  "This link can't receive a payment.": "Este enlace no puede recibir un pago.",
  "The recipient's payment details aren't valid. Ask them for another way to pay.": "Los datos de pago del destinatario no son válidos. Pídele otra forma de pagar.",
  "This recipient accepts {min} to {max}.": "Este destinatario acepta de {min} a {max}.",
  "This recipient only accepts {amount}.": "Este destinatario solo acepta {amount}.",
  "The recipient no longer takes payments in {currency}. Send the amount in Bitcoin instead.": "El destinatario ya no acepta pagos en {currency}. Indica el importe en Bitcoin.",
  "The recipient didn't send a valid payment request. Nothing was sent.": "El destinatario no envió una solicitud de pago válida. No se envió nada.",
  "The recipient asked for a different amount than you confirmed. Nothing was sent.": "El destinatario pidió un importe distinto del que confirmaste. No se envió nada.",
  "The service is busy. Wait a few minutes, then try again.": "El servicio está ocupado. Espera unos minutos y vuelve a intentarlo.",
};
