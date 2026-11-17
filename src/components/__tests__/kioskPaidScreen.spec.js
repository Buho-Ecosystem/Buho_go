/** When the register's paid screen goes back to the register: a paid sale must be seen before it goes. */
import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const script = readFileSync(new URL('../kiosk/KioskPaidScreen.vue', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
const module = { exports: {} }
new Function('require', 'module', 'exports', transformSync(script, { format: 'cjs' }).code)(() => ({}), module, module.exports)
const { default: screen, KIOSK_PAID_SCREEN_MS, KIOSK_PAID_TAP_AFTER_MS } = module.exports

const page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
globalThis.document = page
const showPage = visibilityState => {
  page.visibilityState = visibilityState
  page.dispatchEvent(new Event('visibilitychange'))
}

function mounted(props = {}) {
  const emitted = []
  const focused = []
  const $el = { focus: options => focused.push(options) }
  const vm = { amount: '$15.50', secondary: '', duplicate: false, paused: false, origin: null, ...props, $el, $refs: {} }
  Object.assign(vm, screen.data.call(vm), { $t: key => key, $emit: event => emitted.push(event) })
  for (const [key, method] of Object.entries(screen.methods)) vm[key] = method.bind(vm)
  for (const [key, compute] of Object.entries(screen.computed)) Object.defineProperty(vm, key, { get: () => compute.call(vm) })
  // Stands in for Vue's watcher: whatever changes, the wait follows `counting`.
  const change = update => {
    const before = vm.counting
    update()
    if (vm.counting !== before) screen.watch.counting.call(vm)
  }
  screen.mounted.call(vm)
  return { vm, emitted, focused, change, unmount: () => screen.beforeUnmount.call(vm) }
}
const press = (vm, target = vm.tapAnywhere) => {
  vm.pressed()
  target({ detail: 1 })
}

test('the paid screen goes back after ten seconds on screen, and waits for the receipt, a sleeping phone and a second payment', ctx => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  ctx.after(() => mock.timers.reset())
  assert.equal(KIOSK_PAID_SCREEN_MS, 10_000)

  const plain = mounted()
  mock.timers.tick(9_999)
  assert.deepEqual(plain.emitted, [])
  mock.timers.tick(1)
  assert.deepEqual(plain.emitted, ['done'])
  plain.unmount()

  const receipt = mounted()
  mock.timers.tick(6_000)
  receipt.change(() => (receipt.vm.paused = true))
  mock.timers.tick(30_000)
  assert.deepEqual(receipt.emitted, [], 'the receipt is open')
  receipt.change(() => (receipt.vm.paused = false))
  mock.timers.tick(9_999)
  assert.deepEqual(receipt.emitted, [], 'the full wait starts again once it closes')
  mock.timers.tick(1)
  assert.deepEqual(receipt.emitted, ['done'])
  receipt.unmount()

  // Paid while the phone screen was off: the sale is still there when it wakes.
  showPage('hidden')
  const asleep = mounted()
  mock.timers.tick(60_000)
  assert.deepEqual(asleep.emitted, [], 'nobody saw it yet')
  asleep.change(() => showPage('visible'))
  mock.timers.tick(9_999)
  assert.deepEqual(asleep.emitted, [])
  asleep.change(() => showPage('hidden'))
  mock.timers.tick(60_000)
  assert.deepEqual(asleep.emitted, [], 'the screen went off again before the wait was over')
  asleep.change(() => showPage('visible'))
  mock.timers.tick(KIOSK_PAID_SCREEN_MS)
  assert.deepEqual(asleep.emitted, ['done'])
  asleep.unmount()

  const twice = mounted()
  twice.change(() => (twice.vm.duplicate = true))
  mock.timers.tick(60_000)
  assert.deepEqual(twice.emitted, [], 'the warning stays until New charge')
  twice.unmount()
})

test('the paid screen takes focus itself, so it is read out and a stray key cannot end it unseen', ctx => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  ctx.after(() => mock.timers.reset())
  const paid = mounted()
  assert.deepEqual(paid.focused, [{ preventScroll: true }], 'the screen, not New charge')
  paid.unmount()
})

test('only a tap that begins on the paid screen ends it, and a second payment needs New charge', ctx => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  ctx.after(() => mock.timers.reset())

  // A finger already down when the sale was paid lifts onto the new screen.
  const held = mounted()
  mock.timers.tick(2_000)
  held.vm.tapAnywhere({ detail: 1 })
  assert.deepEqual(held.emitted, [], 'the press began on the payment code')
  assert.equal(held.vm.began({ detail: 1 }), false, 'nor does it press New charge')
  press(held.vm)
  assert.deepEqual(held.emitted, ['done'])
  held.unmount()

  const early = mounted()
  mock.timers.tick(KIOSK_PAID_TAP_AFTER_MS - 1)
  press(early.vm)
  assert.deepEqual(early.emitted, [], 'the amount has not landed yet')
  mock.timers.tick(1)
  press(early.vm)
  assert.deepEqual(early.emitted, ['done'])
  early.unmount()

  const twice = mounted({ duplicate: true })
  mock.timers.tick(5_000)
  press(twice.vm)
  assert.deepEqual(twice.emitted, [], 'a stray tap cannot clear the warning')
  assert.equal(twice.vm.began({ detail: 0 }), true, 'New charge from the keyboard')
  assert.equal(twice.vm.began({ detail: 1 }), true, 'New charge pressed on this screen')
  twice.unmount()
})
