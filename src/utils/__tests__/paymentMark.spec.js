/** The payment logo an address gets: the rail it is paid on, never a guess. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentMarkKind } from '../paymentMark.js';

test('each kind of address gets the logo of how it is paid', () => {
  assert.equal(paymentMarkKind('lightning'), 'lightning');
  assert.equal(paymentMarkKind('lnurl'), 'lightning', 'a pay link is paid over Lightning');
  assert.equal(paymentMarkKind('', 'lena@getalby.com'), 'lightning', 'read from the address when no kind is stored');
  assert.equal(paymentMarkKind('', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), 'bitcoin');
  assert.equal(paymentMarkKind('spark'), 'spark');
  assert.equal(paymentMarkKind('arkade'), 'arkade');
  assert.equal(paymentMarkKind('', 'lnbc10n1pinvoice'), null, 'an invoice is no contact address: no logo');
  assert.equal(paymentMarkKind('', ''), null);
});
