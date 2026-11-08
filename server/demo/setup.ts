// One command to set up a demo run, as the platform admin:
//
//   npm run demo:setup -- --nora <Nora's identity>
//
// It registers Nora's identity (printed when you start "npm run nora"), adds the
// starter low-severity rule if it is missing, creates a fresh incident, and loads the
// 40 invented Northstar accounts and the seeded weekend of sign-ins into it.
// Run it again for a fresh incident; earlier ones and their audit chains stay intact.
//
// It signs in with the SpacetimeDB CLI's own token (the identity that published the
// module), read from ~/.config/spacetime/cli.toml or SPACETIME_ADMIN_TOKEN. The token
// is used only to connect and is never printed.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Identity, Timestamp } from 'spacetimedb';
import { DbConnection } from './bindings.ts';
import { buildScenario, STARTER_RULE, type Person } from './scenario.ts';
import { spacetimeConfigFromEnv } from '../nora/spacetime.ts';

try { process.loadEnvFile('.env'); } catch { /* use the shell environment */ }

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };

async function adminToken(): Promise<string> {
  const fromEnv = process.env.SPACETIME_ADMIN_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const path = join(homedir(), '.config', 'spacetime', 'cli.toml');
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch { throw new Error(`No SpacetimeDB CLI config at ${path}. Publish the module with the CLI first, or set SPACETIME_ADMIN_TOKEN.`); }
  const m = /^\s*spacetimedb_token\s*=\s*"([^"]+)"/m.exec(text);
  if (!m) throw new Error(`No spacetimedb_token in ${path}. Run "spacetime login" (or publish once) and try again.`);
  return m[1];
}

const { uri, dbName } = spacetimeConfigFromEnv();
const noraHex = arg('nora');
const gatewayHex = arg('gateway');
const people = (JSON.parse(await readFile('demo-data/people.json', 'utf8')) as { people: Person[] }).people;
const { accounts, logins } = buildScenario(people);

const conn = await new Promise<DbConnection>((resolve, reject) => {
  adminToken().then(token => DbConnection.builder()
    .withUri(uri).withDatabaseName(dbName).withToken(token)
    .onConnect(c => resolve(c))
    .onConnectError((_ctx, e) => reject(new Error(`Could not connect to ${uri} (${dbName}): ${e.message}`)))
    .build(), reject);
});
await new Promise<void>((resolve, reject) => conn.subscriptionBuilder()
  .onApplied(() => resolve()).onError(() => reject(new Error('Subscription failed.')))
  .subscribe(['SELECT * FROM my_incidents', 'SELECT * FROM low_severity_rules']));

const step = async (label: string, run: () => Promise<void>) => {
  try { await run(); console.log(`✔ ${label}`); }
  catch (e) { console.error(`✘ ${label}: ${(e as Error).message}`); conn.disconnect(); process.exit(1); }
};

if (noraHex) await step('Registered Nora', () => conn.reducers.setServiceAccount({ identity: Identity.fromString(noraHex), kind: 'nora', enabled: true }));
if (gatewayHex) await step('Registered the login gateway', () => conn.reducers.setServiceAccount({ identity: Identity.fromString(gatewayHex), kind: 'login_gateway', enabled: true }));

const before = new Set([...conn.db.myIncidents.iter()].map(i => i.id));
await step('Created the incident', () => conn.reducers.createIncident({
  title: arg('title') ?? 'Northstar Retail: weekend account takeover',
  summary: 'Synthetic training incident. Leaked staff passwords were used over the weekend; the backup service account was accessed.',
  severity: 'high',
}));
const incident = await new Promise<bigint>((resolve, reject) => {
  const find = () => [...conn.db.myIncidents.iter()].find(i => !before.has(i.id))?.id;
  const now = find(); if (now !== undefined) return resolve(now);
  const timer = setTimeout(() => reject(new Error('The new incident did not appear.')), 10_000);
  conn.db.myIncidents.onInsert((_ctx, row) => { if (!before.has(row.id)) { clearTimeout(timer); resolve(row.id); } });
});

await step(`Loaded ${accounts.length} accounts and ${logins.length} weekend sign-ins into incident ${incident}`, () => conn.reducers.loadDemoScenario({
  incident_id: incident,
  accounts,
  logins: logins.map(l => ({ ...l, occurred_at: Timestamp.fromDate(l.occurred_at) })),
}));

if (![...conn.db.lowSeverityRules.iter()].some(r => r.situation === STARTER_RULE.situation)) {
  await step('Added the starter low-severity rule', () => conn.reducers.saveLowSeverityRule({ rule_id: undefined, ...STARTER_RULE, enabled: true }));
}

console.log(`\nDone. Incident ${incident} is ready.${noraHex ? ' Nora will start analysing it within seconds if she is running.' : ' Start Nora with "npm run nora".'}`);
conn.disconnect();
process.exit(0);
