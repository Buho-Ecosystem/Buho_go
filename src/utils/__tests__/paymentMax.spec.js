import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundedPaymentMax } from '../paymentMax.js'
import { unquotedFeeLimitSats } from '../payingWallets.js'
test('available max budgets the entire enforced fee allowance and recipient maximum', () => {
  for (const balance of [1, 10, 11, 100, 1000, 10001, 100000000]) {
    const max = boundedPaymentMax(balance, { walletType: 'spark', destinationType: 'lightning_address' })
    assert.ok(max + unquotedFeeLimitSats(max) <= balance)
    assert.ok(max + 1 + unquotedFeeLimitSats(max + 1) > balance)
  }
  assert.equal(boundedPaymentMax(100000, { walletType: 'spark', destinationType: 'lnurl', recipientMax: 100 }),100)
})
test('unknown fees, invalid balances and native Bitcoin quotes never get a fabricated Max', () => {
  for (const walletType of ['nwc','lnbits','arkade']) assert.equal(boundedPaymentMax(1000,{walletType,destinationType:'lightning_address'}),null)
  assert.equal(boundedPaymentMax(1000,{walletType:'spark',destinationType:'bitcoin_address'}),null)
  assert.equal(boundedPaymentMax(NaN,{walletType:'spark',destinationType:'lnurl'}),null)
})
