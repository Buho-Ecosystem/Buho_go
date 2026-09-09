/**
 * Rounding a till total up to the next convenient amount.
 *
 * "Aufrunden" at a European register means what a customer says out loud —
 * "machen Sie 20" on a bill of 18.40 — not the next whole unit. Those are
 * different rules and the difference matters: rounding an 18.40 bill to 19.00
 * is not what anybody means, and rounding a bill of exactly 20.00 to the next
 * whole unit means nothing at all.
 *
 * So the step scales with the size of the bill, and the result is ALWAYS
 * strictly greater than the total. A round-up that offers nothing is the
 * failure this replaces: on fifteen typical till amounts, "next whole unit"
 * was silent on seven of them, because a till rings up round prices all day.
 *
 *          bill      next whole unit        this rule
 *          4.00      nothing                4.50   (+12.5%)
 *          4.20      5.00   (+19.0%)        4.50   (+7.1%)
 *         18.40      19.00  (+3.3%)        19.00   (+3.3%)
 *         20.00      nothing               21.00   (+5.0%)
 *        100.00      nothing              105.00   (+5.0%)
 *        960.00      nothing              970.00   (+1.0%)
 *
 * All arithmetic is done in integers — cents for fiat, sats otherwise.
 * Deciding this in floating point made the offer depend on the exchange rate
 * rather than on the bill: the same 960.00 sale offered nothing at one BTC
 * price and a whole extra unit at another.
 */

const SATS_PER_BTC = 100_000_000;

/**
 * How far up to round, by how large the bill is.
 *
 * The bands are the amounts a person would actually name. Below ten you round
 * to the half; into the tens, to the unit; into the hundreds, to five and
 * then ten. Expressed in the smallest unit (cents, or sats) so the caller
 * never divides.
 *
 * @param {number} amount in the smallest unit
 * @param {number} one    how many of that unit make one whole unit
 *                        (100 cents to the euro; 1000 sats stands in for it)
 */
function stepFor(amount, one) {
  if (amount < 10 * one) return one / 2;
  if (amount < 50 * one) return one;
  if (amount < 200 * one) return 5 * one;
  if (amount < 1000 * one) return 10 * one;
  return 50 * one;
}

/**
 * The next convenient amount above `amount`, in the same unit.
 *
 * Always strictly greater: a total already sitting on a step goes up to the
 * next one, which is what makes the offer dependable rather than a coin flip
 * on where the bill happened to land.
 */
function nextStepAbove(amount, one) {
  const step = stepFor(amount, one);
  return (Math.floor(amount / step) + 1) * step;
}

/**
 * What to round this sale up to.
 *
 * @param {object} input
 * @param {number} input.amountSats  the total so far
 * @param {boolean} [input.isFiat]   whether the register is showing fiat
 * @param {number} [input.rate]      fiat per BTC, required when isFiat
 * @returns {number|null} the target in sats, or null when there is nothing
 *   sensible to offer (no amount, or fiat mode without a usable rate)
 */
export function roundUpTargetSats({ amountSats, isFiat = false, rate = 0 } = {}) {
  const sats = Number(amountSats);
  if (!Number.isFinite(sats) || sats <= 0) return null;

  if (isFiat) {
    if (!Number.isFinite(rate) || rate <= 0) return null;
    // Cents, so the rounding decision cannot be shifted by float error.
    const cents = Math.round((sats / SATS_PER_BTC) * rate * 100);
    if (cents <= 0) return null;
    const targetCents = nextStepAbove(cents, 100);
    const targetSats = Math.round(((targetCents / 100) / rate) * SATS_PER_BTC);
    // A rate extreme enough to collapse the two back together leaves nothing
    // to offer; better to say so than to show a button that adds nothing.
    return targetSats > sats ? targetSats : null;
  }

  // Sats mode. 1000 sats stands in for the whole unit, so the bands read the
  // same: half-steps below 10 000, then 1 000, 5 000, 10 000, 50 000.
  return nextStepAbove(sats, 1000);
}
