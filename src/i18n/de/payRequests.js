// Paying a Lightning address or LNURL: what the app says when the recipient's service can't be paid, and the fee limit on a Lightning payment. Keep the same keys in all three locales.
// {min}, {max}, {amount}, {fee} and {limit} arrive formatted with their unit (₿ or sats, as in settings).
export default {
  "The recipient's service declined. Nothing was sent.": "Der Dienst des Empfängers hat die Zahlung abgelehnt. Es wurde nichts gesendet.",
  "This link can't receive a payment.": "Dieser Link kann keine Zahlung empfangen.",
  "The recipient's payment details aren't valid. Ask them for another way to pay.": "Die Zahlungsdaten des Empfängers sind ungültig. Bitte den Empfänger um eine andere Zahlungsmöglichkeit.",
  "This recipient accepts {min} to {max}.": "Dieser Empfänger nimmt {min} bis {max} an.",
  "This recipient only accepts {amount}.": "Dieser Empfänger nimmt nur {amount} an.",
  "The recipient no longer takes payments in {currency}. Send the amount in Bitcoin instead.": "Der Empfänger nimmt keine Zahlungen in {currency} mehr an. Gib den Betrag stattdessen in Bitcoin ein.",
  "The recipient didn't send a valid payment request. Nothing was sent.": "Der Empfänger hat keine gültige Zahlungsanfrage gesendet. Es wurde nichts gesendet.",
  "The recipient asked for a different amount than you confirmed. Nothing was sent.": "Der Empfänger hat einen anderen Betrag angefordert, als du bestätigt hast. Es wurde nichts gesendet.",
  "The recipient's payment request had expired. Nothing was sent. Try again.": "Die Zahlungsanfrage des Empfängers war abgelaufen. Es wurde nichts gesendet. Versuch es noch einmal.",
  "The recipient's service tried to redirect this payment. Nothing was sent. Ask them for another way to pay.": "Der Dienst des Empfängers wollte diese Zahlung umleiten. Es wurde nichts gesendet. Bitte den Empfänger um eine andere Zahlungsmöglichkeit.",
  "The service is busy. Wait a few minutes, then try again.": "Der Dienst ist gerade ausgelastet. Warte ein paar Minuten und versuch es dann noch einmal.",
  "The network fee would be {fee}, more than the {limit} limit. Nothing was sent. Try again later.": "Die Netzwerkgebühr wäre {fee}, mehr als das Limit von {limit}. Es wurde nichts gesendet. Versuch es später noch einmal.",
  "Up to {amount}": "Bis zu {amount}",
  // A payment handed to the wallet whose outcome nobody has told (utils/paymentOutcome.js).
  "This payment may have gone through. Check History before you pay again, so you do not pay twice.": "Diese Zahlung ist vielleicht durchgegangen. Sieh im Verlauf nach, bevor du noch einmal zahlst, damit du nicht doppelt zahlst.",
  // Under "Payment on its way" on the screen after a send (PaymentConfirmation `pending`).
  "It is not confirmed yet. History shows when it has arrived.": "Sie ist noch nicht bestätigt. Im Verlauf siehst du, wann sie angekommen ist.",
  "The wallet didn't answer in time. Nothing was sent.": "Die Wallet hat nicht rechtzeitig geantwortet. Es wurde nichts gesendet.",
};
