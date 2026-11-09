/**
 * The LNURL-pay request path (utils/lnurlPay.js): the one place every send
 * asks a service for its pay request and its invoice.
 *
 * Run: node --test src/utils/__tests__/lnurlPay.spec.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  PAYOUT_FEE_ALLOWANCE_PERCENT,
  PAY_REQUEST_ERROR,
  buildLnurlPayCallbackUrl,
  fetchPayRequest,
  fitComment,
  isStoreablePayLink,
  lightningAddressUrl,
  linkAmountSats,
  payoutCeilingSats,
  readPayRequest,
  requestPayInvoice,
} from '../lnurlPay.js';
import { isCounterpartyError } from '../errorOrigin.js';
import { INVOICE_TIME, PAY_REQUEST, failed, fakeService, invoiceFor, metadataHash, ok } from './lnurlPayFixtures.js';

/** The provider's own test till code, as the Send sheet hands it over. */
const TILL_ADDRESS = '00020129530023za.co.electrum.picknpay0122TSHP6SJNKTR3IY%2Fconfirm520458125303710540115802ZA5916cryptoqrtestscan6002CT6304821D@cryptoqr.net';

const withCode = (code) => (error) => error?.code === code;
const refusedWith = (reason) => (error) => error.message === reason && isCounterpartyError(error) && !error.code;

describe('a Lightning address becomes one URL on its own host', () => {
  test('name and domain go where LUD-16 puts them', () => {
    assert.equal(lightningAddressUrl('alice@example.com'), 'https://example.com/.well-known/lnurlp/alice');
    assert.equal(lightningAddressUrl('  Alice@Example.COM  '), 'https://example.com/.well-known/lnurlp/Alice', 'the name keeps its case, the host does not need one');
    assert.equal(lightningAddressUrl('a.b-c_d+e@pay.sub.example.co.za'), 'https://pay.sub.example.co.za/.well-known/lnurlp/a.b-c_d+e');
  });

  test('a till code keeps its single encoding', () => {
    const url = lightningAddressUrl(TILL_ADDRESS);
    assert.ok(url.startsWith('https://cryptoqr.net/.well-known/lnurlp/00020129'));
    assert.ok(url.includes('TSHP6SJNKTR3IY%2Fconfirm'), 'not decoded');
    assert.ok(!url.includes('%25'), 'not encoded a second time');
    assert.equal(lightningAddressUrl("A!'()*~B@cryptoqr.net"), "https://cryptoqr.net/.well-known/lnurlp/A!'()*~B", 'what encodeURIComponent leaves alone is allowed');
    assert.equal(lightningAddressUrl('a..b%2Fc.d@example.com'), 'https://example.com/.well-known/lnurlp/a..b%2Fc.d', 'dots inside a segment are only dots');
    assert.equal(lightningAddressUrl('caf%C3%A9@example.com'), 'https://example.com/.well-known/lnurlp/caf%C3%A9', 'an encoded letter is a letter');
  });

  for (const text of [
    '', '   ', 'alice', '@example.com', 'alice@', 'a@b@example.com',
    'alice@localhost', 'alice@example.com:8080', 'alice@evil.example/x', 'alice@example.com?x', 'alice@exa_mple.com', 'alice@-example.com', 'alice@example..com',
    'a/b@example.com', 'a?b@example.com', 'a#b@example.com', 'a b@example.com', 'a\\b@example.com', 'lightning:alice@example.com',
    '.@example.com', '..@example.com', '%2e%2E@example.com', 'a%zz@example.com', 'a%2@example.com',
    // Decoded by a service before routing, these would leave the name's path.
    'alice%2f..%2fmallory@example.com', '%2e%2e%2f%2e%2e%2fapi%2fv1@example.com', 'a%2F.%2Fb@example.com', 'a%5Cb@example.com', 'a%00@example.com', 'a%ff@example.com',
    // Names that only exist inside a home or office network.
    'bob@foo.localhost', 'bob@printer.local', 'bob@vault.internal', 'bob@nas.lan', 'bob@intranet.corp', 'bob@1.0.0.127.in-addr.arpa',
  ]) {
    test(`not an address: ${JSON.stringify(text)}`, () => {
      assert.equal(lightningAddressUrl(text), null);
    });
  }

  test('not text at all', () => {
    for (const value of [null, undefined, 42, {}, ['alice@example.com']]) assert.equal(lightningAddressUrl(value), null);
  });
});

