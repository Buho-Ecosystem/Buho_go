/**
 * A scanned code in the Send sheet: the real method, the real classifiers.
 * A shop's till code is whatever is left once nothing the wallet pays claims it.
 *
 * Run: node --test src/components/__tests__/sendTillCodes.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { bech32 } from 'bech32';
import * as lud23 from '../../utils/lud23.js';
import * as merchantQR from '../../utils/merchantQR.js';
import * as bip21 from '../../utils/bip21.js';
import * as addressUtils from '../../utils/addressUtils.js';
import { recognizePhoneNumber } from '../../services/lnAddressServices/phoneNumbers.js';
import * as nostrLookup from '../../utils/nostrLookup.js';
import * as walletCapabilities from '../../utils/walletCapabilities.js';
import * as clipboardSuggestion from '../../utils/clipboardSuggestion.js';
import * as nwcConnection from '../../utils/nwcConnection.js';

const TILL_CODE = '00020129530023za.co.electrum.picknpay0122TSHP6SJNKTR3IY/confirm520458125303710540115802ZA5916cryptoqrtestscan6002CT6304821D';
const NPUB_WITH_RETAILER_WORD = 'npub1qf8znth8248fx577w3z7ggf4tr4p7geyghu05y3tfejma3a7umpqr9x855';
const SPARK_ADDRESS = 'spark1abcdef';
/** A secret key holding letters a pattern once matched anywhere ("umpqr"). Made up: nobody's key. */
const NSEC_WITH_NETWORK_LETTERS = (() => {
  const words = Array.from({ length: 52 }, (_, i) => (i * 7) % 32);
  words.splice(10, 5, 28, 27, 1, 0, 3); // u m p q r
  words[51] = 0;
  return bech32.encode('nsec', words);
})();

/** The Send sheet's options (methods, computed, watch), with the real classifiers. */
function sendSheet() {
  const source = readFileSync(new URL('../SendModal.vue', import.meta.url), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const { code } = transformSync(script, { format: 'cjs', supported: { 'dynamic-import': false } });
  const dependencies = {
    '../utils/lud23.js': lud23,
    '../utils/merchantQR': merchantQR,
    '../utils/bip21': bip21,
    '../utils/addressUtils': addressUtils,
    '../services/lnAddressServices': { recognizePhoneNumber },
    '../utils/nostrLookup': nostrLookup,
    '../utils/walletCapabilities': walletCapabilities,
    '../utils/clipboardSuggestion.js': clipboardSuggestion,
    '../utils/nwcConnection.js': nwcConnection,
    '../utils/shopClipboard.js': { readClipboardCrossPlatform: async () => clipboardText },
    '../services/addressRequestIntake.js': { offerAddressRequest: () => false },
    '../services/nwcConnectionIntake.js': { offerNwcConnection: () => false },
    '../services/nostrPaymentTarget': {
      resolveNostrLightningTarget: async () => ({ address: 'resolved@example.com', kind: 'lightning_address' }),
    },
    '../services/nip05': { usernameAddressFromInput: (input) => (input.startsWith('@') ? `${input.slice(1)}@example.com` : null) },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => dependencies[name] || {}, module, module.exports);
  return module.exports.default;
}

/** What the clipboard holds when the sheet's Paste button reads it. */
let clipboardText = '';
const sheet = sendSheet();
const { methods } = sheet;

async function scan(text, walletType = 'spark') {
  const emitted = [];
  const notices = [];
  const vm = {
    ...methods,
    $t: (key) => key,
    $q: { notify: (notice) => notices.push(notice) },
    $emit: (name, payload) => { if (name === 'payment-detected') emitted.push(payload); },
    walletStore: { activeWalletType: walletType, canAnyWalletPay: () => true },
    isProcessing: false,
    manualInput: '',
    show: true,
  };
  await vm.onQRDetect(text);
  return { emitted, notices, processing: vm.isProcessing };
}

for (const walletType of ['spark', 'arkade', 'nwc', 'lnbits', null]) {
  test(`a shop the provider takes goes out as its address, marked as a shop (${walletType} wallet)`, async () => {
    const { emitted, notices } = await scan(TILL_CODE, walletType);
    assert.deepEqual(notices, []);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].type, 'lightning_address');
    assert.equal(emitted[0].source, merchantQR.SA_RETAIL_SOURCE);
    assert.equal(emitted[0].merchant.id, 'picknpay');
    assert.equal(emitted[0].data, `${encodeURIComponent(TILL_CODE)}@cryptoqr.net`);
  });
}

