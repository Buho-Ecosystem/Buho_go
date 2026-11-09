/**
 * Auto-Transfer setup: a typed Lightning address is checked the way a
 * transfer would pay it, so a rule is never saved for a destination that
 * will refuse every run. A service that will not take a payment without
 * details about the payer (LUD-18) is said at once: no one is there to give
 * them when the rule runs.
 *
 * The sheet's real script runs with its imports stubbed; the pay request is
 * read through the real request path (utils/lnurlPay.js) and the real
 * payer-details reading (utils/lud18.js).
 *
 * Run: node --test src/components/__tests__/autoTransferDestinationCheck.spec.js
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import * as lud18 from '../../utils/lud18.js'
import { PAY_REQUEST, failed, fakeService, lnurlPayWith, ok } from '../../utils/__tests__/lnurlPayFixtures.js'

const source = readFileSync(new URL('../autoTransfer/AutoTransferSheet.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]

function sheet(get) {
  const deps = { '../../utils/lnurlPay.js': lnurlPayWith(get), '../../utils/lud18.js': lud18 }
  const { code } = transformSync(script, { format: 'cjs', supported: { 'dynamic-import': false } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => deps[name] || {}, module, module.exports)
  return module.exports.default
}

async function problemWith(...answers) {
  const { get, asked } = fakeService(...answers)
  const problem = await sheet(get).methods.lightningAddressProblem.call({}, 'savings@hub.example')
  return { problem, asked }
}

test('an address that answers and asks nothing of the payer can be a destination', async () => {
  for (const payerData of [undefined, {}, { identifier: { mandatory: false } }, { name: { mandatory: false } }]) {
    const { problem, asked } = await problemWith(ok({ ...PAY_REQUEST, payerData }))
    assert.equal(problem, null, JSON.stringify(payerData))
    assert.equal(asked.length, 1, 'only the terms are read; nothing is paid')
    assert.equal(asked[0].url, 'https://hub.example/.well-known/lnurlp/savings')
  }
})

test('one that insists on details about the payer is said at once', async () => {
  for (const payerData of [{ identifier: { mandatory: true } }, { email: { mandatory: true } }, { auth: { mandatory: true, k1: 'ab' } }]) {
    assert.equal((await problemWith(ok({ ...PAY_REQUEST, payerData }))).problem, 'details', JSON.stringify(payerData))
  }
})

test('one that does not answer, or answers with something else, is silent', async () => {
  assert.equal((await problemWith(failed(404))).problem, 'silent')
  assert.equal((await problemWith(ok({ status: 'ERROR', reason: 'No such user' }))).problem, 'silent')
  assert.equal((await problemWith(ok({ tag: 'withdrawRequest' }))).problem, 'silent')
  const { get, asked } = fakeService()
  assert.equal(await sheet(get).methods.lightningAddressProblem.call({}, 'not an address'), 'silent')
  assert.equal(asked.length, 0)
})

test('the sheet says why, in the words a failed transfer would use', () => {
  const { computed } = sheet(() => {})
  const said = []
  const self = { candidateState: 'details', candidate: { address: 'savings@hub.example' }, reason: (problem, destination) => { said.push([problem, destination]); return problem }, $t: (x) => x }
  assert.equal(computed.candidateMessage.call(self), 'details')
  assert.deepEqual(said, [['details', { address: 'savings@hub.example' }]])
})
