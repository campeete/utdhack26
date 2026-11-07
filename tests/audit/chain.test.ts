import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendEvent } from '../../spacetimedb/src/audit/append';
import { verifyChain, hashEvent, genesisHash, checkMetadata, type AuditEvent, type FindingCode } from '../../spacetimedb/src/audit/chain';
import { buildDemo } from '../../tools/make_demo_chain';
import { ctxFor, ident, makeDb, MODULE, eventsOf, headOf } from './fake_ctx';

const codes = (r: ReturnType<typeof verifyChain>) => new Set(r.findings.map((f) => f.code));
const clone = (es: AuditEvent[]) => es.map((e) => ({ ...e }));
const rehash = (e: AuditEvent) => { e.hash = hashEvent(e); };
const expectBroken = (r: ReturnType<typeof verifyChain>, ...want: FindingCode[]) => {
  assert.equal(r.ok, false, 'tampering should be detected');
  for (const c of want) assert.ok(codes(r).has(c), `expected ${c}, got ${[...codes(r)].join(', ')}`);
};

// ------------------------------------------------------------ baseline

test('a clean chain verifies, with the head and anchors', () => {
  const { incident, events, head } = buildDemo();
  const r = verifyChain(incident, events, { head, anchors: [{ seq: 5n, hash: events[4].hash }] });
  assert.equal(r.ok, true);
  assert.equal(r.checked, 21);
});

test('appendEvent numbers from 1, links to genesis, and moves the head', () => {
  const store = makeDb();
  const a = appendEvent(ctxFor(store, ident('a1'), 1n), { incidentId: 'inc-3', action: 'INCIDENT_CREATED', entityType: 'incident', entityId: 'inc-3' });
  const b = appendEvent(ctxFor(store, ident('a1'), 2n), { incidentId: 'inc-3', action: 'STATUS_CHANGED', entityType: 'incident', entityId: 'inc-3' });
  assert.equal(a.seq, 1n);
  assert.equal(a.prev_hash, genesisHash('inc-3'));
  assert.equal(b.seq, 2n);
  assert.equal(b.prev_hash, a.hash);
  assert.deepEqual(headOf(store, 'inc-3'), { seq: 2n, hash: b.hash });
});

test('incidents keep separate chains', () => {
  const store = makeDb();
  appendEvent(ctxFor(store, ident('a1'), 1n), { incidentId: 'inc-1', action: 'INCIDENT_CREATED', entityType: 'incident', entityId: 'inc-1' });
  const other = appendEvent(ctxFor(store, ident('a1'), 2n), { incidentId: 'inc-2', action: 'INCIDENT_CREATED', entityType: 'incident', entityId: 'inc-2' });
  assert.equal(other.seq, 1n);
  assert.equal(verifyChain('inc-1', eventsOf(store, 'inc-1')).ok, true);
  assert.equal(verifyChain('inc-2', eventsOf(store, 'inc-2')).ok, true);
});

test('events written by the module itself are marked system', () => {
  const store = makeDb();
  const e = appendEvent(ctxFor(store, MODULE, 1n), { incidentId: 'inc-0', action: 'MODULE_INITIALIZED', entityType: 'module', entityId: 'x' });
  assert.equal(e.actor_kind, 'system');
});

test('the order events arrive in does not matter', () => {
  const { incident, events, head } = buildDemo();
  assert.equal(verifyChain(incident, [...events].reverse(), { head }).ok, true);
});

// ------------------------------------------------------------ attacks

test('ATTACK edit a row: hash mismatch', () => {
  const { incident, events, head } = buildDemo();
  const es = clone(events);
  es[19].metadata = es[19].metadata.replace('03:12', '09:00'); // hide the attacker's Sunday login (E-007)
  const r = verifyChain(incident, es, { head });
  expectBroken(r, 'HASH_MISMATCH');
  assert.equal(r.firstBreakSeq, 20n);
});

test('ATTACK edit a row and recompute its hash: the next link breaks', () => {
  const { incident, events, head } = buildDemo();
  const es = clone(events);
  es[19].metadata = es[19].metadata.replace('03:12', '09:00');
  rehash(es[19]);
  expectBroken(verifyChain(incident, es, { head }), 'LINK_BROKEN');
});

test('ATTACK delete a row: sequence gap and broken link', () => {
  const { incident, events, head } = buildDemo();
  const es = clone(events).filter((e) => e.seq !== 18n); // erase the source trust change
  expectBroken(verifyChain(incident, es, { head }), 'SEQ_GAP', 'LINK_BROKEN');
});

test('ATTACK insert a forged row: duplicate sequence', () => {
  const { incident, events, head } = buildDemo();
  const es = clone(events);
  const forged = { ...es[9], action: 'DECISION_APPROVED', metadata: '{"version":2}' };
  rehash(forged);
  es.splice(10, 0, forged);
  expectBroken(verifyChain(incident, es, { head }), 'SEQ_DUPLICATE');
});

test('ATTACK cut off the newest events: head mismatch', () => {
  const { incident, events, head } = buildDemo();
  expectBroken(verifyChain(incident, clone(events).slice(0, 15), { head }), 'HEAD_MISMATCH');
});

