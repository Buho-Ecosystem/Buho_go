// Run against `pnpm dev --port 9012`. Uses isolated synthetic notices;
// no wallet credentials, real payments, or outbound service requests.
import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.TOAST_BASE_URL || 'http://localhost:9012';
const engine = process.env.TOAST_BROWSER || 'chromium';
const desktop = process.argv.includes('--desktop');
const output = process.env.TOAST_OUTPUT || 'output/toast-interactions';
await mkdir(output, { recursive: true });
const browser = await ({ chromium, webkit })[engine].launch({ headless: true });
const context = await browser.newContext({ viewport: desktop ? { width: 1024, height: 768 } : { width: 390, height: 844 }, isMobile: !desktop, hasTouch: !desktop });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.hostname === 'mempool.space' && url.pathname === '/api/v1/prices') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ USD: 85871, EUR: 78000 }) });
  if (url.origin === base || url.hostname === 'api.iconify.design') return route.continue();
  return route.abort();
});
await page.routeWebSocket('**', socket => {
  if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else socket.close();
});
await page.addInitScript(() => {
  window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
  localStorage.setItem('buhoGO_language', 'en-US');
  localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
});
const card = message => page.locator('.app-toast').filter({ has: page.locator('.app-toast__message', { hasText: message }) });
const show = config => page.evaluate(config => window.__audit.app.config.globalProperties.$q.notify(config), config);
const reset = async () => {
  await page.evaluate(async () => {
    const { toastController, toastItems } = await import('/src/services/toasts.js');
    for (const toast of toastItems.value) toastController.dismiss(toast.id);
  });
  await page.waitForTimeout(200);
};
const activate = locator => desktop ? locator.click() : locator.tap();
const shot = name => page.screenshot({ path: `${output}/${engine}${desktop ? '-desktop' : ''}-${name}.png`, fullPage: true });

