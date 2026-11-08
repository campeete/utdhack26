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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Identity, Timestamp } from 'spacetimedb';
import { buildScenario, STARTER_RULE, type Person } from './scenario.ts';
import { arg, connectAdmin, step as runStep } from './connect.ts';

// IDs from the last run are remembered (in .spacetime/, never committed), so the next
// judge gets a fresh incident with one command: npm run demo:reset
const SAVED = '.spacetime/demo-people.json';
const saved = JSON.parse(await readFile(SAVED, 'utf8').catch(() => '{}')) as Record<string, string>;
const people_ = { nora: arg('nora') ?? saved.nora, lead: arg('lead') ?? saved.lead, commander: arg('commander') ?? saved.commander, analyst: arg('analyst') ?? saved.analyst };
const pick = (flag: 'lead' | 'commander' | 'analyst') => people_[flag];
const noraHex = people_.nora;
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

// Sign-ins cost one Nemotron call each, which can hit the free API's rate limit; the story
// demo does not need them. Add --signins to load the weekend of sign-ins for the Monitor.
if (process.argv.includes('--signins')) await step(`Loaded ${accounts.length} accounts and ${logins.length} weekend sign-ins into incident ${incident}`, () => conn.reducers.loadDemoScenario({
  incident_id: incident,
  accounts,
  logins: logins.map(l => ({ ...l, occurred_at: Timestamp.fromDate(l.occurred_at) })),
}));

if (![...conn.db.lowSeverityRules.iter()].some(r => r.situation === STARTER_RULE.situation)) {
  await step('Added the starter low-severity rule', () => conn.reducers.saveLowSeverityRule({ rule_id: undefined, ...STARTER_RULE, enabled: true }));
}

// The plan the team is working from: two confirmed decisions, each with the assumption it rests on.
await step('Named the setup identity', () => conn.reducers.setDisplayName({ display_name: 'Riley Chen (night lead)' }));
// Synthetic: the plan the night shift left behind, and what they were saying about it.
const PLAN = [
  { title: "Restore the customer portal from Monday's backup", assumption: "Monday's backup predates the intrusion",
    notes: ['Night shift: restore is queued for 09:00 once the backup is mounted.'] },
  { title: 'Keep payment processing online during containment', assumption: 'No evidence that the payment servers were accessed',
    notes: ['Payments team confirms no unusual logins on the payment servers so far.'] },
  { title: 'Reset passwords for every account in the leaked list', assumption: 'Only accounts in the leaked list were used by the attacker',
    notes: ['8 of the 12 leaked accounts are reset. The other 4 are on leave; their managers have been asked.'] },
  { title: 'Hold external communication until the scope is known', assumption: 'No customer data has left the network',
    notes: ['Legal asked for an update before noon. Nothing is going out until then.'] },
];
for (const d of PLAN) {
  const before = new Set([...conn.db.incidentDecisions.iter()].map(x => x.id));
  await step(`Recorded decision: ${d.title}`, () => conn.reducers.draftDecision({ incident_id: incident, title: d.title, assumption: d.assumption, evidence_ids: [] }));
  let row; for (let i = 0; i < 50 && !row; i++) { row = [...conn.db.incidentDecisions.iter()].find(x => !before.has(x.id)); if (!row) await new Promise(r => setTimeout(r, 100)); }
  if (row) await step('  Confirmed it', () => conn.reducers.approveDecision({ decision_id: row.id, expected_version: row.version }));
  for (const text of d.notes) if (row) await step('  Left a note in its discussion', () => conn.reducers.addIssueMessage({ decision_id: row.id, text, client_request_id: undefined, recipient: undefined }));
}
for (const [flag, tier] of [['lead', 'tier3'], ['commander', 'tier2'], ['analyst', 'tier1']] as const) {
  const hex = pick(flag)?.replace(/^0x/, '');
  if (!hex) continue;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) { console.error(`--${flag} must be the 64-character ID the dashboard shows.`); continue; }
  await step(`Admitted the ${flag} as ${tier}`, () => conn.reducers.admitMember({ incident_id: incident, user: Identity.fromString(hex), roles: [tier] }));
}

await mkdir('.spacetime', { recursive: true });
await writeFile(SAVED, JSON.stringify(Object.fromEntries(Object.entries(people_).filter(([, v]) => v)), null, 2));

console.log(`\nDone. Incident ${incident} is ready.${noraHex ? ' Nora will start analysing it within seconds if she is running.' : ' Start Nora with "npm run nora".'}`);
conn.disconnect();
process.exit(0);
