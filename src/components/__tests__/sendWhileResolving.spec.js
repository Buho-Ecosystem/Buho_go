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
  const handoffs = [];
  const vm = sendField({
    contactPayment(contact) { handoffs.push(contact); return state.acceptsPayment !== false; },
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
  return { vm, sent, handoffs };
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
  assert.equal(vm.show, false, 'the accepted contact opens its contextual payment');
  assert.equal(vm.manualInput, '', 'the closing sheet is not overwritten by a late paste');
  assert.equal(vm.pasteAdvanceTimer, null, 'and the paste goes nowhere');
});

test('a contact starts no second payment while a destination resolves', () => {
  const { vm, sent, handoffs } = field({ resolving: true, manualInput: '0712345678' });
  vm.onContactPicked(MARIA);
  assert.deepEqual(sent, []);
  assert.deepEqual(handoffs, []);
  assert.equal(vm.manualInput, '0712345678');
  vm.resolving = false;
  vm.onContactPicked(MARIA);
  assert.deepEqual(handoffs, [MARIA], 'the shared contact handoff owns payment-wallet choice');
  assert.deepEqual(sent, [], 'no legacy payment event can race the contextual host');
  assert.equal(vm.show, false);
});

test('accepted contact handoff closes synchronously; rejection keeps the destination sheet unchanged', () => {
  const accepted = field({ manualInput: 'mar' });
  accepted.vm.onContactPicked(MARIA);
  assert.deepEqual(accepted.handoffs, [MARIA]);
  assert.equal(accepted.vm.show, false);
  assert.equal(accepted.vm.isProcessing, true, 'pending input work stays inert during close');
  assert.deepEqual(accepted.sent, []);
  accepted.vm.onContactPicked(MARIA);
  assert.equal(accepted.handoffs.length, 1, 'repeated taps during close cannot open another flow');

  const rejected = field({ acceptsPayment: false, manualInput: 'mar' });
  rejected.vm.onContactPicked({ ...MARIA, source: 'nostr', address: '' });
  assert.equal(rejected.handoffs.length, 1, 'identity/address guards belong to the shared facade');
  assert.equal(rejected.vm.show, true);
  assert.equal(rejected.vm.isProcessing, false);
  assert.equal(rejected.vm.manualInput, 'mar');
  assert.deepEqual(rejected.sent, []);
});

test('a clipboard result after the contact sheet finished hiding cannot refill it or start another payment', async () => {
  let release;
  setClipboard(new Promise(resolve => { release = resolve; }));
  const { vm, handoffs, sent } = field();
  const pasting = vm.pasteFromClipboard();
  vm.onContactPicked(MARIA);
  vm.resetState(); // q-dialog before-hide has now cleared the local busy flag
  release('paste@example.com');
  await pasting;
  assert.equal(vm.show, false);
  assert.equal(vm.manualInput, '');
  assert.equal(vm.pasteAdvanceTimer, null);
  assert.deepEqual(handoffs, [MARIA]);
  assert.deepEqual(sent, []);
  vm.stopTimers();
  setClipboard('');
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