describe('reading a pay request', () => {
  test('keeps what it does not check, normalises what it does', () => {
    const payRequest = readPayRequest({ ...PAY_REQUEST, currency: { code: 'TZS', multiplier: 9 }, payerData: { identifier: { mandatory: false } } });
    assert.equal(payRequest.callback, PAY_REQUEST.callback);
    assert.equal(payRequest.minSendable, 1000);
    assert.equal(payRequest.maxSendable, 100000000);
    assert.equal(payRequest.commentAllowed, 32);
    assert.equal(payRequest.metadata, PAY_REQUEST.metadata);
    assert.deepEqual(payRequest.currency, { code: 'TZS', multiplier: 9, decimals: 0, symbol: 'TZS' });
    assert.deepEqual(payRequest.payerData, { identifier: { mandatory: false } });
  });

  test('limits a service leaves out keep the defaults every path has used', () => {
    for (const value of [undefined, null, 0, '']) {
      const payRequest = readPayRequest({ ...PAY_REQUEST, minSendable: value, maxSendable: value });
      assert.deepEqual([payRequest.minSendable, payRequest.maxSendable], [1000, 100000000000]);
    }
    assert.equal(readPayRequest({ ...PAY_REQUEST, minSendable: '5000' }).minSendable, 5000, 'digits sent as text');
  });

  test('a maximum too large to hold exactly means no real limit', () => {
    for (const maxSendable of [2 ** 60, 2100000000000000000, '18446744073709551615']) {
      assert.equal(readPayRequest({ ...PAY_REQUEST, maxSendable }).maxSendable, Number.MAX_SAFE_INTEGER, String(maxSendable));
    }
  });

  test('a refusal keeps the service\'s reason', () => {
    assert.throws(() => readPayRequest({ status: 'ERROR', reason: ' Shop is closed ' }), refusedWith('Shop is closed'));
    assert.throws(() => readPayRequest({ status: 'ERROR' }), (error) => error.code === PAY_REQUEST_ERROR.REFUSED && !isCounterpartyError(error));
    assert.throws(() => readPayRequest({ status: 'ERROR', reason: 42 }), withCode(PAY_REQUEST_ERROR.REFUSED));
  });

  for (const data of [null, undefined, 'payRequest', [], { tag: 'withdrawRequest', callback: PAY_REQUEST.callback }, { ...PAY_REQUEST, tag: undefined }]) {
    test(`not a pay request: ${JSON.stringify(data)}`, () => {
      assert.throws(() => readPayRequest(data), (error) => error.code === PAY_REQUEST_ERROR.NOT_PAY_REQUEST && !isCounterpartyError(error));
    });
  }

  for (const [name, limits] of [
    ['a negative minimum', { minSendable: -1 }],
    ['a fraction of a millisat', { minSendable: 1000.5 }],
    ['a minimum above the maximum', { minSendable: 5000, maxSendable: 4000 }],
    ['no whole sat in range', { minSendable: 81500, maxSendable: 81500 }],
    ['a minimum too big to be exact', { minSendable: 2 ** 60 }],
    ['words', { minSendable: 'lots' }],
    ['an object', { maxSendable: { msat: 1 } }],
  ]) {
    test(`unusable limits: ${name}`, () => {
      assert.throws(() => readPayRequest({ ...PAY_REQUEST, ...limits }), withCode(PAY_REQUEST_ERROR.INVALID));
    });
  }

  for (const [name, callback] of [
    ['missing', undefined],
    ['not text', 42],
    ['empty', '  '],
    ['plain http', 'http://pay.example/cb'],
    ['another scheme', 'javascript:alert(1)'],
    ['a file', 'file:///etc/passwd'],
    ['credentials', 'https://user:secret@pay.example/cb'],
    ['a fragment', 'https://pay.example/cb#x'],
    ['an empty fragment', 'https://pay.example/cb#'],
    ['its own amount', 'https://pay.example/cb?amount=99999000'],
    ['its own comment', 'https://pay.example/cb?k=1&comment=hi'],
    ['its own currency', 'https://pay.example/cb?currency=USD'],
    ['its own payer data', 'https://pay.example/cb?payerdata=%7B%7D'],
    ['its own amount, in capitals', 'https://pay.example/cb?AMOUNT=99999000'],
    ['its own currency, in any case', 'https://pay.example/cb?Currency=USD'],
    ['plain http to a host that only looks like an onion', 'http://a.b.onion/cb'],
    ['not a URL', 'pay.example/cb'],
  ]) {
    test(`unusable callback: ${name}`, () => {
      assert.throws(() => readPayRequest({ ...PAY_REQUEST, callback }), withCode(PAY_REQUEST_ERROR.INVALID));
    });
  }

  test('a .onion callback may use http (LUD-01)', () => {
    assert.equal(readPayRequest({ ...PAY_REQUEST, callback: 'http://abcdefghijklmnop.onion/cb' }).callback, 'http://abcdefghijklmnop.onion/cb');
  });

  test('a comment length that is not a positive whole number allows none', () => {
    for (const commentAllowed of [undefined, 0, -5, 1.5, null, 'lots', ' ', '-3', {}]) {
      assert.equal(readPayRequest({ ...PAY_REQUEST, commentAllowed }).commentAllowed, 0, JSON.stringify(commentAllowed));
    }
    assert.equal(readPayRequest({ ...PAY_REQUEST, commentAllowed: '255' }).commentAllowed, 255, 'digits sent as text');
  });

  test('a currency offer that cannot be shown or asked for is left out, so the person pays in Bitcoin', () => {
    for (const currency of [
      { code: 'TZS', multiplier: 0 }, { code: 'TZS', multiplier: -1 }, { code: 'TZS', multiplier: 'lots' }, { code: 'TZS' },
      { code: 'TZS', multiplier: 3700, decimals: 101 }, { code: 'TZS', multiplier: 3700, decimals: -1 }, { code: 'TZS', multiplier: 3700, decimals: 1.5 },
      { code: 'T&S', multiplier: 3700 }, { code: '', multiplier: 3700 }, { code: 'A'.repeat(13), multiplier: 3700 }, ['TZS'], 'TZS', null,
    ]) {
      assert.equal(readPayRequest({ ...PAY_REQUEST, currency }).currency, null, JSON.stringify(currency));
    }
  });

  test('a currency offer is read the way the sheet shows it', () => {
    const offer = readPayRequest({ ...PAY_REQUEST, currency: { code: ' KES ', multiplier: '7300.5', decimals: '2', symbol: 'Pay this now', minSendable: '10', maxSendable: -1, name: 'Shilling' } }).currency;
    assert.deepEqual(offer, { code: 'KES', multiplier: 7300.5, decimals: 2, symbol: 'KES', minSendable: 10, name: 'Shilling' });
    assert.equal(readPayRequest({ ...PAY_REQUEST, currency: { code: 'ZMW', multiplier: 50, symbol: 'K' } }).currency.symbol, 'K');
  });
});

