// Clean Room Data Spec: tests for the tables added on top of Jon's Gate 1 module.
// Same harness and conventions as access-control.test.ts: rejections must be our own
// SenderError with a specific message, never an unrelated crash.
import { describe, it, expect, beforeEach } from 'vitest';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import { ConnectionId, Identity, Timestamp } from 'spacetimedb';
import * as mod from '../src/index';
import { rowToEvent, verifyChain, PLATFORM_INCIDENT } from '../src/audit';
import { autoFixRefusal, cleanClues, isAttackTechniqueId, isIpAddress, parseReassessmentResult } from '../src/rules';

const jwt = (sub: string) => JSON.stringify({ iss: 'https://test.local', sub, aud: ['clean-room'] });
let nextConn = 1n;
const who = (sub: string) => TestAuth.fromJwtPayload(jwt(sub), new ConnectionId(nextConn++));

let h: ReturnType<typeof createModuleTestHarness<any>>;
const auth: Record<string, TestAuth> = {};
const id: Record<string, Identity> = {};
let inc: bigint;

const run = (a: TestAuth, fn: (ctx: any) => void) => h.withReducerTx(a, fn);
const as = (name: string, fn: (ctx: any) => void) => run(auth[name], fn);
const view = (name: string, v: any) => v(h.viewContext(auth[name]), {});
const rows = (table: string) => [...h.db[table].iter()] as any[];
// Highest id = newest row (iteration order is not insertion order after updates).
const last = (table: string) => rows(table).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).at(-1);

function denied(fn: () => void, message: RegExp) {
  let err: any;
  try { fn(); } catch (e) { err = e; }
  expect(err, 'expected the operation to be rejected').toBeDefined();
  expect(err.constructor.name).toBe('SenderError');
  expect(String(err.message)).toMatch(message);
}

const EVIDENCE_TEXT = 'The vendor says the Monday backup finished at 02:10. The backup was never restored in a test. Logs before Sunday are missing.';

const account = (ref: string, over: Partial<Record<string, unknown>> = {}) => ({
  account_ref: ref, name: `Person ${ref}`, department: 'IT', job_title: 'Engineer', privileged: false,
  mfa: 'totp', in_credential_leak: false, used_by_attacker: false, status: 'active',
  usual_devices: ['Laptop / macOS / Chrome'], usual_networks: ['Northstar HQ'], ...over,
});
const seedLogin = (ref: string, over: Partial<Record<string, unknown>> = {}) => ({
  account_ref: ref, occurred_at: Timestamp.fromDate(new Date('2026-11-07T03:12:00Z')), method: 'password_2fa',
  outcome: 'success', ip: '203.0.113.7', device_type: 'Laptop', os: 'macOS', browser: 'Chrome',
  password_breached: undefined, ...over,
});
const finding = (over: Partial<Record<string, unknown>> = {}) => ({
  incident_id: inc, account_ref: 'NSR-1008', login_event_id: undefined, severity: 'high', queue: 'needs_human',
  title: 'Password-only login to a privileged account from a new device', reason: 'Leaked password, no 2FA, new device.',
  clues: JSON.stringify({ breached_password: true, ip_abuse_score: 87, network_owner: 'Example Hosting LLC', country: 'NL', new_device: true, new_network: true }),
  attack_technique: 'T1078', proposed_fix: 'Disable the account until the owner confirms.', proposed_action: 'disable_account',
  rule_id: undefined, model: 'nvidia/nemotron-3-ultra-550b-a55b', ...over,
});
const byId = (table: string, rowId: bigint) => rows(table).find(r => r.id === rowId);
const acct = (ref: string) => rows('northstar_account').find(a => a.account_ref === ref);

beforeEach(() => {
  h = createModuleTestHarness(mod.default, mod as any);
  for (const name of ['owner', 'cmd', 'analyst', 'forensics', 'outsider', 'nora', 'gateway', 'phone2']) {
    auth[name] = who(name);
    run(auth[name], ctx => { id[name] = ctx.sender; });
  }
  as('owner', ctx => mod.init(ctx, {} as any));
  as('owner', ctx => mod.create_incident(ctx, { title: 'Northstar Retail', summary: 'Synthetic training incident', severity: 'high' }));
  inc = last('incident').id;
  // analyst = Tier 1 (triage), cmd = Tier 2 (containment), forensics = Tier 3.
  for (const [name, roles] of [['cmd', ['tier2']], ['analyst', ['tier1']], ['forensics', ['tier3']]] as const) {
    as('owner', ctx => mod.admit_member(ctx, { incident_id: inc, user: id[name], roles: [...roles] }));
  }
  as('owner', ctx => mod.set_service_account(ctx, { identity: id.nora, kind: 'nora', enabled: true }));
  as('owner', ctx => mod.set_service_account(ctx, { identity: id.gateway, kind: 'login_gateway', enabled: true }));
  as('owner', ctx => mod.load_demo_scenario(ctx, {
    incident_id: inc,
    accounts: [account('NSR-1008', { privileged: true, mfa: 'none', in_credential_leak: true }), account('NSR-1015'), account('NSR-SVC-01')],
    logins: [seedLogin('NSR-1008'), seedLogin('NSR-1015', { outcome: 'failed_password' })],
  }));
});

// ---------------------------------------------------------------------------------

