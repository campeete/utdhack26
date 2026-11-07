import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from '../src/data/fixtures.ts';
import { confirmReview, previewImpact } from './review.ts';
const at = '2026-11-07T19:00:00Z';
test('trust review affects only explicit dependencies; evidence and approval history stay intact', () => {
  const original = createFixture();
  assert.deepEqual(previewImpact(original, original.proposals[0]), { decisionIds: ['D-001'], briefingIds: ['B-001'] });
  const next = confirmReview(original, 'P-001', 'Verify the reporting account independently.', 'analyst', at);
  assert.equal(next.decisions[0].state, 'needs_review');
  assert.equal(next.briefings[0].state, 'outdated');
  assert.equal(next.tasks.length, 1);
  assert.deepEqual(next.evidence, original.evidence);
  assert.equal(next.decisions[0].approvedAt, original.decisions[0].approvedAt);
  assert.equal(next.decisions[0].rationale, original.decisions[0].rationale);
  assert.equal(next.briefings[0].text, original.briefings[0].text);
  assert.deepEqual(next.decisions.slice(1), original.decisions.slice(1));
  assert.equal(original.decisions[0].state, 'approved');
});
test('duplicate confirmation creates no duplicate task or event', () => {
  const once = confirmReview(createFixture(), 'P-001', 'Verify independently.', 'analyst', at);
  assert.equal(confirmReview(once, 'P-001', 'Verify independently.', 'analyst', at), once);
});
test('stale source, evidence, decision and briefing versions reject confirmation', () => {
  for (const key of ['sources', 'evidence', 'decisions', 'briefings'] as const) {
    const data = createFixture(); data[key][0].version++;
    assert.throws(() => confirmReview(data, 'P-001', 'Verify independently.', 'analyst', at), /stale|changed/);
  }
});
test('invalid excerpts, cross-incident links, missing records, dismissed proposals and short reasons are rejected', () => {
  const excerpt = createFixture(); excerpt.proposals[0].excerpt = 'AI confirmed breach';
  assert.throws(() => previewImpact(excerpt, excerpt.proposals[0]), /invalid evidence/);
  const cross = createFixture(); cross.evidence[0].incidentId = 'other-room';
  assert.throws(() => previewImpact(cross, cross.proposals[0]), /invalid evidence/);
  const dismissed = createFixture(); dismissed.proposals[0].state = 'dismissed';
  assert.throws(() => confirmReview(dismissed, 'P-001', 'Verify independently.', 'analyst', at), /pending/);
  assert.throws(() => confirmReview(createFixture(), 'missing', 'Verify independently.', 'analyst', at), /not found/);
  assert.throws(() => confirmReview(createFixture(), 'P-001', 'yes', 'analyst', at), /reason/);
});
test('unrelated evidence has no dependent decision impact', () => {
  const data = createFixture(); data.sources[2].trust = 'under_review';
  const p = { ...data.proposals[0], sourceId: 'source-printer', evidenceId: 'E-006', excerpt: data.evidence[2].text, decisionVersions: {}, briefingVersions: {} };
  assert.deepEqual(previewImpact(data, p), { decisionIds: [], briefingIds: [] });
});