describe('asking for the pay request', () => {
  test('one GET to the URL, with the caller\'s timeout and signal', async () => {
    const { get, asked } = fakeService(ok(PAY_REQUEST));
    const signal = new AbortController().signal;
    const payRequest = await fetchPayRequest('https://example.com/.well-known/lnurlp/alice', { get, timeoutMs: 10000, signal });
    assert.equal(payRequest.callback, PAY_REQUEST.callback);
    assert.deepEqual(asked, [{ url: 'https://example.com/.well-known/lnurlp/alice', options: { timeoutMs: 10000, signal } }]);
  });

  test('the provider\'s reason survives its HTTP 500', async () => {
    const { get } = fakeService(failed(500, { status: 'ERROR', reason: 'UNKNOWN_CODE: this code is not known' }));
    await assert.rejects(fetchPayRequest('https://cryptoqr.net/.well-known/lnurlp/x', { get }), refusedWith('UNKNOWN_CODE: this code is not known'));
  });

  test('an HTTP error without a reason says its status', async () => {
    for (const [answer, status] of [[failed(500), 500], [failed(404, { detail: 'not found' }), 404], [failed(429), 429], [failed(0), 0]]) {
      const { get } = fakeService(answer);
      await assert.rejects(fetchPayRequest('https://example.com/x', { get }), (error) => error.code === PAY_REQUEST_ERROR.HTTP
        && error.status === status && error.message === `Server returned ${status}` && !isCounterpartyError(error));
    }
  });

  test('a 200 that is not JSON, or not an object, is not a pay request', async () => {
    for (const data of [null, ['payRequest']]) {
      const { get } = fakeService(ok(data));
      await assert.rejects(fetchPayRequest('https://example.com/x', { get }), withCode(PAY_REQUEST_ERROR.NOT_PAY_REQUEST));
    }
  });

  test('a transport failure passes through untouched', async () => {
    const offline = new TypeError('Failed to fetch');
    const { get } = fakeService(offline);
    await assert.rejects(fetchPayRequest('https://example.com/x', { get }), (error) => error === offline);
  });

  test('only https, or http to .onion, is ever asked', async () => {
    for (const url of [null, '', 'http://example.com/x', 'ftp://example.com/x', 'https://u:p@example.com/x', 'not a url']) {
      const { get, asked } = fakeService();
      await assert.rejects(fetchPayRequest(url, { get }), /Invalid LNURL/);
      assert.deepEqual(asked, [], `${url} was never requested`);
    }
  });
});

describe('asking for the invoice', () => {
  const payRequest = readPayRequest(PAY_REQUEST);

  test('appends the amount and comment to the callback as written', async () => {
    const { get, asked } = fakeService(ok({ pr: invoiceFor(21) }));
    const invoice = await requestPayInvoice(payRequest, { amountSats: 21, comment: '  for coffee ' }, { get, timeoutMs: 5000 });
    assert.equal(asked[0].url, 'https://pay.example/lnurlp/cb/alice?amount=21000&comment=for%20coffee');
    assert.equal(asked[0].options.timeoutMs, 5000);
    assert.deepEqual(invoice, { pr: invoiceFor(21), amountSats: 21, successAction: null, verify: null, storeable: false, payerData: null });
  });

  test('the callback requested is the callback checked, as parsed', async () => {
    const parsed = readPayRequest({ ...PAY_REQUEST, callback: 'https://Pay.Example:443/a/../cb?k=%2F' });
    const { get, asked } = fakeService(ok({ pr: invoiceFor(5) }));
    await requestPayInvoice(parsed, { amountSats: 5 }, { get });
    assert.equal(asked[0].url, 'https://pay.example/cb?k=%2F&amount=5000');
  });

  test('the callback\'s own query keeps its exact encoding', async () => {
    const kept = readPayRequest({ ...PAY_REQUEST, callback: 'https://pay.example/cb?k1=a%2Fb+c&x=%7E' });
    const { get, asked } = fakeService(ok({ pr: invoiceFor(5) }));
    await requestPayInvoice(kept, { amountSats: 5 }, { get });
    assert.equal(asked[0].url, 'https://pay.example/cb?k1=a%2Fb+c&x=%7E&amount=5000');
  });

  test('a comment is cut to fit, never through an emoji, and only sent where allowed', async () => {
    const short = readPayRequest({ ...PAY_REQUEST, commentAllowed: 3 });
    const { get, asked } = fakeService(ok({ pr: invoiceFor(1) }), ok({ pr: invoiceFor(1) }), ok({ pr: invoiceFor(1) }));
    await requestPayInvoice(short, { amountSats: 1, comment: 'ab\u{1F600}cd' }, { get });
    assert.ok(asked[0].url.endsWith('&comment=ab'), 'the emoji would have been split, so it stays out');
    await requestPayInvoice(readPayRequest({ ...PAY_REQUEST, commentAllowed: 0 }), { amountSats: 1, comment: 'hello' }, { get });
    assert.ok(!asked[1].url.includes('comment='));
    await requestPayInvoice(payRequest, { amountSats: 1, comment: '   ' }, { get });
    assert.ok(!asked[2].url.includes('comment='));
  });

  test('a stray half of an emoji in a comment never stops the payment', async () => {
    const { get, asked } = fakeService(ok({ pr: invoiceFor(1) }));
    await requestPayInvoice(payRequest, { amountSats: 1, comment: 'thanks \ud800for \udfffcoffee' }, { get });
    assert.ok(asked[0].url.endsWith('&comment=thanks%20for%20coffee'), asked[0].url);
  });

  for (const amountSats of [0, -1, 1.5, NaN, Infinity, undefined, null, '', 'ten', true, 2 ** 53]) {
    test(`a bad amount is never sent: ${String(amountSats)}`, async () => {
      const { get, asked } = fakeService();
      await assert.rejects(requestPayInvoice(payRequest, { amountSats }, { get }), /Invalid amount/);
      assert.deepEqual(asked, []);
    });
  }

  test('an amount outside the limits is never sent, and says the limits', async () => {
    const narrow = readPayRequest({ ...PAY_REQUEST, minSendable: 10500, maxSendable: 2000000 });
    for (const amountSats of [10, 2001]) {
      const { get, asked } = fakeService();
      await assert.rejects(requestPayInvoice(narrow, { amountSats }, { get }), (error) => error.code === PAY_REQUEST_ERROR.AMOUNT_OUT_OF_RANGE
        && error.minSats === 11 && error.maxSats === 2000);
      assert.deepEqual(asked, []);
    }
  });

  test('the limits hold exactly at their edges', async () => {
    const narrow = readPayRequest({ ...PAY_REQUEST, minSendable: 11000, maxSendable: 2000000 });
    const { get } = fakeService(ok({ pr: invoiceFor(11) }), ok({ pr: invoiceFor(2000) }));
    assert.equal((await requestPayInvoice(narrow, { amountSats: 11 }, { get })).amountSats, 11);
    assert.equal((await requestPayInvoice(narrow, { amountSats: '2000' }, { get })).amountSats, 2000, 'digits as text');
  });

  test('the provider\'s refusal survives its HTTP 500', async () => {
    const { get } = fakeService(failed(500, { status: 'ERROR', reason: 'Could not validate refund address' }));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }), refusedWith('Could not validate refund address'));
  });

  test('a refusal on HTTP 200 is the same refusal', async () => {
    const { get } = fakeService(ok({ status: 'ERROR', reason: 'Amount is above the maximum' }), ok({ status: 'ERROR' }));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }), refusedWith('Amount is above the maximum'));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }), withCode(PAY_REQUEST_ERROR.REFUSED));
  });

  test('an HTTP error without a reason says its status', async () => {
    const { get } = fakeService(failed(503));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }), (error) => error.code === PAY_REQUEST_ERROR.HTTP && error.status === 503);
  });

  for (const [name, data] of [
    ['no body', null],
    ['no invoice', { status: 'OK' }],
    ['an invoice that is not text', { pr: { bolt11: invoiceFor(81) } }],
    ['an invoice that cannot be read', { pr: 'lnbc1notaninvoice' }],
    ['another kind of code', { pr: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' }],
    ['an invoice with no amount', { pr: invoiceFor(0) }],
  ]) {
    test(`nothing to pay: ${name}`, async () => {
      const { get } = fakeService(ok(data));
      await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }), withCode(PAY_REQUEST_ERROR.INVOICE_MISSING));
    });
  }

  for (const [name, invoice] of [
    ['more', invoiceFor(810)],
    ['less', invoiceFor(8)],
    ['one millisat more', invoiceFor(0, { msat: 81001 })],
    ['one millisat less', invoiceFor(0, { msat: 80999 })],
  ]) {
    test(`an invoice for ${name} than asked is refused`, async () => {
      const { get } = fakeService(ok({ pr: invoice }));
      await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }), (error) => error.code === PAY_REQUEST_ERROR.INVOICE_MISMATCH
        && error.askedSats === 81 && !isCounterpartyError(error));
    });
  }

  test('a lightning: prefix on the invoice is dropped', async () => {
    const { get } = fakeService(ok({ pr: `  lightning:${invoiceFor(81)} ` }));
    assert.equal((await requestPayInvoice(payRequest, { amountSats: 81 }, { get })).pr, invoiceFor(81));
  });

  test('success action, verify URL and reuse are read from the invoice answer only', async () => {
    const { get } = fakeService(
      ok({ pr: invoiceFor(81), successAction: { tag: 'message', message: 'Thanks!' }, verify: 'https://pay.example/verify/1', disposable: false }),
      ok({ pr: invoiceFor(81), verify: 'https://elsewhere.example/verify/1', disposable: true }),
    );
    const first = await requestPayInvoice(payRequest, { amountSats: 81 }, { get });
    assert.deepEqual(first.successAction, { tag: 'message', message: 'Thanks!' });
    assert.equal(first.verify, 'https://pay.example/verify/1');
    assert.equal(first.storeable, true);
    const second = await requestPayInvoice({ ...payRequest, disposable: false }, { amountSats: 81 }, { get });
    assert.equal(second.verify, null, 'never polls a host other than the callback\'s');
    assert.equal(second.storeable, false, 'the pay request cannot make a link reusable');
  });

  test('a kept pay request is checked again before it is used', async () => {
    for (const changed of [{ callback: 'http://pay.example/cb' }, { minSendable: 9, maxSendable: 1 }, { callback: undefined }]) {
      const { get, asked } = fakeService();
      await assert.rejects(requestPayInvoice({ ...payRequest, ...changed }, { amountSats: 81 }, { get }), withCode(PAY_REQUEST_ERROR.INVALID));
      assert.deepEqual(asked, []);
    }
  });

  test('a transport failure passes through untouched, and nothing was paid', async () => {
    const timeout = Object.assign(new Error('The server did not respond in time'), { name: 'AbortError' });
    const { get } = fakeService(timeout);
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }), (error) => error === timeout);
  });
});

