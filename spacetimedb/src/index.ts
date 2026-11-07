// Clean Room - Gate 1 module: secure shared incident.
//
// Security model (see docs/SECURITY.md):
//  * Every table is PRIVATE (no `public: true`). Clients never subscribe to raw tables.
//  * Clients read data only through per-user VIEWS that filter on ctx.sender's ACTIVE
//    membership. Flipping `membership.active` to false removes rows from the view.
//  * Every reducer derives identity from ctx.sender and looks membership up server-side.
//    Nothing the client sends is treated as proof of identity, role, or membership.
//  * Default deny.

import { schema, table, t, SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';

// ---------- constants ----------

const ROLES = ['admin', 'commander', 'analyst', 'reviewer'] as const;
type Role = (typeof ROLES)[number];

const STATUSES = ['investigating', 'containing', 'recovering', 'monitoring', 'closed'] as const;
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

const ENCRYPTION_STATES = ['unknown', 'suspected', 'confirmed', 'not_observed'] as const;
const EXFILTRATION_STATES = ['unknown', 'suspected', 'confirmed', 'not_observed'] as const;

const MAX_TITLE = 200;
const MAX_SUMMARY = 5000;
const MAX_MESSAGE = 2000;
const MAX_NAME = 64;
const MAX_REASON = 500;
const MAX_REQUEST_ID = 64;

const MAX_SYSTEM_NAME = 100;
const MAX_DATA_CATEGORY = 100;
const MAX_EXTENT = 200;
const MAX_EVIDENCE_TITLE = 200;
const MAX_EVIDENCE_CONTENT = 50000;

// ---------- tables (all private) ----------

const platform_admin = table(
  {},
  {
    identity: t.identity().primaryKey(),
    granted_at: t.timestamp(),
  }
);

const user_profile = table(
  {},
  {
    identity: t.identity().primaryKey(),
    display_name: t.string(),
    updated_at: t.timestamp(),
  }
);

const incident = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    title: t.string(),
    summary: t.string(),
    status: t.string(),
    severity: t.string(),
    commander: t.option(t.identity()),
    created_by: t.identity(),
    created_at: t.timestamp(),
    updated_at: t.timestamp(),
    version: t.u32(),
  }
);

// One row per admission. Revocation flips `active`; rows are kept as history.
// A person may hold several roles (modelled explicitly). Admin does NOT imply commander.
const membership = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    user: t.identity().index('btree'),
    roles: t.array(t.string()),
    active: t.bool(),
    admitted_by: t.identity(),
    admitted_at: t.timestamp(),
    revoked_by: t.option(t.identity()),
    revoked_at: t.option(t.timestamp()),
  }
);

const message = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    author: t.identity(),
    text: t.string(),
    recorded_at: t.timestamp(),
    client_request_id: t.option(t.string()),
  }
);

// Application-controlled history. NOT cryptographically immutable.
const activity_event = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    actor: t.identity(),
    action: t.string(),
    entity_type: t.string(),
    entity_id: t.u64(),
    detail: t.string(),
    timestamp: t.timestamp(),
  }
);

const scope_item = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    system_name: t.string(),
    data_category: t.string(),
    affected_extent: t.string(),
    encryption_status: t.string(),
    exfiltration_status: t.string(),
    business_impact: t.string(),
    owner: t.identity(),
    observed_at: t.timestamp(),
    updated_at: t.timestamp(),
    version: t.u32(),
  }
);

const evidence = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    title: t.string(),
    source_label: t.string(),
    source_type: t.string(),
    content_text: t.string(),
    event_time: t.timestamp(),
    recorded_at: t.timestamp(),
    submitted_by: t.identity(),
    version: t.u32(),
  }
);

const spacetimedb = schema({
  platform_admin,
  user_profile,
  incident,
  membership,
  message,
  activity_event,
  scope_item,
  evidence,
});
export default spacetimedb;

// ---------- helpers ----------

type Ctx = Parameters<Parameters<typeof spacetimedb.reducer>[1]>[0];

function fail(msg: string): never {
  throw new SenderError(msg);
}

