/**
 * Start `npm run dev -- --port 9007`, then run this script.
 * Real receipt, router, Address Book and metadata stores; synthetic receipts
 * and an isolated browser profile. No real identity, wallet or payment.
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.CONTACT_BASE_URL || 'http://localhost:9007';
const output = process.env.CONTACT_OUTPUT || '/private/tmp/buhogo-334-contact';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue();
    if (url.hostname === 'mempool.space') return route.fulfill({ json: { USD: 85000, EUR: 78000 } });
    return route.abort();
  });
  await page.routeWebSocket('**', socket => socket.close());
  await page.addInitScript(() => {
    window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null }));
  });
  await page.goto(base + '/#/settings');
  await page.waitForFunction(() => window.__audit?.app);
  await page.evaluate(async () => {
    const app = window.__audit.app;
    const store = app.config.globalProperties.$pinia._s.get('wallet');
    store.isInitialized = true;
    store.wallets = [{ id: 'original', type: 'nwc', name: 'Personal' }, { id: 'other', type: 'nwc', name: 'Business' }];
    store.activeWalletId = 'original';
    localStorage.setItem('buhoGO_cached_transactions', JSON.stringify([
      { id: 'outgoing', walletId: 'original', type: 'outgoing', amount: -23, recipientSats: 20, fee: 3, timestamp: 1791300000, status: 'completed' },
      { id: 'incoming', walletId: 'original', type: 'incoming', amount: 111, fee: 0, timestamp: 1791300000, status: 'completed', lnaddress: 'my-own-address@example.com' },
    ]));
    const { useTransactionMetadataStore } = await import('/src/stores/transactionMetadata.js');
    const metadata = useTransactionMetadataStore();
    await metadata.initialize();
    await metadata.setRecipientAddressForTransaction('outgoing', 'original', 'lee@example.com');
    window.contactMetadata = metadata;
    await app.config.globalProperties.$router.push('/transaction/outgoing?wallet=original');
  });
  const picker = page.locator('.contact-picker-dialog');
  const form = page.locator('.address-modal');
  async function openPicker() {
    await page.locator('.receipt-more').click();
    await page.locator('.receipt-menu .q-item').nth(1).click();
    await picker.waitFor();
    await picker.evaluate(async node => {
      const dialog = node.closest('.q-dialog__inner');
      await Promise.allSettled(dialog.getAnimations({ subtree: true }).map(animation => animation.finished));
    });
  }
  await openPicker();
  await picker.getByText('No contacts found', { exact: true }).waitFor();

  // HIG-inspired hierarchy and touch targets, including compact screens,
  // German/Spanish labels, dark mode, and enlarged text.
  for (const [width, height, locale, dark, scale] of [
    [390, 844, 'en-US', false, 1], [390, 844, 'de', true, 1],
    [320, 568, 'de', false, 1], [390, 844, 'de', true, 2],
    [1024, 768, 'es', false, 1],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async ({ locale, dark, scale }) => {
      const { i18n } = await import('/src/boot/i18n.js');
      i18n.global.locale = locale;
      window.__audit.setDark(dark);
      document.documentElement.style.fontSize = `${16 * scale}px`;
    }, { locale, dark, scale });
    await page.waitForTimeout(250);
    const layout = await picker.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, left: rect.left, bottom: rect.bottom,
        targets: [...node.querySelectorAll('button')].map(button => {
          const rect = button.getBoundingClientRect();
          return { width: rect.width, height: rect.height, bottom: rect.bottom };
        }) };
    });
    assert.ok(layout.width <= width && layout.left >= 0 && layout.bottom <= height);
    assert.ok(layout.targets.every(target => target.width >= 44 && target.height >= 44 && target.bottom <= height));
    await page.screenshot({ path: `${output}/picker-${width}-${locale}-${dark}-${scale}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const { i18n } = await import('/src/boot/i18n.js');
    i18n.global.locale = 'en-US';
    window.__audit.setDark(false);
    document.documentElement.style.fontSize = '16px';
  });
  await picker.getByRole('button', { name: 'Create contact', exact: true }).focus();
  await page.keyboard.press('Enter');
  await form.waitFor();
  assert.equal(await picker.count(), 0, 'the picker must close before the Address Book form opens');
  assert.equal(await form.locator('input').nth(1).inputValue(), 'lee@example.com');
  assert.ok(page.url().includes('/address-book?'));
  await form.locator('input').first().fill('Lee');
  // The active wallet can change while the user is creating a contact.
  await page.evaluate(() => { window.__audit.app.config.globalProperties.$pinia._s.get('wallet').activeWalletId = 'other'; });
  await form.locator('.save-btn').click();
  await form.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.contactMetadata.getContactForTransaction('outgoing', 'original')?.name === 'Lee');
  assert.equal(await page.evaluate(() => window.contactMetadata.getContactForTransaction('outgoing', 'other')), null);
  assert.equal(await page.evaluate(() => window.__audit.app.config.globalProperties.$router.currentRoute.value.query.action), undefined);
  await page.locator('.address-book-page .back-btn').click();
  await page.locator('.transaction-details-page').waitFor();
  assert.ok(page.url().endsWith('/transaction/outgoing?wallet=original'));

  // A search with no matches still offers creation. Cancel must consume
  // the draft, and a later ordinary add must not reuse its address.
  await openPicker();
  await picker.locator('input').fill('Nobody matches this');
  await picker.getByText('No contacts found', { exact: true }).waitFor();
  await picker.getByRole('button', { name: 'Create contact', exact: true }).click();
  await form.waitFor();
  await form.locator('.cancel-btn').click();
  await form.waitFor({ state: 'hidden' });
  await page.locator('.add-contact-btn').click();
  await form.waitFor();
  assert.equal(await form.locator('input').nth(1).inputValue(), '');
  await form.locator('.cancel-btn').click();
  await form.waitFor({ state: 'hidden' });

  await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/transaction/incoming?wallet=original'));
  await openPicker();
  await picker.getByRole('button', { name: 'Create contact', exact: true }).click();
  await form.waitFor();
  assert.equal(await form.locator('input').nth(1).inputValue(), '', 'our receiving address must not become a sender contact');
  await form.locator('input').first().fill('Sender');
  await form.locator('input').nth(1).fill('sender@example.com');
  await form.locator('.save-btn').click();
  await form.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.contactMetadata.getContactForTransaction('incoming', 'original')?.name === 'Sender');
  assert.deepEqual(errors, []);
  console.log('PASS: empty/search picker → existing Address Book form → durable contact and original-wallet assignment; cancel, incoming address safety, keyboard, 320px, enlarged text and light/dark locales.');
} finally { await browser.close(); }
