import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../paymentNotifications.js', import.meta.url), 'utf8');
const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } });

function harness({ native = false, supported = true, active = false } = {}) {
  const state = { permission: 'granted', imports: 0, channels: [], posted: [], thenReads: 0 };
  const plugin = new Proxy({
    checkPermissions: async () => ({ display: state.permission }),
    requestPermissions: async () => ({ display: state.permission }),
    createChannel: async value => { state.channels.push(value); },
    schedule: async value => { state.posted.push(value); },
  }, {
    get(target, key) {
      if (key === 'then') {
        state.thenReads++;
        throw new Error('A Capacitor proxy must not be resolved as a promise');
      }
      return target[key];
    },
  });
  globalThis.window = supported ? { Notification: { requestPermission() {} } } : {};
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '@capacitor/core') return { Capacitor: { isNativePlatform: () => native, getPlatform: () => native ? 'android' : 'web' } };
    if (name === '@capacitor/app') return { App: { getState: async () => ({ isActive: active }) } };
    if (name === '@capacitor/local-notifications') {
      state.imports++;
      return { LocalNotifications: plugin };
    }
    throw new Error(`Unexpected import: ${name}`);
  }, module, module.exports);
  return { service: module.exports, state, plugin };
}

test('browser permission checks share a lazy module without awaiting the plugin proxy', async () => {
  const { service, state } = harness();
  assert.equal(await service.permissionState(), 'granted');
  state.permission = 'denied';
  assert.equal(await service.permissionState(), 'denied');
  assert.equal(await service.requestPermission(), 'denied');
  assert.equal(state.imports, 1);
  assert.equal(state.thenReads, 0);
});

test('unsupported browsers do not import or invoke the plugin', async () => {
  const { service, state } = harness({ supported: false });
  assert.equal(await service.permissionState(), 'unsupported');
  assert.equal(await service.requestPermission(), 'unsupported');
  assert.equal(await service.notify({ title: 'Payment received' }), false);
  assert.equal(state.imports, 0);
});

test('background notifications post on web without creating Android channels', async () => {
  const { service, state } = harness();
  assert.equal(await service.notify({ title: 'Payment received', body: '100 sats' }), true);
  assert.equal(state.posted[0].notifications[0].body, '100 sats');
  assert.equal(state.channels.length, 0);
  assert.equal(state.thenReads, 0);
});

test('Android creates the private channel once and posts only when out of sight', async () => {
  const { service, state } = harness({ native: true });
  await service.notify({ title: 'Payment received' });
  await service.notify({ title: 'Payment received' });
  assert.equal(state.channels.length, 1);
  assert.equal(state.channels[0].visibility, 0);
  assert.equal(state.posted.length, 2);
  assert.notEqual(state.posted[0].notifications[0].id, state.posted[1].notifications[0].id);
  const foreground = harness({ native: true, active: true });
  assert.equal(await foreground.service.notify({ title: 'Payment received' }), false);
  assert.equal(foreground.state.posted.length, 0);
});

test('a failed permission check or notification does not reject a payment caller', async () => {
  const { service, plugin } = harness();
  plugin.checkPermissions = async () => { throw new Error('plugin unavailable'); };
  plugin.schedule = async () => { throw new Error('notifications blocked'); };
  assert.equal(await service.permissionState(), 'unsupported');
  assert.equal(await service.notify({ title: 'Payment received' }), false);
});