describe('pure rules', () => {
  it('auto-fix needs low severity, the low queue, an enabled rule, and the exact allowed action', () => {
    const rule = { enabled: true, allowed_action: 'force_password_reset' };
    const ok = { queue: 'low_severity', severity: 'low', proposedAction: 'force_password_reset', rule };
    expect(autoFixRefusal(ok)).toBeNull();
    expect(autoFixRefusal({ ...ok, queue: 'needs_human' })).toMatch(/queue/);
    expect(autoFixRefusal({ ...ok, severity: 'medium' })).toMatch(/low-severity findings/);
    expect(autoFixRefusal({ ...ok, rule: undefined })).toMatch(/No such/);
    expect(autoFixRefusal({ ...ok, rule: { ...rule, enabled: false } })).toMatch(/turned off/);
    expect(autoFixRefusal({ ...ok, proposedAction: 'disable_account' })).toMatch(/allowed action/);
  });

  it('clues keep only known keys; a password, a city or a bad score is refused', () => {
    expect(JSON.parse(cleanClues('{"country":"NL","new_device":true}'))).toEqual({ new_device: true, country: 'NL' });
    expect(() => cleanClues('{"password":"hunter2"}')).toThrow(/Unknown clue/);
    expect(() => cleanClues('{"country":"Amsterdam"}')).toThrow(/two-letter/);
    expect(() => cleanClues('{"ip_abuse_score":101}')).toThrow(/0-100/);
    expect(() => cleanClues('[1]')).toThrow(/object/);
  });

  it('format checks: IPs, ATT&CK ids, model replies', () => {
    expect(isIpAddress('203.0.113.7')).toBe(true);
    expect(isIpAddress('2001:db8::1')).toBe(true);
    expect(isIpAddress('evil.example')).toBe(false);
    expect(isIpAddress('300.1.1.1')).toBe(false);
    expect(isAttackTechniqueId('T1078')).toBe(true);
    expect(isAttackTechniqueId('T1078.004')).toBe(true);
    expect(isAttackTechniqueId('lateral movement')).toBe(false);
    expect(parseReassessmentResult('not json').kind).toBe('error');
    expect(parseReassessmentResult({ kind: 'revision', excerpt: 'x' }).kind).toBe('error');
    expect(parseReassessmentResult({ kind: 'no_further_review', note: 'fine' })).toEqual({ kind: 'no_further_review', note: 'fine' });
  });
});

describe('tiers', () => {
  it('one tier per person; tiers stack; Tier 3 manages people', () => {
    denied(() => as('owner', c => mod.admit_member(c, { incident_id: inc, user: id.outsider, roles: ['tier1', 'tier2'] })), /Choose one tier/);
    denied(() => as('owner', c => mod.admit_member(c, { incident_id: inc, user: id.outsider, roles: ['analyst'] })), /Unknown role/);
    denied(() => as('cmd', c => mod.admit_member(c, { incident_id: inc, user: id.outsider, roles: ['tier1'] })), /needs Tier 3/);
    as('forensics', c => mod.admit_member(c, { incident_id: inc, user: id.outsider, roles: ['tier1'] }));
    // Tier 3 can do Tier 1 work too.
    as('forensics', c => mod.add_source(c, { incident_id: inc, label: 'Firewall logs', trust: 'trusted', reason: 'Exported by IT' }));
    denied(() => as('analyst', c => mod.update_incident(c, { incident_id: inc, expected_version: 1, status: 'containing', severity: undefined, summary: undefined, reason: 'x' })), /needs Tier 2/);
  });
});

describe('services and the demo scenario', () => {
  it('only a platform admin registers services or rules', () => {
    denied(() => as('cmd', c => mod.set_service_account(c, { identity: id.cmd, kind: 'nora', enabled: true })), /Access denied/);
    denied(() => as('owner', c => mod.set_service_account(c, { identity: id.outsider, kind: 'root', enabled: true })), /Invalid service kind/);
    denied(() => as('owner', c => mod.set_service_account(c, { identity: id.owner, kind: 'nora', enabled: true })), /platform admin cannot/);
    denied(() => as('cmd', c => mod.save_low_severity_rule(c, { rule_id: undefined, situation: 's', allowed_action: 'monitor_only', enabled: true })), /Access denied/);
    denied(() => as('owner', c => mod.save_low_severity_rule(c, { rule_id: undefined, situation: 's', allowed_action: 'delete_everything', enabled: true })), /Invalid allowed action/);
  });

  it('the scenario loads once, with no secrets on any account row', () => {
    expect(rows('northstar_account').length).toBe(3);
    expect(rows('login_event').every(l => l.origin === 'seeded')).toBe(true);
    for (const a of rows('northstar_account')) {
      for (const key of Object.keys(a)) expect(key).not.toMatch(/password|hash|salt|totp|email|username/);
    }
    denied(() => as('owner', c => mod.load_demo_scenario(c, { incident_id: inc, accounts: [account('NSR-2000')], logins: [] })), /already loaded/);
    denied(() => as('cmd', c => mod.load_demo_scenario(c, { incident_id: inc, accounts: [account('NSR-2000')], logins: [] })), /Access denied/);
  });

  it('a bad seed row rolls the whole load back', () => {
    as('owner', c => mod.create_incident(c, { title: 'Second', summary: '', severity: 'low' }));
    const second = last('incident').id;
    denied(() => as('owner', c => mod.load_demo_scenario(c, { incident_id: second, accounts: [account('NSR-3000')], logins: [seedLogin('NSR-9999')] })), /unknown account/);
    expect(rows('northstar_account').filter(a => a.incident_id === second)).toEqual([]);
  });

  it('only the gateway records live logins, stamped with the server clock', () => {
    const login = { incident_id: inc, account_ref: 'NSR-1008', method: 'password_only', outcome: 'success', ip: '198.51.100.23', device_type: 'Phone', os: 'iOS', browser: 'Safari', password_breached: true };
    for (const name of ['analyst', 'cmd', 'nora', 'owner']) denied(() => as(name, c => mod.record_login(c, login)), /Access denied/);
    as('gateway', c => mod.record_login(c, login));
    const row = last('login_event');
    expect(row.origin).toBe('live_phone');
    expect(row.password_breached).toBe(true);
    let serverNow!: bigint;
    as('gateway', c => { serverNow = c.timestamp.microsSinceUnixEpoch; });
    expect(row.occurred_at.microsSinceUnixEpoch).toBe(serverNow); // the reducer takes no time from the phone
    denied(() => as('gateway', c => mod.record_login(c, { ...login, account_ref: 'NSR-0000' })), /Unknown account/);
    denied(() => as('gateway', c => mod.record_login(c, { ...login, ip: 'attacker.example' })), /Invalid IP/);
    denied(() => as('gateway', c => mod.record_login(c, { ...login, method: 'magic_link' })), /Invalid login method/);
  });

  it('a disabled service loses access immediately', () => {
    as('owner', c => mod.set_service_account(c, { identity: id.gateway, kind: 'login_gateway', enabled: false }));
    denied(() => as('gateway', c => mod.record_login(c, { incident_id: inc, account_ref: 'NSR-1008', method: 'password_only', outcome: 'success', ip: '198.51.100.23', device_type: 'Phone', os: 'iOS', browser: 'Safari', password_breached: undefined })), /Access denied/);
  });
});

