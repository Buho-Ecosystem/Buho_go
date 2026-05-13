/**
 * Nostr relay layer for BuhoGO.
 *
 * One curated relay set carries every event we publish: `kind:0` profile
 * metadata, `kind:10002` relay metadata, `kind:30000` private lists, and
 * anything else added later. The same set is queried for reads of
 * arbitrary contacts. Splitting "profile" vs "general" relays would just
 * mean two constants to keep in sync — there's no operational reason to.
 *
 * Operator diversity is the property that matters: every URL below is
 * run by a different team (with one redundant pair from YakiHonne for
 * write resilience). A single-vendor failure cannot take BuhoGO offline.
 *
 * Reasoning behind each pick is in
 *   Plans WIP/09-NOSTR-PROFILE-AND-RELAYS.md  ("Locked decisions").
 *
 * This module deliberately does *not* expose relay management UI hooks.
 * The "no relay configuration for normal users" product rule is enforced
 * by simply not having a setter for `DEFAULT_RELAYS`. If we ever add
 * advanced customization (per the plan's Phase 3 path), it lives in a
 * separate store and overrides this constant at call time.
 */

import { RelayPool } from 'nostr-core';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/**
 * Default relay set. Frozen so a future caller can't accidentally mutate
 * the shared constant — any override would have to be a deliberate copy.
 */
export const DEFAULT_RELAYS = Object.freeze([
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://nostr-01.yakihonne.com',
  'wss://nostr-02.yakihonne.com',
]);

/**
 * Default Blossom server for avatar uploads. Treated as a convenience
 * default, not a trust anchor — we store the returned blob URL and hash
 * so re-hosting elsewhere stays possible.
 */
export const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net';

/**
 * Hard upper bound on how long a single publish call may take before we
 * normalise the remaining relays to a timeout failure. Nostr-core's pool
 * has its own per-relay timeouts; this is a belt-and-braces top-level
 * cap so an unreachable relay can never freeze the whole flow.
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
 * Lazy accessor for the shared pool. Tests should pass their own pool
 * to `publishToRelays` directly rather than going through this — keeps
 * test isolation clean.
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
// Publish fanout
// ----------------------------------------------------------------------------

/**
 * @typedef {{ relay: string, ok: boolean, error: string | null }} RelayPublishResult
 */

/**
 * Publish an event to every URL in `urls` and normalise nostr-core's
 * `Promise<string[]>` (URLs that accepted) into a per-relay record the
 * UI can render directly.
 *
 * Guarantees:
 *   - Always resolves with a result for every input URL, in input order.
 *   - Never throws. A pool-level error (validation failure, network
 *     wipeout, timeout) collapses to every relay being marked
 *     `ok: false` with the underlying message.
 *
 * @param {RelayPool} pool
 * @param {readonly string[]} urls
 * @param {import('nostr-core').NostrEvent} event
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<RelayPublishResult[]>}
 */
export async function publishToRelays(pool, urls, event, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs)
    ? opts.timeoutMs
    : DEFAULT_PUBLISH_TIMEOUT_MS;

  if (!Array.isArray(urls) || urls.length === 0) {
    return [];
  }

  let accepted = [];
  let publishError = null;

  try {
    accepted = await Promise.race([
      pool.publish([...urls], event),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('Publish timed out')), timeoutMs),
      ),
    ]);
  } catch (err) {
    publishError = err;
    // Surface the underlying reason to the console so callers can
    // diagnose without having to pierce the layered fallback. Kept
    // as a warn (not an error) because publishToRelays itself never
    // throws — the caller still gets a per-relay result array and
    // can choose its own recovery strategy.
    console.warn(
      '[nostr] publish failed for kind',
      event?.kind,
      'on',
      urls.length,
      'relay(s):',
      err,
    );
  }

  const acceptedSet = new Set(Array.isArray(accepted) ? accepted : []);
  return urls.map((url) => {
    const ok = acceptedSet.has(url);
    return {
      relay: url,
      ok,
      error: ok ? null : (publishError?.message || 'Relay did not accept'),
    };
  });
}

/**
 * Convenience predicate: did at least one relay accept this event?
 *
 * Per the product rule, a profile-publish is considered successful if
 * *any* relay accepts. That keeps a single flaky relay from making the
 * user feel like the action failed when it actually landed.
 *
 * @param {readonly RelayPublishResult[]} results
 * @returns {boolean}
 */
export function anyAccepted(results) {
  return Array.isArray(results) && results.some((r) => r.ok);
}
