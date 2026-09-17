/**
 * Applying a web update.
 *
 * The service worker does not call skipWaiting() on install (see
 * src-pwa/custom-service-worker.js), so when an update is ready the new
 * worker is parked in the `waiting` state and the old one still controls the
 * page. A plain reload at that moment would be answered by the old worker
 * and serve the same old build again.
 *
 * Applying the update therefore means: promote the waiting worker with the
 * SKIP_WAITING message, wait for it to take control (`controllerchange`,
 * which fires because the worker calls clientsClaim()), and reload then.
 *
 * Every fallback lands on a plain reload, which is never worse than what the
 * user asked for:
 *   - no service worker support, or no registration: nothing to promote
 *   - no waiting worker: another tab already promoted it, or the ready flag
 *     outlived the worker; the reload picks up whatever is current
 *   - takeover does not arrive in time: reload anyway rather than hang the
 *     update button; the readiness flag survives, so the update stays offered
 *
 * Dependencies are injectable for tests; callers use the defaults.
 */

const TAKEOVER_TIMEOUT_MS = 4000

export async function reloadPwa({
  serviceWorker = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
  reload = () => window.location.reload(),
  timeoutMs = TAKEOVER_TIMEOUT_MS,
} = {}) {
  let registration = null
  if (serviceWorker?.getRegistration) {
    try {
      registration = await serviceWorker.getRegistration()
    } catch {
      // A detached or restricted context; treat as no registration.
    }
  }

  const waiting = registration?.waiting
  if (!waiting) {
    reload()
    return
  }

  await new Promise(resolve => {
    let settled = false
    let timer = null

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (typeof serviceWorker.removeEventListener === 'function') {
        serviceWorker.removeEventListener('controllerchange', finish)
      }
      reload()
      resolve()
    }

    // Listen before messaging so a fast takeover cannot slip past.
    if (typeof serviceWorker.addEventListener === 'function') {
      serviceWorker.addEventListener('controllerchange', finish)
    }
    timer = setTimeout(finish, timeoutMs)

    try {
      waiting.postMessage({ type: 'SKIP_WAITING' })
    } catch {
      finish()
    }
  })
}
