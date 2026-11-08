/**
 * Builds a realistic audit export for the synthetic Northstar Retail
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

/** Same incident, cast, record ids and times as the frontend fixture (src/data/fixtures.ts). */
export function buildDemo(incident = 'northstar') {
  const store = makeDb();
  const morgan = ident('b1'), sam = ident('d1'), agent = ident('e1');
  let t = 1794074400000000n; // 2026-11-07T18:00:00Z, response room opened
  const step = (who: typeof morgan, input: Omit<AppendInput, 'incidentId'>, mins = 3, skewSec = 0) => {
    t += BigInt(mins) * 60_000_000n;
    const clientTs = skewSec === 0 ? t : t + BigInt(skewSec) * 1_000_000n;
    return appendEvent(ctxFor(store, who, t), { incidentId: incident, clientTsMicros: clientTs, ...input });
  };
  step(morgan, { action: 'INCIDENT_CREATED', entityType: 'incident', entityId: incident, metadata: { title: 'Northstar Retail', severity: 'high', synthetic: true } }, 0); // 18:00
  step(morgan, { action: 'ROLE_CHANGED', entityType: 'identity', entityId: morgan.toHexString(), metadata: { name: 'Morgan Patel', roles: 'admin,commander,analyst' } }); // 18:03
  step(morgan, { action: 'SERVICE_ACCOUNT_SET', entityType: 'service_account', entityId: agent.toHexString(), metadata: { name: 'Nora', kind: 'nora', enabled: true } }, 2); // 18:05
  step(morgan, { action: 'MEMBER_ADMITTED', entityType: 'identity', entityId: sam.toHexString(), metadata: { name: 'Sam Rivera', role: 'reviewer' } }, 2);   // 18:07
  step(morgan, { action: 'SCOPE_ITEM_ADDED', entityType: 'scope_item', entityId: 'S-1', metadata: { system: 'Customer database', encryption: 'confirmed', exfiltration: 'unknown' } }, 5); // 18:12
  step(morgan, { action: 'SCOPE_ITEM_ADDED', entityType: 'scope_item', entityId: 'S-2', metadata: { system: 'Customer portal', encryption: 'suspected', exfiltration: 'unknown' } }, 2);       // 18:14
  step(morgan, { action: 'EVIDENCE_ADDED', entityType: 'evidence', entityId: 'E-002', metadata: { title: 'Backup validation report', source: 'source-backup' } });                         // 18:17
  step(morgan, { action: 'EVIDENCE_ADDED', entityType: 'evidence', entityId: 'E-003', metadata: { title: 'Independent recovery access', source: 'source-command' } }, 5);                   // 18:22
  step(morgan, { action: 'DECISION_CREATED', entityType: 'decision', entityId: 'D-001', metadata: { title: 'Restore customer portal', assumption: 'Monday backup predates the intrusion.', evidence: 'E-002' } }, 2); // 18:24
  step(morgan, { action: 'DECISION_APPROVED', entityType: 'decision', entityId: 'D-002', metadata: { version: 1 } }, 4);                                                                 // 18:28
  step(morgan, { action: 'EVIDENCE_ADDED', entityType: 'evidence', entityId: 'E-006', metadata: { title: 'Office printer outage', source: 'source-printer' } });                           // 18:31
  step(sam, { action: 'ACCESS_DENIED', entityType: 'decision', entityId: 'D-001', metadata: { attempted: 'DECISION_APPROVED', reason: 'reviewer role cannot approve' } }, 4, 540);      // 18:35, laptop clock 9 min fast
  step(morgan, { action: 'DECISION_APPROVED', entityType: 'decision', entityId: 'D-001', metadata: { version: 1, provisional: true } }, 7);                                                 // 18:42
  step(morgan, { action: 'BRIEFING_CREATED', entityType: 'briefing', entityId: 'B-001', metadata: { revision: 1 } }, 2);                                                                  // 18:44
  step(sam, { action: 'BRIEFING_REVIEWED', entityType: 'briefing', entityId: 'B-001', metadata: { revision: 1 } }, 1);                                                                  // 18:45
  step(morgan, { action: 'ANALYSIS_REQUESTED', entityType: 'evidence', entityId: 'E-002' }, 1);                                                                                         // 18:46
  step(agent, { action: 'PROPOSAL_STORED', entityType: 'proposal', entityId: 'P-001', actorKind: 'service', metadata: { source: 'source-backup', evidence: 'E-002', decision: 'D-001', relationship: 'source trust under review' } }, 1); // 18:47
  step(morgan, { action: 'SOURCE_TRUST_CHANGED', entityType: 'source', entityId: 'source-backup', metadata: { from: 'established', to: 'under_review' } }, 1);                           // 18:48
  step(morgan, { action: 'MESSAGE_SENT', entityType: 'message', entityId: 'M-1', metadata: { chars: 112 } }, 1);                                                                      // 18:49
  step(morgan, { action: 'EVIDENCE_ADDED', entityType: 'evidence', entityId: 'E-007', metadata: { title: 'Backup service account used by attacker', attacker_login: 'Sun 2026-11-01 03:12 UTC', source: 'source-credentials' } }, 3); // 18:52
  step(morgan, { action: 'SCOPE_ITEM_ADDED', entityType: 'scope_item', entityId: 'S-4', metadata: { system: 'Employee and service accounts', exposed: 11, used_by_attacker: 2, exfiltration: 'confirmed' } }, 0); // 18:52
  return { store, incident, events: eventsOf(store, incident), head: headOf(store, incident) };
}

if (process.argv[1]?.endsWith('make_demo_chain.ts')) {
  const out = process.argv[2] ?? 'audit_demo_export.json';
  const { incident, events, head } = buildDemo(process.argv[3] ?? 'northstar');
  writeFileSync(out, exportChain(incident, events, head));
  console.log(`wrote ${events.length} events for incident ${incident} -> ${out}`);
}
