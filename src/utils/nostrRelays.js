/**
 * Nostr relay layer for BuhoGO.
 *
 * One curated relay set carries every event we publish: `kind:0`
 * profile metadata, `kind:10002` relay metadata, `kind:30000` private
 * lists, and anything else added later. The same set is queried for
 * reads. Splitting "profile" vs "general" relays would mean two
 * constants to keep in sync — there's no operational reason to.
 *
 * Operator diversity is the property that matters: every URL below is
 * run by a different team (with one redundant pair from YakiHonne for
 * write resilience). A single-vendor failure cannot take BuhoGO
 * offline.
 *
 * The "no relay configuration for normal users" product rule is
 * enforced by simply not having a setter for `DEFAULT_RELAYS`. If we
 * ever add advanced customization, it lives in a separate store and
 * overrides this constant at call time.
 *
 * Reasoning behind each pick is in
 *   Plans WIP/09-NOSTR-PROFILE-AND-RELAYS.md  ("Locked decisions").
 */

import { RelayPool } from 'nostr-core';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/**
 * Default relay set. Frozen so a future caller can't accidentally
 * mutate the shared constant — any override would have to be a
 * deliberate copy.
 */
export const DEFAULT_RELAYS = Object.freeze([
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://nostr-01.yakihonne.com',
  'wss://nostr-02.yakihonne.com',
]);

/**
 * Default Blossom server for avatar uploads. A convenience default,
 * not a trust anchor — we store the returned blob URL and hash so
 * re-hosting elsewhere stays possible.
 */
export const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net';

/**
 * Per-relay upper bound for a single publish attempt. nostr-core's
 * `Relay.publishTimeout` defaults to 5000ms; we layer a slightly
 * longer ceiling here as a belt-and-braces safety net so a flaky
 * relay can never freeze the whole flow.
 */
export const DEFAULT_PUBLISH_TIMEOUT_MS = 8000;

// ----------------------------------------------------------------------------
// Shared pool singleton
// ----------------------------------------------------------------------------

/**
 * One `RelayPool` per process. Reusing the pool keeps WebSocket
 * connections warm across publishes and queries; constructing a new
 * pool per operation would re-handshake every relay every time.
 *
 * @type {RelayPool | null}
 */
let sharedPool = null;

/**
 * Lazy accessor for the shared pool. Tests should pass their own
 * pool to the fan-out helpers directly rather than going through
 * this — keeps test isolation clean.
 *
 * @returns {RelayPool}
 */
export function getRelayPool() {
  if (!sharedPool) {
    sharedPool = new RelayPool();
  }
  return sharedPool;
}

// ----------------------------------------------------------------------------
// Publish fan-out (eager)
// ----------------------------------------------------------------------------

/**
 * @typedef {{ relay: string, ok: boolean, error: string | null }} RelayPublishResult
 */

/**
 * Publish one event to one relay through the pool. Resolves with a
 * `RelayPublishResult`; never rejects. Connection failure, validation
 * failure, and the per-attempt timeout all collapse to `ok: false`
 * with the underlying message so callers never have to branch on
 * rejection.
 *
 * Internal helper. The public API is `publishToRelaysEager`.
 *
 * @param {RelayPool} pool
 * @param {string} url
 * @param {import('nostr-core').NostrEvent} event
 * @param {number} timeoutMs
 * @returns {Promise<RelayPublishResult>}
 */
