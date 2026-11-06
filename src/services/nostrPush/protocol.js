/**
 * Encrypted kind-7741 notification contract.
 *
 * This boundary knows the wire format, not wallets, sales, chat or UI. Callers
 * supply a signer and a clock; private keys never cross this interface. The
 * first release supports addressed NIP-44 messages and view actions. Other
 * payload fields are ignored rather than executed or fetched.
 *
 * Source, product decisions and rollout: docs/NOTIFICATIONS_PLAN.md.
 */
import { getEventHash, verifyEventSignature } from 'nostr-core';

export const NOTIFICATION_KIND = 7741;
export const NOTIFICATION_VERSION = '1.0';
export const DEFAULT_LIFETIME_SECONDS = 3600;
export const MAX_EVENT_BYTES = 16_384;
const MAX_PAYLOAD_BYTES = 8192;
const CLOCK_SKEW_SECONDS = 60;
const HEX = /^[0-9a-f]{64}$/;
const PRIORITIES = new Set(['urgent', 'high', 'default', 'low', 'min']);
const encoder = new TextEncoder();
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Stable codes only: errors must not echo plaintext, URLs or ciphertext. */
export class NotificationProtocolError extends Error {
  constructor(code) {
    super(code);
    this.name = 'NotificationProtocolError';
    this.code = code;
  }
}

function fail(code = 'INVALID_NOTIFICATION') {
  throw new NotificationProtocolError(code);
}

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const seconds = (value) => Number.isSafeInteger(value) && value >= 0;
const bytes = (value) => encoder.encode(JSON.stringify(value)).length;

function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail();
  return value;
}

function viewUrl(value) {
  text(value, 2048, true);
  if (/[\x00-\x20\x7f\\]/.test(value)) fail('UNSAFE_ACTION');
  try {
    const url = new URL(value);
    if (!['https:', 'buhogo:'].includes(url.protocol) || url.username || url.password) fail('UNSAFE_ACTION');
  } catch {
    fail('UNSAFE_ACTION');
  }
  return value;
}

/** Check the NIP-44 v2 envelope before publishing a signer's encryption result. */
function encryptedPayload(value) {
  try {
    if (typeof value !== 'string' || value.length > MAX_EVENT_BYTES) fail('INVALID_ENCRYPTION_RESULT');
    const decoded = atob(value);
    if (decoded.length < 99 || decoded.charCodeAt(0) !== 2 || btoa(decoded) !== value) fail('INVALID_ENCRYPTION_RESULT');
  } catch {
    fail('INVALID_ENCRYPTION_RESULT');
  }
  return value;
}

/**
 * Read a payload into a fresh, bounded object. It is still untrusted content:
 * the app's route handler must authorize the destination and unlock first.
 * Sender-provided priority never overrides the recipient's preferences.
 */
export function parseNotificationPayload(input) {
  let raw = input;
  if (typeof raw === 'string') {
    if (encoder.encode(raw).length > MAX_PAYLOAD_BYTES) fail('NOTIFICATION_TOO_LARGE');
    try { raw = JSON.parse(raw); } catch { fail(); }
  }
  if (!record(raw)) fail();
  if (raw.version !== NOTIFICATION_VERSION) fail('UNSUPPORTED_VERSION');
  const result = {
    version: NOTIFICATION_VERSION,
    message: text(raw.message, 2000, true),
  };
  if (raw.title !== undefined) result.title = text(raw.title, 200);
  if (raw.priority !== undefined) {
    if (!PRIORITIES.has(raw.priority)) fail();
    result.priority = raw.priority;
  }
  if (raw.timestamp !== undefined) {
    if (!seconds(raw.timestamp)) fail();
    result.timestamp = raw.timestamp;
  }
  if (raw.topic !== undefined) result.topic = text(raw.topic, 100);
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || raw.tags.length > 20) fail();
    result.tags = raw.tags.map((tag) => text(tag, 100, true));
  }
  if (raw.click !== undefined) result.click = viewUrl(raw.click);
  if (raw.actions !== undefined) {
    if (!Array.isArray(raw.actions) || raw.actions.length > 3) fail();
    result.actions = raw.actions.map((action) => {
      if (!record(action) || action.method !== 'view') fail('UNSUPPORTED_ACTION');
      return { label: text(action.label, 50, true), url: viewUrl(action.url), method: 'view' };
    });
  }
  if (bytes(result) > MAX_PAYLOAD_BYTES) fail('NOTIFICATION_TOO_LARGE');
  return result;
}

