import type { Activity, Proposal, Snapshot } from './contracts.ts';

// Dismissal and Nemotron reassessment rules. Like confirmReview, these run
// authoritatively inside the Spacetime reducers; the fixture adapter calls the
// same functions so the demo follows identical rules.

/** Same roles that may confirm a review (see acceptReview). Dismissal adds no new permission. */
export const REVIEW_ROLES = ['tier1', 'tier2', 'tier3'] as const;
export const FEEDBACK_MAX = 2000;
const EXPLANATION_MAX = 2000;
const VERIFICATION_MAX = 500;

/** Whitespace-only feedback counts as no feedback: the dismissal never involves AI. */
export const normalizeFeedback = (feedback: string) => feedback.trim();
export const requestIdFor = (proposalId: string, attempt: number) => `${proposalId}:attempt-${attempt}`;

function find(data: Snapshot, proposalId: string) {
  const proposal = data.proposals.find(p => p.id === proposalId && p.incidentId === data.incident.id);
  if (!proposal) throw new Error('Suggestion not found.');
  return proposal;
}
function note(data: Snapshot, id: string, text: string, actor: string, at: string): Activity[] {
  return [{ id, incidentId: data.incident.id, version: 1, text, actor, at }, ...data.activity];
}
function replace(data: Snapshot, next: Proposal, extra: Proposal[] = []): Proposal[] {
  return [...data.proposals.map(p => p.id === next.id ? next : p), ...extra];
}

/**
 * Dismisses a pending suggestion. The original suggestion's fields are kept
 * as they were; the reviewer, time and feedback are recorded alongside them.
 * Non-empty feedback also queues a reassessment request. A repeat dismissal is
 * a no-op, so a double submit cannot create a second record or request.
 */
export function dismissProposal(data: Snapshot, proposalId: string, feedback: string, actor: string, at: string): Snapshot {
  const proposal = find(data, proposalId);
  if (proposal.state === 'dismissed') return data;
  if (proposal.state !== 'pending') throw new Error('This suggestion is no longer pending.');
  if (feedback.length > FEEDBACK_MAX) throw new Error(`Keep feedback under ${FEEDBACK_MAX.toLocaleString('en-US')} characters.`);
  const text = normalizeFeedback(feedback);
  const next: Proposal = {
    ...proposal, state: 'dismissed', version: proposal.version + 1,
    dismissal: { reviewer: actor, at, feedback: text },
    ...(text ? { reassessment: { state: 'requested' as const, requestId: requestIdFor(proposal.id, 1), attempt: 1, requestedAt: at } } : {}),
  };
  return {
    ...data, proposals: replace(data, next),
    activity: note(data, `dismiss:${proposal.id}`, text ? `Suggestion ${proposal.id} dismissed with feedback; Nora reassessment requested. ${text}` : `Suggestion ${proposal.id} dismissed without feedback.`, actor, at),
  };
}

/** Re-queues a failed reassessment. Anything other than a failure is left alone. */
export function retryReassessment(data: Snapshot, proposalId: string, actor: string, at: string): Snapshot {
  const proposal = find(data, proposalId);
  const current = proposal.reassessment;
  if (!current || current.state !== 'failed') return data;
  const attempt = current.attempt + 1;
  const next: Proposal = { ...proposal, version: proposal.version + 1, reassessment: { state: 'requested', requestId: requestIdFor(proposal.id, attempt), attempt, requestedAt: at } };
  return { ...data, proposals: replace(data, next), activity: note(data, `retry:${next.reassessment!.requestId}`, `Nora reassessment of ${proposal.id} requested again (attempt ${attempt}).`, actor, at) };
}

/**
 * Everything Nemotron needs, assembled from stored records rather than from
 * the browser, so a client cannot alter the evidence the model sees.
 */
export function buildReassessmentRequest(data: Snapshot, proposalId: string) {
  const proposal = find(data, proposalId);
  if (proposal.reassessment?.state !== 'requested' || !proposal.dismissal) throw new Error('No reassessment is pending for this suggestion.');
  const evidence = data.evidence.find(e => e.id === proposal.evidenceId && e.incidentId === proposal.incidentId);
  const source = data.sources.find(s => s.id === proposal.sourceId && s.incidentId === proposal.incidentId);
  const decisions = data.decisions.filter(d => proposal.decisionVersions[d.id] !== undefined);
  const briefings = data.briefings.filter(b => proposal.briefingVersions[b.id] !== undefined);
  return {
    requestId: proposal.reassessment.requestId,
    incidentId: proposal.incidentId,
    originalSuggestion: { id: proposal.id, excerpt: proposal.excerpt, explanation: proposal.explanation, verification: proposal.verification, origin: proposal.origin },
    dismissal: { feedback: proposal.dismissal.feedback, reviewer: proposal.dismissal.reviewer, at: proposal.dismissal.at },
    evidence: evidence && { id: evidence.id, title: evidence.title, text: evidence.text, standing: evidence.standing, eventTime: evidence.eventTime, recordedAt: evidence.recordedAt },
    source: source && { id: source.id, label: source.label, trust: source.trust, reason: source.reason },
    decisions: decisions.map(d => ({ id: d.id, title: d.title, assumption: d.assumption, state: d.state })),
    briefings: briefings.map(b => ({ id: b.id, title: b.title, state: b.state })),
    instructions: 'Reassess the dismissed suggestion using the reviewer feedback. Reply with JSON: {"kind":"revision","excerpt":<exact quote from evidence.text>,"explanation":...,"verification":...} or {"kind":"no_further_review","note":...}.',
  };
}
export type ReassessmentRequest = ReturnType<typeof buildReassessmentRequest>;

