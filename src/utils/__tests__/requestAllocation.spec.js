import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allocateRequest,
  parseRequestAmount,
  MAX_REQUEST_SATS
} from '../requestAllocation.js'
import { reactive, effectScope } from 'vue'
import { useRequestAllocation } from '../../composables/useRequestAllocation.js'
const people = ['ben', 'clara', 'diego'].map((pubkey) => ({ pubkey }))

test('a repayment separates the paid expense, own share and amount to request', () => {
  const result = allocateRequest({ people, totalSats: 48000, repayment: true })
  assert.equal(result.collectSats, 36000)
  assert.equal(result.ownSats, 12000)
  assert.deepEqual(
    result.shares.map((share) => share.amountSats),
    [12000, 12000, 12000]
  )
  assert.equal(
    allocateRequest({
      people,
      totalSats: 48000,
      repayment: true,
      includeSelf: false
    }).collectSats,
    48000
  )
})
test('direct equal requests distribute the requested total, with no own share', () => {
  const result = allocateRequest({ people, totalSats: 36000 })
  assert.equal(result.ownSats, 0)
  assert.equal(result.collectSats, 36000)
  assert.deepEqual(
    result.shares.map((share) => share.amountSats),
    [12000, 12000, 12000]
  )
})
test('rounding conserves every sat and gives a repayment requester the first remainder', () => {
  for (const repayment of [false, true]) {
    for (const totalSats of [4, 7, 1001, 36001, MAX_REQUEST_SATS]) {
      const result = allocateRequest({ people, totalSats, repayment })
      assert.equal(
        result.shares.reduce(
          (sum, share) => sum + share.amountSats,
          result.ownSats
        ),
        totalSats
      )
      assert.ok(result.shares.every((share) => share.amountSats >= 1))
    }
  }
  assert.equal(
    allocateRequest({ people, totalSats: 48001, repayment: true }).ownSats,
    12001
  )
})
test('individual requests derive the goal total; repayments derive the own remainder', () => {
  const amounts = people.map((person, index) => ({
    ...person,
    amountSats: [10000, 14000, 12000][index]
  }))
  assert.equal(
    allocateRequest({ people: amounts, method: 'amounts' }).totalSats,
    36000
  )
  const repayment = allocateRequest({
    people: amounts,
    method: 'amounts',
    totalSats: 48000,
    repayment: true
  })
  assert.equal(repayment.ownSats, 12000)
  amounts[0].amountSats = 11000
  assert.equal(
    allocateRequest({
      people: amounts,
      method: 'amounts',
      totalSats: 48000,
      repayment: true
    }).ownSats,
    11000
  )
})
test('missing, excessive, duplicate and unassigned amounts cannot create requests', () => {
  assert.equal(allocateRequest({ people, totalSats: 2 }).error, 'total')
  assert.equal(
    allocateRequest({ people: [people[0], people[0]], totalSats: 100 }).error,
    'people'
  )
  assert.equal(allocateRequest({ people, method: 'amounts' }).error, 'amount')
  assert.equal(allocateRequest({ people, totalSats: Infinity }).error, 'total')
  const amounts = people.map((person) => ({ ...person, amountSats: 20000 }))
  assert.equal(
    allocateRequest({
      people: amounts,
      method: 'amounts',
      totalSats: 48000,
      repayment: true
    }).error,
    'over'
  )
  amounts[0].amountSats = 1000
  assert.equal(
    allocateRequest({
      people: amounts,
      method: 'amounts',
      totalSats: 48000,
      repayment: true,
      includeSelf: false
    }).error,
    'unassigned'
  )
  assert.equal(
    allocateRequest({
      people: [
        { pubkey: 'b', amountSats: MAX_REQUEST_SATS },
        { pubkey: 'c', amountSats: MAX_REQUEST_SATS }
      ],
      method: 'amounts'
    }).error,
    'limit'
  )
})
test('numeric entry accepts grouping and decimal commas; never fractions of a sat', () => {
  for (const invalid of ['', '0', '-1', '1.5', '1,5', 'NaN', '1e3', 'Infinity'])
    assert.equal(parseRequestAmount(invalid), null)
  assert.equal(parseRequestAmount('12,000'), 12000)
  assert.equal(parseRequestAmount('12.000'), 12000)
  assert.equal(parseRequestAmount('12\u202f000'), 12000)
  assert.equal(parseRequestAmount('8,80', { fiat: true, rate: 80000 }), 11000)
  assert.equal(parseRequestAmount('8.80', { fiat: true, rate: 80000 }), 11000)
  assert.equal(parseRequestAmount('8.80', { fiat: true, rate: 0 }), null)
  assert.equal(
    parseRequestAmount('1.234,56', { fiat: true, rate: 80000 }),
    parseRequestAmount('1,234.56', { fiat: true, rate: 80000 })
  )
})
test('method and unit changes preserve manual edits, exact sats and the entry rate', () => {
  const scope = effectScope()
  const props = reactive({
    people,
    initialSats: 36001,
    initialNote: '',
    fiatRate: 80000,
    repayment: false
  })
  const model = scope.run(() => useRequestAllocation(props))
  model.chooseMethod('amounts')
  assert.equal(model.draft.individual.ben, 12001)
  model.updateIndividual('ben', '10000')
  model.updateIndividual('clara', '14000')
  model.chooseMethod('equal')
  assert.equal(model.totalSats.value, 36000)
  model.chooseMethod('amounts')
  assert.equal(model.draft.individual.ben, 10000)
  model.updateIndividual('ben', '10001')
  model.swapUnit()
  model.swapUnit()
  assert.equal(model.draft.individual.ben, 10001)
  props.fiatRate = 90000
  assert.equal(model.rate.value, 80000)
  scope.stop()
})
