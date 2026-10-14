import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';
import { parse, compileTemplate } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import * as ServerRenderer from 'vue/server-renderer';
import { WalletProvider } from '../../providers/WalletProvider.js';
import * as breezPayments from '../../utils/breezPayments.js';
import { remainingDepositConfirmations } from '../../utils/breezPayments.js';
import en from '../../i18n/en-US/index.js';
import de from '../../i18n/de/index.js';
import es from '../../i18n/es/index.js';

const source = readFileSync(new URL('../L1BitcoinReceive.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
function evaluate(source, dependencies) {
  const { code } = transformSync(source, { format: 'cjs' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (name) => dependencies[name] || {}, module, module.exports,
  );
  return module.exports;
}
const component = evaluate(descriptor.script.content, {
  'src/utils/breezPayments.js': { remainingDepositConfirmations },
  'src/utils/amountFormatting': { formatAmount: (amount) => `${amount} sats` },
  'src/utils/qrConfig': { getQrOptions: () => ({}) },
}).default;
const { BreezSparkWalletProvider } = evaluate(
  readFileSync(new URL('../../providers/BreezSparkWalletProvider.js', import.meta.url), 'utf8'),
  { './WalletProvider.js': { WalletProvider }, '../utils/breezPayments.js': breezPayments },
);
const template = compileTemplate({
  source: descriptor.template.content, filename: 'L1BitcoinReceive.vue', id: 'deposit-timing',
  ssr: true, ssrCssVars: descriptor.cssVars,
});
assert.deepEqual(template.errors, []);
component.ssrRender = evaluate(template.code, { vue: Vue, 'vue/server-renderer': ServerRenderer }).ssrRender;

async function render({ required = 0, current = 0, quoted = current, wait = true, standardRequired = 3, locale = en } = {}) {
  const app = Vue.createSSRApp({
    ...component,
    setup: () => ({
      walletStore: { isDepositClaimInFlight: () => false },
      bitcoinDepositsStore: {}, chatAvailable: false,
    }),
    data: () => ({ ...component.data(),
      showClaimDialog: true, speedUpOpen: true,
      claimingDeposit: { txId: 'deposit', amount: 66610, confirmations: current, confirmed: false },
      instantClassification: {
        plan: { confirmationsRequired: required }, confirmations: quoted,
        feeSats: 500, creditSats: 66110,
      },
      waitQuote: wait ? { confirmationsRequired: standardRequired, feeSats: 100, creditAmountSats: 66510 } : null,
    }),
  });
  app.config.globalProperties.$t = (key, params = {}) => {
    assert.ok(Object.hasOwn(locale, key), `Missing translation: ${key}`);
    return locale[key].replace(/\{(\w+)\}/g, (_match, name) => params[name] ?? name);
  };
  app.config.globalProperties.$q = { dark: { isActive: false } };
  app.config.globalProperties.$i18n = { locale: locale === de ? 'de' : locale === es ? 'es' : 'en-US' };
  const shell = (tag) => ({ inheritAttrs: false, render() { return Vue.h(tag, this.$attrs, this.$slots.default?.()); } });
  for (const name of ['q-dialog', 'q-card', 'q-spinner', 'q-spinner-dots', 'q-menu', 'q-list', 'q-item']) app.component(name, shell('div'));
  app.component('q-btn', shell('button'));
  app.component('Icon', shell('i'));
  app.directive('close-popup', {});
  return ServerRenderer.renderToString(app);
}

function actionText(html) {
  return html.match(/<button[^>]*data-audit="deposit-add-now"[^>]*>([\s\S]*?)<\/button>/)[1]
    .replace(/<[^>]*>/g, '').trim();
}

for (const [required, current, text, button] of [
  [0, 0, 'Available now', 'Add now'],
  [1, 0, 'After 1 more confirmation', 'Speed up deposit'],
  [2, 0, 'After 2 more confirmations', 'Speed up deposit'],
  [2, 1, 'After 1 more confirmation', 'Speed up deposit'],
  [1, 1, 'Available now', 'Add now'],
  [2, 2, 'Available now', 'Add now'],
]) {
  test(`early depth ${required}, current ${current}: renders accurate timing and action`, async () => {
    const html = await render({ required, current });
    assert.ok(html.includes(text));
    assert.equal(actionText(html), button);
    assert.ok(html.includes('Faster'));
    assert.ok(html.includes('Confirmations are checks by the Bitcoin network. The wait can vary.'));
    assert.ok(html.includes(`After ${3 - current} more confirmation`));
    assert.ok(!html.includes('Right away'));
  });
}

test('SDK quote depth and later deposit polling both advance the displayed wait', async () => {
  for (const [current, quoted] of [[0, 1], [1, 0]]) {
    const html = await render({ required: 1, current, quoted });
    assert.ok(html.includes('Available now'));
    assert.equal(actionText(html), 'Add now');
  }
});

test('missing or invalid timing never promises immediate availability', async () => {
  for (const required of [undefined, null, -1, NaN, Infinity, 1.5, '0']) {
    // Explicitly pass undefined through the defaulted render parameter.
    const html = await render({ required: required === undefined ? null : required });
    assert.ok(html.includes('Timing varies'));
    assert.equal(actionText(html), 'Speed up deposit');
    assert.ok(!html.includes('Available now'));
  }
  assert.equal(remainingDepositConfirmations(1, NaN), null);
  assert.equal(remainingDepositConfirmations(1, -1), null);
  assert.equal(remainingDepositConfirmations(1, 2), 0);
});

test('an early offer without a standard quote still discloses its timing', async () => {
  const html = await render({ required: 2, wait: false });
  assert.ok(html.includes('After 2 more confirmations'));
  assert.equal(actionText(html), 'Speed up deposit');
});

test('an incomplete standard quote does not become an immediate offer', async () => {
  const quote = breezPayments.waitQuoteFromMature({ feeSats: 100, creditAmountSats: 66510 });
  assert.equal(remainingDepositConfirmations(quote.confirmationsRequired, 0), null);
  const html = await render({ required: 1, standardRequired: null });
  assert.ok(html.includes('Timing varies'));
  assert.ok(!html.includes('Available now'));
});

for (const [name, locale] of Object.entries({ en, de, es })) {
  test(`${name}: early availability and confirmation explanation are translated`, async () => {
    for (const required of [0, 1, 2, null]) {
      const html = await render({ required, locale });
      assert.ok(html.includes(locale['Faster']));
      assert.ok(html.includes(locale['Confirmations are checks by the Bitcoin network. The wait can vary.']));
      assert.ok(!html.includes('{count}'));
    }
  });
}

test('instant and expedited quotes preserve the SDK claim request and fee ceiling', async () => {
  for (const required of [0, 1, 2]) {
    const requests = [];
    const instant = { confirmationsRequired: required, feeSats: 500, creditAmountSats: 66110 };
    const provider = new BreezSparkWalletProvider(`timing-${required}`, {
      _testSdk: {
        fetchClaimDepositQuote: async (request) => {
          requests.push(['quote', request]);
          return { confirmations: 1, instant, mature: { confirmationsRequired: 3 } };
        },
        claimDeposit: async (request) => {
          requests.push(['claim', request]);
          return { outcome: { type: 'submitted' } };
        },
      },
    });
    provider.isConnected = true;
    const offer = await provider.classifyUnconfirmedDeposit({ txId: 'deposit', outputIndex: 2, confirmed: false });
    assert.equal(offer.confirmations, 1);
    assert.equal(offer.plan, instant);
    const result = await provider.claimInstantDeposit('deposit', offer.quote, offer.plan, 2);
    assert.equal(result.settled, false);
    assert.deepEqual(requests, [
      ['quote', { txid: 'deposit', vout: 2 }],
      ['claim', { txid: 'deposit', vout: 2, maxFee: { type: 'fixed', amount: 500 } }],
    ]);
  }
});
