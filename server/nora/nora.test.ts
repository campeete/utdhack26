import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Identity, Timestamp } from 'spacetimedb';
import { createEnricher, isPublicIp } from './enrich.ts';
import { attentionReasons, computeClues, fallbackFinding, parseFinding, severityCeiling, severityFloor, type AccountFacts, type LoginFacts, type TriageInput } from './triage.ts';
import { buildReassessmentRequest, NoraWatcher, type CreateFindingCall, type NoraBrain, type NoraStore } from './watcher.ts';
import type { LoginEvent, NorthstarAccount, ReassessmentRequestRecord } from './bindings.ts';

const ATTACK = new Set(['T1078', 'T1110', 'T1110.004']);
const nobody = Identity.zero();
const at = (iso: string) => Timestamp.fromDate(new Date(iso));

const sysadmin: AccountFacts = {
  accountRef: 'NSR-1004', name: 'Carolyn Hawkins', department: 'IT', jobTitle: 'Systems Administrator', privileged: true,
  mfa: 'none', inCredentialLeak: true, status: 'active', usualDevices: ['Laptop / Windows / Edge'], usualNetworks: ['198.51.100.'],
};
const attackerLogin: LoginFacts = {
  id: 7n, incidentId: 1n, method: 'password_only', outcome: 'success', ip: '203.0.113.66',
  deviceType: 'Phone', os: 'iOS', browser: 'Safari', passwordBreached: true, origin: 'live_phone',
};
const ordinaryLogin: LoginFacts = { ...attackerLogin, id: 8n, method: 'password_2fa', ip: '198.51.100.20', deviceType: 'Laptop', os: 'Windows', browser: 'Edge', passwordBreached: false };
const input = (login: LoginFacts, account = sysadmin, rules: TriageInput['rules'] = []): TriageInput => {
  const clues = computeClues(login, account, {});
  return { login, account, clues, reasons: attentionReasons(login, account, clues), rules, memory: [] };
};

// ---------------------------------------------------------------- triage rules

test('an ordinary sign-in (known device and network, 2FA, clean password) needs no finding', () => {
  const i = input(ordinaryLogin, { ...sysadmin, inCredentialLeak: false });
  assert.deepEqual(i.clues, { new_device: false, new_network: false, breached_password: false });
  assert.deepEqual(i.reasons, []);
});

test('password-only is routine for an account without 2FA on its usual device, but not when 2FA was skipped', () => {
  const routine = { ...ordinaryLogin, method: 'password_only' };
  assert.deepEqual(input(routine, { ...sysadmin, inCredentialLeak: false }).reasons, []);
  assert.deepEqual(input(routine, { ...sysadmin, inCredentialLeak: false, mfa: 'TOTP' }).reasons, ['signed in without 2FA']);
});

test("the attacker's sign-in is flagged and can never be scored below critical", () => {
  const i = input(attackerLogin);
  assert.deepEqual(i.reasons, ['password-only sign-in from a new device or network', 'password appears in a breach', 'new device (Phone / iOS / Safari)', 'new network']);
  assert.equal(severityFloor(i.login, i.account, i.clues), 'critical');
  const draft = parseFinding({ severity: 'low', queue: 'low_severity', rule_id: 1, title: 'Fine', reason: 'Looks normal', attack_technique: 'T1078', proposed_fix: 'Nothing', proposed_action: 'monitor_only' }, i, ATTACK, 'm');
  assert.equal(draft.severity, 'critical');
  assert.equal(draft.queue, 'needs_human');
  assert.equal(draft.ruleId, undefined);
});

