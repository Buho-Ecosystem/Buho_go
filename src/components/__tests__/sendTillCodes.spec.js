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
import { recognizePhoneNumber, recognizePhoneNumberForCountry } from '../../services/lnAddressServices/phoneNumbers.js';
import * as telUri from '../../utils/telUri.js';
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
    '../services/lnAddressServices': { recognizePhoneNumber, recognizePhoneNumberForCountry },
    '../utils/payoutCountryPreference': { getPreferredPayoutCountry: () => null, rememberPayoutCountry() {} },
    '../utils/telUri.js': telUri,
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
    isProcessing: false,
    show: true,
    clipboardSuggestion: null,
    phoneAdvanceTimer: null,
    pasteAdvanceTimer: null,
  };
  for (const name of ['fieldHoldsScan', 'recognizedPhone', 'detectedInputType', 'isValidManualInput', 'phoneNeedsCountryChoice', 'capabilityBlocked']) {
    Object.defineProperty(vm, name, { get: sheet.computed[name].bind(vm) });
  }
  // What Vue does after a change: each of these watchers whose value changed
  // runs, until nothing changes.
  const WATCHED = ['manualInput', 'fieldHoldsScan'];
  const seen = Object.fromEntries(WATCHED.map((key) => [key, vm[key]]));
  vm.flush = () => {
    for (let changed = true; changed;) {
      changed = false;
      for (const key of WATCHED) {
        const now = vm[key];
        const before = seen[key];
        if (now === before) continue;
        seen[key] = now;
        changed = true;
        sheet.watch[key].call(vm, now, before);
      }
    }
  };
  /** The person changes the field's text. */
  vm.set = (value) => {
    vm.manualInput = value;
    vm.flush();
  };
  /** A scan lands in the field: the camera's own handler, the hand-off to the Wallet page held back. */
  vm.scanInto = async (value) => {
    vm.processPaymentData = async () => {};
    await vm.onQRDetect(value);
    vm.processPaymentData = methods.processPaymentData;
    vm.isProcessing = false;
    vm.flush();
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
    const phone = recognizePhoneNumber(number);
    const field = sendField();
    field.set(number);
    assert.equal(field.detectedInputType, 'phone_number');
    field.stopTimers();
    // In one country it goes on as that number; in more than one, the field
    // asks which, and nothing goes on until the person says.
    assert.equal(field.phoneNeedsCountryChoice, phone.ambiguous);
    assert.deepEqual((await typed(number)).map((payload) => payload.data), phone.ambiguous ? [] : [phone.lightningAddress]);
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

test('after a scan, the field reads a till code as a till code, not as a phone number', async () => {
  const field = sendField();
  await field.scanInto('0712345678');
  assert.equal(field.fieldHoldsScan, true);
  assert.equal(field.recognizedPhone, null, 'no Kenyan number shown for the till');
  assert.equal(field.detectedInputType, null);
  await field.scanInto('+254712345678');
  assert.equal(field.detectedInputType, 'phone_number', 'a scanned international number still reads as one');
  field.stopTimers();
});

test('after a scan, the typing beat never runs a till code again as a phone number', async () => {
  const field = sendField();
  await field.scanInto('0712345678');
  assert.equal(field.isValidManualInput, false);
  assert.equal(field.phoneAdvanceTimer, null, 'nothing armed: the field does not read it as typed');
});

test('edited, the text is the person\'s: the same digits typed back are a phone number', async () => {
  const field = sendField();
  await field.scanInto('0712345678');
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
    await field.scanInto('0712345678');
    await paste(field);
    field.flush();
    assert.equal(field.fieldHoldsScan, false, String(paste));
    assert.equal(field.detectedInputType, 'phone_number', String(paste));
    field.stopTimers();
  }
});

test('pasted over a scan with the same digits, the till\'s error goes with the scan', async () => {
  for (const paste of [
    async (field) => { clipboardText = '0712345678'; await field.pasteFromClipboard(); },
    (field) => field.onTextareaPaste(),
  ]) {
    const field = sendField();
    await field.scanInto('0712345678');
    field.resolveError = "This code can't be paid. Ask the cashier for a new one.";
    const errors = [];
    field.$emit = (name, value) => { if (name === 'update:resolveError') errors.push(value); };
    await paste(field);
    field.flush();
    assert.deepEqual(errors, [''], String(paste));
    field.stopTimers();
  }
});

// ── A tel: link: the phone number it calls ─────────────────────────────────
//
// A phone number belongs in a QR code as a `tel:` link (RFC 3966; zxing's
// barcode contents guide). Read in the RFC's form, it is the number it calls,
// read the way the same number typed would be, and never a till code.

/** An international number in each payout country, in its `tel:` link. */
const TEL_LINKS = [['KE', 'tel:+254712345678'], ['ZM', 'tel:+260971234567'], ['TZ', 'tel:+255741234567'], ['GH', 'tel:+233241234567']];
const CALLING_CODES = { KE: '254', ZM: '260', TZ: '255', GH: '233' };

for (const [country, link] of TEL_LINKS) {
  test(`scanned, ${link} is a phone payout in ${country}`, async () => {
    const { emitted, notices } = await scan(link);
    assert.deepEqual(notices, []);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].type, 'lightning_address');
    assert.equal(emitted[0].data, recognizePhoneNumber(link.slice('tel:'.length)).lightningAddress);
    assert.equal(emitted[0].source, undefined, 'not a till');
    assert.equal(recognizePhoneNumber(link).country.code, country);
  });
}