function cleanText(value: string, field: string, min: number, max: number): string {
  const v = value.trim();
  if (v.length < min) fail(`${field} is required`);
  if (v.length > max) fail(`${field} must be at most ${max} characters`);
  return v;
}

function validateRoles(input: string[]): Role[] {
  const set = new Set<string>(input);
  if (set.size === 0) fail('At least one role is required');
  for (const r of set) {
    if (!(ROLES as readonly string[]).includes(r)) fail(`Unknown role: ${r}`);
  }
  return [...set] as Role[];
}

/** Server-side lookup of the caller's ACTIVE membership in an incident. Returns undefined if none. */
function activeMembership(ctx: Ctx, incidentId: bigint, who: Identity) {
  for (const m of ctx.db.membership.user.filter(who)) {
    if (m.incident_id === incidentId && m.active) return m;
  }
  return undefined;
}

/** Default deny: caller must be an active member holding at least one of `allowed` roles. */
function requireRole(ctx: Ctx, incidentId: bigint, allowed: readonly Role[]) {
  const m = activeMembership(ctx, incidentId, ctx.sender);
  if (!m) fail('Access denied');
  if (!m.roles.some(r => (allowed as readonly string[]).includes(r))) {
    fail('Access denied: insufficient role');
  }
  return m;
}

function requireIncident(ctx: Ctx, incidentId: bigint) {
  const inc = ctx.db.incident.id.find(incidentId);
  if (!inc) fail('Access denied'); // same message as non-membership: do not reveal existence
  return inc;
}

function countActiveAdmins(ctx: Ctx, incidentId: bigint): number {
  let n = 0;
  for (const m of ctx.db.membership.incident_id.filter(incidentId)) {
    if (m.active && m.roles.includes('admin')) n++;
  }
  return n;
}

function logActivity(
  ctx: Ctx,
  incidentId: bigint,
  action: string,
  entityType: string,
  entityId: bigint,
  detail: string
) {
  ctx.db.activity_event.insert({
    id: 0n,
    incident_id: incidentId,
    actor: ctx.sender,
    action,
    entity_type: entityType,
    entity_id: entityId,
    detail: detail.slice(0, 500),
    timestamp: ctx.timestamp,
  });
}

// ---------- lifecycle ----------

// Runs once when the module is first published. The publishing identity becomes the
// first platform admin. There is no "first visitor becomes admin" path.
export const init = spacetimedb.init(ctx => {
  ctx.db.platform_admin.insert({ identity: ctx.sender, granted_at: ctx.timestamp });
});

// ---------- reducers ----------

export const set_display_name = spacetimedb.reducer(
  { display_name: t.string() },
  (ctx, { display_name }) => {
    const name = cleanText(display_name, 'Display name', 1, MAX_NAME);
    const existing = ctx.db.user_profile.identity.find(ctx.sender);
    if (existing) {
      ctx.db.user_profile.identity.update({ ...existing, display_name: name, updated_at: ctx.timestamp });
    } else {
      ctx.db.user_profile.insert({ identity: ctx.sender, display_name: name, updated_at: ctx.timestamp });
    }
  }
);

export const create_incident = spacetimedb.reducer(
  { title: t.string(), summary: t.string(), severity: t.string() },
  (ctx, { title, summary, severity }) => {
    if (!ctx.db.platform_admin.identity.find(ctx.sender)) fail('Access denied');
    if (!(SEVERITIES as readonly string[]).includes(severity)) fail('Invalid severity');
    const row = ctx.db.incident.insert({
      id: 0n,
      title: cleanText(title, 'Title', 1, MAX_TITLE),
      summary: cleanText(summary, 'Summary', 0, MAX_SUMMARY),
      status: 'investigating',
      severity,
      commander: undefined,
      created_by: ctx.sender,
      created_at: ctx.timestamp,
      updated_at: ctx.timestamp,
      version: 1,
    });
    // Creator becomes the incident's admin (membership management only).
    ctx.db.membership.insert({
      id: 0n,
      incident_id: row.id,
      user: ctx.sender,
      roles: ['admin'],
      active: true,
      admitted_by: ctx.sender,
      admitted_at: ctx.timestamp,
      revoked_by: undefined,
      revoked_at: undefined,
    });
    logActivity(ctx, row.id, 'incident_created', 'incident', row.id, row.title);
  }
);

