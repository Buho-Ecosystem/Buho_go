import { BRANTA_ENVIRONMENT, BRANTA_STATUS, BRANTA_HOLD_MS, BRANTA_LOOKUP_TIMEOUT_MS, BRANTA_MAX_AGE_MS, checkWithBranta, normalizeBrantaResult } from '../utils/branta.js'

/** One original payment request; changing its selected route never clears a tamper result. */
export function createBrantaVerification({ verify = checkWithBranta, environment = BRANTA_ENVIRONMENT, now = Date.now, holdMs = BRANTA_HOLD_MS, timeoutMs = BRANTA_LOOKUP_TIMEOUT_MS, onChange = () => {} } = {}) {
  let generation = 0, binding = 0, original = '', startedAt = 0, controller, deadline, releaseCancel, task
  let raw = null, pending = false, tampered = false, settledKey = null, settledView = null, invalidated = false
  let view = { status: BRANTA_STATUS.NONE }
  const publish = value => { view = value; onChange(value); return value }
  function stop() {
    generation += 1; binding += 1
    controller?.abort(); clearTimeout(deadline); releaseCancel?.()
    controller = null; task = null; releaseCancel = null; pending = false
  }
  function start(input, fresh = false) {
    if (original === input && tampered) return
    stop(); original = input; startedAt = now(); raw = null; settledKey = null; settledView = null; invalidated = false
    if (!original) return
    controller = new AbortController()
    const signal = controller.signal, ticket = generation, request = original
    pending = true
    const lookup = Promise.resolve().then(() => verify({ qrText: request, signal, environment, fresh })).then(result => {
      if (ticket !== generation || signal.aborted) return
      raw = { ...result, checkedAt: Number.isFinite(result?.checkedAt) ? result.checkedAt : now() }
      if (result?.status === 'tampered') { tampered = true; publish({ status: BRANTA_STATUS.TAMPERED }) }
    }).catch(() => { if (ticket === generation) raw = { status: 'unknown' } })
    const timeout = new Promise(resolve => {
      deadline = setTimeout(() => { if (ticket === generation) { raw = { status: 'unknown' }; controller?.abort() }; resolve() }, timeoutMs)
    })
    const cancelled = new Promise(resolve => { releaseCancel = resolve })
    task = Promise.race([lookup, timeout, cancelled]).then(() => {
      if (ticket === generation) { pending = false; clearTimeout(deadline); releaseCancel = null }
    })
  }
  return {
    start(input) { if (input !== original) { tampered = false; start(input) } },
    cancel() { stop(); original = ''; raw = null; tampered = false; settledKey = null; settledView = null },
    stale() { invalidated = true },
    get tampered() { return tampered },
    get original() { return original },
    async bind(target, context, { refresh = false } = {}) {
      if (tampered) return publish({ status: BRANTA_STATUS.TAMPERED })
      if (!original) return publish({ status: BRANTA_STATUS.NONE })
      const expired = view.verification?.expiresAt && view.verification.expiresAt <= now()
      if (refresh && (invalidated || now() - (raw?.checkedAt ?? startedAt) >= BRANTA_MAX_AGE_MS || expired)) start(original, true)
      const key = JSON.stringify([context, target?.kind || '', target?.value || ''])
      const ticket = generation, selected = ++binding
      // A late normal response cannot replace the identity already shown for this binding.
      // Returning to a settled route also invalidates any intervening wait.
      if (key === settledKey && !refresh) return publish(settledView)
      if (pending) {
        publish({ status: BRANTA_STATUS.CHECKING })
        let foreground
        try { await Promise.race([task, new Promise(resolve => { foreground = setTimeout(resolve, holdMs) })]) }
        finally { clearTimeout(foreground) }
      }
      if (ticket !== generation || selected !== binding) return { status: BRANTA_STATUS.NONE }
      settledKey = key
      if (tampered) return publish({ status: BRANTA_STATUS.TAMPERED })
      const verification = pending ? null : normalizeBrantaResult(raw, target, { environment, now: now(), checkedAt: raw?.checkedAt ?? now() })
      settledView = verification ? { status: BRANTA_STATUS.VERIFIED, verification } : { status: BRANTA_STATUS.NONE }
      return publish(settledView)
    },
  }
}
