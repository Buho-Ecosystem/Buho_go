// Paying a Lightning address or LNURL: what the app says when the recipient's service can't be paid, and the fee limit on a Lightning payment. Keep the same keys in all three locales.
// {min}, {max}, {amount}, {fee} and {limit} arrive formatted with their unit (₿ or sats, as in settings).
export default {
  "The recipient's service declined. Nothing was sent.": "The recipient's service declined. Nothing was sent.",
  "This link can't receive a payment.": "This link can't receive a payment.",
  "The recipient's payment details aren't valid. Ask them for another way to pay.": "The recipient's payment details aren't valid. Ask them for another way to pay.",
  "This recipient accepts {min} to {max}.": "This recipient accepts {min} to {max}.",
  "This recipient only accepts {amount}.": "This recipient only accepts {amount}.",
  "The recipient no longer takes payments in {currency}. Send the amount in Bitcoin instead.": "The recipient no longer takes payments in {currency}. Send the amount in Bitcoin instead.",
  "The recipient didn't send a valid payment request. Nothing was sent.": "The recipient didn't send a valid payment request. Nothing was sent.",
  "The recipient asked for a different amount than you confirmed. Nothing was sent.": "The recipient asked for a different amount than you confirmed. Nothing was sent.",
  "The recipient's payment request doesn't match this payment. Nothing was sent.": "The recipient's payment request doesn't match this payment. Nothing was sent.",
  "The recipient's payment request had expired. Nothing was sent. Try again.": "The recipient's payment request had expired. Nothing was sent. Try again.",
  "The recipient's service tried to redirect this payment. Nothing was sent. Ask them for another way to pay.": "The recipient's service tried to redirect this payment. Nothing was sent. Ask them for another way to pay.",
  "The service is busy. Wait a few minutes, then try again.": "The service is busy. Wait a few minutes, then try again.",
  "The network fee would be {fee}, more than the {limit} limit. Nothing was sent. Try again later.": "The network fee would be {fee}, more than the {limit} limit. Nothing was sent. Try again later.",
  "Up to {amount}": "Up to {amount}",
};
