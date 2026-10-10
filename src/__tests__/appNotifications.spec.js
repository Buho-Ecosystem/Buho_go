/**
 * App.vue's two notification-related duties, run against its real script:
 *
 *   - 'app:locked': announced on the EventBus whenever the lock engages, so the
 *     contact chat can wipe the identity key it keeps in memory.
 *   - Taps: a tapped notification opens its in-app route, and nothing else.
 *
 * There is no component harness in this repo, so the <script> block is cut out
 * of App.vue, compiled with esbuild like the store specs do, and its setup()
 * is called by hand with stubbed imports. The notification service is the real
 * one (with a stub plugin), so a tap travels the whole way: plugin event,
 * service, App.vue, router. Modules this test does not care about are inert
 * stand-ins, so an unrelated new import in App.vue does not break it.
 *
 * Run directly with Node:
 *   node --test src/__tests__/appNotifications.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as Vue from 'vue';
import { EventBus } from '../utils/eventBus.js';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function toCommonJs(source) {
  return transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } }).code;
}

const appScript = (() => {
  const sfc = readFileSync(new URL('../App.vue', import.meta.url), 'utf8');
  const block = /<script>([\s\S]*?)<\/script>/.exec(sfc);
  assert.ok(block, 'App.vue has a plain <script> block');
  return toCommonJs(block[1]);
})();
const serviceScript = toCommonJs(readFileSync(new URL('../services/paymentNotifications.js', import.meta.url), 'utf8'));

/** The notification service as shipped, over a plugin that only knows listeners. */
function loadService(listeners) {
  const plugin = {
    addListener: async (event, fn) => {
      const entry = { event, fn };
      listeners.push(entry);
      return { remove: async () => { listeners.splice(listeners.indexOf(entry), 1); } };
    },
  };
  globalThis.window = { Notification: { requestPermission() {} } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', serviceScript)(name => {
    if (name === '@capacitor/core') return { Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } };
    if (name === '@capacitor/app') return { App: { getState: async () => ({ isActive: false }) } };
    if (name === '@capacitor/local-notifications') return { LocalNotifications: plugin };
    throw new Error(`Unexpected import: ${name}`);
  }, module, module.exports);
  return module.exports;
}

/** Stands in for any module the test does not care about: every property and call gives it back. */
function inert() {
  const stub = new Proxy(function () {}, {
    get: (_, key) => (key === 'then' || key === '__esModule' ? undefined : stub),
    apply: () => stub,
  });
  return stub;
}

/**
 * App.vue's setup(), called by hand. `native` picks the Capacitor branch,
 * `lockEnabled` makes the biometric lock engage at launch.
 */
