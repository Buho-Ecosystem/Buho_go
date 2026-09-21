/**
 * The emergency exit ledger: one record per wallet, written the moment an
 * exit is quoted and updated after every step, so the exit survives app
 * restarts and days of waiting. Pure transitions; the store persists, the
 * driver talks to the SDK and the chain.
 *
 * Stages: fund (waiting for fee money) -> ready (funded, needs the person's
 * confirmation) -> send (packages going out) -> unlock (timelock) -> sweep
 * -> done. Cancel is possible only before anything is signed.
 */

import { planStatus, estimateDate, triageFromQuote } from './exitPlan.js';

export const EXIT_STAGES = Object.freeze(['fund', 'ready', 'send', 'unlock', 'sweep', 'done']);
export const ACTIVE_STAGES = Object.freeze(['fund', 'ready', 'send', 'unlock', 'sweep']);
const PHASE_TO_STAGE = { send: 'send', unlock: 'unlock', sweep: 'sweep', done: 'done' };

export function newExit({ walletId, walletName, network, destination, funding, quote, balanceSat, now = Date.now() }) {
  return withQuote({
    v: 1,
    walletId,
    walletName: walletName || '',
    network,
    createdAt: now,
    updatedAt: now,
    stage: 'fund',
    destination: { address: destination.address, source: destination.source || 'derived' },
    funding: { address: funding.address, publicKeyHex: funding.publicKeyHex, path: funding.path, utxos: [], confirmedSat: 0, requiredSat: 0, shortfallSat: 0, confirmedAt: null },
    quote: null,
    triage: null,
    balanceSat: Number(balanceSat || 0),
    built: null,
    statuses: {},
    tipHeight: 0,
    unlock: null,
    lastCheckedAt: null,
    lastError: null,
    attempts: 0,
    sentAt: null,
    doneAt: null,
  }, quote, balanceSat, now);
}

export function isActive(exit) {
  return !!exit && ACTIVE_STAGES.includes(exit.stage);
}

export function canCancel(exit) {
  return !!exit && (exit.stage === 'fund' || exit.stage === 'ready');
}

export function canChangeDestination(exit) {
  return canCancel(exit);
}

/** A fresh quote before anything is signed. Required fee money follows the quote. */
export function withQuote(exit, quote, balanceSat = exit.balanceSat, now = Date.now()) {
  if (!canCancel(exit)) throw new Error('Quote cannot change after signing');
  const triage = triageFromQuote(quote, balanceSat);
  const requiredSat = Number(quote?.singleUtxoFundingSat || 0);
  const next = {
    ...exit,
    quote: {
      recoverableValueSat: Number(quote.recoverableValueSat || 0),
      totalFeeSat: Number(quote.totalFeeSat || 0),
      fanoutFeeSat: Number(quote.fanoutFeeSat || 0),
      singleUtxoFundingSat: requiredSat,
      feeRateSatPerVbyte: Number(quote.feeRateSatPerVbyte || 0),
      destination: quote.destination,
      leafIds: (quote.leaves || []).map(leaf => leaf.leafId),
      quotedAt: now,
    },
    triage,
    balanceSat: Number(balanceSat || 0),
    funding: { ...exit.funding, requiredSat },
    updatedAt: now,
  };
  return settleFunding(next, now);
}

export function withDestination(exit, address, source = 'custom', now = Date.now()) {
  if (!canChangeDestination(exit)) throw new Error('Destination cannot change after signing');
  return { ...exit, destination: { address, source }, updatedAt: now };
}

/** The fee money address was checked on chain. */
export function withFunding(exit, utxos, now = Date.now()) {
  if (!canCancel(exit)) return exit;
  const list = (utxos || []).map(u => ({ txid: u.txid, vout: u.vout, value: Number(u.value || 0), confirmed: !!u.confirmed }));
  return settleFunding({ ...exit, funding: { ...exit.funding, utxos: list }, updatedAt: now }, now);
}

