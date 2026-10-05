/**
 * Evidence that Spark actually answered (#291).
 *
 * Measured against the pinned Breez SDK 0.25.0 in a browser: with the
 * network cut, `syncWallet()` still resolves (in ~0.2 s instead of ~2.5 s)
 * and the SDK still emits `synced` — sync failures are swallowed inside the
 * SDK. A resolved sync is therefore not proof of fresh data or of Spark
 * health. What is: the HTTP exchanges with Spark operators/SSP that the SDK
 * makes while syncing. The WASM SDK performs them through the page's
 * `fetch`, so a transparent wrapper can count, per host class, which
 * requests got a response and which failed in transport.
 *
 * The wrapper never changes a request or a response; it only observes the
 * returned promise. It records no URLs, bodies or payloads.
 */

/** Spark operators and the Lightspark SSP the SDK talks to while syncing. */
export function isSparkHost(host) {
  const h = String(host || '').toLowerCase();
  return /(^|\.)spark\.[a-z0-9-]+\.[a-z]{2,}$/.test(h)
    || h === 'spark-operator.breez.technology'
    || h === 'api.lightspark.com';
}

export function createSparkNetworkObserver({ isSpark = isSparkHost, now = () => Date.now() } = {}) {
  const counters = { ok: 0, failed: 0, lastOkAt: null, lastFailedAt: null };

  function hostOf(input) {
    try {
      const url = typeof input === 'string' ? input : (input?.url || String(input));
      return new URL(url, 'http://localhost').host;
    } catch {
      return '';
    }
  }

  return {
    /** Wrap a fetch implementation; the result is a drop-in replacement. */
    wrap(fetchImpl) {
      if (fetchImpl?.__sparkObserved) return fetchImpl;
      const observed = function observedFetch(input, init) {
        const promise = fetchImpl.apply(this, arguments);
        if (isSpark(hostOf(input))) {
          promise.then(
            () => { counters.ok += 1; counters.lastOkAt = now(); },
            () => { counters.failed += 1; counters.lastFailedAt = now(); },
          );
        }
        return promise;
      };
      observed.__sparkObserved = true;
      return observed;
    },

    snapshot() {
      return { ...counters };
    },

    /**
     * Did Spark answer between two snapshots? Responses must outnumber
     * transport failures (one flaky request in a healthy sync is not an
     * outage; offline, every request fails). No traffic at all is
     * "unknown", reported as false: an unverified sync is not fresh.
     */
    answeredBetween(before, after) {
      const ok = (after?.ok ?? 0) - (before?.ok ?? 0);
      const failed = (after?.failed ?? 0) - (before?.failed ?? 0);
      return ok > 0 && failed < ok;
    },

    /** Spark answered recently and nothing failed since. */
    answeredRecently(windowMs = 30000) {
      const t = now();
      return counters.lastOkAt != null
        && t - counters.lastOkAt <= windowMs
        && (counters.lastFailedAt == null || counters.lastFailedAt < counters.lastOkAt);
    },
  };
}
