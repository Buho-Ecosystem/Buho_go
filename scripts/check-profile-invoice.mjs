// Run against a local Quasar preview (PROFILE_INVOICE_BASE_URL overrides :9015).
// Signed synthetic profile + mocked LNURL service; no wallet provider or payment
// is contacted. OS app selection still requires a physical-device smoke test.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit, expect } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-core';
import { profileInvoiceFixture } from './fixtures/profileInvoice.mjs';

const base = process.env.PROFILE_INVOICE_BASE_URL || 'http://localhost:9015';
const output = 'output/profile-invoice';
await mkdir(output, { recursive: true });
const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const npub = nip19.npubEncode(pubkey);
const event = finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [],
  content: JSON.stringify({ name: 'Maria Test', lud16: 'maria@pay.invalid' }),
}, secret);
const androidUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const iphoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const browsers = {
  chromium: await chromium.launch({ channel: process.env.PW_CHANNEL || 'chromium', headless: true }),
  webkit: await webkit.launch({ headless: true }),
};

async function openPage({ platform = 'android', locale = 'en-US', width = 390, height = 844, wallet = false } = {}) {
  const context = await browsers[platform === 'iphone' ? 'webkit' : 'chromium'].newContext({
    viewport: { width, height }, isMobile: platform !== 'desktop', hasTouch: platform !== 'desktop',
    ...(platform !== 'desktop' ? { userAgent: platform === 'android' ? androidUA : iphoneUA } : {}),
    locale, serviceWorkers: 'block', reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = { callbacks: [], failure: false, wrongAmount: false, delay: null, comments: 100, min: 1000 };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue();
    if (url.hostname === 'pay.invalid') {
      let json;
      if (url.pathname.includes('/.well-known/')) {
        json = { tag: 'payRequest', minSendable: state.min, maxSendable: 100000000,
          callback: 'https://pay.invalid/invoice', commentAllowed: state.comments };
      } else {
        const invoice = profileInvoiceFixture(state.wrongAmount ? 1 : Number(url.searchParams.get('amount')) / 1000);
        state.callbacks.push({ amount: url.searchParams.get('amount'), comment: url.searchParams.get('comment'), invoice });
        json = state.failure ? { status: 'ERROR' } : { pr: invoice };
        if (state.delay) await state.delay;
      }
      return route.fulfill({ json }).catch(() => {}); // an edit may abort the request
    }
    return route.abort();
  });
  await page.routeWebSocket('**', socket => {
    if (new URL(socket.url()).host === new URL(base).host) { socket.connectToServer(); return; }
    socket.onMessage(message => {
      let parsed;
      try { parsed = JSON.parse(String(message)); } catch { return; }
      if (parsed[0] !== 'REQ') return;
      const [, id, ...filters] = parsed;
      if (filters.some(f => f.kinds?.includes(0) && (!f.authors || f.authors.includes(pubkey)))) {
        socket.send(JSON.stringify(['EVENT', id, event]));
      }
      socket.send(JSON.stringify(['EOSE', id]));
    });
  });
  await page.addInitScript(({ locale }) => {
    window.__AUDIT__ = { noExitMonitor: true };
    localStorage.setItem('buhoGO_language', locale);
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null }));
    localStorage.setItem('buhoGO_fiat_rates', JSON.stringify({ rates: { USD: 100000, EUR: 90000 }, lastUpdate: new Date().toISOString() }));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => { window.__copiedInvoice = text; },
    } });
    // Record explicit taps without leaving the test for a real wallet.
    document.addEventListener('click', e => {
      const link = e.target.closest('a[data-pay]');
      if (link) { e.preventDefault(); window.__walletLink = link.href; }
    });
  }, { locale });
  await page.goto(`${base}/p/${npub}`);
  await expect(page.locator('.pp-top-name')).toHaveText('Maria Test');
  await expect(page.locator('.payment-amount')).toBeVisible();
  if (wallet) {
    await page.evaluate(() => {
      const app = document.querySelector('#q-app').__vue_app__;
      const store = app.config.globalProperties.$pinia._s.get('wallet');
      // An in-memory wallet stub: no credentials, SDK or provider calls.
      store.wallets = [{ id: 'browser-test', name: 'Browser test', type: 'test' }];
      store.activeWalletId = 'browser-test';
      app.config.globalProperties.$router.push = async path => { window.__walletRoute = path; };
    });
  }
  return { page, context, state, errors };
}

async function createInvoice(page, amount = '1000') {
  await page.locator('.payment-amount').fill(amount);
  await page.locator('.payment-form .payment-primary').click();
  await expect(page.locator('.payment-qr canvas')).toBeVisible();
}

