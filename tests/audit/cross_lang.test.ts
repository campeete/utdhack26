/** The TypeScript writer and the independent Python verifier must agree,
 *  byte for byte, on clean chains and on every attack. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportChain } from '../../spacetimedb/src/audit/chain';
import { appendEvent } from '../../spacetimedb/src/audit/append';
import { buildDemo } from '../../tools/make_demo_chain';
import { ctxFor, eventsOf, headOf, ident, makeDb } from './fake_ctx';

const dir = mkdtempSync(join(tmpdir(), 'audit-'));
const py = (args: string[]) => spawnSync('python3', args, { encoding: 'utf8' });
const verify = (file: string, ...extra: string[]) => {
  const r = py(['tools/verify_audit.py', file, '--json', ...extra]);
  return { exit: r.status, out: r.status === 2 ? null : JSON.parse(r.stdout) };
};

const demo = buildDemo(7n);
const clean = join(dir, 'clean.json');
writeFileSync(clean, exportChain(demo.incident, demo.events, demo.head));
const other = join(dir, 'other.json');
const b = buildDemo(8n);
writeFileSync(other, exportChain(b.incident, b.events, b.head));

test('Python verifies the chain TypeScript wrote', () => {
  const r = verify(clean, '--anchor', `5:${demo.events[4].hash}`);
  assert.equal(r.exit, 0);
  assert.equal(r.out.ok, true);
  assert.equal(r.out.head_hash, demo.head.hash);
});

test('Python agrees on non-ASCII and edge-case text', () => {
  const store = makeDb();
  const notes = ['café', 'emoji 🔒', 'line\nbreak', 'tab\tquote"back\\slash', '  ', 'ctrl\u0001\u001f', 'zh 中文'];
  notes.forEach((note, i) =>
    appendEvent(ctxFor(store, ident('a1'), BigInt(i + 1)), { incidentId: 9n, action: 'EVIDENCE_ADDED', entityType: 'evidence', entityId: `E${i}`, metadata: { note } }));
  const f = join(dir, 'unicode.json');
  writeFileSync(f, exportChain(9n, eventsOf(store, 9n), headOf(store, 9n)));
  assert.equal(verify(f).exit, 0);
});

const attacks: [string, string[], string[]][] = [
  ['edit', ['--seq', '13'], ['HASH_MISMATCH']],
  ['edit-rehash', ['--seq', '13'], ['LINK_BROKEN']],
  ['delete', ['--seq', '20'], ['SEQ_GAP', 'LINK_BROKEN']],
  ['reorder', ['--seq', '6'], ['TIME_REVERSED']],
  ['splice', ['--seq', '5', '--other', other], ['WRONG_INCIDENT']],
];
for (const [attack, args, want] of attacks) {
  test(`Python detects: ${attack}`, () => {
    const out = join(dir, `${attack}.json`);
    execFileSync('python3', ['tools/tamper_audit.py', clean, attack, ...args, '-o', out]);
    const r = verify(out);
    assert.equal(r.exit, 1);
    const got = new Set(r.out.findings.map((f: { code: string }) => f.code));
    for (const w of want) assert.ok(got.has(w), `${attack}: expected ${w}, got ${[...got]}`);
  });
}

for (const attack of ['truncate', 'rewrite']) {
  test(`Python: ${attack} passes alone, caught by a witness anchor`, () => {
    const out = join(dir, `${attack}.json`);
    execFileSync('python3', ['tools/tamper_audit.py', clean, attack, '--seq', '15', '-o', out]);
    assert.equal(verify(out).exit, 0, 'documented limit without anchors');
    const r = verify(out, '--anchor', `18:${demo.events[17].hash}`);
    assert.equal(r.exit, 1);
    assert.ok(r.out.findings.some((f: { code: string }) => f.code === 'ANCHOR_MISMATCH'));
  });
}

test('unreadable input exits 2, not "intact"', () => {
  const f = join(dir, 'bad.json');
  writeFileSync(f, '{"format":"something-else","events":[]}');
  assert.equal(verify(f).exit, 2);
});
