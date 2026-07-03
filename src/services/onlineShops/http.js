/**
 * Minimal timeout-aware fetch helpers for the online-shops adapters. All
 * sources are keyless public GETs, so this stays tiny: an AbortController for
 * the timeout, chained to a caller-provided signal so closing the page stops
 * in-flight requests.
 */

const DEFAULT_TIMEOUT_MS = 15000;

function linkedController(signal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const cleanup = () => {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  };
  return { controller, cleanup };
}

async function request(url, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, headers } = {}) {
  const { controller, cleanup } = linkedController(signal, timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`GET ${url} failed: HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  } finally {
    cleanup();
  }
}

export async function fetchJson(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  return res.json();
}

export async function fetchText(url, opts = {}) {
  const res = await request(url, opts);
  return res.text();
}
