import { isShareableLightningAddress } from './lud23.js';

export function addressRequestState() {
  return { stage: 'idle', presented: false, request: null, snapshot: null, error: '', available: false };
}

/** Framework-independent consent lifecycle. Only approve() can submit.
 * The caller supplies reactive state and live identity/visibility guards. */
export function createAddressRequestSession({ state, resolve, submit, prepare, snapshot, allowed }) {
  let generation = 0;
  let input = null;
  let abort = null;
  const submitted = new Set();
  const same = (a, b) => a?.identity === b?.identity && a?.address === b?.address;
  const active = () => state.stage !== 'idle';
  const key = request => `${new URL(request.callback).origin}\n${request.k1.toLowerCase()}`;

  function close() {
    generation++;
    abort?.abort();
    abort = null;
    input = null;
    Object.assign(state, { stage: 'idle', request: null, snapshot: null, error: '' });
  }

  function open(value) {
    if (!allowed()) return 'blocked';
    if (active()) return input === value ? 'duplicate' : 'busy';
    input = value;
    state.stage = 'waiting';
    state.error = '';
    return 'opened';
  }

  function setReview() {
    const current = snapshot();
    state.snapshot = current;
    state.stage = current?.identity && isShareableLightningAddress(current.address) ? 'review' : 'needsAddress';
  }

  async function resume({ fromSetup = false } = {}) {
    if (fromSetup && state.stage === 'setup') state.stage = 'waiting';
    if (!state.available || !allowed() || state.stage !== 'waiting') return;
    const token = ++generation;
    state.stage = 'resolving';
    abort = new AbortController();
    try {
      await prepare();
      if (token !== generation) return;
      if (!allowed()) { close(); return; }
      const before = snapshot();
      const request = state.request || await resolve(input, { signal: abort.signal });
      if (token !== generation) return;
      if (!allowed()) { close(); return; }
      state.request = request;
      if (submitted.has(key(request))) {
        state.stage = 'error';
        state.error = 'ADDRESS_REQUEST_ALREADY_SUBMITTED';
      } else if (!same(before, snapshot())) {
        state.stage = 'changed';
      } else setReview();
    } catch (error) {
      if (token !== generation) return;
      state.stage = 'error';
      state.error = error.code || 'ADDRESS_REQUEST_UNREACHABLE';
    }
  }

  function identityChanged() {
    if (!active() || ['waiting', 'setup', 'resolving'].includes(state.stage)) return;
    if (same(state.snapshot, snapshot())) return;
    if (['submitting', 'confirmed', 'rejected', 'unknown'].includes(state.stage)) { close(); return; }
    if (['review', 'needsAddress'].includes(state.stage)) state.stage = 'changed';
  }

  async function approve() {
    if (state.stage !== 'review' || !state.available || !allowed()) return;
    if (!same(state.snapshot, snapshot())) { state.stage = 'changed'; return; }
    const request = state.request;
    const address = state.snapshot.address;
    const requestKey = key(request);
    if (submitted.has(requestKey)) return;
    // Mark synchronously before yielding: even duplicate native delivery or
    // closing/reopening the sheet must not repeat a single-use submission.
    submitted.add(requestKey);
    const token = ++generation;
    state.stage = 'submitting';
    let outcome;
    try { outcome = await submit(request, address); } catch { outcome = 'unknown'; }
    if (token === generation) state.stage = outcome;
  }

  function setup() {
    if (state.stage !== 'needsAddress') return;
    generation++;
    abort?.abort();
    state.stage = 'setup';
  }

  async function review() {
    if (state.stage !== 'changed' || !state.available || !allowed()) return;
    state.stage = 'waiting';
    await resume();
  }

  async function retry() {
    // Metadata is safe to retry before consent. Submission outcomes and spent
    // challenges never enter this path.
    if (state.stage !== 'error' || state.error !== 'ADDRESS_REQUEST_UNREACHABLE') return;
    state.error = '';
    state.stage = 'waiting';
    await resume();
  }

  return { open, close, resume, approve, identityChanged, review, setup, retry };
}
