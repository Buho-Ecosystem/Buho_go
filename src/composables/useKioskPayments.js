import { computed, effectScope, getCurrentScope, onScopeDispose, ref, watch } from 'vue';
import { createPaymentMonitor } from '../utils/paymentMonitor.js';
import { readInvoice } from '../utils/nwcWallet.js';
import { invoiceAmountMsat } from '../utils/addressUtils.js';
import { kioskWalletBlocker } from '../utils/walletCapabilities.js';
import { KIOSK_LATE_PAYMENT_GRACE_MS, kioskDraftHasValue, kioskError } from '../utils/kioskMerchant.js';

const runtimes = new WeakMap();
const safeProblem = code => ({ code });
/** The last moment a shown request can still be settled; null when it names no expiry. */
const lastMoment = attempt => attempt.expiresAt ? attempt.expiresAt * 1000 + KIOSK_LATE_PAYMENT_GRACE_MS : null;

/** Public request data only. Never retain provider credentials or payment preimages. */
export function validateKioskInvoice(raw, { walletId, amountSats }, decode = readInvoice) {
  const paymentRequest = raw?.paymentRequest || raw?.payment_request || raw?.invoice || raw?.bolt11;
  const decoded = typeof paymentRequest === 'string' ? decode(paymentRequest) : null;
  const hash = decoded?.paymentHash?.toLowerCase();
  const claimedHash = raw?.paymentHash || raw?.payment_hash;
  if (!decoded || !/^[a-f0-9]{64}$/.test(hash || '') ||
      invoiceAmountMsat(paymentRequest) !== amountSats * 1000 ||
      claimedHash && String(claimedHash).toLowerCase() !== hash) {
    throw Object.assign(new Error('The payment request does not match this sale.'), { code: 'KIOSK_INVOICE_MISMATCH' });
  }
  return { walletId, paymentHash: hash, paymentRequest, amountSats,
    expiresAt: decoded.expiresAt || null,
    ...(raw?.invoiceId || raw?.invoice_id || raw?.id ? { invoiceId: String(raw.invoiceId || raw.invoice_id || raw.id) } : {}) };
}

/**
 * One receiving runtime per register store. Its detached scope survives route changes:
 * leaving checkout must never discard an issued request or stop checking a late payment.
 * Status: idle | preparing | waiting | expired | unpaid | not-charged | paid | error.
 *
 * A QR or a card charge only ever shows a request the wallet returned and the
 * register saved. One that never came back was never shown, so it closes as
 * not charged at once. A shown one is checked until it expires, plus a grace
 * period for a payment already on its way; one strict check then decides.
 */
export function useKioskPayments(options) {
  const { merchant, onPaid } = options;
  let runtime = runtimes.get(merchant);
  if (!runtime) {
    const scope = effectScope(true);
    runtime = scope.run(() => createKioskPaymentRuntime(options));
    const dispose = runtime.dispose;
    runtime.dispose = () => { dispose(); scope.stop(); runtimes.delete(merchant); };
    runtimes.set(merchant, runtime);
  }
  if (onPaid) {
    const unsubscribe = runtime.subscribePaid(onPaid);
    if (getCurrentScope()) onScopeDispose(unsubscribe);
  }
  return runtime;
}

