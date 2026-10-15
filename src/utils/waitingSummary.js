/**
 * The one line Home shows while something waits for the user: a contact's
 * request, or a voucher that still holds money. Written out, because a bare
 * dot says nothing (Apple HIG, Feedback: status "unobtrusive but easy for
 * people to check"; Accessibility: "more than color alone").
 *
 * @param {{ requests: Array<{ partner: string, request: { amountSats: number } }>, vouchers: object[] }} waiting
 * @param {{ t: Function, nameOf: (pubkey: string) => string, amountOf: (sats: number) => string,
 *   voucherName: (voucher: object) => string, voucherSats: (voucher: object) => number }} words
 *   `amountOf` returns '' while amounts are hidden.
 * @returns {string|null} Null when nothing waits.
 */
export function waitingSummary({ requests, vouchers }, { t, nameOf, amountOf, voucherName, voucherSats }) {
  if (!requests.length && !vouchers.length) return null
  if (requests.length === 1 && !vouchers.length) {
    const [{ partner, request }] = requests
    const amount = amountOf(request.amountSats)
    return amount
      ? t('{name} asks for {amount}', { name: nameOf(partner), amount })
      : t('{name} asks for money', { name: nameOf(partner) })
  }
  if (vouchers.length === 1 && !requests.length) {
    const [voucher] = vouchers
    const amount = amountOf(voucherSats(voucher))
    return amount
      ? t('{amount} left on {voucher}', { amount, voucher: voucherName(voucher) })
      : t('Money left on {voucher}', { voucher: voucherName(voucher) })
  }
  const count = (n, one, many) => (n === 1 ? t(one) : t(many, { n }))
  return [
    requests.length > 0 && count(requests.length, '1 request', '{n} requests'),
    vouchers.length > 0 && count(vouchers.length, '1 voucher', '{n} vouchers'),
  ].filter(Boolean).join(' · ')
}