export const admit_member = spacetimedb.reducer(
  { incident_id: t.u64(), user: t.identity(), roles: t.array(t.string()) },
  (ctx, { incident_id, user, roles }) => {
    requireRole(ctx, incident_id, ['admin']);
    requireIncident(ctx, incident_id);
    const validated = validateRoles(roles);
    if (activeMembership(ctx, incident_id, user)) fail('User is already an active member');
    const row = ctx.db.membership.insert({
      id: 0n,
      incident_id,
      user,
      roles: validated,
      active: true,
      admitted_by: ctx.sender,
      admitted_at: ctx.timestamp,
      revoked_by: undefined,
      revoked_at: undefined,
    });
    logActivity(ctx, incident_id, 'member_admitted', 'membership', row.id,
      `${user.toHexString().slice(0, 12)} as ${validated.join(',')}`);
  }
);

export const set_member_roles = spacetimedb.reducer(
  { incident_id: t.u64(), user: t.identity(), roles: t.array(t.string()) },
  (ctx, { incident_id, user, roles }) => {
    requireRole(ctx, incident_id, ['admin']);
    const validated = validateRoles(roles);
    const target = activeMembership(ctx, incident_id, user);
    if (!target) fail('User is not an active member');
    // Never remove the last active admin.
    if (target.roles.includes('admin') && !validated.includes('admin')
        && countActiveAdmins(ctx, incident_id) <= 1) {
      fail('Cannot remove the last active admin');
    }
    ctx.db.membership.id.update({ ...target, roles: validated });
    logActivity(ctx, incident_id, 'member_roles_changed', 'membership', target.id,
      `${user.toHexString().slice(0, 12)} -> ${validated.join(',')}`);
  }
);

export const revoke_member = spacetimedb.reducer(
  { incident_id: t.u64(), user: t.identity() },
  (ctx, { incident_id, user }) => {
    requireRole(ctx, incident_id, ['admin']);
    const target = activeMembership(ctx, incident_id, user);
    if (!target) fail('User is not an active member');
    if (target.roles.includes('admin') && countActiveAdmins(ctx, incident_id) <= 1) {
      fail('Cannot revoke the last active admin');
    }
    ctx.db.membership.id.update({
      ...target,
      active: false,
      revoked_by: ctx.sender,
      revoked_at: ctx.timestamp,
    });
    // Clear commander pointer if the revoked user held it.
    const inc = ctx.db.incident.id.find(incident_id);
    if (inc?.commander && inc.commander.isEqual(user)) {
      ctx.db.incident.id.update({ ...inc, commander: undefined, updated_at: ctx.timestamp, version: inc.version + 1 });
    }
    logActivity(ctx, incident_id, 'member_revoked', 'membership', target.id,
      user.toHexString().slice(0, 12));
  }
);

export const assign_commander = spacetimedb.reducer(
  { incident_id: t.u64(), user: t.identity() },
  (ctx, { incident_id, user }) => {
    requireRole(ctx, incident_id, ['admin']);
    const inc = requireIncident(ctx, incident_id);
    const target = activeMembership(ctx, incident_id, user);
    if (!target || !target.roles.includes('commander')) {
      fail('Target must be an active member with the commander role');
    }
    ctx.db.incident.id.update({ ...inc, commander: user, updated_at: ctx.timestamp, version: inc.version + 1 });
    logActivity(ctx, incident_id, 'commander_assigned', 'incident', incident_id,
      user.toHexString().slice(0, 12));
  }
);