describe('the invoice is the one for this payment', () => {
  const payRequest = readPayRequest(PAY_REQUEST);
  const madeFor = (metadata, sats = 81) => invoiceFor(sats, { descriptionHash: metadataHash(metadata) });

  test('an invoice made for this pay request is paid', async () => {
    const { get } = fakeService(ok({ pr: madeFor(PAY_REQUEST.metadata) }));
    assert.equal((await requestPayInvoice(payRequest, { amountSats: 81 }, { get })).pr, madeFor(PAY_REQUEST.metadata));
  });

  test('an invoice made for another pay request is refused, even for the right amount', async () => {
    const { get } = fakeService(ok({ pr: madeFor('[["text/plain","Mallory"]]') }));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }),
      (error) => error.code === PAY_REQUEST_ERROR.INVOICE_NOT_FOR_REQUEST && !isCounterpartyError(error));
  });

  test('the hash is of the metadata exactly as the service sent it', async () => {
    // The same JSON with other spacing is another text, so another hash.
    const { get } = fakeService(ok({ pr: madeFor('[["text/plain", "Alice"]]') }));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }), withCode(PAY_REQUEST_ERROR.INVOICE_NOT_FOR_REQUEST));
  });

  test('an invoice with a plain description is paid: payout services send those, and it names nothing to check', async () => {
    const { get } = fakeService(ok({ pr: invoiceFor(81) }));
    assert.equal((await requestPayInvoice(payRequest, { amountSats: 81 }, { get })).amountSats, 81);
  });

  test('kept terms without the metadata pay without the check, as before', async () => {
    const { metadata, ...terms } = payRequest;
    assert.equal(typeof metadata, 'string');
    const { get } = fakeService(ok({ pr: madeFor('[["text/plain","Mallory"]]') }));
    assert.equal((await requestPayInvoice(terms, { amountSats: 81 }, { get })).amountSats, 81);
  });

  test('an invoice for another pay request and another amount says it is for another payment', async () => {
    const { get } = fakeService(ok({ pr: madeFor('[["text/plain","Mallory"]]', 8100) }));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }), withCode(PAY_REQUEST_ERROR.INVOICE_NOT_FOR_REQUEST));
  });
});

