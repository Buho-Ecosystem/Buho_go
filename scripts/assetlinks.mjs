#!/usr/bin/env node
/**
 * Digital Asset Links maintenance.
 *
 * Android App Links only open in the app when the certificate that signed the
 * installed APK is listed in `https://go.mybuho.de/.well-known/assetlinks.json`.
 * Get that wrong and nothing breaks loudly: links keep opening in the browser,
 * exactly as they did before, so the feature looks implemented and is not.
 *
 * The release fingerprint lives in a keystore that is deliberately not in this
 * repository, so it cannot be committed here once and forgotten. This script
 * exists so adding it is one command instead of a sequence of keytool flags
 * and hand-edited JSON:
 *
 *   npm run assetlinks -- add --keystore ~/keys/buhogo.jks --alias buhogo
 *   npm run assetlinks -- add --sha256 AA:BB:…            # paste from Play Console
 *   npm run assetlinks -- list
 *   npm run assetlinks -- verify                          # check what is deployed
 *
 * The password is never taken as an argument or read by this script: keytool
 * prompts for it directly, so it stays out of shell history and out of the
 * process table.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = resolve(ROOT, 'public/.well-known/assetlinks.json');

/** Must match `applicationId` in src-capacitor/android/app/build.gradle. */
const PACKAGE_NAME = 'mybuho.buhogo';

/** Where the file has to be reachable for Android to read it. */
const DEFAULT_ORIGIN = 'https://go.mybuho.de';

const RELATION = 'delegate_permission/common.handle_all_urls';

/** 32 colon-separated hex bytes, which is what keytool and Play both print. */
const FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

// ── file ────────────────────────────────────────────────────────────────────

function emptyDocument() {
  return [
    {
      relation: [RELATION],
      target: {
        namespace: 'android_app',
        package_name: PACKAGE_NAME,
        sha256_cert_fingerprints: [],
      },
    },
  ];
}

function read() {
  try {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
    if (!Array.isArray(parsed) || !parsed.length) return emptyDocument();
    return parsed;
  } catch {
    return emptyDocument();
  }
}

