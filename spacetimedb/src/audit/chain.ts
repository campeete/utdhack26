/**
 * Clean Room audit chain: pure functions, no SpacetimeDB imports.
 *
 * Everything that decides whether the log is intact lives here, so the module,
 * the browser and the tests all use the same code. tools/verify_audit.py is an
 * independent re-implementation of the same rules in Python.
 *
 * Security property: TAMPER-EVIDENT, not tamper-proof. Anyone with database
 * write access can still change rows; this makes every change detectable.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export const FORMAT = 'CRAUDIT-v1';
export const MAX_METADATA_BYTES = 2048;
export const CLOCK_SKEW_WARN_MICROS = 120_000_000n; // 2 minutes

/** Fields covered by the hash. Integers are carried as bigint, identities as hex. */
export interface EventFields {
  incidentId: bigint;
  seq: bigint;
  actor: string; // identity hex (no 0x)
  actorKind: 'user' | 'service' | 'system';
  serverTsMicros: bigint; // ctx.timestamp: the trusted clock
  clientTsMicros: bigint; // what the client claimed; 0 = not supplied
  action: string;
  entityType: string;
  entityId: string;
  metadata: string; // JSON object text, <= MAX_METADATA_BYTES
  clientSig: string; // device signature (P2); '' until then
  prevHash: string;
}
export interface AuditEvent extends EventFields {
  hash: string;
}

/** One fixed-order JSON array. Every number becomes a decimal string, so
 *  JavaScript and Python produce byte-identical text. */
export function canonical(e: EventFields): string {
  return JSON.stringify([
    FORMAT,
    e.incidentId.toString(),
    e.seq.toString(),
    e.actor,
    e.actorKind,
    e.serverTsMicros.toString(),
    e.clientTsMicros.toString(),
    e.action,
    e.entityType,
    e.entityId,
    e.metadata,
    e.clientSig,
    e.prevHash,
  ]);
}

export const sha256Hex = (s: string): string => bytesToHex(sha256(utf8ToBytes(s)));
export const hashEvent = (e: EventFields): string => sha256Hex(canonical(e));

/** Each incident's chain starts from its own genesis value, so a chain (or an
 *  event) copied from one incident never verifies inside another. */
export const genesisHash = (incidentId: bigint): string =>
  sha256Hex(`${FORMAT}|genesis|${incidentId.toString()}`);

// ---------------------------------------------------------------- validation

export const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const SECRET_KEY = /pass(word)?|secret|token|totp|otp|api[_-]?key|private[_-]?key|session|cookie|authorization/i;

/** Validates and normalises metadata. Throws on anything that must never be
 *  written into evidence: oversize text, non-objects, broken Unicode, or keys
 *  that look like credentials (logging a secret would leak it to every reader). */
export function checkMetadata(meta: Record<string, unknown>): string {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new Error('audit metadata must be a JSON object');
  }
  const walk = (v: unknown, path: string): void => {
    if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (SECRET_KEY.test(k)) throw new Error(`audit metadata key "${path}${k}" looks like a secret; never log credentials`);
        walk(child, `${path}${k}.`);
      }
    }
  };
  walk(meta, '');
  const text = JSON.stringify(meta, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  if (LONE_SURROGATE.test(text)) throw new Error('audit metadata contains malformed Unicode');
  if (utf8ToBytes(text).length > MAX_METADATA_BYTES) throw new Error(`audit metadata exceeds ${MAX_METADATA_BYTES} bytes`);
  return text;
}

// ---------------------------------------------------------------- verification

export type FindingCode =
  | 'WRONG_INCIDENT'   // event belongs to another incident's chain
  | 'SEQ_GAP'          // a sequence number is missing (deletion)
  | 'SEQ_DUPLICATE'    // two events claim the same number (insertion)
  | 'LINK_BROKEN'      // prev_hash does not match the event before it
  | 'HASH_MISMATCH'    // contents changed after the event was written
  | 'TIME_REVERSED'    // server time went backwards (reordering or forgery)
  | 'HEAD_MISMATCH'    // newest event is not the recorded chain head (tail cut off)
  | 'ANCHOR_MISMATCH'  // a hash a witness saved earlier is gone or different (rewrite)
  | 'CLOCK_SKEW';      // warning only: client clock far from server clock

export const WARNING_ONLY: ReadonlySet<FindingCode> = new Set(['CLOCK_SKEW']);

