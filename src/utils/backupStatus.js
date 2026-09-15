/** Phrase verification is independent of balance, banner dismissal and Drive uploads. */
export function isWalletBackedUp(wallet, legacySparkBackedUp = false) {
  if (wallet.type === 'spark') {
    return !!(wallet.metadata?.hasBackedUp ?? legacySparkBackedUp);
  }
  return wallet.type === 'arkade' && !!wallet.metadata?.hasBackedUp;
}

/** Spark accounts share one phrase; each Arkade wallet has its own. */
export function walletBackupGroups(wallets, legacySparkBackedUp = false) {
  const groups = [];
  for (const wallet of wallets) {
    if (wallet.type !== 'spark' && wallet.type !== 'arkade') continue;
    const key = wallet.type === 'spark' ? 'spark' : wallet.id;
    const saved = isWalletBackedUp(wallet, legacySparkBackedUp);
    const group = groups.find((entry) => entry.key === key);
    if (group) {
      group.saved = group.saved && saved;
      group.names.push(wallet.name);
    } else {
      groups.push({ key, walletId: wallet.id, type: wallet.type, names: [wallet.name], saved });
    }
  }
  return groups;
}

/** Put the user's wallet names first; provider names remain secondary UI text. */
export function bitcoinBackupName(group, t) {
  const names = group.names.filter(name => name && !/^(spark|arkade)( wallet)?$/i.test(name.trim()));
  return names.length ? names.join(' · ') : t('Your bitcoin');
}