describe('an invoice that expired long ago is never paid', () => {
  const payRequest = readPayRequest(PAY_REQUEST);
  // The fixture's invoices live 15 minutes from INVOICE_TIME.
  const at = (secondsAfterMade) => () => (INVOICE_TIME + secondsAfterMade) * 1000;

  test('one made a day ago is refused', async () => {
    const { get } = fakeService(ok({ pr: invoiceFor(81, { createdAt: INVOICE_TIME - 86400 }) }));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get, now: at(0) }),
      (error) => error.code === PAY_REQUEST_ERROR.INVOICE_EXPIRED && !isCounterpartyError(error));
  });

  test('a fresh one is paid on a phone whose clock runs up to ten minutes past its expiry', async () => {
    for (const seconds of [0, 899, 900, 1200, 1500]) {
      const { get } = fakeService(ok({ pr: invoiceFor(81) }));
      assert.equal((await requestPayInvoice(payRequest, { amountSats: 81 }, { get, now: at(seconds) })).amountSats, 81, `${seconds} s`);
    }
  });

  test('past that, it is stale whatever the clock', async () => {
    const { get } = fakeService(ok({ pr: invoiceFor(81) }));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get, now: at(1501) }), withCode(PAY_REQUEST_ERROR.INVOICE_EXPIRED));
  });
});

describe('redirects', () => {
  const payRequest = readPayRequest(PAY_REQUEST);
  const redirect = (location, status = 302) => ({ ok: false, status, data: null, location });

  test('the callback is asked without following them; the pay request is not', async () => {
    const { get, asked } = fakeService(ok(PAY_REQUEST), ok({ pr: invoiceFor(81) }));
    const fetched = await fetchPayRequest('https://example.com/.well-known/lnurlp/alice', { get });
    await requestPayInvoice(fetched, { amountSats: 81 }, { get });
    assert.equal(asked[0].options.disableRedirects, undefined, 'a domain may send its address to the service that runs it');
    assert.equal(asked[1].options.disableRedirects, true, 'the amount and the note reach the host that was checked');
  });

  test('a redirect on the same host is followed, and the invoice it leads to is checked as any', async () => {
    const { get, asked } = fakeService(redirect('/lnurlp/cb/alice/?amount=81000', 301), ok({ pr: invoiceFor(81) }));
    assert.equal((await requestPayInvoice(payRequest, { amountSats: 81 }, { get })).pr, invoiceFor(81));
    assert.deepEqual(asked.map(({ url }) => url), [`${PAY_REQUEST.callback}?amount=81000`, 'https://pay.example/lnurlp/cb/alice/?amount=81000']);
    assert.equal(asked[1].options.disableRedirects, true);

    const wrong = fakeService(redirect('https://pay.example/other?amount=8100000'), ok({ pr: invoiceFor(8100) }));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get: wrong.get }), withCode(PAY_REQUEST_ERROR.INVOICE_MISMATCH),
      'a redirect cannot change what is paid');
  });

  for (const [name, location] of [
    ['to another host', 'https://elsewhere.example/cb?amount=81000'],
    ['to a look-alike host', 'https://pay.example.evil.example/cb'],
    ['down to http', 'http://pay.example/lnurlp/cb/alice?amount=81000'],
    ['to another port', 'https://pay.example:8443/cb'],
    ['with credentials', 'https://user:secret@pay.example/cb'],
    ['nowhere the phone can see', null],
  ]) {
    test(`a redirect ${name} is refused, and nothing is asked of it`, async () => {
      const { get, asked } = fakeService(redirect(location));
      await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }),
        (error) => error.code === PAY_REQUEST_ERROR.REDIRECTED && error.status === 302 && !isCounterpartyError(error));
      assert.equal(asked.length, 1);
    });
  }

  test('a browser\'s opaque redirect is refused too', async () => {
    const { get } = fakeService(failed(0));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }), (error) => error.code === PAY_REQUEST_ERROR.REDIRECTED && error.status === 0);
  });

  test('a host that keeps redirecting is refused after two hops', async () => {
    const { get, asked } = fakeService(redirect('/a'), redirect('/b'), redirect('/c'));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }), withCode(PAY_REQUEST_ERROR.REDIRECTED));
    assert.equal(asked.length, 3);
  });

  test('a refusal sent with a redirect status keeps its reason', async () => {
    const { get } = fakeService({ ok: false, status: 302, data: { status: 'ERROR', reason: 'Could not validate refund address' }, location: null });
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get }), refusedWith('Could not validate refund address'));
  });
});

describe('expiry is judged by the service\'s clock when it sends one', () => {
  const payRequest = readPayRequest(PAY_REQUEST);
  const at = (secondsAfterMade) => () => (INVOICE_TIME + secondsAfterMade) * 1000;
  const dated = (pr, secondsAfterMade) => ({ ...ok({ pr }), date: new Date((INVOICE_TIME + secondsAfterMade) * 1000).toUTCString() });

  test('a fresh invoice is paid on a phone whose clock runs an hour fast', async () => {
    const { get } = fakeService(dated(invoiceFor(81), 5));
    assert.equal((await requestPayInvoice(payRequest, { amountSats: 81 }, { get, now: at(3600) })).amountSats, 81);
  });

  test('a stale one is refused by the service\'s own clock, whatever the phone says', async () => {
    const { get } = fakeService(dated(invoiceFor(81), 86400));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get, now: at(0) }), withCode(PAY_REQUEST_ERROR.INVOICE_EXPIRED));
  });

  test('a Date header that cannot be read leaves it to the phone\'s clock', async () => {
    const { get } = fakeService({ ...ok({ pr: invoiceFor(81) }), date: 'yesterday-ish' });
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 81 }, { get, now: at(3600) }), withCode(PAY_REQUEST_ERROR.INVOICE_EXPIRED));
  });
});