describe("Nora's findings", () => {
  it('only Nora creates findings; a person approves and the action runs', () => {
    denied(() => as('analyst', c => mod.create_finding(c, finding())), /Access denied/);
    as('nora', c => mod.create_finding(c, finding()));
    const f = last('finding');
    expect(f.state).toBe('open');
    expect(acct('NSR-1008').status).toBe('active');
    denied(() => as('analyst', c => mod.approve_finding(c, { finding_id: f.id, expected_version: 1 })), /needs Tier 2/);
    denied(() => as('cmd', c => mod.approve_finding(c, { finding_id: f.id, expected_version: 0 })), /changed since/);
    as('cmd', c => mod.approve_finding(c, { finding_id: f.id, expected_version: 1 }));
    expect(last('finding').state).toBe('approved');
    expect(acct('NSR-1008').status).toBe('disabled');
    expect(last('nora_memory')).toMatchObject({ finding_id: f.id, decision: 'approved' });
  });

  it('writes at most one finding per sign-in', () => {
    const loginId = rows('login_event')[0].id;
    as('nora', c => mod.create_finding(c, finding({ login_event_id: loginId, account_ref: undefined })));
    denied(() => as('nora', c => mod.create_finding(c, finding({ login_event_id: loginId, account_ref: undefined }))), /already has a finding/);
    expect(rows('finding').length).toBe(1);
  });

  it('refuses invented clues, techniques and actions', () => {
    denied(() => as('nora', c => mod.create_finding(c, finding({ clues: '{"password":"Northstar#97"}' }))), /Unknown clue/);
    denied(() => as('nora', c => mod.create_finding(c, finding({ attack_technique: 'hacking' }))), /ATT&CK/);
    denied(() => as('nora', c => mod.create_finding(c, finding({ proposed_action: 'wipe_laptop' }))), /Invalid proposed action/);
    denied(() => as('nora', c => mod.create_finding(c, finding({ account_ref: 'NSR-0000' }))), /Unknown account/);
  });

  it('auto-fixes only under an enabled matching rule, and a commander can undo it', () => {
    as('owner', c => mod.save_low_severity_rule(c, { rule_id: undefined, situation: 'Known device, new network, MFA passed', allowed_action: 'force_password_reset', enabled: true }));
    const rule = last('low_severity_rule').id;
    const low = { account_ref: 'NSR-1015', severity: 'low', queue: 'low_severity', proposed_action: 'force_password_reset', rule_id: rule, attack_technique: '' };

    as('nora', c => mod.create_finding(c, finding(low)));
    const f = last('finding');
    expect(f.state).toBe('auto_fixed');
    expect(f.prior_status).toBe('active');
    expect(acct('NSR-1015').status).toBe('password reset required');

    denied(() => as('analyst', c => mod.undo_auto_fix(c, { finding_id: f.id })), /insufficient role/);
    as('cmd', c => mod.undo_auto_fix(c, { finding_id: f.id }));
    expect(last('finding').state).toBe('undone');
    expect(acct('NSR-1015').status).toBe('active');

    // Anything short of a full match waits for a person.
    for (const over of [{ severity: 'medium' }, { queue: 'needs_human' }, { proposed_action: 'disable_account' }]) {
      as('nora', c => mod.create_finding(c, finding({ ...low, ...over })));
      expect(last('finding').state).toBe('open');
    }
    as('owner', c => mod.save_low_severity_rule(c, { rule_id: rule, situation: 'Known device, new network, MFA passed', allowed_action: 'force_password_reset', enabled: false }));
    as('nora', c => mod.create_finding(c, finding(low)));
    expect(last('finding').state).toBe('open');
    expect(acct('NSR-1015').status).toBe('active');
  });

  it('undo is refused if the account was changed after the fix', () => {
    as('owner', c => mod.save_low_severity_rule(c, { rule_id: undefined, situation: 'x', allowed_action: 'force_password_reset', enabled: true }));
    const rule = last('low_severity_rule').id;
    as('nora', c => mod.create_finding(c, finding({ account_ref: 'NSR-1015', severity: 'low', queue: 'low_severity', proposed_action: 'force_password_reset', rule_id: rule })));
    const fixed = last('finding').id;
    as('nora', c => mod.create_finding(c, finding({ account_ref: 'NSR-1015' })));
    const second = last('finding').id;
    as('forensics', c => mod.approve_finding(c, { finding_id: second, expected_version: 1 })); // tiers stack
    denied(() => as('cmd', c => mod.undo_auto_fix(c, { finding_id: fixed })), /changed after the fix/);
  });

  it('dismissal feedback (Tier 1 triage) goes to Nora’s memory, which only Nora can read and Tier 3 can delete', () => {
    as('nora', c => mod.create_finding(c, finding()));
    const f = last('finding');
    as('analyst', c => mod.dismiss_finding(c, { finding_id: f.id, feedback: '  NSR-1008 is the CFO travelling; confirmed by phone.  ' }));
    as('analyst', c => mod.dismiss_finding(c, { finding_id: f.id, feedback: 'again' })); // no-op
    expect(rows('nora_memory').length).toBe(1);
    expect(last('nora_memory').feedback).toBe('NSR-1008 is the CFO travelling; confirmed by phone.');
    expect(view('nora', mod.nora_memory_feed).length).toBe(1);
    expect(view('cmd', mod.nora_memory_feed)).toEqual([]);
    const memoryId = last('nora_memory').id;
    denied(() => as('analyst', c => mod.delete_nora_memory(c, { memory_id: memoryId })), /needs Tier 3/);
    denied(() => as('cmd', c => mod.delete_nora_memory(c, { memory_id: memoryId })), /needs Tier 3/);
    as('forensics', c => mod.delete_nora_memory(c, { memory_id: memoryId }));
    expect(rows('nora_memory')).toEqual([]);
  });

  it('Nora reads incident views without a membership; outsiders and a disabled Nora see nothing', () => {
    expect(view('nora', mod.incident_accounts).length).toBe(3);
    expect(view('nora', mod.incident_logins).length).toBe(2);
    expect(view('outsider', mod.incident_accounts)).toEqual([]);
    expect(view('outsider', mod.low_severity_rules)).toEqual([]);
    as('owner', c => mod.set_service_account(c, { identity: id.nora, kind: 'nora', enabled: false }));
    expect(view('nora', mod.incident_accounts)).toEqual([]);
    expect(view('nora', mod.nora_memory_feed)).toEqual([]);
  });
});

