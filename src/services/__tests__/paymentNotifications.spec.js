import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../paymentNotifications.js', import.meta.url), 'utf8');
const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } });

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// The notification ids in use, as documented at the top of the service. The
// emergency-exit range is read from its source further down.
const PAYMENT_IDS = [41000, 41999];
const STABLE_IDS = [1_000_000_000, 1_999_999_999];
const INT32_MAX = 2_147_483_647;

/** Run `fn` with console.warn silenced, for tests that fail on purpose. */
async function quiet(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
}

function harness({ native = false, supported = true, active = false, realPlugin = null } = {}) {
  const state = {
    permission: 'granted', imports: 0, channels: [], posted: [], thenReads: 0,
    listeners: [], listenerCalls: 0, removed: 0,
  };
  const plugin = new Proxy({
    checkPermissions: async () => ({ display: state.permission }),
    requestPermissions: async () => ({ display: state.permission }),
    createChannel: async value => { state.channels.push(value); },
    schedule: async value => { state.posted.push(value); },
    addListener: async (event, fn) => {
      state.listenerCalls++;
      const entry = { event, fn };
      state.listeners.push(entry);
      return {
        remove: async () => {
          state.removed++;
          state.listeners = state.listeners.filter(item => item !== entry);
        },
      };
    },
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
      return { LocalNotifications: realPlugin || plugin };
    }
    throw new Error(`Unexpected import: ${name}`);
  }, module, module.exports);
  return { service: module.exports, state, plugin };
}

