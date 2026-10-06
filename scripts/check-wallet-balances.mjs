/**
 * Start `npm run dev -- --port 9007`, then run this script.
 * Real Home/Settings, persistence and LNbits provider; only HTTP responses
 * are scripted. Covers #328 without keys, a server or real payments.
 */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.env.BALANCES_BASE_URL || 'http://localhost:9007';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const balances = { personal: 1747, business: 16 };
  let offline = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    if (url.hostname !== 'balance-wallet.example' || offline) return route.abort();
    const id = route.request().headers()['x-api-key'];
    return route.fulfill({ json: url.pathname === '/api/v1/wallet'
      ? { id, name: id, balance: balances[id] * 1000 } : [] });
  });
  await page.routeWebSocket('**', socket => socket.close());
  await page.addInitScript(() => {
    window.__AUDIT__ = { theme: 'light', noExitMonitor: true };
    localStorage.setItem('buhoGO_language', 'en-US');
    if (!localStorage.getItem('buhoGO_wallet_store')) {
      const wallets = ['personal', 'business'].map(id => ({ id, type: 'lnbits',
        name: id === 'personal' ? 'Personal' : 'Business',
        connectionData: { serverUrl: 'https://balance-wallet.example', walletId: id, adminKey: id },
        metadata: { cachedBalance: id === 'personal' ? 1747 : 16 },
      }));
      localStorage.setItem('buhoGO_wallet_store', JSON.stringify({ wallets, activeWalletId: 'personal' }));
    }
    window.balanceTestHome = () => {
      let vm = document.querySelector('.wallet-page-light, .wallet-page-dark')?.__vueParentComponent;
      while (vm && vm.type.name !== 'WalletPage') vm = vm.parent;
      return vm?.proxy;
    };
  });
  const navigate = async path => {
    await page.evaluate(path => window.__audit.app.config.globalProperties.$router.push(path), path);
  };
  const assertHome = async expected => {
    await page.waitForFunction(value => window.balanceTestHome()?.activeCanonicalBalance === value, expected);
    if (expected === null) {
      await page.locator('.balance-container .balance-placeholder').waitFor();
    } else {
      await page.waitForFunction(value => {
        const root = document.querySelector('.balance-container number-flow-vue')?.shadowRoot;
        const digits = [...(root?.querySelectorAll('.digit__num:not([inert])') || [])];
        return digits.map(digit => digit.textContent).join('') === String(value);
      }, expected);
    }
  };
  const assertManage = async (balance, total) => {
    await navigate('/settings');
    await page.locator('.settings-page').waitFor();
    await page.getByText('Manage Wallets', { exact: true }).first().click();
    const dialog = page.locator('.wallets-dialog-card').first();
    await dialog.waitFor();
    const text = await dialog.innerText();
    assert.match(text, new RegExp(`\\b${total}\\b`));
    assert.match(text, balance === null ? /—/ : new RegExp(`\\b${balance}\\b`));
    assert.doesNotMatch(text, /1[,. ]?747|1[,. ]?763/);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await navigate('/wallet');
    await assertHome(balance);
  };

  await page.goto(base + '/#/wallet');
  await page.waitForFunction(() => window.__audit?.app && window.balanceTestHome()?.showLoadingScreen === false);
  await assertHome(1747);
  balances.personal = 37; // 1700 sent + 10 fee
  await page.evaluate(() => window.balanceTestHome().updateWalletBalance());
  await assertHome(37);
  offline = true;
  await assertManage(37, 53);
  // A stale Home snapshot from an old build cannot win after restart.
  await page.evaluate(() => localStorage.setItem('buhoGO_wallet_state', JSON.stringify({ activeWalletId: 'personal', balance: 1747 })));
  await page.reload(); await assertHome(37); await assertManage(37, 53);

  offline = false;
  balances.personal = 237; // 200 received
  await page.evaluate(() => window.balanceTestHome().updateWalletBalance());
  await assertHome(237); await assertManage(237, 253);
  await page.evaluate(async () => {
    const store = window.balanceTestHome().walletStore;
    await store.switchActiveWallet('business');
    await store.switchActiveWallet('personal');
  });
  await assertHome(237);

  // Reproduce the reported old caches, with no network to rank them.
  offline = true;
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('buhoGO_wallet_store'));
    delete state.balanceSchemaVersion;
    state.wallets.find(w => w.id === 'personal').metadata.cachedBalance = 1747;
    localStorage.setItem('buhoGO_wallet_store', JSON.stringify(state));
    localStorage.setItem('buhoGO_wallet_state', JSON.stringify({ activeWalletId: 'personal', balance: 37 }));
  });
  await page.reload(); await assertHome(null); await assertManage(null, 16);
  offline = false; balances.personal = 37;
  await page.evaluate(() => window.balanceTestHome().updateWalletBalance());
  await assertHome(37); await assertManage(37, 53);
  assert.deepEqual(errors, []);
  console.log('PASS: Home and Manage wallets agree after send/receive refresh, switching, offline restart and legacy-cache recovery. Real LNbits provider, scripted HTTP only.');
} finally { await browser.close(); }
