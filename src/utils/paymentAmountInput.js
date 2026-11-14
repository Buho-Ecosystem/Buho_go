/**
 * Normalize a payment draft, never a formatted amount from a balance/receipt.
 * Grouping must be structural; a separator must never silently multiply the
 * payment. Canonical dot decimals remain accepted while editing in DE/ES.
 */
export function normalizePaymentAmountInput(input, { locale, precision = 0, caret, canonicalDecimal = false } = {}) {
  const raw = String(input ?? '')
  const fail = reason => ({ value: raw, error: reason, complete: false, caret })
  const text = raw.trim()
  if (!text) return { value: '', error: null, complete: false, caret: 0 }
  if (!Number.isInteger(precision) || precision < 0 || precision > 8 || !/^[\d., \u00a0\u202f]+$/u.test(text)) return fail('invalid')
  let decimal = '.'
  try { decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')?.value || '.' } catch { /* default dot */ }
  const commaDecimal = decimal === ','
  const dots = (text.match(/\./g) || []).length
  const commas = (text.match(/,/g) || []).length
  let separator = null
  if (commaDecimal && commas) {
    if (commas !== 1) return fail('invalid')
    separator = ','
  } else if (dots) {
    if (commaDecimal && dots > 1) separator = null // unambiguous integer groups only
    else separator = '.'
  }
  let integer = separator ? text.slice(0, text.indexOf(separator)) : text
  const fraction = separator ? text.slice(text.indexOf(separator) + 1) : ''
  const group = commaDecimal ? '.' : ','
  const grouped = (value, token) => new RegExp(`^[1-9]\\d{0,2}(?:${token === '.' ? '\\.' : token}\\d{3})+$`).test(value)
  const integerHasGroup = integer.includes(group)
  // A single DE/ES dot can mean decimal or thousands. In fractional units
  // 1.234 is not enough evidence to choose between 1.234 and 1234.
  if (commaDecimal && !commas && dots === 1 && grouped(text, '.')) {
    // Only a known decimal being edited may retain canonical dot meaning.
    // New/pasted ambiguous values never get this provenance.
    if (precision > 0 && !canonicalDecimal) return fail('ambiguous')
    if (precision === 0) {
      separator = null
      integer = text
    }
  }
  if (separator && !/^\d*$/.test(fraction)) return fail('invalid')
  if (separator && (fraction.length > precision || precision === 0)) return fail('precision')
  if (integer.includes(group)) {
    if (!grouped(integer, group)) return fail('invalid')
  } else if (/\s/u.test(integer)) {
    if (!/^[1-9]\d{0,2}(?:[ \u00a0\u202f]\d{3})+$/u.test(integer)) return fail('invalid')
  } else if (!/^\d*$/.test(integer)) return fail('invalid')
  if (!separator && text.includes(group) && !grouped(text, group)) return fail('invalid')
  if (!separator && /[.,]/.test(text) && !integerHasGroup && !integer.includes(group)) return fail('invalid')
  const removed = new Set()
  const offset = raw.indexOf(text)
  const integerEnd = separator ? text.indexOf(separator) : text.length
  for (let i = 0; i < integerEnd; i++) if (text[i] === group || /\s/u.test(text[i])) removed.add(i)
  const plainInteger = integer.replace(/[.,\s]/gu, '')
  if (!plainInteger && !separator) return fail('invalid')
  const value = (plainInteger || '0') + (separator ? `.${fraction}` : '')
  const position = typeof caret === 'number'
    ? Math.max(0, Math.min(value.length, caret - offset - [...removed].filter(index => index < caret - offset).length + (!plainInteger ? 1 : 0))) : undefined
  return { value, error: null, complete: !separator || fraction.length > 0, caret: position }
}
