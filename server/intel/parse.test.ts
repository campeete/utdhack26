import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parseAttack, parseKev } from './parse.ts';

const kevEntry = (n: number) => ({ cveID: `CVE-2024-${String(1000 + n)}`, vendorProject: 'Vendor', product: 'Product', vulnerabilityName: 'Bug', dateAdded: '2024-01-01', knownRansomwareCampaignUse: n % 2 ? 'Known' : 'Unknown', notes: 'dropped' });

test('KEV keeps only the fields Nora uses', () => {
  const entries = parseKev({ vulnerabilities: Array.from({ length: 150 }, (_, i) => kevEntry(i)) });
  assert.equal(entries.length, 150);
  assert.deepEqual(Object.keys(entries[0]).sort(), ['cveID', 'dateAdded', 'knownRansomwareCampaignUse', 'product', 'vendorProject', 'vulnerabilityName']);
});

test('KEV rejects a short, empty or mostly malformed file', () => {
  assert.throws(() => parseKev({}), /missing/);
  assert.throws(() => parseKev({ vulnerabilities: [kevEntry(1)] }), /short/);
  assert.throws(() => parseKev({ vulnerabilities: Array.from({ length: 150 }, (_, i) => i < 20 ? { cveID: 'nope' } : kevEntry(i)) }), /malformed/);
});

test('ATT&CK rejects anything that is not a STIX bundle', () => {
  assert.throws(() => parseAttack({ objects: [] }), /not a STIX bundle/);
  assert.throws(() => parseAttack({ type: 'bundle', objects: [] }), /fewer techniques/);
});

const real = process.env.ATTACK_SAMPLE;
test('ATT&CK parses the real enterprise bundle', { skip: !real || !existsSync(real) }, () => {
  const techniques = parseAttack(JSON.parse(readFileSync(real!, 'utf8')));
  const brute = techniques.find(t => t.id === 'T1110');
  assert.equal(brute?.name, 'Brute Force');
  assert.ok(brute?.tactics.includes('credential-access'));
  assert.ok(techniques.some(t => t.id === 'T1078'), 'Valid Accounts is present');
  assert.ok(techniques.every(t => /^T\d{4}(\.\d{3})?$/.test(t.id)));
});
