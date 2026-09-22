/** Controlled UI regression check for LUD-11 service payees and Pay again. Start `pnpm dev --port 9003` first.
 * External requests are blocked; no wallet keys, invoices, or payments are used. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { bech32 } from 'bech32';

const base = process.env.LUD11_BASE_URL || 'http://localhost:9003';
const output = process.env.LUD11_OUTPUT || '/private/tmp/lud11-review';
await mkdir(output, { recursive: true });

const serviceUrl = 'https://coffee.example/lnurlp/Corner';
const canonical = bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(serviceUrl)), 16384);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const LOGO = `data:image/png;base64,${PNG}`;
const payRequest = {
  tag: 'payRequest', callback: 'https://coffee.example/cb', minSendable: 1000, maxSendable: 100000000,
  metadata: JSON.stringify([['text/plain', 'Corner Coffee'], ['image/png;base64', PNG]]), disposable: false,
};
const now = Date.now();
const entry = {
  id: 'addr-svc-1', name: 'Corner Coffee', address: canonical, addressType: 'lnurl', lightningAddress: '',
  color: '#059573', notes: '', isFavorite: false, lastUsedAt: null, createdAt: now - 5000, updatedAt: now - 5000,
  service: { name: 'Corner Coffee', identifier: null, domain: 'coffee.example', reusable: true, seenAt: now - 5000 },
};
const tx = { settled_at: Math.floor((now - 60000) / 1000), id: 'tx-svc-1', type: 'outgoing', amount: 4500, fee: 2, status: 'completed', timestamp: now - 60000, date: new Date(now - 60000).toISOString(), description: 'Corner Coffee', paymentHash: 'tx-svc-1' };
const metadata = { 'w-spark::tx-svc-1': { contactId: null, customNote: '', tags: [], updatedAt: now - 60000, recipientAddress: canonical, payLink: canonical, label: 'Corner Coffee', counterpartyAvatar: { kind: 'service', address: canonical } } };
const walletStore = { wallets: [{ id: 'w-spark', type: 'spark', name: 'Personal wallet', connectionData: { encryptedMnemonic: 'audit-fixture-not-a-seed' } }], activeWalletId: 'w-spark', biometricsEnabled: false };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.setDefaultNavigationTimeout(120000);
page.setDefaultTimeout(60000);
const errors = [];
const requests = [];
// The dev server's HMR client throws on its closed socket; that noise is not the app.
page.on('pageerror', error => { if (!/reading 'send'/.test(error.message)) errors.push(error.message); });
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'coffee.example') {
    requests.push(url.href);
    if (url.pathname === '/cb') return route.fulfill({ status: 500, body: 'unexpected invoice request' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payRequest) });
  }
  if (url.origin === base) return route.continue();
  if (url.hostname === 'api.iconify.design' || url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('gstatic.com')) return route.continue();
  return route.abort();
});
await page.routeWebSocket('**', socket => {
  if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer();
  else socket.close();
});
await page.addInitScript(({ entry, tx, metadata, walletStore }) => {
  window.__AUDIT__ = { theme: 'light' };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify(walletStore));
  localStorage.setItem('buhoGO_address_book', JSON.stringify([entry]));
  localStorage.setItem('buhoGO_cached_transactions', JSON.stringify([tx]));
  localStorage.setItem('buhoGO_transaction_metadata', JSON.stringify(metadata));
  localStorage.setItem('buhoGO_wallet_state', JSON.stringify({ balance: 100000, activeWalletId: 'w-spark', connectedWallets: [] }));
}, { entry, tx, metadata, walletStore });

const heights = selector => page.locator(selector).evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)));
async function ready() {
  await page.waitForFunction(() => !!window.__audit?.app && !!window.__audit.app._instance, null, { timeout: 120000 });
  await page.waitForTimeout(400);
}
let reviewNumber = 0;
async function expectSendReview(fromRequests) {
  await page.locator('.sheet-card:not(.sheet-card--redeem)').waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  assert.equal(requests.length - fromRequests, 1, 'exactly one GET of the payRequest');
  assert.equal(requests.filter(r => r.endsWith('/cb')).length, 0, 'no invoice is ever requested');
  assert.equal((await page.locator('.recipient-name').textContent()).trim(), 'Corner Coffee');
  assert.equal((await page.locator('.recipient-addr').textContent()).trim(), 'coffee.example');
  assert.equal(await page.locator('.recipient-avatar--silhouette').count(), 1);
  await page.screenshot({ path: `${output}/payment-review-${++reviewNumber}.png` });
  await page.locator('.recipient-info').click();
  assert.equal((await page.locator('.recipient-details-value').textContent()).trim(), canonical);
  await page.locator('.sheet-card .top-btn').first().click();
  await page.locator('.sheet-card').waitFor({ state: 'detached' });
}

try {
  // 1. Payees list: a service row says where it points and what it is, with the storefront glyph.
  await page.goto(`${base}/#/address-book`);
  await ready();
  const row = page.locator('.payee-row', { hasText: 'Corner Coffee' });
  await row.waitFor();
  assert.equal((await row.locator('.payee-addr').textContent()).trim(), 'coffee.example · payment link');
  assert.equal(await row.locator('.contact-avatar__glyph--service').count(), 1);
  assert.ok((await heights('.payee-row'))[0] >= 44);
  await page.screenshot({ path: `${output}/payees-light.png` });
  console.log('✓ payee row: domain line, storefront glyph, no bech32 blob');

  // 2. Profile: domain shown, full link revealed and copied on tap, Pay through the dispatcher.
  await page.goto(`${base}/#/address-book/addr-svc-1`);
  await ready();
  await page.getByText('Corner Coffee', { exact: true }).first().waitFor();
  assert.equal((await page.locator('.profile-addr code').textContent()).trim(), 'coffee.example · payment link');
  assert.equal(await page.locator('.contact-avatar__glyph--service').count(), 1);
  await page.screenshot({ path: `${output}/profile-light.png` });
  await page.locator('.profile-addr').click();
  await page.waitForTimeout(3200); // Let clipboard feedback clear before capturing the next screen.
  await page.waitForTimeout(200);
  assert.equal((await page.locator('.profile-addr code').textContent()).trim(), canonical);
  const payButton = page.getByRole('button', { name: 'Pay Corner Coffee', exact: true });
  assert.equal(await payButton.count(), 1);
  const beforePay = requests.length;
  await payButton.click();
  await page.waitForFunction(() => location.hash.startsWith('#/wallet'));
  await expectSendReview(beforePay);
  console.log('✓ profile: domain line, reveal on tap, Pay opens the send review with one fetch and no invoice');

  // 3. A registered LUD-06 logo replaces the glyph everywhere the entry is drawn.
  await page.goto(`${base}/#/address-book/addr-svc-1`);
  await ready();
  await page.locator('.contact-avatar__glyph--service').first().waitFor();
  await page.evaluate(({ canonical, LOGO }) => {
    window.__audit.app.config.globalProperties.$pinia._s.get('serviceImages').put(canonical, LOGO);
  }, { canonical, LOGO });
  await page.locator('img.contact-avatar__img').first().waitFor();
  assert.equal(await page.locator('.contact-avatar__glyph--service').count(), 0);
  await page.evaluate(({ canonical }) => {
    window.__audit.app.config.globalProperties.$pinia._s.get('serviceImages').remove(canonical);
  }, { canonical });
  await page.locator('.contact-avatar__glyph--service').first().waitFor();
  console.log('✓ a registered logo replaces the glyph, and its removal restores it');

  // 4. Transaction Details: one Pay again row, routed through the dispatcher.
  await page.goto(`${base}/#/transaction/tx-svc-1`);
  await ready();
  await page.locator('.pay-again-row').waitFor({ timeout: 15000 });
  await page.getByText('Pay again', { exact: true }).waitFor();
  assert.equal(await page.locator('.tag-selector, .tags-content, .note-content textarea').count(), 0);
  assert.ok((await heights('.pay-again-row'))[0] >= 44);
  await page.screenshot({ path: `${output}/tx-details-light.png` });
  await page.locator('.receipt-more').click();
  await page.getByText('Edit note', { exact: true }).click();
  await page.locator('.receipt-note-dialog textarea').fill('Morning coffee');
  await page.locator('.receipt-note-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.locator('.receipt-note').count(), 0);
  await page.locator('.receipt-more').click();
  await page.getByText('Edit note', { exact: true }).click();
  await page.locator('.receipt-note-dialog textarea').fill('Morning coffee');
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${output}/receipt-edit-note.png` });
  await page.locator('.receipt-note-dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.receipt-note').getByText('Morning coffee', { exact: true }).waitFor();
  await page.locator('.receipt-note-dialog').waitFor({ state: 'detached' });
  await page.locator('.receipt-more').click();
  await page.getByText('Change contact', { exact: true }).click();
  await page.locator('.contact-picker-dialog').getByText('Corner Coffee', { exact: true }).click();
  await page.locator('.contact-picker-dialog').waitFor({ state: 'detached' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${output}/receipt-saved-note.png`, fullPage: true });
  const beforeAgain = requests.length;
  await page.locator('.pay-again-row').click();
  await page.waitForFunction(() => location.hash.startsWith('#/wallet'));
  await expectSendReview(beforeAgain);
  console.log('✓ Pay again row opens the send review with one fetch and no invoice');

  // 5. Locales, themes, text scale on the list and the profile.
  for (const [locale, subtitle, theme, width, height, scale] of [
    ['en-US', 'coffee.example · payment link', 'dark', 390, 844, 1],
    ['en-US', 'coffee.example · payment link', 'light', 320, 568, 2],
    ['es', 'coffee.example · enlace de pago', 'dark', 320, 568, 2],
    ['de', 'coffee.example · Zahlungslink', 'light', 320, 568, 2],
    ['es', 'coffee.example · enlace de pago', 'dark', 768, 1024, 1],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}/#/address-book`);
    await ready();
    await page.evaluate(({ locale, theme, scale }) => {
      window.__audit.app._instance.proxy.$i18n.locale = locale;
      window.__audit.setDark(theme === 'dark');
      document.documentElement.style.fontSize = `${16 * scale}px`;
    }, { locale, theme, scale });
    await page.locator('.payee-row', { hasText: 'Corner Coffee' }).waitFor();
    await page.getByText(subtitle, { exact: true }).waitFor();
    const bounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(bounds.scrollWidth <= bounds.width + 1, JSON.stringify(bounds));
    assert.ok((await heights('.payee-row')).every(h => h >= 44));
    assert.ok((await heights('.payee-pay')).every(h => h >= 44));
    assert.equal(await page.locator('.payee-name').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize)), 15 * scale);
    const nameLines = await page.locator('.payee-name').first().evaluate(el => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
    assert.ok(nameLines <= 2.1, 'the pay action must leave room for a readable name');
    const quickAvatar = page.locator('.quickpay-avatar').first();
    if (await quickAvatar.count()) {
      const centered = await quickAvatar.evaluate(el => {
        const glyph = el.querySelector('svg');
        if (!glyph) return true;
        const a = el.getBoundingClientRect(), g = glyph.getBoundingClientRect();
        return Math.abs(a.x + a.width / 2 - g.x - g.width / 2) < 1 && Math.abs(a.y + a.height / 2 - g.y - g.height / 2) < 1;
      });
      assert.ok(centered, 'Quick Pay fallback icon must remain centered');
    }
    await page.screenshot({ path: `${output}/payees-${locale}-${theme}-${scale}x.png` });
    await page.goto(`${base}/#/address-book/addr-svc-1`);
    await ready();
    await page.getByText(subtitle, { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/profile-${locale}-${theme}-${scale}x.png` });
    await page.goto(`${base}/#/transaction/tx-svc-1`);
    await ready();
    await page.locator('.pay-again-row').waitFor();
    await page.screenshot({ path: `${output}/receipt-${locale}-${theme}-${scale}x.png`, fullPage: true });
    await page.locator('.receipt-more').click();
    await page.locator('.receipt-menu').waitFor();
    const menuFits = await page.locator('.receipt-menu').evaluate(el => el.scrollWidth <= el.clientWidth + 1);
    assert.ok(menuFits, 'large-text receipt menu must wrap instead of clipping');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${output}/receipt-menu-${locale}-${theme}-${scale}x.png` });
    await page.locator('.receipt-menu .q-item').first().click();
    await page.locator('.receipt-note-dialog').waitFor();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.receipt-note-dialog textarea').evaluate(el => parseFloat(getComputedStyle(el).fontSize)), 16 * scale);
    await page.screenshot({ path: `${output}/receipt-note-${locale}-${theme}-${scale}x.png` });
    await page.locator('.receipt-note-dialog .q-btn').first().click();
    await page.locator('.receipt-note-dialog').waitFor({ state: 'detached' });
    console.log(`✓ ${locale}, ${theme}, ${width}px, ${scale}x text`);
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
