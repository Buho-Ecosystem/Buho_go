/**
 * The one way BuhoGO builds an NWC connection. Every screen and service gets
 * its connection from here (most through store.nwcConnection), so what each
 * NIP-47 request carries is decided in one place.
 *
 * Requests expire. NIP-47 lets a client tag a request with a NIP-40
 * `expiration`, after which the wallet must not act on it. The SDK sends
 * none, so a wallet that is slow to wake (an app on a phone, woken by a push)
 * could still pay minutes after BuhoGO stopped waiting and told the person
 * the payment was not confirmed. A payment the person was told to check
 * must not start after that.
 */
import { NostrWebLNProvider, NWCClient } from '@getalby/sdk';
import { LOOKUP_DELAYS_MS } from './nwcPayment.js';

/** NIP-47 request events. */
const REQUEST_KIND = 23194;

/** How long the SDK waits for the answer to a payment (its default reply wait). */
export const SDK_PAY_REPLY_WAIT_S = 60;

/**
 * How long a request stays valid, in seconds: the SDK's wait for a payment's
 * answer, then the lookups that follow an unanswered one (nwcPayment). A
 * wallet may start a payment only while BuhoGO is still able to see how it
 * ended. One window for every method, because the request is encrypted by
 * the time it is signed; a read answered late is ignored anyway.
 */
export const REQUEST_TTL_S = SDK_PAY_REPLY_WAIT_S + LOOKUP_DELAYS_MS.reduce((sum, ms) => sum + ms, 0) / 1000;

/** A request event template with its `expiration` tag (any earlier one replaced). */
export function withExpiration(event, ttlSeconds = REQUEST_TTL_S) {
  if (event?.kind !== REQUEST_KIND) return event;
  const createdAt = Number(event.created_at) || Math.floor(Date.now() / 1000);
  const tags = (Array.isArray(event.tags) ? event.tags : []).filter((tag) => tag?.[0] !== 'expiration');
  return { ...event, tags: [...tags, ['expiration', String(createdAt + ttlSeconds)]] };
}

/**
 * Make a NIP-47 client sign every request with an expiration. Signing is the
 * SDK's last step before a request leaves, and `signEvent` is public, so
 * nothing else of the SDK is touched. Wrapping twice is harmless.
 *
 * @template T
 * @param {T} client the SDK's NWCClient
 * @returns {T}
 */
export function expireRequests(client) {
  if (!client || typeof client.signEvent !== 'function' || client.signEvent.expiresRequests) return client;
  const sign = client.signEvent.bind(client);
  const signExpiring = (event, ...rest) => sign(withExpiration(event), ...rest);
  signExpiring.expiresRequests = true;
  client.signEvent = signExpiring;
  return client;
}

/** A NIP-47 client for a connection string. */
export function createNwcClient(nwcUrl) {
  return expireRequests(new NWCClient({ nostrWalletConnectUrl: nwcUrl }));
}

/** A WebLN provider for a connection string; its `client` is the NIP-47 client. */
export function createNwcProvider(nwcUrl) {
  const provider = new NostrWebLNProvider({ nostrWalletConnectUrl: nwcUrl });
  expireRequests(provider.client);
  return provider;
}
