// Contact payment preparation and wallet preferences in the real Vue app.
// All relays, Lightning endpoints and wallet providers are simulated. No funds or external messages.
// Run against pnpm dev --port 9012 (or PAYMENT_PREPARATION_BASE_URL).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createSecretKeySigner, finalizeEvent, getPublicKey } from 'nostr-core';
import { deriveNostrIdentity } from '../src/utils/identityCrypto.js';
import { DM_INBOX_RELAYS } from '../src/services/dm/constants.js';
import { buildRequestTemplate } from '../src/services/dm/protocol.js';
import { sealAndWrap } from '../src/services/dm/giftWrap.js';
import { InvoiceLedger, LnurlServer, SimRelay } from './fixtures/contactChat.mjs';

const base = process.env.PAYMENT_PREPARATION_BASE_URL || 'http://localhost:9012';
const output = process.env.PAYMENT_PREPARATION_OUTPUT || 'output/payment-preparation';
await mkdir(output, { recursive: true });
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const alice = deriveNostrIdentity(mnemonic);
const bob = deriveNostrIdentity('legal winner thank year wave sausage worth useful legal winner thank yellow');
const relay = new SimRelay();
const ledger = new InvoiceLedger();
const lightning = new LnurlServer({ ledger, domain: 'wallet.example' });
const bobProfile = finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [],
  content: JSON.stringify({ name: 'Bob', lud16: 'bob@wallet.example' }) }, bob.privateKey);
relay.inject(bobProfile);
relay.inject(finalizeEvent({ kind: 10050, created_at: Math.floor(Date.now() / 1000), tags: DM_INBOX_RELAYS.map(url => ['relay', url]), content: '' }, bob.privateKey));
const wallets = [
  { id: 'everyday', name: 'Everyday', type: 'spark', balance: 84260 },
  { id: 'travel', name: 'Travel', type: 'lnbits', balance: 24800 },
  { id: 'reserve', name: 'Reserve', type: 'spark', balance: 210000 },
];
let page, context, stepName = 'startup';
let hold = false, lookupFailure = false;
let held = [];
let holdSend = false, heldSends = [];
const pageErrors = [];
const release = () => { hold = false; const waiting = held; held = []; waiting.forEach(resolve => resolve()); };
const releaseSend = () => { holdSend = false; const waiting = heldSends; heldSends = []; waiting.forEach(resolve => resolve()); };
const step = async (name, task) => { stepName = name; await task(); console.log(`  ok  ${name}`); };
const browser = await chromium.launch({ headless: true });

