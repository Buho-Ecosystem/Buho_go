/**
 * A scanned code in the Send sheet: the real method, the real classifiers.
 * A shop's till code is whatever is left once nothing the wallet pays claims it.
 *
 * Run: node --test src/components/__tests__/sendTillCodes.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as lud23 from '../../utils/lud23.js';
import * as merchantQR from '../../utils/merchantQR.js';
import * as bip21 from '../../utils/bip21.js';
import * as addressUtils from '../../utils/addressUtils.js';
import { recognizePhoneNumber } from '../../services/lnAddressServices/phoneNumbers.js';
import * as nostrLookup from '../../utils/nostrLookup.js';
import * as walletCapabilities from '../../utils/walletCapabilities.js';
import * as clipboardSuggestion from '../../utils/clipboardSuggestion.js';

const TILL_CODE = '00020129530023za.co.electrum.picknpay0122TSHP6SJNKTR3IY/confirm520458125303710540115802ZA5916cryptoqrtestscan6002CT6304821D';
const NPUB_WITH_RETAILER_WORD = 'npub1qf8znth8248fx577w3z7ggf4tr4p7geyghu05y3tfejma3a7umpqr9x855';
const SPARK_ADDRESS = 'spark1abcdef';

function sendSheet() {
  const source = readFileSync(new URL('../SendModal.vue', import.meta.url), 'utf8');
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  const { code } = transformSync(script, { format: 'cjs', supported: { 'dynamic-import': false } });
  const dependencies = {
    '../utils/lud23.js': lud23,
    '../utils/merchantQR': merchantQR,
    '../utils/bip21': bip21,
    '../utils/addressUtils': addressUtils,
    '../services/lnAddressServices': { recognizePhoneNumber },
    '../utils/nostrLookup': nostrLookup,
    '../utils/walletCapabilities': walletCapabilities,
    '../utils/clipboardSuggestion.js': clipboardSuggestion,
    '../services/addressRequestIntake.js': { offerAddressRequest: () => false },
    '../services/nwcConnectionIntake.js': { offerNwcConnection: () => false },
    '../services/nostrPaymentTarget': {
      resolveNostrLightningTarget: async () => ({ address: 'resolved@example.com', kind: 'lightning_address' }),
    },
    '../services/nip05': { usernameAddressFromInput: (input) => (input.startsWith('@') ? `${input.slice(1)}@example.com` : null) },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => dependencies[name] || {}, module, module.exports);
  return module.exports.default.methods;
}

const methods = sendSheet();

async function scan(text) {
  const emitted = [];
  const notices = [];
  const vm = {
    ...methods,
    $t: (key) => key,
    $q: { notify: (notice) => notices.push(notice) },
    $emit: (name, payload) => { if (name === 'payment-detected') emitted.push(payload); },
    walletStore: { activeWalletType: 'spark', canAnyWalletPay: () => true },
    isProcessing: false,
    manualInput: '',
    show: true,
  };
  await vm.onQRDetect(text);
  return { emitted, notices, processing: vm.isProcessing };
}

test('a shop the provider takes goes out as its address, marked as a shop', async () => {
  const { emitted, notices } = await scan(TILL_CODE);
  assert.deepEqual(notices, []);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].type, 'lightning_address');
  assert.equal(emitted[0].source, merchantQR.SA_RETAIL_SOURCE);
  assert.equal(emitted[0].merchant.id, 'picknpay');
  assert.equal(emitted[0].data, `${encodeURIComponent(TILL_CODE)}@cryptoqr.net`);
});

for (const [code, shop] of [['0821234567', 'Scan to Pay'], ['https://pos.snapscan.io/qr/TEST', 'SnapScan']]) {
  test(`${code} says ${shop} is not supported yet, and stops`, async () => {
    const { emitted, notices, processing } = await scan(code);
    assert.deepEqual(emitted, []);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].message, 'SA Retailer QR detected');
    assert.equal(notices[0].caption, `${shop} - not yet supported`);
    assert.equal(processing, false);
  });
}

test('anything else is simply not recognized', async () => {
  const { emitted, notices, processing } = await scan('hello');
  assert.deepEqual(emitted, []);
  assert.equal(notices[0].message, "We don't recognize this code");
  assert.equal(processing, false);
});

const payments = [
  ['a Lightning address named after a retailer', 'snapscan@example.com', 'lightning_address'],
  ['a Lightning address with a retailer word', 'easypay@example.com', 'lightning_address'],
  ['a Lightning address at the provider', 'alice@cryptoqr.net', 'lightning_address'],
  ['a Lightning address whose domain reads like a till', 'bob@za.co.electrum.example.com', 'lightning_address'],
  ['a username', '@easypay', 'lightning_address'],
  ['a Bitcoin link labelled with a retailer', 'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?label=EasyPay%20Store', 'bitcoin_address'],
  ['a fallback link to an LNURL', 'https://snapscan.io/?lightning=lnurl1dp68gurn8ghj7um9', 'lnurl'],
  ['a Spark-only unified link', `bitcoin:?spark=${SPARK_ADDRESS}&label=EasyPay`, 'spark_address'],
  ['a public code', NPUB_WITH_RETAILER_WORD, 'lightning_address'],
];

for (const [name, text, type] of payments) {
  test(`${name} stays a payment`, async () => {
    const { emitted, notices } = await scan(text);
    assert.deepEqual(notices, []);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].type, type);
    assert.equal(emitted[0].source, undefined);
  });
}

test('a payout phone number comes before a ten digit till code', async () => {
  const { emitted, notices } = await scan('0971234567');
  assert.deepEqual(notices, []);
  assert.equal(emitted[0].data, '260971234567@bitzed.xyz');
});
