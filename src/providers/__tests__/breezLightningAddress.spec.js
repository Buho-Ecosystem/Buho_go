/**
 * Spark pays a Lightning address on the shared LNURL-pay path
 * (utils/lnurlPay.js): the REAL provider against a scripted web service, with
 * the SDK payment stood in for. A refusal keeps the service's reason, and an
 * invoice for any other amount than the one confirmed is never paid. The
 * route fee is held to a limit: the one the Send sheet shows for an address
 * or link, and the same rule when nothing was shown at all.
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

/**
 * A wallet whose real payInvoice runs against a scripted SDK: every route
 * costs `routeFeeSats`, and `sent` records what reached the SDK's send.
 */
function sparkWithRoute(routeFeeSats, { engineAmount } = {}) {
  const sent = [];
  const sdk = {
    async prepareSendPayment() {
      return {
        paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: routeFeeSats, sparkTransferFeeSats: undefined },
        ...(engineAmount === undefined ? {} : { amount: engineAmount }),
      };
    },
    async sendPayment(request) {
      sent.push(request);
      return { payment: { id: 'p-2', status: 'completed', fees: routeFeeSats } };
    },
  };
  const provider = new BreezSparkWalletProvider('w-test', { name: 'test', _testSdk: sdk });
  provider.isConnected = true;
  return { provider, sent };
}

const aboveLimit = (feeSats, limitSats) => (error) =>
  error.code === 'LIGHTNING_FEE_ABOVE_LIMIT' && error.feeSats === feeSats && error.limitSats === limitSats;

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

await test('an address holds its route to the limit the sheet showed: 1 % of the amount, at least 10 sats', async () => {
  reset(answer(PAY_REQUEST), answer({ pr: invoiceFor(2000) }));
  const within = sparkWithRoute(20);
  const result = await within.provider.payLightningAddress('alice@example.com', 2000);
  assert.equal(within.sent.length, 1);
  assert.equal(result.invoiceSats, 2000);

  reset(answer(PAY_REQUEST), answer({ pr: invoiceFor(2000) }));
  const above = sparkWithRoute(21);
  await assert.rejects(above.provider.payLightningAddress('alice@example.com', 2000), aboveLimit(21, 20));
  assert.equal(above.sent.length, 0, 'nothing reached the send');

  reset(answer(PAY_REQUEST), answer({ pr: invoiceFor(100) }));
  const small = sparkWithRoute(10);
  await small.provider.payLightningAddress('alice@example.com', 100);
  assert.equal(small.sent.length, 1, 'a small payment may still cost 10 sats');
});

await test('in the recipient\'s currency, the limit is of the estimate confirmed, and the invoice amount comes back', async () => {
  // Confirmed about 2,000 sats; the invoice adds the service's fee (2,060).
  // The sheet showed "Up to" 20 sats, so 20 is the limit, not 1 % of 2,060.
  reset(answer({ ...PAY_REQUEST, currency: { code: 'KES', multiplier: 700 } }), answer({ pr: invoiceFor(2060) }));
  const payout = sparkWithRoute(20);
  const result = await payout.provider.payLightningAddress('254700000000@payout.example', 2000, '', { code: 'KES', amount: 2857 });
  assert.equal(result.invoiceSats, 2060);

  reset(answer({ ...PAY_REQUEST, currency: { code: 'KES', multiplier: 700 } }), answer({ pr: invoiceFor(2060) }));
  const above = sparkWithRoute(21);
  await assert.rejects(above.provider.payLightningAddress('254700000000@payout.example', 2000, '', { code: 'KES', amount: 2857 }), aboveLimit(21, 20));
  assert.equal(above.sent.length, 0);
});

