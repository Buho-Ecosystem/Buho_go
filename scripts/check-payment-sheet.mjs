// Shared scanned/pasted confirmation in the real Vue app. All network and SDKs
// are fixtures; no funds move. Start pnpm dev --port 9013, then run this file.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { bech32, bech32m } from 'bech32';
import { InvoiceLedger, LnurlServer } from './fixtures/contactChat.mjs';

const base = process.env.PAYMENT_SHEET_BASE_URL || 'http://localhost:9013';
const output = process.env.PAYMENT_SHEET_OUTPUT || 'output/payment-sheet';
const caseFilter = process.env.PAYMENT_SHEET_CASE || '';
await mkdir(output, { recursive: true });
const ledger = new InvoiceLedger();
const lightning = new LnurlServer({ ledger, domain: 'matrix.example' });
const invoice = ledger.mint({ amountSats: 2400 }).bolt11;
const amountless = bech32.encode('lnbc', bech32.decode(invoice, 4096).words, 4096);
const lnurl = bech32.encode('lnurl', bech32.toWords(Buffer.from('https://matrix.example/.well-known/lnurlp/shop')), 4096);
const sparkAddress = 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uc489gg2';
const sparkInvoice = 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uczgvssqgjzrv7pelw7h7yxz53rq0jvtf58dpzyqcg7spsu6khyg';
const bitcoin = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const unsupportedOffer = bech32m.encode('lno', [1, 2, 3, 4]);
const wallets = [
  { id: 'personal', name: 'Personal', type: 'spark', balance: 150000 },
  { id: 'travel', name: 'Travel', type: 'lnbits', balance: 40000 },
  { id: 'reserve', name: 'Reserve', type: 'spark', balance: 500000 },
  { id: 'ark', name: 'Ark', type: 'arkade', balance: 250000 },
];
let page, stepName = 'startup', quoteMode = 'real', heldQuotes = [], holdQuotes = false;
const errors = [], quotes = [];
const releaseQuotes = () => { holdQuotes = false; const callbacks = heldQuotes; heldQuotes = []; callbacks.forEach(resolve => resolve()); };
const browser = await chromium.launch({ headless: true });
const sheet = () => page.locator('.sheet-card:visible');
const amount = () => sheet().locator('.amount-input');
const step = async (name, work) => {
  if (caseFilter && !name.toLowerCase().includes(caseFilter.toLowerCase())) return;
  stepName = name; await work(); console.log(`  ok  ${name}`);
};
const shot = async name => {
  for (const dark of [false, true]) {
    await page.evaluate(value => document.querySelector('#q-app').__vue_app__.config.globalProperties.$q.dark.set(value), dark);
    await page.waitForTimeout(350); await page.screenshot({ path: `${output}/${name}-${dark ? 'dark' : 'light'}.png` });
  }
};
const cancel = async () => { await sheet().locator('.top-btn').click(); await sheet().waitFor({ state: 'hidden' }); };
const ready = async () => {
  await sheet().locator('.pay-with-field').waitFor();
  await page.waitForFunction(() => !document.querySelector('.sheet-card .preparation-status'));
  await page.waitForTimeout(350);
};
const open = async request => {
  assert.equal(await page.evaluate(async () => {
    const { useWalletStore } = await import('/src/stores/wallet.js'); return useWalletStore().activeWalletId;
  }), 'personal', 'payment child views never change the Home wallet');
  await page.locator('[data-audit="fab-send"]').click();
  await page.locator('[data-audit="send-input"]').fill(request);
  // Invoice/native address recognition auto-advances; explicit Continue also
  // exercises the same dispatch for forms which deliberately require review.
  const proceed = page.locator('[data-audit="send-continue"]:visible');
  if (await proceed.count() && await proceed.isEnabled()) await proceed.click();
  await ready();
};
const choose = async name => {
  await sheet().locator('.pay-with-field').click();
  await sheet().locator('.payment-wallet-picker').getByRole('radio', { name: new RegExp(name) }).click();
  await sheet().locator('.payment-wallet-apply').click();
};
const details = async (request, type = null, screenshot = null) => {
  await sheet().locator('.recipient-info').click();
  await sheet().locator('.payment-details-view').waitFor();
  assert.equal(await page.locator('.q-dialog:visible').count(), 1, 'details uses the existing dialog');
  assert.ok((await sheet().locator('.payment-details-view').innerText()).includes(request), 'details retains full destination');
  if (type) assert.match(await sheet().locator('.payment-details-view').innerText(), type, 'technical payment type is available in details');
  await sheet().locator('.payment-details-copy').click();
  assert.equal(await page.evaluate(() => window.__matrixCopied), request, 'copy includes the complete request');
  if (screenshot) await shot(screenshot);
  await sheet().locator('.top-btn').click();
  await sheet().locator('.amount-input').waitFor();
};
const state = () => sheet().evaluate(card => {
  let component = card.__vueParentComponent;
  while (component && component.type.name !== 'PaymentConfirmSheet') component = component.parent;
  const vm = component.proxy;
  return { amount: vm.displayAmount, currency: vm.currentCurrency, comment: vm.comment, wallet: vm.sendingWalletId, payout: vm.payoutCurrency?.code || null };
});
const fits = async label => {
  await page.waitForTimeout(350);
  const bad = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const height = window.visualViewport?.height || window.innerHeight;
    return [...document.querySelectorAll('.sheet-card *')].filter(node => {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height || !node.checkVisibility()) return false;
      if (rect.left < -1 || rect.right > width + 1) return true;
      return node.matches('.top-row, .confirm-cta') && (rect.top < -1 || rect.bottom > height + 1);
    }).map(node => node.className).slice(0, 8);
  });
  assert.deepEqual(bad, [], label);
};

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  context.setDefaultTimeout(15000);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue();
    if (url.hostname === 'mempool.space' && url.pathname === '/api/v1/prices') return route.fulfill({ contentType: 'application/json', body: '{"EUR":78000,"USD":85000}' });
    if (lightning.owns(url.hostname)) {
      const response = lightning.handle(url);
      if (url.pathname.endsWith('/payout') && response.body.tag === 'payRequest') response.body.currency = { code: 'KES', multiplier: 9000, decimals: 0, minSendable: 10, maxSendable: 150000 };
      return route.fulfill({ status: response.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(response.body) });
    }
    return route.abort();
  });
  await context.routeWebSocket(/.*/, socket => {
    if (new URL(socket.url()).host === new URL(base).host) return socket.connectToServer();
    socket.close();
  });
  await context.exposeFunction('__matrixQuote', async (walletId, request) => {
    const mode = quoteMode; quotes.push({ walletId, request, mode });
    if (holdQuotes) await new Promise(resolve => heldQuotes.push(resolve));
    if (mode === 'failure') throw new Error('Simulated quote unavailable');
    return { estimatedFeeSats: mode === 'guess' ? 9876 : 7, isEstimated: mode === 'guess' };
  });
  await context.addInitScript(() => {
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__matrixCopied = text; }, readText: async () => '' } });
    window.__AUDIT__ = { noExitMonitor: true };
  });
  page = await context.newPage(); page.on('pageerror', error => errors.push(`${stepName}: ${error.message}`));
  await page.goto(`${base}/#/wallet`); await page.locator('[data-audit="fab-send"]').waitFor();
  await page.evaluate(async specs => {
    const { useWalletStore } = await import('/src/stores/wallet.js');
    const { usePaymentPreferencesStore } = await import('/src/stores/paymentPreferences.js');
    const store = useWalletStore(); await store.initialize();
    store.useBip177Format = true; store.preferredFiatCurrency = 'EUR';
    store.wallets = specs.map(({ id, name, type }) => ({ id, name, type })); store.activeWalletId = 'personal';
    store.connectionStates = Object.fromEntries(specs.map(({ id }) => [id, { connected: true }])); store.providers = {};
    for (const spec of specs) {
      store.providers[spec.id] = {
        isConnected: true, getBalance: async () => spec.balance, getTransactions: async () => [],
        getSparkAddress: async () => 'spark1pgssy7d7vel0nh9m4326qc54e6rskpczn07dktww9rv4nu5ptvt0s9uc489gg2',
        getIdentityPublicKey: async () => '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        getLightningSendFeeEstimate: request => window.__matrixQuote(spec.id, request),
        getSparkSendFeeEstimate: async (request, amount) => {
          window.__matrixSparkQuotes = [...(window.__matrixSparkQuotes || []), { request, amount }];
          return { estimatedFeeSats: 0, isEstimated: false, request };
        },
        getWithdrawalFeeQuote: async () => Object.fromEntries(['slow', 'medium', 'fast'].map((speed, index) => [speed, { feeQuoteId: `quote-${spec.id}-${speed}`, serviceFee: 10, networkFee: 20 + index * 10, totalFee: 30 + index * 10, timeEstimate: 'About 30 minutes' }])),
        getBitcoinSendFeeEstimate: async ({ amount }) => ({ fee: 123, amount, feeRate: 2 }),
        payInvoice: async args => {
          if (window.__matrixProbeQuotedSend) {
            window.__matrixQuoteProbe = { ...args, walletId: spec.id };
            throw new Error('Controlled quote-consent probe: no payment submitted');
          }
          window.__matrixSendAttempts = (window.__matrixSendAttempts || 0) + 1;
          throw new Error('Matrix must never submit a payment');
        },
        payLightningAddress: async () => { window.__matrixSendAttempts = (window.__matrixSendAttempts || 0) + 1; throw new Error('Matrix must never submit a payment'); },
      };
      store.applyBalance(spec.id, spec.balance);
    }
    const provider = async id => store.getProvider(id || store.activeWalletId);
    store.ensureSparkConnected = provider; store.ensureLNBitsConnected = provider; store.ensureArkadeConnected = provider;
    store.ensureWalletConnectedForTransfer = provider;
    store.refreshWalletData = async () => {}; store.connectAllSparkWallets = async () => {};
    const prefs = usePaymentPreferencesStore(); prefs.initialize(); prefs.setPreferred(null);
    let component = document.querySelector('.wallet-toolbar').__vueParentComponent;
    while (component && component.type.name !== 'WalletPage') component = component.parent;
    window.__matrixHome = component.proxy; window.__matrixHome.stopBitcoinDepositPolling();
    clearInterval(window.__matrixHome.refreshInterval);
  }, wallets);

  await step('Pasted invoice keeps amount primary, shows real SDK fee and opens same-sheet complete details', async () => {
    await open(invoice); assert.equal(await amount().inputValue(), '2400');
    assert.equal((await sheet().locator('.recipient-name').innerText()).trim(), 'Bitcoin payment');
    assert.equal(await amount().getAttribute('readonly'), '');
    await page.waitForFunction(() => document.querySelector('.sheet-card .fee-row-value')?.textContent.includes('7'));
    assert.ok(!(await sheet().locator('.recipient-cell').innerText()).includes(invoice));
    assert.ok(!(await sheet().locator('.recipient-cell').innerText()).includes(invoice.slice(0, 17)), 'no shortened invoice on the main screen');
    assert.equal((await sheet().locator('.recipient-addr').innerText()).trim(), 'Lightning');
    assert.equal(await sheet().locator('.recipient-bitcoin-logo').getAttribute('src'), '/icons/bitcoin.svg');
    const layout = await sheet().evaluate(card => {
      const bounds = selector => card.querySelector(selector).getBoundingClientRect();
      const group = bounds('.amount-denomination'), stage = bounds('.amount-stage');
      const wallet = bounds('.payment-wallet-trigger'), header = bounds('.top-row');
      const conversion = bounds('.amount-conversion'), unit = bounds('.unit-pill');
      return { centered: Math.abs((group.left + group.right - stage.left - stage.right) / 2),
        aligned: Math.abs((conversion.top + conversion.bottom - unit.top - unit.bottom) / 2),
        walletWidth: wallet.width, headerWidth: header.width, walletHeight: wallet.height };
    });
    assert.ok(layout.centered < 2 && layout.aligned < 2, 'amount unit and fiat conversion form one centered group');
    assert.ok(layout.walletWidth < layout.headerWidth * .4 && layout.walletHeight >= 44, 'compact wallet selector preserves its touch target');
    assert.equal(await sheet().locator('.recipient-details').count(), 0, 'no inline long destination');
    const before = await state(); await details(invoice, /Lightning invoice/, '01b-invoice-details'); assert.deepEqual(await state(), before);
    await shot('01-invoice'); await cancel();
  });

  await step('Address and encoded LNURL keep note, amount, currency and wallet through child navigation', async () => {
    for (const request of ['shop@matrix.example', lnurl]) {
      await open(request); await amount().fill('7500');
      await sheet().locator('.note-input').fill('Dinner');
      const before = await state(); await details(request); assert.deepEqual(await state(), before);
      await choose('Travel'); assert.equal((await state()).amount, before.amount); assert.equal((await state()).comment, 'Dinner');
      assert.equal((await state()).wallet, 'travel');
      assert.equal(await sheet().locator('.fee-row').count(), 0, 'no invented routing quote before an invoice');
      await shot(request === lnurl ? '03-lnurl' : '02-address'); await cancel();
    }
  });

  await step('Amountless invoices remain editable and preserve denomination through wallet/details views', async () => {
    await open(amountless); assert.equal(await amount().getAttribute('readonly'), null);
    await sheet().locator('.unit-pill').click(); await amount().fill('3.90');
    const before = await state(); await details(amountless); assert.deepEqual(await state(), before);
    await sheet().locator('.pay-with-field').click(); await sheet().locator('.top-btn').click();
    assert.deepEqual(await state(), before); await shot('04-amountless'); await cancel();
  });

  await step('Native Spark address and invoice keep anonymous recipient simple and technical detail separate', async () => {
    for (const request of [sparkAddress, sparkInvoice]) {
      await open(request);
      if (request === sparkAddress) {
        assert.equal(await sheet().locator('.fee-row').count(), 0, 'native fee is unknown before an amount is entered');
        await amount().fill('5500');
      } else assert.equal(await amount().inputValue(), '500');
      await page.waitForFunction(() => document.querySelector('.sheet-card .fee-row-value')?.textContent.trim().startsWith('Free'));
      assert.ok(await page.evaluate(target => (window.__matrixSparkQuotes || []).some(quote => quote.request === target), request), 'Free follows an actual SDK preparation call');
      assert.equal((await sheet().locator('.recipient-name').innerText()).trim(), 'Bitcoin payment');
      assert.ok(!(await sheet().locator('.recipient-cell').innerText()).includes(request));
      assert.ok(!(await sheet().locator('.recipient-cell').innerText()).includes(request.slice(0, 17)), 'encoded Spark destinations stay in details');
      await details(request, request === sparkAddress ? /Spark payment/ : /Spark invoice/);
      await shot(request === sparkAddress ? '05-spark-address' : '06-spark-invoice'); await cancel();
    }
  });

  await step('Bitcoin BIP21 uses prepared per-wallet SDK quotes and preserves selected amount', async () => {
    await open(`bitcoin:${bitcoin}?amount=0.00005`); assert.equal(await amount().inputValue(), '5000');
    assert.equal((await sheet().locator('.recipient-name').innerText()).trim(), 'Bitcoin payment');
    await sheet().locator('.onchain-panel .speed-card').first().waitFor();
    assert.match(await sheet().locator('.onchain-panel .summary').innerText(), /40/);
    await details(bitcoin, /Bitcoin on-chain payment/);
    assert.equal(await sheet().locator('.onchain-panel .speed-card').first().isVisible(), true);
    assert.equal(await sheet().locator('.onchain-panel .summary').isVisible(), true);
    await shot('07-bitcoin'); await cancel();
  });

  await step('Incompatible and insufficient choices explain restrictions without silently changing selection', async () => {
    await open(invoice); await sheet().locator('.pay-with-field').click();
    assert.equal(await sheet().getByRole('radio', { name: /Ark/ }).getAttribute('aria-disabled'), 'true');
    await sheet().locator('.top-btn').click(); await cancel();
    await open('shop@matrix.example'); await amount().fill('100000');
    await sheet().locator('.pay-with-field').click();
    const travel = sheet().getByRole('radio', { name: /Travel/ });
    assert.equal(await travel.getAttribute('aria-disabled'), 'true');
    await travel.click({ force: true }); await sheet().locator('.payment-wallet-apply').click();
    assert.equal((await state()).wallet, 'personal', 'disabled insufficient Travel cannot become selected');
    await cancel();
  });

  await step('Guesses and failed quote requests never appear as prepared numeric fees', async () => {
    for (const mode of ['guess', 'failure']) {
      quoteMode = mode; await open(invoice); await page.waitForTimeout(450);
      assert.equal(await sheet().locator('.fee-row').count(), 0, `${mode} fee is not displayed as a quote`);
      assert.ok(!(await sheet().innerText()).includes('9876')); await cancel();
    }
    quoteMode = 'real';
  });

  await step('A late SDK quote cannot price a newly selected wallet', async () => {
    holdQuotes = true; await open(invoice); await sheet().locator('.fee-pending').waitFor();
    assert.equal(await sheet().locator('.confirm-cta button.primary-cta').isDisabled(), true, 'Send waits for a quote which is actively being prepared');
    await page.evaluate(() => window.__matrixHome.onSendSheetConfirm({ amountSats: 2400, comment: '' }));
    assert.equal(await page.evaluate(() => window.__matrixSendAttempts || 0), 0, 'executor also rejects a stray confirm while a quote is pending');
    await choose('Travel'); releaseQuotes(); await page.waitForTimeout(400);
    assert.equal((await state()).wallet, 'travel'); assert.equal(await sheet().locator('.fee-row').count(), 0);
    assert.equal(await sheet().locator('.confirm-cta button.primary-cta').isEnabled(), true, 'settled unknown fees keep the existing send behavior');
    await cancel();
  });

  await step('The quoted fee consent survives Vue submission watchers and connection awaits', async () => {
    await open(invoice);
    await page.waitForFunction(() => document.querySelector('.sheet-card .fee-row-value')?.textContent.includes('7'));
    const quotesBeforeSubmit = quotes.length;
    // Only a replacement quote triggered by submission is held. The person
    // already reviewed a real 7-sat quote before confirming this fixture.
    holdQuotes = true;
    await page.evaluate(async () => {
      window.__matrixProbeQuotedSend = true;
      await window.__matrixHome.onSendSheetConfirm({ amountSats: 2400, comment: '' });
    });
    const submitted = await page.evaluate(() => window.__matrixQuoteProbe);
    console.log(`  quote consent ${JSON.stringify(submitted && { walletId: submitted.walletId, maxFee: submitted.maxFee, amountSats: submitted.amountSats, preferSpark: submitted.preferSpark })}`);
    assert.equal(submitted?.walletId, 'personal');
    assert.equal(submitted?.maxFee, 7, 'the provider receives the exact approved quote after reactive watchers flush');
    assert.equal(quotes.length, quotesBeforeSubmit, 'submission itself does not start a replacement SDK quote');
    releaseQuotes();
    await page.locator('.error-dialog').getByRole('button', { name: 'OK', exact: true }).click();
    await page.evaluate(() => { window.__matrixProbeQuotedSend = false; }); await cancel();
  });

  await step('Recipient payout currency and comment survive every child view', async () => {
    await open('payout@matrix.example'); await amount().fill('300');
    await sheet().locator('.note-input').fill('Family');
    const before = await state(); assert.equal(before.payout, 'KES');
    await details('payout@matrix.example'); assert.deepEqual(await state(), before);
    await choose('Reserve');
    assert.deepEqual(await state(), { ...before, wallet: 'reserve' }); await cancel();
  });

  await step('Scanned-dispatch requests share confirmation; unsupported and malformed input cannot submit', async () => {
    await page.locator('[data-audit="fab-send"]').click();
    await page.evaluate(request => window.__matrixHome.$refs.sendModal.onQRDetect(request), invoice);
    await ready(); assert.equal(await amount().inputValue(), '2400'); await cancel();
    await page.locator('[data-audit="fab-send"]').click(); await page.locator('[data-audit="send-input"]').fill('lnbc1invalid');
    await page.waitForTimeout(500); assert.equal(await sheet().count(), 0);
    await page.locator('.send-sheet .sheet-close').click();
    await page.locator('[data-audit="fab-send"]').click();
    await page.evaluate(request => window.__matrixHome.$refs.sendModal.onQRDetect(request), unsupportedOffer);
    await page.locator('.error-dialog').waitFor(); assert.equal(await sheet().count(), 0);
    await page.locator('.error-dialog').getByRole('button', { name: 'OK', exact: true }).click();
    if (await page.locator('.send-sheet:visible').count()) await page.locator('.send-sheet .sheet-close').click();
  });

  await step('320px, 200% text and translated child views retain visible controls in both themes', async () => {
    await page.setViewportSize({ width: 320, height: 844 });
    for (const locale of ['en-US', 'de', 'es']) {
      await page.evaluate(async value => {
        const { applyLocale } = await import('/src/i18n/locales.js');
        applyLocale(document.querySelector('#q-app').__vue_app__._instance.proxy.$i18n, value);
        document.documentElement.style.fontSize = '200%';
        document.documentElement.style.setProperty('--safe-bottom', '34px');
      }, locale);
      await open(invoice); await fits(`${locale}: confirm`); await shot(`08-large-${locale}`);
      await sheet().locator('.recipient-info').click(); await fits(`${locale}: details`); await shot(`09-details-${locale}`);
      await sheet().locator('.top-btn').click(); await sheet().locator('.pay-with-field').click();
      await fits(`${locale}: wallets`); await shot(`10-wallets-${locale}`); await sheet().locator('.top-btn').click(); await cancel();
    }
  });

  await step('Keyboard-sized visual viewport keeps amount entry and pinned controls reachable', async () => {
    await page.evaluate(async () => {
      const { applyLocale } = await import('/src/i18n/locales.js');
      applyLocale(document.querySelector('#q-app').__vue_app__._instance.proxy.$i18n, 'en-US');
      document.documentElement.style.fontSize = '100%';
      document.documentElement.style.setProperty('--safe-bottom', '34px');
    });
    await page.setViewportSize({ width: 390, height: 844 }); await open(amountless); await amount().focus();
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 460 });
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(100);
    const viewport = await page.evaluate(() => {
      const root = document.querySelector('.payment-send-dialog');
      const inner = document.querySelector('.payment-send-dialog .q-dialog__inner--bottom');
      const card = document.querySelector('.sheet-card');
      return { matches: document.querySelectorAll('.payment-send-dialog .q-dialog__inner--bottom').length,
        root: root && { tag: root.tagName, class: root.className, style: root.getAttribute('style'), scope: root.getAttributeNames().filter(name => name.startsWith('data-v-')) },
        inner: inner && { class: inner.className, bottom: inner.getBoundingClientRect().bottom, cssBottom: getComputedStyle(inner).bottom },
        cardBottom: card?.getBoundingClientRect().bottom, safePadding: card && getComputedStyle(card).paddingBottom };
    });
    console.log(`  viewport ${JSON.stringify(viewport)}`);
    assert.equal(viewport.matches, 1, 'unique global portal-inset selector matches runtime DOM');
    assert.ok(viewport.inner.bottom <= 461 && viewport.cardBottom <= 461, 'dialog and card anchor above the keyboard');
    assert.ok(parseFloat(viewport.safePadding) >= 34, 'card retains navigation safe-area padding');
    await amount().fill('1200'); await fits('keyboard visualViewport smaller than layout viewport, 34px safe bottom'); await shot('11-keyboard-visual-viewport');
    await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')); });
    await cancel(); await page.setViewportSize({ width: 390, height: 460 });
    await open(amountless); await amount().focus(); await amount().fill('1200');
    await fits('reduced layout viewport, focused amount, 34px safe bottom'); await shot('12-keyboard-layout-viewport'); await cancel();
  });

  await step('Navigation icons dismiss Settings without saving and keep accessible labels and touch targets', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(async () => {
      document.documentElement.style.fontSize = '100%';
      await document.querySelector('#q-app').__vue_app__.config.globalProperties.$router.push('/settings');
    });
    await page.locator('[data-audit="settings-payment-wallet"]').click();
    const picker = page.locator('.payment-wallet-sheet');
    const dismiss = picker.getByRole('button', { name: 'Cancel', exact: true });
    assert.equal((await dismiss.innerText()).trim(), '', 'header Cancel is an icon with an accessible name');
    const target = await dismiss.boundingBox(); assert.ok(target.width >= 44 && target.height >= 44);
    await picker.locator('input[data-wallet-id="reserve"]').check(); await shot('13-settings-navigation');
    await dismiss.click();
    assert.equal(await page.evaluate(async () => {
      const { usePaymentPreferencesStore } = await import('/src/stores/paymentPreferences.js'); return usePaymentPreferencesStore().preferredWalletId;
    }), null, 'dismiss discards the staged wallet change');
  });

  await step('Navigation icons return within PIN setup and dismiss without saving a PIN', async () => {
    await page.evaluate(async () => {
      await document.querySelector('#q-app').__vue_app__.config.globalProperties.$router.push('/kiosk-mode');
    });
    await page.locator('.id-large-title').waitFor();
    await page.evaluate(() => {
      let component = document.querySelector('.id-large-title').__vueParentComponent;
      while (component && component.type.name !== 'KioskModePage') component = component.parent;
      component.proxy.introOpen = false; component.proxy.pinSheet = 'change';
    });
    const pin = page.locator('.kps-card'); await pin.waitFor();
    const deleteLabel = await page.evaluate(() => document.querySelector('#q-app').__vue_app__._instance.proxy.$t('Delete'));
    const deleteDigit = pin.getByRole('button', { name: deleteLabel, exact: true });
    assert.equal(await deleteDigit.locator('svg').count(), 1, 'Delete uses a bundled SVG without an icon-font dependency');
    assert.equal((await deleteDigit.innerText()).trim(), '', 'Delete never displays a font icon name');
    for (const digit of ['1', '2']) await pin.getByRole('button', { name: digit, exact: true }).click();
    assert.equal(await pin.locator('.pin-dot-filled').count(), 2);
    await deleteDigit.click();
    assert.equal(await pin.locator('.pin-dot-filled').count(), 1, 'Delete removes only the last digit');
    for (const digit of ['2', '3', '4']) await pin.getByRole('button', { name: digit, exact: true }).click();
    const back = pin.getByRole('button', { name: 'Back', exact: true }); await back.waitFor();
    assert.equal((await back.innerText()).trim(), '');
    const target = await back.boundingBox(); assert.ok(target.width >= 44 && target.height >= 44);
    await shot('14-pin-navigation'); await back.click();
    assert.equal(await pin.locator('.pin-dot-filled').count(), 0, 'return resets the uncommitted first PIN entry');
    await pin.getByRole('button', { name: 'Cancel', exact: true }).click(); await pin.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(async () => {
      const { useWalletStore } = await import('/src/stores/wallet.js'); return useWalletStore().kioskEnabled;
    }), false, 'dismiss never enables the register');
  });
  if (!caseFilter) assert.ok(quotes.length > 0, 'SDK quote provider was exercised');
  assert.equal(await page.evaluate(() => window.__matrixSendAttempts || 0), 0, 'matrix never submits a payment');
  assert.deepEqual(errors, []);
  console.log('PASS: shared payment sheet request matrix');
} catch (error) {
  console.error(`FAIL at ${stepName}`); console.error(error); if (errors.length) console.error(errors.join('\n'));
  console.error(await page?.evaluate(async () => {
    const { useWalletStore } = await import('/src/stores/wallet.js'); const store = useWalletStore();
    return { active: store.activeWalletId, type: store.activeWalletType, wallets: store.wallets.map(({ id, type }) => ({ id, type })), pending: window.__matrixHome?.pendingPayment?.type,
      dialogs: [...document.querySelectorAll('.payment-send-dialog, .q-dialog__inner--bottom, .sheet-card')].map(node => ({ html: node.outerHTML.slice(0, 450), top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, cssBottom: getComputedStyle(node).bottom })) };
  }).catch(() => null));
  await page?.screenshot({ path: `${output}/FAIL.png` }).catch(() => {}); process.exitCode = 1;
} finally { releaseQuotes(); await browser.close(); }