export const update_incident = spacetimedb.reducer(
  {
    incident_id: t.u64(),
    expected_version: t.u32(),
    status: t.option(t.string()),
    severity: t.option(t.string()),
    summary: t.option(t.string()),
    reason: t.string(),
  },
  (ctx, { incident_id, expected_version, status, severity, summary, reason }) => {
    requireRole(ctx, incident_id, ['commander']); // admin alone cannot change operational state
    const inc = requireIncident(ctx, incident_id);
    if (inc.version !== expected_version) fail('Incident changed since you loaded it; refresh and retry');
    const why = cleanText(reason, 'Reason', 1, MAX_REASON);
    const next = { ...inc, updated_at: ctx.timestamp, version: inc.version + 1 };
    const changes: string[] = [];
    if (status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(status)) fail('Invalid status');
      if (status !== inc.status) { next.status = status; changes.push(`status ${inc.status}->${status}`); }
    }
    if (severity !== undefined) {
      if (!(SEVERITIES as readonly string[]).includes(severity)) fail('Invalid severity');
      if (severity !== inc.severity) { next.severity = severity; changes.push(`severity ${inc.severity}->${severity}`); }
    }
    if (summary !== undefined) {
      next.summary = cleanText(summary, 'Summary', 0, MAX_SUMMARY);
      changes.push('summary updated');
    }
    if (changes.length === 0) fail('No changes');
    ctx.db.incident.id.update(next);
    logActivity(ctx, incident_id, 'incident_updated', 'incident', incident_id, `${changes.join('; ')} (${why})`);
  }
);

export const add_scope_item = spacetimedb.reducer(
  {
    incident_id: t.u64(),
    system_name: t.string(),
    data_category: t.string(),
    affected_extent: t.string(),
    encryption_status: t.string(),
    exfiltration_status: t.string(),
    business_impact: t.string(),
  },
  (ctx, { incident_id, system_name, data_category, affected_extent, encryption_status, exfiltration_status, business_impact }) => {
    requireRole(ctx, incident_id, ['admin', 'commander', 'analyst']); // Reviewers are read-only
    requireIncident(ctx, incident_id);
    
    if (!(ENCRYPTION_STATES as readonly string[]).includes(encryption_status)) fail('Invalid encryption status');
    if (!(EXFILTRATION_STATES as readonly string[]).includes(exfiltration_status)) fail('Invalid exfiltration status');

    const row = ctx.db.scope_item.insert({
      id: 0n,
      incident_id,
      system_name: cleanText(system_name, 'System name', 1, MAX_SYSTEM_NAME),
      data_category: cleanText(data_category, 'Data category', 1, MAX_DATA_CATEGORY),
      affected_extent: cleanText(affected_extent, 'Affected extent', 1, MAX_EXTENT),
      encryption_status,
      exfiltration_status,
      business_impact: cleanText(business_impact, 'Business impact', 1, MAX_SUMMARY),
      owner: ctx.sender,
      observed_at: ctx.timestamp,
      updated_at: ctx.timestamp,
      version: 1,
    });

    logActivity(ctx, incident_id, 'scope_added', 'scope_item', row.id, row.system_name);
  }
);

export const add_evidence = spacetimedb.reducer(
  {
    incident_id: t.u64(),
    title: t.string(),
    source_label: t.string(),
    source_type: t.string(),
    content_text: t.string(),
    event_time: t.timestamp(),
  },
  (ctx, { incident_id, title, source_label, source_type, content_text, event_time }) => {
    requireRole(ctx, incident_id, ['admin', 'commander', 'analyst']);
    requireIncident(ctx, incident_id);

    const row = ctx.db.evidence.insert({
      id: 0n,
      incident_id,
      title: cleanText(title, 'Title', 1, MAX_EVIDENCE_TITLE),
      source_label: cleanText(source_label, 'Source label', 1, MAX_NAME),
      source_type: cleanText(source_type, 'Source type', 1, MAX_NAME),
      content_text: cleanText(content_text, 'Content text', 1, MAX_EVIDENCE_CONTENT),
      event_time,
      recorded_at: ctx.timestamp,
      submitted_by: ctx.sender,
      version: 1,
    });

    logActivity(ctx, incident_id, 'evidence_added', 'evidence', row.id, row.title);
  }
);