describe('suggested reviews (ported rules)', () => {
  let sourceId: bigint, evidenceId: bigint, decisionId: bigint, updateId: bigint;
  beforeEach(() => {
    as('analyst', c => mod.add_source(c, { incident_id: inc, label: 'Backup vendor', trust: 'under_review', reason: 'Unverified claim' }));
    sourceId = last('source').id;
    as('analyst', c => mod.add_evidence(c, { incident_id: inc, title: 'Vendor email', source_label: 'Vendor', source_type: 'email', content_text: EVIDENCE_TEXT, event_time: Timestamp.fromDate(new Date('2026-11-07T10:00:00Z')), source_id: sourceId }));
    evidenceId = last('evidence').id;
    as('cmd', c => mod.draft_decision(c, { incident_id: inc, title: 'Restore from Monday backup', assumption: 'The backup is clean', evidence_ids: [evidenceId] }));
    decisionId = last('decision').id;
    as('cmd', c => mod.approve_decision(c, { decision_id: decisionId, expected_version: 1 }));
    as('cmd', c => mod.create_team_update(c, { incident_id: inc, title: 'Restore plan', body: 'Restoring from Monday.', decision_ids: [decisionId] }));
    updateId = last('team_update').id;
  });
  const suggest = (excerpt = 'The backup was never restored in a test.') =>
    as('nora', c => mod.add_suggestion(c, { incident_id: inc, evidence_id: evidenceId, excerpt, explanation: 'Untested backup.', verification: 'Run a test restore first.' }));

  it('a quote must appear word for word in the evidence', () => {
    denied(() => suggest('The backup is definitely infected.'), /exact quote/);
    denied(() => as('outsider', c => mod.add_suggestion(c, { incident_id: inc, evidence_id: evidenceId, excerpt: 'Logs before Sunday are missing.', explanation: 'e', verification: 'v' })), /Access denied/);
    suggest();
    expect(last('suggestion')).toMatchObject({ origin: 'nora', state: 'pending', decision_ids: [decisionId], team_update_ids: [updateId] });
  });

  it('confirming flags the decision, outdates the update and assigns a task to the decision owner', () => {
    suggest();
    const s = last('suggestion');
    denied(() => as('outsider', c => mod.confirm_suggestion(c, { suggestion_id: s.id, reason: 'Looks right to me' })), /Access denied/);
    denied(() => as('analyst', c => mod.confirm_suggestion(c, { suggestion_id: s.id, reason: 'short' })), /review reason/);
    as('analyst', c => mod.confirm_suggestion(c, { suggestion_id: s.id, reason: 'Vendor admits no test restore' }));
    expect(byId('decision', decisionId).state).toBe('needs_review');
    expect(byId('team_update', updateId).state).toBe('outdated');
    const tk = last('task');
    expect(tk).toMatchObject({ decision_id: decisionId, state: 'open', title: 'Run a test restore first.' });
    expect(tk.assignee.isEqual(id.cmd)).toBe(true);
    // Repeat confirm is a no-op: no second task.
    as('analyst', c => mod.confirm_suggestion(c, { suggestion_id: s.id, reason: 'Vendor admits no test restore' }));
    expect(rows('task').length).toBe(1);
    denied(() => as('analyst', c => mod.accept_task(c, { task_id: tk.id })), /Only the assignee/);
    as('cmd', c => mod.accept_task(c, { task_id: tk.id }));
    expect(last('task').state).toBe('accepted');
  });

  it('Flag & assign: Tier 2 hands the verification to a teammate, who acknowledges it', () => {
    suggest();
    const sid = last('suggestion').id;
    as('cmd', c => mod.confirm_suggestion(c, { suggestion_id: sid, reason: 'Backup ran after the session' }));
    const tk = last('task');
    denied(() => as('analyst', c => mod.reassign_task(c, { task_id: tk.id, assignee: id.analyst })), /Access denied|Tier/i);
    denied(() => as('cmd', c => mod.reassign_task(c, { task_id: tk.id, assignee: id.outsider })), /active member/);
    as('cmd', c => mod.reassign_task(c, { task_id: tk.id, assignee: id.analyst }));
    expect(last('task').assignee.isEqual(id.analyst)).toBe(true);
    as('analyst', c => mod.accept_task(c, { task_id: tk.id }));
    expect(last('task').state).toBe('accepted');
  });

  it('Tier 2 assigns verification work on a decision to a teammate; only the assignee accepts it', () => {
    denied(() => as('analyst', c => mod.assign_task(c, { decision_id: decisionId, assignee: id.analyst, title: 'Verify backup timing' })), /needs Tier 2/);
    denied(() => as('cmd', c => mod.assign_task(c, { decision_id: decisionId, assignee: id.outsider, title: 'Verify backup timing' })), /active member/);
    as('cmd', c => mod.assign_task(c, { decision_id: decisionId, assignee: id.analyst, title: 'Verify backup timing' }));
    const tk = last('task');
    expect(tk).toMatchObject({ decision_id: decisionId, suggestion_id: 0n, state: 'open', title: 'Verify backup timing' });
    denied(() => as('cmd', c => mod.accept_task(c, { task_id: tk.id })), /Only the assignee/);
    as('analyst', c => mod.accept_task(c, { task_id: tk.id }));
    as('analyst', c => mod.resolve_task(c, { task_id: tk.id }));
    expect(last('task').state).toBe('resolved');
  });

  it('the assignee submits findings in one step: new evidence for Nora, and the task resolved', () => {
    as('cmd', c => mod.assign_task(c, { decision_id: decisionId, assignee: id.analyst, title: 'Verify backup timing' }));
    const tk = last('task');
    denied(() => as('cmd', c => mod.submit_findings(c, { task_id: tk.id, findings: 'x' })), /Only the assignee/);
    denied(() => as('analyst', c => mod.submit_findings(c, { task_id: tk.id, findings: '   ' })), /Findings is required/);
    as('analyst', c => mod.submit_findings(c, { task_id: tk.id, findings: 'Backup job logs show the Monday backup finished at 01:40, before the 03:12 session.' }));
    expect(last('task').state).toBe('resolved');
    expect(last('evidence')).toMatchObject({ source_type: 'verification', title: `Verification of D-${decisionId.toString().padStart(3, '0')}: Verify backup timing` });
    denied(() => as('analyst', c => mod.submit_findings(c, { task_id: tk.id, findings: 'again' })), /already resolved/);
    // Nora records that the findings support the decision.
    const evId = last('evidence').id;
    as('nora', c => mod.record_evidence_review(c, { evidence_id: evId, outcome: 'supports', summary: 'The backup predates the session.', model: 'm' }));
    expect(rows('evidence_review').find(r => r.evidence_id === evId).outcome).toBe('supports');
  });

  it('Tier 2 resolves a decision; resolving twice is a no-op', () => {
    denied(() => as('analyst', c => mod.resolve_decision(c, { decision_id: decisionId })), /needs Tier 2/);
    as('cmd', c => mod.resolve_decision(c, { decision_id: decisionId }));
    as('cmd', c => mod.resolve_decision(c, { decision_id: decisionId }));
    expect(byId('decision', decisionId)).toMatchObject({ state: 'closed', version: 3 });
  });

  it('a suggestion based on an older version of the evidence is refused as stale', () => {
    suggest();
    denied(() => as('cmd', c => mod.set_evidence_standing(c, { evidence_id: evidenceId, expected_version: 1, standing: 'disputed' })), /needs Tier 3/);
    as('forensics', c => mod.set_evidence_standing(c, { evidence_id: evidenceId, expected_version: 1, standing: 'disputed' }));
    const sid = last('suggestion').id;
    denied(() => as('analyst', c => mod.confirm_suggestion(c, { suggestion_id: sid, reason: 'Vendor admits no test restore' })), /stale/);
  });

  it('empty feedback dismisses without asking Nora', () => {
    suggest();
    const sid = last('suggestion').id;
    as('analyst', c => mod.dismiss_suggestion(c, { suggestion_id: sid, feedback: '   ' }));
    expect(last('suggestion')).toMatchObject({ state: 'dismissed', reassess_state: '', dismissal_feedback: '' });
    expect(rows('reassessment_request')).toEqual([]);
  });

  it('feedback queues a reassessment; a revision must quote the evidence; retry and stale replies behave', () => {
    suggest();
    const s = last('suggestion');
    as('analyst', c => mod.dismiss_suggestion(c, { suggestion_id: s.id, feedback: 'Vendor ran a restore test on Friday.' }));
    expect(view('nora', mod.nora_reassessment_queue).length).toBe(1);
    expect(view('cmd', mod.nora_reassessment_queue)).toEqual([]);
    const req1 = last('reassessment_request');

    denied(() => as('analyst', c => mod.complete_reassessment(c, { request_id: req1.id, result_json: '{}' })), /Access denied/);
    as('nora', c => mod.complete_reassessment(c, { request_id: req1.id, result_json: JSON.stringify({ kind: 'revision', excerpt: 'Invented sentence.', explanation: 'x', verification: 'y' }) }));
    expect(byId('suggestion', s.id)).toMatchObject({ reassess_state: 'failed', state: 'dismissed' });
    expect(byId('suggestion', s.id).reassess_error).toMatch(/not in the evidence/);

    as('analyst', c => mod.retry_reassessment(c, { suggestion_id: s.id }));
    const req2 = last('reassessment_request');
    expect(req2.attempt).toBe(2);
    // A late reply to the first request is ignored.
    as('nora', c => mod.complete_reassessment(c, { request_id: req1.id, result_json: JSON.stringify({ kind: 'no_further_review', note: 'late' }) }));
    expect(byId('suggestion', s.id).reassess_state).toBe('requested');

    as('nora', c => mod.complete_reassessment(c, { request_id: req2.id, result_json: JSON.stringify({ kind: 'revision', excerpt: 'Logs before Sunday are missing.', explanation: 'The test cannot prove the backup predates access.', verification: 'Check when the logs start.' }) }));
    const original = byId('suggestion', s.id);
    const revision = last('suggestion');
    expect(original).toMatchObject({ state: 'dismissed', reassess_state: 'revised', revision_id: revision.id, dismissal_feedback: 'Vendor ran a restore test on Friday.' });
    expect(revision).toMatchObject({ state: 'pending', origin: 'nora', revision_of: s.id, excerpt: 'Logs before Sunday are missing.' });
  });
});

