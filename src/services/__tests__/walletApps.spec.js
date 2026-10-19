/**
 * services/walletApps: when "Wallet app on this phone" is offered, and how.
 *
 *   node --test src/services/__tests__/walletApps.spec.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findWalletApps, walletAppOffer } from '../walletApps.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36';

test('the app asks the system, with any connection request', async () => {
  let asked = '';
  const plugin = { handlers: async ({ url }) => { asked = url; return { apps: [{ name: 'Alby Go', packageName: 'com.getalby.mobile' }, { name: '' }] }; } };
  assert.deepEqual(await findWalletApps({ native: true, plugin }), [{ name: 'Alby Go', packageName: 'com.getalby.mobile' }]);
  assert.equal(asked, 'nostr+walletauth://');
});

test('the web cannot know, and a build without the check says so', async () => {
  assert.equal(await findWalletApps({ native: false }), null);
  assert.equal(await findWalletApps({ native: true, plugin: { handlers: async () => { throw new Error('not implemented'); } } }), null);
});

test('in the app: offered with the apps found, by name, once each', () => {
  const apps = [{ name: 'Alby Go' }, { name: 'Blitz Wallet' }, { name: 'Alby Go' }];
  assert.deepEqual(walletAppOffer({ apps, native: true, userAgent: ANDROID }), { mode: 'open', names: ['Alby Go', 'Blitz Wallet'] });
  assert.equal(walletAppOffer({ apps: [], native: true, userAgent: ANDROID }), null, 'none installed');
  assert.equal(walletAppOffer({ apps: null, native: true, userAgent: ANDROID }), null, 'cannot tell (no native check)');
});

test('on the web: only an Android browser, which gets BuhoGO for Android', () => {
  assert.deepEqual(walletAppOffer({ apps: null, native: false, userAgent: ANDROID }), { mode: 'get-app' });
  assert.equal(walletAppOffer({ apps: null, native: false, userAgent: IPHONE }), null);
  assert.equal(walletAppOffer({ apps: null, native: false, userAgent: DESKTOP }), null);
});
