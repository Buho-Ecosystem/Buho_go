/**
 * Pure planning helpers for an emergency exit in progress. They read the
 * SDK's signed transaction set plus chain facts the app fetched, and answer
 * three questions without touching the network: what may be broadcast now,
 * which stage the exit is in, and when the money unlocks.
 *
 * Chain facts: `statuses[txid] = { known, confirmed, blockHeight }` from an
 * Esplora tx status lookup (`known` false when the network has never seen
 * the transaction) and `tipHeight`, the current block height.
 */

export const EXIT_PHASES = Object.freeze(['send', 'unlock', 'sweep', 'done']);
const BLOCK_MINUTES = 10;

const status = (statuses, txid) => statuses[txid] || { known: false, confirmed: false };
const isConfirmed = (statuses, txid) => !!status(statuses, txid).confirmed;

/** The raw hex set one broadcast carries: the tree tx with its fee child, or a lone fan-out/sweep. */
export function packageFor(tx) {
  return tx.cpfpTxHex ? [tx.txHex, tx.cpfpTxHex] : [tx.txHex];
}

/**
 * The block at which a timelocked tx may be mined: every dependency confirmed,
 * plus the relative timelock. Null while a dependency is unconfirmed.
 */
export function matureHeight(tx, statuses) {
  if (!tx.csvTimelockBlocks) return tx.dependsOn.every(id => isConfirmed(statuses, id)) ? 0 : null;
  let highest = 0;
  for (const id of tx.dependsOn) {
    const dep = status(statuses, id);
    if (!dep.confirmed || typeof dep.blockHeight !== 'number') return null;
    highest = Math.max(highest, dep.blockHeight);
  }
  return highest + tx.csvTimelockBlocks;
}

function mayBroadcast(tx, statuses, tipHeight) {
  const height = matureHeight(tx, statuses);
  if (height === null) return false;
  // A relative timelock of N lets the tx into the block after N blocks on
  // top of the parent, so it is broadcastable once the tip reaches N - 1.
  return height === 0 || tipHeight + 1 >= height;
}

/**
 * Where the exit stands. `broadcastable` lists txids the app may submit now,
 * in dependency order; `pending` are known to the network but unconfirmed.
 */
export function planStatus({ transactions, statuses = {}, tipHeight = 0 }) {
  const txs = transactions || [];
  const confirmed = txs.filter(tx => isConfirmed(statuses, tx.txid));
  const pending = txs.filter(tx => status(statuses, tx.txid).known && !isConfirmed(statuses, tx.txid));
  const broadcastable = txs.filter(tx => !status(statuses, tx.txid).known && mayBroadcast(tx, statuses, tipHeight));
  const refunds = txs.filter(tx => tx.kind === 'refund');
  const sweeps = txs.filter(tx => tx.kind === 'sweep');
  const treeDone = txs.filter(tx => tx.kind === 'fanOut' || tx.kind === 'node').every(tx => isConfirmed(statuses, tx.txid));

  let unlock = null;
  if (treeDone && refunds.length) {
    const heights = refunds
      .filter(tx => !isConfirmed(statuses, tx.txid))
      .map(tx => matureHeight(tx, statuses))
      .filter(height => typeof height === 'number');
    if (heights.length) {
      const height = Math.max(...heights);
      // Blocks until the refund may be broadcast (see mayBroadcast).
      unlock = { height, blocksLeft: Math.max(0, height - tipHeight - 1) };
    }
  }

  let phase = 'send';
  if (sweeps.length && sweeps.every(tx => isConfirmed(statuses, tx.txid))) phase = 'done';
  else if (refunds.length && refunds.every(tx => isConfirmed(statuses, tx.txid))) phase = 'sweep';
  else if (treeDone && unlock && unlock.blocksLeft > 0) phase = 'unlock';
  else if (treeDone && unlock) phase = 'sweep';

  return {
    total: txs.length,
    confirmed: confirmed.length,
    pending: pending.map(tx => tx.txid),
    broadcastable: broadcastable.map(tx => tx.txid),
    unlock,
    phase,
  };
}

/** A calendar estimate for a block count, at ten minutes per block. */
export function estimateDate(blocksLeft, now = Date.now()) {
  return new Date(now + Math.max(0, blocksLeft) * BLOCK_MINUTES * 60 * 1000);
}

/**
 * The honest triage line from a quote: what can leave, what it costs, what is
 * abandoned as dust, and what arrives after the sweep pays its own fee.
 */
export function triageFromQuote(quote, balanceSat = 0) {
  const recoverableSat = Number(quote?.recoverableValueSat || 0);
  const totalFeeSat = Number(quote?.totalFeeSat || 0);
  const fundingSat = Number(quote?.singleUtxoFundingSat || 0);
  const sweepFeeSat = Math.max(0, totalFeeSat - fundingSat);
  return {
    recoverableSat,
    feeSat: totalFeeSat,
    fundingSat,
    notWorthSat: Math.max(0, Number(balanceSat || 0) - recoverableSat),
    arrivesSat: Math.max(0, recoverableSat - sweepFeeSat),
    leafCount: Array.isArray(quote?.leaves) ? quote.leaves.length : 0,
  };
}