test('ATTACK cut the tail AND fix the head table: only a witness anchor catches it', () => {
  const { incident, events } = buildDemo();
  const es = clone(events).slice(0, 15);
  const forgedHead = { seq: es[14].seq, hash: es[14].hash };
  assert.equal(verifyChain(incident, es, { head: forgedHead }).ok, true, 'limit: the chain alone cannot see this');
  const anchor = { seq: 20n, hash: events[19].hash }; // a client saw seq 20 earlier
  expectBroken(verifyChain(incident, es, { head: forgedHead, anchors: [anchor] }), 'ANCHOR_MISMATCH');
});

test('ATTACK rewrite the whole chain after an edit: only a witness anchor catches it', () => {
  const { incident, events } = buildDemo();
  const es = clone(events);
  es[19].metadata = es[19].metadata.replace('03:12', '09:00');
  for (let k = 19; k < es.length; k++) { if (k) es[k].prevHash = es[k - 1].hash; rehash(es[k]); }
  const head = { seq: es.at(-1)!.seq, hash: es.at(-1)!.hash };
  assert.equal(verifyChain(incident, es, { head }).ok, true, 'limit: a full rewrite is self-consistent');
  expectBroken(verifyChain(incident, es, { head, anchors: [{ seq: 21n, hash: events[20].hash }] }), 'ANCHOR_MISMATCH');
});

test('ATTACK swap timestamps to reorder history: time reversed', () => {
  const { incident, events } = buildDemo();
  const es = clone(events);
  [es[5].serverTsMicros, es[6].serverTsMicros] = [es[6].serverTsMicros, es[5].serverTsMicros];
  rehash(es[5]); rehash(es[6]);
  expectBroken(verifyChain(incident, es), 'TIME_REVERSED');
});

test('ATTACK splice a valid event from another incident: wrong incident', () => {
  const a = buildDemo('northstar'), b = buildDemo('westgate');
  const es = clone(a.events);
  es[4] = { ...b.events[4] };
  expectBroken(verifyChain('northstar', es), 'WRONG_INCIDENT', 'LINK_BROKEN');
});

test('ATTACK present one incident\'s whole chain as another\'s: genesis differs', () => {
  const b = buildDemo('westgate');
  const relabelled = clone(b.events).map((e) => ({ ...e, incidentId: 'northstar' }));
  relabelled.forEach(rehash);
  expectBroken(verifyChain('northstar', relabelled), 'LINK_BROKEN');
});

test('client clock skew is reported as a warning, not a break', () => {
  const { incident, events } = buildDemo();
  const r = verifyChain(incident, events);
  assert.equal(r.ok, true);
  assert.ok(codes(r).has('CLOCK_SKEW'));
});

// ------------------------------------------------------------ input hygiene

test('rejects metadata that would leak a secret into evidence', () => {
  assert.throws(() => checkMetadata({ password: 'Fall2025!' }), /secret/);
  assert.throws(() => checkMetadata({ login: { totp_code: '123456' } }), /secret/);
  assert.throws(() => checkMetadata({ apiKey: 'x' }), /secret/);
});

test('rejects malformed or oversized metadata', () => {
  assert.throws(() => checkMetadata([] as unknown as Record<string, unknown>), /object/);
  assert.throws(() => checkMetadata({ note: 'x'.repeat(3000) }), /exceeds/);
  assert.equal(checkMetadata({ note: '\uD800' }), '{"note":"\\ud800"}'); // JSON escapes it safely
  assert.equal(checkMetadata({ note: 'café   ✓' }), '{"note":"café   ✓"}');
});

test('rejects unknown actions and oversized ids, and writes nothing', () => {
  const store = makeDb();
  const ctx = ctxFor(store, ident('a1'), 1n);
  assert.throws(() => appendEvent(ctx, { incidentId: 'inc-1', action: 'DROP_TABLE' as never, entityType: 'x', entityId: 'y' }), /unknown/);
  assert.throws(() => appendEvent(ctx, { incidentId: 'Northstar Retail', action: 'EVIDENCE_ADDED', entityType: 'x', entityId: 'y' }), /incident id/);
  assert.throws(() => appendEvent(ctx, { incidentId: '', action: 'EVIDENCE_ADDED', entityType: 'x', entityId: 'y' }), /incident id/);
  assert.throws(() => appendEvent(ctx, { incidentId: 'inc-1', action: 'EVIDENCE_ADDED', entityType: 'x', entityId: 'y'.repeat(200) }), /too long/);
  assert.throws(() => appendEvent(ctx, { incidentId: 'inc-1', action: 'EVIDENCE_ADDED', entityType: 'x', entityId: 'bad\uDC00' }), /Unicode/);
  assert.equal(store.events.length, 0);
  assert.equal(store.heads.size, 0);
});

// ------------------------------------------------------------ speed

test('logging stays fast: 5,000 appends + full verify', () => {
  const store = makeDb();
  const who = ident('a1');
  const t0 = performance.now();
  for (let i = 1; i <= 5000; i++) {
    appendEvent(ctxFor(store, who, BigInt(i)), { incidentId: 'inc-1', action: 'MESSAGE_SENT', entityType: 'message', entityId: i, metadata: { chars: 40 } });
  }
  const t1 = performance.now();
  const r = verifyChain('inc-1', eventsOf(store, 'inc-1'), { head: headOf(store, 'inc-1') });
  const t2 = performance.now();
  assert.equal(r.ok, true);
  console.log(`    append: ${(((t1 - t0) / 5000) * 1000).toFixed(1)} µs/event · verify 5,000: ${(t2 - t1).toFixed(0)} ms`);
});