test('the model cannot invent actions, techniques or rules', () => {
  const rules = [{ id: 3n, situation: 'Known device, new network, MFA passed', allowedAction: 'force_password_reset', enabled: true }];
  const lowLogin: LoginFacts = { ...ordinaryLogin, ip: '192.0.2.10' }; // new network only, 2FA passed
  const i = input(lowLogin, { ...sysadmin, inCredentialLeak: false, privileged: false }, rules);
  assert.deepEqual(i.reasons, ['new network']);
  const base = { severity: 'low', title: 't', reason: 'r', proposed_fix: 'f' };

  const ok = parseFinding({ ...base, queue: 'low_severity', rule_id: 3, attack_technique: 't1078', proposed_action: 'force_password_reset' }, i, ATTACK, 'm');
  assert.equal(ok.queue, 'low_severity');
  assert.equal(ok.ruleId, 3n);
  assert.equal(ok.attackTechnique, 'T1078');

  const wrongAction = parseFinding({ ...base, queue: 'low_severity', rule_id: 3, proposed_action: 'disable_account' }, i, ATTACK, 'm');
  assert.equal(wrongAction.queue, 'needs_human');
  const madeUpRule = parseFinding({ ...base, queue: 'low_severity', rule_id: 99, proposed_action: 'force_password_reset' }, i, ATTACK, 'm');
  assert.equal(madeUpRule.queue, 'needs_human');
  const disabled = parseFinding({ ...base, queue: 'low_severity', rule_id: 3, proposed_action: 'force_password_reset' }, { ...i, rules: [{ ...rules[0], enabled: false }] }, ATTACK, 'm');
  assert.equal(disabled.queue, 'needs_human');
  const weird = parseFinding({ ...base, queue: 'needs_human', attack_technique: 'T9999', proposed_action: 'wipe_laptop' }, i, ATTACK, 'm');
  assert.equal(weird.proposedAction, 'monitor_only');
  assert.equal(weird.attackTechnique, '');
  assert.throws(() => parseFinding({ severity: 'high' }, i, ATTACK, 'm'), /left out/);
});

test('the model cannot overrate: failed attempts top out at medium, routine sign-ins at low', () => {
  const base = { title: 't', reason: 'r', proposed_fix: 'f', proposed_action: 'force_password_reset' };
  const spray = input({ ...attackerLogin, outcome: 'failed_password', passwordBreached: undefined }, { ...sysadmin, inCredentialLeak: false });
  assert.equal(severityCeiling(spray.login, spray.account, spray.clues), 'medium');
  assert.equal(parseFinding({ ...base, severity: 'high', queue: 'needs_human' }, spray, ATTACK, 'm').severity, 'medium');

  const rules = [{ id: 1n, situation: 'Password found in a breach, usual device and network', allowedAction: 'force_password_reset', enabled: true }];
  const routineLeak = input({ ...ordinaryLogin, method: 'password_only', passwordBreached: true }, sysadmin, rules);
  assert.deepEqual(routineLeak.reasons, ['password appears in a breach']);
  assert.equal(severityCeiling(routineLeak.login, routineLeak.account, routineLeak.clues), 'low');
  const d = parseFinding({ ...base, severity: 'high', queue: 'low_severity', rule_id: 1 }, routineLeak, ATTACK, 'm');
  assert.equal(d.severity, 'low');
  assert.equal(d.queue, 'low_severity');
  assert.equal(d.ruleId, 1n);
  // The attacker's break-in is still critical whatever the model says.
  assert.equal(parseFinding({ ...base, severity: 'low', queue: 'needs_human' }, input(attackerLogin), ATTACK, 'm').severity, 'critical');
});

test('the rules-only fallback is labelled and proposes a containing action for serious cases', () => {
  const f = fallbackFinding(input(attackerLogin), ATTACK, 'HTTP 503');
  assert.equal(f.severity, 'critical');
  assert.equal(f.queue, 'needs_human');
  assert.equal(f.proposedAction, 'disable_account');
  assert.match(f.model, /rules only/);
  assert.match(f.reason, /Nemotron was unavailable \(HTTP 503\)/);
});

