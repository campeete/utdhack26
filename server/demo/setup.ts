// One command to set up a demo run, as the platform admin:
//
//   npm run demo:setup -- --nora <Nora's identity>
//   Optional: --analyst <ID> --commander <ID> --lead <ID> admits those browsers (tier1, tier2, tier3).
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
import { Identity, Timestamp } from 'spacetimedb';
import { buildScenario, STARTER_RULE, type Person } from './scenario.ts';
import { arg, connectAdmin, step as runStep } from './connect.ts';

const noraHex = arg('nora');
const gatewayHex = arg('gateway');
const people = (JSON.parse(await readFile('demo-data/people.json', 'utf8')) as { people: Person[] }).people;
const { accounts, logins } = buildScenario(people);

const conn = await connectAdmin();
const step = (label: string, run: () => Promise<void>) => runStep(conn, label, run);

if (noraHex) await step('Registered Nora', () => conn.reducers.setServiceAccount({ identity: Identity.fromString(noraHex), kind: 'nora', enabled: true }));
if (gatewayHex) await step('Registered the login gateway', () => conn.reducers.setServiceAccount({ identity: Identity.fromString(gatewayHex), kind: 'login_gateway', enabled: true }));

const before = new Set([...conn.db.myIncidents.iter()].map(i => i.id));
await step('Created the incident', () => conn.reducers.createIncident({
  title: arg('title') ?? 'Northstar Retail: weekend account takeover',
  summary: 'Synthetic training incident. Leaked staff passwords were used over the weekend; the backup service account was accessed.',
  severity: 'unknown',
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

// The plan the team is working from: two confirmed decisions, each with the assumption it rests on.
await step('Named the setup identity', () => conn.reducers.setDisplayName({ display_name: 'Incident lead (setup)' }));
const PLAN = [
  { title: "Restore the customer portal from Monday's backup", assumption: "Monday's backup predates the intrusion" },
  { title: 'Keep payment processing online during containment', assumption: 'No evidence that the payment servers were accessed' },
];
for (const d of PLAN) {
  const before = new Set([...conn.db.incidentDecisions.iter()].map(x => x.id));
  await step(`Recorded decision: ${d.title}`, () => conn.reducers.draftDecision({ incident_id: incident, title: d.title, assumption: d.assumption, evidence_ids: [] }));
  let row; for (let i = 0; i < 50 && !row; i++) { row = [...conn.db.incidentDecisions.iter()].find(x => !before.has(x.id)); if (!row) await new Promise(r => setTimeout(r, 100)); }
  if (row) await step('  Confirmed it', () => conn.reducers.approveDecision({ decision_id: row.id, expected_version: row.version }));
}
for (const [flag, tier] of [['lead', 'tier3'], ['commander', 'tier2'], ['analyst', 'tier1']] as const) {
  const hex = arg(flag)?.replace(/^0x/, '');
  if (!hex) continue;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) { console.error(`--${flag} must be the 64-character ID the dashboard shows.`); continue; }
  await step(`Admitted the ${flag} as ${tier}`, () => conn.reducers.admitMember({ incident_id: incident, user: Identity.fromString(hex), roles: [tier] }));
}

console.log(`\nDone. Incident ${incident} is ready.${noraHex ? ' Nora will start analysing it within seconds if she is running.' : ' Start Nora with "npm run nora".'}`);
conn.disconnect();
process.exit(0);
