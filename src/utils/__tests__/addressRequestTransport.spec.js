import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Execute the production transport with only the Capacitor bridge replaced.
// Both adapters must stop redirects before disclosing to a second recipient.
function transport(native, get) {
  const source = readFileSync(new URL('../lnurlHttp.js', import.meta.url), 'utf8');
  const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.equal(name, '@capacitor/core');
    return { Capacitor: { isNativePlatform: () => native }, CapacitorHttp: { get } };
  }, module, module.exports);
  return module.exports;
}

test('native submission disables redirects and bounds the socket', async () => {
  const api = transport(true, async options => {
    assert.equal(options.disableRedirects, true);
    assert.equal(options.readTimeout, 15000);
    assert.equal(options.connectTimeout, 15000);
    return { status: 302, data: '' };
  });
  assert.equal((await api.lnurlGetJson('https://example.com/share', { disableRedirects: true, timeoutMs: 15000 })).ok, false);
});

test('web submission disallows redirects, cookies and referrer disclosure', async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async (_, options) => {
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.referrerPolicy, 'no-referrer');
      return { ok: true, status: 200, json: async () => ({ status: 'OK' }) };
    };
    const api = transport(false);
    assert.equal((await api.lnurlGetJson('https://example.com/share', { disableRedirects: true })).data.status, 'OK');
  } finally { globalThis.fetch = saved; }
});

test('external cancellation stops waiting for native metadata and ignores its late response', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let finish;
  const api = transport(true, () => { started(); return new Promise(resolve => { finish = resolve; }); });
  const controller = new AbortController();
  const request = api.lnurlGetJson('https://example.com/metadata', { signal: controller.signal });
  await ready; controller.abort();
  await assert.rejects(request, error => error.name === 'AbortError');
  finish({ status: 200, data: { status: 'OK' } });
});

test('ordinary LNURL callers retain their redirect behavior', async () => {
  const api = transport(true, async options => {
    assert.equal(options.disableRedirects, false);
    return { status: 200, data: {} };
  });
  assert.equal((await api.lnurlGetJson('https://example.com/pay')).ok, true);
});
