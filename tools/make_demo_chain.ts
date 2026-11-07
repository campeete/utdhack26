/**
 * Builds a realistic audit export for the brief's synthetic Northstar Retail
 * incident, using the real appendEvent() code path. Output feeds the demo,
 * the Python verifier and the cross-language tests.
 *
 *   npx tsx tools/make_demo_chain.ts demo-data/audit_demo_export.json [incidentId]
 *
 * SYNTHETIC TRAINING DATA.
 */
import { writeFileSync } from 'node:fs';
import { appendEvent, type AppendInput } from '../spacetimedb/src/audit/append';
import { exportChain } from '../spacetimedb/src/audit/chain';
import { ctxFor, eventsOf, headOf, ident, makeDb } from '../tests/audit/fake_ctx';

export function buildDemo(incident = 7n) {
  const store = makeDb();
  const admin = ident('a1'), commander = ident('c1'), analyst = ident('b1'), reviewer = ident('d1'), agent = ident('e1');
  let t = 1794074400000000n; // 2026-11-07T18:00:00Z, response room opened
  const step = (who: typeof admin, input: Omit<AppendInput, 'incidentId'>, mins = 3, skewSec = 0) => {
    t += BigInt(mins) * 60_000_000n;
    const clientTs = skewSec === 0 ? t : t + BigInt(skewSec) * 1_000_000n;
    return appendEvent(ctxFor(store, who, t), { incidentId: incident, clientTsMicros: clientTs, ...input });
  };
  step(admin, { action: 'INCIDENT_CREATED', entityType: 'incident', entityId: incident, metadata: { title: 'Ransomware: customer portal', severity: 'critical', synthetic: true } }, 0);
  step(admin, { action: 'MEMBER_ADMITTED', entityType: 'identity', entityId: commander.toHexString(), metadata: { role: 'commander' } });
  step(admin, { action: 'MEMBER_ADMITTED', entityType: 'identity', entityId: analyst.toHexString(), metadata: { role: 'analyst' } }, 2);
  step(admin, { action: 'MEMBER_ADMITTED', entityType: 'identity', entityId: reviewer.toHexString(), metadata: { role: 'reviewer' } }, 2);
  step(analyst, { action: 'EVIDENCE_ADDED', entityType: 'evidence', entityId: 'E1', metadata: { title: 'Initial report', content_sha256: 'see evidence table' } });
  step(analyst, { action: 'SCOPE_ITEM_ADDED', entityType: 'scope_item', entityId: 'S1', metadata: { system: 'customer-db', encryption: 'confirmed', exfiltration: 'unknown' } });
  step(analyst, { action: 'EVIDENCE_ADDED', entityType: 'evidence', entityId: 'E2', metadata: { title: 'Monday backup restores in sandbox' } });
  step(commander, { action: 'CLAIM_CREATED', entityType: 'claim', entityId: 'C1', metadata: { statement: 'Monday backup predates the intrusion', standing: 'reported' } });
  step(commander, { action: 'DECISION_CREATED', entityType: 'decision', entityId: 'D1', metadata: { title: 'Restore customer portal from Monday backup' } });
  step(commander, { action: 'DECISION_ASSUMPTION_LINKED', entityType: 'decision', entityId: 'D1', metadata: { claim: 'C1', claim_version: 1 } }, 1);
  step(commander, { action: 'DECISION_APPROVED', entityType: 'decision', entityId: 'D1', metadata: { version: 1 } }, 1);
  step(reviewer, { action: 'MESSAGE_SENT', entityType: 'message', entityId: 1, metadata: { chars: 64 } }, 4, 540); // reviewer laptop clock 9 min fast
  step(analyst, { action: 'EVIDENCE_ADDED', entityType: 'evidence', entityId: 'E5', metadata: { title: 'Forensic update: access Sun 2026-11-01 03:12 UTC' } }, 6);
  step(analyst, { action: 'ANALYSIS_REQUESTED', entityType: 'evidence', entityId: 'E5' }, 1);
  step(agent, { action: 'PROPOSAL_STORED', entityType: 'proposal', entityId: 'P1', actorKind: 'service', metadata: { claim: 'C1', decision: 'D1', relationship: 'challenges', run: 'R1' } }, 1);
  step(analyst, { action: 'PROPOSAL_ACCEPTED', entityType: 'proposal', entityId: 'P1' }, 2);
  step(analyst, { action: 'DECISION_NEEDS_REVIEW', entityType: 'decision', entityId: 'D1', metadata: { cause: 'P1' } }, 0);
  step(analyst, { action: 'TASK_ASSIGNED', entityType: 'task', entityId: 'T1', metadata: { title: 'Investigate Sunday access; reassess backup' } }, 0);
  step(analyst, { action: 'BRIEFING_OUTDATED', entityType: 'briefing', entityId: 'B1', metadata: { revision: 1 } }, 0);
  step(admin, { action: 'MEMBER_REVOKED', entityType: 'identity', entityId: reviewer.toHexString(), metadata: { reason: 'device left unattended' } }, 5);
  step(commander, { action: 'DECISION_REVISED', entityType: 'decision', entityId: 'D1', metadata: { from_version: 1, to_version: 2, action: 'Pause restoration pending verification' } }, 3);
  return { store, incident, events: eventsOf(store, incident), head: headOf(store, incident) };
}

if (process.argv[1]?.endsWith('make_demo_chain.ts')) {
  const out = process.argv[2] ?? 'audit_demo_export.json';
  const { incident, events, head } = buildDemo(BigInt(process.argv[3] ?? '7'));
  writeFileSync(out, exportChain(incident, events, head));
  console.log(`wrote ${events.length} events for incident ${incident} -> ${out}`);
}
