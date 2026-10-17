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
 *
 * A response is not always an answer (#381): 5xx (an overloaded operator or
 * a proxy's error page), 429 (rate limited) and 401 (key refused) mean
 * Spark did not serve the request, so they are counted apart as server
 * errors and never as evidence that Spark answered.
 */

/** HTTP statuses that reached a server but got no service from it. */
export function isServerError(status) {
  const code = Number(status);
  return code >= 500 || code === 429 || code === 401;
}

/** Spark operators and the Lightspark SSP the SDK talks to while syncing. */
export function isSparkHost(host) {
  const h = String(host || '').toLowerCase();
  return /(^|\.)spark\.[a-z0-9-]+\.[a-z]{2,}$/.test(h)
    || h === 'spark-operator.breez.technology'
    || h === 'api.lightspark.com';
}

export function createSparkNetworkObserver({ isSpark = isSparkHost, now = () => Date.now() } = {}) {
  const counters = { ok: 0, failed: 0, serverErrors: 0, lastOkAt: null, lastFailedAt: null };

  function between(before, after) {
    const delta = (field) => (after?.[field] ?? 0) - (before?.[field] ?? 0);
    return { ok: delta('ok'), failed: delta('failed'), serverErrors: delta('serverErrors') };
  }

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
            (response) => {
              if (isServerError(response?.status)) {
                counters.serverErrors += 1;
                counters.lastFailedAt = now();
              } else {
                counters.ok += 1;
                counters.lastOkAt = now();
              }
            },
            () => { counters.failed += 1; counters.lastFailedAt = now(); },
          );
        }
        return promise;
      };
      observed.__sparkObserved = true;
      // Requests that must not count as Spark traffic (the reachability
      // probes in utils/sparkOperators) go through the original.
      observed.unobserved = fetchImpl;
      return observed;
    },

    snapshot() {
      return { ...counters };
    },

    /**
     * Did Spark answer between two snapshots? Answers must outnumber
     * transport failures and server errors (one flaky request in a healthy sync is not an
     * outage; offline, every request fails). No traffic at all is
     * "unknown", reported as false: an unverified sync is not fresh.
     */
    answeredBetween(before, after) {
      const { ok, failed, serverErrors } = between(before, after);
      return ok > 0 && failed + serverErrors < ok;
    },

    /** What happened between two snapshots: answers, transport failures, server errors. */
    between,

    /** Spark answered recently and nothing failed since. */
    answeredRecently(windowMs = 30000) {
      const t = now();
      return counters.lastOkAt != null
        && t - counters.lastOkAt <= windowMs
        && (counters.lastFailedAt == null || counters.lastFailedAt < counters.lastOkAt);
    },
  };
}
