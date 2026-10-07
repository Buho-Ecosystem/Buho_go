import { watch } from 'vue';
import { CLAIM_STATUS, reconcileProfileUsername, settlePendingClaim } from './usernameClaim.js';

/**
 * One lifecycle for public metadata: recover, finish purchases, then publish.
 * Stores own durable work; this coordinator owns only listeners and retry timers.
 */
export function startProfileSync({
  identity, profile, onClaim = () => {},
  window: win = globalThis.window, document: doc = globalThis.document,
  setTimer = setTimeout, clearTimer = clearTimeout,
  claimApi, publishOptions, recoveryOptions,
}) {
  let stopped = false;
  let timer = null;
  let running = false;
  let trailing = false;
  let recover = true;
  let retryMs = 2000;
  const available = () => win?.navigator?.onLine !== false && doc?.visibilityState !== 'hidden';

  function schedule(ms) {
    if (stopped || !available()) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; return run(); }, ms);
  }

  function wake({ recovery = false } = {}) {
    if (stopped) return;
    recover ||= recovery;
    retryMs = 2000;
    if (running) trailing = true;
    else schedule(0);
  }

  async function run() {
    if (stopped || running || !available()) return;
    running = true;
    let retry = false;
    try {
      await identity.hydrate();
      if (!identity.bootstrapped || stopped) return;
      if (!identity.nostrPubkeyHex) await identity.loadNostrIdentity();
      if (!identity.nostrPubkeyHex || stopped) return;
      await profile.hydrate();
      const scope = profile.captureSession();
      const current = () => !stopped && scope.current();
      if (recover) {
        recover = false;
        const result = await profile.recoverFromNostr({ identityStore: identity, ...recoveryOptions });
        if (!current()) return;
        if (!result.ok || result.reason === 'local-changed' || !result.hadRemote && !result.reason) {
          recover = true;
          retry = true;
        }
        if (result.reason === 'local-changed') return;
      }
      if (!current()) return;
      profile.dropFreeNip05();
      const result = await settlePendingClaim({ identity, profile, ...(claimApi ? { api: claimApi } : {}) });
      if (!current()) return;
      if (result.status === CLAIM_STATUS.DONE) onClaim(result);
      const reconciled = await reconcileProfileUsername({ identity, profile, ...(claimApi ? { api: claimApi } : {}) });
      if (!current()) return;
      retry ||= reconciled === 'unknown' || result.status === CLAIM_STATUS.WAITING;
      if (profile.isDirty) await profile.publish(publishOptions);
    } catch (err) {
      retry = true;
      console.warn('[profile-sync] synchronization will retry:', err);
    } finally {
      running = false;
      if (!stopped) {
        if (trailing) {
          trailing = false;
          schedule(0);
        } else if (retry || profile.isDirty || identity.pendingNip05Claim && !identity.pendingNip05Claim.failedAt) {
          schedule(retryMs);
          retryMs = Math.min(retryMs * 2, 60_000);
        }
      }
    }
  }

  const unwatchIdentity = watch(() => identity.nostrPubkeyHex, () => {
    // hydrate reads storage synchronously, binding the store before old work resumes.
    void profile.hydrate();
    wake({ recovery: true });
  }, { flush: 'sync' });
  const unwatchWork = watch(() => [
    profile.revision,
    identity.pendingNip05Claim?.paymentHash,
    identity.pendingNip05Claim?.paidAt,
    identity.pendingNip05Claim?.failedAt,
  ], () => wake(), { flush: 'sync' });
  const resume = () => {
    if (available()) wake({ recovery: true });
    else if (timer !== null) { clearTimer(timer); timer = null; }
  };
  win?.addEventListener('online', resume);
  win?.addEventListener('offline', resume);
  doc?.addEventListener('visibilitychange', resume);
  wake();
  return {
    wake,
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      unwatchIdentity();
      unwatchWork();
      win?.removeEventListener('online', resume);
      win?.removeEventListener('offline', resume);
      doc?.removeEventListener('visibilitychange', resume);
    },
  };
}
