// Gate 1 verification: authorization on reads (views) and writes (reducers).
// Maps to the brief's section 15 matrix. Runs in-process via the SDK's module test harness.
//
// NOTE: rejections are asserted as SenderError with a specific message so a test cannot
// pass vacuously on an unrelated crash. Identities are resolved OUTSIDE reducer callbacks
// (nested transactions trap in the harness).
import { describe, it, expect, beforeEach } from 'vitest';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import { ConnectionId, Identity } from 'spacetimedb';
import * as mod from '../src/index';

const jwt = (sub: string) => JSON.stringify({ iss: 'https://test.local', sub, aud: ['clean-room'] });
let nextConn = 1n;
const who = (sub: string) => TestAuth.fromJwtPayload(jwt(sub), new ConnectionId(nextConn++));

let h: ReturnType<typeof createModuleTestHarness<any>>;
let owner: TestAuth, cmd: TestAuth, analyst: TestAuth, outsider: TestAuth;
let ownerId: Identity, cmdId: Identity, analystId: Identity, outsiderId: Identity;

const resolveId = (a: TestAuth): Identity => {
  let id!: Identity;
  h.withReducerTx(a, ctx => { id = ctx.sender; });
  return id;
};
const run = (a: TestAuth, fn: (ctx: any) => void) => h.withReducerTx(a, fn);
const view = (a: TestAuth, v: any) => v(h.viewContext(a), {});

/** Assert the call is rejected by our own authorization/validation (SenderError), not a crash. */
function denied(fn: () => void, message: RegExp) {
  let err: any;
  try { fn(); } catch (e) { err = e; }
  expect(err, 'expected the operation to be rejected').toBeDefined();
  expect(err.constructor.name).toBe('SenderError');
  expect(String(err.message)).toMatch(message);
}

const msg = (incident_id: bigint, text: string, client_request_id?: string) =>
  ({ incident_id, text, client_request_id });
const upd = (incident_id: bigint, expected_version: number, status?: string) =>
  ({ incident_id, expected_version, status, severity: undefined, summary: undefined, reason: 'triage' });

function makeIncident(title = 'Synthetic training incident') {
  run(owner, ctx => mod.create_incident(ctx, { title, summary: 's', severity: 'high' }));
  const rows = [...h.db.incident.iter()];
  return rows[rows.length - 1].id as bigint;
}
const admit = (id: bigint, user: Identity, roles: string[]) =>
  run(owner, c => mod.admit_member(c, { incident_id: id, user, roles }));

beforeEach(() => {
  h = createModuleTestHarness(mod.default, mod as any);
  owner = who('owner'); cmd = who('cmd'); analyst = who('analyst'); outsider = who('outsider');
  ownerId = resolveId(owner); cmdId = resolveId(cmd);
  analystId = resolveId(analyst); outsiderId = resolveId(outsider);
  run(owner, ctx => mod.init(ctx, {} as any));
});

describe('bootstrap', () => {
  it('publisher becomes the only platform admin; others cannot create incidents', () => {
    expect([...h.db.platform_admin.iter()].length).toBe(1);
    denied(() => run(outsider, ctx =>
      mod.create_incident(ctx, { title: 't', summary: '', severity: 'low' })), /Access denied/);
    expect([...h.db.incident.iter()].length).toBe(0);
  });
});

describe('reads: outsider sees nothing (views are per-caller)', () => {
  it('outsider gets empty results from every view even though the incident exists', () => {
    const id = makeIncident();
    run(owner, ctx => mod.add_message(ctx, msg(id, 'secret')));
    for (const v of [mod.my_incidents, mod.my_memberships, mod.incident_members,
                     mod.incident_messages, mod.incident_activity]) {
      expect(view(outsider, v)).toEqual([]);
    }
    expect(view(owner, mod.my_incidents).length).toBe(1);
    expect(view(owner, mod.incident_messages).length).toBe(1);
  });
});