for (const [code, network] of [['0821234567', 'scantopay'], ['https://pos.snapscan.io/qr/TEST', 'snapscan'], ['https://www.zapper.com/url/TEST', 'zapper']]) {
  test(`${code} goes to the provider too, which says whether it takes it`, async () => {
    const { emitted, notices } = await scan(code);
    assert.deepEqual(notices, [], 'nothing is decided here');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].source, merchantQR.SA_RETAIL_SOURCE);
    assert.equal(emitted[0].merchant.id, network);
    assert.equal(emitted[0].data, `${merchantQR.encodeTillCode(code)}@cryptoqr.net`);
    assert.equal(emitted[0].randAmount, null);
  });
}

test('the rand amount printed in the code goes along', async () => {
  const { emitted } = await scan(TILL_CODE);
  assert.equal(emitted[0].randAmount, '1.00');
});

// Everything handed on is sent to the provider at once: a code that only
// mentions a network stays on the phone.
for (const text of ['WIFI:T:WPA;S:snapscan-guest;P:hunter2;;', 'otpauth://totp/Snapscan:me?secret=JBSWY3DPEHPK3PXP', 'https://example.com/reset?token=SECRET&ref=snapscan']) {
  test(`${text.slice(0, 28)}... never goes to the provider`, async () => {
    const { emitted, notices, processing } = await scan(text);
    assert.deepEqual(emitted, []);
    assert.equal(notices[0]?.message, "We don't recognize this code");
    assert.equal(processing, false);
  });
}

// A secret key or a token can hold a network's letters by chance. It is no
// till code, and it never leaves the phone as one.
for (const text of [NSEC_WITH_NETWORK_LETTERS, 'cashuBo2FteCJodHRwczovL21pbnQuZXhhbXBsZS5jb21hdWNzYXRhdIGiYWlIAJumPQR1']) {
  test(`${text.slice(0, 16)}... holds a network's letters and still never goes to the provider`, async () => {
    assert.match(text, /umpqr/i);
    const { emitted, notices, processing } = await scan(text);
    assert.deepEqual(emitted, []);
    assert.equal(notices[0]?.message, "We don't recognize this code");
    assert.equal(processing, false);
  });
}

test('an address on the provider\'s domain keeps the case of its name; any other is lowered', async () => {
  const till = await scan('TSHP6SJNKTR3IY%2Fconfirm@CryptoQR.net');
  assert.equal(till.emitted[0]?.data, 'TSHP6SJNKTR3IY%2Fconfirm@cryptoqr.net');
  const plain = await scan('Maria@Example.COM');
  assert.equal(plain.emitted[0]?.data, 'maria@example.com');
});

test('anything else is simply not recognized', async () => {
  const { emitted, notices, processing } = await scan('hello');
  assert.deepEqual(emitted, []);
  assert.equal(notices[0].message, "We don't recognize this code");
  assert.equal(processing, false);
});

// A till code is a bare code. Wrapped in a link, nothing goes to the provider.
for (const text of [`lightning:${TILL_CODE}`, `bitcoin:${TILL_CODE}`, 'bitcoin:0821234567', 'lightning:0821234567']) {
  test(`${text.slice(0, 24)}... is not a till code`, async () => {
    const { emitted, notices, processing } = await scan(text);
    assert.deepEqual(emitted, []);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].message, "We don't recognize this code");
    assert.equal(processing, false);
  });
}