await test('an invoice paid with no fee shown has the same limit; a fee shown as a quote keeps its 5 sats of headroom', async () => {
  const unshown = sparkWithRoute(51);
  await assert.rejects(unshown.provider.payInvoice({ invoice: invoiceFor(5000) }), aboveLimit(51, 50));
  assert.equal(unshown.sent.length, 0, 'batch send, Auto-Transfer and purchases never pay an unbounded fee');
  const unshownWithin = sparkWithRoute(50);
  await unshownWithin.provider.payInvoice({ invoice: invoiceFor(5000) });
  assert.equal(unshownWithin.sent.length, 1);

  const quoted = sparkWithRoute(15);
  await quoted.provider.payInvoice({ invoice: invoiceFor(5000), maxFee: 10 });
  assert.equal(quoted.sent.length, 1, 'a refreshed quote within 5 sats of the one shown still pays');
  const requoted = sparkWithRoute(16);
  await assert.rejects(requoted.provider.payInvoice({ invoice: invoiceFor(5000), maxFee: 10 }), aboveLimit(16, 15));

  // An invoice this decoder cannot read, but the engine can: the cap is of
  // the amount the engine is about to send, and the limit's floor without one.
  const quiet = console.warn;
  console.warn = () => {};
  try {
    const unreadable = sparkWithRoute(51, { engineAmount: 5000n });
    await assert.rejects(unreadable.provider.payInvoice({ invoice: 'lnbc-unreadable-here' }), aboveLimit(51, 50));
    const unknown = sparkWithRoute(11);
    await assert.rejects(unknown.provider.payInvoice({ invoice: 'lnbc-unreadable-here' }), aboveLimit(11, 10));
    assert.equal(unreadable.sent.length + unknown.sent.length, 0, 'never an unbounded fee');
  } finally {
    console.warn = quiet;
  }

  const amountless = sparkWithRoute(10);
  await assert.rejects(amountless.provider.payInvoice({ invoice: invoiceFor(0), amountSats: 900, feeLimitSats: 9 }), aboveLimit(10, 9));
  assert.equal(amountless.sent.length, 0, 'a limit the person was shown holds as it is');
});

await test('an address that cannot be one is never requested', async () => {
  for (const address of ['alice@evil.example/x?', 'a/b@example.com', 'alice']) {
    reset();
    await assert.rejects(sparkWallet().payLightningAddress(address, 21), /Invalid Lightning address/);
    assert.deepEqual(asked, []);
  }
});

await test('a till that asks for a refund address gets the one the person chose, and says it went', async () => {
  const asks = { ...PAY_REQUEST, minSendable: 81000, maxSendable: 81000, payerData: { identifier: { mandatory: false } } };
  reset(answer(asks), answer({ pr: invoiceFor(81) }));
  const spark = sparkWallet();
  const result = await spark.payLightningAddress('0002010122TSHP6SJNKTR3IY%2Fconfirm6304821D@cryptoqr.net', 81, '', null,
    { payerData: { identifier: 'maria@buho.example' } });
  assert.equal(asked[1], `${PAY_REQUEST.callback}?amount=81000&payerdata=${encodeURIComponent('{"identifier":"maria@buho.example"}')}`);
  assert.deepEqual(spark.paid, [invoiceFor(81)]);
  assert.deepEqual(result.payerData, { identifier: 'maria@buho.example' });

  reset(answer(asks), answer({ pr: invoiceFor(81) }));
  const declined = await sparkWallet().payLightningAddress('0002010122TSHP6SJNKTR3IY%2Fconfirm6304821D@cryptoqr.net', 81);
  assert.equal(asked[1], `${PAY_REQUEST.callback}?amount=81000`, 'declined: nothing goes');
  assert.equal(declined.payerData, null);
});

await test('a service that insists on details is refused before an invoice is asked for, and nothing is paid', async () => {
  for (const payerData of [{ identifier: { mandatory: true } }, { email: { mandatory: true } }]) {
    reset(answer({ ...PAY_REQUEST, payerData }));
    const spark = sparkWallet();
    const error = await spark.payLightningAddress('alice@example.com', 21).catch((e) => e);
    assert.ok([PAY_REQUEST_ERROR.PAYER_DATA_REQUIRED, PAY_REQUEST_ERROR.PAYER_DATA_UNSUPPORTED].includes(error.code), error.message);
    assert.equal(asked.length, 1, 'only the pay request was read');
    assert.deepEqual(spark.paid, []);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
// Explicit exit either way: the fiat-rate service's module-scope refresh
// interval holds the event loop open.
process.exit(failed > 0 ? 1 : 0);