const sheet = () => page.locator('.sheet-card:visible');
const amount = () => sheet().locator('.amount-input');
const cancel = async () => { await sheet().locator('.top-btn').click(); await sheet().waitFor({ state: 'hidden' }); };
const navigate = async path => {
  await page.evaluate(target => document.querySelector('#q-app').__vue_app__.config.globalProperties.$router.push(target), path);
};
const setPreference = async id => page.evaluate(async value => {
  const { usePaymentPreferencesStore } = await import('/src/stores/paymentPreferences.js');
  const prefs = usePaymentPreferencesStore(); prefs.initialize();
  return prefs.setPreferred(value);
}, id);
const preference = () => page.evaluate(async () => {
  const { usePaymentPreferencesStore } = await import('/src/stores/paymentPreferences.js');
  return usePaymentPreferencesStore().preferredWalletId;
});
const activeWallet = () => page.evaluate(async () => {
  const { useWalletStore } = await import('/src/stores/wallet.js');
  return useWalletStore().activeWalletId;
});
const startPayment = (method, target, options = {}) => page.evaluate(async ({ method, target, options }) => {
  const { usePayContact } = await import('/src/composables/usePayContact.js');
  const globals = document.querySelector('#q-app').__vue_app__.config.globalProperties;
  return usePayContact({ $q: globals.$q, $t: globals.$t, $router: globals.$router })[method](target, options);
}, { method, target, options });
const resetPrompt = () => page.evaluate(async () => {
  const { usePaymentPreferencesStore } = await import('/src/stores/paymentPreferences.js');
  localStorage.removeItem('buhoGO_payment_preferences');
  usePaymentPreferencesStore().$patch({ preferredWalletId: null, promptDismissed: false, initialized: true });
});
const setTheme = async dark => page.evaluate(value => document.querySelector('#q-app').__vue_app__.config.globalProperties.$q.dark.set(value), dark);
const snapshot = async name => {
  for (const dark of [false, true]) {
    await setTheme(dark); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/${name}-${dark ? 'dark' : 'light'}.png` });
  }
  await setTheme(false);
};
const assertSource = async path => {
  assert.equal(new URL(page.url()).hash.split('?')[0], `#${path}`, 'preparation retains the source route');
  if (path !== '/wallet') assert.equal(await page.locator('.wallet-toolbar:visible').count(), 0, 'Home never appears behind the payment');
};
const ready = async () => {
  await sheet().locator('.pay-with-field').waitFor();
  await page.waitForFunction(() => !document.querySelector('.preparation-status'));
};
const preparing = async () => {
  await sheet().locator('.preparation-status').waitFor({ timeout: 1500 });
  await page.waitForFunction(() => {
    const status = document.querySelector('.sheet-card .preparation-status');
    if (!status) return false;
    const rect = status.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  }, null, { timeout: 1500 });
};
const payBob = async () => {
  await navigate('/address-book');
  await page.locator('.payee-row').filter({ hasText: 'Bob' }).getByRole('button', { name: 'Pay Bob', exact: true }).click();
};
const chooseWallet = async name => {
  await sheet().locator('.pay-with-field').click();
  await sheet().locator('.payment-wallet-picker').getByRole('radio', { name: new RegExp(name) }).click();
  await sheet().locator('.payment-wallet-apply').click();
};
const finishPaymentForDefaultPopup = async wallet => {
  const { bolt11 } = ledger.mint({ amountSats: 500 });
  await startPayment('payInvoice', { bolt11, name: 'Bob' }); await ready();
  if (wallet) await chooseWallet(wallet);
  assert.equal(await page.locator('.default-wallet-dialog:visible').count(), 0);
  await sheet().locator('button.primary-cta').click();
  const receiptLabel = page.locator('.payment-confirmation:visible .amount-label');
  await receiptLabel.waitFor();
  assert.ok((await receiptLabel.innerText()).trim(), 'completed receipt is visible');
  assert.equal(await page.locator('.default-wallet-dialog:visible').count(), 0, 'success is shown without another popup over it');
  await receiptLabel.click();
  await page.locator('.default-wallet-dialog:visible').waitFor();
  assert.equal(await page.locator('.payment-confirmation:visible').count(), 0, 'receipt has fully closed');
};
const assertFits = async label => {
  await page.waitForTimeout(350);
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll('.q-dialog__inner *')].filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && (rect.left < -1 || rect.right > width + 1) && getComputedStyle(node).position !== 'fixed';
    }).map(node => `${node.tagName}.${typeof node.className === 'string' ? node.className : ''}`).slice(0, 8);
  });
  assert.deepEqual(overflow, [], label);
  const hiddenControls = await page.evaluate(() => [...document.querySelectorAll('.sheet-card .top-row, .sheet-card .confirm-cta, .payment-wallet-header, .payment-wallet-footer, .default-wallet-actions')]
    .filter(node => { const rect = node.getBoundingClientRect(); return rect.height > 0 && (rect.top < -1 || rect.bottom > window.innerHeight + 1); })
    .map(node => node.className));
  assert.deepEqual(hiddenControls, [], `${label}: pinned cancellation and primary controls remain on screen`);
};

