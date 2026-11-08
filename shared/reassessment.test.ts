import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from '../src/data/fixtures.ts';
import { confirmReview } from './review.ts';
import { buildReassessmentRequest, dismissProposal, parseReassessmentResult, proposalForEvidence, recordReassessment, retryReassessment } from './reassessment.ts';

const at = '2026-11-07T23:30:00.000Z';
const later = '2026-11-07T23:31:00.000Z';
const reviewer = 'Morgan Patel';
const revision = (excerpt: string) => JSON.stringify({ kind: 'revision', excerpt, explanation: 'Narrowed to what the restore test did not check.', verification: 'Confirm backup timing.' });
const secondSentence = 'The test did not assess whether the backup predates initial access or contains compromised artifacts.';

test('empty and whitespace feedback dismisses without requesting a reassessment', () => {
  for (const feedback of ['', '   \n\t ']) {
    const next = dismissProposal(createFixture(), 'P-001', feedback, reviewer, at);
    const p = next.proposals[0];
    assert.equal(p.state, 'dismissed');
    assert.deepEqual(p.dismissal, { reviewer, at, feedback: '' });
    assert.equal(p.reassessment, undefined);
    assert.throws(() => buildReassessmentRequest(next, 'P-001'), /No reassessment/);
  }
});

test('feedback dismisses, keeps the original suggestion, and requests a reassessment', () => {
  const original = createFixture();
  const next = dismissProposal(original, 'P-001', '  Backup timing was verified by the vendor.  ', reviewer, at);
  const p = next.proposals[0];
  assert.equal(p.state, 'dismissed');
  assert.deepEqual(p.dismissal, { reviewer, at, feedback: 'Backup timing was verified by the vendor.' });
  assert.equal(p.reassessment?.state, 'requested');
  for (const key of ['excerpt', 'explanation', 'verification', 'origin', 'evidenceId'] as const) assert.equal(p[key], original.proposals[0][key]);
  assert.deepEqual(next.decisions, original.decisions);
  assert.deepEqual(next.briefings, original.briefings);
});

test('a duplicate dismissal is a no-op and cannot queue a second request', () => {
  const once = dismissProposal(createFixture(), 'P-001', 'Already verified.', reviewer, at);
  assert.equal(dismissProposal(once, 'P-001', 'Different text.', 'someone else', later), once);
});

test('dismissal rejects non-pending suggestions and oversized feedback', () => {
  const accepted = confirmReview(createFixture(), 'P-001', 'Verify independently.', reviewer, at);
  assert.throws(() => dismissProposal(accepted, 'P-001', '', reviewer, at), /no longer pending/);
  assert.throws(() => dismissProposal(createFixture(), 'P-001', 'x'.repeat(2001), reviewer, at), /under 2,000/);
  assert.throws(() => dismissProposal(createFixture(), 'missing', '', reviewer, at), /not found/);
});

test('the request carries the stored evidence, original suggestion and feedback', () => {
  const data = dismissProposal(createFixture(), 'P-001', 'Vendor confirmed timing.', reviewer, at);
  const request = buildReassessmentRequest(data, 'P-001');
  assert.equal(request.evidence?.text, data.evidence[0].text);
  assert.equal(request.originalSuggestion.excerpt, data.proposals[0].excerpt);
  assert.equal(request.dismissal.feedback, 'Vendor confirmed timing.');
  assert.deepEqual(request.decisions.map(d => d.id), ['D-001']);
});

test('a revision becomes a linked pending suggestion that a human can confirm', () => {
  const data = dismissProposal(createFixture(), 'P-001', 'Vendor confirmed timing.', reviewer, at);
  const requestId = data.proposals[0].reassessment!.requestId;
  const next = recordReassessment(data, 'P-001', requestId, revision(secondSentence), 'Nemotron', later);
  const original = next.proposals[0]; const revised = next.proposals[1];
  assert.equal(original.state, 'dismissed');
  assert.deepEqual(original.dismissal, data.proposals[0].dismissal);
  assert.equal(original.reassessment?.state, 'revised');
  assert.equal(original.reassessment?.revisionId, revised.id);
  assert.equal(revised.state, 'pending');
  assert.equal(revised.revisionOf, 'P-001');
  assert.equal(revised.origin, 'nemotron');
  assert.equal(proposalForEvidence(next, 'E-002', 'D-001')?.id, revised.id);
  const confirmed = confirmReview(next, revised.id, 'Reviewed the revision.', reviewer, later);
  assert.equal(confirmed.decisions[0].state, 'needs_review');
});

test('"No further review suggested" is a valid result', () => {
  const data = dismissProposal(createFixture(), 'P-001', 'Vendor confirmed timing.', reviewer, at);
  const next = recordReassessment(data, 'P-001', data.proposals[0].reassessment!.requestId, { kind: 'no_further_review', note: 'Feedback resolves it.' }, 'Nemotron', later);
  assert.equal(next.proposals[0].reassessment?.state, 'no_further_review');
  assert.equal(next.proposals.length, 1);
  assert.equal(next.proposals[0].state, 'dismissed');
});

test('a failure keeps the dismissal, and Retry queues a fresh attempt', () => {
  const data = dismissProposal(createFixture(), 'P-001', 'Vendor confirmed timing.', reviewer, at);
  const first = data.proposals[0].reassessment!.requestId;
  const failed = recordReassessment(data, 'P-001', first, { kind: 'error', message: 'Service unavailable.' }, 'Nemotron', later);
  assert.equal(failed.proposals[0].state, 'dismissed');
  assert.deepEqual(failed.proposals[0].dismissal, data.proposals[0].dismissal);
  assert.equal(failed.proposals[0].reassessment?.state, 'failed');
  const retried = retryReassessment(failed, 'P-001', reviewer, later);
  assert.equal(retried.proposals[0].reassessment?.state, 'requested');
  assert.equal(retried.proposals[0].reassessment?.attempt, 2);
  assert.notEqual(retried.proposals[0].reassessment?.requestId, first);
  assert.equal(retryReassessment(retried, 'P-001', reviewer, later), retried, 'retry while running is a no-op');
  assert.equal(recordReassessment(retried, 'P-001', first, revision(secondSentence), 'Nemotron', later), retried, 'a late reply to the old request is ignored');
});

test('invalid model output and quotes not in the evidence are recorded as failures', () => {
  const data = dismissProposal(createFixture(), 'P-001', 'Vendor confirmed timing.', reviewer, at);
  const id = data.proposals[0].reassessment!.requestId;
  for (const raw of ['not json', { kind: 'revision', excerpt: 'x' }, revision('AI confirmed the backup is compromised.')]) {
    const next = recordReassessment(data, 'P-001', id, raw, 'Nemotron', later);
    assert.equal(next.proposals[0].reassessment?.state, 'failed');
    assert.equal(next.proposals.length, 1);
  }
  assert.throws(() => parseReassessmentResult({ kind: 'approve_everything' }), /unexpected format/);
});