describe('Nora (Nemotron) investigating new evidence', () => {
  const REPORT = 'Firewall logs show an admin session from an unknown host at 03:12 on Sunday. The Monday backup ran after that session.';
  let evidenceId: bigint, decisionId: bigint, updateId: bigint;
  beforeEach(() => {
    as('cmd', c => mod.draft_decision(c, { incident_id: inc, title: 'Restore from Monday backup', assumption: "Monday's backup predates the intrusion", evidence_ids: [] }));
    decisionId = last('decision').id;
    as('cmd', c => mod.approve_decision(c, { decision_id: decisionId, expected_version: 1 }));
    as('cmd', c => mod.create_team_update(c, { incident_id: inc, title: 'Restore plan', body: 'Restoring from Monday.', decision_ids: [decisionId] }));
    updateId = last('team_update').id;
    // Evidence from the Team room has no source: that must still work.
    as('analyst', c => mod.add_evidence(c, { incident_id: inc, title: 'Sunday access report', source_label: 'Firewall', source_type: 'report', content_text: REPORT, event_time: Timestamp.fromDate(new Date('2026-11-08T03:12:00Z')), source_id: undefined }));
    evidenceId = last('evidence').id;
  });
  const flag = (over: Partial<Record<string, unknown>> = {}) => ({
    evidence_id: evidenceId, decision_id: decisionId, excerpt: 'The Monday backup ran after that session.',
    explanation: "This challenges the assumption that Monday's backup predates the intrusion.",
    verification: 'Check when the intrusion began before restoring.', urgent: false, model: 'nvidia/nemotron-3-ultra-550b-a55b', ...over,
  });

  it('only Nora can review evidence, post as Nora, or flag decisions', () => {
    for (const name of ['analyst', 'cmd', 'forensics', 'owner']) {
      denied(() => as(name, c => mod.nora_flag_decision(c, flag())), /Access denied/);
      denied(() => as(name, c => mod.record_evidence_review(c, { evidence_id: evidenceId, outcome: 'no_impact', summary: '', model: 'm' })), /Access denied/);
      denied(() => as(name, c => mod.nora_post(c, { incident_id: inc, text: 'hi', recipient: undefined, evidence_id: undefined })), /Access denied/);
    }
  });

  it('no impact is saved quietly, once', () => {
    as('nora', c => mod.record_evidence_review(c, { evidence_id: evidenceId, outcome: 'no_impact', summary: 'Unrelated printer outage.', model: 'm' }));
    expect(byId('evidence_review', evidenceId) ?? rows('evidence_review').find(r => r.evidence_id === evidenceId)).toMatchObject({ outcome: 'no_impact' });
    denied(() => as('nora', c => mod.record_evidence_review(c, { evidence_id: evidenceId, outcome: 'no_impact', summary: '', model: 'm' })), /already reviewed/);
    denied(() => as('nora', c => mod.nora_flag_decision(c, flag())), /already reviewed/);
    expect(rows('suggestion')).toEqual([]);
  });

  it('a conflict becomes a suggestion aimed at that decision, quoting the evidence exactly', () => {
    denied(() => as('nora', c => mod.nora_flag_decision(c, flag({ excerpt: 'The backup is infected.' }))), /exact quote/);
    denied(() => as('nora', c => mod.nora_flag_decision(c, flag({ decision_id: 999n }))), /Decision not found/);
    as('nora', c => mod.nora_flag_decision(c, flag()));
    const sug = last('suggestion');
    expect(sug).toMatchObject({ origin: 'nora', state: 'pending', evidence_id: evidenceId, decision_ids: [decisionId], team_update_ids: [updateId] });
    expect(rows('suggestion_target')[0]).toMatchObject({ suggestion_id: sug.id, decision_id: decisionId, urgent: false });
    expect(rows('evidence_review')[0]).toMatchObject({ outcome: 'conflict', decision_id: decisionId, suggestion_id: sug.id });
    // Confirming flags that decision and its team update, and assigns verification.
    as('analyst', c => mod.confirm_suggestion(c, { suggestion_id: sug.id, reason: 'The timeline does not add up' }));
    expect(byId('decision', decisionId).state).toBe('needs_review');
    expect(byId('team_update', updateId).state).toBe('outdated');
    expect(last('task')).toMatchObject({ decision_id: decisionId, suggestion_id: sug.id, title: 'Check when the intrusion began before restoring.' });
  });

  it('urgent danger recommends escalation but changes nothing until a person acts', () => {
    as('nora', c => mod.nora_flag_decision(c, flag({ urgent: true })));
    expect(rows('evidence_review')[0].outcome).toBe('urgent');
    expect(rows('activity_event').some(a => a.action === 'escalation_recommended')).toBe(true);
    expect(byId('decision', decisionId).state).toBe('approved');
    expect(rows('audit_event').some(e => e.action === 'ESCALATION_RECOMMENDED')).toBe(true);
  });

  it('a changed decision makes the suggestion stale', () => {
    as('nora', c => mod.nora_flag_decision(c, flag()));
    const sid = last('suggestion').id;
    as('cmd', c => mod.resolve_decision(c, { decision_id: decisionId }));
    denied(() => as('analyst', c => mod.confirm_suggestion(c, { suggestion_id: sid, reason: 'The timeline does not add up' })), /changed|closed/);
  });

  it('dismissing with feedback gets a reassessment, and the revision stays aimed at the decision', () => {
    as('nora', c => mod.nora_flag_decision(c, flag()));
    const sid = last('suggestion').id;
    as('analyst', c => mod.dismiss_suggestion(c, { suggestion_id: sid, feedback: 'IT confirmed the 03:12 session was a scheduled job.' }));
    const req = last('reassessment_request');
    as('nora', c => mod.complete_reassessment(c, { request_id: req.id, result_json: JSON.stringify({ kind: 'revision', excerpt: 'Firewall logs show an admin session from an unknown host at 03:12 on Sunday.', explanation: 'The host is still unknown.', verification: 'Identify the host.' }) }));
    const revision = last('suggestion');
    expect(revision).toMatchObject({ revision_of: sid, state: 'pending' });
    expect(rows('suggestion_target').find(t => t.suggestion_id === revision.id)).toMatchObject({ decision_id: decisionId });
  });

  it('Nora posts in the discussion as herself; members see her reviews', () => {
    as('nora', c => mod.nora_post(c, { incident_id: inc, text: 'New evidence challenges D-001. See the suggestion.', recipient: undefined, evidence_id: evidenceId }));
    as('nora', c => mod.nora_post(c, { incident_id: inc, text: 'Recommend escalating.', recipient: id.cmd, evidence_id: undefined }));
    denied(() => as('nora', c => mod.nora_post(c, { incident_id: inc, text: 'x', recipient: id.outsider, evidence_id: undefined })), /Recipient must be/);
    expect(view('analyst', mod.incident_messages).map((m: any) => m.text)).toEqual(['New evidence challenges D-001. See the suggestion.']);
    expect(view('cmd', mod.incident_messages).length).toBe(2);
    expect(last('message').author.isEqual(id.nora)).toBe(true);
    as('nora', c => mod.nora_flag_decision(c, flag()));
    expect(view('analyst', mod.incident_evidence_reviews).length).toBe(1);
    expect(view('analyst', mod.incident_suggestion_targets).length).toBe(1);
    expect(view('outsider', mod.incident_evidence_reviews)).toEqual([]);
  });
});