const results = [];
async function check(name, options, run) {
  const h = await openPage(options);
  try {
    await run(h);
    assert.deepEqual(h.errors, [], 'no uncaught page errors');
    results.push(`PASS ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${error.stack}`);
    await h.page.screenshot({ path: `${output}/failure-${results.length}.png`, fullPage: true });
  } finally { await h.context.close(); }
}

try {
  for (const platform of ['android', 'iphone', 'desktop']) {
    await check(`${platform}: invoice first, exact QR/copy/links, explicit wallet choice`, { platform, wallet: true, width: platform === 'desktop' ? 1280 : 390 }, async ({ page, state }) => {
      await page.screenshot({ path: `${output}/${platform}-amount.png`, fullPage: true });
      await page.locator('#profile-payment-note').fill('Thank you Maria!');
      await createInvoice(page);
      assert.equal(state.callbacks.length, 1);
      const { invoice, amount, comment } = state.callbacks[0];
      assert.equal(amount, '1000000');
      assert.equal(comment, 'Thank you Maria!');
      assert.equal(await page.evaluate(() => window.__walletRoute), undefined, 'no automatic browser-wallet redirect');
      assert.equal(await page.evaluate(() => window.__walletLink), undefined, 'no automatic app launch');
      await expect(page.locator('.payment-total')).toContainText('1,000');
      await expect(page.locator('.payment-total')).toBeFocused();
      assert.equal(await page.locator('[data-pay="wallet"]').getAttribute('href'), `lightning:${invoice}`);
      if (platform === 'android') {
        assert.match(await page.locator('[data-pay="app"]').getAttribute('href'), new RegExp(`^intent:${invoice}#Intent;scheme=lightning;package=mybuho.buhogo;`));
      } else assert.equal(await page.locator('[data-pay="app"]').count(), 0);
      // Decode the actual rendered QR, not just the component's input property.
      const qr = await page.evaluate(async () => {
        const { default: QrScanner } = await import('/node_modules/qr-scanner/qr-scanner.min.js');
        return (await QrScanner.scanImage(document.querySelector('.payment-qr canvas'), { returnDetailedScanResult: true })).data;
      });
      assert.equal(qr.toLowerCase(), `lightning:${invoice}`);
      const spacing = await page.locator('.payment-qr').evaluate(el => {
        const plate = el.getBoundingClientRect();
        const code = el.querySelector('canvas').getBoundingClientRect();
        return { left: code.left - plate.left, right: plate.right - code.right };
      });
      assert.ok(spacing.left >= 16 && spacing.right >= 16, 'QR retains its quiet zone');
      await page.locator('.payment-copy').click();
      assert.equal(await page.evaluate(() => window.__copiedInvoice), invoice);
      await page.screenshot({ path: `${output}/${platform}-invoice.png`, fullPage: true });
      await page.locator('[data-pay="wallet"]').click();
      assert.equal(await page.evaluate(() => window.__walletLink), `lightning:${invoice}`);
      await expect(page.locator('.payment-qr')).toBeVisible(); // opening is not payment success
      await page.locator('.payment-browser').click();
      assert.equal(await page.evaluate(() => window.__walletRoute), '/wallet');
      assert.deepEqual(await page.evaluate(() => document.querySelector('#q-app').__vue_app__.config.globalProperties.$pinia._s.get('wallet').pendingDeepLink), { type: 'lightning_invoice', data: invoice });
    });
  }

  await check('errors stay on the form; retries never fall back to an address', {}, async ({ page, state }) => {
    await page.locator('.payment-primary').click();
    await expect(page.locator('.payment-error')).toContainText('whole sats');
    await expect(page.locator('.payment-amount')).toBeFocused();
    assert.equal(state.callbacks.length, 0);
    state.min = 2000000;
    await page.locator('.payment-amount').fill('1000');
    await page.locator('.payment-primary').click();
    await expect(page.locator('.payment-error')).toContainText('Minimum is 2,000 sats');
    assert.equal(state.callbacks.length, 0);
    state.min = 1000;
    state.failure = true;
    await page.locator('.payment-primary').click();
    await expect(page.locator('.payment-error')).toContainText("Couldn't create an invoice");
    state.failure = false;
    state.wrongAmount = true;
    await page.locator('.payment-primary').click();
    await expect(page.locator('.payment-error')).toContainText('did not match');
    assert.equal(await page.locator('[data-pay]').count(), 0);
    state.wrongAmount = false;
    await createInvoice(page);
    assert.equal(await page.locator('.payment-browser').count(), 0, 'no browser wallet offered without setup');
  });

  for (const [width, height] of [[320, 568], [568, 320], [390, 430]]) {
    await check(`${width}×${height}: controls remain reachable and labeled`, { width, height, locale: 'de' }, async ({ page }) => {
      await expect(page.getByRole('textbox', { name: 'Betrag in Sats', exact: true })).toBeVisible();
      await page.getByRole('textbox', { name: 'Notiz (optional)', exact: true }).fill('Danke!');
      await createInvoice(page);
      await expect(page.getByRole('img', { name: 'QR-Code der Lightning-Rechnung', exact: true })).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      for (const selector of ['.payment-edit', '.payment-copy', '[data-pay="wallet"]', '[data-pay="app"]']) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        const rect = await control.boundingBox();
        assert.ok(rect.height >= 44 && rect.width >= 44, `${selector} has a comfortable tap target`);
      }
      await page.locator('[data-pay="wallet"]').click();
      await expect(page.locator('.payment-qr')).toBeVisible();
      await page.screenshot({ path: `${output}/de-invoice-${width}x${height}.png`, fullPage: true });
    });
  }

  await check('browser-wallet navigation failure keeps the invoice and clears queued payment', { wallet: true }, async ({ page }) => {
    await createInvoice(page);
    await page.evaluate(() => {
      document.querySelector('#q-app').__vue_app__.config.globalProperties.$router.push = async () => { throw new Error('blocked'); };
    });
    await page.locator('.payment-browser').click();
    await expect(page.locator('.payment-wallet-actions .payment-error')).toContainText("Couldn't open the wallet");
    assert.equal(await page.evaluate(() => document.querySelector('#q-app').__vue_app__.config.globalProperties.$pinia._s.get('wallet').pendingDeepLink), null);
    await expect(page.locator('.payment-qr')).toBeVisible();
  });

  await check('editing a pending request cannot display its stale invoice', {}, async ({ page, state }) => {
    let release;
    state.delay = new Promise(resolve => { release = resolve; });
    await page.locator('.payment-amount').fill('1000');
    await page.locator('.payment-primary').click();
    await expect.poll(() => state.callbacks.length).toBe(1);
    await expect(page.locator('.payment-primary')).toBeDisabled();
    await page.locator('.payment-amount').fill('2000');
    await expect(page.locator('.payment-primary')).toBeEnabled();
    state.delay = null;
    await createInvoice(page, '2000');
    release();
    await expect(page.locator('.payment-total')).toContainText('2,000');
    assert.equal(await page.locator('[data-pay="wallet"]').getAttribute('href'), `lightning:${state.callbacks[1].invoice}`);
  });

  await check('invoice expiry blocks handoff and supports regeneration', {}, async ({ page, state }) => {
    await page.clock.install();
    await createInvoice(page);
    await page.clock.fastForward(901000);
    await expect(page.locator('.payment-expired')).toContainText('expired');
    assert.equal(await page.locator('[data-pay]').count(), 0);
    assert.equal(await page.locator('.payment-copy').count(), 0);
    // The mocked service clock must follow the browser's simulated clock.
    await page.clock.setSystemTime(Date.now());
    await page.locator('.payment-primary').click();
    await expect(page.locator('.payment-qr')).toBeVisible();
    assert.equal(state.callbacks.length, 2);
  });

  for (const locale of ['de', 'es']) {
    await check(`${locale}: narrow layout, fiat amount, unsupported note`, { locale, width: 320 }, async ({ page, state }) => {
      state.comments = 0;
      await page.locator('.payment-currency').click();
      await page.locator('.payment-amount').fill('0,90');
      await page.locator('#profile-payment-note').fill('Danke / gracias');
      await page.screenshot({ path: `${output}/${locale}-amount-320.png`, fullPage: true });
      await page.locator('.payment-primary').click();
      await expect(page.locator('.payment-qr')).toBeVisible();
      assert.equal(state.callbacks[0].amount, '1000000');
      assert.equal(state.callbacks[0].comment, null);
      await expect(page.locator('.payment-invoice .payment-hint')).toHaveText(locale === 'de' ? 'Dieser Empfänger unterstützt keine Notizen.' : 'Este destinatario no admite notas.');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      await page.screenshot({ path: `${output}/${locale}-invoice-320.png`, fullPage: true });
      await page.locator('.payment-edit').click();
      await expect(page.locator('.payment-amount')).toBeFocused();
      await expect(page.locator('.payment-amount')).toHaveValue('0,90');
      assert.equal(await page.locator('[data-pay]').count(), 0);
    });
  }
} finally {
  await Promise.all(Object.values(browsers).map(browser => browser.close()));
  console.log(results.join('\n'));
  if (results.some(result => result.startsWith('FAIL'))) process.exitCode = 1;
}
