// Paying a Lightning address or LNURL: what the app says when the recipient's service can't be paid. Keep the same keys in all three locales.
// {min}, {max} and {amount} arrive formatted with their unit (₿ or sats, as in settings).
export default {
  "The recipient's service declined. Nothing was sent.": "The recipient's service declined. Nothing was sent.",
  "This link can't receive a payment.": "This link can't receive a payment.",
  "The recipient's payment details aren't valid. Ask them for another way to pay.": "The recipient's payment details aren't valid. Ask them for another way to pay.",
  "This recipient accepts {min} to {max}.": "This recipient accepts {min} to {max}.",
  "This recipient only accepts {amount}.": "This recipient only accepts {amount}.",
  "The recipient no longer takes payments in {currency}. Send the amount in Bitcoin instead.": "The recipient no longer takes payments in {currency}. Send the amount in Bitcoin instead.",
  "The recipient didn't send a valid payment request. Nothing was sent.": "The recipient didn't send a valid payment request. Nothing was sent.",
  "The recipient asked for a different amount than you confirmed. Nothing was sent.": "The recipient asked for a different amount than you confirmed. Nothing was sent.",
  "The service is busy. Wait a few minutes, then try again.": "The service is busy. Wait a few minutes, then try again.",
};
