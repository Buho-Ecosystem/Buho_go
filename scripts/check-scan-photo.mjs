/** Browser check for Choose photo in the scanners: a code in a picked picture
 * goes where a scanned one goes, a picture without one says so and the
 * camera comes back, the camera is off while the picker is open, and with no
 * camera the button is still there. The camera is Chromium's stand-in camera
 * showing a generated scene; the pictures are generated too, so nothing
 * leaves the machine. Start `npx quasar dev --port 9031` first (or set
 * SCAN_PHOTO_BASE_URL). Screenshots go to output/scan-photo (SCAN_PHOTO_OUTPUT). */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';

const base = process.env.SCAN_PHOTO_BASE_URL || 'http://localhost:9031';
const output = process.env.SCAN_PHOTO_OUTPUT || new URL('../output/scan-photo', import.meta.url).pathname;
const assets = `${output}/assets`;
await mkdir(assets, { recursive: true });

const ADDRESS = 'alice@example.com';
const PK = 'b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4';
const NWC = `nostr+walletconnect://${PK}?relay=wss%3A%2F%2Frelay.example&secret=${'71'.repeat(32)}`;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------- pictures
// A camera scene (soft, out of focus), a screenshot with a code, a photo
// without one, and a file that is not a picture at all.
{
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const qr = async (text) => QRCode.toDataURL(text, { margin: 4, scale: 10, errorCorrectionLevel: 'M' });
  const make = async (spec) => page.evaluate(async (s) => {
    const cv = document.createElement('canvas');
    cv.width = s.w; cv.height = s.h;
    const g = cv.getContext('2d');
    if (s.scene) {
      const grad = g.createLinearGradient(0, 0, s.w, s.h);
      grad.addColorStop(0, '#2b2620'); grad.addColorStop(0.55, '#4a3f33'); grad.addColorStop(1, '#1d1b19');
      g.fillStyle = grad; g.fillRect(0, 0, s.w, s.h);
      g.filter = 'blur(38px)';
      const blobs = [[0.18, 0.22, 0.2, '#d9b98a'], [0.78, 0.3, 0.16, '#f1dfc2'], [0.62, 0.78, 0.24, '#8a6d4d'], [0.25, 0.75, 0.14, '#c9c2b6'], [0.5, 0.48, 0.3, '#5d5246']];
      for (const [x, y, r, c] of blobs) { g.globalAlpha = 0.55; g.fillStyle = c; g.beginPath(); g.arc(x * s.w, y * s.h, r * s.w, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1; g.filter = 'none';
    } else {
      g.fillStyle = s.bg || '#f2f2f7'; g.fillRect(0, 0, s.w, s.h);
      g.fillStyle = '#1c1c1e'; g.font = '600 54px -apple-system, Helvetica, sans-serif';
      if (s.title) g.fillText(s.title, 80, 300);
    }
    if (s.qr) {
      const img = new Image(); img.src = s.qr; await img.decode();
      g.fillStyle = '#fff'; g.fillRect(s.x - 30, s.y - 30, s.size + 60, s.size + 60);
      g.imageSmoothingEnabled = false; g.drawImage(img, s.x, s.y, s.size, s.size);
    }
    return cv.toDataURL(s.type || 'image/png', 0.9);
  }, spec);
  const save = async (name, dataUrl) => {
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
    await writeFile(`${assets}/${name}`, bytes);
    return bytes;
  };
  const scene = await save('scene.jpg', await make({ w: 720, h: 1280, scene: true, type: 'image/jpeg' }));
  await writeFile(`${assets}/scene.mjpeg`, Buffer.concat([scene, scene]));
  await save('address-screenshot.png', await make({ w: 1179, h: 2556, title: 'Pay Alice', qr: await qr(ADDRESS), x: 190, y: 700, size: 800 }));
  await save('nwc-screenshot.png', await make({ w: 1179, h: 2556, title: 'Connect a wallet', qr: await qr(NWC), x: 190, y: 700, size: 800 }));
  await save('menu-screenshot.png', await make({ w: 1179, h: 2556, title: 'Our menu', qr: await qr('https://example.com/menu'), x: 190, y: 700, size: 800 }));
  await save('no-code.jpg', await make({ w: 2016, h: 1512, scene: true, type: 'image/jpeg' }));
  await writeFile(`${assets}/broken.heic`, Buffer.from('this is not a picture'));
  await browser.close();
}

// ---------------------------------------------------------------- the app
const cameraArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${assets}/scene.mjpeg`];
const withCamera = await chromium.launch({ headless: true, args: cameraArgs });
const withoutCamera = await chromium.launch({ headless: true });

let n = 0;
async function shot(page, name) {
  await pause(500);
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${output}/${file}` });
  console.log('shot', file);
}

