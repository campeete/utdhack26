import type { Snapshot } from '../../shared/contracts';
import { northstarAccounts } from './northstar-accounts.ts';
const incidentId = 'northstar';
const base = (id: string) => ({ id, incidentId, version: 1 });
export function createFixture(): Snapshot {
  const accounts = structuredClone(northstarAccounts);
  const leaked = accounts.filter(a => a.inCredentialLeak).length;
  const attackerUsed = accounts.filter(a => a.usedByAttacker);
  const privilegedLeaked = accounts.filter(a => a.inCredentialLeak && a.privileged).length;
  return {
    incident: { id: incidentId, title: 'Northstar Retail', summary: 'Customer portal disruption', status: 'Investigating', severity: 'High', commander: 'Morgan Patel' },
    sources: [
      { ...base('source-backup'), label: 'Recovery operations log', trust: 'under_review', reason: 'The reporting account may have been accessed during the incident. Independently verify the report and backup timeline.' },
      { ...base('source-command'), label: 'Incident lead’s response notes', trust: 'established', reason: 'Recorded directly in the synthetic response room.' },
      { ...base('source-printer'), label: 'Facilities desk', trust: 'established', reason: 'Unrelated facilities report.' },
      { ...base('source-credentials'), label: 'Credential dump analysis', trust: 'established', reason: 'Synthetic attacker credential dump compared against the account directory by the response team.' },
    ],
    evidence: [
      { ...base('E-002'), title: 'Backup validation report', sourceId: 'source-backup', text: 'The Monday backup restored successfully in the isolated test environment. The test did not assess whether the backup predates initial access or contains compromised artifacts.', standing: 'reported', eventTime: '2026-11-02T02:00:00Z', recordedAt: '2026-11-07T18:17:00Z' },
      { ...base('E-003'), title: 'Independent recovery access', sourceId: 'source-command', text: 'Use independently administered recovery credentials. Corporate SSO remains outside the recovery trust boundary.', standing: 'reported', eventTime: '2026-11-07T18:22:00Z', recordedAt: '2026-11-07T18:22:00Z' },
      { ...base('E-006'), title: 'Office printer outage', sourceId: 'source-printer', text: 'The third-floor printer is offline. No demonstrated connection to portal recovery.', standing: 'reported', eventTime: '2026-11-07T18:30:00Z', recordedAt: '2026-11-07T18:31:00Z' },
      { ...base('E-007'), title: 'Backup service account used by attacker', sourceId: 'source-credentials', text: `${leaked} of ${accounts.length} accounts appear in the attacker's credential dump (${privilegedLeaked} privileged). The attacker used ${attackerUsed.length}: ${attackerUsed.map(a => a.jobTitle).join(' and ')}. The backup service account shows a suspected attacker login on Sunday 2026-11-01 03:12 UTC, before the Monday backup was taken.`, standing: 'reported', eventTime: '2026-11-01T03:12:00Z', recordedAt: '2026-11-07T18:52:00Z' },
    ],
    decisions: [
      { ...base('D-001'), title: 'Restore Customer Portal', rationale: 'Restore service from the Monday backup in an isolated environment while the investigation continues. Approval is provisional and depends on validating the recovery assumptions.', assumption: 'Monday backup predates the intrusion.', evidenceIds: ['E-002'], owner: 'Morgan Patel', state: 'approved', approvedAt: '2026-11-07T18:42:00Z' },
      { ...base('D-002'), title: 'Keep recovery credentials independent', rationale: 'Use the separate response identity boundary for all recovery work.', assumption: 'Recovery credentials are independent of corporate SSO.', evidenceIds: ['E-003'], owner: 'Morgan Patel', state: 'approved', approvedAt: '2026-11-07T18:28:00Z' },
      { ...base('D-003'), title: 'Hold external communication', rationale: 'Prepare a factual update for human review when the affected scope is clearer.', assumption: 'Exfiltration remains unknown.', evidenceIds: [], owner: 'Sam Rivera', state: 'draft' },
    ],
    briefings: [{ ...base('B-001'), title: 'Response briefing · revision 1', text: 'Portal restoration is provisionally approved in isolation. Backup timing and integrity require verification. Customer database encryption is confirmed; exfiltration remains unknown.', decisionIds: ['D-001'], state: 'reviewed' }],
    proposals: [{ ...base('P-001'), sourceId: 'source-backup', sourceVersion: 1, evidenceId: 'E-002', evidenceVersion: 1, decisionVersions: { 'D-001': 1 }, briefingVersions: { 'B-001': 1 }, excerpt: 'The Monday backup restored successfully in the isolated test environment.', explanation: 'Trust in the reporting account is under review. Recheck the source and recovery assumptions before relying on the provisional approval. This does not establish that the report is false or the backup is compromised.', verification: 'Independently verify the backup timeline and integrity before continuing restoration.', origin: 'synthetic', state: 'pending' }],
    tasks: [],
    activity: [
      { ...base('A-4'), actor: 'Morgan Patel', at: '2026-11-07T18:52:00Z', text: `Credential dump compared to the account directory: ${leaked} accounts exposed, ${attackerUsed.length} used by the attacker and disabled.` },
      { ...base('A-3'), actor: 'Morgan Patel', at: '2026-11-07T18:48:00Z', text: 'Recovery operations source marked Trust under review. Evidence standing remains Reported.' },
      { ...base('A-2'), actor: 'Morgan Patel', at: '2026-11-07T18:42:00Z', text: 'D-001 approved provisionally with an explicit backup timing assumption.' },
      { ...base('A-1'), actor: 'Morgan Patel', at: '2026-11-07T18:17:00Z', text: 'Backup validation report added to the incident.' },
    ],
    messages: [{ ...base('M-0'), evidenceId: 'E-007', recipientId: '', author: 'Nora (Nemotron)', at: '2026-11-07T18:53:00Z', text: 'New evidence E-007 (Backup service account used by attacker) challenges D-001 (Restore customer portal). The attacker login on Sunday came before the Monday backup, so the backup may hold their changes. Suggested check: compare the backup against a known-clean snapshot before restoring. A person decides what happens next.' }, { ...base('M-1'), evidenceId: 'E-002', recipientId: 'U-3', author: 'Morgan Patel', at: '2026-11-07T18:49:00Z', text: 'The restore test is useful, but it does not establish that the backup is clean. I’ve queued a source review.' }],
    scope: [
      { ...base('S-1'), system: 'Customer database', data: 'Customer account records', extent: 'Extent under investigation', encryption: 'confirmed', exfiltration: 'unknown', owner: 'Morgan Patel' },
      { ...base('S-2'), system: 'Customer portal', data: 'Application services', extent: 'Portal unavailable', encryption: 'suspected', exfiltration: 'unknown', owner: 'Morgan Patel' },
      { ...base('S-3'), system: 'Recovery environment', data: 'Monday backup', extent: 'Isolated sandbox only', encryption: 'not_observed', exfiltration: 'not_observed', owner: 'Morgan Patel' },
      { ...base('S-4'), system: 'Employee and service accounts', data: `${accounts.length} accounts`, extent: `${leaked} credentials in attacker dump · ${attackerUsed.length} used by attacker`, encryption: 'not_observed', exfiltration: 'confirmed', owner: 'Morgan Patel' },
    ],
    members: [{ ...base('U-2'), name: 'Morgan Patel', roles: ['tier3'], active: true }, { ...base('U-3'), name: 'Sam Rivera', roles: ['tier1'], active: true }],
    accounts,
    findings: [
      { ...base('F-1'), accountRef: 'NSR-SVC-01', severity: 'critical', queue: 'needs_human', title: 'Backup service account signed in from an unknown Linux desktop with a leaked password', reason: 'NSR-SVC-01 is privileged and in the credential leak. This password-only sign-in came from a device and network it has never used.', clues: { breached_password: true, new_device: true, new_network: true }, attackTechnique: 'T1078', proposedFix: 'Disable NSR-SVC-01 and rotate its credentials before the next backup run.', proposedAction: 'disable_account', state: 'open', dismissalFeedback: '', model: 'sample (fixture)', createdAt: '2026-11-07T09:05:00Z', signIn: 'Desktop / Linux / Firefox from 203.0.113.66, password only' },
      { ...base('F-2'), accountRef: 'NSR-1002', severity: 'medium', queue: 'needs_human', title: 'Failed sign-in to NSR-1002 from the attacker\u2019s machine', reason: 'One of four failed attempts within ten minutes from the same unknown device: a password spray. No access was gained.', clues: { new_device: true, new_network: true }, attackTechnique: 'T1110.003', proposedFix: 'Watch NSR-1002 for further attempts.', proposedAction: 'monitor_only', state: 'open', dismissalFeedback: '', model: 'sample (fixture)', createdAt: '2026-11-07T08:31:00Z', signIn: 'Desktop / Linux / Firefox from 203.0.113.66, failed password' },
      { ...base('F-3'), accountRef: 'NSR-1012', severity: 'low', queue: 'low_severity', title: 'Routine sign-in with a leaked password', reason: 'Usual laptop and office network with 2FA, but the password is in the leak.', clues: { breached_password: true, new_device: false, new_network: false }, attackTechnique: '', proposedFix: 'Require a password reset at next sign-in.', proposedAction: 'force_password_reset', ruleId: '1', state: 'auto_fixed', decidedBy: 'Nora (Nemotron)', decidedAt: '2026-11-07T07:12:00Z', dismissalFeedback: '', model: 'sample (fixture)', createdAt: '2026-11-07T07:12:00Z', signIn: 'Laptop / Windows / Edge from 198.51.100.44, password + 2FA' },
    ],
    audit: { entries: [], verified: null },
    evidenceReviews: [
      { evidenceId: 'E-007', outcome: 'conflict', decisionId: 'D-001', proposalId: 'P-001', summary: 'The Sunday attacker login precedes the Monday backup.', at: '2026-11-07T18:53:00Z' },
      { evidenceId: 'E-006', outcome: 'no_impact', summary: 'A printer outage does not affect any open decision.', at: '2026-11-07T18:32:00Z' },
    ],
  };
}
