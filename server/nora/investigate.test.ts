import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Identity, Timestamp } from 'spacetimedb';
import { checkVerdict, discussionNote, investigate, MAX_ROUNDS, runTool, supportsNote, type CaseFile } from './investigate.ts';
import { NoraWatcher, type NoraStore } from './watcher.ts';
import type { Evidence } from './bindings.ts';

const REPORT = 'Firewall logs show an admin session from an unknown host at 03:12 on Sunday. The Monday backup ran after that session.';
const file = (over: Partial<CaseFile> = {}): CaseFile => ({
  evidence: { id: 7n, title: 'Sunday access report', text: REPORT, source: 'Firewall' },
  otherEvidence: [{ id: 2n, title: 'Backup validation report', text: 'The Monday backup restored successfully in the isolated test environment.', source: 'Recovery log' }],
  decisions: [
    { id: 3n, title: 'Restore from Monday backup', assumption: "Monday's backup predates the intrusion", state: 'approved', evidenceIds: [2n] },
    { id: 4n, title: 'Old plan', assumption: 'x', state: 'closed', evidenceIds: [] },
  ],
  updates: [{ id: 1n, title: 'Restore plan', decisionIds: [3n], state: 'current' }],
  discussion: [{ fromNora: false, text: 'Has restoration started?', at: '2026-11-08T05:00:00Z' }, { fromNora: false, text: 'Not yet.', at: '2026-11-08T05:01:00Z' }],
  tasks: [],
  ...over,
});
const CONFLICT = { impact: 'conflict', decision_id: 3, excerpt: 'The Monday backup ran after that session.', explanation: "If the intruder was in before Monday's backup, the backup may hold their changes.", verification: 'Find when the intrusion began before restoring.', reason: 'Timeline contradicts the assumption.' };

/** A scripted Nemotron: returns each reply in order and records what it was asked. */
function scripted(...replies: unknown[]) {
  const asked: string[] = [];
  return { asked, ask: async (_system: string, user: string) => { asked.push(user); if (!replies.length) throw new Error('no more replies'); return replies.shift(); } };
}

test('tools read the case file and only that', () => {
  const f = file();
  assert.deepEqual((runTool('list_decisions', {}, f) as { id: number }[]).map(d => d.id), [3]); // closed decision hidden
  assert.deepEqual((runTool('get_decision', { id: 3 }, f) as { team_updates: unknown[] }).team_updates, [{ title: 'Restore plan', state: 'current' }]);
  assert.equal((runTool('search_evidence', { query: 'monday backup' }, f) as { id: number }[])[0].id, 2);
  assert.equal((runTool('recent_discussion', { limit: 1 }, f) as { text: string }[])[0].text, 'Not yet.');
  assert.match(JSON.stringify(runTool('drop_tables', {}, f)), /Unknown tool/);
  assert.match(JSON.stringify(runTool('get_decision', { id: 99 }, f)), /No decision/);
});

test('Nemotron investigates with tools, then gives a verdict that passes the hard rules', async () => {
  const nemotron = scripted({ tool: 'list_decisions', args: {} }, { tool: 'recent_discussion', args: { limit: 5 } }, { final: CONFLICT });
  const result = await investigate(file(), nemotron.ask);
  assert.equal(result.rounds, 3);
  assert.deepEqual(result.toolsUsed, ['list_decisions', 'recent_discussion']);
  assert.equal(result.verdict.kind, 'conflict');
  assert.match(nemotron.asked[2], /TOOL RESULTS SO FAR/);
  assert.match(nemotron.asked[2], /Not yet\./);
});

test('the hard rules reject invented decisions, closed decisions and invented quotes', () => {
  assert.throws(() => checkVerdict({ ...CONFLICT, decision_id: 99 }, file()), /does not exist/);
  assert.throws(() => checkVerdict({ ...CONFLICT, decision_id: 4 }, file()), /already closed/);
  assert.throws(() => checkVerdict({ ...CONFLICT, excerpt: 'The backup is infected.' }, file()), /not in the evidence/);
  assert.throws(() => checkVerdict({ ...CONFLICT, verification: '' }, file()), /left out/);
  assert.throws(() => checkVerdict({ impact: 'panic' }, file()), /unknown impact/);
  assert.deepEqual(checkVerdict({ impact: 'no_impact', summary: 'Printer outage.' }, file()), { kind: 'no_impact', summary: 'Printer outage.' });
});

