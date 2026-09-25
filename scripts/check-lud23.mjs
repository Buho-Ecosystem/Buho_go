/** Controlled browser checks. Start `pnpm dev --port 9002` first.
 * Uses public test identity metadata only; all external traffic is blocked. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const base = process.env.LUD23_BASE_URL || 'http://127.0.0.1:9002';
const output = process.env.LUD23_OUTPUT || '/private/tmp/lud23-review';
await mkdir(output, { recursive: true });
const pubkey = 'e8bcf3823669444d0b49ad45d65088635d9fd8500a75b5f20b59abefa56a144f';
const npub = 'npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const callbacks = [];
let responseStatus = 'OK';
let paymentMetadataRequests = 0;
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'payment.example') {
    paymentMetadataRequests++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      tag: 'addressRequest', k1: 'a'.repeat(64), callback: 'https://rewards.example/share', description: 'Unexpected sharing request',
    }) });
  }
  if (url.hostname === 'rewards.example') {
    callbacks.push(url.href);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: responseStatus }) });
  }
  if (url.origin === base) return route.continue();
  return route.abort();
});
await page.routeWebSocket('**', socket => socket.close());
await page.addInitScript(({ pubkey, npub }) => {
  window.__AUDIT__ = { theme: 'light' };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buhoGO_identity_seed_v1', 'public-test-fixture-not-a-seed');
  localStorage.setItem('buhoGO_identity_v1', JSON.stringify({ version: 1, nostrPubkeyHex: pubkey, nostrNpub: npub, nostrAccountIndex: 0, connectedSites: [] }));
  localStorage.setItem(`buhoGO_profile_v1_${pubkey}`, JSON.stringify({ version: 1, lud16: 'alice@example.com', displayName: 'Alice' }));
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
}, { pubkey, npub });
let challenge = 0;
const request = (description = 'Receive your game rewards.') => `lightning:addressRequest?${new URLSearchParams({
  k1: (++challenge).toString(16).padStart(64, '0'), callback: 'https://rewards.example/share?session=KeepCase', description,
})}`;
async function open(value = request()) {
  await page.evaluate(async value => {
    const { offerAddressRequest } = await import('/src/services/addressRequestIntake.js');
    offerAddressRequest(value);
  }, value);
  await page.getByRole('button', { name: 'Share address', exact: true }).waitFor({timeout:10000}).catch(async error => { console.log('failure', errors, await page.evaluate(() => ({dialogs:[...document.querySelectorAll('.q-dialog')].map(e=>e.outerHTML.slice(0,300)), state:window.__audit.app.config.globalProperties.$pinia._s.get('addressRequest').state, body:document.body.innerText.slice(-1000)}))); throw error; });
}
async function close() {
  await page.locator('.address-request-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.address-request-dialog').waitFor({ state: 'detached' });
}
try {
  await page.goto(`${base}/#/about`);
  await page.waitForFunction(() => !!window.__audit?.app);
  await open();
  assert.equal(callbacks.length, 0);
  await page.getByText('alice@example.com', { exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${output}/consent-light.png` });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.address-request-dialog').waitFor({ state: 'detached' });
  assert.equal(callbacks.length, 0);
  console.log('✓ no-wallet consent; cancel submits nothing');

  await open();
  await page.getByRole('button', { name: 'Share address', exact: true }).click();
  await page.getByRole('heading', { name: 'Address shared', exact: true }).waitFor();
  assert.equal(callbacks.length, 1);
  assert.equal(new URL(callbacks[0]).searchParams.get('address'), 'alice@example.com');
  assert.equal(new URL(callbacks[0]).searchParams.get('session'), 'KeepCase');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.address-request-dialog').waitFor({ state: 'detached' });
  console.log('✓ explicit approval sends exactly the reviewed address');

  await open();
  await page.evaluate(() => { window.__audit.app.config.globalProperties.$pinia._s.get('profile').lud16 = 'bob@example.com'; });
  await page.getByRole('heading', { name: 'Your address changed' }).waitFor();
  await page.getByRole('button', { name: 'Review address', exact: true }).click();
  await page.getByText('bob@example.com', { exact: true }).waitFor();
  await close();
  console.log('✓ address change invalidates consent');

  await open();
  await page.evaluate(() => { window.__audit.app._instance.proxy.locked = true; });
  await page.locator('.address-request-dialog').waitFor({ state: 'detached' });
  assert.equal(callbacks.length, 1);
  await page.evaluate(() => { window.__audit.app._instance.proxy.locked = false; });
  await page.getByRole('button', { name: 'Share address', exact: true }).waitFor();
  await close();
  console.log('✓ lock hides consent and unlock restores the unsubmitted request');

  for (const [status, title] of [['ERROR', 'Address not accepted'], ['unexpected', 'Sharing not confirmed']]) {
    responseStatus = status;
    const value = request();
    await open(value);
    await page.getByRole('button', { name: 'Share address', exact: true }).click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Share address', exact: true }).count(), 0);
    await close();
    await page.evaluate(async value => { const { offerAddressRequest } = await import('/src/services/addressRequestIntake.js'); offerAddressRequest(value); }, value);
    await page.getByText('This request was already submitted. Check the service before opening a new one.', { exact: true }).waitFor();
    await close();
  }
  responseStatus = 'OK';
  console.log('✓ rejection and uncertain outcomes never offer an unsafe retry');

  // An invalid explicit address must lead to setup, never an automatic fallback.
  await page.evaluate(() => { window.__audit.app.config.globalProperties.$pinia._s.get('profile').lud16 = 'invalid'; });
  await page.evaluate(async value => { const { offerAddressRequest } = await import('/src/services/addressRequestIntake.js'); offerAddressRequest(value); }, request());
  await page.getByRole('button', { name: 'Set up your address', exact: true }).click();
  await page.waitForFunction(() => location.hash.includes('/identity/profile'));
  await page.locator('.address-request-dialog').waitFor({ state: 'detached' });
  await page.evaluate(() => { window.__audit.app.config.globalProperties.$pinia._s.get('profile').lud16 = 'alice@example.com'; location.hash = '/about'; });
  await page.getByRole('button', { name: 'Share address', exact: true }).waitFor();
  await close();
  console.log('✓ address setup returns to review without submitting');

  // Exercise the production adapters themselves, then inspect the common UI.
  for (const adapter of ['send', 'redeem', 'clipboard', 'identity', 'contact']) {
    const value = request();
    await page.evaluate(async ({ adapter, value }) => {
      const t = key => key;
      const requests = window.__audit.app.config.globalProperties.$pinia._s.get('addressRequest');
      if (adapter === 'send') {
        const { default: component } = await import('/src/components/SendModal.vue');
        const vm = { $t: t, show: true, isProcessing: true };
        await component.methods.processPaymentData.call(vm, value);
        if (vm.show || vm.isProcessing) throw new Error('Send did not close cleanly');
        if (component.computed.detectedInputType.call({ manualInput: value }) !== 'address_request') throw new Error('Typed input was not recognized');
      } else if (adapter === 'redeem' || adapter === 'clipboard') {
        const { default: component } = await import('/src/pages/Wallet.vue');
        const vm = { $t: t, pendingWithdrawTargetSats: 123 };
        vm.onPaymentDetected = data => component.methods.onPaymentDetected.call(vm, data);
        if (adapter === 'redeem') {
          component.methods.onRedeemScanned.call(vm, value);
          if (vm.pendingWithdrawTargetSats !== null) throw new Error('Stale withdrawal amount');
        } else component.methods.useClipboardDestination.call(vm, value);
      } else if (adapter === 'identity') {
        const { default: component } = await import('/src/components/AddSiteSheet.vue');
        const events = [];
        const vm = { $t: t, $emit: name => events.push(name), close() { this.closed = true; } };
        component.methods.submitText.call(vm, value);
        if (!vm.closed || events.join() !== 'address-request') throw new Error('Sharing treated as sign-in');
      } else {
        const { default: component } = await import('/src/components/AddressBook/AddContactScan.vue');
        let stopped = false;
        component.methods.onDetect.call({ detected: false, stopScanner() { stopped = true; },
          $emit(name, input) { if (name !== 'address-request') throw new Error('Request treated as contact'); requests.open(input); },
        }, value);
        if (!stopped) throw new Error('Camera kept scanning');
      }
    }, { adapter, value });
    await page.getByRole('button', { name: 'Share address', exact: true }).waitFor();
    assert.equal(callbacks.length, 3);
    await close();
    console.log(`✓ ${adapter} adapter opens consent without submitting`);
  }

  // A spent or explicit-payment context must never become address disclosure.
  await page.evaluate(async value => {
    const { offerAddressRequest } = await import('/src/services/addressRequestIntake.js');
    offerAddressRequest(value, { paymentOnly: true });
    const { useAddressBookStore } = await import('/src/stores/addressBook.js');
    const contacts = useAddressBookStore();
    if (contacts.isValidAddress(value, 'lnurl') || contacts.detectAddressType(value)) throw new Error('Request accepted as reusable contact');
  }, request());
  assert.equal(await page.locator('.address-request-dialog').count(), 0);
  assert.equal(callbacks.length, 3);
  console.log('✓ payment-only and contact-storage boundaries');

  await page.evaluate(async () => {
    const { default: wallet } = await import('/src/pages/Wallet.vue');
    const { default: profile } = await import('/src/pages/PublicProfilePage.vue');
    const { LightningPaymentService } = await import('/src/utils/lightning.js');
    const operations = [
      () => wallet.methods.fetchLightningAddressInvoice.call({}, 'alice@payment.example', 10),
      () => wallet.methods.fetchLNURLInvoice.call({ decodeLNURL: () => 'https://payment.example/lnurl' }, 'https://payment.example/lnurl', 10),
      () => profile.methods.fetchInvoice.call({ lud16: 'alice@payment.example' }, 10),
      () => LightningPaymentService.prototype.handleLightningAddress.call({}, 'alice@payment.example'),
    ];
    for (const operation of operations) {
      let rejected = false;
      try { await operation(); } catch { rejected = true; }
      if (!rejected) throw new Error('Payment resolver accepted sharing metadata');
    }
  });
  assert.equal(callbacks.length, 3);
  assert.equal(paymentMetadataRequests, 4);
  console.log('✓ invoice resolution rejects sharing metadata before reaching its callback');

  // Render the real contact form: a one-time request must not become a saved
  // contact, and canceling the sharing task must preserve the user's draft.
  await page.evaluate(() => { location.hash = '/address-book'; });
  await page.locator('.add-contact-btn').click();
  await page.getByPlaceholder('Enter contact name').fill('Draft friend');
  const contactRequest = request();
  await page.getByPlaceholder('Paste the address from your friend or shop').fill(contactRequest);
  await page.getByRole('button', { name: 'Review request', exact: true }).click();
  await page.getByRole('button', { name: 'Share address', exact: true }).waitFor();
  assert.equal(await page.locator('.address-modal:visible').count(), 0);
  await close();
  await page.getByPlaceholder('Enter contact name').waitFor();
  assert.equal(await page.getByPlaceholder('Enter contact name').inputValue(), 'Draft friend');
  assert.equal(await page.getByPlaceholder('Paste the address from your friend or shop').inputValue(), contactRequest);
  await page.locator('.address-modal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.address-modal').waitFor({ state: 'detached' });
  console.log('✓ contact draft survives consent handoff and cancellation');

  await page.locator('.q-notification').waitFor({ state: 'detached' });
  for (const [locale, theme, width, height, scale] of [
    ['en-US', 'dark', 390, 844, 1], ['de', 'light', 320, 568, 2], ['es', 'dark', 768, 1024, 1],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async ({ locale, theme, scale }) => {
      const { applyLocale } = await import('/src/i18n/locales.js');
      applyLocale(window.__audit.app._instance.proxy.$i18n, locale);
      window.__audit.setDark(theme === 'dark');
      document.documentElement.style.fontSize = `${16 * scale}px`;
    }, { locale, theme, scale });
    const value = request('Rewards for Alice@Example.com. '.repeat(12));
    await page.evaluate(async value => { const { offerAddressRequest } = await import('/src/services/addressRequestIntake.js'); offerAddressRequest(value); }, value);
    await page.locator('.address-request-address').waitFor();
    await page.getByRole('heading', { name: ({ 'en-US': 'Share Lightning address?', de: 'Lightning-Adresse teilen?', es: '¿Compartir dirección Lightning?' })[locale], exact: true }).waitFor();
    await page.waitForTimeout(350);
    const layout = await page.locator('.address-request-sheet').evaluate(el => {
      const r = el.getBoundingClientRect();
      const buttons = [...el.querySelectorAll('.address-request-actions button')].map(b => { const x = b.getBoundingClientRect(); return { top: x.top, bottom: x.bottom, height: x.height }; });
      return { width: r.width, scrollWidth: el.scrollWidth, height: innerHeight, buttons };
    });
    assert.ok(layout.scrollWidth <= layout.width + 1, 'no horizontal clipping');
    assert.ok(layout.buttons.every(b => b.height >= 44 && b.top >= 0 && b.bottom <= layout.height), JSON.stringify(layout));
    await page.screenshot({ path: `${output}/${locale}-${theme}-${scale}x.png` });
    await page.evaluate(() => window.__audit.app.config.globalProperties.$pinia._s.get('addressRequest').close());
    await page.locator('.address-request-dialog').waitFor({ state: 'detached' });
    console.log(`✓ ${locale}, ${theme}, ${width}px, ${scale}x text: readable layout and reachable actions`);
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
