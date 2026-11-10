/** Browser check for Choose photo in the scanners: a code in a picked picture
 * goes where a scanned one goes, a picture without one says so and the
 * camera comes back, the camera is off while the picker is open, and with no
 * camera the button is still there. The camera is Chromium's stand-in camera
 * showing a generated scene; the pictures are generated too, so nothing
 * leaves the machine. Start `npx quasar dev --port 9031` first (or set
 * SCAN_PHOTO_BASE_URL). Screenshots go to output/scan-photo (SCAN_PHOTO_OUTPUT).
 * SCAN_PHOTO_ONLY=site,contact runs only those cases (send, no-camera, short,
 * nwc, contact, site, german). */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';

const base = process.env.SCAN_PHOTO_BASE_URL || 'http://localhost:9031';
const output = process.env.SCAN_PHOTO_OUTPUT || new URL('../output/scan-photo', import.meta.url).pathname;
const assets = `${output}/assets`;
const only = (process.env.SCAN_PHOTO_ONLY || '').split(',').filter(Boolean);
const wanted = (name) => only.length === 0 || only.includes(name);
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
  await save('big-no-code.jpg', await make({ w: 8064, h: 6048, scene: true, type: 'image/jpeg' }));
  await save('lnurl-screenshot.png', await make({ w: 1179, h: 2556, title: 'Sign in', qr: await qr('lnurl1notasigninlinkatall'), x: 190, y: 700, size: 800 }));
  await writeFile(`${assets}/broken.heic`, Buffer.from('this is not a picture'));
  await browser.close();
}

// ---------------------------------------------------------------- the app
const cameraArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${assets}/scene.mjpeg`];
const withCamera = await chromium.launch({ headless: true, args: cameraArgs });
const withoutCamera = await chromium.launch({ headless: true });

let n = 0;
async function shot(page, name) {
  // A phone has no pointer resting on the page: no hover in the pictures.
  await page.mouse.move(0, 0);
  await pause(500);
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${output}/${file}` });
  console.log('shot', file);
}