describe('writes: outsider and low-privilege roles are rejected', () => {
  it('outsider cannot chat, admit, update, or self-enroll', () => {
    const id = makeIncident();
    denied(() => run(outsider, c => mod.add_message(c, msg(id, 'hi'))), /Access denied/);
    denied(() => run(outsider, c => mod.admit_member(c, { incident_id: id, user: outsiderId, roles: ['admin'] })), /Access denied/);
    denied(() => run(outsider, c => mod.update_incident(c, upd(id, 1, 'closed'))), /Access denied/);
    expect([...h.db.message.iter()].length).toBe(0);
    expect([...h.db.membership.iter()].length).toBe(1); // only the creator
  });

  it('a nonexistent incident id gives the same denial (existence is not revealed)', () => {
    denied(() => run(outsider, c => mod.add_message(c, msg(999n, 'hi'))), /Access denied/);
  });

  it('analyst cannot admit members or change incident state', () => {
    const id = makeIncident();
    admit(id, analystId, ['analyst']);
    denied(() => run(analyst, c => mod.admit_member(c, { incident_id: id, user: outsiderId, roles: ['analyst'] })), /insufficient role/);
    denied(() => run(analyst, c => mod.update_incident(c, upd(id, 1, 'containing'))), /insufficient role/);
    expect(view(outsider, mod.my_incidents)).toEqual([]);
  });

  it('invalid and empty role lists are rejected', () => {
    const id = makeIncident();
    denied(() => admit(id, analystId, ['root']), /Unknown role/);
    denied(() => admit(id, analystId, []), /At least one role/);
    expect(view(analyst, mod.my_incidents)).toEqual([]);
  });
});

describe('admission and isolation', () => {
  it('admitted analyst reads only their incident; cross-incident access is denied', () => {
    const a = makeIncident('A');
    const b = makeIncident('B');
    admit(a, analystId, ['analyst']);
    expect(view(analyst, mod.my_incidents).map((r: any) => r.id)).toEqual([a]);
    run(owner, c => mod.add_message(c, msg(b, 'B only')));
    expect(view(analyst, mod.incident_messages)).toEqual([]);
    denied(() => run(analyst, c => mod.add_message(c, msg(b, 'x'))), /Access denied/);
  });

  it('two authorized users exchange messages; duplicate request ids are idempotent', () => {
    const id = makeIncident();
    admit(id, analystId, ['analyst']);
    run(analyst, c => mod.add_message(c, msg(id, 'hello', 'r1')));
    run(analyst, c => mod.add_message(c, msg(id, 'hello', 'r1')));
    run(owner, c => mod.add_message(c, msg(id, 'ack')));
    expect(view(owner, mod.incident_messages).length).toBe(2);
    expect(view(analyst, mod.incident_messages).length).toBe(2);
  });

  it('admin alone cannot change operational state; a commander can; stale versions rejected', () => {
    const id = makeIncident();
    denied(() => run(owner, c => mod.update_incident(c, upd(id, 1))), /insufficient role/);
    admit(id, cmdId, ['commander']);
    run(cmd, c => mod.update_incident(c, upd(id, 1, 'containing')));
    denied(() => run(cmd, c => mod.update_incident(c, upd(id, 1, 'recovering'))), /changed since/);
    expect(view(cmd, mod.my_incidents)[0].status).toBe('containing');
    denied(() => run(cmd, c => mod.update_incident(c, upd(id, 2, 'bogus'))), /Invalid status/);
  });

  it('commander can be assigned only from active members holding the commander role', () => {
    const id = makeIncident();
    admit(id, analystId, ['analyst']);
    denied(() => run(owner, c => mod.assign_commander(c, { incident_id: id, user: analystId })), /commander role/);
    denied(() => run(owner, c => mod.assign_commander(c, { incident_id: id, user: outsiderId })), /commander role/);
    admit(id, cmdId, ['commander']);
    run(owner, c => mod.assign_commander(c, { incident_id: id, user: cmdId }));
    expect(view(owner, mod.my_incidents)[0].commander?.toHexString()).toBe(cmdId.toHexString());
  });

  it('visible_profiles only shows people who share an incident', () => {
    const id = makeIncident();
    for (const a of [owner, analyst, outsider]) run(a, c => mod.set_display_name(c, { display_name: 'n' + Math.random() }));
    admit(id, analystId, ['analyst']);
    const seenByAnalyst = view(analyst, mod.visible_profiles).map((p: any) => p.identity.toHexString());
    expect(seenByAnalyst).toContain(ownerId.toHexString());
    expect(seenByAnalyst).not.toContain(outsiderId.toHexString());
  });
});

