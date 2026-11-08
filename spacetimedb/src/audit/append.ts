/**
 * appendEvent(): the one function every state-changing reducer calls.
 *
 * It runs inside the caller's reducer, so it shares that reducer's transaction:
 * the change and its audit event commit together or not at all. There is no
 * way for an action to exist without its event, or an event without its action.
 */
import type { Identity, Timestamp } from 'spacetimedb';
import { checkMetadata, genesisHash, hashEvent, LONE_SURROGATE, type EventFields } from './chain';
import { isAuditAction, isIncidentId, type AuditAction } from './actions';

export interface AuditEventRow {
  id: bigint;
  incident_id: string;
  seq: bigint;
  actor: Identity;
  actor_kind: string;
  server_ts: Timestamp;
  client_ts_micros: bigint;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: string;
  client_sig: string;
  prev_hash: string;
  hash: string;
}
export interface AuditHeadRow {
  incident_id: string;
  seq: bigint;
  hash: string;
  updated_at: Timestamp;
}

/** The slice of a reducer context appendEvent needs. A real ReducerCtx from a
 *  schema that includes auditEvent and auditHead satisfies it. */
export interface AuditCtx {
  sender: Identity;
  timestamp: Timestamp;
  identity: Identity; // the module's own identity
  db: {
    audit_event: { insert(row: AuditEventRow): AuditEventRow };
    audit_head: {
      insert(row: AuditHeadRow): AuditHeadRow;
      incident_id: { find(id: string): AuditHeadRow | null | undefined; update(row: AuditHeadRow): AuditHeadRow };
    };
  };
}

export interface AppendInput {
  incidentId: string;
  action: AuditAction;
  entityType: string;
  entityId: string | bigint | number;
  metadata?: Record<string, unknown>;
  /** The client's own clock reading, if the reducer accepts one. Stored, never trusted. */
  clientTsMicros?: bigint;
  /** 'service' for the triage agent's identity. Defaults to 'user'. */
  actorKind?: 'user' | 'service';
  /** Device signature over the action (P2). */
  clientSig?: string;
}

const MAX_ID = 128;

/** Appends one event to the incident's chain and moves the head. Throws (and
 *  so rolls back the whole reducer) on invalid input. */
export function appendEvent(ctx: AuditCtx, input: AppendInput): AuditEventRow {
  if (!isAuditAction(input.action)) throw new Error(`unknown audit action: ${input.action}`);
  if (!isIncidentId(input.incidentId)) throw new Error('invalid audit incident id');
  const entityId = input.entityId.toString();
  if (input.entityType.length > MAX_ID || entityId.length > MAX_ID) throw new Error('audit entity reference too long');
  if (LONE_SURROGATE.test(input.entityType) || LONE_SURROGATE.test(entityId)) throw new Error('audit entity reference contains malformed Unicode');
  const metadata = checkMetadata(input.metadata ?? {});

  const head = ctx.db.audit_head.incident_id.find(input.incidentId) ?? null;
  const seq = head ? head.seq + 1n : 1n;
  const prevHash = head ? head.hash : genesisHash(input.incidentId);
  const actorHex = ctx.sender.toHexString();
  const actorKind = actorHex === ctx.identity.toHexString() ? 'system' : (input.actorKind ?? 'user');

  const fields: EventFields = {
    incidentId: input.incidentId,
    seq,
    actor: actorHex,
    actorKind,
    serverTsMicros: ctx.timestamp.microsSinceUnixEpoch,
    clientTsMicros: input.clientTsMicros ?? 0n,
    action: input.action,
    entityType: input.entityType,
    entityId,
    metadata,
    clientSig: input.clientSig ?? '',
    prevHash,
  };
  const hash = hashEvent(fields);

  const row = ctx.db.audit_event.insert({
    id: 0n, // autoInc
    incident_id: fields.incidentId,
    seq,
    actor: ctx.sender,
    actor_kind: actorKind,
    server_ts: ctx.timestamp,
    client_ts_micros: fields.clientTsMicros,
    action: fields.action,
    entity_type: fields.entityType,
    entity_id: entityId,
    metadata,
    client_sig: fields.clientSig,
    prev_hash: prevHash,
    hash,
  });
  const newHead: AuditHeadRow = { incident_id: input.incidentId, seq, hash, updated_at: ctx.timestamp };
  if (head) ctx.db.audit_head.incident_id.update(newHead);
  else ctx.db.audit_head.insert(newHead);
  return row;
}

/** Converts a stored row back into the hashed fields (for verification/export). */
export function rowToEvent(r: AuditEventRow) {
  return {
    incidentId: r.incident_id,
    seq: r.seq,
    actor: r.actor.toHexString(),
    actorKind: r.actor_kind as 'user' | 'service' | 'system',
    serverTsMicros: r.server_ts.microsSinceUnixEpoch,
    clientTsMicros: r.client_ts_micros,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    metadata: r.metadata,
    clientSig: r.client_sig,
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}
