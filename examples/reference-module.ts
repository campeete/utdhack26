/**
 * REFERENCE INTEGRATION FOR B. Not the real module: B owns spacetimedb/src.
 * Shows the exact pattern each reducer follows so the audit log is complete:
 *   1. check identity, membership and role (default deny)
 *   2. make the change
 *   3. appendEvent(...) in the same reducer, so both commit or neither does
 * It is typechecked against the installed SDK (spacetimedb 2.14.1) by `npm run typecheck`.
 */
import { schema, table, t, SenderError, type ReducerCtx, type InferSchema } from 'spacetimedb/server';
import { auditEvent, auditHead, appendEvent, PLATFORM_INCIDENT } from '../spacetimedb/src/audit';

const config = table({ name: 'config', public: false }, { key: t.string().primaryKey(), value: t.string() });
const membership = table(
  { name: 'membership', public: false },
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index(),
    user_identity: t.identity().index(),
    role: t.string(), // admin | commander | analyst | reviewer
    active: t.bool(),
  },
);
const message = table(
  { name: 'message', public: false },
  { id: t.u64().primaryKey().autoInc(), incident_id: t.u64().index(), author: t.identity(), text: t.string(), recorded_at: t.timestamp() },
);

const spacetimedb = schema({ config, membership, message, audit_event: auditEvent, audit_head: auditHead });
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

function activeRole(ctx: Ctx, incidentId: bigint): string | null {
  for (const m of ctx.db.membership.user_identity.filter(ctx.sender)) {
    if (m.incident_id === incidentId && m.active) return m.role;
  }
  return null;
}

/** Explicit bootstrap: whoever publishes the module is the owner. */
export const init = spacetimedb.init((ctx) => {
  ctx.db.config.insert({ key: 'owner', value: ctx.sender.toHexString() });
  appendEvent(ctx, { incidentId: PLATFORM_INCIDENT, action: 'MODULE_INITIALIZED', entityType: 'module', entityId: 'clean-room' });
});

/** Owner (CLI identity) grants admin on an incident to a browser identity. */
export const grant_admin = spacetimedb.reducer(
  { incident_id: t.u64(), who: t.identity() },
  (ctx, { incident_id, who }) => {
    if (ctx.db.config.key.find('owner')?.value !== ctx.sender.toHexString()) throw new SenderError('owner only');
    ctx.db.membership.insert({ id: 0n, incident_id, user_identity: who, role: 'admin', active: true });
    appendEvent(ctx, { incidentId: incident_id, action: 'ADMIN_GRANTED', entityType: 'identity', entityId: who.toHexString() });
  },
);

export const admit_member = spacetimedb.reducer(
  { incident_id: t.u64(), who: t.identity(), role: t.string() },
  (ctx, { incident_id, who, role }) => {
    if (activeRole(ctx, incident_id) !== 'admin') throw new SenderError('admin only');
    if (!['commander', 'analyst', 'reviewer'].includes(role)) throw new SenderError('invalid role');
    ctx.db.membership.insert({ id: 0n, incident_id, user_identity: who, role, active: true });
    appendEvent(ctx, { incidentId: incident_id, action: 'MEMBER_ADMITTED', entityType: 'identity', entityId: who.toHexString(), metadata: { role } });
  },
);

export const send_message = spacetimedb.reducer(
  { incident_id: t.u64(), text: t.string(), client_ts_micros: t.i64() },
  (ctx, { incident_id, text, client_ts_micros }) => {
    if (!activeRole(ctx, incident_id)) throw new SenderError('not a member');
    if (text.length === 0 || text.length > 4000) throw new SenderError('message length');
    const m = ctx.db.message.insert({ id: 0n, incident_id, author: ctx.sender, text, recorded_at: ctx.timestamp });
    // Log the fact and a fingerprint, not the text: chat stays in its own table.
    appendEvent(ctx, { incidentId: incident_id, action: 'MESSAGE_SENT', entityType: 'message', entityId: m.id, clientTsMicros: client_ts_micros, metadata: { chars: text.length } });
  },
);

/** Members see only their own incidents' events. The tables stay private. */
export const my_audit_events = spacetimedb.view(
  { name: 'my_audit_events', public: true },
  t.array(auditEvent.rowType),
  (ctx) => {
    const out = [];
    for (const m of ctx.db.membership.user_identity.filter(ctx.sender)) {
      if (!m.active) continue;
      for (const e of ctx.db.audit_event.incident_id.filter(m.incident_id)) out.push(e);
    }
    return out;
  },
);