try {
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => !!window.__audit?.app?._instance && !!document.querySelector('.wallet-page-light'));
  if (process.argv.includes('--debug')) await page.evaluate(() => {
    window.toastEvents = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) document.addEventListener(type, e => window.toastEvents.push({ type, x: e.clientX, y: e.clientY, target: e.target.className, primary: e.isPrimary, button: e.button, transform: document.querySelector('.app-toast')?.style.cssText }), true);
  });
  const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
  // Chromium dispatches real browser touch input. WebKit uses pointer events
  // to exercise the same handlers; native iPhone gestures still need a device.
  async function gesture(message, xDistance, yDistance = 0, cancel = false, holdMs = 0) {
    const target = card(message).locator('.app-toast__copy');
    // A newly stacked neighbor animates the previous card's position.
    // Hit-test only after that placement animation has finished.
    await page.waitForTimeout(200);
    const box = await target.boundingBox(); assert.ok(box);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (desktop) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      if (holdMs) await page.waitForTimeout(holdMs);
      for (let i = 1; i <= 6; i++) {
        await page.mouse.move(x + xDistance * i / 6, y + yDistance * i / 6);
        await page.waitForTimeout(20);
      }
      if (cancel) await target.dispatchEvent('pointercancel', { pointerId: 1 });
      await page.mouse.up();
      await page.mouse.move(0, 0);
    } else if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      if (holdMs) await page.waitForTimeout(holdMs);
      for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + xDistance * i / 6, y: y + yDistance * i / 6 }] });
        await page.waitForTimeout(20);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    } else {
      const data = { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: y };
      await target.dispatchEvent('pointerdown', data);
      if (holdMs) await page.waitForTimeout(holdMs);
      // Synthetic events have no native pointer capture; stub only that API.
      await card(message).evaluate(node => { node.setPointerCapture = () => {}; });
      for (let i = 1; i <= 6; i++) {
        await target.dispatchEvent('pointermove', { ...data, clientX: x + xDistance * i / 6, clientY: y + yDistance * i / 6 });
        await page.waitForTimeout(20);
      }
      await target.dispatchEvent(cancel ? 'pointercancel' : 'pointerup', { ...data, buttons: 0 });
    }
  }

  await show({ message: 'Swipe right', timeout: 60000 });
  await show({ message: 'Keep this neighbor', timeout: 60000 });
  await gesture('Swipe right', 150);
  if (process.argv.includes('--debug')) { console.log(await page.evaluate(() => window.toastEvents)); await shot('debug'); }
  await card('Swipe right').waitFor({ state: 'detached' });
  assert.equal(await card('Keep this neighbor').count(), 1);
  await gesture('Keep this neighbor', -150);
  await card('Keep this neighbor').waitFor({ state: 'detached' });
  console.log('PASS: left/right swipe removes only the selected toast');

  await show({ message: 'Keep incomplete', timeout: 60000 });
  await gesture('Keep incomplete', 22);
  await page.waitForTimeout(200);
  assert.equal(await card('Keep incomplete').count(), 1);
  assert.equal(await card('Keep incomplete').evaluate(node => getComputedStyle(node).transform), 'matrix(1, 0, 0, 1, 0, 0)');
  await gesture('Keep incomplete', 120, 0, true);
  await page.waitForTimeout(200);
  assert.equal(await card('Keep incomplete').count(), 1);
  await gesture('Keep incomplete', 0, -90);
  assert.equal(await card('Keep incomplete').count(), 1);
  await reset();
  console.log('PASS: short, cancelled and vertical gestures retain the toast');

  await show({ message: 'Tap to dismiss', timeout: 60000 });
  await activate(card('Tap to dismiss').locator('.app-toast__tap-dismiss'));
  await card('Tap to dismiss').waitFor({ state: 'detached' });
  await show({ message: 'Hold timer', timeout: 200 });
  await gesture('Hold timer', 20, 0, false, 1500);
  assert.equal(await card('Hold timer').count(), 1);
  if (desktop) await page.evaluate(() => document.activeElement.blur());
  await card('Hold timer').waitFor({ state: 'detached', timeout: 3000 });
  console.log('PASS: tap alternative and hold-to-pause remaining lifetime');

  await page.evaluate(() => {
    window.toastActionCount = 0;
    window.__audit.app.config.globalProperties.$q.notify({ message: 'Action notice', timeout: 60000, actions: [{ label: 'View', noDismiss: true, handler: () => window.toastActionCount++ }] });
  });
  await gesture('Action notice', 20);
  assert.equal(await page.evaluate(() => window.toastActionCount), 0);
  await activate(card('Action notice').getByRole('button', { name: 'View', exact: true }));
  assert.equal(await page.evaluate(() => window.toastActionCount), 1);
  assert.equal(await card('Action notice').count(), 1);
  await activate(card('Action notice').getByRole('button', { name: 'Dismiss', exact: true }));
  await card('Action notice').waitFor({ state: 'detached' });
  console.log('PASS: actions stay separate from gestures and honor noDismiss');

  await show({ message: 'Duplicate', timeout: 60000 });
  await show({ message: 'Duplicate', timeout: 60000 });
  assert.equal(await card('Duplicate').count(), 1);
  assert.equal(await card('Duplicate').locator('.app-toast__count').textContent(), '2');
  await reset();
  await page.evaluate(async () => {
    const resource = performance.getEntriesByType('resource').find(entry => /\/quasar_dist_quasar__client__js\.js(?:\?|$)/.test(entry.name));
    if (!resource) throw new Error('Cannot find the app’s loaded Quasar module');
    const { Notify } = await import(resource.name);
    if (Notify.create !== window.__audit.app.config.globalProperties.$q.notify) throw new Error('Notify.create bypasses the shared controller');
    window.progressToast = Notify.create({ type: 'ongoing', message: 'Persistent progress' });
  });
  await card('Persistent progress').waitFor();
  await page.evaluate(() => window.progressToast({ type: 'positive', spinner: false, message: 'Updated progress', timeout: 60000 }));
  await card('Updated progress').waitFor();
  await reset();
  await page.evaluate(() => window.progressToast({ message: 'Must not resurrect' }));
  assert.equal(await page.locator('.app-toast').count(), 0);
  console.log('PASS: grouped duplicates and Notify.create progress updates/dismissal');

  await show({ message: 'Keyboard notice', timeout: 100 });
  await card('Keyboard notice').locator('.app-toast__tap-dismiss').focus();
  await page.waitForTimeout(1400);
  assert.equal(await card('Keyboard notice').count(), 1);
  await page.keyboard.press('Escape');
  await card('Keyboard notice').waitFor({ state: 'detached' });
  // The real receive dialog exercises Quasar's focus trap and aria-modal.
  await page.evaluate(() => {
    let component = document.querySelector('.wallet-page-light').__vueParentComponent;
    while (component && component.type.name !== 'WalletPage') component = component.parent;
    component.proxy.showReceiveModal = true;
  });
  await page.locator('.receive-card').waitFor();
  await show({ message: 'Inside Receive', timeout: 60000 });
  await card('Inside Receive').locator('.app-toast__tap-dismiss').focus();
  await page.waitForTimeout(200);
  assert.equal(await card('Inside Receive').evaluate(node => node.contains(document.activeElement)), true);
  assert.equal(await card('Inside Receive').evaluate(node => !!node.closest('[aria-modal="true"]')), true);
  await page.keyboard.press('Enter');
  await card('Inside Receive').waitFor({ state: 'detached' });
  await show({ message: 'Survives dialog close', timeout: 60000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.app-toast-portal')?.parentNode === document.body);
  assert.equal(await card('Survives dialog close').count(), 1);
  await reset();
  console.log('PASS: keyboard dismissal and focus inside Receive dialog');

  if (desktop) {
    await show({ message: 'Mouse hover', timeout: 100 });
    await card('Mouse hover').hover();
    await page.waitForTimeout(1400);
    assert.equal(await card('Mouse hover').count(), 1);
    await page.mouse.move(0, 0);
    await card('Mouse hover').waitFor({ state: 'detached', timeout: 3000 });
    console.log('PASS: mouse hover pauses and resumes the remaining timeout');
  }

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '24px';
    document.documentElement.style.setProperty('--safe-bottom', '34px');
  });
  await show({ type: 'warning', message: 'Die Verbindung konnte nicht hergestellt werden. Bitte versuche es erneut.', caption: 'https://example.com/a-very-long-unbroken-transaction-identifier-0123456789', timeout: 60000, actions: [{ label: 'Erneut versuchen' }] });
  await page.waitForTimeout(200);
  const layout = await page.locator('.app-toast').evaluate(node => {
    const box = node.getBoundingClientRect();
    return { left: box.left, right: box.right, bottom: box.bottom, width: innerWidth, height: innerHeight, controls: [...node.querySelectorAll('button')].map(button => button.getBoundingClientRect().height) };
  });
  assert.ok(layout.left >= 0 && layout.right <= layout.width && layout.bottom <= layout.height - 34);
  assert.ok(layout.controls.every(height => height >= 44));
  await shot('large-text-safe-area');
  await reset();
  await page.evaluate(() => {
    document.documentElement.style.removeProperty('font-size');
    document.documentElement.style.removeProperty('--safe-bottom');
  });
  console.log('PASS: long text, larger type, safe area and 44px control targets');

  for (const dark of [false, true]) {
    await reset();
    await page.evaluate(dark => window.__audit.setDark(dark), dark);
    await show({ type: 'info', message: 'Connecting to wallet', timeout: 60000 });
    await show({ type: 'negative', message: 'Payment failed', timeout: 60000 });
    await show({ type: 'positive', message: 'Address copied', timeout: 60000 });
    await show({ type: 'warning', message: 'Connection unavailable', caption: 'Please try again.', timeout: 60000, actions: [{ label: 'Retry' }] });
    await page.waitForTimeout(300);
    await shot(dark ? 'dark' : 'light');
  }
  await reset();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await show({ message: 'Reduced motion', timeout: 60000 });
  assert.equal(await card('Reduced motion').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
  await gesture('Reduced motion', 150);
  await card('Reduced motion').waitFor({ state: 'detached' });
  console.log('PASS: themes and reduced-motion dismissal');
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