describe('revocation', () => {
  it('revoked member loses reads and writes immediately', () => {
    const id = makeIncident();
    admit(id, analystId, ['analyst']);
    run(owner, c => mod.add_message(c, msg(id, 'before')));
    expect(view(analyst, mod.incident_messages).length).toBe(1);
    run(owner, c => mod.revoke_member(c, { incident_id: id, user: analystId }));
    for (const v of [mod.my_incidents, mod.my_memberships, mod.incident_members, mod.incident_messages, mod.incident_activity]) {
      expect(view(analyst, v)).toEqual([]);
    }
    denied(() => run(analyst, c => mod.add_message(c, msg(id, 'after'))), /Access denied/);
  });

  it('revoking the commander clears the incident commander pointer', () => {
    const id = makeIncident();
    admit(id, cmdId, ['commander']);
    run(owner, c => mod.assign_commander(c, { incident_id: id, user: cmdId }));
    run(owner, c => mod.revoke_member(c, { incident_id: id, user: cmdId }));
    expect(view(owner, mod.my_incidents)[0].commander).toBeUndefined();
  });

  it('cannot revoke or demote the last active admin', () => {
    const id = makeIncident();
    denied(() => run(owner, c => mod.revoke_member(c, { incident_id: id, user: ownerId })), /last active admin/);
    denied(() => run(owner, c => mod.set_member_roles(c, { incident_id: id, user: ownerId, roles: ['analyst'] })), /last active admin/);
  });

  it('a re-admitted user gets a fresh active membership; history is kept', () => {
    const id = makeIncident();
    admit(id, analystId, ['analyst']);
    run(owner, c => mod.revoke_member(c, { incident_id: id, user: analystId }));
    admit(id, analystId, ['reviewer']);
    const mine = view(analyst, mod.my_memberships);
    expect(mine.length).toBe(1);
    expect(mine[0].roles).toEqual(['reviewer']);
    expect([...h.db.membership.iter()].length).toBe(3);
  });

  it('admitting an already-active member is rejected (no duplicate memberships)', () => {
    const id = makeIncident();
    admit(id, analystId, ['analyst']);
    denied(() => admit(id, analystId, ['reviewer']), /already an active member/);
  });
});

describe('input validation and audit trail', () => {
  it('rejects oversized and empty chat messages', () => {
    const id = makeIncident();
    denied(() => run(owner, c => mod.add_message(c, msg(id, 'x'.repeat(2001)))), /at most 2000/);
    denied(() => run(owner, c => mod.add_message(c, msg(id, '   '))), /required/);
  });

  it('HTML/script text is stored as inert text (UI must render as text)', () => {
    const id = makeIncident();
    run(owner, c => mod.add_message(c, msg(id, '<script>alert(1)</script>')));
    expect(view(owner, mod.incident_messages)[0].text).toBe('<script>alert(1)</script>');
  });

  it('membership changes are written to the activity log with the actor', () => {
    const id = makeIncident();
    admit(id, analystId, ['analyst']);
    run(owner, c => mod.revoke_member(c, { incident_id: id, user: analystId }));
    const events = view(owner, mod.incident_activity);
    expect(events.map((e: any) => e.action)).toEqual(['incident_created', 'member_admitted', 'member_revoked']);
    expect(events.every((e: any) => e.actor.toHexString() === ownerId.toHexString())).toBe(true);
  });
});
