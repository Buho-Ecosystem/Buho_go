// Evaluate one expression in the app's WebView over raw CDP, on a debug build
// whose WebView is forwarded with adb (Playwright cannot attach to Android
// WebView). Usage: node scripts/device/cdp.mjs <port> '<expression>'
const [port, expr] = process.argv.slice(2);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === 'page') || pages[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener('open', ok));
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
const reply = await new Promise((ok) => ws.addEventListener('message', (m) => ok(JSON.parse(m.data))));
console.log(JSON.stringify(reply.result?.result?.value ?? reply));
ws.close();
