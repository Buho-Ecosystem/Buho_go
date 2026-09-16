import test from 'node:test'
import assert from 'node:assert/strict'
import { reloadPwa } from '../pwaReload.js'

/**
 * A fake ServiceWorkerContainer: enough surface for reloadPwa to promote a
 * waiting worker and observe the takeover.
 */
function fakeContainer({ registration } = {}) {
  const listeners = new Map()
  return {
    messages: [],
    getRegistration: async () => registration,
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) || []), fn])
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter(l => l !== fn))
    },
    dispatch(type) {
      for (const fn of listeners.get(type) || []) fn()
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length
    },
  }
}

function fakeWaiting(container) {
  return {
    postMessage(message) {
      container.messages.push(message)
    },
  }
}

test('no service worker support falls back to a plain reload', async () => {
  let reloads = 0
  await reloadPwa({ serviceWorker: undefined, reload: () => { reloads += 1 } })
  assert.equal(reloads, 1)
})

test('a failing getRegistration falls back to a plain reload', async () => {
  let reloads = 0
  const serviceWorker = { getRegistration: async () => { throw new Error('denied') } }
  await reloadPwa({ serviceWorker, reload: () => { reloads += 1 } })
  assert.equal(reloads, 1)
})

test('no waiting worker reloads without messaging anything', async () => {
  let reloads = 0
  const container = fakeContainer({ registration: { waiting: null } })
  await reloadPwa({ serviceWorker: container, reload: () => { reloads += 1 } })
  assert.equal(reloads, 1)
  assert.deepEqual(container.messages, [])
})

test('a waiting worker is promoted and the reload waits for takeover', async () => {
  let reloads = 0
  const container = fakeContainer()
  const registration = { waiting: fakeWaiting(container) }
  container.getRegistration = async () => registration

  // Takeover arrives shortly after the promotion message.
  const run = reloadPwa({
    serviceWorker: container,
    reload: () => { reloads += 1 },
    timeoutMs: 5000,
  })
  // The message must be sent, and nothing reloaded yet.
  await Promise.resolve()
  assert.deepEqual(container.messages, [{ type: 'SKIP_WAITING' }])
  assert.equal(reloads, 0)

  container.dispatch('controllerchange')
  await run
  assert.equal(reloads, 1)
  // The listener is cleaned up, and a late duplicate event changes nothing.
  assert.equal(container.listenerCount('controllerchange'), 0)
  container.dispatch('controllerchange')
  assert.equal(reloads, 1)
})

test('a takeover that never arrives still reloads after the timeout', async () => {
  let reloads = 0
  const container = fakeContainer()
  const registration = { waiting: fakeWaiting(container) }
  container.getRegistration = async () => registration

  await reloadPwa({
    serviceWorker: container,
    reload: () => { reloads += 1 },
    timeoutMs: 20,
  })
  assert.equal(reloads, 1)
  assert.equal(container.listenerCount('controllerchange'), 0)
})

test('a postMessage failure reloads immediately instead of hanging', async () => {
  let reloads = 0
  const container = fakeContainer()
  const registration = { waiting: { postMessage() { throw new Error('worker gone') } } }
  container.getRegistration = async () => registration

  await reloadPwa({
    serviceWorker: container,
    reload: () => { reloads += 1 },
    timeoutMs: 5000,
  })
  assert.equal(reloads, 1)
})
