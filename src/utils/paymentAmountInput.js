/**
 * Normalize a payment draft, never a formatted amount from a balance/receipt.
 * Grouping must be structural; a separator must never silently multiply the
 * payment. Canonical dot decimals remain accepted while editing in DE/ES.
 *
 * `locales` lists every language whose separators the person may mean: the
 * app language and the device's (`undefined` is the device). A decimal keypad
 * follows the device, not the app language, so both count.
 */
function decimalOf(locale) {
  try { return new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')?.value || '.' } catch { return '.' }
}
const escaped = token => token === '.' ? '\\.' : token
const grouped = (value, token) => new RegExp(`^[1-9]\\d{0,2}(?:${escaped(token)}\\d{3})+$`).test(value)

export function normalizePaymentAmountInput(input, { locale, locales, precision = 0, caret, canonicalDecimal = false } = {}) {
  const raw = String(input ?? '')
  const fail = reason => ({ value: raw, error: reason, complete: false, caret })
  const text = raw.trim()
  if (!text) return { value: '', error: null, complete: false, caret: 0 }
  if (!Number.isInteger(precision) || precision < 0 || precision > 8 || !/^[\d.,   ]+$/u.test(text)) return fail('invalid')
  const spoken = new Set((Array.isArray(locales) && locales.length ? locales : [locale]).map(decimalOf))
  // A canonical dot stays a decimal while editing in every language.
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
        // Only a known decimal being edited may retain canonical dot meaning.
        // New/pasted ambiguous values never get this provenance.
        if (mark === '.' && canonicalDecimal) separator = mark
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
