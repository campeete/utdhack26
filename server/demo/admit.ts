// Lets a browser (or phone) into an incident, as the platform admin:
//
//   npm run demo:admit -- --user <identity shown by the dashboard> --tier tier3
//
// Tiers stack: tier1 triage, tier2 containment (approves Nora's fixes), tier3
// forensics and team management. Optional: --incident 2 (default: the newest).
// The dashboard shows its identity when it is not a member yet.

import { Identity } from 'spacetimedb';
import { arg, connectAdmin, step } from './connect.ts';

const userHex = arg('user');
const tier = (arg('tier') ?? arg('roles') ?? 'tier3').trim();
if (!['tier1', 'tier2', 'tier3'].includes(tier)) { console.error('--tier must be tier1, tier2 or tier3.'); process.exit(1); }
const roles = [tier];
if (!userHex || !/^(0x)?[0-9a-fA-F]{64}$/.test(userHex)) {
  console.error('Pass the identity the dashboard shows: npm run demo:admit -- --user <64 hex characters> --tier tier3');
  process.exit(1);
}
const conn = await connectAdmin();
const incidents = [...conn.db.myIncidents.iter()].sort((a, b) => (a.id < b.id ? 1 : -1));
const wanted = arg('incident');
const incident = wanted ? incidents.find(i => i.id.toString() === wanted) : incidents[0];
if (!incident) { console.error(wanted ? `No incident ${wanted}.` : 'No incidents yet. Run "npm run demo:setup" first.'); process.exit(1); }

await step(conn, `Admitted ${userHex.slice(0, 12)}… to incident ${incident.id} as ${tier}`,
  () => conn.reducers.admitMember({ incident_id: incident.id, user: Identity.fromString(userHex.replace(/^0x/, '')), roles }));
console.log('Press "Try again" in the dashboard.');
conn.disconnect();
process.exit(0);