function mountApp({ native = false, lockEnabled = false } = {}) {
  const hooks = { mounted: [], unmounted: [] };
  const listeners = [];
  const pushes = [];
  const lockEvents = [];
  const router = { isReadyCalls: 0 };
  let routerReady;
  const ready = new Promise(resolve => { routerReady = resolve; });
  router.isReady = () => { router.isReadyCalls++; return ready; };
  router.push = route => { pushes.push(route); return router.pushResult ? router.pushResult() : Promise.resolve(); };

  const stubs = {
    vue: {
      ...Vue,
      provide: () => {},
      onMounted: fn => hooks.mounted.push(fn),
      onUnmounted: fn => hooks.unmounted.push(fn),
    },
    'vue-router': { useRouter: () => router },
    '@capacitor/core': { Capacitor: { isNativePlatform: () => native } },
    '@capacitor/app': { App: { addListener: async () => ({ remove() {} }) } },
    quasar: { useQuasar: () => ({ dark: { isActive: false } }) },
    'src/stores/wallet': { useWalletStore: () => ({ isInitialized: true, biometricsEnabled: lockEnabled, kioskEnabled: false }) },
    'src/stores/notifications': { useNotificationsStore: () => ({ initialize: async () => {}, syncPermission: async () => {} }) },
    'src/stores/addressRequest.js': { useAddressRequestStore: () => ({ state: { stage: 'idle' } }) },
    'src/utils/biometric': { authenticate: async () => true, isBiometricAvailable: async () => ({ available: true }) },
    'src/utils/walletHydration': { triggerWalletStoreHydration() {}, readPersistedWalletState: () => null },
    'src/utils/eventBus': { EventBus },
    'src/services/paymentNotifications': loadService(listeners),
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', appScript)(name => stubs[name] || inert(), module, module.exports);

  const onLocked = () => lockEvents.push('app:locked');
  EventBus.on('app:locked', onLocked);

  const app = module.exports.default.setup();
  return {
    locked: app.locked,
    listeners,
    pushes,
    lockEvents,
    router,
    routerReady,
    mount: async () => { for (const hook of hooks.mounted) await hook(); },
    unmount: () => hooks.unmounted.forEach(hook => hook()),
    /** What the plugin does when the user taps a notification. */
    tap: (notification, actionId = 'tap') => {
      for (const { event, fn } of [...listeners]) {
        if (event === 'localNotificationActionPerformed') fn({ actionId, notification });
      }
    },
    dispose: () => EventBus.off('app:locked', onLocked),
  };
}

test('app:locked is announced in the same turn the lock engages, once per change', () => {
  const app = mountApp();
  try {
    assert.equal(app.locked.value, false);
    assert.deepEqual(app.lockEvents, []);

    app.locked.value = true;
    assert.deepEqual(app.lockEvents, ['app:locked'], 'no waiting for the next tick');

    app.locked.value = true;
    assert.equal(app.lockEvents.length, 1, 'not repeated while it stays locked');

    app.locked.value = false;
    assert.equal(app.lockEvents.length, 1, 'unlocking is not announced');

    app.locked.value = true;
    assert.equal(app.lockEvents.length, 2, 'locking again is');
  } finally {
    app.dispose();
  }
});

test('a lock that was already on at launch is not announced', async () => {
  const app = mountApp({ native: true, lockEnabled: true });
  try {
    assert.equal(app.locked.value, true, 'the lock engages while the app is being set up');
    await settle();
    assert.deepEqual(app.lockEvents, [], 'launching into the lock is a state, not a change');
  } finally {
    app.dispose();
  }
});

test('taps are listened for from mount on, on the web as well as in the app, and only once', async () => {
  for (const native of [false, true]) {
    const app = mountApp({ native });
    try {
      assert.equal(app.listeners.length, 0, 'nothing before mounting');
      const mounting = app.mount();
      await settle();
      assert.equal(app.listeners.length, 1, `registered early (native: ${native})`);
      assert.equal(app.listeners[0].event, 'localNotificationActionPerformed');
      await mounting;
      assert.equal(app.listeners.length, 1);
    } finally {
      app.dispose();
    }
  }
});

test('a tap on a notification with an in-app route opens it once the router is ready', async () => {
  const app = mountApp();
  try {
    await app.mount();
    await settle();
    const route = '/address-book/abc/chat';
    app.tap({ id: 1_713_917_725, title: 'Alice', body: 'Lunch?', extra: { route } });
    await settle();
    assert.deepEqual(app.pushes, [], 'a tap that launched the app waits for the first navigation');
    assert.equal(app.router.isReadyCalls, 1);

    app.routerReady();
    await settle();
    assert.deepEqual(app.pushes, [route]);

    app.tap({ id: 1_713_917_725, title: 'Alice', body: 'Lunch? I am outside', extra: { route } });
    await settle();
    assert.deepEqual(app.pushes, [route, route], 'every tap navigates');
  } finally {
    app.dispose();
  }
});

test('a tap that points anywhere but inside the app, or nowhere, goes nowhere', async () => {
  const app = mountApp();
  try {
    await app.mount();
    await settle();
    app.routerReady();
    const routes = [
      '//evil.example', '/\\evil.example', '/\t/evil.example', 'https://evil.example', 'javascript:alert(1)',
      'address-book/abc/chat', '', 42, {}, ['/wallet'], null, undefined, '/wallet\n',
    ];
    for (const route of routes) app.tap({ id: 1, title: 'x', body: 'y', extra: { route } });
    app.tap({ id: 2, title: 'Payment received', body: '100 sats' }); // a payment: no extra at all
    app.tap({ id: 3, title: 'x', body: 'y', extra: { route: '/wallet' } }, 'dismiss');
    await settle();
    assert.deepEqual(app.pushes, []);
    assert.equal(app.router.isReadyCalls, 0, 'refused before the router is even asked');
  } finally {
    app.dispose();
  }
});

test('a navigation that fails does not break the tap listener', async () => {
  const app = mountApp();
  try {
    await app.mount();
    await settle();
    app.routerReady();
    app.router.pushResult = () => Promise.reject(new Error('navigation cancelled'));
    app.tap({ id: 1, title: 'x', body: 'y', extra: { route: '/wallet' } });
    await settle(); // an unhandled rejection would fail the run here
    app.router.pushResult = null;
    app.tap({ id: 2, title: 'x', body: 'y', extra: { route: '/settings' } });
    await settle();
    assert.deepEqual(app.pushes, ['/wallet', '/settings']);
  } finally {
    app.dispose();
  }
});

test('unmounting stops listening for taps', async () => {
  const app = mountApp();
  try {
    await app.mount();
    await settle();
    assert.equal(app.listeners.length, 1);

    app.unmount();
    await settle();
    assert.equal(app.listeners.length, 0, 'the plugin listener is gone');
    app.routerReady();
    app.tap({ id: 1, title: 'x', body: 'y', extra: { route: '/wallet' } });
    await settle();
    assert.deepEqual(app.pushes, []);

    assert.doesNotThrow(() => app.unmount(), 'unmounting twice is harmless');
  } finally {
    app.dispose();
  }
});
