import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToastController } from '../toastController.js';

function harness() {
  let now = 0, serial = 0, items = [];
  const timers = new Map();
  const controller = createToastController({
    now: () => now, onChange: value => { items = value; },
    setTimer: (fn, ms) => { const id = ++serial; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: id => timers.delete(id),
  });
  const advance = ms => {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  };
  return { ...controller, advance, get items() { return items; }, get timers() { return timers.size; } };
}

test('preserves existing default duration and calls dismissal exactly once', () => {
  const h = harness(); let calls = 0;
  const close = h.notify({ message: 'Copied', onDismiss: () => calls++ });
  h.advance(3499); assert.equal(h.items.length, 1);
  h.advance(1); assert.equal(h.items.length, 0);
  close(); assert.equal(calls, 1); assert.equal(h.timers, 0);
});

test('holding pauses remaining time; overlapping focus and hover must both release', () => {
  const h = harness(); h.notify('Copied'); const id = h.items[0].id;
  h.advance(2000); h.pause(id, 'pointer'); h.pause(id, 'focus');
  h.advance(10000); assert.equal(h.items[0].remaining, 1500);
  h.resume(id, 'pointer'); h.advance(10000); assert.equal(h.items.length, 1);
  h.resume(id, 'focus'); h.advance(1499); assert.equal(h.items.length, 1);
  h.advance(1); assert.equal(h.items.length, 0);
});

test('backgrounding pauses existing and newly created notices', () => {
  const h = harness(); h.notify('First'); h.advance(500); h.pauseAll('hidden');
  h.notify('Second'); h.advance(20000); assert.equal(h.items.length, 2);
  h.resumeAll('hidden'); h.advance(3000); assert.equal(h.items[0].config.message, 'Second');
  h.advance(500); assert.equal(h.items.length, 0);
});

test('duplicates reuse a card and reset its duration without releasing a held gesture', () => {
  const h = harness(); const first = h.notify('Copied'); const id = h.items[0].id;
  h.advance(3000); h.pause(id, 'pointer'); h.notify('Copied');
  assert.equal(h.items.length, 1); assert.equal(h.items[0].count, 2);
  assert.equal(h.items[0].id, id); assert.equal(h.items[0].running, false);
  h.advance(5000); h.resume(id, 'pointer'); h.advance(3499); assert.equal(h.items.length, 1);
  first(); assert.equal(h.items.length, 0); h.advance(1); assert.equal(h.timers, 0);
});

test('grouping keeps different positions and actions separate', () => {
  const h = harness();
  h.notify({ message: 'Copied', position: 'top' });
  h.notify({ message: 'Copied', position: 'bottom' });
  h.notify({ message: 'Copied', position: 'top', actions: [{ label: 'View' }] });
  h.notify({ message: 'Copied', position: 'top', group: false });
  assert.equal(h.items.length, 4);
});

test('explicit group replaces content and uses the latest action', () => {
  const h = harness(); const calls = [];
  h.notify({ group: 'request', message: 'Before', actions: [{ label: 'View', handler: () => calls.push('old') }] });
  h.notify({ group: 'request', message: 'After', actions: [{ label: 'View', handler: () => calls.push('new') }] });
  assert.equal(h.items.length, 1); assert.equal(h.items[0].config.message, 'After');
  h.act(h.items[0].id, 0); assert.deepEqual(calls, ['new']); assert.equal(h.items.length, 0);
});

test('persistent progress updates in place and cannot resurrect after dismissal', () => {
  const h = harness(); let calls = 0;
  const update = h.notify({ type: 'ongoing', message: 'Submitted', onDismiss: () => calls++ });
  const id = h.items[0].id;
  h.advance(60000); assert.equal(h.items.length, 1); assert.equal(h.timers, 0);
  update({ type: 'positive', message: 'Broadcast', timeout: 2000, spinner: false });
  assert.equal(h.items[0].id, id); assert.equal(h.items[0].config.message, 'Broadcast');
  update(); update({ message: 'Late completion' });
  assert.equal(h.items.length, 0); assert.equal(calls, 1); assert.equal(h.timers, 0);
});

test('an update during drag stays paused with the new lifetime', () => {
  const h = harness(); const update = h.notify({ group: false, message: 'Before' });
  const id = h.items[0].id; h.pause(id, 'pointer');
  update({ message: 'After', timeout: 5000 });
  h.advance(10000); assert.equal(h.items[0].remaining, 6000);
  h.resume(id, 'pointer'); h.advance(6000); assert.equal(h.items.length, 0);
});

test('noDismiss actions and disabled actions retain their semantics', () => {
  const h = harness(); let calls = 0;
  h.notify({ message: 'Try', actions: [{ label: 'Copy', noDismiss: true, handler: () => calls++ }, { label: 'Disabled', disable: true, handler: () => calls++ }] });
  const id = h.items[0].id;
  h.act(id, 1); assert.equal(calls, 0);
  h.act(id, 0); assert.equal(calls, 1); assert.equal(h.items.length, 1);
  h.dismiss(id); h.act(id, 0); assert.equal(calls, 1);
});

test('an action that creates another toast dismisses only its own card', () => {
  const h = harness();
  h.notify({ message: 'Address', actions: [{ label: 'Copy', handler: () => h.notify('Copied') }] });
  h.act(h.items[0].id, 0);
  assert.equal(h.items.length, 1); assert.equal(h.items[0].config.message, 'Copied');
});

test('dismissal only hides progress; the background operation remains independent', async () => {
  const h = harness(); let complete;
  const operation = new Promise(resolve => { complete = resolve; });
  const close = h.notify({ type: 'ongoing', message: 'Submitted' });
  close(); assert.equal(h.items.length, 0);
  complete('broadcast'); assert.equal(await operation, 'broadcast');
});

test('defaults and custom types apply through the compatibility API', () => {
  const h = harness();
  h.notify.setDefaults({ timeout: 1000, position: 'top' });
  h.notify.registerType('saved', { icon: 'save', color: 'positive' });
  h.notify({ type: 'saved', message: 'Saved' });
  assert.equal(h.items[0].config.icon, 'save'); assert.equal(h.items[0].config.position, 'top');
  h.advance(2000); assert.equal(h.items.length, 0);
});