async function publishOneRelay(pool, url, event, timeoutMs) {
  let timer = null;
  try {
    const relay = await pool.ensureRelay(url);
    const timeoutPromise = new Promise((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Publish timed out')),
        timeoutMs,
      );
    });
    await Promise.race([relay.publish(event), timeoutPromise]);
    return { relay: url, ok: true, error: null };
  } catch (err) {
    const message =
      (err && typeof err.message === 'string' && err.message)
        ? err.message
        : 'Relay did not accept';
    return { relay: url, ok: false, error: message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Fan-out publish with eager-success semantics.
 *
 * Returns two promises in one object:
 *
 *   • `firstAccept` — resolves with the first relay that acks (a
 *     `RelayPublishResult` with `ok: true`), or `null` if every relay
 *     refuses. Lets the caller flip the UI to "saved" the moment a
 *     single relay holds the event; the remaining attempts continue
 *     in the background.
 *
 *   • `allSettled` — resolves with the per-relay result for every
 *     input URL, in input order, after every attempt finishes. Use
 *     this for logging, retries, or detail views; never block the
 *     user on it.
 *
 * Neither promise ever rejects. A pool-level connection failure or a
 * per-relay timeout becomes a per-relay `ok: false` entry. The
 * background AggregateError that `Promise.any` raises when every
 * relay rejected is logged once to `console.warn` and then collapsed
 * to `null` on `firstAccept`.
 *
 * Empty URL list short-circuits without touching the pool — no
 * WebSocket connection is attempted.
 *
 * @param {RelayPool} pool
 * @param {readonly string[]} urls
 * @param {import('nostr-core').NostrEvent} event
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {{
 *   firstAccept: Promise<RelayPublishResult | null>,
 *   allSettled: Promise<RelayPublishResult[]>,
 * }}
 */
export function publishToRelaysEager(pool, urls, event, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs)
    ? opts.timeoutMs
    : DEFAULT_PUBLISH_TIMEOUT_MS;

  if (!Array.isArray(urls) || urls.length === 0) {
    return {
      firstAccept: Promise.resolve(null),
      allSettled: Promise.resolve([]),
    };
  }

  // One promise per URL. Each resolves with a RelayPublishResult,
  // never rejects. Started immediately so the WebSocket round-trips
  // fire in parallel.
  const perRelay = urls.map((url) => publishOneRelay(pool, url, event, timeoutMs));

  // Race for the first ok=true. We invert each result so a non-ok
  // entry rejects the wrapper, making `Promise.any` pick the earliest
  // ok=true. If every wrapped promise rejected (every relay returned
  // ok=false) `Promise.any` raises AggregateError and we collapse it
  // to `null` for the caller's convenience.
  const firstAccept = Promise.any(
    perRelay.map((p) => p.then((r) => (r.ok ? r : Promise.reject(r)))),
  ).catch((err) => {
    if (err && Array.isArray(err.errors)) {
      console.warn(
        '[nostr] every relay refused kind',
        event?.kind,
        ':',
        err.errors.map((e) => (e && e.error) || e),
      );
    }
    return null;
  });

  const allSettled = Promise.all(perRelay);

  return { firstAccept, allSettled };
}

/**
 * Convenience predicate: did at least one relay accept this event?
 * Useful when a caller already holds the fully-settled result array
 * and wants a single boolean.
 *
 * @param {readonly RelayPublishResult[]} results
 * @returns {boolean}
 */
export function anyAccepted(results) {
  return Array.isArray(results) && results.some((r) => r.ok);
}

/**
 * Query one relay with a provable reachability outcome.
 *
 * nostr-core's `querySync` alone cannot provide one: a socket that
 * never connects resolves `[]` exactly like a connected relay with no
 * matching events, and treating that as "reached, empty" is how a
 * network blackout turns into publishing a fresh doc over the real
 * one. `ensureRelay` rejects on a failed handshake, so connect-then-
 * query makes `null` mean "not reached" while an array means "this
 * relay really answered". An empty answer from a socket that died
 * mid-query proves nothing and is demoted to "not reached" as well, and
 * so does one that only came when the window ran out: a socket can stay
 * open after the network is gone, and its silence is not an answer.
 *
 * A pool without `ensureRelay` cannot prove a connection, so it can
 * never prove absence either — events still count, emptiness doesn't.
 *
 * @returns {Promise<object[] | null>}  events, or null when unreached
 */
export async function queryOneRelay(pool, url, filter, maxWait) {
  if (typeof pool.ensureRelay !== 'function') {
    const events = await pool.querySync([url], filter, { maxWait });
    return Array.isArray(events) && events.length > 0 ? events : null;
  }
  let relay;
  try {
    relay = await pool.ensureRelay(url, { connectionTimeout: maxWait });
  } catch {
    return null;
  }
  // The pool synthesizes EOSE after the relay's own eoseTimeout
  // (default well under our window) — a connected-but-slow relay
  // would answer [] and count as reached. Give it the full window.
  if (relay) relay.eoseTimeout = maxWait;
  const started = Date.now();
  const events = await pool.querySync([url], filter, { maxWait });
  if (!Array.isArray(events)) return null;
  if (events.length === 0 && (relay?.connected === false || Date.now() - started >= maxWait)) return null;
  return events;
}

/**
 * Whether an empty answer can be trusted: at least two of the relays asked
 * (or all of them, when fewer were asked) provably answered with nothing.
 * Publishing a replaceable event over an absence that is not proven can
 * replace the person's own event that merely sat out of reach.
 *
 * @param {number} reached relays that provably answered (queryOneRelay)
 * @param {number} asked   relays that were asked
 * @returns {boolean}
 */
export function provesAbsence(reached, asked) {
  return asked > 0 && reached >= Math.min(2, asked);
}
