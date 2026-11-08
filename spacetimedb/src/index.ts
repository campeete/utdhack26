// Clean Room - Gate 1 module: secure shared incident.
//
// Security model (see docs/SECURITY.md):
//  * Every table is PRIVATE (no `public: true`). Clients never subscribe to raw tables.
//  * Clients read data only through per-user VIEWS that filter on ctx.sender's ACTIVE
//    membership. Flipping `membership.active` to false removes rows from the view.
//  * Every reducer derives identity from ctx.sender and looks membership up server-side.
//    Nothing the client sends is treated as proof of identity, role, or membership.
//  * Default deny.

//
// Additions from the Clean Room Data Spec (incident records, Northstar accounts and
// logins, Nora's findings, simulated SMS, the hash-chained audit log) follow the same
// model. Two service identities (Nora's worker, the login gateway) are registered by a
// platform admin in `service_account`; only they can call their reducers.

import { schema, table, t, SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import { appendEvent, auditEvent, auditHead, PLATFORM_INCIDENT, type AuditAction, type AuditCtx } from './audit';
import {
  ACTION_EFFECTS, autoFixRefusal, cleanClues, DECISION_STATES, EXPLANATION_MAX, FEEDBACK_MAX,
  FINDING_QUEUES, FINDING_SEVERITIES, isAttackTechniqueId, isIpAddress, LOGIN_METHODS, LOGIN_ORIGINS,
  LOGIN_OUTCOMES, normalizeFeedback, parseReassessmentResult, PROPOSED_ACTIONS, REASON_MAX, REASON_MIN,
  requestIdFor, SERVICE_KINDS, SMS_MAX, STANDING, TRUST, VERIFICATION_MAX,
  type ProposedAction, type ServiceKind,
} from './rules';

// ---------- constants ----------

// Three tiers, and they stack: a higher tier can do everything a lower one can.
//   tier1  Triage: gathers data and defines problems and breaches.
//   tier2  Containment: contains and mitigates (approves Nora's fixes, decisions, status).
//   tier3  Forensics: hunts hidden attackers, reverse engineers, validates evidence,
//          and manages who is in the incident.
const ROLES = ['tier1', 'tier2', 'tier3'] as const;
type Role = (typeof ROLES)[number];
type Tier = 1 | 2 | 3;
/** The highest tier in a membership's roles (0 if none is a tier). */
const tierOf = (roles: readonly string[]): number => Math.max(0, ...roles.map(r => ROLES.indexOf(r as Role) + 1));

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
// One tier per person; tiers stack (tier3 can do everything tier2 and tier1 can).
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

// Spec Change 1: a message may go to one person and may be tied to an evidence item.
// No recipient means the whole team sees it.
const message = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    author: t.identity(),
    text: t.string(),
    recorded_at: t.timestamp(),
    client_request_id: t.option(t.string()),
    recipient: t.option(t.identity()),
    evidence_id: t.option(t.u64()),
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
    // Spec Change 2: link to the `source` table and the evidence's standing.
    source_id: t.option(t.u64()),
    standing: t.string(),
  }
);

// ---------- services ----------

// Nora's worker and the login gateway. Set by a platform admin; only an enabled
// row lets that identity call its reducers.
const service_account = table(
  {},
  {
    identity: t.identity().primaryKey(),
    kind: t.string(),
    enabled: t.bool(),
    set_by: t.identity(),
    set_at: t.timestamp(),
  }
);

// ---------- incident records (the review workflow) ----------

const source = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    label: t.string(),
    trust: t.string(),
    reason: t.string(),
    created_by: t.identity(),
    created_at: t.timestamp(),
    version: t.u32(),
  }
);

const decision = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    title: t.string(),
    assumption: t.string(),
    state: t.string(),
    evidence_ids: t.array(t.u64()),
    owner: t.identity(),
    approved_at: t.option(t.timestamp()),
    version: t.u32(),
  }
);

const team_update = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    title: t.string(),
    body: t.string(),
    decision_ids: t.array(t.u64()),
    state: t.string(),
    updated_by: t.identity(),
    updated_at: t.timestamp(),
    version: t.u32(),
  }
);

// A suggested review. Records the versions it was based on, so confirming it after
// the source, evidence or a dependent record changed is refused.
const suggestion = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    source_id: t.u64(),
    source_version: t.u32(),
    evidence_id: t.u64(),
    evidence_version: t.u32(),
    decision_ids: t.array(t.u64()),
    decision_versions: t.array(t.u32()),
    team_update_ids: t.array(t.u64()),
    team_update_versions: t.array(t.u32()),
    excerpt: t.string(),
    explanation: t.string(),
    verification: t.string(),
    origin: t.string(),
    state: t.string(),
    revision_of: t.option(t.u64()),
    created_by: t.identity(),
    created_at: t.timestamp(),
    // Set once on dismissal, never rewritten.
    dismissed_by: t.option(t.identity()),
    dismissed_at: t.option(t.timestamp()),
    dismissal_feedback: t.string(),
    // Reassessment progress ('' = none requested).
    reassess_state: t.string(),
    request_id: t.string(),
    attempt: t.u32(),
    reassess_error: t.string(),
    reassess_note: t.string(),
    revision_id: t.option(t.u64()),
    version: t.u32(),
  }
);

const task = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    suggestion_id: t.u64(),
    decision_id: t.u64(),
    title: t.string(),
    assignee: t.identity(),
    state: t.string(),
    created_at: t.timestamp(),
    version: t.u32(),
  }
);

// ---------- Northstar's side and the phone demo ----------

// An invented employee or service account at the client company. Never holds a
// password, hash, 2FA secret, username or email.
const northstar_account = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    account_ref: t.string(),
    name: t.string(),
    department: t.string(),
    job_title: t.string(),
    privileged: t.bool(),
    mfa: t.string(),
    in_credential_leak: t.bool(),
    used_by_attacker: t.bool(),
    status: t.string(),
    usual_devices: t.array(t.string()),
    usual_networks: t.array(t.string()),
    version: t.u32(),
  }
);

// One sign-in attempt. `password_breached` is the gateway's yes/no breach-list check;
// the password itself never reaches the module.
const login_event = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    account_id: t.u64().index('btree'),
    occurred_at: t.timestamp(),
    method: t.string(),
    outcome: t.string(),
    ip: t.string(),
    device_type: t.string(),
    os: t.string(),
    browser: t.string(),
    password_breached: t.option(t.bool()),
    origin: t.string(),
    recorded_by: t.identity(),
  }
);

// A person at Northstar the responders text (phone 2). Not a responder: the
// `demo_identity` sees only its own SMS thread, never the incident.
const outside_contact = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    account_id: t.u64(),
    display_name: t.string(),
    demo_identity: t.identity().index('btree'),
    added_by: t.identity(),
    added_at: t.timestamp(),
  }
);

// Simulated SMS. Travels through SpacetimeDB only; no phone numbers anywhere.
const sms_message = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    contact_id: t.u64().index('btree'),
    direction: t.string(),
    text: t.string(),
    sent_at: t.timestamp(),
    sent_by: t.identity(),
  }
);

// ---------- Nora ----------

const finding = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    account_id: t.option(t.u64()),
    login_event_id: t.option(t.u64()),
    severity: t.string(),
    queue: t.string(),
    title: t.string(),
    reason: t.string(),
    clues: t.string(),
    attack_technique: t.string(),
    proposed_fix: t.string(),
    proposed_action: t.string(),
    rule_id: t.option(t.u64()),
    state: t.string(),
    decided_by: t.option(t.identity()),
    decided_at: t.option(t.timestamp()),
    dismissal_feedback: t.string(),
    // The account's status before an action ran, so Undo can restore it.
    prior_status: t.option(t.string()),
    model: t.string(),
    created_at: t.timestamp(),
    version: t.u32(),
  }
);

// The admin-edited list of situations Nora may fix on her own, each with exactly
// one allowed action. Platform-wide.
const low_severity_rule = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    situation: t.string(),
    allowed_action: t.string(),
    enabled: t.bool(),
    created_by: t.identity(),
    updated_at: t.timestamp(),
    version: t.u32(),
  }
);

// Saved human decisions fed back to Nora as context. This is the "learning":
// no model is retrained. A commander can delete a row.
const nora_memory = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    finding_id: t.u64(),
    decision: t.string(),
    feedback: t.string(),
    recorded_by: t.identity(),
    recorded_at: t.timestamp(),
  }
);

// Work queue for Nora's worker: one row per reassessment attempt of a dismissed
// suggestion. Readable only by Nora's service identity.
const reassessment_request = table(
  {},
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index('btree'),
    suggestion_id: t.u64().index('btree'),
    request_key: t.string(),
    attempt: t.u32(),
    state: t.string(),
    requested_by: t.identity(),
    requested_at: t.timestamp(),
    completed_at: t.option(t.timestamp()),
    error: t.string(),
  }
);

// A suggestion Nora (Nemotron) made about one specific decision that new evidence
// challenges. Kept in its own table so existing databases upgrade in place.
const suggestion_target = table(
  {},
  {
    suggestion_id: t.u64().primaryKey(),
    incident_id: t.u64().index('btree'),
    decision_id: t.u64(),
    decision_version: t.u32(),
    urgent: t.bool(),
  }
);

// One row per piece of evidence Nora has investigated, whatever the outcome, so the
// team can see it was read and Nora never re-reads it after a restart.
const evidence_review = table(
  {},
  {
    evidence_id: t.u64().primaryKey(),
    incident_id: t.u64().index('btree'),
    outcome: t.string(), // no_impact | conflict | urgent | failed
    decision_id: t.option(t.u64()),
    suggestion_id: t.option(t.u64()),
    summary: t.string(),
    model: t.string(),
    reviewed_at: t.timestamp(),
  }
);