try {
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  context.setDefaultTimeout(15000);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue();
    if (url.hostname === 'mempool.space' && url.pathname === '/api/v1/prices') return route.fulfill({ contentType: 'application/json', body: '{"USD":85000,"EUR":78000}' });
    if (lightning.owns(url.hostname)) {
      const shouldFail = lookupFailure;
      if (hold) await new Promise(resolve => held.push(resolve));
      const response = shouldFail ? { status: 503, body: { status: 'ERROR', reason: 'Service temporarily unavailable' } } : lightning.handle(url);
      return route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(response.body) });
    }
    return route.abort();
  });
  await context.routeWebSocket(/.*/, socket => {
    if (new URL(socket.url()).host === new URL(base).host) return socket.connectToServer();
    const connection = relay.attach(socket.url(), frame => { try { socket.send(JSON.stringify(frame)); } catch {} });
    socket.onMessage(raw => connection.onMessage(String(raw))); socket.onClose(() => connection.onClose());
  });
  await context.exposeFunction('__prepPayInvoice', invoice => ledger.pay(invoice));
  await context.exposeFunction('__prepBeforePay', () => holdSend ? new Promise(resolve => heldSends.push(resolve)) : undefined);
  await context.exposeFunction('__prepPayAddress', (address, sats, comment) => {
    const { bolt11 } = lightning.issue({ name: address.split('@')[0], amountSats: sats, comment });
    return { bolt11, preimage: ledger.pay(bolt11) };
  });
  await context.addInitScript(() => {
    localStorage.setItem('buhoGO_language', 'en-US'); localStorage.setItem('buho.theme', 'light');
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
  });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(`${stepName}: ${error.message}`));
  await page.goto(`${base}/#/address-book`);
  await page.locator('.add-contact-btn').waitFor();
  await page.evaluate(async ({ mnemonic, pubkey, npub, event, specs }) => {
    const { useIdentityStore } = await import('/src/stores/identity.js');
    const { useAddressBookStore } = await import('/src/stores/addressBook.js');
    const { useWalletStore } = await import('/src/stores/wallet.js');
    await useIdentityStore().importMnemonic(mnemonic, true);
    const book = useAddressBookStore(); await book.initialize();
    await book.addNostrContact({ pubkey, npub, event, allowWithoutLightningAddress: true });
    const store = useWalletStore(); store.useBip177Format = true; store.preferredFiatCurrency = 'EUR';
    store.wallets = specs.map(({ id, type, name }) => ({ id, type, name })); store.activeWalletId = 'everyday';
    store.connectionStates = Object.fromEntries(specs.map(spec => [spec.id, { connected: true }])); store.providers = {};
    for (const spec of specs) {
      store.providers[spec.id] = {
        isConnected: true, getBalance: async () => spec.balance, getTransactions: async () => [],
        getSparkAddress: async () => `${spec.id}-address`, getLightningSendFeeEstimate: async () => 0,
        payInvoice: async ({ invoice }) => {
          window.__prepCommitStarted = true; await window.__prepBeforePay();
          const preimage = await window.__prepPayInvoice(invoice);
          window.__prepPayments = [...(window.__prepPayments || []), { walletId: spec.id, invoice }];
          return { id: `payment-${spec.id}`, preimage, status: 'completed', fee: 0 };
        },
        payLightningAddress: async (address, amount, comment) => {
          window.__prepCommitStarted = true; await window.__prepBeforePay();
          const result = await window.__prepPayAddress(address, amount, comment);
          window.__prepPayments = [...(window.__prepPayments || []), { walletId: spec.id, address, amount }];
          return { id: `payment-${spec.id}`, preimage: result.preimage, status: 'completed', fee: 0 };
        },
      };
      store.applyBalance(spec.id, spec.balance);
    }
    const providerOf = async id => store.getProvider(id || store.activeWalletId);
    store.ensureWalletConnectedForTransfer = providerOf; store.ensureSparkConnected = providerOf;
    store.ensureLNBitsConnected = providerOf; store.ensureArkadeConnected = providerOf;
    store.refreshWalletData = async () => {}; store.connectAllSparkWallets = async () => {};
  }, { mnemonic, pubkey: bob.publicKeyHex, npub: bob.npub, event: bobProfile, specs: wallets });
  await setPreference(null);

  await step('Address Book Pay opens preparation over the original page and retains entered amount', async () => {
    hold = true;
    await payBob();
    await preparing();
    await assertSource('/address-book');
    await amount().fill('7500');
    await snapshot('01-preparing');
    release(); await ready();
    assert.equal((await amount().inputValue()).replace(/\D/g, ''), '7500');
    await assertSource('/address-book');
    await snapshot('02-ready');
    await cancel();
  });

  await step('Cancel invalidates a held result and does not reopen the sheet', async () => {
    hold = true; await payBob(); await sheet().locator('.preparation-status').waitFor();
    await cancel(); release(); await page.waitForTimeout(350);
    assert.equal(await sheet().count(), 0); await assertSource('/address-book');
    assert.equal(await page.evaluate(() => (window.__prepPayments || []).length), 0);
  });

  await step('Duplicate taps create one payment surface and route leave cancels held work', async () => {
    await navigate('/address-book'); hold = true;
    await page.locator('.payee-row').filter({ hasText: 'Bob' }).getByRole('button', { name: 'Pay Bob', exact: true }).evaluate(button => { button.click(); button.click(); });
    await sheet().locator('.preparation-status').waitFor();
    assert.equal(await sheet().count(), 1);
    await navigate('/settings'); release(); await page.waitForTimeout(350);
    assert.equal(await sheet().count(), 0, 'leaving the source invalidates preparation');
    assert.equal(await page.evaluate(() => (window.__prepPayments || []).length), 0);
  });

  await step('A failed lookup offers inline retry and preserves the amount', async () => {
    lookupFailure = true; await payBob();
    await sheet().locator('.preparation-error').waitFor();
    await amount().fill('3200'); await snapshot('03-retry');
    lookupFailure = false; await sheet().locator('.preparation-retry').click(); await ready();
    assert.equal((await amount().inputValue()).replace(/\D/g, ''), '3200');
    await cancel();
  });

  await step('A newer intent supersedes held preparation and the older result stays discarded', async () => {
    hold = true; await payBob(); await sheet().locator('.preparation-status').waitFor();
    const { bolt11 } = ledger.mint({ amountSats: 700 });
    await startPayment('payInvoice', { bolt11, name: 'Carol' }); await ready();
    assert.equal((await amount().inputValue()).replace(/\D/g, ''), '700');
    release(); await page.waitForTimeout(350);
    assert.equal((await amount().inputValue()).replace(/\D/g, ''), '700', 'older Bob lookup cannot replace Carol invoice');
    await assertSource('/address-book'); await cancel();
  });

  await step('The default-wallet popup waits for success, then supports Not now or Use wallet', async () => {
    await resetPrompt(); await payBob(); await ready();
    assert.equal(await page.locator('.default-wallet-dialog:visible').count(), 0);
    assert.equal(await sheet().locator('.wallet-preference-prompt').count(), 0);
    await cancel();
    assert.equal(await page.locator('.default-wallet-dialog:visible').count(), 0, 'cancellation never asks for a default');

    await finishPaymentForDefaultPopup(); await snapshot('12-default-wallet-popup');
    await page.locator('.default-wallet-dialog').getByRole('button', { name: 'Not now', exact: true }).click();
    await page.locator('.default-wallet-dialog').waitFor({ state: 'hidden' });
    assert.equal(await preference(), null);
    await payBob(); await ready();
    assert.equal(await sheet().locator('.wallet-preference-prompt').count(), 0);
    await cancel();
    await resetPrompt(); await finishPaymentForDefaultPopup('Travel');
    await page.locator('.default-wallet-dialog').getByRole('button', { name: 'Use Travel', exact: true }).click();
    await page.locator('.default-wallet-dialog').waitFor({ state: 'hidden' });
    assert.equal(await preference(), 'travel'); assert.equal(await activeWallet(), 'everyday');
  });

  await step('Preferred wallet is first choice and a one-off switch does not alter it or Home', async () => {
    await setPreference('travel'); await payBob(); await ready();
    assert.match(await sheet().locator('.pay-with-field').innerText(), /Travel/);
    await sheet().locator('.pay-with-field').click(); await snapshot('13-wallet-picker');
    await sheet().locator('.top-btn').click();
    await chooseWallet('Everyday');
    assert.match(await sheet().locator('.pay-with-field').innerText(), /Everyday/);
    assert.equal(await preference(), 'travel'); assert.equal(await activeWallet(), 'everyday');
    await cancel();
  });

  await step('An unusable preferred wallet requires an explicit replacement', async () => {
    await setPreference('travel'); await payBob(); await ready(); await amount().fill('50000');
    await sheet().locator('.choose-wallet-cta').waitFor();
    assert.match(await sheet().locator('.pay-with-field').innerText(), /Travel/);
    await sheet().locator('.choose-wallet-cta').click();
    assert.equal(await sheet().getByRole('radio', { name: /Travel/ }).getAttribute('aria-disabled'), 'true');
    await sheet().getByRole('radio', { name: /Reserve/ }).click(); await sheet().locator('.payment-wallet-apply').click();
    assert.equal(await preference(), 'travel'); assert.equal(await activeWallet(), 'everyday');
    await snapshot('04-one-off-wallet'); await cancel();
  });

  await step('A removed preferred wallet never silently selects another wallet', async () => {
    await setPreference('deleted-wallet'); await payBob(); await ready();
    await sheet().locator('.choose-wallet-cta').waitFor();
    assert.match(await sheet().locator('.pay-with-field').innerText(), /Wallet unavailable/);
    assert.equal(await preference(), 'deleted-wallet');
    await chooseWallet('Reserve');
    assert.equal(await preference(), 'deleted-wallet', 'one-off wallet choice never changes the default'); assert.equal(await activeWallet(), 'everyday'); await cancel();
    await setPreference('travel');
  });

  await step('An explicit wallet choice takes precedence over the saved preference', async () => {
    await setPreference('travel');
    await startPayment('payAddress', { address: 'bob@wallet.example', name: 'Bob' }, { walletId: 'reserve', amountSats: 500 });
    await ready(); assert.match(await sheet().locator('.pay-with-field').innerText(), /Reserve/);
    assert.equal(await preference(), 'travel'); await cancel();
  });

  await step('Settings Cancel discards changes and Save/Automatic persist explicitly', async () => {
    await navigate('/settings'); await page.locator('[data-audit="settings-payment-wallet"]').click();
    const settings = page.locator('.payment-wallet-sheet');
    await snapshot('14-settings-picker');
    await settings.locator('input[data-wallet-id="reserve"]').check();
    await settings.getByRole('button', { name: 'Cancel', exact: true }).click(); assert.equal(await preference(), 'travel');
    await page.locator('[data-audit="settings-payment-wallet"]').click();
    await settings.locator('input[data-wallet-id="reserve"]').check();
    await settings.getByRole('button', { name: 'Save', exact: true }).click(); assert.equal(await preference(), 'reserve');
    await snapshot('05-settings');
    await page.locator('[data-audit="settings-payment-wallet"]').click();
    await settings.locator('input[data-wallet-id="automatic"]').check();
    await settings.getByRole('button', { name: 'Save', exact: true }).click(); assert.equal(await preference(), null);
  });

  await step('Chat request Pay shows preparation before the invoice callback resolves', async () => {
    await navigate('/address-book'); await page.locator('.payee-row').filter({ hasText: 'Bob' }).locator('.payee-open').click();
    await page.locator('.chat-header').waitFor();
    const signer = createSecretKeySigner(bob.privateKey);
    const { wraps } = await sealAndWrap({ template: buildRequestTemplate({ recipient: alice.publicKeyHex, amountSats: 5000, lud16: 'bob@wallet.example', note: 'Coffee', now: () => Math.floor(Date.now() / 1000) }),
      signer: { pubkey: getPublicKey(bob.privateKey), nip44Encrypt: (peer, text) => signer.nip44.encrypt(peer, text), signEvent: template => signer.signEvent(template) }, recipients: [alice.publicKeyHex], selfCopy: false });
    for (const wrap of wraps) relay.inject(wrap.event);
    const card = page.getByRole('group', { name: /^Bob requests.*Coffee/ }); await card.waitFor();
    const source = new URL(page.url()).hash;
    hold = true; await card.getByRole('button', { name: 'Pay', exact: true }).click();
    await preparing();
    assert.equal(new URL(page.url()).hash, source);
    release(); await ready();
    assert.equal((await amount().inputValue()).replace(/\D/g, ''), '5000');
    await snapshot('06-request-ready'); await cancel();
  });

  await step('Chat Send immediately prepares over the same conversation', async () => {
    const source = new URL(page.url()).hash;
    hold = true; await page.locator('.money-btn--send').click();
    await preparing();
    assert.equal(new URL(page.url()).hash, source);
    await cancel(); release(); await page.waitForTimeout(150);
    assert.equal(await sheet().count(), 0);
  });

  await step('Waiting for you Pay prepares immediately over Home without duplicate background UI', async () => {
    await navigate('/wallet'); await page.locator('.waiting-line').waitFor();
    assert.equal(await page.locator('.waiting-line').count(), 1);
    await page.locator('.waiting-line').click();
    hold = true; await page.locator('.waiting-sheet').getByRole('button', { name: 'Pay', exact: true }).click();
    await preparing();
    await assertSource('/wallet');
    assert.equal(await page.locator('.wallet-toolbar:visible').count(), 1, 'payment-only controller renders no second Home');
    await snapshot('08-waiting-preparing');
    release(); await ready(); assert.equal((await amount().inputValue()).replace(/\D/g, ''), '5000');
    await cancel();
  });

  await step('Ordinary Home Send still resolves and confirms without changing the Home wallet', async () => {
    await page.locator('[data-audit="fab-send"]').click();
    const { bolt11 } = ledger.mint({ amountSats: 600 });
    await page.locator('[data-audit="send-input"]').fill(bolt11);
    await sheet().waitFor(); await sheet().locator('.pay-with-field').waitFor();
    assert.equal(await sheet().locator('.preparation-status').count(), 0);
    assert.match(await sheet().locator('.pay-with-field').innerText(), /Everyday/);
    assert.equal(await activeWallet(), 'everyday'); await cancel();
  });

  await step('Home Send contact selection uses the shared immediate payment surface and preference', async () => {
    await setPreference('travel'); await page.locator('[data-audit="fab-send"]').click();
    hold = true;
    await page.locator('[data-audit="send-contact-row"]').filter({ hasText: 'Bob' }).click();
    await preparing();
    await page.locator('.send-sheet:visible').waitFor({ state: 'hidden' });
    release(); await ready(); assert.match(await sheet().locator('.pay-with-field').innerText(), /Travel/);
    await assertSource('/wallet'); await snapshot('11-home-contact'); await cancel();
  });

  await step('A committed send settles once from its pinned wallet despite route and Home changes', async () => {
    await navigate('/address-book'); await setPreference('travel');
    const beforePayments = await page.evaluate(() => (window.__prepPayments || []).length);
    const { bolt11 } = ledger.mint({ amountSats: 500 });
    await startPayment('payInvoice', { bolt11, name: 'Bob' }); await ready();
    assert.match(await sheet().locator('.pay-with-field').innerText(), /Travel/);
    holdSend = true; await sheet().getByRole('button', { name: /^Send .*sats$/ }).click();
    await page.waitForFunction(() => window.__prepCommitStarted);
    await page.evaluate(async () => {
      const { useWalletStore } = await import('/src/stores/wallet.js');
      useWalletStore().activeWalletId = 'reserve';
    });
    await navigate('/settings');
    assert.equal(await startPayment('payAddress', { address: 'bob@wallet.example', name: 'Bob' }), false, 'new intent cannot supersede a committed payment');
    releaseSend(); await page.getByText('Payment Sent', { exact: true }).waitFor();
    const paid = await page.evaluate(() => window.__prepPayments || []);
    assert.equal(paid.length, beforePayments + 1); assert.equal(paid.at(-1).walletId, 'travel');
    await page.getByText('Payment Sent', { exact: true }).click();
    await page.waitForFunction(async () => {
      const { usePaymentFlowStore } = await import('/src/stores/paymentFlow.js');
      return !usePaymentFlowStore().active;
    });
    await assertSource('/settings');
    await page.evaluate(async () => { const { useWalletStore } = await import('/src/stores/wallet.js'); useWalletStore().activeWalletId = 'everyday'; });
  });

  await step('Mobile, larger text and translated preparation remain within the viewport', async () => {
    await navigate('/address-book');
    for (const locale of ['en-US', 'de', 'es']) {
      await page.evaluate(async value => {
        const { applyLocale } = await import('/src/i18n/locales.js');
        applyLocale(document.querySelector('#q-app').__vue_app__._instance.proxy.$i18n, value);
      }, locale);
      await page.setViewportSize({ width: 320, height: 844 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      hold = true; await startPayment('payAddress', { address: 'bob@wallet.example', name: 'Bob' });
      await sheet().locator('.preparation-status').waitFor();
      await assertFits(`${locale}, 320px, 200% root text`);
      await snapshot(`07-large-${locale}`);
      release(); await ready(); await sheet().locator('.pay-with-field').click();
      await assertFits(`${locale} wallet chooser, 320px, 200% root text`);
      await snapshot(`09-large-picker-${locale}`);
      await sheet().locator('.top-btn').click(); await cancel();
      await navigate('/settings'); await page.locator('[data-audit="settings-payment-wallet"]').click();
      assert.equal(await page.locator('.payment-wallet-sheet .form-sheet-title').innerText(), ({ 'en-US': 'Default wallet', de: 'Standard-Wallet', es: 'Cartera predeterminada' })[locale]);
      await assertFits(`${locale} Settings picker, 320px, 200% root text`);
      await snapshot(`10-large-settings-${locale}`);
      await page.locator('.payment-wallet-sheet .form-sheet-cancel').click();
      await navigate('/address-book');
      await resetPrompt(); await finishPaymentForDefaultPopup();
      await assertFits(`${locale} default-wallet popup, 320px, 200% root text`);
      await snapshot(`15-large-default-popup-${locale}`);
      await page.locator('.default-wallet-later').click();
      await page.locator('.default-wallet-dialog').waitFor({ state: 'hidden' });
    }
  });
  assert.deepEqual(pageErrors, []);
  console.log('PASS: payment preparation and preferences');
} catch (error) {
  console.error(`FAIL at ${stepName}`);
  console.error(error);
  if (pageErrors.length) console.error(pageErrors.join('\n'));
  console.error(await page?.evaluate(() => [...document.querySelectorAll('.sheet-card, .top-row, .confirm-cta, .payment-wallet-picker')].map(node => {
    const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
    return { class: node.className, top: rect.top, bottom: rect.bottom, height: rect.height, display: css.display, transform: css.transform, visible: node.checkVisibility?.() };
  })).catch(() => []));
  await page?.waitForTimeout(1000);
  await page?.screenshot({ path: `${output}/FAIL.png` }).catch(() => {});
  process.exitCode = 1;
} finally { release(); releaseSend(); await browser.close(); }
