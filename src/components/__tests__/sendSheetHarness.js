/**
 * The Send sheet for specs: its real options (methods, computed, watch) with
 * the real classifiers, driven on a plain object instead of a mounted
 * component. Shared by the send specs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as lud23 from '../../utils/lud23.js';
import * as merchantQR from '../../utils/merchantQR.js';
import * as bip21 from '../../utils/bip21.js';
import * as addressUtils from '../../utils/addressUtils.js';
import * as phoneNumbers from '../../services/lnAddressServices/phoneNumbers.js';
import { PAYOUT_COUNTRIES } from '../../services/lnAddressServices/countries.js';
import * as telUri from '../../utils/telUri.js';
import * as nostrLookup from '../../utils/nostrLookup.js';
import * as walletCapabilities from '../../utils/walletCapabilities.js';
import * as clipboardSuggestion from '../../utils/clipboardSuggestion.js';
import * as nwcConnection from '../../utils/nwcConnection.js';

/** What the clipboard holds when the sheet's Paste button reads it. */
let clipboardText = '';
export function setClipboard(text) {
  clipboardText = text;
}

/**
 * The services package as the sheet imports it. Its index resolves flag and
 * logo files through the bundler, which plain Node can't load, so the
 * country options here are the same registry data without the images.
 */
const lnAddressServices = {
  ...phoneNumbers,
  matchLnAddressService: () => null,
  payoutCountryOptions: () => PAYOUT_COUNTRIES.map((country) => ({
    code: country.code,
    callingCode: country.callingCode,
    currency: country.currency,
    networkNote: country.networkNote || null,
    flag: '',
    logo: '',
  })),
};

/** The Send sheet's options (methods, computed, watch), with the real classifiers. */
function loadSheet() {
  const source = readFileSync(new URL('../SendModal.vue', import.meta.url), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const { code } = transformSync(script, { format: 'cjs', supported: { 'dynamic-import': false } });
  const dependencies = {
    '../utils/lud23.js': lud23,
    '../utils/merchantQR': merchantQR,
    '../utils/bip21': bip21,
    '../utils/addressUtils': addressUtils,
    '../services/lnAddressServices': lnAddressServices,
    '../utils/payoutCountryPreference': { getPreferredPayoutCountry: () => null, rememberPayoutCountry() {} },
    '../utils/telUri.js': telUri,
    '../utils/nostrLookup': nostrLookup,
    '../utils/walletCapabilities': walletCapabilities,
    '../utils/clipboardSuggestion.js': clipboardSuggestion,
    '../utils/nwcConnection.js': nwcConnection,
    '../utils/shopClipboard.js': { readClipboardCrossPlatform: async () => clipboardText },
    '../services/addressRequestIntake.js': { offerAddressRequest: () => false },
    '../services/nwcConnectionIntake.js': { offerNwcConnection: () => false },
    '../services/nostrPaymentTarget': {
      resolveNostrLightningTarget: async () => ({ address: 'resolved@example.com', kind: 'lightning_address' }),
    },
    '../services/nip05': { usernameAddressFromInput: (input) => (input.startsWith('@') ? `${input.slice(1)}@example.com` : null) },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => dependencies[name] || {}, module, module.exports);
  return module.exports.default;
}

export const sheet = loadSheet();
export const { methods } = sheet;

/** What a scan emits and says: the camera's own handler. */
export async function scan(text, walletType = 'spark') {
  const emitted = [];
  const notices = [];
  const vm = {
    ...methods,
    $t: (key) => key,
    $q: { notify: (notice) => notices.push(notice) },
    $emit: (name, payload) => { if (name === 'payment-detected') emitted.push(payload); },
    walletStore: { activeWalletType: walletType, canAnyWalletPay: () => true },
    isProcessing: false,
    manualInput: '',
    show: true,
  };
  await vm.onQRDetect(text);
  return { emitted, notices, processing: vm.isProcessing };
}

/** What a typed or pasted text emits: the same method, without the camera. */
export async function typed(text) {
  const emitted = [];
  const vm = {
    ...methods,
    $t: (key) => key,
    $q: { notify: () => assert.fail('nothing to explain') },
    $emit: (name, payload) => { if (name === 'payment-detected') emitted.push(payload); },
    walletStore: { activeWalletType: 'spark', canAnyWalletPay: () => true },
    isProcessing: true,
    manualInput: text,
    show: true,
  };
  await vm.processPaymentData(text);
  return emitted;
}

/**
 * The field the person sees: its live reading, its typing beat and the
 * controls around it. Every computed reads live; the watchers run the way
 * Vue runs them (flush). `state` sets any field up front. What it emits is
 * in `emitted`, and `update:resolveError` lands the way the parent's
 * v-model lands it.
 */
export function sendField(state = {}) {
  const vm = {
    ...methods,
    $t: (key) => key,
    emitted: [],
    $emit(name, payload) {
      this.emitted.push({ name, payload });
      if (name === 'update:resolveError') this.resolveError = payload;
    },
    $nextTick: (next) => next(),
    $refs: {},
    $q: { notify() {} },
    walletStore: { activeWalletType: 'spark', canAnyWalletPay: () => true },
    manualInput: '',
    scannedText: '',
    mobileMoneyMode: false,
    mmCountry: null,
    payoutCountries: lnAddressServices.payoutCountryOptions(),
    resolveError: '',
    resolving: false,
    isProcessing: false,
    show: true,
    clipboardSuggestion: null,
    phoneAdvanceTimer: null,
    pasteAdvanceTimer: null,
    ...state,
  };
  for (const [name, computed] of Object.entries(sheet.computed)) {
    if (typeof computed === 'function' && !(name in vm)) {
      Object.defineProperty(vm, name, { get: computed.bind(vm) });
    }
  }
  // What Vue does after a change: each of these watchers whose value changed
  // runs, until nothing changes.
  const WATCHED = ['manualInput', 'fieldHoldsScan'];
  const seen = Object.fromEntries(WATCHED.map((key) => [key, vm[key]]));
  vm.flush = () => {
    for (let changed = true; changed;) {
      changed = false;
      for (const key of WATCHED) {
        const now = vm[key];
        const before = seen[key];
        if (now === before) continue;
        seen[key] = now;
        changed = true;
        sheet.watch[key].call(vm, now, before);
      }
    }
  };
  /** The person changes the field's text. */
  vm.set = (value) => {
    vm.manualInput = value;
    vm.flush();
  };
  /** A scan lands in the field: the camera's own handler, the hand-off to the Wallet page held back. */
  vm.scanInto = async (value) => {
    vm.processPaymentData = async () => {};
    await vm.onQRDetect(value);
    vm.processPaymentData = methods.processPaymentData;
    vm.isProcessing = false;
    vm.flush();
  };
  vm.stopTimers = () => {
    clearTimeout(vm.phoneAdvanceTimer);
    clearTimeout(vm.pasteAdvanceTimer);
  };
  return vm;
}
