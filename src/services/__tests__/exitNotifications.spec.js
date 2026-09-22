import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../exitNotifications.js', import.meta.url), 'utf8');
const { code } = transformSync(source, { format: 'cjs' });
function harness({ native = true, permission = 'granted', available = true } = {}) {
  const state = { scheduled: [], cancelled: [], thenReads: 0 };
  const proxy = new Proxy({
    checkPermissions: async () => {
      if (!available) throw Error('Plugin unavailable');
      return { display: permission };
    },
    requestPermissions: async () => ({ display: permission }),
    schedule: async value => { state.scheduled.push(value); },
    cancel: async value => { state.cancelled.push(value); },
  }, {
    get(target, key) {
      if (key === 'then') {
        state.thenReads++;
        throw Error('Do not await the Capacitor plugin proxy');
      }
      return target[key];
    },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.equal(name, '@capacitor/core');
    return { Capacitor: { isNativePlatform: () => native }, registerPlugin: () => proxy };
  }, module, module.exports);
  return { ...module.exports, state };
}

test('unlock reminders schedule and cancel without resolving a plugin proxy', async () => {
  const service = harness();
  assert.equal(await service.remindersAvailable(), true);
  const at = Date.now() + 86400000;
  assert.equal(await service.scheduleUnlockReminder({ walletId: 'wallet-a', at, title: 'Ready to finish', body: 'Open the wallet' }), true);
  const notification = service.state.scheduled[0].notifications[0];
  assert.equal(notification.schedule.at.getTime(), at);
  assert.equal(notification.body, 'Open the wallet');
  await service.cancelUnlockReminder('wallet-a');
  assert.equal(service.state.cancelled.at(-1).notifications[0].id, notification.id);
  assert.equal(service.state.thenReads, 0);
});

test('web, a missing native plugin and denied permission keep reminders unavailable', async () => {
  for (const options of [{ native: false }, { available: false }, { permission: 'denied' }]) {
    const service = harness(options);
    assert.equal(await service.remindersAvailable(), false);
    assert.equal(await service.scheduleUnlockReminder({ walletId: 'wallet-a', at: Date.now() + 1000 }), false);
    assert.equal(service.state.scheduled.length, 0);
    assert.equal(service.state.thenReads, 0);
  }
});

test('no unlock date never schedules a reminder', async () => {
  const service = harness();
  assert.equal(await service.scheduleUnlockReminder({ walletId: 'wallet-a', at: null }), false);
  assert.equal(service.state.scheduled.length, 0);
});
