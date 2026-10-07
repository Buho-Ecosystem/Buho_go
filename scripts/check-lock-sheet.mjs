/**
 * App lock sheet check. Start `npx quasar dev --port 9017` first.
 *
 * Settings' own switch opens the real sheet for each way a phone can check
 * it's you: the method named big, its picture, one line, and Turn on app
 * lock / Cancel, nothing else. The device prompt cannot run in a browser,
 * so utils/biometric.js is served as a stand-in that reports the method
 * under test and records each unlock request. No network.
 *
 *   node scripts/check-lock-sheet.mjs
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.LOCK_SHEET_BASE_URL || 'http://127.0.0.1:9017';
const output = process.env.LOCK_SHEET_OUTPUT || '/private/tmp/lock-sheet-review';
await mkdir(output, { recursive: true });

const DEVICE_AUTH = `
export async function isBiometricAvailable() {
  return { available: true, biometryType: window.__biometryType, deviceIsSecure: true };
}
export async function authenticate(options) {
  window.__unlockRequests.push(options);
  return true;
}`;

const METHODS = [
  { type: 'device-pin', title: 'Device PIN', line: "We ask for your PIN, pattern or password whenever we need to be sure it's you.", picture: /secure-login/ },
  { type: 'fingerprint', title: 'Fingerprint', line: "We ask for your fingerprint whenever we need to be sure it's you.", picture: /fingerprint/ },
  { type: 'multiple', title: 'Biometrics', line: "We ask for your face or fingerprint whenever we need to be sure it's you.", picture: /face-scan/ },
  { type: 'face', title: 'Face recognition', line: "We ask for your face whenever we need to be sure it's you.", picture: /face-scan/ },
  { type: 'iris', title: 'Iris scan', line: "We ask for an iris scan whenever we need to be sure it's you.", picture: /face-scan/ },
];

const browser = await chromium.launch({ headless: true });
const errors = [];

async function openSettings(theme, viewport = { width: 390, height: 844 }) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base && url.pathname === '/src/utils/biometric.js') {
      return route.fulfill({ contentType: 'application/javascript', body: DEVICE_AUTH });
    }
    if (url.origin === base || ['api.iconify.design', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.addInitScript((theme) => {
    window.__AUDIT__ = { theme, noExitMonitor: true };
    window.__unlockRequests = [];
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
  }, theme);
  await page.goto(`${base}/#/settings`, { timeout: 90000 });
  await page.locator('.settings-page').waitFor({ timeout: 90000 });
  return page;
}

// Flip the App lock switch on through Settings' own handler.
async function turnOnSwitch(page, type) {
  await page.evaluate(async (type) => {
    window.__biometryType = type;
    let component = document.querySelector('.settings-page').__vueParentComponent;
    while (component && component.type.name !== 'SettingsPage') component = component.parent;
    window.__settings = component.proxy;
    await component.proxy.toggleBiometrics(true);
  }, type);
  await page.locator('.auth-dialog').waitFor();
  await page.waitForTimeout(350);
}

async function sheetState(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('.auth-dialog');
    const img = sheet.querySelector('.auth-illustration');
    const close = sheet.querySelector('.auth-close').getBoundingClientRect();
    const box = sheet.getBoundingClientRect();
    return {
      title: sheet.querySelector('.auth-heading').textContent.trim(),
      line: sheet.querySelector('.auth-lede').textContent.trim(),
      picture: img.getAttribute('src'),
      pictureLoaded: img.complete && img.naturalWidth > 0,
      paragraphs: sheet.querySelectorAll('.auth-step-body p').length,
      buttons: [...sheet.querySelectorAll('.auth-dialog-actions button')].map((b) => b.textContent.trim()),
      close: { w: Math.round(close.width), h: Math.round(close.height) },
      fits: box.top >= 0 && box.bottom <= window.innerHeight,
    };
  });
}

try {
  for (const theme of ['dark', 'light']) {
    const page = await openSettings(theme);
    for (const method of METHODS) {
      await turnOnSwitch(page, method.type);
      const state = await sheetState(page);
      assert.equal(state.title, method.title, `${method.type}: title`);
      assert.equal(state.line, method.line, `${method.type}: line`);
      assert.match(state.picture, method.picture, `${method.type}: picture`);
      assert.ok(state.pictureLoaded, `${method.type}: picture loads`);
      assert.equal(state.paragraphs, 1, `${method.type}: one line, no info box`);
      assert.deepEqual(state.buttons.slice(-2), ['Turn on app lock', 'Cancel'], `${method.type}: actions`);
      assert.ok(state.close.w >= 44 && state.close.h >= 44, `${method.type}: close is a 44 px target`);
      assert.ok(state.fits, `${method.type}: the sheet fits the screen`);
      await page.screenshot({ path: `${output}/${theme}-${method.type}.png` });

      // Turn on app lock asks the phone once, then closes and switches on.
      const before = await page.evaluate(() => window.__unlockRequests.length);
      await page.locator('.auth-primary-btn').click();
      await page.locator('.auth-dialog').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => window.__unlockRequests.length), before + 1);
      assert.equal(await page.evaluate(() => window.__settings.biometricsEnabled), true);
    }
    console.log(`✓ ${theme}: every method shows its name, picture and one line, and turns the lock on`);

    await turnOnSwitch(page, 'multiple');
    await page.evaluate(() => { window.__settings.biometricsEnabled = false; });
    const before = await page.evaluate(() => window.__unlockRequests.length);
    await page.locator('.auth-secondary-btn').click();
    await page.locator('.auth-dialog').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.__unlockRequests.length), before);
    assert.equal(await page.evaluate(() => window.__settings.biometricsEnabled), false);
    console.log(`✓ ${theme}: Cancel closes without asking the phone`);
    await page.close();
  }

  // A small phone: the picture gives way, the sheet still fits.
  const small = await openSettings('dark', { width: 360, height: 640 });
  for (const method of METHODS) {
    await turnOnSwitch(small, method.type);
    const state = await sheetState(small);
    assert.ok(state.fits, `${method.type}: fits 360x640`);
    if (method.type === 'multiple') await small.screenshot({ path: `${output}/small-${method.type}.png` });
    await small.locator('.auth-secondary-btn').click();
    await small.locator('.auth-dialog').waitFor({ state: 'detached' });
  }
  console.log('✓ every method fits a 360x640 phone');
  await small.close();

  const unexpected = errors.filter((message) => !/reading 'send'/.test(message));
  assert.deepEqual(unexpected, [], `page errors: ${unexpected.join(' | ')}`);
  console.log(`\nAll lock sheet checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