/** Dependency injection keeps asynchronous payment races testable without real funds. */
export function createKioskPaymentRuntime({ merchant, walletStore, onPaid,
  monitorFactory = createPaymentMonitor, decodeInvoice = readInvoice, now = Date.now,
  creationTimeoutMs = 30_000, document: page = globalThis.document } = {}) {
  const listeners = new Set(onPaid ? [onPaid] : []);
  const monitors = new Map();
  const problems = ref({});
  const creationTasks = new Map();
  const unpersisted = new Map();
  let creationTask = null;
  let stopped = false;
  let displayRevision = 0;
  const activeOrder = computed(() => merchant.getOrder(merchant.activeOrderId) || null);
  const activeAttempt = computed(() => {
    const order = activeOrder.value;
    return order?.attempts.find(attempt => attempt.id === order.activeAttemptId) || null;
  });
  const activeInvoice = computed(() => {
    const order = activeOrder.value, attempt = activeAttempt.value;
    if (!attempt?.paymentRequest || !attempt.paymentHash) return null;
    try {
      const verified = validateKioskInvoice(attempt, attempt, decodeInvoice);
      return { ...attempt, ...verified, orderId: order.id, attemptId: attempt.id };
    } catch { return null; }
  });
  const problem = computed(() => problems.value[activeOrder.value?.id] || problems.value.register || null);
  const status = computed(() => {
    const order = activeOrder.value, attempt = activeAttempt.value;
    if (!order) return problem.value ? 'error' : 'idle';
    if (order.status === 'paid') return 'paid';
    if (problem.value?.code === 'KIOSK_STORAGE_FAILED' || attempt?.paymentRequest && !activeInvoice.value) return 'error';
    if (attempt?.status === 'creating') return 'preparing';
    if (attempt?.status === 'expired') return 'expired';
    if (attempt?.status === 'waiting') return 'waiting';
    if (attempt?.status === 'failed') return attempt.paymentHash ? 'unpaid' : 'not-charged';
    return problem.value ? 'error' : 'preparing';
  });
  const pendingOrders = computed(() => merchant.orders.filter(order => order.status !== 'paid' && order.attempts.some(a => a.status !== 'paid' && a.status !== 'failed')));
  function setProblem(orderId, code) { problems.value = { ...problems.value, [orderId || 'register']: code ? safeProblem(code) : null }; }
  function storageFailure(orderId) { setProblem(orderId, 'KIOSK_STORAGE_FAILED'); }
  const ready = Promise.resolve().then(async () => {
    await merchant.initialize({ currency: walletStore.preferredFiatCurrency || 'USD', amountUnit: walletStore.kioskDisplayCurrency || 'sats' });
    // A request still being created when the app stopped never came back, so it was never shown.
    for (const attempt of merchant.pendingAttempts) {
      if (attempt.status === 'creating' && !creationTasks.has(attempt.attemptId)) {
        await merchant.markAttemptFailed(attempt.orderId, attempt.attemptId, 'CREATION_INTERRUPTED');
      }
    }
    await syncMonitors();
  }).catch(() => { storageFailure(); });

  async function attachReturned(orderId, attemptId, invoice) {
    try {
      await merchant.attachInvoice(orderId, attemptId, invoice);
      unpersisted.delete(attemptId);
      // Came back after it was closed as not charged: never shown, so dropped.
      if (merchant.getOrder(orderId)?.attempts.find(a => a.id === attemptId)?.status === 'failed') return null;
      setProblem(null, null);
      setProblem(orderId, null);
      await syncMonitors();
      return invoice;
    } catch {
      // Keep the returned request for a write retry, but do not show an undurable QR.
      unpersisted.set(attemptId, { orderId, attemptId, invoice });
      storageFailure(orderId);
      return null;
    }
  }
  function createCharge(snapshot) {
    if (creationTask) return creationTask;
    const revision = displayRevision;
    creationTask = (async () => {
      await ready;
      if (stopped) return null;
      let order, attempt;
      try {
        const wallet = walletStore.wallets.find(w => w.id === snapshot.walletId);
        if (kioskWalletBlocker(wallet)) { setProblem(null, 'KIOSK_WALLET_UNAVAILABLE'); return null; }
        // Reconnect before creating the durable intent: no external invoice exists yet.
        await walletStore.ensureWalletConnectedForTransfer(snapshot.walletId);
        if (!merchant.storageError) setProblem(null, null);
        if (revision !== displayRevision) return null;
        // A late confirmation callback may outlive the expired-payment dialog.
        // Starting another customer is explicit; a paid checkout cannot charge again.
        if (activeOrder.value?.status === 'paid') return null;
        if (activeOrder.value?.status !== 'paid' && activeOrder.value?.attempts.some(a => ['creating', 'waiting'].includes(a.status))) {
          setProblem(activeOrder.value.id, 'KIOSK_REQUEST_UNRESOLVED');
          return null;
        }
        const current = activeOrder.value;
        if (current && current.status !== 'paid') {
          // Retrying an expired request belongs to the same receipt and immutable prices.
          const sameQuote = ['walletId', 'baseSats', 'tipSats', 'roundUpSats', 'totalSats'].every(key => current[key] === snapshot[key]);
          if (!sameQuote) { setProblem(current.id, 'KIOSK_REQUEST_UNRESOLVED'); return null; }
          // Local expiry is not proof of nonpayment. Check every issued request,
          // including older linked attempts, immediately before replacing it.
          if (!await reconcileBeforeReplacement(current)) return null;
          if (stopped || revision !== displayRevision || activeOrder.value?.id !== current.id) return null;
          order = merchant.getOrder(current.id);
          if (!order || order.status === 'paid') return null;
        } else order = await merchant.createOrder(snapshot);
        attempt = await merchant.beginAttempt(order.id, { walletId: snapshot.walletId, amountSats: snapshot.totalSats });
        // Once intent is durable, keep its order ownership through navigation.
        // If Next customer already ran, its atomic draft/order reset is sufficient.
      } catch (error) {
        setProblem(order?.id, error?.code === 'KIOSK_STORAGE_FAILED' ? 'KIOSK_STORAGE_FAILED' : 'KIOSK_CONNECTION_FAILED');
        return null;
      }
      let timeout;
      const external = (async () => {
        try {
          const raw = await walletStore.createInvoiceDetailsOnWallet(snapshot.walletId, snapshot.totalSats, 'Kiosk payment');
          const invoice = validateKioskInvoice(raw, { walletId: snapshot.walletId, amountSats: snapshot.totalSats }, decodeInvoice);
          return await attachReturned(order.id, attempt.id, invoice);
        } catch (error) {
          await closeUnreturned(order.id, attempt.id, error?.code === 'KIOSK_INVOICE_MISMATCH' ? 'INVOICE_MISMATCH' : 'CREATION_FAILED');
          return null;
        } finally {
          clearTimeout(timeout);
          creationTasks.delete(attempt.id);
        }
      })();
      creationTasks.set(attempt.id, external);
      const deadline = new Promise(resolve => {
        timeout = setTimeout(async () => {
          await closeUnreturned(order.id, attempt.id, 'CREATION_TIMEOUT');
          resolve(null);
        }, creationTimeoutMs);
      });
      return await Promise.race([external, deadline]);
    })().finally(() => { creationTask = null; });
    return creationTask;
  }

  /** A request that did not come back closes as not charged; one that did is left alone. */
  async function closeUnreturned(orderId, attemptId, reason) {
    const current = merchant.getOrder(orderId)?.attempts.find(a => a.id === attemptId);
    if (!current || current.paymentHash || current.status !== 'creating') return;
    try {
      await merchant.markAttemptFailed(orderId, attemptId, reason);
      if (problem.value?.code !== 'KIOSK_STORAGE_FAILED') setProblem(orderId, null);
    } catch (error) {
      // It came back while this was queued: it is a shown request now.
      if (error?.code !== 'KIOSK_PAYMENT_PENDING') storageFailure(orderId);
    }
  }

  let concurrentLookups = 0;
  const lookupQueue = [];
  async function readReceivingWallet(attempt) {
    if (concurrentLookups >= 4) await new Promise(resolve => lookupQueue.push(resolve));
    else concurrentLookups++;
    try { return await walletStore.lookupInvoiceOnWallet(attempt.walletId, attempt.paymentHash, { createdAt: attempt.createdAt, expiresAt: attempt.expiresAt, strict: true }); }
    finally { if (lookupQueue.length) lookupQueue.shift()(); else concurrentLookups--; }
  }
  async function lookup(attempt) {
    let result;
    try { result = await readReceivingWallet(attempt); }
    catch { setProblem(attempt.orderId, 'KIOSK_CONNECTION_FAILED'); throw new Error('Payment connection unavailable'); }
    if (result?.paid !== true && result?.paid !== false) {
      setProblem(attempt.orderId, 'KIOSK_CONNECTION_FAILED');
      throw new Error('Payment status unavailable');
    }
    const hash = result?.paymentHash || result?.payment_hash;
    if (hash && String(hash).toLowerCase() !== attempt.paymentHash.toLowerCase()) {
      setProblem(attempt.orderId, 'KIOSK_PAYMENT_MISMATCH');
      throw new Error('Payment identity mismatch');
    }
    if (result?.paid === true) {
      // The receiving wallet and the hash prove which request was paid, and a
      // paid request was paid at least its own amount. The figure a wallet
      // reports is not compared: some report the request, some what was
      // credited after their receive fee.
      let settled;
      try { settled = await merchant.settleAttempt(attempt.orderId, attempt.attemptId, {
        walletId: attempt.walletId, paymentHash: attempt.paymentHash, paidAt: now(),
        transactionId: typeof (result.transactionId || result.id) === 'string' ? (result.transactionId || result.id) : null,
      }); } catch { storageFailure(attempt.orderId); throw new Error('Register storage unavailable'); }
      setProblem(attempt.orderId, null);
      if (!settled.duplicate && (settled.newlyPaid || settled.duplicatePayment)) {
        for (const callback of listeners) {
          // Metadata and view effects cannot roll back an already durable receipt.
          try { await callback(settled.order, settled.attempt, result); } catch { /* Receipt remains in the register. */ }
        }
      }
    } else {
      setProblem(attempt.orderId, null);
      if (attempt.expiresAt && attempt.expiresAt * 1000 <= now() && attempt.status !== 'expired') {
        try { await merchant.markAttemptExpired(attempt.orderId, attempt.attemptId); }
        catch { storageFailure(attempt.orderId); throw new Error('Register storage unavailable'); }
      }
    }
    return { ...result, paid: result?.paid === true };
  }
  async function reconcileBeforeReplacement(order) {
    for (const attempt of order.attempts) {
      if (attempt.status === 'paid') return false;
      // Closed: never shown, or checked as not paid after its last moment.
      if (attempt.status === 'failed') continue;
      if (!attempt.paymentHash || !attempt.paymentRequest) {
        // An interrupted create may have reached the wallet without returning a
        // request identity. It cannot be checked or safely submitted a second time.
        setProblem(order.id, 'KIOSK_REQUEST_UNRESOLVED');
        return false;
      }
      try { validateKioskInvoice(attempt, attempt, decodeInvoice); }
      catch { setProblem(order.id, 'KIOSK_INVOICE_MISMATCH'); return false; }
      try {
        const result = await lookup({ ...attempt, orderId: order.id, attemptId: attempt.id });
        if (result.paid) return false;
      } catch { return false; }
    }
    return merchant.getOrder(order.id)?.status !== 'paid';
  }
  async function syncMonitors() {
    if (stopped) return;
    const pending = merchant.pendingAttempts.filter(a => a.paymentHash && a.paymentRequest).flatMap(attempt => {
      try { return [{ ...attempt, ...validateKioskInvoice(attempt, attempt, decodeInvoice) }]; }
      catch { setProblem(attempt.orderId, 'KIOSK_INVOICE_MISMATCH'); return []; }
    });
    const keys = new Set(pending.map(a => a.attemptId));
    for (const [key, monitor] of monitors) if (!keys.has(key)) { monitor.stop(); monitors.delete(key); }
    for (const attempt of pending) {
      // A monitor that stopped after its last check is rebuilt only by a new
      // check: opening the app, returning to it, or Check payment again.
      const existing = monitors.get(attempt.attemptId);
      if (existing && existing.isActive?.() !== false) continue;
      // Retries never give up before the request's last moment: a payment
      // during an outage must still be found once the wallet answers again.
      const monitor = monitorFactory({ initialInterval: 1500, maxInterval: 30_000,
        maxAttempts: Number.MAX_SAFE_INTEGER, maxConsecutiveErrors: Number.MAX_SAFE_INTEGER });
      monitors.set(attempt.attemptId, monitor);
      await monitor.start({ invoice: { payment_hash: attempt.paymentHash, amount: attempt.amountSats },
        provider: { lookupInvoice: () => check(attempt.attemptId, monitor) },
        onStatusChange: () => {} });
    }
  }
  /** One scheduled check; after the request's last moment it is the final one. */
  async function check(attemptId, monitor) {
    const attempt = merchant.pendingAttempts.find(a => a.attemptId === attemptId);
    if (!attempt) { monitor.stop(); return { paid: false }; }
    const until = lastMoment(attempt);
    const final = until != null && now() >= until;
    let result;
    try { result = await lookup(attempt); }
    catch (error) {
      // No answer at the last moment: stop, and say so ("Not confirmed").
      if (final) monitor.stop();
      throw error;
    }
    if (final && !result.paid) {
      monitor.stop();
      try { await merchant.closeUnpaidAttempt(attempt.orderId, attempt.attemptId, { checkedAt: now() }); }
      catch { storageFailure(attempt.orderId); }
    }
    return result;
  }
  const stopPendingWatch = watch(() => merchant.pendingAttempts.map(a => `${a.attemptId}:${a.status}`).join('|'), () => { syncMonitors().catch(() => storageFailure()); });
  const stopContextWatch = watch(() => [walletStore.kioskEnabled, walletStore.kioskOwnerAccess, walletStore.kioskWalletId], (_, previous) => {
    if (previous) invalidateDisplay();
  });
  async function checkNow() {
    await ready;
    for (const held of [...unpersisted.values()]) await attachReturned(held.orderId, held.attemptId, held.invoice);
    await syncMonitors();
    await Promise.all([...monitors.values()].map(monitor => monitor.checkNow()));
    return activeOrder.value?.status === 'paid';
  }
  async function reconnect() {
    const ids = new Set(merchant.pendingAttempts.map(a => a.walletId));
    if (walletStore.kioskWalletId) ids.add(walletStore.kioskWalletId);
    for (const id of ids) {
      try { await walletStore.ensureWalletConnectedForTransfer(id); }
      catch { setProblem(null, 'KIOSK_CONNECTION_FAILED'); }
    }
    return checkNow();
  }
  async function resume(orderId) {
    await ready;
    const current = activeOrder.value;
    if (current?.id !== orderId && (current && current.status !== 'paid' || kioskDraftHasValue(merchant.draft))) {
      throw kioskError('KIOSK_BASKET_CONFLICT', 'Save or clear the current basket before opening another.');
    }
    await merchant.setActiveOrder(orderId);
    await checkNow();
    return activeInvoice.value;
  }
  // Leaving checkout invalidates unfinished view actions, not the payable basket.
  // Only Next customer releases ownership and clears its draft together.
  function invalidateDisplay() { displayRevision++; }
  async function nextCustomer() { displayRevision++; await ready; await merchant.startNextSale(); setProblem(null, null); }
  const onVisible = () => { if (page?.visibilityState === 'visible') checkNow().catch(() => storageFailure()); };
  page?.addEventListener?.('visibilitychange', onVisible);
  return { ready, activeOrder, activeInvoice, status, problem, pendingOrders, createCharge, resume,
    checkNow, reconnect, nextCustomer, invalidateDisplay,
    stopShowing: invalidateDisplay, clearDisplay: invalidateDisplay,
    subscribePaid(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    dispose() { stopped = true; stopPendingWatch(); stopContextWatch(); page?.removeEventListener?.('visibilitychange', onVisible); for (const monitor of monitors.values()) monitor.stop(); monitors.clear(); listeners.clear(); } };
}