describe('asking in the recipient\'s currency (LUD-21)', () => {
  const payRequest = readPayRequest({ ...PAY_REQUEST, currency: { code: 'TZS', multiplier: 3700, decimals: 0 } });

  test('asks for the local amount and accepts the provider\'s fee on top of the estimate', async () => {
    const { get, asked } = fakeService(ok({ pr: invoiceFor(1906) }));
    const invoice = await requestPayInvoice(payRequest, { amountSats: 1850, payout: { code: 'TZS', amount: 5000 } }, { get });
    assert.equal(asked[0].url, 'https://pay.example/lnurlp/cb/alice?amount=5000&currency=TZS');
    assert.equal(invoice.amountSats, 1906, 'the fee is on top: the invoice says what is paid');
  });

  test('an invoice far above the estimate the person confirmed is never paid', async () => {
    // The sheet showed "5 USD, about 5,000 sats"; the service asks for 100 times that.
    const usd = readPayRequest({ ...PAY_REQUEST, currency: { code: 'USD', multiplier: 1000000, decimals: 2 } });
    for (const sats of [500000, payoutCeilingSats(5000) + 1]) {
      const { get } = fakeService(ok({ pr: invoiceFor(sats) }));
      await assert.rejects(requestPayInvoice(usd, { amountSats: 5000, payout: { code: 'USD', amount: 5 } }, { get }),
        (error) => error.code === PAY_REQUEST_ERROR.INVOICE_MISMATCH && error.askedSats === 5000 && error.invoiceSats === sats);
    }
  });

  test('the fee allowance is a tenth of the estimate and a few sats for rounding', async () => {
    assert.equal(PAYOUT_FEE_ALLOWANCE_PERCENT, 10);
    assert.equal(payoutCeilingSats(1850), 2045);
    assert.equal(payoutCeilingSats(1), 12, 'a minimum fee on a tiny amount still fits');
    const { get } = fakeService(ok({ pr: invoiceFor(2045) }), ok({ pr: invoiceFor(1) }));
    assert.equal((await requestPayInvoice(payRequest, { amountSats: 1850, payout: { code: 'TZS', amount: 5000 } }, { get })).amountSats, 2045, 'at the edge');
    assert.equal((await requestPayInvoice(payRequest, { amountSats: 1850, payout: { code: 'TZS', amount: 5000 } }, { get })).amountSats, 1, 'less is never a problem for the payer');
  });

  test('a payout needs the estimate the person confirmed', async () => {
    for (const amountSats of [undefined, 0, -1, 1.5, 'ten']) {
      const { get, asked } = fakeService();
      await assert.rejects(requestPayInvoice(payRequest, { amountSats, payout: { code: 'TZS', amount: 5000 } }, { get }), /Invalid amount/);
      assert.deepEqual(asked, []);
    }
  });

  test('the code is matched however it is written, and sent as the service writes it', async () => {
    const { get, asked } = fakeService(ok({ pr: invoiceFor(10) }));
    await requestPayInvoice(payRequest, { amountSats: 10, payout: { code: 'tzs', amount: 12.5 } }, { get });
    assert.equal(asked[0].url, 'https://pay.example/lnurlp/cb/alice?amount=12.5&currency=TZS');
  });

  test('a currency the service does not offer is never asked for', async () => {
    for (const offered of [payRequest, readPayRequest(PAY_REQUEST), { ...payRequest, currency: { code: 'KES' } }]) {
      const { get, asked } = fakeService();
      await assert.rejects(requestPayInvoice(offered, { payout: offered === payRequest ? { code: 'KES', amount: 5 } : { code: 'TZS', amount: 5 } }, { get }),
        (error) => error.code === PAY_REQUEST_ERROR.CURRENCY_UNAVAILABLE && typeof error.currency === 'string');
      assert.deepEqual(asked, []);
    }
  });

  for (const payout of [{ code: 'TZS', amount: 0 }, { code: 'TZS', amount: -5 }, { code: 'TZS', amount: NaN }, { code: 'TZS', amount: 1e-7 }, { code: 'TZS', amount: 1e21 },
    { code: 'TZS', amount: '5000' }, { code: '', amount: 5 }, { code: 'T&S', amount: 5 }, { code: 'TZS%26amount%3D1', amount: 5 }, {}]) {
    test(`a bad payout is never sent: ${JSON.stringify(payout)}`, async () => {
      const { get, asked } = fakeService();
      await assert.rejects(requestPayInvoice(payRequest, { amountSats: 1850, payout }, { get }), /Invalid amount/);
      assert.deepEqual(asked, []);
    });
  }

  test('an invoice still needs an amount', async () => {
    const { get } = fakeService(ok({ pr: invoiceFor(0) }));
    await assert.rejects(requestPayInvoice(payRequest, { amountSats: 1850, payout: { code: 'TZS', amount: 5000 } }, { get }), withCode(PAY_REQUEST_ERROR.INVOICE_MISSING));
  });
});

describe('the pieces it is built from', () => {
  test('fitComment counts both ways a service may', () => {
    assert.equal(fitComment('hello', 3), 'hel');
    assert.equal(fitComment(' hi ', 10), 'hi');
    assert.equal(fitComment('\u{1F600}\u{1F600}', 3), '\u{1F600}', 'two units each, so one fits in three');
    assert.equal(fitComment('\u{1F600}', 1), '');
    assert.equal(fitComment('a\ud800b\udc00', 10), 'ab', 'stray halves are left out');
    assert.equal(fitComment('ab cd', 3), 'ab', 'no space left dangling');
    for (const [comment, allowed] of [['x', 0], ['x', -1], ['x', 1.5], ['x', undefined], [42, 10], [null, 10]]) assert.equal(fitComment(comment, allowed), '');
  });

  test('buildLnurlPayCallbackUrl keeps both amount forms', () => {
    assert.equal(buildLnurlPayCallbackUrl({ callback: 'https://x.example/cb', amountSats: 2 }), 'https://x.example/cb?amount=2000');
    assert.equal(buildLnurlPayCallbackUrl({ callback: 'https://x.example/cb?a=1', amountSats: 2, comment: 'é', commentAllowed: 5 }), 'https://x.example/cb?a=1&amount=2000&comment=%C3%A9');
    assert.equal(buildLnurlPayCallbackUrl({ callback: 'https://x.example/cb', payout: { code: 'TZS', amount: 7 } }), 'https://x.example/cb?amount=7&currency=TZS');
    assert.doesNotThrow(() => buildLnurlPayCallbackUrl({ callback: 'https://x.example/cb', amountSats: 1, comment: 'a\u{1F600}', commentAllowed: 2 }), 'an emoji is never split into a broken URL');
    assert.doesNotThrow(() => buildLnurlPayCallbackUrl({ callback: 'https://x.example/cb', amountSats: 1, comment: 'a\ud800', commentAllowed: 9 }), 'nor is a stray half sent');
  });

  test('linkAmountSats: a fixed-amount link may take less than confirmed, never more', () => {
    const fixed = (sats) => readPayRequest({ ...PAY_REQUEST, minSendable: sats * 1000, maxSendable: sats * 1000 });
    assert.equal(linkAmountSats(fixed(500), 1000), 500, 'its own amount, which is less');
    assert.equal(linkAmountSats(fixed(1000), 1000), 1000);
    assert.equal(linkAmountSats(fixed(2000000), 1000), 1000, 'asks for the confirmed amount, which the link then refuses');
    assert.equal(linkAmountSats(readPayRequest(PAY_REQUEST), 1000), 1000, 'a range takes the confirmed amount');
  });

  test('a batch row never pays a fixed-amount link more than its own amount', async () => {
    const greedy = readPayRequest({ ...PAY_REQUEST, minSendable: 2000000000, maxSendable: 2000000000 });
    const { get, asked } = fakeService();
    await assert.rejects(requestPayInvoice(greedy, { amountSats: linkAmountSats(greedy, 1000) }, { get }),
      (error) => error.code === PAY_REQUEST_ERROR.AMOUNT_OUT_OF_RANGE && error.minSats === 2000000 && error.maxSats === 2000000);
    assert.deepEqual(asked, [], 'nothing was asked, nothing was paid');
  });

  test('isStoreablePayLink only trusts an explicit false', () => {
    assert.equal(isStoreablePayLink({ disposable: false }), true);
    for (const response of [{ disposable: true }, { disposable: null }, {}, null, undefined, { disposable: 'false' }]) assert.equal(isStoreablePayLink(response), false);
  });
});

