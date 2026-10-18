// A rule on an NWC wallet with its reads and engine runs logged (window.__atLog);
// no money moves. Applied by scripts/device/cdp.mjs; see auto-transfer-timeline.mjs.
(async () => {
  const pinia = document.querySelector('#q-app').__vue_app__.config.globalProperties.$pinia;
  const ws = pinia._s.get('wallet');
  const aw = pinia._s.get('autoWithdraw');
  window.__atLog = [];
  const log = (what) => window.__atLog.push({ t: Date.now(), what, vis: document.visibilityState });
  document.addEventListener('visibilitychange', () => log('visibility'));
  ws.wallets = [
    { id: 'hub', type: 'nwc', name: 'Hub', metadata: {} },
    { id: 'sav', type: 'spark', name: 'Savings', metadata: {} },
  ];
  ws.refreshBalance = async (id) => { log('refresh:' + id); ws.applyBalance(id, 600000, { source: 'sync', at: Date.now() }); };
  aw.checkAndExecute = async (id) => { log('engine:' + id); };
  aw.configs = { hub: { enabled: true, threshold: { sats: 500000 }, keep: null, destination: { kind: 'wallet', walletId: 'sav' }, feeSpeed: 'medium', pausedReason: null, failureStreak: 0, events: [], lastTriggeredAt: null } };
  window.__atStart = Date.now();
  log('injected');
  return 'ok';
})()
