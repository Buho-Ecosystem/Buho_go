/**
 * Auto-transfer rules are keyed by wallet id. Before Spark accounts became
 * wallets of their own, a rule on a "pocket" was saved as
 * `<parentWalletId>:<accountNumber>`; the pocket later became a wallet with
 * a new id, which left those rules pointing at nothing. This moves each one
 * to the wallet that now holds that account of the same phrase, switched
 * off: a rule that has not run for months must not start sending money to a
 * destination the person may no longer use. They turn it back on in
 * Settings.
 *
 * Pure: takes the saved rules and the wallets, returns the rules to keep.
 */

import { sparkAccountNumberOf } from './sparkAccounts.js';

/**
 * @param {Record<string, object>} configs  saved rules by key
 * @param {object[]} wallets                the wallets on the device
 * @returns {{ configs: Record<string, object>, moved: string[], dropped: string[] }}
 *   `dropped`: pocket rules no wallet can run (the parent or the account is
 *   gone). A rule already saved under the new id is never overwritten.
 */
export function migratePocketConfigKeys(configs, wallets) {
  const result = {};
  const moved = [];
  const dropped = [];
  const entries = Object.entries(configs || {});
  for (const [key, config] of entries) if (!isPocketKey(key)) result[key] = config;
  for (const [key, config] of entries) {
    if (!isPocketKey(key)) continue;
    const split = key.lastIndexOf(':');
    const parentId = key.slice(0, split);
    const accountNumber = Number(key.slice(split + 1));
    const parent = (wallets || []).find(w => w?.id === parentId && w.type === 'spark');
    const target = parent && (wallets || []).find(w => w?.type === 'spark'
      && sparkAccountNumberOf(w) === accountNumber
      // The pocket conversion copied the parent's phrase envelope verbatim.
      && w.connectionData?.encryptedMnemonic === parent.connectionData?.encryptedMnemonic);
    if (!target || result[target.id]) {
      dropped.push(key);
      continue;
    }
    result[target.id] = { ...config, enabled: false };
    moved.push(key);
  }
  return { configs: result, moved, dropped };
}

function isPocketKey(key) {
  return /:\d+$/.test(key);
}
