import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSparkNetworkObserver, isSparkHost } from '../sparkNetwork.js';

test('Spark operator and SSP hosts are recognised; others are not', () => {
  for (const h of ['0.spark.lightspark.com', '2.spark.flashnet.xyz', 'spark-operator.breez.technology', 'api.lightspark.com']) assert.equal(isSparkHost(h), true, h);
  for (const h of ['mempool.space', 'btc.mybuho.de', 'getalby.com', 'localhost:9012', 'sparkly.example']) assert.equal(isSparkHost(h), false, h);
});

test('observes without changing requests or responses', async () => {
  const o = createSparkNetworkObserver();
  const response = { status: 200 };
  const fetchImpl = async () => response;
  const wrapped = o.wrap(fetchImpl);
  assert.equal(o.wrap(wrapped), wrapped, 'wrapping twice is a no-op');
  assert.equal(await wrapped('https://0.spark.lightspark.com/rpc'), response);
  await assert.rejects(o.wrap(async () => { throw new TypeError('Failed to fetch'); })('https://0.spark.lightspark.com/x'), /Failed to fetch/);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([o.snapshot().ok, o.snapshot().failed], [1, 1]);
});

test('offline sync: requests fail, so Spark did not answer even though the SDK resolved', async () => {
  const o = createSparkNetworkObserver();
  const offline = o.wrap(async () => { throw new TypeError('Failed to fetch'); });
  const before = o.snapshot();
  await Promise.allSettled([offline('https://0.spark.lightspark.com/a'), offline('https://api.lightspark.com/graphql')]);
  await new Promise((r) => setImmediate(r));
  assert.equal(o.answeredBetween(before, o.snapshot()), false);
  assert.equal(o.answeredBetween(before, before), false, 'no traffic at all is not evidence');
});

test('a healthy sync with one flaky request still counts; non-Spark traffic never does', async () => {
  const o = createSparkNetworkObserver();
  let n = 0;
  const net = o.wrap(async (url) => { if (++n === 2) throw new Error('reset'); return { status: 200 }; });
  const before = o.snapshot();
  await Promise.allSettled(['a', 'b', 'c', 'd'].map((p) => net(`https://0.spark.lightspark.com/${p}`)));
  await net('https://mempool.space/api/v1/fees/recommended');
  await new Promise((r) => setImmediate(r));
  assert.equal(o.answeredBetween(before, o.snapshot()), true);
  const quiet = createSparkNetworkObserver();
  await quiet.wrap(async () => ({}))('https://mempool.space/x');
  assert.equal(quiet.answeredRecently(), false);
});