test('lookups skip private and documentation addresses, cache answers, and survive failures', async () => {
  assert.equal(isPublicIp('10.1.2.3'), false);
  assert.equal(isPublicIp('203.0.113.66'), false);
  assert.equal(isPublicIp('185.220.101.1'), true);
  let calls = 0;
  const fakeFetch = (async (url: string) => {
    calls++;
    if (String(url).includes('abuseipdb')) return new Response(JSON.stringify({ data: { abuseConfidenceScore: 91 } }));
    return new Response('nope', { status: 500 });
  }) as typeof fetch;
  const logs: string[] = [];
  const e = createEnricher({ abuseIpDbKey: 'k', ipInfoToken: 't', timeoutMs: 1000 }, fakeFetch, m => logs.push(m));
  assert.deepEqual(await e.lookup('185.220.101.1'), { abuseScore: 91 });
  await e.lookup('185.220.101.1');
  assert.equal(calls, 2); // one per service, then cached
  assert.deepEqual(await e.lookup('10.0.0.1'), {});
  assert.match(logs.join(' '), /IPinfo lookup failed \(HTTP 500\)/);
  assert.doesNotMatch(logs.join(' '), /\bk\b|\bt\b/);
});

// ---------------------------------------------------------------- watcher

function account(over: Partial<NorthstarAccount> = {}): NorthstarAccount {
  return { id: 1n, incidentId: 1n, accountRef: 'NSR-1004', name: 'Carolyn Hawkins', department: 'IT', jobTitle: 'Systems Administrator', privileged: true, mfa: 'none', inCredentialLeak: true, usedByAttacker: true, status: 'active', usualDevices: ['Laptop / Windows / Edge'], usualNetworks: ['198.51.100.'], version: 1, ...over };
}
function login(id: bigint, over: Partial<LoginEvent> = {}): LoginEvent {
  return { id, incidentId: 1n, accountId: 1n, occurredAt: at('2026-11-07T03:00:00Z'), method: 'password_2fa', outcome: 'success', ip: '198.51.100.20', deviceType: 'Laptop', os: 'Windows', browser: 'Edge', passwordBreached: false, origin: 'seeded', recordedBy: nobody, ...over };
}

function fakeStore(init: { logins: LoginEvent[]; requests?: ReassessmentRequestRecord[] }) {
  const created: CreateFindingCall[] = [];
  const completed: [bigint, string][] = [];
  let onLogin: (r: LoginEvent) => void = () => {};
  const store: NoraStore = {
    logins: () => init.logins, accounts: () => [account()], findings: () => created.map((c, i) => ({ loginEventId: c.loginEventId, id: BigInt(i) }) as never),
    rules: () => [], memory: () => [], requests: () => init.requests ?? [],
    suggestions: () => [{ id: 5n, incidentId: 1n, sourceId: 2n, evidenceId: 3n, decisionIds: [4n], teamUpdateIds: [], excerpt: 'q', explanation: 'e', verification: 'v', origin: 'nora', dismissalFeedback: 'Vendor tested the restore.', dismissedAt: at('2026-11-07T12:00:00Z') } as never],
    evidence: () => [{ id: 3n, title: 'Vendor email', contentText: 'q. More.', standing: 'under_review', eventTime: at('2026-11-07T10:00:00Z'), recordedAt: at('2026-11-07T10:05:00Z') } as never],
    sources: () => [{ id: 2n, label: 'Vendor', trust: 'under_review', reason: 'r' } as never],
    decisions: () => [{ id: 4n, title: 'Restore', assumption: 'Backup clean', state: 'approved' } as never],
    teamUpdates: () => [],
    incidents: () => [], members: () => [], messages: () => [], tasks: () => [], evidenceReviews: () => [],
    self: nobody,
    onLogin: cb => { onLogin = cb; },
    onEvidence: () => {},
    onRequest: () => {},
    createFinding: async c => { created.push(c); },
    completeReassessment: async (id, json) => { completed.push([id, json]); },
    recordEvidenceReview: async () => {}, flagDecision: async () => {}, post: async () => {},
  };
  return { store, created, completed, push: (r: LoginEvent) => onLogin(r) };
}

const brain = (answer: unknown | Error): NoraBrain & { calls: number } => {
  const b = {
    calls: 0, model: 'test-model',
    async finding() { b.calls++; if (answer instanceof Error) throw answer; return answer; },
    async reassess() { return { kind: 'no_further_review', note: 'resolved' }; },
  };
  return b;
};
const quiet = { lookup: async () => ({}) };
const NEMOTRON_ANSWER = { severity: 'high', queue: 'needs_human', rule_id: null, title: 'Takeover of NSR-1004', reason: 'Leaked password, no 2FA, new phone.', attack_technique: 'T1078', proposed_fix: 'Disable NSR-1004.', proposed_action: 'disable_account' };

