/**
 * Spark pays a Lightning address on the shared LNURL-pay path
 * (utils/lnurlPay.js): the REAL provider against a scripted web service, with
 * the SDK payment stood in for. A refusal keeps the service's reason, and an
 * invoice for any other amount than the one confirmed is never paid.
 *
 * Run directly with Node (like the other provider specs):
 *   node src/providers/__tests__/breezLightningAddress.spec.js
 */
import assert from 'node:assert/strict';
import { PAY_REQUEST_ERROR } from '../../utils/lnurlPay.js';
import { isCounterpartyError } from '../../utils/errorOrigin.js';
import { PAY_REQUEST, invoiceFor } from '../../utils/__tests__/lnurlPayFixtures.js';

// The provider's import graph touches browser storage at module scope.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/**
 * The web: each test scripts what the next LNURL requests answer. Anything
 * else (the fiat-rate service fetches at module scope) stays offline and
 * never takes a scripted answer.
 */
const LNURL_HOSTS = new Set(['example.com', 'pay.example', 'cryptoqr.net', 'payout.example']);
let script = [];
const asked = [];
globalThis.fetch = async (url) => {
  if (!LNURL_HOSTS.has(new URL(String(url)).hostname)) throw new TypeError('Failed to fetch');
  asked.push(String(url));
  const next = script.shift();
  if (!next) throw new TypeError('Failed to fetch');
  return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
};
const answer = (body, status = 200) => ({ body, status });

const { BreezSparkWalletProvider } = await import('../BreezSparkWalletProvider.js');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed += 1;
  }
}

console.log('breez Lightning address payments');

function sparkWallet() {
  const provider = new BreezSparkWalletProvider('w-test', { name: 'test', _testSdk: {} });
  provider.isConnected = true;
  provider.paid = [];
  provider.payInvoice = async ({ invoice }) => { provider.paid.push(invoice); return { id: 'p-1', status: 'completed' }; };
  return provider;
}

function reset(...answers) {
  script = answers;
  asked.length = 0;
}

await test('pays the invoice it asked for, with the comment, and keeps the success message', async () => {
  reset(answer(PAY_REQUEST), answer({ pr: invoiceFor(21), successAction: { tag: 'message', message: 'Thanks' }, verify: 'https://pay.example/v/1' }));
  const spark = sparkWallet();
  const result = await spark.payLightningAddress('alice@example.com', 21, 'hi');
  assert.deepEqual(asked, ['https://example.com/.well-known/lnurlp/alice', `${PAY_REQUEST.callback}?amount=21000&comment=hi`]);
  assert.deepEqual(spark.paid, [invoiceFor(21)]);
  assert.deepEqual(result.successAction, { tag: 'message', message: 'Thanks' });
  assert.equal(result.verify, 'https://pay.example/v/1');
  assert.equal(result.lightningAddress, 'alice@example.com');
});

await test('an invoice for more than confirmed is never paid', async () => {
  reset(answer(PAY_REQUEST), answer({ pr: invoiceFor(21000) }));
  const spark = sparkWallet();
  await assert.rejects(spark.payLightningAddress('alice@example.com', 21), (error) => error.code === PAY_REQUEST_ERROR.INVOICE_MISMATCH);
  assert.deepEqual(spark.paid, []);
});

await test('the service\'s reason survives its HTTP 500, and nothing is paid', async () => {
  reset(answer(PAY_REQUEST), answer({ status: 'ERROR', reason: 'Could not validate refund address' }, 500));
  const spark = sparkWallet();
  const error = await spark.payLightningAddress('alice@example.com', 81).catch((e) => e);
  assert.equal(error.message, 'Could not validate refund address');
  assert.equal(isCounterpartyError(error), true);
  assert.deepEqual(spark.paid, []);
});

await test('a till code goes out encoded once', async () => {
  reset(answer({ ...PAY_REQUEST, minSendable: 81000, maxSendable: 81000 }), answer({ pr: invoiceFor(81) }));
  const spark = sparkWallet();
  await spark.payLightningAddress('0002010122TSHP6SJNKTR3IY%2Fconfirm6304821D@cryptoqr.net', 81);
  assert.equal(asked[0], 'https://cryptoqr.net/.well-known/lnurlp/0002010122TSHP6SJNKTR3IY%2Fconfirm6304821D');
  assert.deepEqual(spark.paid, [invoiceFor(81)]);
});

await test('in the recipient\'s currency, the currency must still be on offer', async () => {
  reset(answer({ ...PAY_REQUEST, currency: { code: 'KES', multiplier: 700 } }), answer({ pr: invoiceFor(730) }));
  const spark = sparkWallet();
  await spark.payLightningAddress('254700000000@payout.example', 700, '', { code: 'KES', amount: 1000 });
  assert.equal(asked[1], `${PAY_REQUEST.callback}?amount=1000&currency=KES`);
  assert.deepEqual(spark.paid, [invoiceFor(730)]);

  // The sheet showed about 700 sats; an invoice for 7,000 is not what was agreed.
  // (Each payment gets the wallet as the app hands it over, connected.)
  reset(answer({ ...PAY_REQUEST, currency: { code: 'KES', multiplier: 700 } }), answer({ pr: invoiceFor(7000) }));
  const overcharged = sparkWallet();
  await assert.rejects(overcharged.payLightningAddress('254700000000@payout.example', 700, '', { code: 'KES', amount: 1000 }),
    (error) => error.code === PAY_REQUEST_ERROR.INVOICE_MISMATCH);
  assert.deepEqual(overcharged.paid, [], 'nothing was paid');

  reset(answer(PAY_REQUEST));
  await assert.rejects(sparkWallet().payLightningAddress('254700000000@payout.example', 700, '', { code: 'KES', amount: 1000 }),
    (error) => error.code === PAY_REQUEST_ERROR.CURRENCY_UNAVAILABLE);
  assert.equal(asked.length, 1, 'never asked for an invoice in a currency the service does not offer');
});

await test('an address that cannot be one is never requested', async () => {
  for (const address of ['alice@evil.example/x?', 'a/b@example.com', 'alice']) {
    reset();
    await assert.rejects(sparkWallet().payLightningAddress(address, 21), /Invalid Lightning address/);
    assert.deepEqual(asked, []);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
// Explicit exit either way: the fiat-rate service's module-scope refresh
// interval holds the event loop open.
process.exit(failed > 0 ? 1 : 0);
