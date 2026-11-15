import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as sdk from '@arkade-os/sdk';
import * as keys from '../../utils/arkadeKeys.js';
import { WalletProvider } from '../WalletProvider.js';

/** Run the real provider with the installed SDK and a replaceable decryptor. */
export function arkadeProviderClass(overrides = {}) {
  const source = readFileSync(new URL('../ArkadeWalletProvider.js', import.meta.url), 'utf8');
  const { code } = transformSync(source, { format: 'cjs' });
  const deps = {
    './WalletProvider': { WalletProvider },
    '@arkade-os/sdk': sdk,
    '../utils/arkadeKeys': keys,
    '../utils/deviceCrypto': { decryptString: async () => 'test-only phrase' },
    ...overrides,
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => deps[name] || {}, module, module.exports);
  return module.exports.ArkadeWalletProvider;
}

export function connectedArkade(wallet) {
  const Provider = arkadeProviderClass();
  const provider = new Provider('ark', {});
  provider.wallet = wallet;
  provider.isConnected = true;
  return provider;
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