const payments = [
  ['a Lightning address named after a retailer', 'snapscan@example.com', 'lightning_address'],
  ['a Lightning address with a retailer word', 'easypay@example.com', 'lightning_address'],
  ['a Lightning address at the provider', 'alice@cryptoqr.net', 'lightning_address'],
  ['a Lightning address whose domain reads like a till', 'bob@za.co.electrum.example.com', 'lightning_address'],
  ['a username', '@easypay', 'lightning_address'],
  ['a Bitcoin link labelled with a retailer', 'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?label=EasyPay%20Store', 'bitcoin_address'],
  ['a fallback link to an LNURL', 'https://snapscan.io/?lightning=lnurl1dp68gurn8ghj7um9', 'lnurl'],
  ['a Spark-only unified link', `bitcoin:?spark=${SPARK_ADDRESS}&label=EasyPay`, 'spark_address'],
  ['a public code', NPUB_WITH_RETAILER_WORD, 'lightning_address'],
];

for (const [name, text, type] of payments) {
  test(`${name} stays a payment`, async () => {
    const { emitted, notices } = await scan(text);
    assert.deepEqual(notices, []);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].type, type);
    assert.equal(emitted[0].source, undefined);
  });
}

// ── Ten digits: a till code when scanned, a phone number when typed ─────────
//
// A Scan to Pay till prints its code as ten bare digits (its operator's
// developer docs: "A Scan to Pay merchant identified by 10 digit QR"). A local
// mobile number in every payout country is ten digits too: `0` and nine. A
// phone number belongs in a QR code as a `tel:` link, so what the camera reads
// as bare digits is a till; what a person types or pastes is a phone number.

/** A local number in each payout country, each also the shape of a till code. */
const LOCAL_NUMBERS = [['KE', '0712345678'], ['ZM', '0971234567'], ['TZ', '0741234567'], ['GH', '0241234567']];

/** What a typed or pasted text emits: the same method, without the camera. */
async function typed(text) {
  const emitted = [];
  const vm = {
    ...methods,
    $t: (key) => key,
    $q: { notify: () => assert.fail('nothing to explain') },
    $emit: (name, payload) => { if (name === 'payment-detected') emitted.push(payload); },
    walletStore: { activeWalletType: 'spark', canAnyWalletPay: () => true },
    isProcessing: true,
    manualInput: text,
    show: true,
  };
  await vm.processPaymentData(text);
  return emitted;
}

/** The field the person sees: its live reading and its typing beat. */
function sendField() {
  const vm = {
    ...methods,
    $t: (key) => key,
    $emit() {},
    $nextTick: (next) => next(),
    $refs: {},
    $q: { notify() {} },
    walletStore: { activeWalletType: 'spark', canAnyWalletPay: () => true },
    manualInput: '',
    scannedText: '',
    mobileMoneyMode: false,
    mmCountry: null,
    resolveError: '',
    clipboardSuggestion: null,
    phoneAdvanceTimer: null,
    pasteAdvanceTimer: null,
  };
  for (const name of ['fieldHoldsScan', 'recognizedPhone', 'detectedInputType', 'isValidManualInput', 'phoneNeedsCountryChoice', 'capabilityBlocked']) {
    Object.defineProperty(vm, name, { get: sheet.computed[name].bind(vm) });
  }
  /** The field's text changes, and its watcher sees it, as in the running sheet. */
  vm.set = (value) => {
    vm.manualInput = value;
    sheet.watch.manualInput.call(vm, value);
  };
  /** What a scan does to the field before it resolves (onQRDetect). */
  vm.scanInto = (value) => {
    vm.scannedText = value;
    vm.set(value);
  };
  vm.stopTimers = () => {
    clearTimeout(vm.phoneAdvanceTimer);
    clearTimeout(vm.pasteAdvanceTimer);
  };
  return vm;
}

for (const [country, number] of LOCAL_NUMBERS) {
  test(`scanned, ${number} goes to the till, though it is also a phone number in ${country}`, async () => {
    const phone = recognizePhoneNumber(number);
    assert.ok([phone?.country.code, ...(phone?.candidates || []).map((c) => c.country.code)].includes(country), 'the overlap is real');
    const { emitted, notices } = await scan(number);
    assert.deepEqual(notices, []);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].source, merchantQR.SA_RETAIL_SOURCE);
    assert.equal(emitted[0].merchant.id, 'scantopay');
    assert.equal(emitted[0].data, `${number}@cryptoqr.net`);
  });

  test(`typed or pasted, ${number} is a phone number in ${country}`, async () => {
    const emitted = await typed(number);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].data, recognizePhoneNumber(number).lightningAddress);
    assert.equal(emitted[0].source, undefined, 'not a till');
  });
}

