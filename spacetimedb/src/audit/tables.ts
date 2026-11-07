/**
 * Audit tables. Both are PRIVATE: clients never subscribe to them directly.
 * Members read their own incident's events through the view in views.ts.
 *
 * B adds both to the module schema:
 *   const spacetimedb = schema({ ..., audit_event: auditEvent, audit_head: auditHead });
 */
import { table, t } from 'spacetimedb/server';

export const auditEvent = table(
  {
    name: 'audit_event',
    public: false,
    indexes: [{ accessor: 'by_incident_seq', algorithm: 'btree', columns: ['incident_id', 'seq'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    incident_id: t.u64().index(),
    seq: t.u64(),
    actor: t.identity(),
    actor_kind: t.string(), // user | service | system
    server_ts: t.timestamp(), // ctx.timestamp, the trusted clock
    client_ts_micros: t.i64(), // client's claimed clock; 0 = not supplied
    action: t.string(),
    entity_type: t.string(),
    entity_id: t.string(),
    metadata: t.string(), // JSON object, <= 2 KB, no secrets
    client_sig: t.string(), // device signature (P2), '' until then
    prev_hash: t.string(),
    hash: t.string(),
  },
);

/** Newest event per incident. Lets appendEvent find the tail in one lookup
 *  (no scan, so logging adds microseconds), and lets the verifier detect a
 *  deleted tail: the head must equal the last event. */
export const auditHead = table(
  { name: 'audit_head', public: false },
  {
    incident_id: t.u64().primaryKey(),
    seq: t.u64(),
    hash: t.string(),
    updated_at: t.timestamp(),
  },
);