export type ReassessmentResult =
  | { kind: 'revision'; excerpt: string; explanation: string; verification: string }
  | { kind: 'no_further_review'; note: string }
  | { kind: 'error'; message: string };

const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;

/** Accepts only the shapes above; anything else from the model is treated as a failure. */
export function parseReassessmentResult(raw: unknown): ReassessmentResult {
  const value = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw;
  if (!value || typeof value !== 'object') throw new Error('Nora returned an unreadable result.');
  const r = value as Record<string, unknown>;
  if (r.kind === 'no_further_review') return { kind: 'no_further_review', note: text(r.note, EXPLANATION_MAX) ?? '' };
  if (r.kind === 'error') return { kind: 'error', message: text(r.message, 300) ?? 'Reassessment failed.' };
  if (r.kind === 'revision') {
    const excerpt = text(r.excerpt, EXPLANATION_MAX); const explanation = text(r.explanation, EXPLANATION_MAX); const verification = text(r.verification, VERIFICATION_MAX);
    if (excerpt && explanation && verification) return { kind: 'revision', excerpt, explanation, verification };
  }
  throw new Error('Nora returned a result in an unexpected format.');
}

function dependencyVersions(data: Snapshot, proposal: Proposal) {
  const evidenceIds = new Set(data.evidence.filter(e => e.sourceId === proposal.sourceId && e.incidentId === proposal.incidentId).map(e => e.id));
  const decisions = data.decisions.filter(d => d.incidentId === proposal.incidentId && (d.state === 'approved' || d.state === 'needs_review') && d.evidenceIds.some(id => evidenceIds.has(id)));
  const briefings = data.briefings.filter(b => b.incidentId === proposal.incidentId && b.decisionIds.some(id => decisions.some(d => d.id === id)));
  return { decisionVersions: Object.fromEntries(decisions.map(d => [d.id, d.version])), briefingVersions: Object.fromEntries(briefings.map(b => [b.id, b.version])) };
}

/**
 * Records the outcome for one request. A result for an old or unknown request
 * is ignored, so a slow or repeated reply cannot overwrite a newer attempt.
 * A revision becomes a new pending suggestion linked to the original, and a
 * human still has to review it. The dismissal itself is never undone.
 */
export function recordReassessment(data: Snapshot, proposalId: string, requestId: string, raw: unknown, actor: string, at: string, origin: Proposal['origin'] = 'nemotron'): Snapshot {
  const proposal = find(data, proposalId);
  const current = proposal.reassessment;
  if (!current || current.state !== 'requested' || current.requestId !== requestId) return data;
  let result: ReassessmentResult;
  try { result = parseReassessmentResult(raw); } catch (e) { result = { kind: 'error', message: (e as Error).message }; }
  const evidence = data.evidence.find(e => e.id === proposal.evidenceId && e.incidentId === proposal.incidentId);
  if (result.kind === 'revision' && !evidence?.text.includes(result.excerpt)) result = { kind: 'error', message: 'Nora quoted text that is not in the evidence, so the revision was rejected.' };
  const done = { ...current, completedAt: at };
  if (result.kind === 'error') {
    const next: Proposal = { ...proposal, version: proposal.version + 1, reassessment: { ...done, state: 'failed', error: result.message } };
    return { ...data, proposals: replace(data, next), activity: note(data, `reassess:${requestId}`, `Nora reassessment of ${proposal.id} failed. The dismissal stands.`, actor, at) };
  }
  if (result.kind === 'no_further_review') {
    const next: Proposal = { ...proposal, version: proposal.version + 1, reassessment: { ...done, state: 'no_further_review', note: result.note } };
    return { ...data, proposals: replace(data, next), activity: note(data, `reassess:${requestId}`, `Nora reassessed ${proposal.id}: no further review suggested.`, actor, at) };
  }
  const revisionId = `${proposal.id}-R${current.attempt}`;
  if (data.proposals.some(p => p.id === revisionId)) return data;
  const revision: Proposal = {
    id: revisionId, incidentId: proposal.incidentId, version: 1,
    sourceId: proposal.sourceId, sourceVersion: data.sources.find(s => s.id === proposal.sourceId)?.version ?? proposal.sourceVersion,
    evidenceId: proposal.evidenceId, evidenceVersion: evidence!.version, ...dependencyVersions(data, proposal),
    excerpt: result.excerpt, explanation: result.explanation, verification: result.verification,
    origin, state: 'pending', revisionOf: proposal.id,
  };
  const next: Proposal = { ...proposal, version: proposal.version + 1, reassessment: { ...done, state: 'revised', revisionId } };
  return { ...data, proposals: replace(data, next, [revision]), activity: note(data, `reassess:${requestId}`, `Nora proposed revised suggestion ${revisionId} for human review.`, actor, at) };
}

/** The suggestion to show for an evidence item: an open one first, otherwise the newest. */
export function proposalForEvidence(data: Snapshot, evidenceId: string | null | undefined, decisionId?: string | null) {
  const matches = data.proposals.filter(p => p.evidenceId === evidenceId && (!decisionId || p.decisionVersions[decisionId] !== undefined));
  return matches.find(p => p.state === 'pending') ?? matches[matches.length - 1];
}