test('with no open decision there is nothing to challenge, and Nemotron is not called', async () => {
  const nemotron = scripted();
  const result = await investigate(file({ decisions: [] }), nemotron.ask);
  assert.equal(result.verdict.kind, 'no_impact');
  assert.equal(nemotron.asked.length, 0);
});

test('Nemotron that never answers is cut off after the last round', async () => {
  const nemotron = scripted(...Array.from({ length: MAX_ROUNDS }, () => ({ tool: 'list_decisions', args: {} })));
  await assert.rejects(() => investigate(file(), nemotron.ask), /did not reach a verdict/);
  assert.match(nemotron.asked.at(-1)!, /last reply/);
});

test('the discussion note names the evidence, the decision and the check', () => {
  const v = checkVerdict(CONFLICT, file());
  if (v.kind === 'no_impact' || v.kind === 'supports') throw new Error('expected conflict');
  const note = discussionNote(v, file().evidence, file().decisions[0]);
  assert.match(note, /E-007/); assert.match(note, /D-003/); assert.match(note, /Find when the intrusion began/); assert.match(note, /a person decides/);
});

// ---------------------------------------------------------------- watcher wiring

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const nora = Identity.fromString('ab'.repeat(32));
const lead = Identity.fromString('cd'.repeat(32));
function evidenceRow(id: bigint, text = REPORT): Evidence {
  return { id, incidentId: 1n, title: 'Sunday access report', sourceLabel: 'Firewall', sourceType: 'report', contentText: text, eventTime: ts('2026-11-08T03:12:00Z'), recordedAt: ts('2026-11-08T05:00:00Z'), submittedBy: lead, version: 1, sourceId: undefined, standing: 'under_review' };
}
function store(initialEvidence: Evidence[] = []) {
  const calls: { kind: string; call: Record<string, unknown> }[] = [];
  let onEvidence: (row: Evidence) => void = () => {};
  const s: NoraStore = {
    logins: () => [], accounts: () => [], findings: () => [], rules: () => [], memory: () => [], requests: () => [], suggestions: () => [],
    evidence: () => initialEvidence, sources: () => [],
    decisions: () => [{ id: 3n, incidentId: 1n, title: 'Restore from Monday backup', assumption: "Monday's backup predates the intrusion", state: 'approved', evidenceIds: [], owner: lead, approvedAt: undefined, version: 2 }],
    teamUpdates: () => [], members: () => [{ id: 1n, incidentId: 1n, user: lead, roles: ['tier2'], active: true, admittedBy: lead, admittedAt: ts('2026-11-08T04:00:00Z'), revokedBy: undefined, revokedAt: undefined }],
    incidents: () => [{ id: 1n, title: 'Portal down', summary: '', status: 'investigating', severity: 'high', commander: lead, createdBy: lead, createdAt: ts('2026-11-08T04:00:00Z'), updatedAt: ts('2026-11-08T04:00:00Z'), version: 1 }],
    messages: () => [], tasks: () => [], evidenceReviews: () => calls.filter(c => c.kind === 'review' || c.kind === 'flag').map(c => ({ evidenceId: c.call.evidenceId }) as never),
    self: nora,
    onLogin: () => {}, onRequest: () => {}, onEvidence: cb => { onEvidence = cb; },
    createFinding: async () => {}, completeReassessment: async () => {},
    recordEvidenceReview: async call => { calls.push({ kind: 'review', call }); },
    flagDecision: async call => { calls.push({ kind: 'flag', call }); },
    post: async call => { calls.push({ kind: 'post', call }); },
  };
  return { s, calls, add: (row: Evidence) => onEvidence(row) };
}
const watcherWith = (s: NoraStore, replies: unknown[]) => {
  const nemotron = scripted(...replies);
  return new NoraWatcher({ store: s, brain: { model: 'test-model', finding: nemotron.ask, reassess: async () => ({}) }, enricher: { lookup: async () => ({}) }, attackIds: new Set(), backlogMax: 10, log: () => {} });
};