test('a scanned number with its country code is still a phone number: no till code has that shape', async () => {
  for (const number of ['+254712345678', '254712345678', '00254712345678']) {
    const { emitted } = await scan(number);
    assert.equal(emitted.length, 1, number);
    assert.equal(emitted[0].data, '254712345678@bitcoin.co.ke', number);
    assert.equal(emitted[0].source, undefined, number);
  }
});

test('a scanned tel: link never goes to the till provider', async () => {
  const { emitted } = await scan('tel:+254712345678');
  assert.ok(emitted.every((payload) => payload.source !== merchantQR.SA_RETAIL_SOURCE));
});

test('after a scan, the field reads a till code as a till code, not as a phone number', () => {
  const field = sendField();
  field.scanInto('0712345678');
  assert.equal(field.fieldHoldsScan, true);
  assert.equal(field.recognizedPhone, null, 'no Kenyan number shown for the till');
  assert.equal(field.detectedInputType, null);
  field.scanInto('+254712345678');
  assert.equal(field.detectedInputType, 'phone_number', 'a scanned international number still reads as one');
});

test('after a scan, the typing beat never runs a till code again as a phone number', () => {
  const field = sendField();
  field.scanInto('0712345678');
  assert.equal(field.isValidManualInput, false);
  assert.equal(field.phoneAdvanceTimer, null, 'nothing armed: the field does not read it as typed');
});

test('edited, the text is the person\'s: the same digits typed back are a phone number', () => {
  const field = sendField();
  field.scanInto('0712345678');
  field.set('071234567');
  field.set('0712345678');
  assert.equal(field.fieldHoldsScan, false);
  assert.equal(field.detectedInputType, 'phone_number');
  assert.ok(field.phoneAdvanceTimer, 'typed, it advances on the typing beat');
  field.stopTimers();
});

test('pasted over a scan, the same digits are a phone number', async () => {
  for (const paste of [
    (field) => field.useDestination('0712345678'),
    (field) => field.revealFailed('0712345678', ''),
    async (field) => { clipboardText = '0712345678'; await field.pasteFromClipboard(); },
    (field) => field.onTextareaPaste(),
  ]) {
    const field = sendField();
    field.scanInto('0712345678');
    await paste(field);
    assert.equal(field.fieldHoldsScan, false, String(paste));
    assert.equal(field.detectedInputType, 'phone_number', String(paste));
    field.stopTimers();
  }
});

// ── The till's rand price on the confirm sheet ──────────────────────────────

function confirmSheetComputed() {
  const source = readFileSync(new URL('../PaymentConfirmSheet.vue', import.meta.url), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const { code } = transformSync(script, { format: 'cjs', supported: { 'dynamic-import': false } });
  const module = { exports: {} };
  const dependencies = {
    pinia: { mapState: () => ({}) },
    '../utils/fiatCurrencies.js': { FIAT_SYMBOLS: { ZAR: 'R', EUR: '€' } },
  };
  new Function('require', 'module', 'exports', code)((name) => dependencies[name] || {}, module, module.exports);
  return module.exports.default.computed;
}

test('the till\'s rand price stays in view unless the line above already reads in rand', () => {
  const { zarSecondary } = confirmSheetComputed();
  const sheet = (facts) => zarSecondary.call({
    payment: { zarAmount: '1.00' }, fiatCurrencyCode: 'ZAR', currentCurrency: 'sats', isLocalDenomination: false, fiatEquivalent: '≈ R1.02', ...facts,
  });
  assert.equal(sheet({}), '', 'in rand with rates: the line above says it');
  assert.equal(sheet({ fiatEquivalent: '' }), 'R1.00', 'no exchange rates: the till\'s price is the one figure left');
  assert.equal(sheet({ currentCurrency: 'zar', fiatEquivalent: '≈ 83 sats' }), 'R1.00', 'the line above in Bitcoin');
  assert.equal(sheet({ fiatCurrencyCode: 'EUR', fiatEquivalent: '≈ €0.05' }), 'R1.00', 'another display currency');
  assert.equal(sheet({ payment: { zarAmount: null } }), '', 'no price in the code');
});
