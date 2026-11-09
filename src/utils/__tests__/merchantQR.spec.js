/**
 * Which scanned text counts as a South African till code.
 *
 * Run: node --test src/utils/__tests__/merchantQR.spec.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import {
  MERCHANT_FAILURE,
  convertToLightningAddress,
  describeMerchantFailure,
  describeTillLookupFailure,
  encodeTillCode,
  getMerchantInfo,
  isTillAddress,
  lightningAddressCase,
  merchantFailureCode,
  readEmvAmount,
  tillMerchant,
  tillPrefillSats,
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

/** True for text that reads as a till code. */
const isTillCode = (text) => getMerchantInfo(text) !== null;
const MATCHER_URL = new URL('../merchantQR.js', import.meta.url).href;
const WORKER_SOURCE = `
  const { parentPort, workerData } = require('node:worker_threads');
  import(workerData.matcher).then(({ getMerchantInfo }) => {
    const started = performance.now();
    getMerchantInfo(workerData.text);
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
    ['00020126270021za.co.electrum.TEST6304ABCD', 'electrum'],
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
    ['https://cryptoqr.net/TEST', 'provider'],
  ];

  for (const [code, id] of families) {
    test(`${code.slice(0, 44)} is ${id}`, () => {
      assert.equal(isTillCode(code), true);
      assert.equal(getMerchantInfo(code).id, id);
    });
  }

  test('spaces around a code do not matter', () => {
    assert.equal(getMerchantInfo(`  ${PROVIDER_EXAMPLE}\n`).id, 'picknpay');
  });

  test('a network names a store only where its code does', () => {
    assert.deepEqual(getMerchantInfo(PROVIDER_TEST_CODE), { id: 'picknpay', displayName: 'Pick n Pay' });
    for (const [code] of families.filter(([, id]) => id !== 'picknpay')) {
      assert.equal(getMerchantInfo(code).displayName, null, code);
    }
  });

  test('a link names its network by its host, in any case', () => {
    assert.equal(getMerchantInfo('https://POS.SnapScan.io/qr/ABC123').id, 'snapscan');
    assert.equal(getMerchantInfo('http://2.zap.pe?t=6&i=40895:49955:7').id, 'zapper');
  });
});

describe('text that is not a till code', () => {
  // Whatever matches is sent to the provider as soon as it is scanned. A
  // code that only mentions a network, and every other kind of link or
  // card, stays on the phone.
  for (const text of [
    'WIFI:T:WPA;S:snapscan-guest;P:hunter2;;',
    'otpauth://totp/Snapscan:me?secret=JBSWY3DPEHPK3PXP',
    'https://example.com/reset?token=SECRET123&ref=snapscan',
    'https://www.example.com/search?q=easypay',
    'https://evil.example/?x=za.co.electrum.picknpay',
    'https://evil.example/www.zapper.com/x',
    'mailto:pay@zapper.com',
    'tel:0821234567',
    'sms:0821234567',
    'MECARD:N:Ann;EMAIL:ann@zapper.com;;',
    'geo:0,0?q=snapscan',
    'pay with snapscan',
  ]) {
    test(`a code that only mentions a network: ${JSON.stringify(text.slice(0, 40))}`, () => {
      assert.equal(getMerchantInfo(text), null);
      assert.equal(convertToLightningAddress(text), null);
    });
  }

  for (const text of ['hello', '123456789', '12345678901', 'Visit us\nwww.zapper.com', 'BEGIN:VCARD\nEMAIL:ann@zapper.com\nEND:VCARD']) {
    test(`ordinary text: ${JSON.stringify(text)}`, () => {
      assert.equal(isTillCode(text), false);
    });
  }

  for (const value of ['', '   ', null, undefined, 42, {}, []]) {
    test(`not usable input: ${JSON.stringify(value)}`, () => {
      assert.equal(isTillCode(value), false);
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

  test('every network goes to the provider, which says whether it takes it', () => {
    for (const [code, address] of [
      ['https://www.zapper.com/url/TEST', 'https%3A%2F%2Fwww.zapper.com%2Furl%2FTEST@cryptoqr.net'],
      ['https://pos.snapscan.io/qr/TEST', 'https%3A%2F%2Fpos.snapscan.io%2Fqr%2FTEST@cryptoqr.net'],
      ['0821234567', '0821234567@cryptoqr.net'],
      ['00020126270021za.co.ecentric.TEST6304ABCD', '00020126270021za.co.ecentric.TEST6304ABCD@cryptoqr.net'],
    ]) {
      assert.equal(convertToLightningAddress(code).lightningAddress, address, code);
    }
  });

  test('characters a URL encoder leaves alone are encoded too, once', () => {
    assert.equal(encodeTillCode("a!b'c(d)e*f~g"), 'a%21b%27c%28d%29e%2Af%7Eg');
    assert.equal(encodeTillCode('a b/c?d#e&f=g+h@i'), 'a%20b%2Fc%3Fd%23e%26f%3Dg%2Bh%40i');
  });

  test('a code that already holds percent signs is never decoded first', () => {
    assert.equal(encodeTillCode('x%41y%2Fz%'), 'x%2541y%252Fz%25');
    assert.equal(decodeURIComponent(encodeTillCode('x%41y%2Fz%')), 'x%41y%2Fz%', 'the provider, decoding once, reads the code as printed');
  });

  test('the address is one every path accepts: only letters, digits, - _ . and %XX', () => {
    const tricky = `000201za.co.electrum.picknpay ${"!'()*~/\\?#[]@:;,$&=+ äöü 💸"}${'Z'.repeat(300)}`;
    const { lightningAddress } = convertToLightningAddress(tricky);
    const name = lightningAddress.slice(0, lightningAddress.lastIndexOf('@'));
    assert.match(name, /^(?:[A-Za-z0-9._-]|%[0-9A-F]{2})+$/);
    assert.equal(decodeURIComponent(name), tricky.trim());
    assert.ok(name.endsWith('Z'.repeat(300)), 'a long code is kept whole');
  });

  test('carries the rand amount printed in the code', () => {
    assert.equal(convertToLightningAddress(PROVIDER_TEST_CODE).randAmount, '1.00');
    assert.equal(convertToLightningAddress('https://www.zapper.com/url/TEST').randAmount, null);
  });
});

describe('the rand amount printed in the code (EMV tags 53 and 54)', () => {
  /** A well-formed code from tags, with its checksum. */
  const emv = (tags) => {
    const body = `${tags.map(([id, value]) => `${id}${String(value.length).padStart(2, '0')}${value}`).join('')}6304`;
    let crc = 0xffff;
    for (const byte of Buffer.from(body, 'utf8')) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return body + crc.toString(16).toUpperCase().padStart(4, '0');
  };
  const SHOP = ['26', '0023za.co.electrum.picknpay0104TEST'];

  test('both real codes', () => {
    assert.equal(readEmvAmount(PROVIDER_TEST_CODE), '1.00');
    assert.equal(readEmvAmount(PROVIDER_EXAMPLE), '1.23');
    assert.equal(readEmvAmount(`  ${PROVIDER_EXAMPLE}  `), '1.23');
  });

  test('a built code reads back', () => {
    assert.equal(readEmvAmount(emv([['00', '01'], SHOP, ['53', '710'], ['54', '125.5']])), '125.50');
    assert.equal(readEmvAmount(emv([['00', '01'], SHOP, ['53', '710'], ['54', '1250']])), '1250.00');
  });

  test('only rand: another currency, or none, gives no amount', () => {
    assert.equal(readEmvAmount(emv([['00', '01'], SHOP, ['53', '840'], ['54', '1.00']])), null);
    assert.equal(readEmvAmount(emv([['00', '01'], SHOP, ['54', '1.00']])), null);
  });

  test('no amount, or one that is not a plain positive decimal, gives none', () => {
    for (const amount of [null, '0', '0.00', '-1', '1,250.00', '1.234', '1e3', '.5', 'R1', ' 1']) {
      const tags = [['00', '01'], SHOP, ['53', '710'], ...(amount === null ? [] : [['54', amount]])];
      assert.equal(readEmvAmount(emv(tags)), null, String(amount));
    }
  });

  test('a code that is not whole gives none: wrong checksum, cut short, extra text, a tag twice', () => {
    const good = emv([['00', '01'], SHOP, ['53', '710'], ['54', '1.00']]);
    assert.equal(readEmvAmount(good), '1.00');
    assert.equal(readEmvAmount(`${good.slice(0, -4)}0000`), null, 'checksum');
    assert.equal(readEmvAmount(good.replace('54041.00', '54049.00')), null, 'a changed amount breaks the checksum');
    assert.equal(readEmvAmount(good.slice(0, -1)), null, 'cut short');
    assert.equal(readEmvAmount(`${good}00`), null, 'text after the checksum');
    assert.equal(readEmvAmount(emv([['00', '01'], ['53', '710'], ['54', '1.00'], ['54', '9.00']])), null, 'a tag twice');
    assert.equal(readEmvAmount(emv([['00', '02'], SHOP, ['53', '710'], ['54', '1.00']])), null, 'not a merchant code');
  });

  test('a code with a tip or a fee is not the total', () => {
    for (const extra of [[['55', '01']], [['55', '02'], ['56', '50.00']], [['55', '03'], ['57', '10']]]) {
      assert.equal(readEmvAmount(emv([['00', '01'], SHOP, ['53', '710'], ['54', '100.00'], ...extra])), null, extra[0][1]);
    }
  });

  test('anything that is not a code gives none', () => {
    for (const value of [null, undefined, 42, '', 'https://www.zapper.com/url/TEST', '0821234567', '000201', 'x'.repeat(5000)]) {
      assert.equal(readEmvAmount(value), null, String(value).slice(0, 20));
    }
  });
});

describe('the store on the sheet', () => {
  const network = getMerchantInfo(PROVIDER_TEST_CODE);
  const other = getMerchantInfo('00020126270021za.co.electrum.TEST6304ABCD');

  test('the provider\'s name, with a logo only for a store BuhoGO holds one for', () => {
    assert.deepEqual(tillMerchant(network, 'Pick n Pay', 'Store'), { id: 'picknpay', displayName: 'Pick n Pay', logo: '/sa_retailers/picknpay.png' });
    assert.deepEqual(tillMerchant(other, 'Checkers Hyper Sandton', 'Store'), { id: 'electrum', displayName: 'Checkers Hyper Sandton', logo: '/sa_retailers/checkers.png' });
    assert.equal(tillMerchant(network, "PICK 'N PAY", 'Store').logo, '/sa_retailers/picknpay.png');
    assert.deepEqual(tillMerchant(other, 'Kaffeehaus am Markt', 'Store'), { id: 'electrum', displayName: 'Kaffeehaus am Markt', logo: null });
  });

  test('a store\'s logo only through its own network: anyone can register a name elsewhere', () => {
    const snapscan = getMerchantInfo('https://pos.snapscan.io/qr/ABC123');
    assert.deepEqual(tillMerchant(snapscan, 'Woolworths Food Court', 'Store'), { id: 'snapscan', displayName: 'Woolworths Food Court', logo: null });
    assert.equal(tillMerchant(other, 'Pick n Pay', 'Store').logo, null, 'Pick n Pay tills are their own network');
    assert.equal(tillMerchant({ id: 'provider', displayName: null }, 'Checkers', 'Store').logo, null);
    assert.equal(tillMerchant(getMerchantInfo('00020126250019za.co.ecentric.TEST6304ABCD'), 'Woolworths', 'Store').logo, '/sa_retailers/woolworths.png');
    assert.equal(tillMerchant(other, 'Shoprite Usave', 'Store').logo, '/sa_retailers/shoprite.png');
  });

  test('a name that only starts like a store is not that store', () => {
    for (const name of ['Checkersboard Games', 'Shopriteous', 'Woolworthsy', 'The Pick n Pay Fan Club', 'cryptoqrtestscan']) {
      assert.equal(tillMerchant(other, name, 'Store').logo, null, name);
    }
  });

  test('the network\'s own name only when the provider names none; else the fallback', () => {
    for (const blank of [undefined, null, '', '   ', 42, {}]) {
      assert.equal(tillMerchant(network, blank, 'Store').displayName, 'Pick n Pay', String(blank));
      assert.deepEqual(tillMerchant(other, blank, 'Store'), { id: 'electrum', displayName: 'Store', logo: null });
      assert.deepEqual(tillMerchant(null, blank, 'Store'), { id: null, displayName: 'Store', logo: null });
    }
    assert.equal(tillMerchant(network, 'Pick n Pay', 'Store').logo, '/sa_retailers/picknpay.png');
    assert.equal(tillMerchant(network, null, 'Store').logo, null, 'a network\'s name never brings a logo');
  });

  test('the name is one short line: no control or direction characters, long names cut', () => {
    assert.equal(tillMerchant(other, '  Corner\n\tShop\u202E  ', 'Store').displayName, 'Corner Shop');
    const long = tillMerchant(other, 'A'.repeat(80), 'Store').displayName;
    assert.equal(long.length, 48);
    assert.ok(long.endsWith('…'));
  });

  test('invisible and format characters go too, and a cut never splits a character', () => {
    assert.equal(tillMerchant(network, 'Pick\u00ADn Pay\u2061', 'Store').displayName, 'Pick n Pay');
    assert.equal(tillMerchant(other, 'Corner\u009B\u061CShop\u2028\uFEFF', 'Store').displayName, 'Corner Shop');
    assert.equal(tillMerchant(other, '\u200B\u2066\u{E0041}', 'Store').displayName, 'Store');
    const cut = tillMerchant(other, `${'A'.repeat(46)}\u{1F600}\u{1F600}\u{1F600}`, 'Store').displayName;
    assert.equal(cut, `${'A'.repeat(46)}\u{1F600}…`);
    assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut), false);
  });
});

describe('what the provider says about a code', () => {
  const t = (key) => key;

  test('its codes, bare or inside its technical line', () => {
    assert.equal(merchantFailureCode('[GET /scan][400] getQrInfoBadRequest {"code":"UNKNOWN_CODE","message":"x"}'), MERCHANT_FAILURE.UNKNOWN_CODE);
    assert.equal(merchantFailureCode('UNSUPPORTED_QR_CODE: SnapScan not supported yet.'), MERCHANT_FAILURE.UNSUPPORTED_QR_CODE);
    for (const code of Object.values(MERCHANT_FAILURE)) assert.equal(merchantFailureCode(`x ${code} y`), code);
  });

  test('only whole codes near the start count', () => {
    for (const reason of ['XUNKNOWN_CODE', 'UNKNOWN_CODES', `${'x'.repeat(600)} UNKNOWN_CODE`, 'unknown_code', '', null, 42]) {
      assert.equal(merchantFailureCode(reason), null, String(reason).slice(0, 20));
    }
  });

  test('each refusal in plain words', () => {
    assert.equal(describeMerchantFailure('UNKNOWN_CODE', t), "This code can't be paid. Ask the cashier for a new one.");
    assert.equal(describeMerchantFailure('UNSUPPORTED_QR_CODE: SnapScan not supported yet.', t), "This store's code isn't supported yet. Pay another way.");
    assert.equal(describeMerchantFailure('SMART_SHOPPER_SCANNED', t), "That's a rewards code. Ask the cashier for the payment QR code.");
    assert.equal(describeMerchantFailure('AMOUNT_TOO_HIGH', t), 'This amount is over the limit. Pay another way.');
  });

  test('the refund codes, for when the refund row is not there to say them', () => {
    assert.equal(describeMerchantFailure('REFUND_ADDRESS_REQUIRED', t), 'This store needs a refund address.');
    assert.equal(describeMerchantFailure('INVALID_REFUND_ADDRESS', t), "This address can't receive refunds. Choose another.");
  });

  test('a technical line with no code BuhoGO knows is a refused code; plain words stay the provider\'s', () => {
    for (const reason of ['[GET /scan][400] getQrInfoBadRequest {"code":"NEW_CODE"}', '{"error":"x"}']) {
      assert.equal(describeMerchantFailure(reason, t), "This code can't be paid. Ask the cashier for a new one.", reason);
    }
    for (const reason of ['invalid scan request', 'Could not validate refund address', '', null, 42]) {
      assert.equal(describeMerchantFailure(reason, t), null, String(reason));
    }
  });
});

describe('when a till code cannot be read', () => {
  const t = (key) => key;
  const CANT_BE_PAID = "This code can't be paid. Ask the cashier for a new one.";
  const NOT_ANSWERING = "The store's payment service isn't answering. Try again in a moment.";

  test('the provider\'s refusal: plain words, else its own words, said as theirs', () => {
    assert.deepEqual(describeTillLookupFailure({ error: true, serviceReason: 'AMOUNT_TOO_HIGH', reason: 'AMOUNT_TOO_HIGH', attribution: 'cryptoqr.net' }, t),
      { reason: 'This amount is over the limit. Pay another way.', attribution: null });
    assert.deepEqual(describeTillLookupFailure({ error: true, serviceReason: 'Store closed', reason: 'Store closed', attribution: 'cryptoqr.net' }, t),
      { reason: 'Store closed', attribution: 'cryptoqr.net' });
    assert.deepEqual(describeTillLookupFailure({ error: true, serviceReason: '[GET /scan][500] {"code":"X"}', reason: '[GET /scan][500] {"code":"X"}', attribution: 'cryptoqr.net' }, t),
      { reason: CANT_BE_PAID, attribution: null });
  });

  test('no answer at all keeps the reason already found', () => {
    assert.deepEqual(describeTillLookupFailure({ error: true, serviceReason: null, reason: 'No connection', attribution: null }, t), { reason: 'No connection', attribution: null });
  });

  test('a code the provider does not know is one to ask about again; a busy or down service is one to retry', () => {
    for (const httpStatus of [400, 404, 410]) assert.deepEqual(describeTillLookupFailure({ httpStatus }, t), { reason: CANT_BE_PAID, attribution: null });
    for (const info of [{ httpStatus: 429 }, { httpStatus: 500 }, { httpStatus: 503 }, {}, null]) {
      assert.deepEqual(describeTillLookupFailure(info, t), { reason: NOT_ANSWERING, attribution: null }, JSON.stringify(info));
    }
  });
});

describe('the amount filled in for a till payment', () => {
  test('the top of a narrow range: the provider\'s price with the rate moving', () => {
    assert.equal(tillPrefillSats(80000, 81000), 81);
    assert.equal(tillPrefillSats(100000, 105000), 105);
  });

  test('never a wide range, a fixed one, or anything odd', () => {
    for (const [min, max] of [[1000, 1e9], [100000, 105001], [81000, 81000], [81000, 80000], [0, 1000], [-1000, 1000], [81500, 81900], ['80000', '81000'], [NaN, 1000], [80000.5, 81000], [null, null]]) {
      assert.equal(tillPrefillSats(min, max), null, `${min}..${max}`);
    }
  });
});

describe('an address on the provider\'s domain', () => {
  test('is a till code wherever it came from', () => {
    for (const address of ['TSHP%2Fconfirm@cryptoqr.net', 'x@CryptoQR.NET', ' x@pay.cryptoqr.net ']) assert.equal(isTillAddress(address), true, address);
  });

  test('a look-alike is not', () => {
    for (const address of ['x@cryptoqr.net.evil.com', 'x@notcryptoqr.net', 'cryptoqr.net', '@cryptoqr.net', 'x@evil.com', '', null, 42]) {
      assert.equal(isTillAddress(address), false, String(address));
    }
  });
});

describe('the case an address is paid in', () => {
  test('lower case, except a till code on the provider\'s domain', () => {
    assert.equal(lightningAddressCase(' Maria@Example.COM '), 'maria@example.com');
    assert.equal(lightningAddressCase('TSHP6SJNKTR3IY%2Fconfirm@CryptoQR.net'), 'TSHP6SJNKTR3IY%2Fconfirm@cryptoqr.net');
    assert.equal(lightningAddressCase('AbC@pay.cryptoqr.net'), 'AbC@pay.cryptoqr.net');
  });

  test('a look-alike domain is lowered like any other', () => {
    for (const address of ['AbC@cryptoqr.net.example', 'AbC@evilcryptoqr.net', 'AbC@cryptoqr.network']) {
      assert.equal(lightningAddressCase(address), address.toLowerCase(), address);
    }
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
    assert.equal(isTillCode(padded(CAP)), true);
    assert.equal(isTillCode(padded(CAP + 1)), false);
  });

  test('the limit applies after trimming', () => {
    const code = `za.co.electrum.picknpay${'a'.repeat(CAP - 23)}`;
    assert.equal(isTillCode(`   ${code}   `), true);
  });
});
