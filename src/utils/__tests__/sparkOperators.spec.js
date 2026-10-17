import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { probeSparkOperators, SPARK_OPERATOR_URLS } from '../sparkOperators.js';
import { createSparkNetworkObserver } from '../sparkNetwork.js';

test('the probed hosts are the operators compiled into the installed SDK', () => {
  const binary = new URL('../../../node_modules/@breeztech/breez-sdk-spark/web/breez_sdk_spark_wasm_bg.wasm', import.meta.url);
  const wasm = readFileSync(binary).toString('latin1');
  for (const url of SPARK_OPERATOR_URLS) {
    assert.ok(wasm.includes(url.replace(/\/$/, '')), `${url} is no longer a Spark operator in the SDK`);
  }
  assert.equal(SPARK_OPERATOR_URLS.length, 3);
});

test('any HTTP answer counts as reachable; transport failures and timeouts do not', async () => {
  const answers = {
    [SPARK_OPERATOR_URLS[0]]: () => Promise.resolve({ type: 'opaque', status: 0 }),
    [SPARK_OPERATOR_URLS[1]]: () => Promise.reject(new TypeError('Failed to fetch')),
    [SPARK_OPERATOR_URLS[2]]: (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
  };
  const started = Date.now();
  const result = await probeSparkOperators({ request: (url, init) => answers[url](init.signal), timeoutMs: 40 });
  assert.deepEqual(result, { total: 3, failed: 2 });
  assert.ok(Date.now() - started < 1000, 'a hanging host is given up');
});

test('a probe is a bare HEAD: no credentials, no referrer, no cached answer', async () => {
  const sent = [];
  await probeSparkOperators({ request: (url, init) => { sent.push({ url, ...init }); return Promise.resolve({}); } });
  assert.deepEqual(sent.map((s) => s.url), [...SPARK_OPERATOR_URLS]);
  for (const s of sent) {
    assert.deepEqual([s.method, s.mode, s.cache, s.credentials, s.referrerPolicy], ['HEAD', 'no-cors', 'no-store', 'omit', 'no-referrer']);
  }
});

test('probes bypass the Spark traffic observer, so they never vouch for a sync', async () => {
  const observer = createSparkNetworkObserver();
  const original = globalThis.fetch;
  let raw = 0;
  globalThis.fetch = observer.wrap(async () => { raw += 1; return { status: 405 }; });
  try {
    const before = observer.snapshot();
    const result = await probeSparkOperators();
    assert.deepEqual(result, { total: 3, failed: 0 });
    assert.equal(raw, 3);
    assert.deepEqual(observer.between(before, observer.snapshot()), { ok: 0, failed: 0, serverErrors: 0 });
  } finally {
    globalThis.fetch = original;
  }
});
