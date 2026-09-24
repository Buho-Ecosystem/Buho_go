import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const source = readFileSync(new URL('../fileExport.js', import.meta.url), 'utf8');
// Dynamic imports compiled to require(), so the plugin modules loaded lazily
// by shareFile resolve to the fakes below rather than the real packages.
const { code } = transformSync(source, { format: 'cjs', supported: { 'dynamic-import': false } });

const decode = (base64) => Buffer.from(base64, 'base64');

/**
 * Loads fileExport.js against fake Capacitor modules.
 *
 * @param {object} options
 * @param {boolean} [options.native]      what Capacitor.isNativePlatform() says
 * @param {Function} [options.save]       FileExport.save implementation
 * @param {Function} [options.share]      Share.share implementation
 */
function harness({ native = true, save = async () => ({ saved: true }), share = async () => ({}) } = {}) {
  const state = { saves: [], writes: [], shares: [], thenReads: 0 };

  // A Capacitor plugin proxy answers every property, `then` included, so
  // awaiting one hangs. Reading `then` here fails the test instead.
  const fileExport = new Proxy({
    save: async (options) => { state.saves.push(options); return save(options); },
  }, {
    get(target, key) {
      if (key === 'then') {
        state.thenReads++;
        throw Error('Do not await the Capacitor plugin proxy');
      }
      return target[key];
    },
  });

  const modules = {
    '@capacitor/core': {
      Capacitor: { isNativePlatform: () => native },
      registerPlugin: (name) => {
        assert.equal(name, 'FileExport');
        return fileExport;
      },
    },
    '@capacitor/filesystem': {
      Directory: { Cache: 'CACHE' },
      Filesystem: {
        writeFile: async (options) => {
          state.writes.push(options);
          return { uri: `file:///cache/${options.path}` };
        },
      },
    },
    '@capacitor/share': {
      Share: { share: async (options) => { state.shares.push(options); return share(options); } },
    },
  };

  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(name in modules, `unexpected import ${name}`);
    return modules[name];
  }, module, module.exports);
  return { ...module.exports, state };
}

test('native save hands the system dialog a safe name, the type and UTF-8 bytes', async () => {
  const exporter = harness();
  const result = await exporter.saveFile({
    filename: 'buhogo report: 2026/01.csv',
    data: 'Datum;Betrag\n2026-01-01;€ 10\n',
    mimeType: exporter.MIME.csv,
  });

  assert.deepEqual(result, { saved: true });
  const [call] = exporter.state.saves;
  assert.equal(call.filename, 'buhogo-report-2026-01.csv');
  assert.equal(call.mimeType, 'text/csv');
  assert.equal(decode(call.data).toString('utf8'), 'Datum;Betrag\n2026-01-01;€ 10\n');
  assert.equal(exporter.state.thenReads, 0);
});

test('native save passes binary data through unchanged, larger than one encoding chunk', async () => {
  const exporter = harness();
  const bytes = new Uint8Array(0x8000 * 2 + 17).map((_, i) => i % 251);
  await exporter.saveFile({ filename: 'report.pdf', data: bytes, mimeType: exporter.MIME.pdf });

  assert.deepEqual(new Uint8Array(decode(exporter.state.saves[0].data)), bytes);
});

test('closing the save dialog is reported as not saved, not as an error', async () => {
  const exporter = harness({ save: async () => ({ saved: false }) });
  assert.deepEqual(await exporter.saveFile({ filename: 'r.pdf', data: 'x', mimeType: 'application/pdf' }), { saved: false });
});

test('a failed save rejects with the plugin error, code included', async () => {
  const exporter = harness({
    save: async () => { throw Object.assign(new Error('No app on this device can save files'), { code: 'UNAVAILABLE' }); },
  });
  await assert.rejects(
    exporter.saveFile({ filename: 'r.pdf', data: 'x', mimeType: 'application/pdf' }),
    { code: 'UNAVAILABLE' },
  );
});

test('native share writes to the app cache and shares that file', async () => {
  const exporter = harness();
  const result = await exporter.shareFile({
    filename: 'report.xml', data: '<report/>', mimeType: exporter.MIME.xml, title: 'BuhoGO report',
  });

  assert.deepEqual(result, { shared: true });
  const [write] = exporter.state.writes;
  assert.equal(write.directory, 'CACHE');
  assert.equal(write.path, 'report.xml');
  assert.equal(decode(write.data).toString('utf8'), '<report/>');
  assert.deepEqual(exporter.state.shares[0].files, ['file:///cache/report.xml']);
  assert.equal(exporter.state.shares[0].title, 'BuhoGO report');
});

test('closing the share sheet is reported as not shared; any other failure rejects', async () => {
  const cancelled = harness({ share: async () => { throw new Error('Share canceled'); } });
  assert.deepEqual(
    await cancelled.shareFile({ filename: 'r.csv', data: 'x', mimeType: 'text/csv' }),
    { shared: false },
  );

  const broken = harness({ share: async () => { throw new Error('only file urls are supported'); } });
  await assert.rejects(
    broken.shareFile({ filename: 'r.csv', data: 'x', mimeType: 'text/csv' }),
    /only file urls are supported/,
  );
});

test('the phone apps can always share; a browser only when it accepts files', () => {
  assert.equal(harness().canShareFile({ filename: 'r.pdf', data: 'x', mimeType: 'application/pdf' }), true);
  // Node has no navigator.canShare, which is the state of most desktop browsers.
  assert.equal(harness({ native: false }).canShareFile({ filename: 'r.pdf', data: 'x', mimeType: 'application/pdf' }), false);
});

test('in a browser, save is a download and never touches the native plugin', async () => {
  const clicks = [];
  const created = [];
  const saved = { document: globalThis.document, createObjectURL: URL.createObjectURL };
  globalThis.document = {
    createElement: () => {
      const link = { click() { clicks.push({ href: link.href, download: link.download }); }, remove() {} };
      created.push(link);
      return link;
    },
    body: { appendChild() {} },
  };
  URL.createObjectURL = () => 'blob:report';
  try {
    const exporter = harness({ native: false });
    assert.deepEqual(await exporter.saveFile({ filename: 'my report.csv', data: 'a;b', mimeType: 'text/csv' }), { saved: true });
    assert.deepEqual(clicks, [{ href: 'blob:report', download: 'my-report.csv' }]);
    assert.equal(exporter.state.saves.length, 0);
  } finally {
    globalThis.document = saved.document;
    URL.createObjectURL = saved.createObjectURL;
  }
});
