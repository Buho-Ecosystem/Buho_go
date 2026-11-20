/**
 * Normalize a payment draft, never a formatted amount from a balance/receipt.
 * Grouping must be structural; a separator must never silently multiply the
 * payment. A dot stays a decimal candidate in every language (a hardware
 * keyboard's period).
 *
 * `locales` lists every language whose separators the person may mean: the
 * app language and the device's (`undefined` is the device). A decimal keypad
 * follows the device, not the app language, so both count.
 *
 * `decimalMark` is the mark the field itself wrote as this draft's decimal:
 * while that decimal is being edited, three digits after it stay a fraction
 * instead of turning ambiguous. A new or pasted value never carries it.
 */
/** The decimal mark a language writes (`undefined` is the device). */
export function decimalOf(locale) {
  try { return new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')?.value || '.' } catch { return '.' }
}
const escaped = token => token === '.' ? '\\.' : token
const grouped = (value, token) => new RegExp(`^[1-9]\\d{0,2}(?:${escaped(token)}\\d{3})+$`).test(value)

export function normalizePaymentAmountInput(input, { locale, locales, precision = 0, caret, decimalMark = null } = {}) {
  const raw = String(input ?? '')
  const fail = reason => ({ value: raw, error: reason, complete: false, caret })
  const text = raw.trim()
  if (!text) return { value: '', error: null, complete: false, caret: 0 }
  if (!Number.isInteger(precision) || precision < 0 || precision > 8 || !/^[\d.,   ]+$/u.test(text)) return fail('invalid')
  const spoken = new Set((Array.isArray(locales) && locales.length ? locales : [locale]).map(decimalOf))
  const decimals = new Set([...spoken, '.'])
  const groups = new Set([...spoken].map(mark => mark === ',' ? '.' : ','))
  const dots = (text.match(/\./g) || []).length
  const commas = (text.match(/,/g) || []).length
  let separator = null, group = null
  if (dots && commas) {
    // Both marks: the last one is the decimal, the other groups thousands.
    separator = text[Math.max(text.lastIndexOf('.'), text.lastIndexOf(','))]
    group = separator === '.' ? ',' : '.'
    if (text.indexOf(separator) !== text.lastIndexOf(separator) || !decimals.has(separator) || !groups.has(group)) return fail('invalid')
  } else if (dots || commas) {
    const mark = dots ? '.' : ','
    if (dots + commas > 1) {
      if (!groups.has(mark)) return fail('invalid')
      group = mark
    } else if (grouped(text, mark)) {
      // 1.234 or 1,234: thousands in one language, a decimal in another.
      const canGroup = groups.has(mark), canDecimal = decimals.has(mark)
      if (precision === 0) { if (canGroup) group = mark; else separator = mark }
      else if (canGroup && canDecimal) {
        // Only the decimal the field itself wrote keeps its meaning.
        if (mark === decimalMark) separator = mark
        else return fail('ambiguous')
      } else if (canGroup) group = mark
      else separator = mark
    } else {
      // Not a thousands group, so the only reading left is a decimal. A mark
      // no listed language uses as one counts with up to two digits after it
      // (the keypad's decimal key), never with more.
      if (!decimals.has(mark) && text.length - 1 - text.indexOf(mark) > 2) return fail('invalid')
      separator = mark
    }
  }
  const cut = separator ? text.lastIndexOf(separator) : text.length
  const integer = text.slice(0, cut)
  const fraction = separator ? text.slice(cut + 1) : ''
  if (!/^\d*$/.test(fraction)) return fail('invalid')
  if (separator && (precision === 0 || fraction.length > precision)) return fail('precision')
  if (group) {
    if (!grouped(integer, group)) return fail('invalid')
  } else if (/[.,]/.test(integer)) return fail('invalid')
  else if (/\s/u.test(integer)) {
    if (!/^[1-9]\d{0,2}(?:[   ]\d{3})+$/u.test(integer)) return fail('invalid')
  } else if (!/^\d*$/.test(integer)) return fail('invalid')
  const removed = new Set()
  const offset = raw.indexOf(text)
  for (let i = 0; i < cut; i++) if (text[i] === group || /\s/u.test(text[i])) removed.add(i)
  const plainInteger = integer.replace(/[.,\s]/gu, '')
  if (!plainInteger && !separator) return fail('invalid')
  const value = (plainInteger || '0') + (separator ? `.${fraction}` : '')
  const position = typeof caret === 'number'
    ? Math.max(0, Math.min(value.length, caret - offset - [...removed].filter(index => index < caret - offset).length + (!plainInteger ? 1 : 0))) : undefined
  return { value, error: null, complete: !separator || fraction.length > 0, caret: position }
}

/**
 * A draft ("1234.5", "1.", "0.00000029") written the way `locale` writes
 * numbers (`undefined` is the device): its decimal mark always, its thousands
 * grouping only when `grouped`. The digits are never read through a float, so
 * a large Bitcoin amount keeps its last satoshi. Text that is not a draft (a
 * refused entry) is returned as typed.
 */
export function formatPaymentAmountDraft(draft, { locale, grouped = false } = {}) {
  const text = String(draft ?? '')
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text)
  if (!match) return text
  const [, whole, fraction] = match
  const integer = grouped ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(whole)) : whole
  return fraction === undefined ? integer : `${integer}${decimalOf(locale)}${fraction}`
}

/**
 * Where a caret at `index` in `from` belongs in `to`, when both write the same
 * draft and differ only in grouping: after the same digits and decimal mark.
 */
export function caretAcrossGrouping(from, to, index, { locale } = {}) {
  const decimal = decimalOf(locale)
  const counts = char => /\d/.test(char) || char === decimal
  let remaining = [...from.slice(0, index)].filter(counts).length
  let position = 0
  while (remaining > 0 && position < to.length) if (counts(to[position++])) remaining--
  return position
}

/**
 * A finished amount field as a number, or null when it cannot be read with
 * certainty. For forms that parse on submit (batch send, transfers), so a
 * comma is never dropped and a decimal never turned into thousands.
 */
export function parsePaymentAmount(input, options = {}) {
  const result = normalizePaymentAmountInput(input, options)
  if (result.error || !result.complete || !result.value) return null
  const amount = Number(result.value)
  return Number.isFinite(amount) ? amount : null
}