test('scanned, a tel: link is read in the forms the RFC writes it', async () => {
  for (const link of ['TEL:+254712345678', 'tel:+254-712-345-678', 'tel:+254(712)345.678', 'tel:0712345678;phone-context=+254', 'tel:0712345678;phone-context=+2-5-4']) {
    const { emitted, notices } = await scan(link);
    assert.deepEqual(notices, [], link);
    assert.deepEqual(emitted.map((payload) => payload.data), ['254712345678@bitcoin.co.ke'], link);
  }
});

test('scanned, ten digits in a tel: link are a phone number in the country it names, never the till\'s', async () => {
  for (const [country, number] of LOCAL_NUMBERS) {
    const { emitted, notices } = await scan(`tel:${number};phone-context=+${CALLING_CODES[country]}`);
    assert.deepEqual(notices, [], number);
    assert.deepEqual(emitted.map((payload) => payload.data), [recognizePhoneNumberForCountry(country, number).lightningAddress], number);
  }
});

test('the country a tel: link names picks among the ones its number is valid in', async () => {
  const { emitted } = await scan('tel:0751234567;phone-context=+260');
  assert.deepEqual(emitted.map((payload) => payload.data), ['260751234567@bitzed.xyz']);
});

test('scanned, a tel: link no payout service takes, or that does not say its country, is refused and goes nowhere', async () => {
  for (const link of [
    'tel:+12125551212',
    'tel:0712345678',
    'tel:0751234567',
    'tel:0723891234',
    'tel:0821234567',
    'tel:+254712345678;ext=101',
    'tel:0712345678;phone-context=+260',
    'tel:0712345678;phone-context=example.com',
    'tel:+254 712 345 678',
  ]) {
    const { emitted, notices, processing } = await scan(link);
    assert.deepEqual(emitted, [], `${link}: nothing is paid, and nothing goes to the till provider`);
    assert.equal(notices.length, 1, link);
    assert.equal(notices[0].message, "You can't pay this phone number", link);
    assert.equal(notices[0].caption, 'Mobile Money shows which numbers you can pay', link);
    assert.equal(processing, false, link);
  }
});

test('typed or pasted, a tel: link reads as the phone number it calls and goes on as one', async () => {
  const field = sendField();
  field.set('tel:+254712345678');
  assert.equal(field.detectedInputType, 'phone_number');
  assert.equal(field.recognizedPhone.lightningAddress, '254712345678@bitcoin.co.ke');
  assert.ok(field.phoneAdvanceTimer, 'it advances on the typing beat');
  field.stopTimers();

  await field.scanInto('tel:0712345678;phone-context=+254');
  assert.equal(field.detectedInputType, 'phone_number', 'scanned, the field shows the number, not a till');
  field.stopTimers();

  field.set('tel:0712345678');
  assert.equal(field.recognizedPhone, null, 'a local link that does not say its country shows no number');
  assert.equal(field.isValidManualInput, false);
});

test('in Mobile Money, a tel: link is read in the country chosen there, if it says no other', () => {
  const field = sendField();
  field.mobileMoneyMode = true;
  field.mmCountry = 'ZM';
  field.set('tel:0751234567;phone-context=+260');
  assert.equal(field.recognizedPhone.country.code, 'ZM');
  assert.equal(field.phoneNeedsCountryChoice, false, 'the country is already chosen');
  field.stopTimers();
  field.set('tel:0751234567');
  assert.equal(field.recognizedPhone, null, 'not in the RFC\'s form, not even here');
});

test('the field shows only a number it would pay: inside a lightning: link, digits are not a phone number', async () => {
  const field = sendField();
  for (const text of ['lightning:0712345678', 'lightning:+254712345678', 'LIGHTNING:tel:+254712345678']) {
    field.set(text);
    assert.equal(field.recognizedPhone, null, text);
    assert.notEqual(field.detectedInputType, 'phone_number', text);
    field.stopTimers();
    const { emitted } = await scan(text);
    assert.deepEqual(emitted, [], `${text}: nor does sending it pay one`);
  }
});

// ── A number valid in more than one country ─────────────────────────────────

test('typed, a number valid in more than one country waits for the person to say which', () => {
  const field = sendField();
  field.set('0751234567');
  assert.equal(field.phoneNeedsCountryChoice, true, 'the field asks: Which country?');
  assert.deepEqual(field.recognizedPhone.candidates.map((c) => c.country.code), ['KE', 'ZM', 'TZ']);
  field.stopTimers();

  const chosen = [];
  field.$emit = (name, payload) => { if (name === 'payment-detected') chosen.push(payload); };
  field.autoAdvance();
  assert.deepEqual(chosen, [], 'the typing beat goes on with nothing');
  field.selectPhoneCountry(field.recognizedPhone.candidates.find((c) => c.country.code === 'ZM'));
  assert.deepEqual(chosen.map((payload) => payload.data), ['260751234567@bitzed.xyz']);
});

test('copied from the Home strip, such a number lands in the field, which asks too', () => {
  const field = sendField();
  const emitted = [];
  field.$emit = (name, payload) => { if (name === 'payment-detected') emitted.push(payload); };
  field.useDestination('0751234567');
  field.flush();
  assert.equal(field.phoneNeedsCountryChoice, true);
  field.autoAdvance();
  assert.deepEqual(emitted, [], 'the paste beat goes on with nothing');
  field.stopTimers();
});

test('whatever calls the send step with such a number, it is never sent on to a default country', async () => {
  for (const number of ['0751234567', '075 123 4567', '0741234567']) {
    assert.deepEqual(await typed(number), [], number);
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
