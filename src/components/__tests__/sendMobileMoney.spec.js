/**
 * Mobile Money in the Send sheet: the country the person picks decides a
 * national number. The real methods, computeds and watchers (sendSheetHarness).
 *
 * Run: node --test src/components/__tests__/sendMobileMoney.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendField } from './sendSheetHarness.js';

/** What the field has sent on: the payout addresses, in order. */
const sentFrom = (field) => field.emitted
  .filter(({ name }) => name === 'payment-detected')
  .map(({ payload }) => payload.data);

/** Mobile Money with `country` chosen and `number` typed, and what it sends. */
function chosen(country, number) {
  const field = sendField({ mobileMoneyMode: true, mmCountry: country });
  field.set(number);
  return { field, sent: sentFrom(field) };
}

/** What the "can't pay" line names: the chosen country and the network its service pays. */
const unpayableLine = (field) => ({
  country: field.countryName(field.mmCountryOption.code),
  note: field.mmCountryOption.networkNote,
});

// Issue #479: each was read in another country and sent on by itself.
// The first three are real numbers in the chosen country, on networks its
// payout service does not pay (countries.js).
const OTHER_COUNTRY_NUMBERS = [
  ['TZ', '0712345678', 'Yas in Tanzania, Safaricom in Kenya', { country: 'Tanzania', note: 'Vodacom M-Pesa only' }],
  ['TZ', '0731234567', 'TTCL in Tanzania, Airtel in Kenya', { country: 'Tanzania', note: 'Vodacom M-Pesa only' }],
  ['GH', '0571234567', 'Ghanaian, answered "only MTN Mobile Money supported"; Airtel in Zambia', { country: 'Ghana', note: 'MTN Mobile Money only' }],
  ['ZM', '0712345678', 'no Zambian mobile number; Safaricom in Kenya', { country: 'Zambia', note: null }],
  ['KE', '0971234567', 'no Kenyan mobile number; Airtel in Zambia', { country: 'Kenya', note: null }],
];

for (const [country, number, why, line] of OTHER_COUNTRY_NUMBERS) {
  test(`${country} chosen, ${number} is not read in another country (${why})`, () => {
    const { field } = chosen(country, number);
    assert.equal(field.recognizedPhone, null, 'no other country on the label');
    assert.equal(field.isValidManualInput, false, 'nothing to continue with');
    assert.equal(field.phoneAdvanceTimer, null, 'the typing beat is not armed');
    field.autoAdvance();
    field.processManualInput();
    assert.deepEqual(sentFrom(field), [], 'nothing goes on by itself, nor by Continue');
    assert.equal(field.mmNumberUnpayable, true, 'the field says it can\'t be paid there');
    assert.deepEqual(unpayableLine(field), line);
  });

  test(`${country} chosen, ${number}: turning the country off goes to no other country by itself`, () => {
    const { field } = chosen(country, number);
    field.selectMmCountry(country);
    assert.equal(field.mmCountry, null);
    assert.notEqual(field.recognizedPhone?.country.code, country, 'read as in the Send field now');
    assert.equal(field.phoneAdvanceTimer, null, 'the typing beat is not armed');
    assert.deepEqual(sentFrom(field), [], 'it waits for Continue');
    field.processManualInput();
    assert.equal(sentFrom(field).length, 1, 'Continue goes on with the country the label shows');
  });
}

test('chosen, the country is the answer to "Which country?": a number valid in several is read there', () => {
  for (const [country, address] of [['KE', '254751234567@bitcoin.co.ke'], ['ZM', '260751234567@bitzed.xyz'], ['TZ', '255751234567@chapsmart.com']]) {
    const { field } = chosen(country, '0751234567');
    assert.equal(field.recognizedPhone.lightningAddress, address, country);
    assert.equal(field.phoneNeedsCountryChoice, false, `${country}: no question`);
    assert.equal(field.mmNumberUnpayable, false);
    field.stopTimers();
  }
});

test('chosen, the bare national number is a number there too', () => {
  const { field } = chosen('KE', '712345678');
  assert.equal(field.recognizedPhone.lightningAddress, '254712345678@bitcoin.co.ke');
  field.stopTimers();
});

test('chosen, a number that names its own country reads there, as its label shows', () => {
  for (const number of ['+254712345678', '254712345678', '00254712345678', 'tel:+254712345678', 'tel:0712345678;phone-context=+254']) {
    const { field } = chosen('TZ', number);
    assert.equal(field.recognizedPhone?.country.code, 'KE', number);
    assert.equal(field.mmNumberUnpayable, false, number);
    field.stopTimers();
  }
});

test('the field says a number can\'t be paid only once it is complete', () => {
  // Still being typed: the start of a number with its calling code
  // (+254 712 345…), or a number that names another country.
  for (const partial of ['0', '07', '071234567', '+25571234', '71234567', '+254712345', '254712345', '00254712345', '+712345678', 'tel:0712345678;phone-context=+260']) {
    assert.equal(chosen('TZ', partial).field.mmNumberUnpayable, false, partial);
  }
  for (const complete of ['0712345678', '0712 345 678', '071-234-5678', '712345678', '+255712345678', '255712345678']) {
    assert.equal(chosen('TZ', complete).field.mmNumberUnpayable, true, complete);
  }
  assert.equal(chosen('TZ', '07123456789').field.mmNumberUnpayable, false, 'too long is not a number there either');
});

test('choosing another country reads the number anew, without the last country\'s error', () => {
  const field = sendField({ mobileMoneyMode: true, mmCountry: 'KE' });
  field.set('0751234567');
  field.resolveError = 'No M-Pesa account for this number'; // the Kenyan lookup failed
  field.stopTimers();
  field.selectMmCountry('ZM');
  assert.equal(field.resolveError, '', 'the Kenyan error is gone');
  assert.deepEqual(sentFrom(field), ['260751234567@bitzed.xyz'], 'and Zambia, now chosen, goes on');

  const unpayable = sendField({ mobileMoneyMode: true, mmCountry: 'KE' });
  unpayable.set('0712345678');
  unpayable.resolveError = 'No M-Pesa account for this number';
  unpayable.stopTimers();
  unpayable.selectMmCountry('TZ');
  assert.equal(unpayable.mmNumberUnpayable, true, 'the field now says Tanzania can\'t pay it');
  assert.equal(unpayable.resolveError, '');
});

test('with no country chosen, Mobile Money reads a number as the Send field does', () => {
  const ambiguous = sendField({ mobileMoneyMode: true });
  ambiguous.set('0751234567');
  assert.equal(ambiguous.phoneNeedsCountryChoice, true, 'the field asks: Which country?');
  assert.equal(ambiguous.mmNumberUnpayable, false);
  ambiguous.stopTimers();

  const kenyan = sendField({ mobileMoneyMode: true });
  kenyan.set('0712345678');
  assert.equal(kenyan.recognizedPhone.country.code, 'KE');
  kenyan.stopTimers();
});

test('outside Mobile Money the field never says it, whatever country was chosen there', () => {
  const field = sendField({ mmCountry: 'KE' });
  field.set('0612345678'); // complete, and no payout country's
  assert.equal(field.mmNumberUnpayable, false);
  field.stopTimers();
});
