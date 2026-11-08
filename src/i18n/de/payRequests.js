// Paying a Lightning address or LNURL: what the app says when the recipient's service can't be paid. Keep the same keys in all three locales.
// {min}, {max} and {amount} arrive formatted with their unit (₿ or sats, as in settings).
export default {
  "The recipient's service declined. Nothing was sent.": "Der Dienst des Empfängers hat die Zahlung abgelehnt. Es wurde nichts gesendet.",
  "This link can't receive a payment.": "Dieser Link kann keine Zahlung empfangen.",
  "The recipient's payment details aren't valid. Ask them for another way to pay.": "Die Zahlungsdaten des Empfängers sind ungültig. Bitte den Empfänger um eine andere Zahlungsmöglichkeit.",
  "This recipient accepts {min} to {max}.": "Dieser Empfänger nimmt {min} bis {max} an.",
  "This recipient only accepts {amount}.": "Dieser Empfänger nimmt nur {amount} an.",
  "The recipient no longer takes payments in {currency}. Send the amount in Bitcoin instead.": "Der Empfänger nimmt keine Zahlungen in {currency} mehr an. Gib den Betrag stattdessen in Bitcoin ein.",
  "The recipient didn't send a valid payment request. Nothing was sent.": "Der Empfänger hat keine gültige Zahlungsanfrage gesendet. Es wurde nichts gesendet.",
  "The recipient asked for a different amount than you confirmed. Nothing was sent.": "Der Empfänger hat einen anderen Betrag angefordert, als du bestätigt hast. Es wurde nichts gesendet.",
  "The service is busy. Wait a few minutes, then try again.": "Der Dienst ist gerade ausgelastet. Warte ein paar Minuten und versuch es dann noch einmal.",
};