function write(doc) {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`);
}

function fingerprintsOf(doc) {
  return doc[0]?.target?.sha256_cert_fingerprints ?? [];
}

// ── keytool ─────────────────────────────────────────────────────────────────

/**
 * Read the SHA-256 fingerprint out of a keystore.
 *
 * `-storepass` is deliberately not passed: keytool prompts on stdin, which
 * keeps the password out of shell history and out of `ps`.
 */
function fingerprintFromKeystore(keystore, alias) {
  // keytool asks for the password on stdin. With no terminal to ask, it waits
  // forever, which in CI is a hung job rather than a failed one. Refuse up
  // front and point at the flag that needs no password.
  if (!process.stdin.isTTY) {
    throw new Error(
      'reading a keystore needs an interactive terminal, because keytool prompts ' +
        'for the password.\nRun this from a shell, or pass the fingerprint with ' +
        '--sha256 <AA:BB:...>.',
    );
  }

  const args = ['-list', '-v', '-keystore', keystore];
  if (alias) args.push('-alias', alias);

  let output;
  try {
    output = execFileSync('keytool', args, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  } catch (err) {
    const detail = (err.stderr || err.message || '').trim().split('\n')[0];
    throw new Error(
      `keytool failed: ${detail}\n` +
        'keytool ships with the JDK. If it is not on PATH, run the JDK copy directly, ' +
        'or pass the fingerprint with --sha256 instead.',
    );
  }

  const matches = [...output.matchAll(/SHA256:\s*([0-9A-F:]{95})/gi)].map((m) => m[1].toUpperCase());
  if (!matches.length) {
    // keytool prints the entry but omits the certificate when it could not
    // read the password, and it does so on exit code 0 in whatever language
    // the JDK is running in. Matching localised text would be worse than
    // naming the one cause that is almost always right.
    throw new Error(
      `no certificate found in ${keystore}\n` +
        'This usually means the keystore password was not entered. Run the command ' +
        'from an interactive terminal so keytool can prompt, or pass the fingerprint ' +
        'with --sha256 instead.',
    );
  }
  if (matches.length > 1 && !alias) {
    throw new Error(
      `${keystore} holds ${matches.length} keys. Pass --alias to say which one signs the release.`,
    );
  }
  return matches[0];
}

// ── commands ────────────────────────────────────────────────────────────────

function add({ keystore, alias, sha256 }) {
  const fingerprint = sha256
    ? String(sha256).trim().toUpperCase()
    : fingerprintFromKeystore(keystore, alias);

  if (!FINGERPRINT_RE.test(fingerprint)) {
    throw new Error(
      `"${fingerprint}" is not a SHA-256 fingerprint.\n` +
        'Expected 32 colon-separated hex bytes, e.g. AA:BB:CC:…',
    );
  }

  const doc = read();
  const existing = fingerprintsOf(doc);
  if (existing.includes(fingerprint)) {
    console.log(`Already listed: ${fingerprint}`);
    return;
  }

  doc[0].target.sha256_cert_fingerprints = [...existing, fingerprint];
  write(doc);
  console.log(`Added: ${fingerprint}`);
  console.log(`\n${FILE}\nDeploy the web build for Android to see it.`);
}

function list() {
  const fingerprints = fingerprintsOf(read());
  if (!fingerprints.length) {
    console.log('No fingerprints listed. App Links will not verify for anyone.');
    return;
  }
  console.log(`${PACKAGE_NAME} accepts ${fingerprints.length} certificate(s):`);
  for (const f of fingerprints) console.log(`  ${f}`);
}

/**
 * Compare what is deployed against what is in the repo.
 *
 * Android reads the deployed file, not this one, so a build that was never
 * published is the most likely reason for "I added it and it still opens the
 * browser".
 */
async function verify(origin) {
  const url = `${origin.replace(/\/$/, '')}/.well-known/assetlinks.json`;
  console.log(`Fetching ${url}`);

  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new Error(`could not reach ${url}: ${err.message}`);
  }
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);

  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) {
    console.warn(`  ! served as "${type}", Android expects application/json`);
  }

  const deployed = fingerprintsOf(JSON.parse(await res.text()));
  const local = fingerprintsOf(read());

  const missing = local.filter((f) => !deployed.includes(f));
  const extra = deployed.filter((f) => !local.includes(f));

  console.log(`  deployed: ${deployed.length} fingerprint(s)`);
  console.log(`  in repo:  ${local.length} fingerprint(s)`);
  for (const f of missing) console.log(`  ! in repo but not deployed: ${f}`);
  for (const f of extra) console.log(`  ! deployed but not in repo: ${f}`);

  if (!missing.length && !extra.length) console.log('  match');
  else process.exitCode = 1;
}

// ── entry ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) out[arg.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
    else out._.push(arg);
  }
  return out;
}

const USAGE = `Digital Asset Links for Android App Links

  npm run assetlinks -- add --keystore <path> [--alias <alias>]
  npm run assetlinks -- add --sha256 <AA:BB:...>
  npm run assetlinks -- list
  npm run assetlinks -- verify [--origin ${DEFAULT_ORIGIN}]
`;

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

try {
  if (command === 'add') {
    if (!args.keystore && !args.sha256) throw new Error(`add needs --keystore or --sha256\n\n${USAGE}`);
    add(args);
  } else if (command === 'list') {
    list();
  } else if (command === 'verify') {
    await verify(typeof args.origin === 'string' ? args.origin : DEFAULT_ORIGIN);
  } else {
    console.log(USAGE);
    process.exitCode = command ? 1 : 0;
  }
} catch (err) {
  console.error(`\n${err.message}\n`);
  process.exitCode = 1;
}
