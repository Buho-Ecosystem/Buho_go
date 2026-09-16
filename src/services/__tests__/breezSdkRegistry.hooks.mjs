/**
 * Node loader hooks for breezSdkRegistry.spec.js.
 *
 * The registry spec exercises the REAL services/breezSdk.js — its init
 * mutex, release chaining, subscriber transplant, and wasm latch — so the
 * only things substituted are the two modules that cannot run in plain
 * node: the wasm SDK package (replaced by a scripted fake driven through
 * `globalThis.__breezFakeCtl`, which the spec installs before importing)
 * and the build-time config (a test API key; without one buildInstance
 * refuses before ever reaching the SDK).
 */

const FAKE_SDK_SOURCE = `
const ctl = () => globalThis.__breezFakeCtl;
export default function init() { return ctl().init(); }
export function defaultConfig() { return {}; }
export async function initLogging() {}
export const SdkBuilder = {
  new() {
    const b = {
      withAccountNumber() { return b; },
      async withDefaultStorage() { return b; },
      async build() { return ctl().build(); },
    };
    return b;
  },
};
`;

const FAKE_CONFIG_SOURCE = `
export const BREEZ_API_KEY = 'test-key';
export const BREEZ_LNURL_DOMAIN = '';
`;

export async function resolve(specifier, context, next) {
  if (specifier === '@breeztech/breez-sdk-spark') {
    return { url: 'virtual:breez-fake-sdk', shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url === 'virtual:breez-fake-sdk') {
    return { format: 'module', source: FAKE_SDK_SOURCE, shortCircuit: true };
  }
  if (url.endsWith('/src/config/breez.js')) {
    return { format: 'module', source: FAKE_CONFIG_SOURCE, shortCircuit: true };
  }
  return next(url, context);
}
