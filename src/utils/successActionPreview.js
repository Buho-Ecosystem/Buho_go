/**
 * In-app preview for a LUD-09 `url` successAction.
 *
 * BuhoGO never opens an external browser, so instead of navigating to the
 * merchant's URL we fetch it and classify the response so the UI can render it
 * inline:
 *   image/*               → { kind: 'image' }   (UI renders <img :src=url>)
 *   text/*, json, xml     → { kind: 'text', text }   (capped; Vue escapes it)
 *   anything else / error → { kind: 'link' }    (UI shows the host + Copy link)
 *
 * Routes through CapacitorHttp on native (its CORS bypass + native HTTP stack);
 * falls back to window.fetch on web. A cheap HEAD probe avoids pulling an
 * image's bytes just to read its content type. Bounded by a timeout and a
 * text-size cap. The url is already domain-validated against the LNURL callback
 * upstream (see parseSuccessAction), so this only ever fetches the same service
 * the user just paid.
 */

function isImageType(ct) {
  return /^image\//i.test(ct || '');
}

function isTextType(ct) {
  return /^text\//i.test(ct || '')
    || /application\/(json|xml|[\w.+-]*\+json|[\w.+-]*\+xml)/i.test(ct || '');
}

/** Case-insensitive header lookup over CapacitorHttp's plain-object headers. */
function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key] || '';
  }
  return '';
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ]);
}

/**
 * Resolve an HTTP client with `head` and `getText` methods, preferring
 * CapacitorHttp on native (CORS bypass) and falling back to window.fetch.
 */
async function resolveHttpClient() {
  let CapacitorHttp = null;
  try {
    const cap = await import('@capacitor/core');
    if (cap?.Capacitor?.isNativePlatform?.()) CapacitorHttp = cap.CapacitorHttp;
  } catch {
    // Not running inside Capacitor — use the web fetch client below.
  }

  if (CapacitorHttp) {
    return {
      async head(url, timeoutMs) {
        const res = await withTimeout(CapacitorHttp.request({ method: 'HEAD', url }), timeoutMs);
        return headerValue(res?.headers, 'content-type');
      },
      async getText(url, timeoutMs, maxTextChars) {
        const res = await withTimeout(CapacitorHttp.get({ url, responseType: 'text' }), timeoutMs);
        const contentType = headerValue(res?.headers, 'content-type');
        const data = res?.data;
        const text = (typeof data === 'string' ? data : data == null ? '' : JSON.stringify(data))
          .slice(0, maxTextChars);
        return { contentType, text };
      },
    };
  }

  const fetchWithTimeout = (url, timeoutMs, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };

  return {
    async head(url, timeoutMs) {
      const res = await fetchWithTimeout(url, timeoutMs, { method: 'HEAD' });
      return res.headers.get('content-type') || '';
    },
    async getText(url, timeoutMs, maxTextChars) {
      const res = await fetchWithTimeout(url, timeoutMs, {});
      const contentType = res.headers.get('content-type') || '';
      const text = isTextType(contentType) ? (await res.text()).slice(0, maxTextChars) : '';
      return { contentType, text };
    },
  };
}

/**
 * Fetch and classify a `url` successAction target for inline preview.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number, maxTextChars?: number }} [opts]
 * @returns {Promise<{ kind: 'image' | 'text' | 'link', text?: string, error?: boolean }>}
 */
export async function fetchSuccessActionPreview(url, { timeoutMs = 8000, maxTextChars = 8000 } = {}) {
  try {
    const client = await resolveHttpClient();

    // Cheap HEAD first: an image needs no body (the UI renders <img :src=url>),
    // and a known non-text type can skip straight to the link fallback.
    let contentType = '';
    try {
      contentType = await client.head(url, timeoutMs);
    } catch {
      contentType = '';
    }
    if (isImageType(contentType)) return { kind: 'image' };
    if (contentType && !isTextType(contentType)) return { kind: 'link' };

    // Textual or unknown content type → pull the (capped) body and show it.
    const body = await client.getText(url, timeoutMs, maxTextChars);
    if (isImageType(body.contentType)) return { kind: 'image' };
    if (isTextType(body.contentType) || (!body.contentType && body.text)) {
      return { kind: 'text', text: body.text };
    }
    return { kind: 'link' };
  } catch {
    return { kind: 'link', error: true };
  }
}
