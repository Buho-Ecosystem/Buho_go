/**
 * Ask each Spark operator directly whether it answers (#381).
 *
 * This runs outside the Breez SDK on purpose: it gives evidence even when
 * no wallet is connected, and it does not depend on how the SDK reports
 * its own failures. Any HTTP answer, whatever its status, proves the host
 * is reachable; only a transport failure or a timeout counts as failed.
 *
 * The hosts are the mainnet signing operators compiled into the Breez SDK
 * (src/utils/__tests__/sparkOperators.spec.js checks them against the
 * installed SDK, so an SDK bump that changes them fails the tests).
 */

export const SPARK_OPERATOR_URLS = Object.freeze([
  'https://0.spark.lightspark.com/',
  'https://2.spark.flashnet.xyz/',
  'https://spark-operator.breez.technology/',
]);

export const OPERATOR_TIMEOUT_MS = 5000;

/**
 * The page's fetch without the Spark traffic observer: a probe answer must
 * never make a concurrent SDK sync look answered (utils/sparkNetwork).
 */
function defaultRequest(url, init) {
  const f = globalThis.fetch?.unobserved || globalThis.fetch;
  return f(url, init);
}

/**
 * @param {object} [options]
 * @param {Function} [options.request] fetch, replaceable in tests
 * @param {string[]} [options.urls]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ total:number, failed:number }>}
 */
export async function probeSparkOperators({ request = defaultRequest, urls = SPARK_OPERATOR_URLS, timeoutMs = OPERATOR_TIMEOUT_MS } = {}) {
  const results = await Promise.all(urls.map(url => answers(url, request, timeoutMs)));
  return { total: urls.length, failed: results.filter(ok => !ok).length };
}

async function answers(url, request, timeoutMs) {
  // AbortController, not AbortSignal.timeout: iOS 15 lacks the latter.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await request(url, {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
