/**
 * When a transaction happened.
 *
 * The report gets its rows from `services/txNormalizer.js`, whose canonical
 * time field is `settled_at` in unix SECONDS — the same field and unit the
 * transaction list reads (`new Date(tx.settled_at * 1000)`). There is no
 * `timestamp` field on a normalised transaction, and reading one produced a
 * report with no rows in it at all: every row failed the period filter, so
 * every report came out empty regardless of which period was chosen.
 *
 * One accessor, used by collect, rows and the orchestrator alike, so the
 * three can never again disagree about where the time lives.
 */

/** Below this a number is seconds; at or above it, milliseconds. Same rule
 *  the normaliser uses for expiry, so the two read a provider alike. */
const MS_THRESHOLD = 1e12;

/**
 * @param {object} tx a normalised transaction
 * @returns {number|null} epoch milliseconds, or null when it carries no
 *   usable time — which is a row the report must leave out rather than
 *   place at the epoch.
 */
export function txTimeMs(tx) {
  // settled_at is when the money actually moved, which is the date a tax
  // record is about. created_at only stands in for a row that somehow
  // reached us without one.
  const raw = tx?.settled_at ?? tx?.created_at ?? tx?.time ?? tx?.timestamp ?? null;
  if (raw === null || raw === undefined || raw === '') return null;

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw >= MS_THRESHOLD ? raw : raw * 1000;
  }

  if (typeof raw !== 'string') return null;

  // A numeric string is still a unix time, not a date to be parsed: passing
  // "0" to Date.parse yields the year 2000, which is a date this row does
  // not have.
  const n = Number(raw);
  if (Number.isFinite(n)) {
    if (n <= 0) return null;
    return n >= MS_THRESHOLD ? n : n * 1000;
  }

  // An ISO string is not what our providers send, but accepting one costs
  // nothing and beats dropping the row if one ever does.
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
