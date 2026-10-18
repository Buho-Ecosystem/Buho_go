// Foreground → background → resume on an Android device or emulator, logging
// when the Auto-Transfer watch and engine run (docs/AUTO_TRANSFER.md).
//
// 1. Install a debug build, start it, forward its WebView:
//      adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof mybuho.buhogo)
// 2. node scripts/device/cdp.mjs 9333 "$(cat scripts/device/auto-transfer-inject.js)"
// 3. node scripts/device/auto-transfer-timeline.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8' }).trim();
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const read = readFileSync(new URL('./auto-transfer-read.js', import.meta.url), 'utf8');

async function evaluate(expr, timeoutMs = 4000) {
  let pages;
  try {
    pages = await (await fetch('http://127.0.0.1:9333/json', { signal: AbortSignal.timeout(timeoutMs) })).json();
  } catch {
    return 'NO ANSWER (the app is frozen)';
  }
  const page = pages.find((p) => p.type === 'page') || pages[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok));
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  const reply = await Promise.race([
    new Promise((ok) => ws.addEventListener('message', (m) => ok(JSON.parse(m.data)))),
    new Promise((ok) => setTimeout(() => ok(null), timeoutMs)),
  ]);
  ws.close();
  return reply ? reply.result?.result?.value : 'NO ANSWER (JavaScript not running)';
}
const state = () => {
  const pid = adb('shell', 'pidof', 'mybuho.buhogo');
  const oom = adb('shell', 'cat', `/proc/${pid}/oom_score_adj`);
  const lru = adb('shell', `dumpsys activity lru | grep ${pid} || true`).replace(/\s+/g, ' ');
  return `pid ${pid} oom_adj ${oom} | ${lru}`;
};

const t0 = Date.now();
const at = () => `${Math.round((Date.now() - t0) / 1000)}s`;
console.log(at(), 'foreground', state());
await wait(75);
console.log(at(), 'log after 75 s open:', await evaluate(read));

adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
console.log(at(), 'HOME pressed');
const marks = [5, 15, 30, 60, 90, 120, 170];
for (const [i, s] of marks.entries()) {
  await wait(s - (i ? marks[i - 1] : 0));
  console.log(at(), `+${s}s in background:`, state(), '| JS:', await evaluate('document.visibilityState + " " + (window.__atLog||[]).length', 3000));
}
adb('shell', 'am', 'start', '-n', 'mybuho.buhogo/org.capacitor.quasar.app.MainActivity');
console.log(at(), 'brought back');
await wait(12);
console.log(at(), 'log after resume:', await evaluate(read));