function settleFunding(exit, now) {
  const confirmedSat = exit.funding.utxos.filter(u => u.confirmed).reduce((sum, u) => sum + u.value, 0);
  const requiredSat = exit.funding.requiredSat;
  const funded = requiredSat > 0 && confirmedSat >= requiredSat;
  return {
    ...exit,
    stage: funded ? 'ready' : 'fund',
    funding: {
      ...exit.funding,
      confirmedSat,
      shortfallSat: Math.max(0, requiredSat - confirmedSat),
      confirmedAt: funded ? (exit.funding.confirmedAt || now) : null,
    },
  };
}

/** The signed transaction set exists. From here the exit only moves forward. */
export function withBuild(exit, response, now = Date.now()) {
  if (exit.stage !== 'ready') throw new Error('Exit is not ready to be signed');
  const transactions = (response.transactions || []).map(tx => ({
    kind: tx.kind, txid: tx.txid, txHex: tx.txHex, cpfpTxHex: tx.cpfpTxHex || null,
    csvTimelockBlocks: tx.csvTimelockBlocks || 0, dependsOn: [...(tx.dependsOn || [])], nodeId: tx.nodeId || null,
  }));
  const statuses = { ...exit.statuses };
  for (const tx of response.transactions || []) {
    if (tx.status === 'confirmed') statuses[tx.txid] = { known: true, confirmed: true, blockHeight: statuses[tx.txid]?.blockHeight };
  }
  return {
    ...exit,
    stage: 'send',
    built: {
      builtAt: now,
      recoverableValueSat: Number(response.recoverableValueSat || 0),
      totalFeeSat: Number(response.totalFeeSat || 0),
      leafIds: (response.leaves || []).map(leaf => leaf.leafId),
      transactions,
    },
    statuses,
    sentAt: null,
    updatedAt: now,
  };
}

/** Chain facts arrived: derive the stage, the unlock date and progress. */
export function withChain(exit, { statuses = {}, tipHeight, now = Date.now() }) {
  if (!exit.built) return exit;
  const merged = { ...exit.statuses, ...statuses };
  const tip = Number.isInteger(tipHeight) ? tipHeight : exit.tipHeight;
  const plan = planStatus({ transactions: exit.built.transactions, statuses: merged, tipHeight: tip });
  const stage = PHASE_TO_STAGE[plan.phase] || exit.stage;
  const unlock = plan.unlock ? { height: plan.unlock.height, blocksLeft: plan.unlock.blocksLeft, estimatedAt: estimateDate(plan.unlock.blocksLeft, now).getTime() } : exit.unlock;
  return {
    ...exit,
    statuses: merged,
    tipHeight: tip,
    stage,
    unlock,
    progress: { confirmed: plan.confirmed, total: plan.total },
    broadcastable: plan.broadcastable,
    pending: plan.pending,
    sentAt: exit.sentAt || (plan.pending.length || plan.confirmed ? now : null),
    doneAt: stage === 'done' ? (exit.doneAt || now) : exit.doneAt,
    lastCheckedAt: now,
    updatedAt: now,
  };
}

export function withError(exit, error, now = Date.now()) {
  return { ...exit, lastError: String(error?.message || error || 'unknown').slice(0, 300), attempts: (exit.attempts || 0) + 1, updatedAt: now };
}

export function withoutError(exit, now = Date.now()) {
  return exit.lastError ? { ...exit, lastError: null, attempts: 0, updatedAt: now } : exit;
}

/** What arrives, net of the sweep's own fee, once the exit is done. */
export function arrivedSat(exit) {
  const built = exit.built;
  if (!built) return exit.triage?.arrivesSat || 0;
  const fundingSat = exit.quote?.singleUtxoFundingSat || 0;
  return Math.max(0, built.recoverableValueSat - Math.max(0, built.totalFeeSat - fundingSat));
}