describe('outside contacts and simulated SMS', () => {
  beforeEach(() => {
    as('analyst', c => mod.add_outside_contact(c, { incident_id: inc, account_ref: 'NSR-1008', display_name: 'Dana (CFO)', demo_identity: id.phone2 }));
  });

  it('the contact sees only their own thread, never the incident', () => {
    const contact = last('outside_contact');
    as('analyst', c => mod.send_sms(c, { contact_id: contact.id, text: 'Did you just sign in from a new phone?' }));
    as('phone2', c => mod.reply_sms(c, { contact_id: contact.id, text: 'No, that was not me.' }));
    expect(view('phone2', mod.my_sms_threads).map((m: any) => m.direction)).toEqual(['to_contact', 'from_contact']);
    expect(view('phone2', mod.my_contact_profile).length).toBe(1);
    for (const v of [mod.my_incidents, mod.incident_accounts, mod.incident_sms, mod.incident_audit, mod.incident_findings]) {
      expect(view('phone2', v)).toEqual([]);
    }
    expect(view('cmd', mod.incident_sms).length).toBe(2);
    expect(view('cmd', mod.my_sms_threads)).toEqual([]);
  });

  it('only that contact can reply, outsiders cannot text, and responders cannot double as contacts', () => {
    const contact = last('outside_contact');
    denied(() => as('outsider', c => mod.reply_sms(c, { contact_id: contact.id, text: 'hi' })), /Access denied/);
    denied(() => as('outsider', c => mod.send_sms(c, { contact_id: contact.id, text: 'hi' })), /Access denied/);
    denied(() => as('analyst', c => mod.add_outside_contact(c, { incident_id: inc, account_ref: 'NSR-1015', display_name: 'X', demo_identity: id.cmd })), /responder cannot/);
    denied(() => as('analyst', c => mod.add_outside_contact(c, { incident_id: inc, account_ref: 'NSR-1015', display_name: 'X', demo_identity: id.phone2 })), /already a contact/);
  });

  it('SMS text never enters the audit chain', () => {
    const cid = last('outside_contact').id;
    as('analyst', c => mod.send_sms(c, { contact_id: cid, text: 'Reset code is 482913' }));
    const event = rows('audit_event').find(e => e.action === 'SMS_SENT');
    expect(event).toBeDefined();
    expect(event.metadata).not.toContain('482913');
    expect(JSON.parse(event.metadata)).toMatchObject({ direction: 'to_contact', simulated: true });
  });
});

