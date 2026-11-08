// Runs Nora (Nemotron)'s evidence investigation on the ransomware example with the
// real Nemotron API and no database. Nothing is written anywhere.
//
//   npm run nora:try-evidence
//   npm run nora:try-evidence -- urgent      (a report that should be escalated)
//   npm run nora:try-evidence -- unrelated   (a report that affects no decision)

import { createBrain } from './brain.ts';
import { discussionNote, escalationNote, investigate, type CaseFile } from './investigate.ts';

try { process.loadEnvFile('.env'); } catch { /* use the shell environment */ }

const REPORTS: Record<string, { title: string; text: string; source: string }> = {
  conflict: { title: 'Suspicious access on Sunday', source: 'Firewall logs', text: 'Firewall logs show an administrator session from an unknown host at 03:12 on Sunday, using the backup service account. The Monday backup job ran at 02:00 on Monday, after that session.' },
  urgent: { title: 'Backup contains encryptor', source: 'EDR scan of the backup volume', text: 'An EDR scan of the Monday backup volume found the same ransomware encryptor binary that encrypted the customer database. Restoring this backup would reintroduce the encryptor.' },
  unrelated: { title: 'Office printer outage', source: 'Facilities desk', text: 'The third-floor printer is offline after a firmware update. No network anomalies were seen.' },
};
const which = process.argv[2] ?? 'conflict';
const report = REPORTS[which] ?? REPORTS.conflict;

const file: CaseFile = {
  evidence: { id: 7n, ...report },
  otherEvidence: [{ id: 2n, title: 'Backup validation report', source: 'Recovery operations log', text: 'The Monday backup restored successfully in the isolated test environment. The test did not assess whether the backup predates initial access.' }],
  decisions: [
    { id: 1n, title: 'Restore the customer portal from Monday\'s backup', assumption: 'Monday\'s backup predates the intrusion', state: 'approved', evidenceIds: [2n] },
    { id: 2n, title: 'Keep recovery credentials independent of corporate SSO', assumption: 'Recovery credentials are independent of corporate SSO', state: 'approved', evidenceIds: [] },
  ],
  updates: [{ id: 1n, title: 'Response update · restoration plan', decisionIds: [1n], state: 'current' }],
  discussion: [
    { fromNora: false, text: 'Has restoration started?', at: '2026-11-08T05:00:00Z' },
    { fromNora: false, text: 'Not yet, waiting on the go-ahead.', at: '2026-11-08T05:01:00Z' },
  ],
  tasks: [],
};

const brain = createBrain();
console.log(`Model: ${brain.model}\nNew evidence (${which}): ${report.title}\n"${report.text}"\n\nNora (Nemotron) is investigating…\n`);
const started = Date.now();
const result = await investigate(file, async (system, user) => {
  const reply = await brain.finding(system, user);
  const r = reply as { tool?: string; args?: unknown };
  console.log(r.tool ? `  → uses tool ${r.tool} ${JSON.stringify(r.args ?? {})}` : '  → gives a verdict');
  return reply;
});
console.log(`\nVerdict after ${result.rounds} round(s), ${((Date.now() - started) / 1000).toFixed(1)} s: ${result.verdict.kind.toUpperCase()}`);
const v = result.verdict;
if (v.kind === 'no_impact') {
  console.log(`Saved quietly to the incident history: ${v.summary}`);
} else {
  const decision = file.decisions.find(d => d.id === v.decisionId)!;
  console.log(`\nSuggested review on D-${decision.id.toString().padStart(3, '0')}, quoting: "${v.excerpt}"\n\nDiscussion note:\n${discussionNote(v, file.evidence, decision)}`);
  if (v.kind === 'urgent') console.log(`\nDirect message to the incident lead:\n${escalationNote(v, file.evidence, decision)}`);
}
