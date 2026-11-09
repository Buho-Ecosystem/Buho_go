/**
 * While a destination resolves, nothing in the Send sheet changes what is
 * being resolved or starts another payment. The real methods and computeds
 * (sendSheetHarness).
 *
 * Run: node --test src/components/__tests__/sendWhileResolving.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clipboardReadCount, sendField, setClipboard } from './sendSheetHarness.js';

const MARIA = { id: 'maria', name: 'Maria', address: 'maria@example.com', addressType: 'lightning', source: 'manual' };

/** The field, with an address book holding Maria, and what it sends. */
function field(state = {}) {
  const vm = sendField({
    addressBookStore: {
      isEntryPayable: () => true,
      getEntryAddress: (entry) => entry.address,
      getEntryAddressType: (entry) => entry.addressType,
      updateLastUsed() {},
    },
    ...state,
  });
  const sent = [];
  vm.$emit = (name, payload) => { if (name === 'payment-detected') sent.push(payload.data); };
  return { vm, sent };
}

test('Paste, Scan and the contacts show while the person is still giving a destination', () => {
  const { vm } = field();
  assert.equal(vm.awaitingDestination, true, 'at rest');
  vm.set('mar');
  assert.equal(vm.awaitingDestination, true, 'a contact search');
  vm.set('maria@example.com');
  assert.equal(vm.awaitingDestination, false, 'a destination: the sheet goes on with it');
  vm.stopTimers();
});

test('while a scanned till code resolves, they give way, as for a typed address', async () => {
  const { vm } = field();
  await vm.scanInto('0712345678');
  assert.equal(vm.isValidManualInput, false, 'a scanned till code never reads as a typed destination');
  for (const busy of [{ isProcessing: true }, { resolving: true }]) {
    Object.assign(vm, { isProcessing: false, resolving: false }, busy);
    assert.equal(vm.awaitingDestination, false, JSON.stringify(busy));
  }
  Object.assign(vm, { isProcessing: false, resolving: false });
  assert.equal(vm.awaitingDestination, true, 'back once the lookup ends, for another try');
});

test('the resting sheet offers nothing while a destination resolves', () => {
  // Opened while a lookup the Home strip started still runs: an empty field.
  const { vm } = field({ resolving: true, clipboardSuggestion: { value: 'maria@example.com' } });
  assert.equal(vm.showMethods, false, 'no Mobile Money or Batch Send');
  assert.equal(vm.showClipboardSuggestion, false, 'no clipboard chip');
  vm.resolving = false;
  assert.equal(vm.showMethods, true);
  assert.equal(vm.showClipboardSuggestion, true);
});

test('Paste does nothing while a destination resolves, and works again after', async () => {
  const { vm } = field();
  await vm.scanInto('0712345678');
  setClipboard('maria@example.com');
  vm.isProcessing = true;
  const reads = clipboardReadCount();
  await vm.pasteFromClipboard();
  assert.equal(vm.manualInput, '0712345678', 'the field still shows what is being resolved');
  assert.equal(vm.pasteAdvanceTimer, null);
  assert.equal(clipboardReadCount(), reads, 'the clipboard is not even read: on the web, a read can ask for permission');
  vm.isProcessing = false;
  await vm.pasteFromClipboard();
  assert.equal(vm.manualInput, 'maria@example.com');
  vm.stopTimers();
});

test('a paste that lands after a lookup started leaves the field to it', async () => {
  const { vm } = field();
  setClipboard('paste@example.com');
  const pasting = vm.pasteFromClipboard(); // the clipboard is being read
  vm.onContactPicked(MARIA); // meanwhile, a contact
  await pasting;
  assert.equal(vm.manualInput, 'maria@example.com', 'the field shows what is being resolved');
  assert.equal(vm.pasteAdvanceTimer, null, 'and the paste goes nowhere');
});

test('a contact starts no second payment while a destination resolves', () => {
  const { vm, sent } = field({ resolving: true, manualInput: '0712345678' });
  vm.onContactPicked(MARIA);
  assert.deepEqual(sent, []);
  assert.equal(vm.manualInput, '0712345678');
  vm.resolving = false;
  vm.onContactPicked(MARIA);
  assert.deepEqual(sent, ['maria@example.com'], 'and goes on with the contact once nothing resolves');
});

test('in Mobile Money, the back arrow closes the sheet while a number resolves', () => {
  const { vm } = field({ mobileMoneyMode: true, mmCountry: 'KE', manualInput: '0712345678', isProcessing: true });
  vm.exitMobileMoney();
  assert.equal(vm.show, false, 'the way out of the sheet, as the close button is elsewhere');
  assert.deepEqual([vm.mobileMoneyMode, vm.mmCountry, vm.manualInput], [true, 'KE', '0712345678'], 'the number it resolves stays as it was');

  const resting = field({ mobileMoneyMode: true, mmCountry: 'KE', manualInput: '07123' }).vm;
  resting.exitMobileMoney();
  assert.equal(resting.show, true, 'otherwise, back to the Send sheet');
  assert.deepEqual([resting.mobileMoneyMode, resting.mmCountry, resting.manualInput], [false, null, '']);
});

test('in Mobile Money, the chosen country stays while its number resolves', () => {
  const { vm } = field({ mobileMoneyMode: true, mmCountry: 'ZM' });
  vm.set('0751234567');
  vm.stopTimers();
  vm.autoAdvance = () => {};
  vm.isProcessing = true;
  vm.selectMmCountry('KE');
  assert.equal(vm.mmCountry, 'ZM', 'the label keeps the country being paid');
  vm.isProcessing = false;
  vm.selectMmCountry('KE');
  assert.equal(vm.mmCountry, 'KE');
});