export interface Finding {
  code: FindingCode;
  seq: bigint | null;
  detail: string;
}
export interface Anchor {
  seq: bigint;
  hash: string;
}
export interface Head {
  seq: bigint;
  hash: string;
}
export interface VerifyResult {
  ok: boolean;
  checked: number;
  firstBreakSeq: bigint | null;
  findings: Finding[];
  headHash: string | null;
}

/** Verifies one incident's chain. Events may arrive in any order; they are
 *  sorted by seq first. Pass `head` (from the head table) to catch a deleted
 *  tail, and `anchors` (hashes saved by witnesses) to catch a full rewrite. */
export function verifyChain(
  incidentId: bigint,
  input: readonly AuditEvent[],
  opts: { head?: Head; anchors?: readonly Anchor[] } = {},
): VerifyResult {
  const findings: Finding[] = [];
  const add = (code: FindingCode, seq: bigint | null, detail: string) => findings.push({ code, seq, detail });
  const events = [...input].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));

  let prevHash = genesisHash(incidentId);
  let expectSeq = 1n;
  let prevTs: bigint | null = null;
  for (const e of events) {
    if (e.incidentId !== incidentId) add('WRONG_INCIDENT', e.seq, `belongs to incident ${e.incidentId}`);
    if (e.seq < expectSeq) add('SEQ_DUPLICATE', e.seq, `seq ${e.seq} appears more than once`);
    else if (e.seq > expectSeq) add('SEQ_GAP', e.seq, `seq ${expectSeq}..${e.seq - 1n} missing`);
    if (e.prevHash !== prevHash) add('LINK_BROKEN', e.seq, 'prev_hash does not match the previous event');
    if (hashEvent(e) !== e.hash) add('HASH_MISMATCH', e.seq, 'stored hash does not match contents');
    if (prevTs !== null && e.serverTsMicros < prevTs) add('TIME_REVERSED', e.seq, 'server time earlier than previous event');
    if (e.clientTsMicros !== 0n) {
      const d = e.clientTsMicros - e.serverTsMicros;
      if (d > CLOCK_SKEW_WARN_MICROS || -d > CLOCK_SKEW_WARN_MICROS) {
        add('CLOCK_SKEW', e.seq, `client clock off by ${Number(d / 1_000_000n)} s`);
      }
    }
    prevHash = e.hash;
    expectSeq = e.seq + 1n;
    prevTs = e.serverTsMicros;
  }

  const last = events.at(-1) ?? null;
  if (opts.head) {
    if (!last || last.seq !== opts.head.seq || last.hash !== opts.head.hash) {
      add('HEAD_MISMATCH', opts.head.seq, `head says seq ${opts.head.seq}; log ends at ${last ? last.seq : 'nothing'}`);
    }
  }
  for (const a of opts.anchors ?? []) {
    const match = events.find((e) => e.seq === a.seq);
    if (!match || match.hash !== a.hash) add('ANCHOR_MISMATCH', a.seq, 'witness-saved hash no longer matches');
  }

  const hard = findings.filter((f) => !WARNING_ONLY.has(f.code));
  const seqs = hard.map((f) => f.seq).filter((s): s is bigint => s !== null);
  return {
    ok: hard.length === 0,
    checked: events.length,
    firstBreakSeq: seqs.length ? seqs.reduce((m, s) => (s < m ? s : m)) : null,
    findings,
    headHash: last ? last.hash : null,
  };
}

// ---------------------------------------------------------------- export format

/** JSON-safe export (bigints as strings) consumed by tools/verify_audit.py. */
export function exportChain(incidentId: bigint, events: readonly AuditEvent[], head?: Head): string {
  const s = (v: bigint) => v.toString();
  return JSON.stringify(
    {
      format: FORMAT,
      incident_id: s(incidentId),
      head: head ? { seq: s(head.seq), hash: head.hash } : null,
      events: events.map((e) => ({
        incident_id: s(e.incidentId), seq: s(e.seq), actor: e.actor, actor_kind: e.actorKind,
        server_ts_micros: s(e.serverTsMicros), client_ts_micros: s(e.clientTsMicros),
        action: e.action, entity_type: e.entityType, entity_id: e.entityId, metadata: e.metadata,
        client_sig: e.clientSig, prev_hash: e.prevHash, hash: e.hash,
      })),
    },
    null,
    2,
  );
}