describe('one request path', () => {
  const SRC = new URL('../../', import.meta.url);
  const files = readdirSync(SRC, { recursive: true })
    .filter((file) => /\.(js|vue)$/.test(file) && !file.includes('__tests__'))
    .map((file) => [file, readFileSync(new URL(file, SRC), 'utf8')]);
  // The code only: comments may name the path freely.
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

  test('no send builds a pay request URL of its own', () => {
    // Kept apart on purpose: the public profile page asks for a visitor who
    // pays with another wallet, and chat requests go through nostr-core.
    const allowed = ['utils/lnurlPay.js', 'services/publicProfileInvoice.js', 'services/dm/paymentVerification.js', 'services/dm/requests.js'];
    const builders = files.filter(([, text]) => /well-known\/lnurlp/.test(code(text))).map(([file]) => file);
    assert.deepEqual(builders.sort(), allowed.sort());
  });

  test('no send asks a callback for an invoice of its own', () => {
    // An amount added to a callback by hand. A `bitcoin:` payment URI
    // (BIP21) carries one too, and is not a callback.
    const allowed = ['utils/lnurlPay.js', 'services/publicProfileInvoice.js'];
    const asksByHand = (line) => !line.includes('bitcoin:')
      && /amount=\$\{|searchParams\.(?:set|append)\(\s*['"]amount['"]/.test(line);
    const askers = files
      .filter(([, text]) => code(text).split('\n').some(asksByHand))
      .map(([file]) => file);
    assert.deepEqual(askers.sort(), allowed.sort());
  });

  test('only the LNURL services talk to the transport directly', () => {
    const allowed = ['utils/lnurlPay.js', 'services/publicProfileInvoice.js', 'services/lnurlWithdraw.js', 'services/addressRequest.js', 'stores/withdrawVouchers.js', 'utils/lnurlHttp.js'];
    const users = files.filter(([, text]) => /\blnurlGetJson\b/.test(text)).map(([file]) => file);
    assert.deepEqual(users.sort(), allowed.sort());
  });
});

describe('payer details go with the invoice request (LUD-18)', () => {
  const ALICE = 'alice@buho.example';
  const SENT = '{"identifier":"alice@buho.example"}';
  const asking = (payerData, extra = {}) => readPayRequest({ ...PAY_REQUEST, payerData, ...extra });
  const madeFor = (text, sats = 81) => invoiceFor(sats, { descriptionHash: metadataHash(text) });
  const query = (url, name) => new URL(url).searchParams.get(name);

  test('the address is appended as `payerdata`, one strictly encoded JSON text', async () => {
    const { get, asked } = fakeService(ok({ pr: invoiceFor(81) }));
    const invoice = await requestPayInvoice(asking({ identifier: { mandatory: false } }), { amountSats: 81, payerData: { identifier: ALICE } }, { get });
    assert.equal(asked[0].url, `https://pay.example/lnurlp/cb/alice?amount=81000&payerdata=${encodeURIComponent(SENT)}`);
    assert.equal(query(asked[0].url, 'payerdata'), SENT, 'the service reads back exactly the text sent');
    assert.deepEqual(invoice.payerData, { identifier: ALICE });
  });

  test('characters a plain URL encoding leaves alone are encoded too', () => {
    const url = buildLnurlPayCallbackUrl({ callback: 'https://pay.example/cb', amountSats: 1, payerdata: `{"identifier":"o'neil(*)!@x.example"}` });
    assert.match(url, /payerdata=[^!'()*]+$/);
    assert.equal(new URL(url).searchParams.get('payerdata'), `{"identifier":"o'neil(*)!@x.example"}`);
  });

  test('a callback with its own query keeps it, the details come last, after the comment', async () => {
    const { get, asked } = fakeService(ok({ pr: invoiceFor(81) }));
    const request = asking({ identifier: {} }, { callback: 'https://pay.example/cb?k1=a%2Fb' });
    await requestPayInvoice(request, { amountSats: 81, comment: 'hi', payerData: { identifier: ALICE } }, { get });
    assert.equal(asked[0].url, `https://pay.example/cb?k1=a%2Fb&amount=81000&comment=hi&payerdata=${encodeURIComponent(SENT)}`);
  });

  test('in the recipient\'s currency (LUD-21) the details go as well', async () => {
    const { get, asked } = fakeService(ok({ pr: invoiceFor(84) }));
    const request = asking({ identifier: {} }, { currency: { code: 'ZAR', multiplier: 1000, decimals: 2 } });
    await requestPayInvoice(request, { amountSats: 81, payout: { code: 'ZAR', amount: 100 }, payerData: { identifier: ALICE } }, { get });
    assert.equal(query(asked[0].url, 'currency'), 'ZAR');
    assert.equal(query(asked[0].url, 'payerdata'), SENT);
  });

  test('a service that asks for nothing gets nothing, whatever the sheet holds', async () => {
    for (const payerData of [undefined, null, {}, { name: {}, email: {} }]) {
      const { get, asked } = fakeService(ok({ pr: invoiceFor(81) }));
      const invoice = await requestPayInvoice(asking(payerData), { amountSats: 81, payerData: { identifier: ALICE } }, { get });
      assert.equal(query(asked[0].url, 'payerdata'), null, JSON.stringify(payerData));
      assert.equal(invoice.payerData, null);
    }
  });

  test('an optional address left out sends nothing and pays', async () => {
    const { get, asked } = fakeService(ok({ pr: invoiceFor(81) }));
    const invoice = await requestPayInvoice(asking({ identifier: { mandatory: false } }), { amountSats: 81 }, { get });
    assert.equal(query(asked[0].url, 'payerdata'), null);
    assert.equal(invoice.payerData, null);
  });

  test('only the identifier is sent, even if more was handed over', async () => {
    const { get, asked } = fakeService(ok({ pr: invoiceFor(81) }));
    await requestPayInvoice(asking({ identifier: {}, name: {}, email: {} }),
      { amountSats: 81, payerData: { identifier: ALICE, name: 'Alice', email: 'alice@mail.example' } }, { get });
    assert.equal(query(asked[0].url, 'payerdata'), SENT);
  });

  test('nothing is asked of the service when the payment cannot go ahead', async () => {
    const cases = [
      [asking({ identifier: { mandatory: true } }), null, PAY_REQUEST_ERROR.PAYER_DATA_REQUIRED],
      [asking({ identifier: { mandatory: true } }), { identifier: '  ' }, PAY_REQUEST_ERROR.PAYER_DATA_REQUIRED],
      [asking({ identifier: {} }), { identifier: 'not-an-address' }, PAY_REQUEST_ERROR.PAYER_DATA_INVALID],
      [asking({ email: { mandatory: true } }), { identifier: ALICE }, PAY_REQUEST_ERROR.PAYER_DATA_UNSUPPORTED],
      [asking({ identifier: { mandatory: true }, auth: { mandatory: true, k1: 'ab' } }), { identifier: ALICE }, PAY_REQUEST_ERROR.PAYER_DATA_UNSUPPORTED],
    ];
    for (const [request, payerData, code] of cases) {
      const { get, asked } = fakeService();
      await assert.rejects(requestPayInvoice(request, { amountSats: 81, payerData }, { get }),
        (error) => error.code === code && !isCounterpartyError(error), code);
      assert.equal(asked.length, 0, code);
    }
  });

  test('an address agreed for one service goes only to it', async () => {
    const onlyTo = (callback) => new URL(callback).hostname === 'pay.example';
    const fine = fakeService(ok({ pr: invoiceFor(81) }));
    await requestPayInvoice(asking({ identifier: {} }), { amountSats: 81, payerData: { identifier: ALICE, onlyTo } }, { get: fine.get });
    assert.equal(query(fine.asked[0].url, 'payerdata'), SENT);

    const moved = fakeService();
    await assert.rejects(
      requestPayInvoice(asking({ identifier: {} }, { callback: 'https://elsewhere.example/cb' }), { amountSats: 81, payerData: { identifier: ALICE, onlyTo } }, { get: moved.get }),
      (error) => error.code === PAY_REQUEST_ERROR.INVALID && !isCounterpartyError(error));
    assert.equal(moved.asked.length, 0, 'the other service is never asked');

    const silent = fakeService(ok({ pr: invoiceFor(81) }));
    await requestPayInvoice(asking({}, { callback: 'https://elsewhere.example/cb' }), { amountSats: 81, payerData: { identifier: ALICE, onlyTo } }, { get: silent.get });
    assert.equal(query(silent.asked[0].url, 'payerdata'), null, 'nothing to share: the test does not apply');
  });

  test('a refusal for unshareable details names what was asked for', async () => {
    const { get } = fakeService();
    await assert.rejects(requestPayInvoice(asking({ email: { mandatory: true }, name: { mandatory: true } }), { amountSats: 81 }, { get }),
      (error) => error.code === PAY_REQUEST_ERROR.PAYER_DATA_UNSUPPORTED && error.kinds.join() === 'email,name');
  });

  test('an amount out of range is still said first', async () => {
    const { get } = fakeService();
    await assert.rejects(requestPayInvoice(asking({ identifier: { mandatory: true } }), { amountSats: 1e9 }, { get }),
      withCode(PAY_REQUEST_ERROR.AMOUNT_OUT_OF_RANGE));
  });

  test('the invoice may be for the metadata, or for the metadata with the details sent', async () => {
    const request = asking({ identifier: {} });
    for (const text of [PAY_REQUEST.metadata, PAY_REQUEST.metadata + SENT]) {
      const { get } = fakeService(ok({ pr: madeFor(text) }));
      assert.equal((await requestPayInvoice(request, { amountSats: 81, payerData: { identifier: ALICE } }, { get })).pr, madeFor(text));
    }
  });

  test('details that were not sent cannot vouch for an invoice', async () => {
    const { get } = fakeService(ok({ pr: madeFor(PAY_REQUEST.metadata + SENT) }));
    await assert.rejects(requestPayInvoice(asking({ identifier: {} }), { amountSats: 81 }, { get }),
      withCode(PAY_REQUEST_ERROR.INVOICE_NOT_FOR_REQUEST));
  });

  test('other details, or the same details written another way, are another payment', async () => {
    for (const text of [PAY_REQUEST.metadata + '{"identifier":"mallory@x.example"}', PAY_REQUEST.metadata + '{"identifier": "alice@buho.example"}']) {
      const { get } = fakeService(ok({ pr: madeFor(text) }));
      await assert.rejects(requestPayInvoice(asking({ identifier: {} }), { amountSats: 81, payerData: { identifier: ALICE } }, { get }),
        withCode(PAY_REQUEST_ERROR.INVOICE_NOT_FOR_REQUEST), text);
    }
  });

  test('a callback that already carries `payerdata` is refused, in any case', () => {
    for (const callback of ['https://pay.example/cb?payerdata=x', 'https://pay.example/cb?PayerData=x']) {
      assert.throws(() => readPayRequest({ ...PAY_REQUEST, callback, payerData: { identifier: {} } }), withCode(PAY_REQUEST_ERROR.INVALID));
    }
  });

  test('the pay request keeps payerData as the service sent it', () => {
    const payerData = { identifier: { mandatory: false }, futureKind: { x: 1 } };
    assert.deepEqual(readPayRequest({ ...PAY_REQUEST, payerData }).payerData, payerData);
  });
});