async function open(browser, { theme = 'light', language = 'en-US', width = 390 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => { if (!/reading 'send'/.test(error.message)) errors.push(error.message); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/.well-known/lnurlp/${ADDRESS.split('@')[0]}`) {
      return route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: { tag: 'payRequest', callback: `${url.origin}/callback`, minSendable: 1000, maxSendable: 100000000, metadata: '[["text/plain","Alice"]]' },
      });
    }
    return url.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com', 'api.iconify.design'].includes(url.hostname)
      ? route.continue()
      : route.abort();
  });
  await page.routeWebSocket('**', (socket) => {
    if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer();
    else socket.close();
  });
  await page.addInitScript(({ theme, language }) => {
    window.__AUDIT__ = { theme, noExitMonitor: true };
    localStorage.setItem('buhoGO_language', language);
    localStorage.setItem('buho-theme-mode', theme);
  }, { theme, language });
  await page.goto(`${base}/#/wallet`);
  await page.waitForFunction(() => window.__audit?.app?.config?.globalProperties?.$pinia, null, { timeout: 90000 });
  await page.evaluate(() => {
    const store = window.__audit.app.config.globalProperties.$pinia._s.get('wallet');
    store.$patch({ savedStateLoaded: true, isInitialized: true });
    store.wallets = [{ id: 'main', type: 'spark', name: 'Main', metadata: {}, createdAt: 1, lastUsed: 1 }];
    store.activeWalletId = 'main';
    store.hasBackedUp = true;
    store.connectionStates.main = { connected: true, error: null };
    store.balanceStates.main = { value: 184250, known: true, source: 'sync', verifiedAt: Date.now(), updatedAt: Date.now() };
    store.refreshBalance = async () => {};
  });
  await page.waitForFunction(() => document.querySelector('.q-page'), null, { timeout: 30000 });
  await pause(600);
  return { page, context, errors };
}

/** The nearest component instance of `name` around the first element matching `selector`. */
const vmOf = (page, selector, name) => page.evaluateHandle(({ selector, name }) => {
  for (const el of document.querySelectorAll(selector)) {
    for (let c = el.__vueParentComponent; c; c = c.parent) if (c.type?.name === name) return c.proxy;
  }
  return null;
}, { selector, name });

/** Tap Choose photo and pick `file` in the system picker. */
async function choosePhoto(page, file, scope = page) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), scope.getByRole('button', { name: /Choose photo|Foto auswählen/ }).first().click()]);
  await chooser.setFiles(file ? `${assets}/${file}` : []);
}

/** Is the camera on in the scanner shown (a live stream on its video)? */
const cameraOn = (page, selector = '.web-scan-surface video') => page.evaluate((selector) => {
  const stream = document.querySelector(selector)?.srcObject;
  return !!stream && stream.active && stream.getVideoTracks().some((track) => track.readyState === 'live');
}, selector);

async function openSendScanner(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      for (let c = el.__vueParentComponent; c; c = c.parent) if (c.type?.name === 'WalletPage') { c.proxy.openSend(); return; }
    }
  });
  await page.locator('[data-audit="send-input"]').waitFor();
  const send = await vmOf(page, '[data-audit="send-input"]', 'SendModal');
  await send.evaluate((vm) => vm.openScanner());
  await page.locator('.web-scan-surface').waitFor();
  await page.waitForFunction(() => document.querySelector('.web-scan-surface video')?.readyState >= 2, null, { timeout: 15000 });
}