/** Exactly one value for routing/security tags; ambiguous tags are rejected. */
function tag(event, name) {
  const matches = event.tags.filter((entry) => entry[0] === name);
  if (matches.length !== 1 || typeof matches[0][1] !== 'string') fail();
  return matches[0][1];
}

/**
 * Verify before asking a key holder to decrypt. Recompute the ID explicitly:
 * signature validity alone must not allow changed content under an old ID.
 */
export function validateNotificationEvent(event, { recipient, now = nowSeconds() } = {}) {
  if (!HEX.test(recipient) || !seconds(now) || !record(event)) fail();
  try {
    if (bytes(event) > MAX_EVENT_BYTES) fail('NOTIFICATION_TOO_LARGE');
    if (event.kind !== NOTIFICATION_KIND || !HEX.test(event.pubkey) || !HEX.test(event.id)
      || !seconds(event.created_at) || typeof event.content !== 'string' || !event.content
      || !Array.isArray(event.tags) || event.tags.some((entry) => !Array.isArray(entry)
        || entry.some((value) => typeof value !== 'string'))) fail();
    if (event.id !== getEventHash(event) || !verifyEventSignature(event)) fail('INVALID_SIGNATURE');
    if (tag(event, 'p') !== recipient) fail('WRONG_RECIPIENT');
    text(tag(event, 'd'), 128, true);
    const expiration = tag(event, 'expiration');
    if (!/^\d+$/.test(expiration) || !seconds(Number(expiration))
      || Number(expiration) <= event.created_at) fail();
    if (Number(expiration) <= now) fail('EXPIRED_NOTIFICATION');
    if (event.created_at > now + CLOCK_SKEW_SECONDS) fail('FUTURE_NOTIFICATION');
    return { expiresAt: Number(expiration) };
  } catch (error) {
    if (error instanceof NotificationProtocolError) throw error;
    fail();
  }
}

/**
 * Build once, persist ciphertext, and reuse the returned event for retries.
 * signer: { pubkey, nip44Encrypt(peer, plaintext), signEvent(template) }.
 * The injected ID factory generates a random wire ID, never a source record ID.
 */
export async function createNotificationEvent({
  recipient, payload, signer, expiresAt, now = nowSeconds(),
  randomId = () => globalThis.crypto.randomUUID(),
} = {}) {
  if (!HEX.test(recipient) || !seconds(now) || !HEX.test(signer?.pubkey)
    || typeof signer?.nip44Encrypt !== 'function' || typeof signer?.signEvent !== 'function') fail();
  const author = signer.pubkey;
  const content = parseNotificationPayload(payload);
  const expiration = expiresAt ?? now + DEFAULT_LIFETIME_SECONDS;
  if (!seconds(expiration) || expiration <= now) fail('EXPIRED_NOTIFICATION');
  const identifier = text(randomId(), 128, true);
  const ciphertext = encryptedPayload(await signer.nip44Encrypt(recipient, JSON.stringify(content)));
  const template = {
    kind: NOTIFICATION_KIND,
    created_at: now,
    tags: [['p', recipient], ['d', identifier], ['expiration', String(expiration)]],
    content: ciphertext,
  };
  // Keep a detached template: an external signer can mutate its argument.
  const expected = JSON.stringify(template);
  const signed = await signer.signEvent(JSON.parse(expected));
  validateNotificationEvent(signed, { recipient, now });
  if (signed.pubkey !== author || JSON.stringify({
    kind: signed.kind, created_at: signed.created_at, tags: signed.tags, content: signed.content,
  }) !== expected) fail('INVALID_SIGNER_RESULT');
  return JSON.parse(JSON.stringify(signed));
}

/**
 * Addressed notifications only. Trust is explicit and checked before decryption;
 * encryption to a public key does not grant permission to interrupt its owner.
 * Invalid ciphertext is never retried as plaintext.
 */
export async function openNotificationEvent(event, {
  signer, allowedSenders = new Set(), now = nowSeconds(),
} = {}) {
  validateNotificationEvent(event, { recipient: signer?.pubkey, now });
  if (!(allowedSenders instanceof Set) || !allowedSenders.has(event.pubkey)) fail('UNTRUSTED_SENDER');
  if (typeof signer?.nip44Decrypt !== 'function') fail();
  let plaintext;
  try { plaintext = await signer.nip44Decrypt(event.pubkey, event.content); }
  catch { fail('DECRYPTION_FAILED'); }
  if (typeof plaintext !== 'string') fail('DECRYPTION_FAILED');
  return {
    id: event.id, sender: event.pubkey, createdAt: event.created_at,
    expiresAt: Number(tag(event, 'expiration')),
    payload: parseNotificationPayload(plaintext),
  };
}