// Which issue (decision) a message belongs to, so each issue has its own discussion.
// A separate table because published tables cannot gain columns.
const message_decision = table(
  {},
  {
    message_id: t.u64().primaryKey(),
    incident_id: t.u64().index('btree'),
    decision_id: t.u64(),
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
  service_account,
  source,
  decision,
  team_update,
  suggestion,
  task,
  northstar_account,
  login_event,
  outside_contact,
  sms_message,
  finding,
  low_severity_rule,
  nora_memory,
  reassessment_request,
  suggestion_target,
  evidence_review,
  message_decision,
  audit_event: auditEvent,
  audit_head: auditHead,
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
  if (set.size > 1) fail('Choose one tier: tiers already include the ones below them');
  return [...set] as Role[];
}

/** Server-side lookup of the caller's ACTIVE membership in an incident. Returns undefined if none. */
function activeMembership(ctx: Ctx, incidentId: bigint, who: Identity) {
  for (const m of ctx.db.membership.user.filter(who)) {
    if (m.incident_id === incidentId && m.active) return m;
  }
  return undefined;
}

/** Default deny: caller must be an active member at `min` tier or higher. */
function requireTier(ctx: Ctx, incidentId: bigint, min: Tier) {
  const m = activeMembership(ctx, incidentId, ctx.sender);
  if (!m) fail('Access denied');
  if (tierOf(m.roles) < min) fail(`Access denied: insufficient role (needs Tier ${min} or higher)`);
  return m;
}

function requireIncident(ctx: Ctx, incidentId: bigint) {
  const inc = ctx.db.incident.id.find(incidentId);
  if (!inc) fail('Access denied'); // same message as non-membership: do not reveal existence
  return inc;
}

/** Tier 3 manages people, so an incident must always keep one. */
function countActiveTier3(ctx: Ctx, incidentId: bigint): number {
  let n = 0;
  for (const m of ctx.db.membership.incident_id.filter(incidentId)) {
    if (m.active && tierOf(m.roles) === 3) n++;
  }
  return n;
}

// Jon's activity names -> audit chain actions.
const ACTIVITY_AUDIT: Record<string, AuditAction> = {
  incident_created: 'INCIDENT_CREATED',
  member_admitted: 'MEMBER_ADMITTED',
  member_roles_changed: 'ROLE_CHANGED',
  member_revoked: 'MEMBER_REVOKED',
  commander_assigned: 'COMMANDER_ASSIGNED',
  incident_updated: 'INCIDENT_UPDATED',
  scope_added: 'SCOPE_ITEM_ADDED',
  evidence_added: 'EVIDENCE_ADDED',
};

/**
 * Writes the human-readable activity row AND the hash-chained audit event, inside
 * the caller's transaction: both commit with the change or neither does.
 * `detail` must hold no secrets (passwords, keys, SMS text).
 */
function logActivity(
  ctx: Ctx,
  incidentId: bigint,
  action: string,
  entityType: string,
  entityId: bigint,
  detail: string,
  audit?: AuditAction,
  meta: Record<string, unknown> = {}
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
  const auditAction = audit ?? ACTIVITY_AUDIT[action];
  if (!auditAction) fail(`No audit action for ${action}`);
  auditOnly(ctx, incidentId.toString(), auditAction, entityType, entityId, { detail: detail.slice(0, 300), ...meta });
}

/** Audit event without an activity row (platform-level events, logins, SMS). */
function auditOnly(
  ctx: Ctx,
  incidentId: string,
  action: AuditAction,
  entityType: string,
  entityId: bigint | string,
  metadata: Record<string, unknown> = {}
) {
  const service = serviceKind(ctx);
  appendEvent(ctx as unknown as AuditCtx, {
    incidentId,
    action,
    entityType,
    entityId,
    metadata: service ? { service, ...metadata } : metadata,
    actorKind: service ? 'service' : 'user',
  });
}

/** The caller's service kind, if it is an enabled service identity. */
function serviceKind(ctx: { sender: Identity; db: any }): ServiceKind | undefined {
  const row = ctx.db.service_account.identity.find(ctx.sender);
  return row && row.enabled ? (row.kind as ServiceKind) : undefined;
}

function requireService(ctx: Ctx, kind: ServiceKind) {
  if (serviceKind(ctx) !== kind) fail('Access denied');
}

function requirePlatformAdmin(ctx: Ctx) {
  if (!ctx.db.platform_admin.identity.find(ctx.sender)) fail('Access denied');
}

function oneOf<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!(allowed as readonly string[]).includes(value)) fail(`Invalid ${field}`);
  return value as T;
}

// ---------- lifecycle ----------

