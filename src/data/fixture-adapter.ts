import type { Snapshot } from '../../shared/contracts';
import type { IncidentData } from './interface';
import { createFixture } from './fixtures';
import { confirmReview } from '../../shared/review';
import { buildReassessmentRequest, dismissProposal, recordReassessment, retryReassessment, REVIEW_ROLES, type ReassessmentRequest } from '../../shared/reassessment';

/** Stands in for the server-side Nemotron worker. Returns the model's raw reply. */
export type Reassessor = (request: ReassessmentRequest) => Promise<unknown>;

// A deterministic, clearly synthetic reply: it quotes a different sentence of
// the same evidence, so the demo shows a linked revision without any AI.
export const syntheticReassessor: Reassessor = async request => {
  const sentences = (request.evidence?.text ?? '').match(/[^.!?]+[.!?]/g)?.map(s => s.trim()) ?? [];
  const excerpt = sentences.find(s => s !== request.originalSuggestion.excerpt) ?? sentences[0];
  return {
    kind: 'revision', excerpt,
    explanation: `Revised after reviewer feedback: “${request.dismissal.feedback.slice(0, 200)}”. The concern is narrowed to what the evidence leaves unverified. Synthetic stand-in; Nemotron is not connected.`,
    verification: 'Confirm what the original test did not assess before relying on it.',
  };
};
export const noFurtherReviewReassessor: Reassessor = async () => ({ kind: 'no_further_review', note: 'The feedback resolves the concern. Synthetic stand-in; Nemotron is not connected.' });
/** Fails the first attempt so the Retry path can be demonstrated. */
export function failOnceReassessor(then: Reassessor = syntheticReassessor): Reassessor {
  let failed = false;
  return async request => { if (!failed) { failed = true; throw new Error('The reassessment service did not respond.'); } return then(request); };
}

export function createFixtureAdapter(options: { reassess?: Reassessor; delayMs?: number } = {}): IncidentData {
  const reassess = options.reassess ?? syntheticReassessor;
  const delayMs = options.delayMs ?? 1600;
  const actor = 'Morgan Patel (fixture)';
  const identity = { name: 'Morgan Patel', roles: ['commander', 'analyst'], authenticated: false };
  let data = createFixture();
  const listeners = new Set<(data: Snapshot) => void>();
  const copy = () => structuredClone(data);
  const publish = () => { const snapshot = copy(); listeners.forEach(l => l(snapshot)); };
  const requireReviewer = () => { if (!identity.roles.some(r => (REVIEW_ROLES as readonly string[]).includes(r))) throw new Error('Only analysts and commanders can review suggestions.'); };
  // Runs outside the request, the way a server-side worker would.
  function runPending(proposalId: string) {
    let request: ReassessmentRequest;
    try { request = buildReassessmentRequest(data, proposalId); } catch { return; }
    setTimeout(() => {
      reassess(request)
        .then(raw => raw, (e: Error) => ({ kind: 'error', message: e.message }))
        .then(raw => { data = recordReassessment(data, proposalId, request.requestId, raw, 'Nora (synthetic)', new Date().toISOString(), 'synthetic'); publish(); });
    }, delayMs);
  }
  return {
    mode: 'fixture',
    identity,
    async load() { return copy(); },
    async confirm(id, reason) { requireReviewer(); data = confirmReview(data, id, reason, actor, new Date().toISOString()); return copy(); },
    async dismiss(id, feedback) {
      requireReviewer();
      const before = data;
      data = dismissProposal(data, id, feedback, actor, new Date().toISOString());
      if (data !== before) runPending(id);
      return copy();
    },
    async retryReassessment(id) {
      requireReviewer();
      const before = data;
      data = retryReassessment(data, id, actor, new Date().toISOString());
      if (data !== before) runPending(id);
      return copy();
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async approveFinding(id) {
      requireReviewer();
      data = { ...data, findings: (data.findings ?? []).map(f => f.id === id && f.state === 'open' ? { ...f, state: 'approved' as const, decidedBy: actor, decidedAt: new Date().toISOString(), version: f.version + 1 } : f) };
      return copy();
    },
    async dismissFinding(id, feedback) {
      requireReviewer();
      if (feedback.length > 2000) throw new Error('Keep feedback under 2,000 characters.');
      data = { ...data, findings: (data.findings ?? []).map(f => f.id === id && f.state === 'open' ? { ...f, state: 'dismissed' as const, dismissalFeedback: feedback.trim(), decidedBy: actor, decidedAt: new Date().toISOString(), version: f.version + 1 } : f) };
      return copy();
    },
    async undoFinding(id) {
      if (!identity.roles.includes('commander')) throw new Error('Only a commander can undo an automatic fix.');
      data = { ...data, findings: (data.findings ?? []).map(f => f.id === id && f.state === 'auto_fixed' ? { ...f, state: 'undone' as const, decidedBy: actor, decidedAt: new Date().toISOString(), version: f.version + 1 } : f) };
      return copy();
    },
    async sendMessage(evidenceId, recipientId, text) {
      if (!text.trim() || text.length > 2000) throw new Error('Use 1–2,000 characters.');
      if (!data.evidence.some(e => e.id === evidenceId)) throw new Error('Select an existing evidence item before sending a message.');
      const recipient = data.members.find(m => m.id === recipientId && m.active && m.name !== identity.name);
      if (!recipient) throw new Error('Choose an active teammate.');
      data = { ...data, messages: [...data.messages, { id: crypto.randomUUID(), incidentId: data.incident.id, evidenceId, recipientId, version: 1, author: actor, text: text.trim(), at: new Date().toISOString() }] };
      return copy();
    },
  };
}
