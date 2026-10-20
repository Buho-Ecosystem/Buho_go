/** A stand-in NWC wallet for checks on a device (scripts/fixtures/nwcStandIn.mjs).
 *
 *   node scripts/device/nwc-stand-in.mjs [port]
 *     Serves wallet and relay on ws://localhost:<port> (default 7777) and
 *     counts the connections. Type "drop" (or send SIGUSR2) to drop them, as
 *     a lost network would. Android's WebView refuses plain ws:// from the
 *     app's https page, so this mode is for desktop browsers.
 *
 *   node scripts/device/nwc-stand-in.mjs --relay wss://relay.example
 *     Joins a real relay as the wallet, for the Android app; count the
 *     app's connections on the device side.
 *
 * Prints the connection string to add, and every request as it is answered.
 */
import { WebSocketServer } from 'ws';
import readline from 'node:readline';
import { Relay } from 'nostr-core';
import { createNwcStandIn } from '../fixtures/nwcStandIn.mjs';

const relayArg = process.argv.indexOf('--relay');
if (relayArg !== -1) {
  const url = process.argv[relayArg + 1];
  const standIn = createNwcStandIn({ relayUrl: url });
  const relay = new Relay(url, { reconnect: { enabled: true } });
  await relay.connect({ timeout: 10000 });
  await relay.publish(standIn.info);
  relay.subscribe([{ kinds: [23194], '#p': [standIn.walletPubkey], since: Math.floor(Date.now() / 1000) - 10 }], {
    onevent: async (event) => {
      const reply = standIn.answerTo(event);
      if (!reply) return;
      await relay.publish(reply).catch((error) => console.log('publish failed', error?.message || error));
      console.log(`${new Date().toISOString().slice(11, 19)}  answered ${standIn.requests.at(-1)}`);
    },
  });
  console.log(`Stand-in NWC wallet on ${url}\nConnection:\n${standIn.connection}\n`);
  await new Promise(() => {});
}

const port = Number(process.argv[2] || 7777);
const standIn = createNwcStandIn({ relayUrl: `ws://localhost:${port}` });
const server = new WebSocketServer({ port });
const report = (what) => console.log(`${new Date().toISOString().slice(11, 19)}  ${what}   (opened ${standIn.sockets.opened}, open ${standIn.sockets.open})`);

server.on('connection', (socket) => {
  standIn.serve({
    onMessage: (handler) => socket.on('message', (data) => {
      const before = standIn.requests.length;
      handler(String(data));
      if (standIn.requests.length > before) report(`request ${standIn.requests.at(-1)}`);
    }),
    send: (text) => socket.send(text),
    onClose: (handler) => socket.on('close', () => { handler(); report('connection closed'); }),
    close: () => socket.terminate(),
  });
  report('connection opened');
});

console.log(`Stand-in NWC wallet on ws://localhost:${port}\nConnection:\n${standIn.connection}\n`);
const drop = () => { standIn.dropAll(); report('dropped every connection'); };
readline.createInterface({ input: process.stdin }).on('line', (line) => { if (line.trim() === 'drop') drop(); });
process.on('SIGUSR2', drop);