async function open(browser, { theme = 'light', language = 'en-US', width = 390, height = 844 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
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
    // Every camera stream the page opens, so a check can see one left running
    // where no <video> shows it.
    window.__streams = [];
    const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (getUserMedia) {
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await getUserMedia(constraints);
        window.__streams.push(stream);
        return stream;
      };
    }
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

/** The component called `name`, found through the app's tree (also behind teleports). */
const componentVm = (page, name) => page.evaluateHandle((name) => {
  const seen = new Set();
  const inVNode = (vnode) => {
    if (!vnode || typeof vnode !== 'object') return null;
    if (vnode.component) { const found = inInstance(vnode.component); if (found) return found; }
    if (vnode.suspense?.activeBranch) { const found = inVNode(vnode.suspense.activeBranch); if (found) return found; }
    for (const list of [vnode.children, vnode.dynamicChildren]) {
      if (Array.isArray(list)) for (const child of list) { const found = inVNode(child); if (found) return found; }
    }
    return null;
  };
  const inInstance = (instance) => {
    if (!instance || seen.has(instance)) return null;
    seen.add(instance);
    return instance.type?.name === name ? instance.proxy : inVNode(instance.subTree);
  };
  return inInstance(window.__audit.app._instance);
}, name);

/** How many camera streams the page holds open, shown or not. */
const liveStreams = (page) => page.evaluate(() => window.__streams.filter((stream) => stream.getVideoTracks().some((track) => track.readyState === 'live')).length);

/** Is the point at the middle of `locator` taken by it (nothing on top)? */
const tappable = (locator) => locator.evaluate((el) => {
  const box = el.getBoundingClientRect();
  const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return !!top && (top === el || el.contains(top));
});

/**
 * Tap Choose photo and pick `file` in the system picker. A person takes a
 * moment in the picker; an instant pick would hide what happens once the
 * scanner's own 300 ms stop has passed.
 */
async function choosePhoto(page, file, scope = page) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), scope.getByRole('button', { name: /Choose photo|Foto auswählen/ }).first().click()]);
  await pause(500);
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
if (wanted('send')) {
  const { page, context, errors } = await open(withCamera);
  await openSendScanner(page);
  assert.equal(await cameraOn(page), true);
  await shot(page, 'send-scanner');

  // The camera is off while the picker is open, and stays off when the
  // page gets focus or turns visible meanwhile: this engine says when the
  // picker closes, so neither is taken for the person being back.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose photo' }).click()]);
  await pause(100);
  assert.equal(await cameraOn(page), false, 'camera off at once while the picker is open');
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await pause(4500);
  assert.equal(await cameraOn(page), false, 'camera still off after focus and visibility, 4.5 s in');
  assert.equal(await liveStreams(page), 0, 'no camera stream held anywhere while the picker is open');
  // A picture without a code: one line says so, the camera comes back.
  await chooser.setFiles(`${assets}/no-code.jpg`);
  await page.getByText('No QR code in this photo. Choose one that shows the whole code.').waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('.web-scan-surface video')?.readyState >= 2);
  assert.equal(await cameraOn(page), true, 'camera back on after a photo without a code');
  await shot(page, 'send-scanner-no-code');

  // While a large photo is read, the button says so, keeps the focus and
  // takes no second tap. Seen and tapped in the frame the state shows: on a
  // fast machine the read is over within a screenshot's time.
  await choosePhoto(page, 'big-no-code.jpg');
  const secondPicker = page.waitForEvent('filechooser', { timeout: 1500 }).then(() => true, () => false);
  const whileReading = await page.waitForFunction(() => {
    const el = document.querySelector('.web-scan-surface button[aria-busy="true"]');
    if (!el) return null;
    const state = {
      label: el.textContent.trim(),
      disabled: el.getAttribute('aria-disabled'),
      focused: document.activeElement === el,
    };
    el.click();
    return state;
  }, null, { timeout: 5000, polling: 'raf' });
  assert.deepEqual(await whileReading.jsonValue(), { label: 'Reading photo…', disabled: 'true', focused: true });
  assert.equal(await secondPicker, false, 'a tap while reading opens no second picker');
  await page.getByText('No QR code in this photo. Choose one that shows the whole code.').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Choose photo' }).waitFor();

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
if (wanted('no-camera')) {
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
  assert.equal(await tappable(page.getByRole('button', { name: 'Retry' })), true, 'Retry is not covered');
  await shot(page, 'send-no-camera');
  await choosePhoto(page, 'address-screenshot.png');
  await page.waitForFunction((address) => document.body.innerText.includes(address) || document.querySelector('[data-audit="send-input"]')?.value === address, ADDRESS, { timeout: 15000 });
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  no camera: Choose photo still reads the code');
}

// 2b. No camera on a short screen: Retry and Choose photo are both there to tap.
if (wanted('short')) {
  const { page, context, errors } = await open(withoutCamera, { width: 320, height: 568 });
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      for (let c = el.__vueParentComponent; c; c = c.parent) if (c.type?.name === 'WalletPage') { c.proxy.openSend(); return; }
    }
  });
  await page.locator('[data-audit="send-input"]').waitFor();
  const send = await vmOf(page, '[data-audit="send-input"]', 'SendModal');
  await send.evaluate((vm) => vm.openScanner());
  await page.getByText('Camera Access Required').waitFor({ timeout: 15000 });
  assert.equal(await tappable(page.getByRole('button', { name: 'Retry' })), true, 'Retry is not covered at 320 x 568');
  assert.equal(await tappable(page.getByRole('button', { name: 'Choose photo' })), true, 'Choose photo is not covered at 320 x 568');
  await shot(page, 'send-no-camera-320x568');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  no camera, 320 x 568: Retry and Choose photo both take a tap');
}