// 1. Send: the camera runs, Choose photo sits under the prompt.
{
  const { page, context, errors } = await open(withCamera);
  await openSendScanner(page);
  assert.equal(await cameraOn(page), true);
  await shot(page, 'send-scanner');

  // The camera is off while the picker is open.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose photo' }).click()]);
  await pause(100);
  assert.equal(await cameraOn(page), false, 'camera off at once while the picker is open');
  // A picture without a code: one line says so, the camera comes back.
  await chooser.setFiles(`${assets}/no-code.jpg`);
  await page.getByText('No QR code in this photo. Choose one that shows the whole code.').waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('.web-scan-surface video')?.readyState >= 2);
  assert.equal(await cameraOn(page), true, 'camera back on after a photo without a code');
  await shot(page, 'send-scanner-no-code');

  // While a photo is read, the button says so.
  const button = await vmOf(page, '.qpb', 'QrPhotoButton');
  await button.evaluate((vm) => { vm.reading = true; });
  await page.getByRole('button', { name: 'Reading photo…' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Reading photo…' }).isDisabled(), true);
  await shot(page, 'send-scanner-reading');
  await button.evaluate((vm) => { vm.reading = false; });

  // Closed without a photo: the camera comes back, nothing else changes.
  await choosePhoto(page, null);
  await page.waitForFunction(() => document.querySelector('.web-scan-surface video')?.readyState >= 2);
  assert.equal(await cameraOn(page), true, 'camera back on after closing the picker');

  // Not a picture: said in words.
  await choosePhoto(page, 'broken.heic');
  await page.getByText("This photo can't be opened. Choose another one.").waitFor({ timeout: 10000 });

  // A screenshot with an address: Send takes it as if it was scanned.
  await choosePhoto(page, 'address-screenshot.png');
  await page.locator('.web-scan-surface').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await page.waitForFunction((address) => document.body.innerText.includes(address) || document.querySelector('[data-audit="send-input"]')?.value === address, ADDRESS, { timeout: 15000 });
  await shot(page, 'send-from-photo');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  Send: a photo with a code goes on, one without says so, the camera pauses and comes back');
}

// 2. No camera: Choose photo is the way left, and it works.
{
  const { page, context, errors } = await open(withoutCamera);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      for (let c = el.__vueParentComponent; c; c = c.parent) if (c.type?.name === 'WalletPage') { c.proxy.openSend(); return; }
    }
  });
  await page.locator('[data-audit="send-input"]').waitFor();
  const send = await vmOf(page, '[data-audit="send-input"]', 'SendModal');
  await send.evaluate((vm) => vm.openScanner());
  await page.getByText('Camera Access Required').waitFor({ timeout: 15000 });
  assert.equal(await page.getByRole('button', { name: 'Choose photo' }).isVisible(), true);
  await shot(page, 'send-no-camera');
  await choosePhoto(page, 'address-screenshot.png');
  await page.waitForFunction((address) => document.body.innerText.includes(address) || document.querySelector('[data-audit="send-input"]')?.value === address, ADDRESS, { timeout: 15000 });
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  no camera: Choose photo still reads the code');
}

// 3. Connect a wallet (NWC), light and dark: the code in a screenshot fills the connection.
for (const theme of ['light', 'dark']) {
  const { page, context, errors } = await open(withCamera, { theme });
  await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/nwc-setup'));
  await page.locator('.iform-sheet').first().waitFor({ timeout: 20000 });
  const setup = await vmOf(page, '.iform-sheet', 'NWCSetupPage');
  await setup.evaluate((vm) => { vm.testConnection = async () => { window.__tested = vm.nwcString; }; vm.openScanner(); });
  await page.getByRole('button', { name: 'Choose photo' }).waitFor({ timeout: 15000 });
  await pause(800);
  await shot(page, `nwc-scanner-${theme}`);
  if (theme === 'light') {
    await choosePhoto(page, 'nwc-screenshot.png');
    await page.waitForFunction(() => typeof window.__tested === 'string', null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__tested.startsWith('nostr+walletconnect://')), true);
  }
  assert.deepEqual(errors, []);
  await context.close();
}
console.log('ok  NWC setup: a photo of a connection code fills it and tests it');

// 4. Add a contact: a code that is no contact gets an answer, not silence.
{
  const { page, context, errors } = await open(withCamera);
  await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/address-book'));
  const book = await vmOf(page, '.q-page', 'AddressBookPage').catch(() => null);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      for (let c = el.__vueParentComponent; c; c = c.parent) if (typeof c.proxy?.showAddModal === 'function') { c.proxy.showAddModal(); return; }
    }
  });
  void book;
  await page.getByRole('tab', { name: 'Scan' }).click();
  await page.getByRole('button', { name: 'Choose photo' }).waitFor({ timeout: 15000 });
  const contactCamera = () => page.evaluate(() => {
    const video = document.querySelector('.scan-frame video');
    return { video: !!video, ready: video?.readyState ?? -1 };
  });
  await page.waitForFunction(() => document.querySelector('.scan-frame video')?.readyState >= 2, null, { timeout: 15000 });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose photo' }).click()]);
  await pause(100);
  assert.equal(await cameraOn(page, '.scan-frame video'), false, 'camera off while the picker is open');
  await chooser.setFiles(`${assets}/menu-screenshot.png`);
  await page.getByText('That code is not a profile or an address.').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('.scan-frame video')?.readyState >= 2, null, { timeout: 15000 })
    .catch(async () => assert.fail(`the camera did not come back: ${JSON.stringify(await contactCamera())}`));
  assert.equal(await cameraOn(page, '.scan-frame video'), true, 'camera back on a moment after a quick read');
  await shot(page, 'contact-not-a-contact');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  Add contact: a photo of another kind of code says so');
}

// 5. German at 320 px: the label fits.
{
  const { page, context, errors } = await open(withCamera, { language: 'de', width: 320 });
  await openSendScanner(page);
  const box = await page.getByRole('button', { name: 'Foto auswählen' }).boundingBox();
  assert.ok(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= 320, 'the button fits and keeps a 44 pt target');
  await shot(page, 'send-scanner-de-320');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  German at 320 px');
}

await withCamera.close();
await withoutCamera.close();
