/**
 * Finds which Spark accounts of a recovery phrase were used, so a restore
 * brings back every wallet and not only the first.
 *
 * Each account is probed in a throwaway SDK instance (`probe`, normally
 * `breezSdk.probeAccountActivity`), a few at a time: a probe is a full WASM
 * build plus up to 30 s of sync. A probe that throws, or that could not sync
 * and found nothing, is inconclusive; the caller keeps that account for a
 * later attempt instead of deciding it is empty.
 */

import { isConclusiveScan, isRestorableAccount } from '../utils/sparkAccounts.js';

const DEFAULT_CONCURRENCY = 2;

/**
 * @param {string} mnemonic
 * @param {object} options
 * @param {number[]} options.accounts      accounts to look at, in order
 * @param {string}   [options.network]
 * @param {Function} options.probe         (mnemonic, { accountNumber, network }) => Promise<evidence>
 * @param {number}   [options.concurrency]
 * @param {Function} [options.onProgress]  ({ done, total }) => void
 * @returns {Promise<Array<{ accountNumber: number, evidence: object|null, conclusive: boolean, used: boolean }>>}
 *   in the order of `accounts`
 */
export async function scanSparkAccounts(mnemonic, { accounts, network = 'MAINNET', probe, concurrency = DEFAULT_CONCURRENCY, onProgress } = {}) {
  const queue = [...(accounts || [])];
  const total = queue.length;
  const results = new Map();
  let done = 0;
  onProgress?.({ done, total });

  async function worker() {
    while (queue.length) {
      const accountNumber = queue.shift();
      let evidence = null;
      try {
        evidence = await probe(mnemonic, { accountNumber, network });
      } catch (error) {
        // Offline or the engine refused: decide nothing about this account.
        console.warn(`[spark-scan] account ${accountNumber} not checked:`, error?.message || error);
      }
      const conclusive = isConclusiveScan(evidence);
      results.set(accountNumber, { accountNumber, evidence, conclusive, used: conclusive && isRestorableAccount(evidence) });
      done += 1;
      onProgress?.({ done, total });
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker);
  await Promise.all(workers);
  return (accounts || []).map(accountNumber => results.get(accountNumber));
}