// 3. Connect a wallet (NWC), light and dark: the code in a screenshot fills the connection.
if (wanted('nwc')) for (const theme of ['light', 'dark']) {
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
if (wanted('nwc')) console.log('ok  NWC setup: a photo of a connection code fills it and tests it');

// 4. Add a contact: a code that is no contact gets an answer, not silence.
if (wanted('contact')) {
  const { page, context, errors } = await open(withCamera);
  await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/address-book'));
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      for (let c = el.__vueParentComponent; c; c = c.parent) if (typeof c.proxy?.showAddModal === 'function') { c.proxy.showAddModal(); return; }
    }
  });
  await page.getByRole('tab', { name: 'Scan' }).click();
  await page.getByRole('button', { name: 'Choose photo' }).waitFor({ timeout: 15000 });
  // Choose photo and Paste instead: a pair, the same size and weight.
  const [photoBox, pasteBox] = await Promise.all([
    page.getByRole('button', { name: 'Choose photo' }).boundingBox(),
    page.getByRole('button', { name: 'Paste instead' }).boundingBox(),
  ]);
  assert.ok(Math.abs(photoBox.x - pasteBox.x) < 1 && Math.abs(photoBox.width - pasteBox.width) < 1 && photoBox.height >= 44 && pasteBox.height >= 44, 'one width, 44 pt each');
  const contactCamera = () => page.evaluate(() => {
    const video = document.querySelector('.scan-frame video');
    return { video: !!video, ready: video?.readyState ?? -1 };
  });
  await page.waitForFunction(() => document.querySelector('.scan-frame video')?.readyState >= 2, null, { timeout: 15000 });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose photo' }).click()]);
  await pause(100);
  assert.equal(await cameraOn(page, '.scan-frame video'), false, 'camera off while the picker is open');
  await chooser.setFiles(`${assets}/menu-screenshot.png`);
  await page.getByText('That code is not a profile or an address. Choose a photo of the code you want to add.').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('.scan-frame video')?.readyState >= 2, null, { timeout: 15000 })
    .catch(async () => assert.fail(`the camera did not come back: ${JSON.stringify(await contactCamera())}`));
  assert.equal(await cameraOn(page, '.scan-frame video'), true, 'camera back on a moment after a quick read');
  await shot(page, 'contact-not-a-contact');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  Add contact: a photo of another kind of code says so');
}

// 4b. Add a site: a code that looks like a sign-in code but is none hands
// over to paste, and the camera it left behind is off for good.
if (wanted('site')) {
  const { page, context, errors } = await open(withCamera);
  await page.evaluate(() => window.__audit.app.config.globalProperties.$router.push('/identity'));
  await page.waitForFunction(() => document.querySelector('.q-page'), null, { timeout: 30000 });
  await pause(1500);
  const signIn = await componentVm(page, 'IdentitySignInSheet');
  assert.equal(await signIn.evaluate((vm) => !!vm), true, 'the sign-in sheet is on the identity page');
  await signIn.evaluate((vm) => { vm.showAddSite = true; });
  await page.waitForFunction(() => document.querySelector('.add-site-sheet video')?.readyState >= 2, null, { timeout: 20000 });
  const [photoBox, pasteBox] = await Promise.all([
    page.getByRole('button', { name: 'Choose photo' }).boundingBox(),
    page.getByRole('button', { name: 'Paste a link instead' }).boundingBox(),
  ]);
  assert.ok(Math.abs(photoBox.y - pasteBox.y) < 1 && photoBox.height >= 44 && pasteBox.height >= 44, 'side by side, 44 pt each');
  await shot(page, 'site-scanner');
  await choosePhoto(page, 'lnurl-screenshot.png');
  await page.waitForFunction(() => !document.querySelector('.add-site-sheet video'), null, { timeout: 15000 });
  await pause(3000);
  assert.equal(await liveStreams(page), 0, 'no camera left running once the sheet is in paste');
  await shot(page, 'site-not-a-sign-in-code');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('ok  Add a site: a code that is no sign-in code leaves no camera running');
}

// 5. German at 320 px: the label fits.
if (wanted('german')) {
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
