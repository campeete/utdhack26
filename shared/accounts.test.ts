import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { northstarAccounts } from '../src/data/northstar-accounts.ts';
import { createFixture } from '../src/data/fixtures.ts';

const SECRET_KEYS = /pass(word)?|hash|salt|totp|secret|token|username|email/i;
const raw = JSON.parse(readFileSync(new URL('../demo-data/people.json', import.meta.url), 'utf8')).people;

test('generated accounts carry no secret or identifying fields', () => {
  for (const a of northstarAccounts) for (const key of Object.keys(a)) assert.doesNotMatch(key, SECRET_KEYS, `${a.id}.${key}`);
  const secrets = raw.flatMap((p: Record<string, string>) => [p.password_leaked, p.password_hash, p.salt_hex, p.totp_secret, p.email].filter(Boolean));
  const text = JSON.stringify(northstarAccounts);
  for (const s of secrets) assert.ok(!text.includes(s), 'a secret value from people.json reached the frontend');
});

test('generated accounts match the dataset (regenerate with tools/export_people_fixture.py)', () => {
  assert.equal(northstarAccounts.length, raw.length);
  assert.equal(northstarAccounts.filter(a => a.usedByAttacker).length, raw.filter((p: { used_by_attacker: boolean }) => p.used_by_attacker).length);
});

test('fixture accounts are incident-bound and summarized in scope and evidence', () => {
  const data = createFixture();
  assert.ok(data.accounts?.every(a => a.incidentId === data.incident.id));
  assert.ok(data.scope.some(s => s.id === 'S-4'));
  assert.ok(data.evidence.some(e => e.id === 'E-007' && e.sourceId === 'source-credentials'));
});
