import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const source = readFileSync(new URL('../ContactPaymentHost.vue', import.meta.url), 'utf8')
const setup = source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
const { code } = transformSync(setup, { format: 'cjs' })

function harness({ suspended = false, stage = 'ready' } = {}) {
  const watches = []
  const cancelled = []
  const props = { suspended }
  const route = { fullPath: '/contact/alice' }
  const identity = { nostrPubkeyHex: 'identity-a' }
  const wallets = { kioskEnabled: false }
  const flow = {
    intent: { id: 1 }, stage,
    get committed() { return ['sending', 'complete'].includes(this.stage) },
    cancel(id = this.intent?.id) {
      if (this.intent?.id !== id || this.committed) return false
      cancelled.push(id)
      this.intent = null
      this.stage = 'idle'
      return true
    },
  }
  const dependencies = {
    vue: { watch(read, callback, options) {
      const initial = read()
      watches.push({ read, callback, last: initial })
      if (options?.immediate) callback(initial)
    } },
    'vue-router': { useRoute: () => route },
    '../stores/paymentFlow.js': { usePaymentFlowStore: () => flow },
    '../stores/identity.js': { useIdentityStore: () => identity },
    '../stores/wallet.js': { useWalletStore: () => wallets },
  }
  new Function('require', 'defineProps', code)(name => dependencies[name] || {}, () => props)
  // Drive the synchronous production watch callbacks until changes settle.
  const flush = () => {
    let changed = true, runs = 0
    while (changed && runs++ < 20) {
      changed = false
      for (const watcher of watches) {
        const next = watcher.read()
        if (Object.is(next, watcher.last)) continue
        const before = watcher.last
        watcher.last = next
        watcher.callback(next, before)
        changed = true
      }
    }
    assert.ok(runs < 20, 'watch callbacks settle without a loop')
  }
  return { flow, route, identity, props, wallets, cancelled, flush }
}

test('ready preparation is cancelled when route, identity or lock context changes', () => {
  for (const change of [
    h => { h.route.fullPath = '/wallet' },
    h => { h.identity.nostrPubkeyHex = 'identity-b' },
    h => { h.props.suspended = true },
    h => { h.wallets.kioskEnabled = true },
  ]) {
    const h = harness()
    change(h)
    h.flush()
    assert.equal(h.flow.intent, null)
    assert.deepEqual(h.cancelled, [1])
  }
})

test('a committed payment continues, but an invalidated failed send cannot become retryable', () => {
  for (const invalidation of [
    h => { h.route.fullPath = '/wallet' },
    h => { h.identity.nostrPubkeyHex = 'identity-b' },
    h => { h.props.suspended = true },
  ]) {
    const h = harness({ stage: 'sending' })
    invalidation(h)
    h.flush()
    assert.equal(h.flow.intent.id, 1, 'never tear down an in-flight debit')
    h.flow.stage = 'ready'
    h.flush()
    assert.equal(h.flow.intent, null, 'the original invalidation survives the send')
    assert.deepEqual(h.cancelled, [1])
  }
})

test('success and its Save to Contacts phase keep the committed controller until explicit finish', () => {
  const h = harness({ stage: 'sending' })
  h.route.fullPath = '/wallet'
  h.flush()
  h.flow.stage = 'complete'
  h.flush()
  assert.equal(h.flow.intent.id, 1)
  assert.deepEqual(h.cancelled, [])
})

test('unlocking does not revive an invalidated send, and a new lease does not inherit invalidation', () => {
  const h = harness({ stage: 'sending' })
  h.props.suspended = true
  h.flush()
  h.props.suspended = false
  h.flush()
  h.flow.stage = 'ready'
  h.flush()
  assert.equal(h.flow.intent, null)
  h.flow.intent = { id: 2 }
  h.flow.stage = 'preparing'
  h.flush()
  h.flow.stage = 'ready'
  h.flush()
  assert.equal(h.flow.intent.id, 2)
})

test('a new intent is immediately cancelled while lock or kiosk suspension is active', () => {
  const h = harness({ suspended: true })
  assert.equal(h.flow.intent, null)
  h.flow.intent = { id: 2 }
  h.flow.stage = 'preparing'
  h.flush()
  assert.equal(h.flow.intent, null)
  assert.deepEqual(h.cancelled, [1, 2])
})