// Runs once when the module is first published. The publishing identity becomes the
// first platform admin. There is no "first visitor becomes admin" path.
export const init = spacetimedb.init(ctx => {
  ctx.db.platform_admin.insert({ identity: ctx.sender, granted_at: ctx.timestamp });
  auditOnly(ctx, PLATFORM_INCIDENT, 'MODULE_INITIALIZED', 'module', 'clean-room');
  auditOnly(ctx, PLATFORM_INCIDENT, 'ADMIN_GRANTED', 'platform_admin', ctx.sender.toHexString());
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
    // The creator starts as Tier 3, so someone can admit the rest of the team.
    ctx.db.membership.insert({
      id: 0n,
      incident_id: row.id,
      user: ctx.sender,
      roles: ['tier3'],
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
    requireTier(ctx, incident_id, 3);
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
    requireTier(ctx, incident_id, 3);
    const validated = validateRoles(roles);
    const target = activeMembership(ctx, incident_id, user);
    if (!target) fail('User is not an active member');
    // Never remove the last active admin.
    if (tierOf(target.roles) === 3 && tierOf(validated) < 3
        && countActiveTier3(ctx, incident_id) <= 1) {
      fail('Cannot remove the last active Tier 3');
    }
    ctx.db.membership.id.update({ ...target, roles: validated });
    logActivity(ctx, incident_id, 'member_roles_changed', 'membership', target.id,
      `${user.toHexString().slice(0, 12)} -> ${validated.join(',')}`);
  }
);

export const revoke_member = spacetimedb.reducer(
  { incident_id: t.u64(), user: t.identity() },
  (ctx, { incident_id, user }) => {
    requireTier(ctx, incident_id, 3);
    const target = activeMembership(ctx, incident_id, user);
    if (!target) fail('User is not an active member');
    if (tierOf(target.roles) === 3 && countActiveTier3(ctx, incident_id) <= 1) {
      fail('Cannot revoke the last active Tier 3');
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
    requireTier(ctx, incident_id, 3);
    const inc = requireIncident(ctx, incident_id);
    const target = activeMembership(ctx, incident_id, user);
    if (!target || tierOf(target.roles) < 2) {
      fail('The incident lead must be an active Tier 2 or Tier 3 member');
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
    requireTier(ctx, incident_id, 2); // containment changes operational state
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
    requireTier(ctx, incident_id, 1)
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
    source_id: t.option(t.u64()),
  },
  (ctx, { incident_id, title, source_label, source_type, content_text, event_time, source_id }) => {
    requireTier(ctx, incident_id, 1);
    requireIncident(ctx, incident_id);
    if (source_id !== undefined) {
      const src = ctx.db.source.id.find(source_id);
      if (!src || src.incident_id !== incident_id) fail('Source not found');
    }

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
      source_id,
      standing: 'under_review',
    });

    logActivity(ctx, incident_id, 'evidence_added', 'evidence', row.id, row.title);
  }
);

/** Shared by add_message and add_issue_message. Returns the new row, or undefined on an idempotent retry. */
function insertMessage(
  ctx: Ctx,
  incident_id: bigint,
  text: string,
  client_request_id: string | undefined,
  recipient: Identity | undefined,
  evidence_id: bigint | undefined,
  decision_id: bigint | undefined,
) {
    requireTier(ctx, incident_id, 1); // every tier may chat
    const body = cleanText(text, 'Message', 1, MAX_MESSAGE);
    if (recipient !== undefined && !activeMembership(ctx, incident_id, recipient)) {
      fail('Recipient must be an active member of this incident');
    }
    if (evidence_id !== undefined) {
      const ev = ctx.db.evidence.id.find(evidence_id);
      if (!ev || ev.incident_id !== incident_id) fail('Evidence not found');
    }
    if (client_request_id !== undefined) {
      if (client_request_id.length > MAX_REQUEST_ID) fail('Invalid request id');
      // Idempotent retry: same author + request id in this incident is a no-op.
      for (const m of ctx.db.message.incident_id.filter(incident_id)) {
        if (m.author.isEqual(ctx.sender) && m.client_request_id === client_request_id) return undefined;
      }
    }
    const row = ctx.db.message.insert({
      id: 0n,
      incident_id,
      author: ctx.sender,
      text: body,
      recorded_at: ctx.timestamp,
      client_request_id,
      recipient,
      evidence_id,
    });
    if (decision_id !== undefined) ctx.db.message_decision.insert({ message_id: row.id, incident_id, decision_id });
    // The text stays out of the audit chain; the event proves who sent what, when.
    auditOnly(ctx, incident_id.toString(), 'MESSAGE_SENT', 'message', row.id, {
      length: body.length,
      direct: recipient !== undefined,
      evidence_id: evidence_id?.toString() ?? null,
      ...(decision_id !== undefined ? { decision_id: decision_id.toString() } : {}),
    });
    return row;
}

export const add_message = spacetimedb.reducer(
  {
    incident_id: t.u64(),
    text: t.string(),
    client_request_id: t.option(t.string()),
    recipient: t.option(t.identity()),
    evidence_id: t.option(t.u64()),
  },
  (ctx, { incident_id, text, client_request_id, recipient, evidence_id }) => {
    insertMessage(ctx, incident_id, text, client_request_id, recipient, evidence_id, undefined);
  }
);

/** A message in one issue's own discussion (the issue is a decision). */
export const add_issue_message = spacetimedb.reducer(
  {
    decision_id: t.u64(),
    text: t.string(),
    client_request_id: t.option(t.string()),
    recipient: t.option(t.identity()),
  },
  (ctx, { decision_id, text, client_request_id, recipient }) => {
    const d = ctx.db.decision.id.find(decision_id);
    if (!d) fail('Decision not found');
    insertMessage(ctx, d.incident_id, text, client_request_id, recipient, undefined, decision_id);
  }
);

// ---------- views (the ONLY way clients read data) ----------
// Each view is evaluated for the calling identity. Rows disappear for a client as soon as
// their membership is deactivated. Raw tables above are private and not subscribable.

function myIncidentIds(ctx: { sender: Identity; db: any }): Set<bigint> {
  const ids = new Set<bigint>();
  // Nora's worker watches every incident, read-only, through the same views.
  if (serviceKind(ctx) === 'nora') {
    for (const inc of ctx.db.incident.iter()) ids.add(inc.id);
    return ids;
  }
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
      for (const m of ctx.db.message.incident_id.filter(id)) {
        // A direct message is shown only to its author and its recipient.
        if (m.recipient && !m.recipient.isEqual(ctx.sender) && !m.author.isEqual(ctx.sender)) continue;
        out.push(m);
      }
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
// =====================================================================================
// Clean Room Data Spec additions
// =====================================================================================

const MAX_LABEL = 120;
const MAX_ASSUMPTION = 1000;
const MAX_DEVICE_FIELD = 64;
const MAX_SEED_ACCOUNTS = 500;
const MAX_SEED_LOGINS = 5000;
const ACCOUNT_REF = /^[A-Z]{2,5}(-[A-Z0-9]{1,6}){1,2}$/; // NSR-1008, NSR-SVC-01

// ---------- services and platform rules (platform admin) ----------

export const set_service_account = spacetimedb.reducer(
  { identity: t.identity(), kind: t.string(), enabled: t.bool() },
  (ctx, { identity, kind, enabled }) => {
    requirePlatformAdmin(ctx);
    oneOf(kind, SERVICE_KINDS, 'service kind');
    if (ctx.db.platform_admin.identity.find(identity)) fail('A platform admin cannot also be a service');
    const row = { identity, kind, enabled, set_by: ctx.sender, set_at: ctx.timestamp };
    if (ctx.db.service_account.identity.find(identity)) ctx.db.service_account.identity.update(row);
    else ctx.db.service_account.insert(row);
    auditOnly(ctx, PLATFORM_INCIDENT, 'SERVICE_ACCOUNT_SET', 'service_account', identity.toHexString(), { kind, enabled });
  }
);

/** Creates a rule (no rule_id) or updates one. Each rule allows exactly one action. */
export const save_low_severity_rule = spacetimedb.reducer(
  { rule_id: t.option(t.u64()), situation: t.string(), allowed_action: t.string(), enabled: t.bool() },
  (ctx, { rule_id, situation, allowed_action, enabled }) => {
    requirePlatformAdmin(ctx);
    const text = cleanText(situation, 'Situation', 1, MAX_REASON);
    oneOf(allowed_action, PROPOSED_ACTIONS, 'allowed action');
    let id: bigint;
    if (rule_id === undefined) {
      id = ctx.db.low_severity_rule.insert({
        id: 0n, situation: text, allowed_action, enabled, created_by: ctx.sender, updated_at: ctx.timestamp, version: 1,
      }).id;
    } else {
      const rule = ctx.db.low_severity_rule.id.find(rule_id);
      if (!rule) fail('Rule not found');
      ctx.db.low_severity_rule.id.update({ ...rule, situation: text, allowed_action, enabled, updated_at: ctx.timestamp, version: rule.version + 1 });
      id = rule.id;
    }
    auditOnly(ctx, PLATFORM_INCIDENT, 'RULE_SAVED', 'low_severity_rule', id, { allowed_action, enabled });
  }
);

// ---------- demo scenario (platform admin) ----------

const SeedAccount = t.object('SeedAccount', {
  account_ref: t.string(),
  name: t.string(),
  department: t.string(),
  job_title: t.string(),
  privileged: t.bool(),
  mfa: t.string(),
  in_credential_leak: t.bool(),
  used_by_attacker: t.bool(),
  status: t.string(),
  usual_devices: t.array(t.string()),
  usual_networks: t.array(t.string()),
});

const SeedLogin = t.object('SeedLogin', {
  account_ref: t.string(),
  occurred_at: t.timestamp(),
  method: t.string(),
  outcome: t.string(),
  ip: t.string(),
  device_type: t.string(),
  os: t.string(),
  browser: t.string(),
  password_breached: t.option(t.bool()),
});

function cleanDeviceFields(f: { ip: string; device_type: string; os: string; browser: string }) {
  if (!isIpAddress(f.ip)) fail('Invalid IP address');
  return {
    ip: f.ip,
    device_type: cleanText(f.device_type, 'Device type', 1, MAX_DEVICE_FIELD),
    os: cleanText(f.os, 'OS', 1, MAX_DEVICE_FIELD),
    browser: cleanText(f.browser, 'Browser', 1, MAX_DEVICE_FIELD),
  };
}

function accountByRef(ctx: Ctx, incidentId: bigint, ref: string) {
  for (const a of ctx.db.northstar_account.incident_id.filter(incidentId)) if (a.account_ref === ref) return a;
  return undefined;
}

/**
 * Loads the invented Northstar accounts and the seeded weekend of logins into an
 * existing incident, once. No reset: rows are never deleted (that would break the
 * audit chain's story), so a rerun of the demo uses a fresh incident.
 */
export const load_demo_scenario = spacetimedb.reducer(
  { incident_id: t.u64(), accounts: t.array(SeedAccount), logins: t.array(SeedLogin) },
  (ctx, { incident_id, accounts, logins }) => {
    requirePlatformAdmin(ctx);
    requireIncident(ctx, incident_id);
    if (accounts.length === 0 || accounts.length > MAX_SEED_ACCOUNTS) fail(`Load 1-${MAX_SEED_ACCOUNTS} accounts`);
    if (logins.length > MAX_SEED_LOGINS) fail(`Load at most ${MAX_SEED_LOGINS} logins`);
    for (const _ of ctx.db.northstar_account.incident_id.filter(incident_id)) fail('Demo scenario already loaded for this incident');

    const ids = new Map<string, bigint>();
    for (const a of accounts) {
      if (!ACCOUNT_REF.test(a.account_ref)) fail(`Invalid account ref: ${a.account_ref.slice(0, 20)}`);
      if (ids.has(a.account_ref)) fail(`Duplicate account ref: ${a.account_ref}`);
      const row = ctx.db.northstar_account.insert({
        id: 0n,
        incident_id,
        account_ref: a.account_ref,
        name: cleanText(a.name, 'Name', 1, MAX_NAME),
        department: cleanText(a.department, 'Department', 1, MAX_NAME),
        job_title: cleanText(a.job_title, 'Job title', 1, MAX_NAME),
        privileged: a.privileged,
        mfa: cleanText(a.mfa, 'MFA', 1, MAX_NAME),
        in_credential_leak: a.in_credential_leak,
        used_by_attacker: a.used_by_attacker,
        status: cleanText(a.status, 'Status', 1, MAX_NAME),
        usual_devices: a.usual_devices.slice(0, 10).map(d => cleanText(d, 'Usual device', 1, MAX_LABEL)),
        usual_networks: a.usual_networks.slice(0, 10).map(n => cleanText(n, 'Usual network', 1, MAX_LABEL)),
        version: 1,
      });
      ids.set(a.account_ref, row.id);
    }
    for (const l of logins) {
      const accountId = ids.get(l.account_ref);
      if (accountId === undefined) fail(`Login for unknown account: ${l.account_ref.slice(0, 20)}`);
      ctx.db.login_event.insert({
        id: 0n,
        incident_id,
        account_id: accountId,
        occurred_at: l.occurred_at,
        method: oneOf(l.method, LOGIN_METHODS, 'login method'),
        outcome: oneOf(l.outcome, LOGIN_OUTCOMES, 'login outcome'),
        ...cleanDeviceFields(l),
        password_breached: l.password_breached,
        origin: 'seeded',
        recorded_by: ctx.sender,
      });
    }
    logActivity(ctx, incident_id, 'demo_loaded', 'incident', incident_id,
      `Loaded ${accounts.length} accounts and ${logins.length} seeded logins`, 'DEMO_LOADED',
      { accounts: accounts.length, logins: logins.length });
  }
);

// ---------- login gateway ----------

/** One live sign-in from the attacker's or employee's phone. Gateway identity only. */
export const record_login = spacetimedb.reducer(
  {
    incident_id: t.u64(),
    account_ref: t.string(),
    method: t.string(),
    outcome: t.string(),
    ip: t.string(),
    device_type: t.string(),
    os: t.string(),
    browser: t.string(),
    password_breached: t.option(t.bool()),
  },
  (ctx, args) => {
    requireService(ctx, 'login_gateway');
    requireIncident(ctx, args.incident_id);
    const account = accountByRef(ctx, args.incident_id, args.account_ref);
    if (!account) fail('Unknown account');
    const row = ctx.db.login_event.insert({
      id: 0n,
      incident_id: args.incident_id,
      account_id: account.id,
      occurred_at: ctx.timestamp, // the server's clock, never the phone's
      method: oneOf(args.method, LOGIN_METHODS, 'login method'),
      outcome: oneOf(args.outcome, LOGIN_OUTCOMES, 'login outcome'),
      ...cleanDeviceFields(args),
      password_breached: args.password_breached,
      origin: 'live_phone',
      recorded_by: ctx.sender,
    });
    auditOnly(ctx, args.incident_id.toString(), 'LOGIN_RECORDED', 'login_event', row.id, {
      account: account.account_ref, method: row.method, outcome: row.outcome,
    });
  }
);

// ---------- sources, evidence standing, decisions, team updates ----------

export const add_source = spacetimedb.reducer(
  { incident_id: t.u64(), label: t.string(), trust: t.string(), reason: t.string() },
  (ctx, { incident_id, label, trust, reason }) => {
    requireTier(ctx, incident_id, 1);
    requireIncident(ctx, incident_id);
    const row = ctx.db.source.insert({
      id: 0n,
      incident_id,
      label: cleanText(label, 'Label', 1, MAX_LABEL),
      trust: oneOf(trust, TRUST, 'trust'),
      reason: cleanText(reason, 'Reason', 0, MAX_REASON),
      created_by: ctx.sender,
      created_at: ctx.timestamp,
      version: 1,
    });
    logActivity(ctx, incident_id, 'source_added', 'source', row.id, `${row.label} (${row.trust})`, 'SOURCE_ADDED');
  }
);

export const set_source_trust = spacetimedb.reducer(
  { source_id: t.u64(), expected_version: t.u32(), trust: t.string(), reason: t.string() },
  (ctx, { source_id, expected_version, trust, reason }) => {
    const src = ctx.db.source.id.find(source_id);
    if (!src) fail('Source not found');
    requireTier(ctx, src.incident_id, 2);
    if (src.version !== expected_version) fail('Source changed since you loaded it; refresh and retry');
    const next = oneOf(trust, TRUST, 'trust');
    const why = cleanText(reason, 'Reason', 1, MAX_REASON);
    ctx.db.source.id.update({ ...src, trust: next, reason: why, version: src.version + 1 });
    logActivity(ctx, src.incident_id, 'source_trust_changed', 'source', src.id, `${src.trust}->${next} (${why})`, 'SOURCE_TRUST_CHANGED');
  }
);

export const set_evidence_standing = spacetimedb.reducer(
  { evidence_id: t.u64(), expected_version: t.u32(), standing: t.string() },
  (ctx, { evidence_id, expected_version, standing }) => {
    const ev = ctx.db.evidence.id.find(evidence_id);
    if (!ev) fail('Evidence not found');
    requireTier(ctx, ev.incident_id, 3); // forensic validation;
    if (ev.version !== expected_version) fail('Evidence changed since you loaded it; refresh and retry');
    const next = oneOf(standing, STANDING, 'standing');
    ctx.db.evidence.id.update({ ...ev, standing: next, version: ev.version + 1 });
    logActivity(ctx, ev.incident_id, 'evidence_standing_changed', 'evidence', ev.id, `${ev.standing}->${next}`, 'EVIDENCE_STANDING_CHANGED');
  }
);

export const draft_decision = spacetimedb.reducer(
  { incident_id: t.u64(), title: t.string(), assumption: t.string(), evidence_ids: t.array(t.u64()) },
  (ctx, { incident_id, title, assumption, evidence_ids }) => {
    requireTier(ctx, incident_id, 1);
    requireIncident(ctx, incident_id);
    for (const id of evidence_ids) {
      const ev = ctx.db.evidence.id.find(id);
      if (!ev || ev.incident_id !== incident_id) fail('Evidence not found');
    }
    const row = ctx.db.decision.insert({
      id: 0n,
      incident_id,
      title: cleanText(title, 'Title', 1, MAX_TITLE),
      assumption: cleanText(assumption, 'Assumption', 1, MAX_ASSUMPTION),
      state: 'draft',
      evidence_ids: [...new Set(evidence_ids)],
      owner: ctx.sender,
      approved_at: undefined,
      version: 1,
    });
    logActivity(ctx, incident_id, 'decision_created', 'decision', row.id, row.title, 'DECISION_CREATED');
  }
);

export const approve_decision = spacetimedb.reducer(
  { decision_id: t.u64(), expected_version: t.u32() },
  (ctx, { decision_id, expected_version }) => {
    const d = ctx.db.decision.id.find(decision_id);
    if (!d) fail('Decision not found');
    requireTier(ctx, d.incident_id, 2);
    if (d.version !== expected_version) fail('Decision changed since you loaded it; refresh and retry');
    if (d.state !== 'draft' && d.state !== 'needs_review') fail('Only a draft or a decision needing review can be approved');
    ctx.db.decision.id.update({ ...d, state: 'approved', approved_at: ctx.timestamp, version: d.version + 1 });
    logActivity(ctx, d.incident_id, 'decision_approved', 'decision', d.id, d.title, 'DECISION_APPROVED');
  }
);

/** Tier 2+ marks a decision resolved (closed). Closing one decision does not close the incident. */
export const resolve_decision = spacetimedb.reducer(
  { decision_id: t.u64() },
  (ctx, { decision_id }) => {
    const d = ctx.db.decision.id.find(decision_id);
    if (!d) fail('Decision not found');
    requireTier(ctx, d.incident_id, 2);
    if (d.state === 'closed') return;
    ctx.db.decision.id.update({ ...d, state: 'closed', version: d.version + 1 });
    logActivity(ctx, d.incident_id, 'decision_resolved', 'decision', d.id, `Decision ${d.id} resolved.`, 'DECISION_REVISED', { state: 'closed' });
  }
);

export const create_team_update = spacetimedb.reducer(
  { incident_id: t.u64(), title: t.string(), body: t.string(), decision_ids: t.array(t.u64()) },
  (ctx, { incident_id, title, body, decision_ids }) => {
    requireTier(ctx, incident_id, 2);
    requireIncident(ctx, incident_id);
    for (const id of decision_ids) {
      const d = ctx.db.decision.id.find(id);
      if (!d || d.incident_id !== incident_id) fail('Decision not found');
    }
    const row = ctx.db.team_update.insert({
      id: 0n,
      incident_id,
      title: cleanText(title, 'Title', 1, MAX_TITLE),
      body: cleanText(body, 'Body', 1, MAX_SUMMARY),
      decision_ids: [...new Set(decision_ids)],
      state: 'current',
      updated_by: ctx.sender,
      updated_at: ctx.timestamp,
      version: 1,
    });
    logActivity(ctx, incident_id, 'team_update_created', 'team_update', row.id, row.title, 'BRIEFING_CREATED');
  }
);

export const review_team_update = spacetimedb.reducer(
  { team_update_id: t.u64(), expected_version: t.u32() },
  (ctx, { team_update_id, expected_version }) => {
    const u = ctx.db.team_update.id.find(team_update_id);
    if (!u) fail('Team update not found');
    requireTier(ctx, u.incident_id, 2);
    if (u.version !== expected_version) fail('Team update changed since you loaded it; refresh and retry');
    ctx.db.team_update.id.update({ ...u, state: 'reviewed', updated_by: ctx.sender, updated_at: ctx.timestamp, version: u.version + 1 });
    logActivity(ctx, u.incident_id, 'team_update_reviewed', 'team_update', u.id, u.title, 'TEAM_UPDATE_REVIEWED');
  }
);

// ---------- suggestions (ports of shared/review.ts and shared/reassessment.ts) ----------

/** Approved or needs-review decisions resting on any evidence from this source, and the team updates citing them. */
function dependents(ctx: Ctx, incidentId: bigint, sourceId: bigint) {
  const evidenceIds = new Set<bigint>();
  for (const ev of ctx.db.evidence.incident_id.filter(incidentId)) if (ev.source_id === sourceId) evidenceIds.add(ev.id);
  const decisions = [];
  for (const d of ctx.db.decision.incident_id.filter(incidentId)) {
    if ((d.state === 'approved' || d.state === 'needs_review') && d.evidence_ids.some(id => evidenceIds.has(id))) decisions.push(d);
  }
  const decisionIds = new Set(decisions.map(d => d.id));
  const updates = [];
  for (const u of ctx.db.team_update.incident_id.filter(incidentId)) {
    if (u.decision_ids.some(id => decisionIds.has(id))) updates.push(u);
  }
  return { decisions, updates };
}

function dependencyVersions(ctx: Ctx, incidentId: bigint, sourceId: bigint) {
  const { decisions, updates } = dependents(ctx, incidentId, sourceId);
  return {
    decision_ids: decisions.map(d => d.id),
    decision_versions: decisions.map(d => d.version),
    team_update_ids: updates.map(u => u.id),
    team_update_versions: updates.map(u => u.version),
  };
}

function versionOf(ids: bigint[], versions: number[], id: bigint): number | undefined {
  const i = ids.findIndex(x => x === id);
  return i < 0 ? undefined : versions[i];
}

type SuggestionRow = NonNullable<ReturnType<Ctx['db']['suggestion']['id']['find']>>;

function requireSuggestion(ctx: Ctx, id: bigint) {
  const s = ctx.db.suggestion.id.find(id);
  if (!s) fail('Suggestion not found');
  return s;
}

/** Same checks as previewImpact(): what confirming would change, or why it is refused. */
function previewImpact(ctx: Ctx, s: SuggestionRow) {
  const target = ctx.db.suggestion_target.suggestion_id.find(s.id);
  if (target) return targetedImpact(ctx, s, target);
  const src = ctx.db.source.id.find(s.source_id);
  const ev = ctx.db.evidence.id.find(s.evidence_id);
  if (!src || !ev || src.incident_id !== s.incident_id || ev.incident_id !== s.incident_id
      || ev.source_id !== src.id || !ev.content_text.includes(s.excerpt)) {
    fail('Suggestion references invalid evidence');
  }
  if (src.trust !== 'under_review' || src.version !== s.source_version || ev.version !== s.evidence_version) {
    fail('Suggestion is stale. Refresh before reviewing.');
  }
  const { decisions, updates } = dependents(ctx, s.incident_id, src.id);
  if (decisions.some(d => versionOf(s.decision_ids, s.decision_versions, d.id) !== d.version)
      || updates.some(u => versionOf(s.team_update_ids, s.team_update_versions, u.id) !== u.version)) {
    fail('Dependencies changed. Refresh the suggestion before confirming.');
  }
  return { decisions, updates };
}

/**
 * Impact of a suggestion aimed at one decision: that decision (flagged for review)
 * and the team updates citing it. Refused if the evidence or the decision changed
 * since Nora flagged it.
 */
function targetedImpact(ctx: Ctx, s: SuggestionRow, target: { decision_id: bigint; decision_version: number }) {
  const ev = ctx.db.evidence.id.find(s.evidence_id);
  if (!ev || ev.incident_id !== s.incident_id || !ev.content_text.includes(s.excerpt)) fail('Suggestion references invalid evidence');
  if (ev.version !== s.evidence_version) fail('Suggestion is stale. Refresh before reviewing.');
  const d = ctx.db.decision.id.find(target.decision_id);
  if (!d || d.incident_id !== s.incident_id) fail('The decision this suggestion is about no longer exists');
  if (d.version !== target.decision_version) fail('Dependencies changed. Refresh the suggestion before confirming.');
  if (d.state === 'closed' || d.state === 'superseded') fail('That decision is already closed');
  const updates = [];
  for (const u of ctx.db.team_update.incident_id.filter(s.incident_id)) {
    if (u.decision_ids.includes(d.id)) {
      if (versionOf(s.team_update_ids, s.team_update_versions, u.id) !== u.version) fail('Dependencies changed. Refresh the suggestion before confirming.');
      updates.push(u);
    }
  }
  return { decisions: [d], updates };
}

/** A suggestion that new evidence challenges one decision's assumption. */
function insertTargetedSuggestion(ctx: Ctx, f: {
  incident_id: bigint; evidence_id: bigint; decision_id: bigint; excerpt: string; explanation: string;
  verification: string; urgent: boolean; revision_of?: bigint;
}) {
  const ev = ctx.db.evidence.id.find(f.evidence_id);
  if (!ev || ev.incident_id !== f.incident_id) fail('Evidence not found');
  if (!ev.content_text.includes(f.excerpt)) fail('Excerpt must be an exact quote from the evidence');
  const d = ctx.db.decision.id.find(f.decision_id);
  if (!d || d.incident_id !== f.incident_id) fail('Decision not found');
  if (d.state === 'closed' || d.state === 'superseded') fail('That decision is already closed');
  const src = ev.source_id !== undefined ? ctx.db.source.id.find(ev.source_id) : undefined;
  const updates = [...ctx.db.team_update.incident_id.filter(f.incident_id)].filter(u => u.decision_ids.includes(d.id));
  const row = ctx.db.suggestion.insert({
    id: 0n, incident_id: f.incident_id, source_id: src?.id ?? 0n, source_version: src?.version ?? 0,
    evidence_id: ev.id, evidence_version: ev.version,
    decision_ids: [d.id], decision_versions: [d.version],
    team_update_ids: updates.map(u => u.id), team_update_versions: updates.map(u => u.version),
    excerpt: f.excerpt, explanation: f.explanation, verification: f.verification, origin: 'nora', state: 'pending',
    revision_of: f.revision_of, created_by: ctx.sender, created_at: ctx.timestamp,
    dismissed_by: undefined, dismissed_at: undefined, dismissal_feedback: '', reassess_state: '', request_id: '', attempt: 0,
    reassess_error: '', reassess_note: '', revision_id: undefined, version: 1,
  });
  ctx.db.suggestion_target.insert({ suggestion_id: row.id, incident_id: f.incident_id, decision_id: d.id, decision_version: d.version, urgent: f.urgent });
  return { row, decision: d };
}

function insertSuggestion(ctx: Ctx, f: {
  incident_id: bigint; evidence_id: bigint; excerpt: string; explanation: string; verification: string;
  origin: string; revision_of?: bigint;
}) {
  const ev = ctx.db.evidence.id.find(f.evidence_id);
  if (!ev || ev.incident_id !== f.incident_id) fail('Evidence not found');
  if (ev.source_id === undefined) fail('Evidence has no source to review');
  const src = ctx.db.source.id.find(ev.source_id);
  if (!src) fail('Source not found');
  // The quote must appear word for word in the evidence, so it can't be invented.
  if (!ev.content_text.includes(f.excerpt)) fail('Excerpt must be an exact quote from the evidence');
  return ctx.db.suggestion.insert({
    id: 0n,
    incident_id: f.incident_id,
    source_id: src.id,
    source_version: src.version,
    evidence_id: ev.id,
    evidence_version: ev.version,
    ...dependencyVersions(ctx, f.incident_id, src.id),
    excerpt: f.excerpt,
    explanation: f.explanation,
    verification: f.verification,
    origin: f.origin,
    state: 'pending',
    revision_of: f.revision_of,
    created_by: ctx.sender,
    created_at: ctx.timestamp,
    dismissed_by: undefined,
    dismissed_at: undefined,
    dismissal_feedback: '',
    reassess_state: '',
    request_id: '',
    attempt: 0,
    reassess_error: '',
    reassess_note: '',
    revision_id: undefined,
    version: 1,
  });
}

/** Nora's worker or a responder (analyst and up) proposes a review of a source. */
export const add_suggestion = spacetimedb.reducer(
  { incident_id: t.u64(), evidence_id: t.u64(), excerpt: t.string(), explanation: t.string(), verification: t.string() },
  (ctx, { incident_id, evidence_id, excerpt, explanation, verification }) => {
    const isNora = serviceKind(ctx) === 'nora';
    if (!isNora) requireTier(ctx, incident_id, 1);
    requireIncident(ctx, incident_id);
    const row = insertSuggestion(ctx, {
      incident_id,
      evidence_id,
      excerpt: cleanText(excerpt, 'Excerpt', 1, EXPLANATION_MAX),
      explanation: cleanText(explanation, 'Explanation', 1, EXPLANATION_MAX),
      verification: cleanText(verification, 'Verification', 1, VERIFICATION_MAX),
      origin: isNora ? 'nora' : 'human',
    });
    logActivity(ctx, incident_id, 'suggestion_stored', 'suggestion', row.id, `Suggested review of evidence ${evidence_id}`, 'PROPOSAL_STORED', { origin: row.origin });
  }
);

/** Port of confirmReview(). */
export const confirm_suggestion = spacetimedb.reducer(
  { suggestion_id: t.u64(), reason: t.string() },
  (ctx, { suggestion_id, reason }) => {
    const s = requireSuggestion(ctx, suggestion_id);
    requireTier(ctx, s.incident_id, 1);
    if (s.state === 'accepted') return;
    if (s.state !== 'pending') fail('This suggestion is no longer pending.');
    const why = reason.trim();
    if (why.length < REASON_MIN || reason.length > REASON_MAX) fail('Add a review reason of 8-2,000 characters.');
    const { decisions, updates } = previewImpact(ctx, s);

    ctx.db.suggestion.id.update({ ...s, state: 'accepted', version: s.version + 1 });
    for (const d of decisions) {
      ctx.db.decision.id.update({ ...d, state: 'needs_review', version: d.version + 1 });
      logActivity(ctx, s.incident_id, 'decision_needs_review', 'decision', d.id, d.title, 'DECISION_NEEDS_REVIEW');
    }
    for (const u of updates) {
      ctx.db.team_update.id.update({ ...u, state: 'outdated', version: u.version + 1 });
      logActivity(ctx, s.incident_id, 'team_update_outdated', 'team_update', u.id, u.title, 'BRIEFING_OUTDATED');
    }
    const existing = new Set<bigint>();
    for (const tk of ctx.db.task.incident_id.filter(s.incident_id)) if (tk.suggestion_id === s.id) existing.add(tk.decision_id);
    for (const d of decisions) {
      if (existing.has(d.id)) continue;
      const tk = ctx.db.task.insert({
        id: 0n, incident_id: s.incident_id, suggestion_id: s.id, decision_id: d.id,
        title: s.verification, assignee: d.owner, state: 'open', created_at: ctx.timestamp, version: 1,
      });
      logActivity(ctx, s.incident_id, 'task_assigned', 'task', tk.id, tk.title, 'TASK_ASSIGNED');
    }
    logActivity(ctx, s.incident_id, 'suggestion_accepted', 'suggestion', s.id, `Source review confirmed. ${why}`, 'PROPOSAL_ACCEPTED');
  }
);

function queueReassessment(ctx: Ctx, s: SuggestionRow, attempt: number) {
  const key = requestIdFor(s.id, attempt);
  ctx.db.reassessment_request.insert({
    id: 0n, incident_id: s.incident_id, suggestion_id: s.id, request_key: key, attempt,
    state: 'requested', requested_by: ctx.sender, requested_at: ctx.timestamp, completed_at: undefined, error: '',
  });
  return key;
}

/** Port of dismissProposal(). Empty feedback dismisses without involving Nora. */
export const dismiss_suggestion = spacetimedb.reducer(
  { suggestion_id: t.u64(), feedback: t.string() },
  (ctx, { suggestion_id, feedback }) => {
    const s = requireSuggestion(ctx, suggestion_id);
    requireTier(ctx, s.incident_id, 1);
    if (s.state === 'dismissed') return; // a double submit is a no-op
    if (s.state !== 'pending') fail('This suggestion is no longer pending.');
    if (feedback.length > FEEDBACK_MAX) fail(`Keep feedback under ${FEEDBACK_MAX} characters.`);
    const text = normalizeFeedback(feedback);
    const key = text ? queueReassessment(ctx, s, 1) : '';
    ctx.db.suggestion.id.update({
      ...s,
      state: 'dismissed',
      dismissed_by: ctx.sender,
      dismissed_at: ctx.timestamp,
      dismissal_feedback: text,
      reassess_state: text ? 'requested' : '',
      request_id: key,
      attempt: text ? 1 : 0,
      version: s.version + 1,
    });
    logActivity(ctx, s.incident_id, 'suggestion_dismissed', 'suggestion', s.id,
      text ? `Dismissed with feedback; Nora (Nemotron) reassessment requested. ${text}` : 'Dismissed without feedback.',
      'PROPOSAL_DISMISSED', { feedback: text.length > 0 });
    if (text) logActivity(ctx, s.incident_id, 'reassessment_requested', 'suggestion', s.id, `Request ${key}`, 'ANALYSIS_REQUESTED');
  }
);

/** Port of retryReassessment(). Anything other than a failure is left alone. */
export const retry_reassessment = spacetimedb.reducer(
  { suggestion_id: t.u64() },
  (ctx, { suggestion_id }) => {
    const s = requireSuggestion(ctx, suggestion_id);
    requireTier(ctx, s.incident_id, 1);
    if (s.reassess_state !== 'failed') return;
    const attempt = s.attempt + 1;
    const key = queueReassessment(ctx, s, attempt);
    ctx.db.suggestion.id.update({ ...s, reassess_state: 'requested', request_id: key, attempt, reassess_error: '', version: s.version + 1 });
    logActivity(ctx, s.incident_id, 'reassessment_requested', 'suggestion', s.id, `Request ${key} (attempt ${attempt})`, 'ANALYSIS_REQUESTED');
  }
);

/**
 * Port of recordReassessment(). Nora's worker reports the model's raw reply for one
 * request. A reply for an old or unknown request is ignored. A revision becomes a new
 * pending suggestion that a person must still review; the dismissal is never undone.
 */
export const complete_reassessment = spacetimedb.reducer(
  { request_id: t.u64(), result_json: t.string() },
  (ctx, { request_id, result_json }) => {
    requireService(ctx, 'nora');
    const req = ctx.db.reassessment_request.id.find(request_id);
    if (!req) fail('Request not found');
    const s = requireSuggestion(ctx, req.suggestion_id);
    if (req.state !== 'requested' || s.reassess_state !== 'requested' || s.request_id !== req.request_key) return;
    if (result_json.length > 3 * EXPLANATION_MAX + VERIFICATION_MAX + 200) fail('Result too large');

    let result = parseReassessmentResult(result_json);
    const ev = ctx.db.evidence.id.find(s.evidence_id);
    if (result.kind === 'revision' && !ev?.content_text.includes(result.excerpt)) {
      result = { kind: 'error', message: 'Nora (Nemotron) quoted text that is not in the evidence, so the revision was rejected.' };
    }
    const done = { completed_at: ctx.timestamp };
    if (result.kind === 'error') {
      ctx.db.reassessment_request.id.update({ ...req, ...done, state: 'failed', error: result.message });
      ctx.db.suggestion.id.update({ ...s, reassess_state: 'failed', reassess_error: result.message, version: s.version + 1 });
      logActivity(ctx, s.incident_id, 'reassessment_failed', 'suggestion', s.id, 'Nora (Nemotron) reassessment failed. The dismissal stands.', 'ANALYSIS_FINISHED', { outcome: 'failed' });
      return;
    }
    if (result.kind === 'no_further_review') {
      ctx.db.reassessment_request.id.update({ ...req, ...done, state: 'no_further_review' });
      ctx.db.suggestion.id.update({ ...s, reassess_state: 'no_further_review', reassess_note: result.note, version: s.version + 1 });
      logActivity(ctx, s.incident_id, 'reassessment_finished', 'suggestion', s.id, 'Nora (Nemotron) reassessed: no further review suggested.', 'ANALYSIS_FINISHED', { outcome: 'no_further_review' });
      return;
    }
    const target = ctx.db.suggestion_target.suggestion_id.find(s.id);
    const revision = target
      ? insertTargetedSuggestion(ctx, {
        incident_id: s.incident_id, evidence_id: s.evidence_id, decision_id: target.decision_id,
        excerpt: result.excerpt, explanation: result.explanation, verification: result.verification,
        urgent: target.urgent, revision_of: s.id,
      }).row
      : insertSuggestion(ctx, {
        incident_id: s.incident_id, evidence_id: s.evidence_id,
        excerpt: result.excerpt, explanation: result.explanation, verification: result.verification,
        origin: 'nora', revision_of: s.id,
      });
    ctx.db.reassessment_request.id.update({ ...req, ...done, state: 'revised' });
    ctx.db.suggestion.id.update({ ...s, reassess_state: 'revised', revision_id: revision.id, version: s.version + 1 });
    logActivity(ctx, s.incident_id, 'reassessment_finished', 'suggestion', s.id, `Nora (Nemotron) proposed revised suggestion ${revision.id} for human review.`, 'ANALYSIS_FINISHED', { outcome: 'revised' });
    logActivity(ctx, s.incident_id, 'suggestion_stored', 'suggestion', revision.id, `Revision of suggestion ${s.id}`, 'PROPOSAL_STORED', { origin: 'nora' });
  }
);

// ---------- Nora (Nemotron) investigating new evidence ----------

const REVIEW_OUTCOMES = ['no_impact', 'supports', 'failed'] as const; // supports: findings back a decision

function requireUnreviewed(ctx: Ctx, evidenceId: bigint) {
  const ev = ctx.db.evidence.id.find(evidenceId);
  if (!ev) fail('Evidence not found');
  if (ctx.db.evidence_review.evidence_id.find(evidenceId)) fail('Nora already reviewed this evidence');
  return ev;
}

/** Nora read new evidence and found nothing it changes (or could not finish). Saved quietly. */
export const record_evidence_review = spacetimedb.reducer(
  { evidence_id: t.u64(), outcome: t.string(), summary: t.string(), model: t.string() },
  (ctx, { evidence_id, outcome, summary, model }) => {
    requireService(ctx, 'nora');
    const ev = requireUnreviewed(ctx, evidence_id);
    const row = ctx.db.evidence_review.insert({
      evidence_id: ev.id, incident_id: ev.incident_id, outcome: oneOf(outcome, REVIEW_OUTCOMES, 'review outcome'),
      decision_id: undefined, suggestion_id: undefined, summary: cleanText(summary, 'Summary', 0, MAX_REASON),
      model: cleanText(model, 'Model', 1, MAX_LABEL), reviewed_at: ctx.timestamp,
    });
    logActivity(ctx, ev.incident_id, 'evidence_reviewed', 'evidence', ev.id,
      row.outcome === 'no_impact' ? `Nora (Nemotron) reviewed ${ev.title}: no decision affected.`
        : row.outcome === 'supports' ? `Nora (Nemotron): ${ev.title} supports the decision it verifies. ${row.summary}`.slice(0, 500)
        : `Nora (Nemotron) could not finish reviewing ${ev.title}.`,
      'EVIDENCE_REVIEWED', { outcome: row.outcome });
  }
);

/**
 * Nora found that new evidence challenges a decision's assumption. Creates a pending
 * suggestion aimed at that decision, quoting the evidence word for word. Urgent ones
 * recommend escalation; nothing in the plan changes until a person acts.
 */
export const nora_flag_decision = spacetimedb.reducer(
  {
    evidence_id: t.u64(), decision_id: t.u64(), excerpt: t.string(), explanation: t.string(),
    verification: t.string(), urgent: t.bool(), model: t.string(),
  },
  (ctx, a) => {
    requireService(ctx, 'nora');
    const ev = requireUnreviewed(ctx, a.evidence_id);
    const { row, decision } = insertTargetedSuggestion(ctx, {
      incident_id: ev.incident_id, evidence_id: ev.id, decision_id: a.decision_id,
      excerpt: cleanText(a.excerpt, 'Excerpt', 1, EXPLANATION_MAX),
      explanation: cleanText(a.explanation, 'Explanation', 1, EXPLANATION_MAX),
      verification: cleanText(a.verification, 'Verification', 1, VERIFICATION_MAX), urgent: a.urgent,
    });
    ctx.db.evidence_review.insert({
      evidence_id: ev.id, incident_id: ev.incident_id, outcome: a.urgent ? 'urgent' : 'conflict',
      decision_id: decision.id, suggestion_id: row.id, summary: row.explanation.slice(0, MAX_REASON),
      model: cleanText(a.model, 'Model', 1, MAX_LABEL), reviewed_at: ctx.timestamp,
    });
    logActivity(ctx, ev.incident_id, 'evidence_reviewed', 'evidence', ev.id,
      `Nora (Nemotron): ${ev.title} challenges decision ${decision.id} (${decision.title}).`, 'EVIDENCE_REVIEWED',
      { outcome: a.urgent ? 'urgent' : 'conflict', decision: decision.id.toString() });
    logActivity(ctx, ev.incident_id, 'suggestion_stored', 'suggestion', row.id, `Suggested review of decision ${decision.id}`, 'PROPOSAL_STORED', { origin: 'nora', urgent: a.urgent });
    if (a.urgent) {
      logActivity(ctx, ev.incident_id, 'escalation_recommended', 'decision', decision.id,
        `Nora (Nemotron) recommends escalating: ${ev.title} may put decision ${decision.id} at urgent risk. A person must confirm.`, 'ESCALATION_RECOMMENDED');
    }
  }
);

/** Nora's own message in the team discussion (to everyone, or to one member such as the lead). */
export const nora_post = spacetimedb.reducer(
  { incident_id: t.u64(), text: t.string(), recipient: t.option(t.identity()), evidence_id: t.option(t.u64()) },
  (ctx, { incident_id, text, recipient, evidence_id }) => {
    requireService(ctx, 'nora');
    requireIncident(ctx, incident_id);
    const body = cleanText(text, 'Message', 1, MAX_MESSAGE);
    if (recipient !== undefined && !activeMembership(ctx, incident_id, recipient)) fail('Recipient must be an active member of this incident');
    if (evidence_id !== undefined) {
      const ev = ctx.db.evidence.id.find(evidence_id);
      if (!ev || ev.incident_id !== incident_id) fail('Evidence not found');
    }
    const row = ctx.db.message.insert({
      id: 0n, incident_id, author: ctx.sender, text: body, recorded_at: ctx.timestamp,
      client_request_id: undefined, recipient, evidence_id,
    });
    auditOnly(ctx, incident_id.toString(), 'MESSAGE_SENT', 'message', row.id, { length: body.length, direct: recipient !== undefined, from: 'nora' });
  }
);

// ---------- tasks (phone 3's Accept) ----------

/**
 * Tier 2+ assigns work on a decision to an active teammate, e.g. "Verify the backup
 * predates the intrusion". suggestion_id 0 means it was assigned by hand.
 */
export const assign_task = spacetimedb.reducer(
  { decision_id: t.u64(), assignee: t.identity(), title: t.string() },
  (ctx, { decision_id, assignee, title }) => {
    const d = ctx.db.decision.id.find(decision_id);
    if (!d) fail('Decision not found');
    requireTier(ctx, d.incident_id, 2);
    if (!activeMembership(ctx, d.incident_id, assignee)) fail('Assign the task to an active member of this incident');
    const tk = ctx.db.task.insert({
      id: 0n, incident_id: d.incident_id, suggestion_id: 0n, decision_id: d.id,
      title: cleanText(title, 'Task', 1, MAX_TITLE), assignee, state: 'open', created_at: ctx.timestamp, version: 1,
    });
    logActivity(ctx, d.incident_id, 'task_assigned', 'task', tk.id, tk.title, 'TASK_ASSIGNED', { decision: d.id.toString() });
  }
);

function requireAssignee(ctx: Ctx, taskId: bigint) {
  const tk = ctx.db.task.id.find(taskId);
  if (!tk) fail('Task not found');
  requireTier(ctx, tk.incident_id, 1);
  if (!tk.assignee.isEqual(ctx.sender)) fail('Only the assignee can change this task');
  return tk;
}

export const accept_task = spacetimedb.reducer(
  { task_id: t.u64() },
  (ctx, { task_id }) => {
    const tk = requireAssignee(ctx, task_id);
    if (tk.state === 'accepted') return;
    if (tk.state !== 'open') fail('Only an open task can be accepted');
    ctx.db.task.id.update({ ...tk, state: 'accepted', version: tk.version + 1 });
    logActivity(ctx, tk.incident_id, 'task_accepted', 'task', tk.id, tk.title, 'TASK_ACCEPTED');
  }
);

/**
 * The assignee submits what they found. In one step: the findings become evidence
 * (source type "verification", titled with the decision they verify) and the task is
 * resolved. Nora (Nemotron) then investigates the findings like any new evidence.
 */
export const submit_findings = spacetimedb.reducer(
  { task_id: t.u64(), findings: t.string() },
  (ctx, { task_id, findings }) => {
    const tk = requireAssignee(ctx, task_id);
    if (tk.state === 'resolved') fail('This task is already resolved');
    const text = cleanText(findings, 'Findings', 1, MAX_EVIDENCE_CONTENT);
    const ev = ctx.db.evidence.insert({
      id: 0n, incident_id: tk.incident_id,
      title: `Verification of D-${tk.decision_id.toString().padStart(3, '0')}: ${tk.title}`.slice(0, MAX_EVIDENCE_TITLE),
      source_label: 'Verification findings', source_type: 'verification', content_text: text,
      event_time: ctx.timestamp, recorded_at: ctx.timestamp, submitted_by: ctx.sender, version: 1,
      source_id: undefined, standing: 'under_review',
    });
    ctx.db.task.id.update({ ...tk, state: 'resolved', version: tk.version + 1 });
    logActivity(ctx, tk.incident_id, 'evidence_added', 'evidence', ev.id, ev.title);
    logActivity(ctx, tk.incident_id, 'task_resolved', 'task', tk.id, `${tk.title} (findings in E-${ev.id.toString().padStart(3, '0')})`, 'TASK_RESOLVED');
  }
);

export const resolve_task = spacetimedb.reducer(
  { task_id: t.u64() },
  (ctx, { task_id }) => {
    const tk = requireAssignee(ctx, task_id);
    if (tk.state === 'resolved') return;
    ctx.db.task.id.update({ ...tk, state: 'resolved', version: tk.version + 1 });
    logActivity(ctx, tk.incident_id, 'task_resolved', 'task', tk.id, tk.title, 'TASK_RESOLVED');
  }
);

// ---------- Nora's findings ----------

/** Runs a finding's action on its account. Returns the account's prior status, if it changed. */
function applyAction(ctx: Ctx, f: { incident_id: bigint; account_id?: bigint; proposed_action: string; id: bigint }) {
  const effect = ACTION_EFFECTS[f.proposed_action as ProposedAction];
  if (effect === null) return undefined;
  if (f.account_id === undefined) fail('This finding names no account to act on');
  const acct = ctx.db.northstar_account.id.find(f.account_id);
  if (!acct || acct.incident_id !== f.incident_id) fail('Account not found');
  ctx.db.northstar_account.id.update({ ...acct, status: effect, version: acct.version + 1 });
  logActivity(ctx, f.incident_id, 'account_status_changed', 'northstar_account', acct.id,
    `${acct.account_ref}: ${acct.status} -> ${effect} (finding ${f.id})`, 'ACCOUNT_STATUS_CHANGED');
  return acct.status;
}

function remember(ctx: Ctx, f: { incident_id: bigint; id: bigint }, decision: string, feedback: string) {
  ctx.db.nora_memory.insert({
    id: 0n, incident_id: f.incident_id, finding_id: f.id, decision, feedback,
    recorded_by: ctx.sender, recorded_at: ctx.timestamp,
  });
}

/**
 * Nora reports what she saw. A low-severity finding that names an enabled rule whose
 * one allowed action is the proposed action is fixed at once; everything else waits
 * for a person.
 */
export const create_finding = spacetimedb.reducer(
  {
    incident_id: t.u64(),
    account_ref: t.option(t.string()),
    login_event_id: t.option(t.u64()),
    severity: t.string(),
    queue: t.string(),
    title: t.string(),
    reason: t.string(),
    clues: t.string(),
    attack_technique: t.string(),
    proposed_fix: t.string(),
    proposed_action: t.string(),
    rule_id: t.option(t.u64()),
    model: t.string(),
  },
  (ctx, a) => {
    requireService(ctx, 'nora');
    requireIncident(ctx, a.incident_id);
    const severity = oneOf(a.severity, FINDING_SEVERITIES, 'severity');
    const queue = oneOf(a.queue, FINDING_QUEUES, 'queue');
    const action = oneOf(a.proposed_action, PROPOSED_ACTIONS, 'proposed action');
    let clues: string;
    try { clues = cleanClues(a.clues); } catch (e) { fail((e as Error).message); }
    const technique = a.attack_technique.trim();
    if (technique && !isAttackTechniqueId(technique)) fail('Invalid ATT&CK technique id');

    let accountId: bigint | undefined;
    if (a.account_ref !== undefined) {
      const acct = accountByRef(ctx, a.incident_id, a.account_ref);
      if (!acct) fail('Unknown account');
      accountId = acct.id;
    }
    if (a.login_event_id !== undefined) {
      const login = ctx.db.login_event.id.find(a.login_event_id);
      if (!login || login.incident_id !== a.incident_id) fail('Login event not found');
      if (accountId !== undefined && login.account_id !== accountId) fail('Login event is for a different account');
      accountId ??= login.account_id;
      // One finding per sign-in, even if two copies of Nora are running.
      for (const f of ctx.db.finding.incident_id.filter(a.incident_id)) {
        if (f.login_event_id === a.login_event_id) fail('This sign-in already has a finding');
      }
    }

    const rule = a.rule_id === undefined ? undefined : ctx.db.low_severity_rule.id.find(a.rule_id) ?? undefined;
    const autoFix = a.rule_id !== undefined
      && autoFixRefusal({ queue, severity, proposedAction: action, rule }) === null;

    const row = ctx.db.finding.insert({
      id: 0n,
      incident_id: a.incident_id,
      account_id: accountId,
      login_event_id: a.login_event_id,
      severity,
      queue,
      title: cleanText(a.title, 'Title', 1, MAX_TITLE),
      reason: cleanText(a.reason, 'Reason', 1, MAX_SUMMARY),
      clues,
      attack_technique: technique,
      proposed_fix: cleanText(a.proposed_fix, 'Proposed fix', 1, MAX_REASON),
      proposed_action: action,
      rule_id: a.rule_id,
      state: 'open',
      decided_by: undefined,
      decided_at: undefined,
      dismissal_feedback: '',
      prior_status: undefined,
      model: cleanText(a.model, 'Model', 1, MAX_LABEL),
      created_at: ctx.timestamp,
      version: 1,
    });
    logActivity(ctx, a.incident_id, 'finding_created', 'finding', row.id, `${severity}: ${row.title}`, 'FINDING_CREATED',
      { severity, queue, action, technique });

    if (autoFix) {
      const prior = applyAction(ctx, row);
      ctx.db.finding.id.update({
        ...row, state: 'auto_fixed', decided_by: ctx.sender, decided_at: ctx.timestamp, prior_status: prior, version: row.version + 1,
      });
      logActivity(ctx, a.incident_id, 'finding_auto_fixed', 'finding', row.id,
        `Auto-fixed under rule ${a.rule_id}: ${action}`, 'FINDING_AUTO_FIXED', { rule: a.rule_id!.toString(), action });
    }
  }
);

function requireFinding(ctx: Ctx, id: bigint) {
  const f = ctx.db.finding.id.find(id);
  if (!f) fail('Finding not found');
  return f;
}

export const approve_finding = spacetimedb.reducer(
  { finding_id: t.u64(), expected_version: t.u32() },
  (ctx, { finding_id, expected_version }) => {
    const f = requireFinding(ctx, finding_id);
    requireTier(ctx, f.incident_id, 2); // containment: runs the action;
    if (f.state === 'approved') return;
    if (f.state !== 'open') fail('This finding is no longer open');
    if (f.version !== expected_version) fail('Finding changed since you loaded it; refresh and retry');
    const prior = applyAction(ctx, f);
    ctx.db.finding.id.update({
      ...f, state: 'approved', decided_by: ctx.sender, decided_at: ctx.timestamp, prior_status: prior, version: f.version + 1,
    });
    remember(ctx, f, 'approved', '');
    logActivity(ctx, f.incident_id, 'finding_approved', 'finding', f.id, `${f.proposed_action}: ${f.title}`, 'FINDING_APPROVED');
  }
);

/** Typing feedback here is the only time anyone "talks" to Nora: it is saved to her memory. */
export const dismiss_finding = spacetimedb.reducer(
  { finding_id: t.u64(), feedback: t.string() },
  (ctx, { finding_id, feedback }) => {
    const f = requireFinding(ctx, finding_id);
    requireTier(ctx, f.incident_id, 1); // triage: a false alarm changes nothing;
    if (f.state === 'dismissed') return;
    if (f.state !== 'open') fail('This finding is no longer open');
    if (feedback.length > FEEDBACK_MAX) fail(`Keep feedback under ${FEEDBACK_MAX} characters.`);
    const text = normalizeFeedback(feedback);
    ctx.db.finding.id.update({
      ...f, state: 'dismissed', decided_by: ctx.sender, decided_at: ctx.timestamp, dismissal_feedback: text, version: f.version + 1,
    });
    remember(ctx, f, 'dismissed', text);
    logActivity(ctx, f.incident_id, 'finding_dismissed', 'finding', f.id, text ? `Dismissed: ${text}` : 'Dismissed without feedback',
      'FINDING_DISMISSED', { feedback: text.length > 0 });
  }
);

/** A commander reverses an automatic fix. Refused if the account was changed since. */
export const undo_auto_fix = spacetimedb.reducer(
  { finding_id: t.u64() },
  (ctx, { finding_id }) => {
    const f = requireFinding(ctx, finding_id);
    requireTier(ctx, f.incident_id, 2);
    if (f.state === 'undone') return;
    if (f.state !== 'auto_fixed') fail('Only an automatic fix can be undone');
    const effect = ACTION_EFFECTS[f.proposed_action as ProposedAction];
    if (effect !== null && f.prior_status !== undefined && f.account_id !== undefined) {
      const acct = ctx.db.northstar_account.id.find(f.account_id);
      if (!acct) fail('Account not found');
      if (acct.status !== effect) fail('The account changed after the fix; change it by hand');
      ctx.db.northstar_account.id.update({ ...acct, status: f.prior_status, version: acct.version + 1 });
      logActivity(ctx, f.incident_id, 'account_status_changed', 'northstar_account', acct.id,
        `${acct.account_ref}: ${acct.status} -> ${f.prior_status} (undo of finding ${f.id})`, 'ACCOUNT_STATUS_CHANGED');
    }
    ctx.db.finding.id.update({ ...f, state: 'undone', decided_by: ctx.sender, decided_at: ctx.timestamp, version: f.version + 1 });
    remember(ctx, f, 'undone', '');
    logActivity(ctx, f.incident_id, 'finding_undone', 'finding', f.id, `Undid ${f.proposed_action}`, 'FINDING_UNDONE');
  }
);

export const delete_nora_memory = spacetimedb.reducer(
  { memory_id: t.u64() },
  (ctx, { memory_id }) => {
    const m = ctx.db.nora_memory.id.find(memory_id);
    if (!m) fail('Memory not found');
    requireTier(ctx, m.incident_id, 3);
    ctx.db.nora_memory.id.delete(memory_id);
    logActivity(ctx, m.incident_id, 'memory_deleted', 'nora_memory', m.id, `Deleted Nora (Nemotron)'s memory of finding ${m.finding_id}`, 'MEMORY_DELETED');
  }
);

// ---------- outside contacts and simulated SMS ----------

export const add_outside_contact = spacetimedb.reducer(
  { incident_id: t.u64(), account_ref: t.string(), display_name: t.string(), demo_identity: t.identity() },
  (ctx, { incident_id, account_ref, display_name, demo_identity }) => {
    requireTier(ctx, incident_id, 1);
    requireIncident(ctx, incident_id);
    const acct = accountByRef(ctx, incident_id, account_ref);
    if (!acct) fail('Unknown account');
    if (activeMembership(ctx, incident_id, demo_identity)) fail('A responder cannot also be an outside contact');
    for (const c of ctx.db.outside_contact.demo_identity.filter(demo_identity)) {
      if (c.incident_id === incident_id) fail('That phone is already a contact in this incident');
    }
    const row = ctx.db.outside_contact.insert({
      id: 0n, incident_id, account_id: acct.id,
      display_name: cleanText(display_name, 'Display name', 1, MAX_NAME),
      demo_identity, added_by: ctx.sender, added_at: ctx.timestamp,
    });
    logActivity(ctx, incident_id, 'contact_added', 'outside_contact', row.id, `${row.display_name} (${acct.account_ref})`, 'CONTACT_ADDED');
  }
);

function insertSms(ctx: Ctx, contact: { id: bigint; incident_id: bigint }, direction: string, text: string) {
  const body = cleanText(text, 'Message', 1, SMS_MAX);
  const row = ctx.db.sms_message.insert({
    id: 0n, incident_id: contact.incident_id, contact_id: contact.id, direction, text: body,
    sent_at: ctx.timestamp, sent_by: ctx.sender,
  });
  // The text stays out of the audit chain.
  auditOnly(ctx, contact.incident_id.toString(), 'SMS_SENT', 'sms_message', row.id, {
    contact: contact.id.toString(), direction, length: body.length, simulated: true,
  });
}

/** A responder texts an outside contact (simulated). */
export const send_sms = spacetimedb.reducer(
  { contact_id: t.u64(), text: t.string() },
  (ctx, { contact_id, text }) => {
    const c = ctx.db.outside_contact.id.find(contact_id);
    if (!c) fail('Contact not found');
    requireTier(ctx, c.incident_id, 1);
    insertSms(ctx, c, 'to_contact', text);
  }
);

/** The contact's phone replies. Only that contact's identity may do this. */
export const reply_sms = spacetimedb.reducer(
  { contact_id: t.u64(), text: t.string() },
  (ctx, { contact_id, text }) => {
    const c = ctx.db.outside_contact.id.find(contact_id);
    if (!c || !c.demo_identity.isEqual(ctx.sender)) fail('Access denied');
    insertSms(ctx, c, 'from_contact', text);
  }
);

// ---------- views for the additions ----------

function perIncident(ctx: { sender: Identity; db: any }, tableName: string) {
  const out = [];
  for (const id of myIncidentIds(ctx)) {
    for (const row of ctx.db[tableName].incident_id.filter(id)) out.push(row);
  }
  return out;
}

export const incident_sources = spacetimedb.view(
  { name: 'incident_sources', public: true }, t.array(source.rowType), ctx => perIncident(ctx, 'source'));
export const incident_decisions = spacetimedb.view(
  { name: 'incident_decisions', public: true }, t.array(decision.rowType), ctx => perIncident(ctx, 'decision'));
export const incident_team_updates = spacetimedb.view(
  { name: 'incident_team_updates', public: true }, t.array(team_update.rowType), ctx => perIncident(ctx, 'team_update'));
export const incident_suggestions = spacetimedb.view(
  { name: 'incident_suggestions', public: true }, t.array(suggestion.rowType), ctx => perIncident(ctx, 'suggestion'));
export const incident_tasks = spacetimedb.view(
  { name: 'incident_tasks', public: true }, t.array(task.rowType), ctx => perIncident(ctx, 'task'));
export const incident_accounts = spacetimedb.view(
  { name: 'incident_accounts', public: true }, t.array(northstar_account.rowType), ctx => perIncident(ctx, 'northstar_account'));
export const incident_logins = spacetimedb.view(
  { name: 'incident_logins', public: true }, t.array(login_event.rowType), ctx => perIncident(ctx, 'login_event'));
export const incident_findings = spacetimedb.view(
  { name: 'incident_findings', public: true }, t.array(finding.rowType), ctx => perIncident(ctx, 'finding'));
export const incident_contacts = spacetimedb.view(
  { name: 'incident_contacts', public: true }, t.array(outside_contact.rowType), ctx => perIncident(ctx, 'outside_contact'));
export const incident_sms = spacetimedb.view(
  { name: 'incident_sms', public: true }, t.array(sms_message.rowType), ctx => perIncident(ctx, 'sms_message'));

export const incident_evidence_reviews = spacetimedb.view(
  { name: 'incident_evidence_reviews', public: true }, t.array(evidence_review.rowType), ctx => perIncident(ctx, 'evidence_review'));
export const incident_message_decisions = spacetimedb.view(
  { name: 'incident_message_decisions', public: true }, t.array(message_decision.rowType), ctx => perIncident(ctx, 'message_decision'));
export const incident_suggestion_targets = spacetimedb.view(
  { name: 'incident_suggestion_targets', public: true }, t.array(suggestion_target.rowType), ctx => perIncident(ctx, 'suggestion_target'));

/** The monitor panel's feed: every audit event for the caller's incidents. */
export const incident_audit = spacetimedb.view(
  { name: 'incident_audit', public: true },
  t.array(auditEvent.rowType),
  ctx => {
    const out = [];
    for (const id of myIncidentIds(ctx)) {
      for (const e of ctx.db.audit_event.incident_id.filter(id.toString())) out.push(e);
    }
    return out;
  }
);

/** The newest hash per incident, shown on the monitor panel and used by the verifier. */
export const incident_audit_heads = spacetimedb.view(
  { name: 'incident_audit_heads', public: true },
  t.array(auditHead.rowType),
  ctx => {
    const out = [];
    for (const id of myIncidentIds(ctx)) {
      const h = ctx.db.audit_head.incident_id.find(id.toString());
      if (h) out.push(h);
    }
    return out;
  }
);

/** The admin's low-severity list: readable by any active responder and by Nora. */
export const low_severity_rules = spacetimedb.view(
  { name: 'low_severity_rules', public: true },
  t.array(low_severity_rule.rowType),
  ctx => {
    if (myIncidentIds(ctx).size === 0) return [];
    return [...ctx.db.low_severity_rule.iter()];
  }
);

/** Phone 2: the contact sees only their own contact row... */
export const my_contact_profile = spacetimedb.view(
  { name: 'my_contact_profile', public: true },
  t.array(outside_contact.rowType),
  ctx => [...ctx.db.outside_contact.demo_identity.filter(ctx.sender)]
);

/** ...and only their own SMS thread. */
export const my_sms_threads = spacetimedb.view(
  { name: 'my_sms_threads', public: true },
  t.array(sms_message.rowType),
  ctx => {
    const out = [];
    for (const c of ctx.db.outside_contact.demo_identity.filter(ctx.sender)) {
      for (const m of ctx.db.sms_message.contact_id.filter(c.id)) out.push(m);
    }
    return out;
  }
);

/** Nora's worker only: saved human decisions, fed back as context. */
export const nora_memory_feed = spacetimedb.view(
  { name: 'nora_memory_feed', public: true },
  t.array(nora_memory.rowType),
  ctx => (serviceKind(ctx) === 'nora' ? [...ctx.db.nora_memory.iter()] : [])
);

/** Nora's worker only: reassessments waiting for a model reply. */
export const nora_reassessment_queue = spacetimedb.view(
  { name: 'nora_reassessment_queue', public: true },
  t.array(reassessment_request.rowType),
  ctx => (serviceKind(ctx) === 'nora' ? [...ctx.db.reassessment_request.iter()].filter(r => r.state === 'requested') : [])
);
