/**
 * Backup unlock check. Start `npx quasar dev --port 9014` first.
 *
 * The recovery dialog must ask for the app lock (PIN, fingerprint or face,
 * whatever the phone uses) after "I understand" and Next, and before any
 * word is shown, but only when Lock is turned on. The device sheet cannot
 * run in a browser, so this serves a stand-in for utils/biometric.js that
 * records each request and answers as told; everything else is the real
 * dialog with a scripted wallet. No network, no real phrase.
 *
 *   node scripts/check-backup-unlock.mjs
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const base = process.env.BACKUP_UNLOCK_BASE_URL || 'http://localhost:9014';
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const DEVICE_AUTH = `
export async function isBiometricAvailable() {
  return { available: true, biometryType: 'fingerprint', deviceIsSecure: true };
}
export async function authenticate(options) {
  window.__unlockRequests.push(options);
  return window.__unlockAnswer;
}`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === base && url.pathname === '/src/utils/biometric.js') {
      return route.fulfill({ contentType: 'application/javascript', body: DEVICE_AUTH });
    }
    if (url.origin === base || ['api.iconify.design', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  await page.addInitScript(() => {
    window.__AUDIT__ = { theme: 'dark', noExitMonitor: true };
    window.__unlockRequests = [];
    window.__unlockAnswer = true;
    localStorage.setItem('buhoGO_language', 'en-US');
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets: [], activeWalletId: null, biometricsEnabled: false }));
  });
  await page.goto(`${base}/#/security`);
  await page.locator('.security-page').waitFor();
  await page.evaluate(async phrase => {
    const { useWalletStore } = await import('/src/stores/wallet.js');
    const wallet = useWalletStore();
    wallet.wallets = [{ id: 'business', type: 'spark', name: 'Business', metadata: {}, connectionData: {} }];
    wallet.activeWalletId = 'business';
    window.__phraseReads = 0;
    wallet.getMnemonicForWallet = async () => { window.__phraseReads += 1; return phrase; };
    window.__wallet = wallet;
  }, PHRASE);

  const open = () => page.evaluate(() => {
    let component = document.querySelector('.security-page').__vueParentComponent;
    while (component && component.type.name !== 'SecurityPage') component = component.parent;
    component.proxy.selection = { kind: 'wallet', walletId: 'business', mode: 'backup' };
    component.proxy.showWords = true;
  });
  const close = async () => {
    await page.evaluate(() => {
      let component = document.querySelector('.security-page').__vueParentComponent;
      while (component && component.type.name !== 'SecurityPage') component = component.parent;
      component.proxy.showWords = false;
    });
    await page.locator('.recovery-card').waitFor({ state: 'detached' });
  };
  const confirmAndNext = async () => {
    await page.locator('.recovery-acknowledgement').click();
    await page.locator('.recovery-primary').click();
  };
  const state = () => page.evaluate(() => ({
    requests: window.__unlockRequests.length,
    reads: window.__phraseReads,
    wordsShown: [...document.querySelectorAll('.recovery-word-tile')].filter(tile => /[a-z]{3,}/.test(tile.textContent)).length,
    onIntro: !!document.querySelector('.recovery-body--prepare'),
    error: document.querySelector('.recovery-error')?.textContent.trim() || null,
  }));

  // Lock on: Next asks for the lock first, then the words.
  await page.evaluate(() => { window.__wallet.biometricsEnabled = true; });
  await open();
  await page.getByText('after verifying your biometric data', { exact: false }).waitFor();
  await confirmAndNext();
  await page.locator('.recovery-word-tile').first().waitFor();
  let now = await state();
  assert.equal(now.requests, 1, 'one unlock request');
  assert.equal(now.reads, 1, 'the phrase is read only after the unlock');
  assert.equal(now.wordsShown, 12);
  assert.match(await page.evaluate(() => window.__unlockRequests[0].reason), /reveal your recovery phrase/);
  await close();

  // Lock on, unlock cancelled: nothing is read, no word shown, the intro stays.
  await page.evaluate(() => { window.__unlockAnswer = false; window.__unlockRequests = []; window.__phraseReads = 0; });
  await open();
  await confirmAndNext();
  await page.locator('.recovery-error').waitFor();
  now = await state();
  assert.deepEqual([now.requests, now.reads, now.wordsShown, now.onIntro], [1, 0, 0, true]);
  assert.match(now.error, /Unlock was not completed/);
  await close();

  // Lock off: no unlock request, the words follow Next directly.
  await page.evaluate(() => { window.__wallet.biometricsEnabled = false; window.__unlockAnswer = true; window.__unlockRequests = []; window.__phraseReads = 0; });
  await open();
  await page.getByText('On the next page, your recovery phrase will be displayed.', { exact: true }).waitFor();
  await confirmAndNext();
  await page.locator('.recovery-word-tile').first().waitFor();
  now = await state();
  assert.deepEqual([now.requests, now.reads, now.wordsShown], [0, 1, 12]);

  assert.deepEqual(errors, []);
  console.log('PASS: with Lock on, Next asks for the app lock before the phrase is read or shown; a cancelled unlock shows nothing and keeps the intro; with Lock off the words follow Next directly.');
} finally {
  await browser.close();
}
