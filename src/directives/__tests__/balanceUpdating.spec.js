import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import balanceUpdating from '../balanceUpdating.js';

let reducedMotion = false;
beforeEach(() => {
  reducedMotion = false;
  globalThis.window = { matchMedia: () => ({ matches: reducedMotion }) };
  globalThis.getComputedStyle = el => ({ opacity: el.opacity });
});

/** An element whose animations are recorded; `opacity` is what the pulse shows now. */
function element() {
  const animations = [];
  return {
    opacity: '1',
    animations,
    animate(frames, timing) {
      const animation = { frames, timing, cancelled: false, cancel() { this.cancelled = true; } };
      animations.push(animation);
      return animation;
    },
  };
}

test('a figure the app is confirming pulses, and eases back to full strength once confirmed', () => {
  const el = element();
  balanceUpdating.mounted(el, { value: true });
  balanceUpdating.updated(el, { value: true });
  assert.equal(el.animations.length, 1, 'one pulse across re-renders');
  const [pulse] = el.animations;
  assert.equal(pulse.timing.iterations, Infinity);
  assert.ok(Math.min(...pulse.frames.map(f => f.opacity)) < 1);

  el.opacity = '0.62';
  balanceUpdating.updated(el, { value: false });
  assert.equal(pulse.cancelled, true);
  assert.deepEqual(el.animations[1].frames, [{ opacity: 0.62 }, { opacity: 1 }], 'from where the pulse was, not a snap');

  balanceUpdating.updated(el, { value: false });
  assert.equal(el.animations.length, 2);
});

test('a confirmed figure never animates', () => {
  const el = element();
  balanceUpdating.mounted(el, { value: false });
  balanceUpdating.updated(el, { value: false });
  assert.deepEqual(el.animations, []);
});

test('a pulse that stops at full strength needs no easing back', () => {
  const el = element();
  balanceUpdating.mounted(el, { value: true });
  balanceUpdating.updated(el, { value: false });
  assert.equal(el.animations.length, 1);
  assert.equal(el.animations[0].cancelled, true);
});

test('with reduced motion the figure is dimmed, not animated', () => {
  reducedMotion = true;
  const el = element();
  balanceUpdating.mounted(el, { value: true });
  const opacities = new Set(el.animations[0].frames.map(f => f.opacity));
  assert.equal(opacities.size, 1);
  assert.ok([...opacities][0] < 1);
});

test('unmounting ends the pulse', () => {
  const el = element();
  balanceUpdating.mounted(el, { value: true });
  balanceUpdating.unmounted(el);
  assert.equal(el.animations[0].cancelled, true);
});

test('without the animation API the figure is shown as is', () => {
  const el = { opacity: '1' };
  assert.doesNotThrow(() => {
    balanceUpdating.mounted(el, { value: true });
    balanceUpdating.updated(el, { value: false });
    balanceUpdating.unmounted(el);
  });
});
