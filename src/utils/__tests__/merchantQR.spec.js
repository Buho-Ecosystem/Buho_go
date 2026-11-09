/**
 * Which scanned text counts as a South African till code.
 *
 * Run: node --test src/utils/__tests__/merchantQR.spec.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import {
  convertToLightningAddress,
  getMerchantInfo,
  isSARetailerQR,
} from '../merchantQR.js';

// From the provider: its test QR, and the example in its scanner spec.
const PROVIDER_TEST_CODE = '00020129530023za.co.electrum.picknpay0122TSHP6SJNKTR3IY/confirm520458125303710540115802ZA5916cryptoqrtestscan6002CT6304821D';
const PROVIDER_EXAMPLE = '00020126530023za.co.electrum.picknpay0122fom7Ku0aQ9SvG+svh4xVPQ530371054041.23630428E5';

/** Longest text still treated as a possible till code. */
const CAP = 2048;
/** Far above linear matching, far below anything a person would notice as a freeze. */
const BUDGET_MS = 100;
/** A runaway pattern never answers, so the test gives up here instead of hanging. */
const GIVE_UP_MS = 5000;

const MATCHER_URL = new URL('../merchantQR.js', import.meta.url).href;
const WORKER_SOURCE = `
  const { parentPort, workerData } = require('node:worker_threads');
  import(workerData.matcher).then(({ isSARetailerQR }) => {
    const started = performance.now();
    isSARetailerQR(workerData.text);
    parentPort.postMessage(performance.now() - started);
  });
`;

