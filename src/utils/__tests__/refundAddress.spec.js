/**
 * The "Refunds to" row (utils/refundAddress.js): when it shows, which
 * address it offers first, and what a refusal at the till means for it.
 *
 * Run: node --test src/utils/__tests__/refundAddress.spec.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYER_ADDRESS_PURPOSE,
  REFUND_PROBLEM,
  REFUND_SOURCE,
  chosenRefundAddress,
  payerAddressRule,
  refundAddressOptions,
  refundRefusal,
  sameRefundAddress,
  shortRefundAddress,
} from '../refundAddress.js';
import { counterpartyError } from '../errorOrigin.js';

const NO_ROW = { show: false, required: false, canDecline: false, purpose: null, blocked: false };
const OPTIONAL = { identifier: { mandatory: false } };
const MANDATORY = { identifier: { mandatory: true } };

describe('when the row shows (the rules table)', () => {
  test('a till payment that asks: shown, sent by default, may decline', () => {
    assert.deepEqual(payerAddressRule(OPTIONAL, { tillPayment: true }),
      { show: true, required: false, canDecline: true, purpose: PAYER_ADDRESS_PURPOSE.REFUND, blocked: false });
  });

  test('a till payment that insists: shown, no decline', () => {
    assert.deepEqual(payerAddressRule(MANDATORY, { tillPayment: true }),
      { show: true, required: true, canDecline: false, purpose: PAYER_ADDRESS_PURPOSE.REFUND, blocked: false });
  });

  test('anything else that merely asks: no row, nothing shared', () => {
    assert.deepEqual(payerAddressRule(OPTIONAL), NO_ROW);
    assert.deepEqual(payerAddressRule(OPTIONAL, { tillPayment: false }), NO_ROW);
  });

  test('anything else that insists: a row that says it identifies you, no decline', () => {
    assert.deepEqual(payerAddressRule(MANDATORY),
      { show: true, required: true, canDecline: false, purpose: PAYER_ADDRESS_PURPOSE.IDENTIFY, blocked: false });
  });

  test('details BuhoGO never shares, when required, block the payment for anyone', () => {
    for (const tillPayment of [true, false]) {
      assert.deepEqual(payerAddressRule({ ...MANDATORY, email: { mandatory: true } }, { tillPayment }), { ...NO_ROW, blocked: true });
      assert.deepEqual(payerAddressRule({ auth: { mandatory: true, k1: 'aa' } }, { tillPayment }), { ...NO_ROW, blocked: true });
    }
  });

  test('a service that asks for nothing, or sends nonsense, gets no row', () => {
    for (const payerData of [undefined, null, {}, 'identifier', [], { name: {}, email: { mandatory: false } }]) {
      for (const tillPayment of [true, false]) {
        assert.deepEqual(payerAddressRule(payerData, { tillPayment }), NO_ROW, JSON.stringify(payerData));
      }
    }
  });
});

describe('which address is offered', () => {
  const WALLETS = [
    { id: 'lnb', name: 'LNbits', createdAt: 300 },
    { id: 'biz', name: 'Business', createdAt: 100 },
    { id: 'hub', name: 'Hub', createdAt: 200 },
    { id: 'ark', name: 'Arkade', createdAt: 50 },
  ];
  const ADDRESSES = { lnb: 'shop@lnbits.example', biz: 'Biz@Spark.example', hub: 'me@hub.example', ark: null };
  const addressOf = (wallet) => ADDRESSES[wallet.id];
  const order = (facts) => refundAddressOptions({ wallets: WALLETS, addressOf, ...facts }).map((o) => o.address);

  test('the paying wallet first, then the others oldest first, then the profile, then a typed one', () => {
    const options = refundAddressOptions({ wallets: WALLETS, payerWalletId: 'hub', addressOf, profileAddress: 'maria@buho.example', entered: 'typed@else.example' });
    assert.deepEqual(options, [
      { address: 'me@hub.example', source: REFUND_SOURCE.WALLET, walletId: 'hub', name: 'Hub' },
      { address: 'Biz@Spark.example', source: REFUND_SOURCE.WALLET, walletId: 'biz', name: 'Business' },
      { address: 'shop@lnbits.example', source: REFUND_SOURCE.WALLET, walletId: 'lnb', name: 'LNbits' },
      { address: 'maria@buho.example', source: REFUND_SOURCE.PROFILE },
      { address: 'typed@else.example', source: REFUND_SOURCE.ENTERED },
    ]);
  });

  test('a wallet without an address (Arkade has none) is skipped, also when it pays', () => {
    assert.deepEqual(order({ payerWalletId: 'ark' }), ['Biz@Spark.example', 'me@hub.example', 'shop@lnbits.example']);
  });

  test('an unknown paying wallet or none keeps the oldest-first order', () => {
    assert.deepEqual(order({ payerWalletId: 'gone' }), order({ payerWalletId: null }));
    assert.deepEqual(order({}), ['Biz@Spark.example', 'me@hub.example', 'shop@lnbits.example']);
  });

  test('wallets with the same or no creation time keep their list order', () => {
    const wallets = [{ id: 'a' }, { id: 'b', createdAt: 'later' }, { id: 'c', createdAt: 0 }];
    const options = refundAddressOptions({ wallets, addressOf: (w) => `${w.id}@x.example` });
    assert.deepEqual(options.map((o) => o.walletId), ['a', 'b', 'c']);
  });

  test('each address once, whatever its case; the first source keeps it', () => {
    const options = refundAddressOptions({
      wallets: [{ id: 'one', createdAt: 1 }, { id: 'two', createdAt: 2 }],
      addressOf: () => 'Same@Example.com',
      profileAddress: 'same@example.com',
      entered: ' SAME@example.com ',
    });
    assert.deepEqual(options, [{ address: 'Same@Example.com', source: REFUND_SOURCE.WALLET, walletId: 'one', name: '' }]);
  });

  test('a Social Bucket address is labelled as one, a profile\'s own as the profile\'s', () => {
    const bucket = refundAddressOptions({ wallets: [], addressOf, profileAddress: 'npub1abc@npub.cash' });
    assert.deepEqual(bucket, [{ address: 'npub1abc@npub.cash', source: REFUND_SOURCE.BUCKET }]);
    const own = refundAddressOptions({ wallets: [], addressOf, profileAddress: 'maria@npub.cash.example' });
    assert.equal(own[0].source, REFUND_SOURCE.PROFILE, 'only the bucket\'s own domain counts');
  });

  test('no wallets, no profile, nothing typed: nothing to offer', () => {
    assert.deepEqual(refundAddressOptions({ wallets: [], addressOf }), []);
    assert.deepEqual(refundAddressOptions({ wallets: null, addressOf: null, profileAddress: '  ' }), []);
    assert.deepEqual(refundAddressOptions({ wallets: [null, undefined, { id: 'x' }], addressOf: () => 42 }), []);
  });

  test('only an address that can be shared is offered', () => {
    const options = refundAddressOptions({
      wallets: [{ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 2 }, { id: 'c', createdAt: 3 }],
      addressOf: (w) => ({ a: `${'x'.repeat(320)}@hub.example`, b: 'me@münchen.example', c: 'ok@hub.example' })[w.id],
      profileAddress: 'two@@hub.example',
      entered: 'typed@else.example',
    });
    assert.deepEqual(options.map((o) => o.address), ['ok@hub.example', 'typed@else.example'],
      'too long, not ASCII, malformed: none of them would go out, so none is on the row');
  });

  test('Pay with another wallet moves that wallet\'s address to the top', () => {
    assert.equal(order({ payerWalletId: 'biz' })[0], 'Biz@Spark.example');
    assert.equal(order({ payerWalletId: 'lnb' })[0], 'shop@lnbits.example');
  });
});

describe('the address that goes with the payment', () => {
  const ROW = payerAddressRule(OPTIONAL, { tillPayment: true });
  const REQUIRED = payerAddressRule(MANDATORY, { tillPayment: true });
  const OPTIONS = [{ address: 'first@example.com' }, { address: 'second@example.com' }];

  test('no row, no address, whatever was picked', () => {
    assert.equal(chosenRefundAddress(NO_ROW, OPTIONS, { address: 'second@example.com' }), null);
    assert.equal(chosenRefundAddress(null, OPTIONS, null), null);
  });

  test('the first option by default, the pick when there is one', () => {
    assert.equal(chosenRefundAddress(ROW, OPTIONS, null), 'first@example.com');
    assert.equal(chosenRefundAddress(ROW, OPTIONS, { address: 'second@example.com' }), 'second@example.com');
    assert.equal(chosenRefundAddress(ROW, [], null), null, 'nothing to offer');
  });

  test('declining works only where declining is allowed', () => {
    assert.equal(chosenRefundAddress(ROW, OPTIONS, { declined: true }), null);
    assert.equal(chosenRefundAddress(REQUIRED, OPTIONS, { declined: true }), 'first@example.com');
  });
});

describe('what a refusal means for the row', () => {
  const theirs = (message) => Object.assign(counterpartyError('x', ''), { message });
  const coded = (code) => Object.assign(new Error('x'), { code });

  test('our own checks: a needed address, an unusable one', () => {
    assert.equal(refundRefusal(coded('LNURL_PAYER_DATA_REQUIRED')), REFUND_PROBLEM.REQUIRED);
    assert.equal(refundRefusal(coded('LNURL_PAYER_DATA_INVALID'), { sent: 'a@b.example' }), REFUND_PROBLEM.REFUSED);
  });

  test('the provider\'s words and codes, as it sends them', () => {
    assert.equal(refundRefusal(theirs('Could not validate refund address'), { sent: 'a@b.example' }), REFUND_PROBLEM.REFUSED);
    assert.equal(refundRefusal(theirs('INVALID_REFUND_ADDRESS'), { sent: 'a@b.example' }), REFUND_PROBLEM.REFUSED);
    assert.equal(refundRefusal(theirs('REFUND_ADDRESS_REQUIRED')), REFUND_PROBLEM.REQUIRED);
    assert.equal(refundRefusal(theirs('This store requires a refund address')), REFUND_PROBLEM.REQUIRED);
    assert.equal(refundRefusal(theirs('Refund address is missing')), REFUND_PROBLEM.REQUIRED);
  });

  test('"required" although one was sent is the service\'s own words, not the row\'s', () => {
    assert.equal(refundRefusal(theirs('REFUND_ADDRESS_REQUIRED'), { sent: 'a@b.example' }), null);
    assert.equal(refundRefusal(theirs('Refund address is required'), { sent: 'a@b.example' }), null);
  });

  test('a "no" in front says the opposite', () => {
    for (const message of ['No refund address required', 'no refund address needed for this till', 'No refund address is invalid here']) {
      assert.equal(refundRefusal(theirs(message), { sent: null }), null, message);
    }
    assert.equal(refundRefusal(theirs('This till needs a refund address'), { sent: null }), REFUND_PROBLEM.REQUIRED, 'a plain need still counts');
  });

  test('words that only contain the code are not the code', () => {
    assert.equal(refundRefusal(theirs('XREFUND_ADDRESS_REQUIREDX'), { sent: null }), null);
    assert.equal(refundRefusal(theirs('NOT_INVALID_REFUND_ADDRESS_ANYMORE'), { sent: 'a@b.example' }), null);
  });

  test('"could not validate" with nothing sent means one is needed', () => {
    assert.equal(refundRefusal(theirs('Could not validate refund address'), { sent: null }), REFUND_PROBLEM.REQUIRED);
  });

  test('our own words, a network failure, or an unrelated refusal are not about the address', () => {
    assert.equal(refundRefusal(new Error('Could not validate refund address'), { sent: 'a@b.example' }), null, 'not the service\'s words');
    for (const message of ['Insufficient balance', 'Amount out of range', 'refunds are processed in 5 days', '']) {
      assert.equal(refundRefusal(theirs(message), { sent: 'a@b.example' }), null, message);
    }
    for (const error of [null, undefined, 'Could not validate refund address', 42]) assert.equal(refundRefusal(error), null);
  });

  test('without a row on the sheet only our own "needed" check counts', () => {
    assert.equal(refundRefusal(coded('LNURL_PAYER_DATA_REQUIRED'), { shown: false }), REFUND_PROBLEM.REQUIRED, 'the row then appears');
    assert.equal(refundRefusal(theirs('REFUND_ADDRESS_REQUIRED'), { shown: false }), null);
    assert.equal(refundRefusal(coded('LNURL_PAYER_DATA_INVALID'), { shown: false }), null);
  });

  test('a long refusal is read only at its start', () => {
    const late = theirs(`${'x'.repeat(600)} Could not validate refund address`);
    assert.equal(refundRefusal(late, { sent: 'a@b.example' }), null);
  });
});

describe('the same address', () => {
  test('whatever its case or the space around it', () => {
    assert.equal(sameRefundAddress('Me@Hub.Example', ' me@hub.example '), true);
    assert.equal(sameRefundAddress('me@hub.example', 'you@hub.example'), false);
  });

  test('nothing is the same as nothing else', () => {
    for (const [a, b] of [[null, null], ['', ''], ['  ', '  '], [undefined, 'me@hub.example'], ['me@hub.example', 42]]) {
      assert.equal(sameRefundAddress(a, b), false, JSON.stringify([a, b]));
    }
  });
});

describe('the address as the row writes it', () => {
  test('a short name stays whole', () => {
    assert.equal(shortRefundAddress('maria@buho.example'), 'maria@buho.example');
    assert.equal(shortRefundAddress(' sixteen-chars-ok@x.example '), 'sixteen-chars-ok@x.example');
  });

  test('a long one is cut in the middle, the domain whole', () => {
    const npub = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6w6x';
    assert.equal(shortRefundAddress(`${npub}@npub.cash`), 'npub1q…6w6x@npub.cash');
  });

  test('anything that is not an address is returned as it is', () => {
    assert.equal(shortRefundAddress('nobody'), 'nobody');
    assert.equal(shortRefundAddress('@example.com'), '@example.com');
    assert.equal(shortRefundAddress(null), '');
  });
});
