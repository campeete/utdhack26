import { tierOf, type Snapshot } from '../../shared/contracts';
import type { IncidentData } from './interface';
import { createFixture } from './fixtures';
import { confirmReview, resolveDecision } from '../../shared/review';
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
  const identity = { name: 'Morgan Patel', roles: ['tier3'], authenticated: false };
  let data = createFixture();
  const listeners = new Set<(data: Snapshot) => void>();
  const copy = () => structuredClone(data);
  const publish = () => { const snapshot = copy(); listeners.forEach(l => l(snapshot)); };
  const requireTier = (min: number) => { if (tierOf(identity.roles) < min) throw new Error(`Needs Tier ${min} or higher.`); };
  const requireReviewer = () => { if (!identity.roles.some(r => (REVIEW_ROLES as readonly string[]).includes(r))) throw new Error('Only incident members can review suggestions.'); };
  // Runs outside the request, the way a server-side worker would.
  function runPending(proposalId: string) {
    let request: ReassessmentRequest;
    try { request = buildReassessmentRequest(data, proposalId); } catch { return; }
    setTimeout(() => {
      reassess(request)
        .then(raw => raw, (e: Error) => ({ kind: 'error', message: e.message }))
        .then(raw => { data = recordReassessment(data, proposalId, request.requestId, raw, 'Nora (Nemotron, synthetic stand-in)', new Date().toISOString(), 'synthetic'); publish(); });
    }, delayMs);
  }
  return {
    mode: 'fixture',
    identity,
    async load() { return copy(); },
    async resolveDecision(id) { requireReviewer(); data = resolveDecision(data, id, actor, new Date().toISOString()); return copy(); },
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
      if (tierOf(identity.roles) < 2) throw new Error('Only Tier 2 or Tier 3 can approve a fix.');
      data = { ...data, findings: (data.findings ?? []).map(f => f.id === id && f.state === 'open' ? { ...f, state: 'approved' as const, decidedBy: actor, decidedAt: new Date().toISOString(), version: f.version + 1 } : f) };
      return copy();
    },
    async dismissFinding(id, feedback) {
      requireReviewer();
      if (feedback.length > 2000) throw new Error('Keep feedback under 2,000 characters.');
      data = { ...data, findings: (data.findings ?? []).map(f => f.id === id && f.state === 'open' ? { ...f, state: 'dismissed' as const, dismissalFeedback: feedback.trim(), decidedBy: actor, decidedAt: new Date().toISOString(), version: f.version + 1 } : f) };
      return copy();
    },
    // ---- Team actions: local-only stand-ins for the module's reducers. ----
    async admitMember(memberId, tier) {
      requireTier(3);
      if (data.members.some(m => m.id === memberId && m.active)) throw new Error('Already an active member.');
      data = { ...data, members: [...data.members, { id: memberId, incidentId: data.incident.id, version: 1, name: `Responder ${memberId.slice(0, 6)}`, roles: [tier], active: true }] };
      return copy();
    },
    async setMemberTier(memberId, tier) {
      requireTier(3);
      data = { ...data, members: data.members.map(m => m.id === memberId ? { ...m, roles: [tier], version: m.version + 1 } : m) };
      return copy();
    },
    async revokeMember(memberId) {
      requireTier(3);
      data = { ...data, members: data.members.map(m => m.id === memberId ? { ...m, active: false, version: m.version + 1 } : m) };
      return copy();
    },
    async addEvidence({ title, source, text }) {
      requireTier(1);
      if (!title.trim() || !text.trim()) throw new Error('Add a title and the evidence text.');
      const id = `E-${String(data.evidence.length + 100).padStart(3, '0')}`;
      const now = new Date().toISOString();
      data = { ...data, evidence: [...data.evidence, { id, incidentId: data.incident.id, version: 1, title: title.trim(), sourceId: '', text: text.trim(), standing: 'reported', eventTime: now, recordedAt: now }] };
      void source;
      return copy();
    },
    async recordDecision({ title, assumption, evidenceIds }) {
      requireTier(1);
      if (!title.trim() || !assumption.trim()) throw new Error('Add the decision and the assumption it rests on.');
      const id = `D-${String(data.decisions.length + 100).padStart(3, '0')}`;
      data = { ...data, decisions: [...data.decisions, { id, incidentId: data.incident.id, version: 1, title: title.trim(), rationale: '', assumption: assumption.trim(), evidenceIds, owner: actor, state: 'draft' }] };
      return copy();
    },
    async approveDecision(decisionId) {
      requireTier(2);
      data = { ...data, decisions: data.decisions.map(d => d.id === decisionId ? { ...d, state: 'approved' as const, approvedAt: new Date().toISOString(), version: d.version + 1 } : d) };
      return copy();
    },
    async assignTask(decisionId, memberId, title) {
      requireTier(2);
      const member = data.members.find(m => m.id === memberId && m.active);
      if (!member) throw new Error('Assign the task to an active member of this incident.');
      data = { ...data, tasks: [...data.tasks, { id: `T-${data.tasks.length + 1}`, incidentId: data.incident.id, version: 1, proposalId: '', decisionId, title: title.trim(), owner: member.name, ownerId: member.id, state: 'open' }] };
      return copy();
    },
    async acceptTask(taskId) {
      data = { ...data, tasks: data.tasks.map(t => t.id === taskId && t.owner === identity.name ? { ...t, state: 'accepted' as const, version: t.version + 1 } : t) };
      return copy();
    },
    async resolveTask(taskId) {
      data = { ...data, tasks: data.tasks.map(t => t.id === taskId && t.owner === identity.name ? { ...t, state: 'resolved' as const, version: t.version + 1 } : t) };
      return copy();
    },
    async undoFinding(id) {
      if (tierOf(identity.roles) < 2) throw new Error('Only Tier 2 or Tier 3 can undo an automatic fix.');
      data = { ...data, findings: (data.findings ?? []).map(f => f.id === id && f.state === 'auto_fixed' ? { ...f, state: 'undone' as const, decidedBy: actor, decidedAt: new Date().toISOString(), version: f.version + 1 } : f) };
      return copy();
    },
    async sendMessage(evidenceId, recipientId, text) {
      if (!text.trim() || text.length > 2000) throw new Error('Use 1–2,000 characters.');
      if (evidenceId && !data.evidence.some(e => e.id === evidenceId)) throw new Error('That evidence item no longer exists.');
      if (recipientId && !data.members.some(m => m.id === recipientId && m.active && m.name !== identity.name)) throw new Error('Choose an active teammate.');
      data = { ...data, messages: [...data.messages, { id: crypto.randomUUID(), incidentId: data.incident.id, evidenceId, recipientId, version: 1, author: actor, text: text.trim(), at: new Date().toISOString() }] };
      return copy();
    },
  };
}