/** How long matching takes, measured in a worker: a runaway pattern blocks its thread, and only a worker can be stopped. */
function timeMatch(text) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { matcher: MATCHER_URL, text } });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`still matching after ${GIVE_UP_MS} ms`));
    }, GIVE_UP_MS);
    worker.once('message', (elapsed) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(elapsed);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe('recognising a till code', () => {
  const families = [
    [PROVIDER_TEST_CODE, 'picknpay'],
    [PROVIDER_EXAMPLE, 'picknpay'],
    ['00020126270021za.co.ecentric.TEST6304ABCD', 'ecentric'],
    ['00020126270021za.co.electrum.TEST6304ABCD', 'checkers_shoprite'],
    ['https://pos.snapscan.io/qr/TEST', 'snapscan'],
    ['https://snapscan.co.za/qr/TEST', 'snapscan'],
    ['https://wigroup.co/TEST', 'yoyo'],
    ['https://yoyogroup.co/TEST', 'yoyo'],
    ['https://www.zapper.com/url/TEST', 'zapper'],
    ['https://x.wigroup.example/TEST', 'zapper'],
    ['ab/cdef/ghijklmnopqrstuvwxyz', 'zapper'],
    ['https://payat.io/qr/TEST', 'zapper'],
    ['https://paynow.netcash.co.za/TEST', 'zapper'],
    ['https://paynow.sagepay.co.za/TEST', 'zapper'],
    ['SK-1-00000000000000000000000', 'zapper'],
    ['00000000000000000000', 'zapper'],
    ['http://2.zap.pe?t=6&i=1:2:7[34|0.00|3:10[39|ZAR,38|Test', 'zapper'],
    ['http://2.zap.pe?t=6\ni=1:2:7', 'zapper'],
    ['http://2.zap.pe?t=6\r\ni=1:2:7', 'zapper'],
    ['https://transactionjunction.co.za/TEST', 'zapper'],
    ['CRSTPC-1-2-3-4-5', 'zapper'],
    ['https://scantopay.io/TEST', 'scantopay'],
    ['0821234567', 'scantopay'],
    ['UMPQR123', 'scantopay'],
    ['https://x.oltio.co.za/TEST', 'scantopay'],
    ['easypay-TEST', 'scantopay'],
    ['https://cryptoqr.net/TEST', 'moneybadger'],
  ];

  for (const [code, id] of families) {
    test(`${code.slice(0, 44)} is ${id}`, () => {
      assert.equal(isSARetailerQR(code), true);
      assert.equal(getMerchantInfo(code).id, id);
    });
  }

  test('spaces around a code do not matter', () => {
    assert.equal(getMerchantInfo(`  ${PROVIDER_EXAMPLE}\n`).id, 'picknpay');
  });
});

describe('text that is not a till code', () => {
  for (const text of ['hello', '123456789', '12345678901', 'Visit us\nwww.zapper.com', 'BEGIN:VCARD\nEMAIL:ann@zapper.com\nEND:VCARD']) {
    test(`ordinary text: ${JSON.stringify(text)}`, () => {
      assert.equal(isSARetailerQR(text), false);
    });
  }

  for (const value of ['', '   ', null, undefined, 42, {}, []]) {
    test(`not usable input: ${JSON.stringify(value)}`, () => {
      assert.equal(isSARetailerQR(value), false);
      assert.equal(getMerchantInfo(value), null);
      assert.equal(convertToLightningAddress(value), null);
    });
  }
});

describe('turning a till code into an address', () => {
  test('encodes the whole code exactly once, the way the provider decodes it', () => {
    const { lightningAddress, merchant } = convertToLightningAddress(PROVIDER_TEST_CODE);
    assert.equal(
      lightningAddress,
      '00020129530023za.co.electrum.picknpay0122TSHP6SJNKTR3IY%2Fconfirm520458125303710540115802ZA5916cryptoqrtestscan6002CT6304821D@cryptoqr.net',
    );
    assert.equal(merchant.id, 'picknpay');
  });

  test('keeps the case of the code', () => {
    const { lightningAddress } = convertToLightningAddress(PROVIDER_EXAMPLE);
    assert.ok(lightningAddress.includes('fom7Ku0aQ9SvG%2Bsvh4xVPQ'));
  });

  test('URL-based families stay unconverted for now', () => {
    assert.equal(convertToLightningAddress('https://www.zapper.com/url/TEST'), null);
    assert.equal(convertToLightningAddress('https://pos.snapscan.io/qr/TEST'), null);
  });
});

describe('hostile input', () => {
  const zapTail = (length) => `1.zap.pe${'a'.repeat(length)}\rX`;

  const hostile = [
    ['the nested repeat that used to freeze the app', zapTail(CAP - 10)],
    ['a tail of lines', `1.zap.pe${'a\n'.repeat(1000)}!`],
    ['one long line', 'a'.repeat(CAP)],
    ['near-miss retailer names', 'za.co.electrum.'.repeat(130).slice(0, CAP).replaceAll('electrum', 'electrun')],
    ['digits that never finish a pattern', `${'1'.repeat(CAP - 1)}x`],
    ['a code with endless parts', `CRSTPC-${'1-'.repeat(1000)}x`],
    ['endless slashes', '/'.repeat(CAP)],
    ['a broken Bitcoin link', `bitcoin:${'%'.repeat(CAP - 8)}`],
    ['a broken LNURL', `lnurl1${'q'.repeat(CAP - 6)}`],
  ];

  for (const [name, text] of hostile) {
    test(`${name} is answered at once`, async () => {
      const elapsed = await timeMatch(text);
      assert.ok(elapsed < BUDGET_MS, `took ${Math.round(elapsed)} ms`);
    });
  }

  test('text past the limit is not looked at', () => {
    const padded = (length) => `za.co.electrum.picknpay${'a'.repeat(length - 23)}`;
    assert.equal(isSARetailerQR(padded(CAP)), true);
    assert.equal(isSARetailerQR(padded(CAP + 1)), false);
  });

  test('the limit applies after trimming', () => {
    const code = `za.co.electrum.picknpay${'a'.repeat(CAP - 23)}`;
    assert.equal(isSARetailerQR(`   ${code}   `), true);
  });
});