/** What the plugin does when the user taps a notification: every listener hears it. */
function tap(state, notification, actionId = 'tap') {
  for (const { event, fn } of [...state.listeners]) {
    if (event === 'localNotificationActionPerformed') fn({ actionId, notification });
  }
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

// --- payments are unchanged ------------------------------------------------

test('a payment notification keeps exactly the shape it always had', async () => {
  const { service, state } = harness();
  assert.equal(await service.notify({ title: 'Payment received', body: '100 sats' }), true);
  assert.equal(await service.notify({ title: 'Payment received', body: '200 sats' }), true);
  const base = { title: 'Payment received', channelId: 'payments', smallIcon: 'ic_stat_notification', isExactNotification: false };
  assert.deepEqual(state.posted, [
    { notifications: [{ ...base, id: 41001, body: '100 sats' }] },
    { notifications: [{ ...base, id: 41002, body: '200 sats' }] },
  ], 'no extra, group or other new key unless a caller asks for one');
});

test('the payments channel is created as before, named after the first notification', async () => {
  const { service, state } = harness({ native: true });
  await service.notify({ title: 'Payment received', body: '100 sats' });
  assert.deepEqual(state.channels, [
    { id: 'payments', name: 'Payment received', importance: 4, visibility: 0 },
  ]);
  assert.equal(state.posted[0].notifications[0].channelId, 'payments');
});

test('force still skips the background check, and a missing title or argument posts nothing', async () => {
  const { service, state } = harness({ native: true, active: true });
  assert.equal(await service.notify({ title: 'Payment received' }), false);
  assert.equal(await service.notify({ title: 'Payment received', force: true }), true);
  assert.equal(await service.notify({ body: 'no title', force: true }), false);
  assert.equal(await service.notify(), false);
  assert.equal(state.posted.length, 1);
  assert.equal(state.posted[0].notifications[0].body, '');
});

test('rolling payment ids stay inside their window and never reach the stable window', async () => {
  const { service, state } = harness();
  for (let i = 0; i < 1100; i++) await service.notify({ title: 'Payment received', force: true });
  const ids = state.posted.map(post => post.notifications[0].id);
  assert.equal(ids.length, 1100);
  for (const id of ids) {
    assert.ok(id >= PAYMENT_IDS[0] && id <= PAYMENT_IDS[1], `${id} is outside the payments window`);
  }
  assert.equal(new Set(ids.slice(0, 1000)).size, 1000, 'a full window of distinct ids before it wraps');
});

// --- the messages channel --------------------------------------------------

test('messages get their own channel, named by the caller and created once; payments keep theirs', async () => {
  const { service, state } = harness({ native: true });
  const message = title => ({ title, body: 'Hi', channel: 'messages', channelName: 'Messages', force: true });
  assert.equal(await service.notify(message('Alice')), true);
  assert.equal(await service.notify(message('Bob')), true);
  assert.equal(await service.notify({ title: 'Payment received', body: '100 sats', force: true }), true);
  assert.equal(await service.notify({ title: 'Payment received', body: '200 sats', force: true }), true);
  assert.deepEqual(state.channels, [
    { id: 'messages', name: 'Messages', importance: 4, visibility: 0 },
    { id: 'payments', name: 'Payment received', importance: 4, visibility: 0 },
  ]);
  assert.deepEqual(
    state.posted.map(post => post.notifications[0].channelId),
    ['messages', 'messages', 'payments', 'payments'],
  );
});

test('a message channel is never named after a contact, and anything but messages means payments', async () => {
  const { service, state } = harness({ native: true });
  await service.notify({ title: 'Alice', channel: 'messages', force: true });
  assert.equal(state.channels[0].id, 'messages');
  assert.notEqual(state.channels[0].name, 'Alice', 'a contact name would stick as the channel name');
  assert.equal(state.channels[0].name, 'messages');

  await service.notify({ title: 'Payment received', channel: 'unknown', force: true });
  await service.notify({ title: 'Payment received', channel: 'constructor', force: true });
  assert.deepEqual(state.channels.map(channel => channel.id), ['messages', 'payments']);
  assert.deepEqual(
    state.posted.map(post => post.notifications[0].channelId),
    ['messages', 'payments', 'payments'],
  );
});

test('posts racing on a fresh install create each channel only once', async () => {
  const { service, state, plugin } = harness({ native: true });
  plugin.createChannel = async value => { await settle(); state.channels.push(value); };
  const results = await Promise.all([
    service.notify({ title: 'Alice', channel: 'messages', channelName: 'Messages', force: true }),
    service.notify({ title: 'Bob', channel: 'messages', channelName: 'Messages', force: true }),
    service.notify({ title: 'Payment received', force: true }),
    service.notify({ title: 'Payment received', force: true }),
  ]);
  assert.deepEqual(results, [true, true, true, true]);
  assert.deepEqual(state.channels.map(channel => channel.id).sort(), ['messages', 'payments']);
  assert.equal(state.posted.length, 4);
});

test('a channel that failed to create is retried on the next post, and the post still goes out', async () => {
  const { service, state, plugin } = harness({ native: true });
  let attempts = 0;
  plugin.createChannel = async value => {
    attempts++;
    if (attempts === 1) throw new Error('this build refuses channels');
    state.channels.push(value);
  };
  await quiet(async () => {
    assert.equal(await service.notify({ title: 'Payment received', force: true }), true);
  });
  assert.equal(state.posted.length, 1, 'posting anyway: not every OEM build needs the channel');
  assert.equal(await service.notify({ title: 'Payment received', force: true }), true);
  assert.equal(await service.notify({ title: 'Payment received', force: true }), true);
  assert.equal(attempts, 2, 'tried again once, then remembered');
  assert.equal(state.channels.length, 1);
  assert.equal(state.posted.length, 3);
});

// --- stable ids ------------------------------------------------------------

test('stableNotificationId is deterministic, 32-bit safe and inside its reserved window', () => {
  const { service } = harness();
  const key = 'chat:' + 'ab'.repeat(32);
  assert.equal(service.stableNotificationId(key), service.stableNotificationId(key));
  assert.equal(service.stableNotificationId(key), service.stableNotificationId(String(key)));
  // Pinned: changing the hash would orphan the ids of notifications still in
  // the shade across an app update, so it should be a deliberate act.
  assert.equal(service.stableNotificationId('chat:abc'), 1_713_917_725);
  assert.equal(service.stableNotificationId(key), 1_761_466_243);

  const ids = new Set();
  for (let i = 0; i < 500; i++) {
    const pubkey = createHash('sha256').update(`contact ${i}`).digest('hex');
    const id = service.stableNotificationId(`chat:${pubkey}`);
    assert.ok(Number.isInteger(id));
    assert.ok(id >= STABLE_IDS[0] && id <= STABLE_IDS[1], `${id} is outside the stable window`);
    assert.ok(id <= INT32_MAX, `${id} does not fit the 32-bit id of the plugin`);
    ids.add(id);
  }
  assert.equal(ids.size, 500, 'different chats get different ids');
});

test('stableNotificationId copes with odd keys instead of throwing', () => {
  const { service } = harness();
  for (const key of [undefined, null, '', 0, 42, {}, Symbol('chat'), 'chat:é🦉']) {
    const id = service.stableNotificationId(key);
    assert.ok(id >= STABLE_IDS[0] && id <= STABLE_IDS[1]);
  }
});

test('the stable window shares no id with payments or emergency-exit reminders', () => {
  assert.ok(PAYMENT_IDS[1] < STABLE_IDS[0]);
  // services/exitNotifications.js: UNLOCK_ID_BASE + (hash % 100000). Read from
  // its source so a change there has to come through here.
  const exit = readFileSync(new URL('../exitNotifications.js', import.meta.url), 'utf8');
  const base = Number(/UNLOCK_ID_BASE\s*=\s*([\d_]+)/.exec(exit)?.[1]?.replaceAll('_', ''));
  const span = Number(/UNLOCK_ID_BASE\s*\+\s*\(hash\s*%\s*([\d_]+)\)/.exec(exit)?.[1]?.replaceAll('_', ''));
  assert.ok(base > 0 && span > 0, 'could not read the emergency-exit id range; update this test with it');
  const exitRange = [base, base + span - 1];
  assert.ok(exitRange[1] < STABLE_IDS[0] && exitRange[0] > PAYMENT_IDS[1], `exit reminders ${exitRange} collide with another range`);
});

// --- extra data reaches the plugin -----------------------------------------

test('id, group and route reach the plugin, and a stable id leaves the rolling ids alone', async () => {
  const { service, state } = harness({ native: true });
  const id = service.stableNotificationId('chat:abc');
  const message = {
    title: 'Alice',
    body: 'Lunch?',
    channel: 'messages',
    channelName: 'Messages',
    id,
    group: 'chat:abc',
    route: '/address-book/abc/chat',
    force: true,
  };
  assert.equal(await service.notify(message), true);
  assert.deepEqual(state.posted[0], {
    notifications: [{
      id,
      title: 'Alice',
      body: 'Lunch?',
      channelId: 'messages',
      smallIcon: 'ic_stat_notification',
      isExactNotification: false,
      group: 'chat:abc',
      extra: { route: '/address-book/abc/chat' },
    }],
  });

  // Same chat again: the same id, so the plugin replaces the first one.
  assert.equal(await service.notify({ ...message, body: 'Lunch? I am outside' }), true);
  assert.equal(state.posted[1].notifications[0].id, id);

  // The rolling counter was not used up by either: payments still start at 41001.
  assert.equal(await service.notify({ title: 'Payment received', force: true }), true);
  assert.equal(state.posted[2].notifications[0].id, 41001);
});

test('an id, group or route of the wrong kind is ignored instead of failing the post', async () => {
  const { service, state } = harness();
  const badIds = [1.5, 2 ** 31, -(2 ** 31) - 1, '77', NaN, Infinity, null, {}];
  for (const id of badIds) {
    assert.equal(await service.notify({ title: 'Alice', id, group: '', route: '', force: true }), true);
  }
  assert.equal(await service.notify({ title: 'Alice', group: 42, route: 7, force: true }), true);
  const posted = state.posted.map(post => post.notifications[0]);
  assert.equal(posted.length, badIds.length + 1);
  posted.forEach((notification, index) => {
    assert.equal(notification.id, PAYMENT_IDS[0] + index + 1, 'fell back to the rolling window');
    assert.ok(!('group' in notification));
    assert.ok(!('extra' in notification));
  });

  // The edges of the 32-bit range are valid ids.
  await service.notify({ title: 'Alice', id: 2 ** 31 - 1, force: true });
  await service.notify({ title: 'Alice', id: -(2 ** 31), force: true });
  assert.deepEqual(state.posted.slice(-2).map(post => post.notifications[0].id), [2 ** 31 - 1, -(2 ** 31)]);
});

// --- route validation ------------------------------------------------------

test('isInternalRoute accepts in-app paths and nothing that could leave the app', () => {
  const { service } = harness();
  for (const route of ['/', '/wallet', '/address-book/abc/chat', '/address-book/abc/chat?from=notification', '/p/npub1xyz#top']) {
    assert.equal(service.isInternalRoute(route), true, route);
  }
  const rejected = [
    '', 'wallet', 'address-book/abc/chat', '//evil.example', '//', '/\\evil.example', '/\t/evil.example',
    '/wallet\n', '/wallet\u0000', '/wallet\u007f', 'https://evil.example', 'javascript:alert(1)', ' /wallet', '\\wallet',
    null, undefined, 42, {}, ['/wallet'], true,
  ];
  for (const route of rejected) {
    assert.equal(service.isInternalRoute(route), false, JSON.stringify(route));
  }
});

// --- taps ------------------------------------------------------------------

test('the tap listener is attached lazily, only where notifications exist', async () => {
  const supported = harness();
  await settle();
  assert.equal(supported.state.imports, 0, 'nothing is loaded before someone asks for taps');
  assert.equal(supported.state.listenerCalls, 0);

  const off = supported.service.onNotificationTap(() => {});
  await settle();
  assert.equal(supported.state.listenerCalls, 1, 'exactly one plugin listener');
  assert.equal(supported.state.listeners[0].event, 'localNotificationActionPerformed');
  assert.equal(supported.state.thenReads, 0);
  off();

  const unsupported = harness({ supported: false });
  const stop = unsupported.service.onNotificationTap(() => {});
  await settle();
  assert.equal(typeof stop, 'function');
  assert.equal(unsupported.state.imports, 0);
  assert.equal(unsupported.state.listenerCalls, 0);
  stop();
});

test('a tap reaches the handler with its route and extra data', async () => {
  const { service, state } = harness();
  const taps = [];
  service.onNotificationTap(event => taps.push(event));
  await settle();

  const extra = { route: '/address-book/abc/chat', chat: 'abc' };
  tap(state, { id: 1_000_000_007, title: 'Alice', body: 'Lunch?', extra });
  assert.deepEqual(taps, [{ route: '/address-book/abc/chat', extra }]);

  // A payment notification carries no extra data: the tap is still reported.
  tap(state, { id: 41001, title: 'Payment received', body: '100 sats' });
  assert.deepEqual(taps[1], { route: null, extra: {} });

  // Extra data that is not an object, or a route that is not a string, is not a route.
  tap(state, { id: 2, title: 'x', body: 'y', extra: 'oops' });
  tap(state, { id: 3, title: 'x', body: 'y', extra: ['/wallet'] });
  tap(state, { id: 4, title: 'x', body: 'y', extra: { route: 7 } });
  assert.deepEqual(taps.slice(2), [
    { route: null, extra: {} },
    { route: null, extra: {} },
    { route: null, extra: { route: 7 } },
  ]);

  // No notification at all (an event the plugin could not fill in).
  tap(state, undefined);
  assert.equal(taps.length, 6);
  assert.deepEqual(taps[5], { route: null, extra: {} });
});

test('a dismissal is not a tap', async () => {
  const { service, state } = harness();
  const taps = [];
  service.onNotificationTap(event => taps.push(event));
  await settle();
  tap(state, { id: 1, title: 'Alice', body: 'Hi', extra: { route: '/wallet' } }, 'dismiss');
  assert.deepEqual(taps, []);
});

test('unsubscribing stops the handler and removes the plugin listener', async () => {
  const { service, state } = harness();
  const taps = [];
  const off = service.onNotificationTap(event => taps.push(event));
  await settle();
  assert.equal(state.listeners.length, 1);

  off();
  await settle();
  assert.equal(state.listeners.length, 0);
  assert.equal(state.removed, 1);
  tap(state, { id: 1, title: 'Alice', body: 'Hi', extra: { route: '/wallet' } });
  assert.deepEqual(taps, []);

  off();
  await settle();
  assert.equal(state.removed, 1, 'a second call changes nothing');

  // Another subscription still works after the first one is gone.
  const later = [];
  service.onNotificationTap(event => later.push(event));
  await settle();
  tap(state, { id: 1, title: 'Alice', body: 'Hi', extra: { route: '/wallet' } });
  assert.equal(later.length, 1);
  assert.equal(taps.length, 0);
});

test('a listener the plugin fails to detach stays silent once unsubscribed', async () => {
  const { service, state, plugin } = harness();
  plugin.addListener = async (event, fn) => {
    state.listeners.push({ event, fn });
    return { remove: async () => { throw new Error('could not detach'); } };
  };
  const taps = [];
  const off = service.onNotificationTap(event => taps.push(event));
  await settle();
  tap(state, { id: 1, title: 'Alice', body: 'Hi', extra: { route: '/wallet' } });
  assert.equal(taps.length, 1);

  assert.doesNotThrow(off);
  await settle(); // a rejected remove() must not surface as an unhandled rejection
  assert.equal(state.listeners.length, 1, 'the plugin kept the listener');
  tap(state, { id: 1, title: 'Alice', body: 'Hi', extra: { route: '/wallet' } });
  assert.equal(taps.length, 1, 'but nothing reaches the handler any more');
});

test('unsubscribing before the listener is attached leaves no listener behind', async () => {
  // Right away: the plugin is never asked for a listener.
  const early = harness();
  early.service.onNotificationTap(() => {})();
  await settle();
  assert.equal(early.state.listenerCalls, 0);
  assert.equal(early.state.listeners.length, 0);

  // While the plugin is still registering it: the listener is removed as soon as it exists.
  const late = harness();
  let finishRegistering;
  late.plugin.addListener = (event, fn) => new Promise(resolve => {
    finishRegistering = () => {
      late.state.listenerCalls++;
      const entry = { event, fn };
      late.state.listeners.push(entry);
      resolve({
        remove: async () => {
          late.state.removed++;
          late.state.listeners = late.state.listeners.filter(item => item !== entry);
        },
      });
    };
  });
  const taps = [];
  const off = late.service.onNotificationTap(event => taps.push(event));
  await settle();
  off();
  finishRegistering();
  await settle();
  assert.equal(late.state.listeners.length, 0);
  assert.equal(late.state.removed, 1);
  assert.deepEqual(taps, []);
});

test('a failing handler or plugin never throws at the caller', async () => {
  await quiet(async () => {
    const { service, state } = harness();
    const heard = [];
    service.onNotificationTap(() => { throw new Error('handler blew up'); });
    service.onNotificationTap(event => { heard.push(event); return Promise.reject(new Error('async handler blew up')); });
    await settle();
    assert.doesNotThrow(() => tap(state, { id: 1, title: 'Alice', body: 'Hi', extra: { route: '/wallet' } }));
    await settle(); // an unhandled rejection would fail the run here
    assert.equal(heard.length, 1, 'one handler failing does not silence the other');

    const broken = harness();
    broken.plugin.addListener = async () => { throw new Error('listener refused'); };
    const off = broken.service.onNotificationTap(() => {});
    await settle();
    assert.doesNotThrow(off);

    const notAHandler = harness();
    assert.doesNotThrow(() => notAHandler.service.onNotificationTap(undefined)());
    assert.doesNotThrow(() => notAHandler.service.onNotificationTap('/wallet')());
    await settle();
    assert.equal(notAHandler.state.listenerCalls, 0);
  });
});

// --- against the real plugin (web) -----------------------------------------

test('with the real web plugin a stable id replaces the notification and a click reports its route', async () => {
  class FakeNotification {
    static permission = 'granted';
    static instances = [];
    static requestPermission() { return Promise.resolve('granted'); }
    constructor(title, options) {
      this.title = title;
      this.body = options?.body;
      this.tag = options?.tag;
      this.handlers = {};
      FakeNotification.instances.push(this);
    }
    addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
    close() {}
    click() { (this.handlers.click || []).forEach(handler => handler({})); }
  }
  globalThis.Notification = FakeNotification;
  try {
    const { LocalNotifications } = createRequire(import.meta.url)('@capacitor/local-notifications');
    globalThis.window = { Notification: FakeNotification };
    const { service } = harness({ realPlugin: LocalNotifications });
    globalThis.window = { Notification: FakeNotification }; // harness() resets it
    const taps = [];
    const off = service.onNotificationTap(event => taps.push(event));
    await settle();

    const id = service.stableNotificationId('chat:abc');
    const route = '/address-book/abc/chat';
    assert.equal(await service.notify({ title: 'Alice', body: 'Hi', channel: 'messages', id, group: 'chat:abc', route, force: true }), true);
    assert.equal(await service.notify({ title: 'Alice', body: 'Hi again', channel: 'messages', id, group: 'chat:abc', route, force: true }), true);
    assert.equal(await service.notify({ title: 'Payment received', body: '100 sats', force: true }), true);

    const [first, second, payment] = FakeNotification.instances;
    assert.equal(first.tag, String(id));
    assert.equal(second.tag, String(id), 'the browser replaces a notification with the same tag');
    assert.notEqual(payment.tag, String(id));

    second.click();
    payment.click();
    assert.deepEqual(taps, [
      { route, extra: { route } },
      { route: null, extra: {} },
    ]);

    off();
    await settle();
    second.click();
    assert.equal(taps.length, 2, 'after unsubscribing a click is not reported');
  } finally {
    delete globalThis.Notification;
  }
});