test('the watcher analyses only flagged sign-ins, once each, and writes what the rules allow', async () => {
  const attacker = login(2n, { method: 'password_only', passwordBreached: true, ip: '203.0.113.66', deviceType: 'Phone', os: 'iOS', browser: 'Safari' });
  const s = fakeStore({ logins: [login(1n), attacker] });
  const b = brain(NEMOTRON_ANSWER);
  const w = new NoraWatcher({ store: s.store, brain: b, enricher: quiet, attackIds: ATTACK, backlogMax: 10, log: () => {} });
  w.start();
  await w.idle();
  assert.equal(b.calls, 1);
  assert.equal(s.created.length, 1);
  assert.deepEqual({ ...s.created[0], clues: JSON.parse(s.created[0].clues) }, {
    incidentId: 1n, accountRef: 'NSR-1004', loginEventId: 2n, severity: 'critical', queue: 'needs_human',
    title: 'Takeover of NSR-1004', reason: 'Leaked password, no 2FA, new phone.', attackTechnique: 'T1078',
    proposedFix: 'Disable NSR-1004.', proposedAction: 'disable_account', ruleId: undefined, model: 'test-model',
    clues: { new_device: true, new_network: true, breached_password: true },
  });
  // The same row arriving again (e.g. after a reconnect) is not analysed twice.
  s.push(attacker);
  await w.idle();
  assert.equal(b.calls, 1);
  // A new live sign-in is.
  s.push({ ...attacker, id: 3n, origin: 'live_phone' });
  await w.idle();
  assert.equal(s.created.length, 2);
});

test('when Nemotron fails the watcher still writes a labelled rules-only finding', async () => {
  const s = fakeStore({ logins: [login(2n, { method: 'password_only', passwordBreached: true, deviceType: 'Phone' })] });
  const logs: string[] = [];
  const w = new NoraWatcher({ store: s.store, brain: brain(new Error('HTTP 429')), enricher: quiet, attackIds: ATTACK, backlogMax: 10, log: m => logs.push(m) });
  w.start();
  await w.idle();
  assert.equal(s.created.length, 1);
  assert.match(s.created[0].model, /rules only/);
  assert.match(logs.join('\n'), /HTTP 429/);
});

test('the startup backlog is capped', async () => {
  const flagged = [1n, 2n, 3n, 4n].map(id => login(id, { method: 'password_only', passwordBreached: true }));
  const s = fakeStore({ logins: flagged });
  const w = new NoraWatcher({ store: s.store, brain: brain(NEMOTRON_ANSWER), enricher: quiet, attackIds: ATTACK, backlogMax: 2, log: () => {} });
  w.start();
  await w.idle();
  assert.equal(s.created.length, 2);
});

test('queued reassessments are answered once, from stored records, without naming the reviewer', async () => {
  const req: ReassessmentRequestRecord = { id: 9n, incidentId: 1n, suggestionId: 5n, requestKey: '5:attempt-1', attempt: 1, state: 'requested', requestedBy: nobody, requestedAt: at('2026-11-07T12:00:00Z'), completedAt: undefined, error: '' };
  const s = fakeStore({ logins: [], requests: [req, req, { ...req, id: 10n, state: 'failed' }] });
  const built = buildReassessmentRequest(s.store, req);
  assert.equal(built.requestId, '5:attempt-1');
  assert.equal(built.evidence?.text, 'q. More.');
  assert.equal(built.dismissal.reviewer, 'incident reviewer');
  assert.equal(built.decisions.length, 1);
  const w = new NoraWatcher({ store: s.store, brain: brain(NEMOTRON_ANSWER), enricher: quiet, attackIds: ATTACK, backlogMax: 0, log: () => {} });
  w.start();
  await w.idle();
  assert.deepEqual(s.completed, [[9n, JSON.stringify({ kind: 'no_further_review', note: 'resolved' })]]);
});