export const add_message = spacetimedb.reducer(
  { incident_id: t.u64(), text: t.string(), client_request_id: t.option(t.string()) },
  (ctx, { incident_id, text, client_request_id }) => {
    requireRole(ctx, incident_id, ROLES); // every active role may chat
    const body = cleanText(text, 'Message', 1, MAX_MESSAGE);
    if (client_request_id !== undefined) {
      if (client_request_id.length > MAX_REQUEST_ID) fail('Invalid request id');
      // Idempotent retry: same author + request id in this incident is a no-op.
      for (const m of ctx.db.message.incident_id.filter(incident_id)) {
        if (m.author.isEqual(ctx.sender) && m.client_request_id === client_request_id) return;
      }
    }
    ctx.db.message.insert({
      id: 0n,
      incident_id,
      author: ctx.sender,
      text: body,
      recorded_at: ctx.timestamp,
      client_request_id,
    });
  }
);

// ---------- views (the ONLY way clients read data) ----------
// Each view is evaluated for the calling identity. Rows disappear for a client as soon as
// their membership is deactivated. Raw tables above are private and not subscribable.

function myIncidentIds(ctx: { sender: Identity; db: any }): Set<bigint> {
  const ids = new Set<bigint>();
  for (const m of ctx.db.membership.user.filter(ctx.sender)) {
    if (m.active) ids.add(m.incident_id);
  }
  return ids;
}

export const my_memberships = spacetimedb.view(
  { name: 'my_memberships', public: true },
  t.array(membership.rowType),
  ctx => {
    const out = [];
    for (const m of ctx.db.membership.user.filter(ctx.sender)) if (m.active) out.push(m);
    return out;
  }
);

export const my_incidents = spacetimedb.view(
  { name: 'my_incidents', public: true },
  t.array(incident.rowType),
  ctx => {
    const out = [];
    for (const id of myIncidentIds(ctx)) {
      const row = ctx.db.incident.id.find(id);
      if (row) out.push(row);
    }
    return out;
  }
);

export const incident_members = spacetimedb.view(
  { name: 'incident_members', public: true },
  t.array(membership.rowType),
  ctx => {
    const out = [];
    for (const id of myIncidentIds(ctx)) {
      for (const m of ctx.db.membership.incident_id.filter(id)) out.push(m);
    }
    return out;
  }
);

export const incident_messages = spacetimedb.view(
  { name: 'incident_messages', public: true },
  t.array(message.rowType),
  ctx => {
    const out = [];
    for (const id of myIncidentIds(ctx)) {
      for (const m of ctx.db.message.incident_id.filter(id)) out.push(m);
    }
    return out;
  }
);

export const incident_activity = spacetimedb.view(
  { name: 'incident_activity', public: true },
  t.array(activity_event.rowType),
  ctx => {
    const out = [];
    for (const id of myIncidentIds(ctx)) {
      for (const e of ctx.db.activity_event.incident_id.filter(id)) out.push(e);
    }
    return out;
  }
);

// Display names only for people who share an incident with the caller (plus self).
export const visible_profiles = spacetimedb.view(
  { name: 'visible_profiles', public: true },
  t.array(user_profile.rowType),
  ctx => {
    const keys = new Map<string, Identity>();
    keys.set(ctx.sender.toHexString(), ctx.sender);
    for (const id of myIncidentIds(ctx)) {
      for (const m of ctx.db.membership.incident_id.filter(id)) {
        if (m.active) keys.set(m.user.toHexString(), m.user);
      }
    }
    const out = [];
    for (const who of keys.values()) {
      const p = ctx.db.user_profile.identity.find(who);
      if (p) out.push(p);
    }
    return out;
  }
);

export const incident_scope = spacetimedb.view(
  { name: 'incident_scope', public: true },
  t.array(scope_item.rowType),
  ctx => {
    const out = [];
    for (const id of myIncidentIds(ctx)) {
      for (const item of ctx.db.scope_item.incident_id.filter(id)) out.push(item);
    }
    return out;
  }
);

export const incident_evidence = spacetimedb.view(
  { name: 'incident_evidence', public: true },
  t.array(evidence.rowType),
  ctx => {
    const out = [];
    for (const id of myIncidentIds(ctx)) {
      for (const ev of ctx.db.evidence.incident_id.filter(id)) out.push(ev);
    }
    return out;
  }
);