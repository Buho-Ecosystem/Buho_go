import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyKeypadKey, swapKeypadUnit, keypadSats, groupFiatInput } from '../amountKeypad.js'
test('exact tiny Bitcoin entries survive display-only fiat round trips', () => {
  for (const sats of [1,8,10,101]) {
    const fiat = swapKeypadUnit(String(sats), { fiat:false,rate:73456,exactSats:sats })
    const bitcoin = swapKeypadUnit(fiat.value, { fiat:true,rate:73456,exactSats:sats })
    assert.equal(bitcoin.value,String(sats))
  }
})
test('fiat and Bitcoin keys preserve their own precision and ignore no-op edits', () => {
  assert.equal(applyKeypadKey('1','.',{fiat:false}),'1')
  assert.equal(applyKeypadKey('1.20','0',{fiat:true}),'1.20')
  assert.equal(applyKeypadKey('1.','.',{fiat:true}),'1.')
  assert.equal(applyKeypadKey('0','5',{fiat:false}),'5')
  assert.equal(applyKeypadKey('2','000',{fiat:false}),'2000')
  assert.equal(applyKeypadKey('','del',{fiat:false}),'')
  assert.equal(applyKeypadKey('1','-',{fiat:false}),'1')
  assert.equal(keypadSats('0.01',{fiat:true,rate:73456}),13)
  assert.equal(groupFiatInput('1234.5','de-DE'),'1.234,5')
})
test('a missing rate keeps nonzero drafts; an empty fiat draft can return to sats', () => {
  assert.equal(swapKeypadUnit('1',{fiat:false,rate:0}),null)
  assert.equal(swapKeypadUnit('1.25',{fiat:true,rate:0}),null)
  assert.equal(swapKeypadUnit('0.00',{fiat:true,rate:0,exactSats:1}),null)
  assert.equal(swapKeypadUnit('',{fiat:true,rate:0}).fiat,false)
})
