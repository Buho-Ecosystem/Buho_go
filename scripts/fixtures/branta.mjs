// Local Guardrail wire fixtures encrypted by the public Branta 4.3 API.
// Publishing is intercepted in-memory; no service, API key or funds are used.
import assert from 'node:assert/strict';
import { BrantaService } from '@branta-ops/branta';

export const GUARDRAIL = 'https://guardrail.branta.pro';
export const MERCHANT = 'Kaffeehaus Lindgren';
export const LOGO = `${GUARDRAIL}/logos/kaffeehaus.svg`;
export const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#1b3443"/><text x="20" y="27" text-anchor="middle" font-family="serif" font-size="24" fill="#fff1d1">K</text></svg>';
export const ADDRESS = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
export const OTHER_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
export const FIXTURE_ID = 'local-branta-fixture';
const SECRET = 'local-fixture-secret-not-a-credential';

export function proofUri(address = ADDRESS, { encoded = false, amount = '0.000024' } = {}) {
  return `bitcoin:${address}?amount=${amount}&${encoded ? 'branta%5fid' : 'branta_id'}=${FIXTURE_ID}&branta_secret=${SECRET}`;
}

/** Generate encrypted API records and independently check real SDK decrypts them. */
export async function brantaFixture({ destinations, name = MERCHANT, description = 'Flat white and cake', logo = LOGO, childName = '', ttl = 3600 } = {}) {
  let wire;
  const requests = [];
  const client = new BrantaService({
    environment: 'Production', apiKey: 'in-memory-fixture-only',
    fetchImpl: async (input, options = {}) => {
      requests.push({ url: String(input), method: options.method || 'GET' });
      if (options.method === 'POST') {
        wire = { ...JSON.parse(options.body), created_at: new Date().toISOString() };
        return Response.json(wire);
      }
      return Response.json([wire]);
    },
  }, { secretGenerator: { generate: () => SECRET, deterministicNonce: true } });
  await client.addPayment({
    platform: name, platformLogoLightUrl: logo, description, ttl,
    ...(childName ? { childPlatform: { name: childName, logoLightUrl: logo } } : {}),
    destinations: destinations.map((destination, index) => ({ id: `fixture-${index}`, ...destination })),
  });
  assert.ok(wire?.destinations?.every(destination => destination.zk === true), 'fixture records use actual SDK encryption');
  return {
    wire,
    async verify(input, expected = 'match') {
      const result = await client.verify(input);
      assert.equal(result.status, expected, 'actual SDK fixture round-trip');
      return result;
    },
    get requests() { return requests; },
  };
}
