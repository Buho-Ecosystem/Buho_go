/**
 * The one way BuhoGO builds an NWC connection. Every screen and service gets
 * its connection from here (most through store.nwcConnection), so what each
 * NIP-47 request carries is decided in one place.
 *
 * Payments expire. NIP-47 lets a client tag a request with a NIP-40
 * `expiration`, after which a wallet that honours it ignores the request.
 * The SDK sends none, so a wallet that is slow to wake (an app on a phone,
 * woken by a push) could still pay minutes after BuhoGO stopped waiting and
 * told the person the payment was not confirmed. A payment the person was
 * told to check must not start after that.
 *
 * Only payments carry it. A read or an invoice answered late does no harm
 * (the answer is ignored), and the expiration is counted on the phone's
 * clock: a phone whose clock is behind the wallet's by more than the window
 * would see every tagged request ignored. Tagging payments only keeps such
 * a phone able to read its wallet and receive; its payments end as not
 * confirmed, never twice.
 */
import { NostrWebLNProvider, NWCClient } from '@getalby/sdk';
import { LOOKUP_DELAYS_MS } from './nwcPayment.js';

/** NIP-47 request events. */
const REQUEST_KIND = 23194;

/** The NIP-47 methods that spend: the only requests that expire. */
const PAYING_METHODS = new Set(['pay_invoice', 'multi_pay_invoice', 'pay_keysend', 'multi_pay_keysend']);

/** How long the SDK waits for the answer to a payment (its default reply wait). */
export const SDK_PAY_REPLY_WAIT_S = 60;

/**
 * How long a payment request stays valid, in seconds: the SDK's wait for
 * its answer, then the lookups that follow an unanswered one (nwcPayment).
 * A wallet may start a payment only while BuhoGO is still able to see how
 * it ended.
 */
export const REQUEST_TTL_S = SDK_PAY_REPLY_WAIT_S + LOOKUP_DELAYS_MS.reduce((sum, ms) => sum + ms, 0) / 1000;

/** A request event template with its `expiration` tag (any earlier one replaced). */
export function withExpiration(event, ttlSeconds = REQUEST_TTL_S) {
  if (event?.kind !== REQUEST_KIND) return event;
  const createdAt = Number(event.created_at) || Math.floor(Date.now() / 1000);
  const tags = (Array.isArray(event.tags) ? event.tags : []).filter((tag) => tag?.[0] !== 'expiration');
  return { ...event, tags: [...tags, ['expiration', String(createdAt + ttlSeconds)]] };
}

/** True for the plain text of a NIP-47 command that spends. */
function isPayingCommand(plain) {
  try {
    return PAYING_METHODS.has(JSON.parse(plain)?.method);
  } catch {
    return false;
  }
}

/**
 * Make a NIP-47 client sign its payment requests with an expiration. The
 * method is readable only before the request is encrypted, so `encrypt`
 * remembers which ciphertexts carry a payment and `signEvent`, the last
 * step before a request leaves, tags exactly those. Both are the SDK's
 * public methods, called on the instance for every request; nothing else
 * of the SDK is touched. Wrapping twice is harmless.
 *
 * @template T
 * @param {T} client the SDK's NWCClient
 * @returns {T}
 */
export function expirePayments(client) {
  if (!client || typeof client.signEvent !== 'function' || typeof client.encrypt !== 'function' || client.expiresPayments) {
    return client;
  }
  const encrypt = client.encrypt.bind(client);
  const sign = client.signEvent.bind(client);
  /** Ciphertexts of payment requests, until they are signed. */
  const paying = new Set();
  client.encrypt = async (pubkey, plain, ...rest) => {
    const ciphertext = await encrypt(pubkey, plain, ...rest);
    if (isPayingCommand(plain)) paying.add(ciphertext);
    return ciphertext;
  };
  client.signEvent = (event, ...rest) => {
    const expires = event?.kind === REQUEST_KIND && paying.delete(event.content);
    return sign(expires ? withExpiration(event) : event, ...rest);
  };
  client.expiresPayments = true;
  return client;
}

/** A NIP-47 client for a connection string. */
export function createNwcClient(nwcUrl) {
  return expirePayments(new NWCClient({ nostrWalletConnectUrl: nwcUrl }));
}

/** A WebLN provider for a connection string; its `client` is the NIP-47 client. */
export function createNwcProvider(nwcUrl) {
  const provider = new NostrWebLNProvider({ nostrWalletConnectUrl: nwcUrl });
  expirePayments(provider.client);
  return provider;
}