describe('Change 1: direct messages', () => {
  it('a message with a recipient is visible only to its author and recipient', () => {
    as('analyst', c => mod.add_message(c, { incident_id: inc, text: 'Only for the commander', client_request_id: undefined, recipient: id.cmd, evidence_id: undefined }));
    as('analyst', c => mod.add_message(c, { incident_id: inc, text: 'For everyone', client_request_id: undefined, recipient: undefined, evidence_id: undefined }));
    expect(view('cmd', mod.incident_messages).length).toBe(2);
    expect(view('analyst', mod.incident_messages).length).toBe(2);
    expect(view('forensics', mod.incident_messages).map((m: any) => m.text)).toEqual(['For everyone']);
    denied(() => as('analyst', c => mod.add_message(c, { incident_id: inc, text: 'x', client_request_id: undefined, recipient: id.outsider, evidence_id: undefined })), /Recipient must be/);
    denied(() => as('analyst', c => mod.add_message(c, { incident_id: inc, text: 'x', client_request_id: undefined, recipient: undefined, evidence_id: 999n })), /Evidence not found/);
  });
});

describe('new incidents', () => {
  it('start as awaiting information with unknown severity', () => {
    as('owner', c => mod.create_incident(c, { title: 'Fresh', summary: '', severity: 'unknown' }));
    expect(last('incident')).toMatchObject({ status: 'awaiting_information', severity: 'unknown' });
  });
});

