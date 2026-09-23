// Read-only live check using the same nostr-core service as the contact UI.
import { performance } from 'node:perf_hooks';
import { PROFILE_SEARCH_RELAYS, classifyPeopleInput, searchProfiles } from '../src/services/profileSearch.js';

const query = process.argv[2] || 'drshift';
if (classifyPeopleInput(query) !== 'name') throw new Error('Provide a public name, not a key or identifier');
await Promise.all(PROFILE_SEARCH_RELAYS.map(async relay => {
  const started = performance.now();
  let firstMatchMs = null;
  const info = fetch(relay.replace('wss:', 'https:'), {
    headers: { Accept: 'application/nostr+json' }, signal: AbortSignal.timeout(8000),
  }).then(response => response.json()).then(doc => doc.supported_nips?.includes(50) === true).catch(() => null);
  const result = await searchProfiles(query, {
    relays: [relay], onResults: profiles => {
      if (profiles.length && firstMatchMs === null) firstMatchMs = Math.round(performance.now() - started);
    },
  });
  console.log(JSON.stringify({ relay, nip50: await info, complete: result.complete, matches: result.profiles.length,
    firstMatchMs, elapsedMs: Math.round(performance.now() - started) }));
}));
