/** In-memory stand-in for a SpacetimeDB reducer context, for unit tests only.
 *  Real transactions are tested against a live module at Gate 1. */
import { Identity, Timestamp } from 'spacetimedb';
import type { AuditCtx, AuditEventRow, AuditHeadRow } from '../../spacetimedb/src/audit/append';
import { rowToEvent } from '../../spacetimedb/src/audit/append';

export const ident = (byte: string) => Identity.fromString('c200' + byte.repeat(30));
export const MODULE = ident('00');

export function makeDb() {
  const events: AuditEventRow[] = [];
  const heads = new Map<string, AuditHeadRow>();
  let nextId = 1n;
  return {
    events,
    heads,
    db: {
      audit_event: { insert: (r: AuditEventRow) => { const row = { ...r, id: nextId++ }; events.push(row); return row; } },
      audit_head: {
        insert: (r: AuditHeadRow) => { if (heads.has(r.incident_id)) throw new Error('dup head'); heads.set(r.incident_id, r); return r; },
        incident_id: {
          find: (id: string) => heads.get(id),
          update: (r: AuditHeadRow) => { if (!heads.has(r.incident_id)) throw new Error('no head'); heads.set(r.incident_id, r); return r; },
        },
      },
    },
  };
}

export function ctxFor(store: ReturnType<typeof makeDb>, sender: Identity, micros: bigint): AuditCtx {
  return { sender, identity: MODULE, timestamp: new Timestamp(micros), db: store.db };
}

export const eventsOf = (store: ReturnType<typeof makeDb>, incident: string) =>
  store.events.filter((e) => e.incident_id === incident).map(rowToEvent);

export const headOf = (store: ReturnType<typeof makeDb>, incident: string) => {
  const h = store.heads.get(incident)!;
  return { seq: h.seq, hash: h.hash };
};
