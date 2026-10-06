import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as Pinia from 'pinia';
import * as addresses from '../../utils/addressUtils.js';
import * as requests from '../../utils/lud23.js';
import * as spark from '../../utils/sparkPayment.js';

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
globalThis.localStorage = new MemoryStorage();
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, json: async () => ({ USD: 85000 }) });
const { useAddressBookStore } = await import('../../stores/addressBook.js');
const { useTransactionMetadataStore } = await import('../../stores/transactionMetadata.js');
const { fiatRatesService } = await import('../../utils/fiatRates.js');
fiatRatesService.stopAutoUpdate();
after(() => { globalThis.fetch = originalFetch; });

function component(file, dependencies = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => ({ pinia: Pinia, ...dependencies })[name] || {}, module, module.exports);
  return module.exports.default;
}
const details = component('../TransactionDetails.vue');
const book = component('../AddressBook.vue', { '../stores/transactionMetadata': { useTransactionMetadataStore } });
const modal = component('../../components/AddressBook/AddressBookModal.vue', {
  '../../stores/addressBook': { useAddressBookStore }, '../../utils/addressUtils.js': addresses,
  '../../utils/lud23.js': requests, '../../utils/sparkPayment.js': spark,
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness() {
  globalThis.localStorage = new MemoryStorage();
  Pinia.setActivePinia(Pinia.createPinia());
  const contacts = useAddressBookStore(), metadata = useTransactionMetadataStore();
  const notices = [], events = [];
  const vm = { ...modal.data(), ...modal.methods, entry: null, initialAddress: '',
    $emit: (...args) => events.push(args), $t: key => key, $q: { notify: notice => notices.push(notice) } };
  for (const [name, getter] of Object.entries(modal.computed)) {
    Object.defineProperty(vm, name, typeof getter === 'function' ? { get: getter.bind(vm) }
      : { get: getter.get.bind(vm), set: getter.set?.bind(vm) });
  }
  return { contacts, metadata, vm, notices, events };
}

test('the receipt opens the existing Address Book form, pinned to the transaction wallet', () => {
  let destination;
  const vm = { transaction: { id: 'shared-hash', type: 'outgoing' }, $route: { query: { wallet: 'original' } },
    metadataWalletId: 'other-active-wallet', getCounterpartyAddress: () => 'lee@example.com', showContactPicker: true,
    $router: { push: value => { destination = value; } } };
  details.methods.createContact.call(vm);
  assert.deepEqual(destination, { path: '/address-book', query: {
    action: 'create-contact', transaction: 'shared-hash', wallet: 'original', address: 'lee@example.com',
  } });
  assert.equal(vm.showContactPicker, false);
  vm.transaction.type = 'incoming';
  vm.getCounterpartyAddress = () => 'my-own-address@example.com';
  details.methods.createContact.call(vm);
  assert.equal(destination.query.address, undefined, 'a receive must never prefill our own address as the sender');
});

test('prefill remains add mode and rejects invoices and invalid addresses', () => {
  const { vm } = harness();
  for (const value of ['', 'not-an-address', 'lnbc1invoice', 'lightning:lnbc1invoice']) {
    vm.initialAddress = value; vm.initializeForm();
    assert.equal(vm.formData.address, '');
  }
  vm.initialAddress = ' lee@example.com '; vm.initializeForm();
  assert.equal(vm.formData.address, 'lee@example.com'); assert.equal(vm.isEditing, false);
  vm.entry = { id: 'existing', name: 'Existing', address: 'existing@example.com' };
  vm.initializeForm();
  assert.equal(vm.formData.address, 'existing@example.com', 'edit mode keeps the existing entry');
});

test('manual creation uses existing persistence and emits the saved entry for scoped assignment', async () => {
  const { vm, contacts, metadata, events } = harness();
  vm.formData = { name: 'Lee', address: 'lee@example.com', notes: 'Friend' };
  await vm.saveEntry();
  const saved = events.find(([name]) => name === 'saved')[1];
  assert.equal(saved.id, contacts.entries[0].id);
  assert.equal(JSON.parse(localStorage.getItem('buhoGO_address_book'))[0].id, saved.id);
  const page = { selectedEntry: null, creatingFromRoute: true,
    $route: { query: { transaction: 'shared-hash', wallet: 'original' } }, $q: vm.$q, $t: vm.$t };
  await book.methods.handleEntrySaved.call(page, saved);
  assert.equal(metadata.getContactForTransaction('shared-hash', 'original')?.id, saved.id);
  assert.equal(metadata.getContactForTransaction('shared-hash', 'other'), null);
});

test('closing the form while metadata initializes cannot change the captured transaction or wallet', async () => {
  const { contacts, metadata } = harness();
  const entry = await contacts.addEntry({ name: 'Lee', address: 'lee@example.com' });
  const gate = deferred();
  metadata.initialize = () => gate.promise;
  const page = { creatingFromRoute: true, $route: { query: { transaction: 'first', wallet: 'A' } } };
  const pending = book.methods.handleEntrySaved.call(page, entry);
  page.$route.query = { transaction: 'second', wallet: 'B' };
  gate.resolve(); await pending;
  assert.equal(metadata.getContactForTransaction('first', 'A')?.id, entry.id);
  assert.equal(metadata.getContactForTransaction('second', 'B'), null);
});

test('cancel consumes the creation request; later ordinary saves never attach to the old receipt', async () => {
  const { contacts, metadata } = harness();
  const query = { action: 'create-contact', address: 'lee@example.com', transaction: 'tx', wallet: 'A', keep: 'yes' };
  const page = { ...book.methods, creatingFromRoute: true, $route: { query },
    $router: { replace: ({ query }) => { page.$route.query = query; page.creatingFromRoute = false; } } };
  book.watch.showModal.call(page, false);
  assert.deepEqual(page.$route.query, { keep: 'yes' });
  const entry = await contacts.addEntry({ name: 'Someone else', address: 'other@example.com' });
  await page.handleEntrySaved(entry);
  assert.equal(metadata.getContactForTransaction('tx', 'A'), null);
});

test('missing or ambiguous route identifiers never fall back to the active wallet', async () => {
  const { metadata } = harness();
  for (const query of [{ transaction: 'tx' }, { wallet: 'A' }, { transaction: ['tx', 'other'], wallet: 'A' }]) {
    await book.methods.handleEntrySaved.call({ creatingFromRoute: true, $route: { query } }, { id: 'contact' });
  }
  assert.deepEqual(metadata.metadata, {});
});

test('assignment failure preserves the saved contact and reports the specific failure', async () => {
  const { contacts, metadata, vm, notices } = harness();
  const entry = await contacts.addEntry({ name: 'Lee', address: 'lee@example.com' });
  metadata.setContactForTransaction = async () => { throw new Error('storage unavailable'); };
  await book.methods.handleEntrySaved.call({ creatingFromRoute: true, $route: { query: { transaction: 'tx', wallet: 'A' } }, $q: vm.$q, $t: vm.$t }, entry);
  assert.equal(contacts.entries.length, 1);
  assert.equal(notices[0].message, 'Failed to assign contact');
});

test('an existing search result assigns the receipt instead of starting a payment', async () => {
  const entry = { id: 'existing' }, calls = [];
  const page = { creatingFromRoute: true, handleEntrySaved: value => calls.push(['assign', value]), payContact: value => calls.push(['pay', value]) };
  book.methods.handleOpenExisting.call(page, entry);
  assert.deepEqual(calls, [['assign', entry]]);
  page.creatingFromRoute = false;
  book.methods.handleOpenExisting.call(page, entry);
  assert.deepEqual(calls[1], ['pay', entry], 'ordinary Address Book behavior stays intact');
});

for (const name of ['AddContactScan', 'AddContactSearch']) {
  test(`${name} passes the saved Nostr entry through the shared modal`, async () => {
    const child = component(`../../components/AddressBook/${name}.vue`);
    const { vm, events } = harness(), entry = { id: 'nostr-contact', address: '' };
    await child.methods.onSave.call({ resolved: { pubkey: 'key' }, profileEvent: {}, isSaving: false,
      addNostrContact: async () => entry, $q: vm.$q, $t: vm.$t,
      $emit: (name, value) => { if (name === 'saved') vm.onChildSaved(value); }, reset() {}, teardown() {} });
    assert.deepEqual(events.find(([name]) => name === 'saved'), ['saved', entry]);
  });
}
