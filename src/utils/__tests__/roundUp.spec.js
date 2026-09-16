/**
 * Rounding a till total up to the next convenient amount.
 *
 * The two failures these tests exist to prevent both shipped once:
 *
 *   - the offer being SILENT on a round bill, which is more than half of what
 *     a till rings up in a day;
 *   - the offer depending on the exchange rate rather than on the bill,
 *     because the decision was made in floating point.
 *
 * Run directly with Node:
 *   node src/utils/__tests__/roundUp.spec.js
 */

import { strict as assert } from 'node:assert'
import { roundUpTargetSats } from '../roundUp.js'

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed += 1
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    failed += 1
  }
}

const E = 100_000_000
const RATE = 95_000
const sats = (fiat) => Math.round((fiat / RATE) * E)
const fiat = (s) => (s / E) * RATE
/** What the register would round this bill up to, in the currency. */
const target = (bill, rate = RATE) => {
  const t = roundUpTargetSats({ amountSats: Math.round((bill / rate) * E), isFiat: true, rate })
  return t === null ? null : Number(((t / E) * rate).toFixed(2))
}

// ── the rule ───────────────────────────────────────────────────────────────

test('the step scales with the size of the bill', () => {
  // Below ten, to the half. Into the tens, to the unit. Then five, then ten.
  assert.equal(target(4.20), 4.50)
  assert.equal(target(18.40), 19.00)
  assert.equal(target(102.00), 105.00)
  assert.equal(target(960.00), 970.00)
})

test('a bill already on a step still goes up, never nowhere', () => {
  // This is the whole point. "Next whole unit" was silent on every one of
  // these, and a till rings up round prices all day.
  assert.equal(target(4.00), 4.50)
  assert.equal(target(10.00), 11.00)
  assert.equal(target(20.00), 21.00)
  assert.equal(target(100.00), 105.00)
  assert.equal(target(250.00), 260.00)
})

test('the result is always strictly more than the bill', () => {
  for (let cents = 1; cents <= 200_00; cents += 37) {
    const bill = cents / 100
    const t = target(bill)
    assert.ok(t !== null && t > bill, `${bill} -> ${t}`)
  }
})

test('what it adds stays in a sane band', () => {
  // Rounding is not a percentage, so the addition varies — but it should
  // never be so small it is theatre, nor so large it is a shakedown.
  for (const bill of [3.5, 4, 7.8, 12.5, 18.4, 20, 48.6, 100, 250, 960]) {
    const added = target(bill) - bill
    const pct = (added / bill) * 100
    assert.ok(pct > 0 && pct <= 30, `${bill} -> +${added.toFixed(2)} (${pct.toFixed(1)}%)`)
  }
})

// ── the bug that made it depend on the exchange rate ───────────────────────

test('the same bill rounds the same way at every BTC price', () => {
  // Deciding this in floating point made a flat 960.00 sale offer nothing at
  // one rate and a whole extra unit at another.
  for (const bill of [4.00, 18.40, 20.00, 100.00, 960.00]) {
    const seen = new Set()
    for (const rate of [42_000, 62_960, 71_810, 95_000, 128_500]) {
      seen.add(target(bill, rate))
    }
    assert.equal(seen.size, 1, `${bill} rounded to ${[...seen].join(' / ')} depending on the rate`)
  }
})

// ── sats mode ──────────────────────────────────────────────────────────────

test('sats mode uses the same bands, with 1000 sats standing in for the unit', () => {
  const t = (s) => roundUpTargetSats({ amountSats: s })
  assert.equal(t(4_000), 4_500)     // below 10 000: to the half
  assert.equal(t(4_200), 4_500)
  assert.equal(t(18_400), 19_000)   // below 50 000: to the thousand
  assert.equal(t(20_000), 21_000)   // already on a step: up one
  assert.equal(t(102_000), 105_000) // below 200 000: to five
  assert.equal(t(960_000), 970_000) // below 1 000 000: to ten
  assert.equal(t(2_000_000), 2_050_000)
})

test('sats mode never needs a rate', () => {
  assert.equal(roundUpTargetSats({ amountSats: 20_000, isFiat: false, rate: 0 }), 21_000)
})

// ── nothing to offer ───────────────────────────────────────────────────────

test('no amount means no offer', () => {
  for (const bad of [0, -1, NaN, null, undefined, 'lots']) {
    assert.equal(roundUpTargetSats({ amountSats: bad }), null, String(bad))
  }
  assert.equal(roundUpTargetSats(), null)
})

test('fiat mode without a usable rate offers nothing rather than guessing', () => {
  // Falling back to the sats bands here would round a bill by an amount that
  // has nothing to do with the currency on screen.
  for (const rate of [0, -1, NaN, undefined]) {
    assert.equal(roundUpTargetSats({ amountSats: 20_000, isFiat: true, rate }), null, String(rate))
  }
})

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
