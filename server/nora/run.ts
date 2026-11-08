// Starts Nora's watcher.
//
//   npm run nora
//
// Needs in .env: NVIDIA_API_KEY and SPACETIME_DB_NAME (SPACETIME_URI defaults to a
// local server). Optional: ABUSEIPDB_API_KEY, IPINFO_TOKEN, NORA_BACKLOG_MAX.

import { createBrain, loadAttackIds } from './brain.ts';
import { createEnricher, enrichConfigFromEnv } from './enrich.ts';
import { connectNora, spacetimeConfigFromEnv } from './spacetime.ts';
import { NoraWatcher } from './watcher.ts';

try { process.loadEnvFile('.env'); } catch { /* no .env file: use the shell environment */ }

const log = (msg: string) => console.log(`${new Date().toLocaleTimeString()}  Nora (Nemotron)  ${msg}`);

const brain = createBrain();
const enrich = enrichConfigFromEnv();
const attackIds = await loadAttackIds('data/threat-intel/attack-techniques.json', log);
const spacetime = spacetimeConfigFromEnv();

log(`Model ${brain.model}. Lookups: AbuseIPDB ${enrich.abuseIpDbKey ? 'on' : 'off (no key)'}, IPinfo ${enrich.ipInfoToken ? 'on' : 'off (no token)'}. ATT&CK ids: ${attackIds.size}.`);
log(`Connecting to ${spacetime.uri}, database ${spacetime.dbName}...`);

const { store, identity, disconnect } = await connectNora(spacetime, log);
const hex = identity.toHexString();
log(`Signed in as Nora (Nemotron): ${hex}`);

if (store.accounts().length === 0) {
  log('Nora sees no accounts yet. Either the demo is not loaded, or this identity is not registered as Nora.');
  log(`Register it with:  npm run demo:setup -- --nora ${hex}`);
}

const watcher = new NoraWatcher({
  store,
  brain,
  enricher: createEnricher(enrich, fetch, log),
  attackIds,
  backlogMax: Number(process.env.NORA_BACKLOG_MAX) >= 0 && process.env.NORA_BACKLOG_MAX ? Number(process.env.NORA_BACKLOG_MAX) : 25,
  log,
});
watcher.start();
log(`Watching ${store.logins().length} sign-ins and ${store.requests().length} queued reassessments. Press Ctrl+C to stop.`);

process.on('SIGINT', () => { log('Stopping.'); disconnect(); process.exit(0); });