test('new evidence that conflicts: a suggestion aimed at the decision, and a note in the discussion', async () => {
  const { s, calls, add } = store();
  const w = watcherWith(s, [{ final: CONFLICT }]);
  w.start(); add(evidenceRow(7n)); await w.idle();
  assert.deepEqual(calls.map(c => c.kind), ['flag', 'post']);
  assert.equal(calls[0].call.decisionId, 3n);
  assert.equal(calls[0].call.urgent, false);
  assert.equal(calls[1].call.recipient, undefined);
  // The same evidence arriving again is not investigated twice.
  add(evidenceRow(7n)); await w.idle();
  assert.equal(calls.length, 2);
});

test('urgent evidence also messages the incident lead directly, recommending escalation', async () => {
  const { s, calls, add } = store();
  const w = watcherWith(s, [{ final: { ...CONFLICT, impact: 'urgent' } }]);
  w.start(); add(evidenceRow(8n)); await w.idle();
  assert.deepEqual(calls.map(c => c.kind), ['flag', 'post', 'post']);
  assert.equal(calls[0].call.urgent, true);
  assert.ok((calls[2].call.recipient as Identity).isEqual(lead));
  assert.match(String(calls[2].call.text), /recommend escalating/);
});

test('evidence with no impact is recorded quietly; a failed investigation is recorded as failed', async () => {
  const { s, calls, add } = store();
  const w = watcherWith(s, [{ final: { impact: 'no_impact', summary: 'Printer outage.' } }, { final: { ...CONFLICT, excerpt: 'invented' } }]);
  w.start(); add(evidenceRow(9n, 'The third-floor printer is offline.')); add(evidenceRow(10n)); await w.idle();
  assert.deepEqual(calls.map(c => [c.kind, c.call.outcome]), [['review', 'no_impact'], ['review', 'failed']]);
  assert.match(String(calls[1].call.summary), /not in the evidence/);
});

test('unreviewed evidence from before Nora started is picked up at startup', async () => {
  const { s, calls } = store([evidenceRow(11n)]);
  const w = watcherWith(s, [{ final: CONFLICT }]);
  w.start(); await w.idle();
  assert.deepEqual(calls.map(c => c.kind), ['flag', 'post']);
});

test('verification findings can support the decision they verify, and only that one', () => {
  const findings = file({ evidence: { id: 9n, title: 'Verification of D-003: check timing', text: 'The backup finished at 01:40, before the session.', source: 'Verification findings', verifies: 3n } });
  const v = checkVerdict({ impact: 'supports', decision_id: 3, summary: 'The backup predates the session.' }, findings);
  assert.deepEqual(v, { kind: 'supports', decisionId: 3n, summary: 'The backup predates the session.' });
  if (v.kind !== 'supports') throw new Error('expected supports');
  assert.match(supportsNote(v, findings.evidence, findings.decisions[0]), /support D-003.*re-approve/);
  assert.throws(() => checkVerdict({ impact: 'supports', decision_id: 4, summary: 's' }, findings), /different decision/);
  assert.throws(() => checkVerdict({ impact: 'supports', decision_id: 3, summary: 's' }, file()), /Only verification findings/);
});

test('submitted findings that support the decision: a quiet "supports" record and a note to re-approve', async () => {
  const { s, calls, add } = store();
  const w = watcherWith(s, [{ final: { impact: 'supports', decision_id: 3, summary: 'The backup predates the session.' } }]);
  w.start();
  add({ ...evidenceRow(12n, 'The backup finished at 01:40, before the session.'), sourceType: 'verification', title: 'Verification of D-003: check timing' });
  await w.idle();
  assert.deepEqual(calls.map(c => [c.kind, c.call.outcome ?? '']), [['review', 'supports'], ['post', '']]);
  assert.match(String(calls[1].call.text), /re-approve D-003/);
});