describe('invite links', () => {
  it('a Tier 3 creates a code; anyone with it joins at its tier; removed people cannot rejoin', () => {
    denied(() => as('cmd', c => mod.set_join_code(c, { incident_id: inc, code: 'Abc12345xyz', tier: 'tier1' })), /Access denied|Tier 3|tier/i);
    denied(() => as('forensics', c => mod.set_join_code(c, { incident_id: inc, code: 'Abc12345xyz', tier: 'tier3' })), /Tier 1 or Tier 2/);
    as('forensics', c => mod.set_join_code(c, { incident_id: inc, code: 'Abc12345xyz', tier: 'tier1' }));
    expect(view('forensics', mod.incident_join_codes).length).toBe(1);
    expect(view('analyst', mod.incident_join_codes).length).toBe(0);
    denied(() => as('outsider', c => mod.join_with_code(c, { code: 'wrongcode1' })), /not valid/);
    as('outsider', c => mod.join_with_code(c, { code: 'Abc12345xyz' }));
    as('outsider', c => mod.join_with_code(c, { code: 'Abc12345xyz' }));
    const mine = rows('membership').filter((m: any) => m.user.isEqual(id.outsider) && m.incident_id === inc);
    expect(mine.length).toBe(1);
    expect(mine[0].roles).toEqual(['tier1']);
    as('outsider', c => mod.add_message(c, { incident_id: inc, text: 'Joined by link', client_request_id: undefined, recipient: undefined, evidence_id: undefined }));
    as('forensics', c => mod.revoke_member(c, { incident_id: inc, user: id.outsider }));
    denied(() => as('outsider', c => mod.join_with_code(c, { code: 'Abc12345xyz' })), /removed/);
    as('forensics', c => mod.set_join_code(c, { incident_id: inc, code: '', tier: 'tier1' }));
    expect(view('forensics', mod.incident_join_codes).length).toBe(0);
  });
});

describe('each issue has its own discussion', () => {
  it('a message posted on a decision is linked to it, and only members can post', () => {
    as('cmd', c => mod.draft_decision(c, { incident_id: inc, title: 'Restore from Monday backup', assumption: "Monday's backup predates the intrusion", evidence_ids: [] }));
    const did = last('decision').id;
    as('analyst', c => mod.add_issue_message(c, { decision_id: did, text: 'Has restoration started?', client_request_id: 'r1', recipient: undefined }));
    as('cmd', c => mod.add_issue_message(c, { decision_id: did, text: 'Not yet.', client_request_id: undefined, recipient: id.analyst }));
    as('analyst', c => mod.add_issue_message(c, { decision_id: did, text: 'Has restoration started?', client_request_id: 'r1', recipient: undefined }));
    const links = view('analyst', mod.incident_message_decisions);
    expect(links.length).toBe(2);
    expect(links.every((l: any) => l.decision_id === did)).toBe(true);
    expect(view('forensics', mod.incident_messages).map((m: any) => m.text)).toEqual(['Has restoration started?']);
    denied(() => as('outsider', c => mod.add_issue_message(c, { decision_id: did, text: 'x', client_request_id: undefined, recipient: undefined })), /Access denied|not a member|Not a member/);
    denied(() => as('analyst', c => mod.add_issue_message(c, { decision_id: 999n, text: 'x', client_request_id: undefined, recipient: undefined })), /Decision not found/);
  });
});

describe('audit chain', () => {
  const eventsFor = (incidentId: string) => rows('audit_event').filter(e => e.incident_id === incidentId).map(rowToEvent);
  const headFor = (incidentId: string) => rows('audit_head').find(r => r.incident_id === incidentId);

  it('every change lands in a chain that verifies, for the incident and the platform', () => {
    as('nora', c => mod.create_finding(c, finding()));
    const fid = last('finding').id;
    as('cmd', c => mod.approve_finding(c, { finding_id: fid, expected_version: 1 }));
    const key = inc.toString();
    const actions = eventsFor(key).map(e => e.action);
    for (const a of ['INCIDENT_CREATED', 'MEMBER_ADMITTED', 'DEMO_LOADED', 'FINDING_CREATED', 'ACCOUNT_STATUS_CHANGED', 'FINDING_APPROVED']) {
      expect(actions).toContain(a);
    }
    expect(eventsFor(key).find(e => e.action === 'FINDING_CREATED')!.actorKind).toBe('service');
    for (const incidentId of [key, PLATFORM_INCIDENT]) {
      const head = headFor(incidentId);
      const r = verifyChain(incidentId, eventsFor(incidentId), { head: { seq: head.seq, hash: head.hash } });
      expect(r.findings).toEqual([]);
      expect(r.ok).toBe(true);
    }
    expect(eventsFor(PLATFORM_INCIDENT).map(e => e.action)).toEqual(['MODULE_INITIALIZED', 'ADMIN_GRANTED', 'SERVICE_ACCOUNT_SET', 'SERVICE_ACCOUNT_SET']);
  });

  it('editing one stored event is detected at that event', () => {
    const key = inc.toString();
    const events = eventsFor(key);
    events[2] = { ...events[2], metadata: '{"detail":"nothing happened"}' };
    const r = verifyChain(key, events);
    expect(r.ok).toBe(false);
    expect(r.firstBreakSeq).toBe(events[2].seq);
  });

  it('members read their incident’s audit feed; outsiders get nothing', () => {
    expect(view('forensics', mod.incident_audit).length).toBe(eventsFor(inc.toString()).length);
    expect(view('forensics', mod.incident_audit_heads).length).toBe(1);
    expect(view('outsider', mod.incident_audit)).toEqual([]);
  });
});
