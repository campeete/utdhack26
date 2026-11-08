import type { Impact, Proposal, Snapshot } from './contracts.ts';

export function previewImpact(data: Snapshot, proposal: Proposal): Impact {
  const source = data.sources.find(s => s.id === proposal.sourceId && s.incidentId === proposal.incidentId);
  const evidence = data.evidence.find(e => e.id === proposal.evidenceId && e.incidentId === proposal.incidentId);
  if (!source || !evidence || evidence.sourceId !== source.id || !evidence.text.includes(proposal.excerpt)) throw new Error('Proposal references invalid evidence.');
  if (source.trust !== 'under_review' || source.version !== proposal.sourceVersion || evidence.version !== proposal.evidenceVersion) throw new Error('Proposal is stale. Refresh before reviewing.');
  const affectedEvidence = new Set(data.evidence.filter(e => e.sourceId === source.id && e.incidentId === proposal.incidentId).map(e => e.id));
  const decisions = data.decisions.filter(d => d.incidentId === proposal.incidentId && (d.state === 'approved' || d.state === 'needs_review') && d.evidenceIds.some(id => affectedEvidence.has(id)));
  const briefings = data.briefings.filter(b => b.incidentId === proposal.incidentId && b.decisionIds.some(id => decisions.some(d => d.id === id)));
  if (decisions.some(d => proposal.decisionVersions[d.id] !== d.version) || briefings.some(b => proposal.briefingVersions[b.id] !== b.version)) throw new Error('Dependencies changed. Refresh the proposal before confirming.');
  return { decisionIds: decisions.map(d => d.id), briefingIds: briefings.map(b => b.id) };
}

// Shared deterministic rule, executed authoritatively inside the Spacetime reducer.
// The fixture adapter calls it only to demonstrate the same transition locally.
export function confirmReview(data: Snapshot, proposalId: string, reason: string, actor: string, at: string): Snapshot {
  const proposal = data.proposals.find(p => p.id === proposalId && p.incidentId === data.incident.id);
  if (!proposal) throw new Error('Proposal not found.');
  if (proposal.state === 'accepted') return data;
  if (proposal.state !== 'pending') throw new Error('This proposal is no longer pending.');
  if (reason.trim().length < 8 || reason.length > 2000) throw new Error('Add a review reason of 8–2,000 characters.');
  const impact = previewImpact(data, proposal);
  return {
    ...data,
    proposals: data.proposals.map(p => p.id === proposal.id ? { ...p, state: 'accepted', version: p.version + 1 } : p),
    decisions: data.decisions.map(d => impact.decisionIds.includes(d.id) ? { ...d, state: 'needs_review', version: d.version + 1 } : d),
    briefings: data.briefings.map(b => impact.briefingIds.includes(b.id) ? { ...b, state: 'outdated', version: b.version + 1 } : b),
    tasks: [...data.tasks, ...impact.decisionIds.filter(id => !data.tasks.some(t => t.proposalId === proposal.id && t.decisionId === id)).map(id => ({ id: `${proposal.id}:${id}`, incidentId: proposal.incidentId, version: 1, proposalId: proposal.id, decisionId: id, title: proposal.verification, owner: data.decisions.find(d => d.id === id)!.owner, state: 'open' as const }))],
    activity: [{ id: `review:${proposal.id}`, incidentId: proposal.incidentId, version: 1, text: `Source review confirmed. ${reason.trim()}`, actor, at }, ...data.activity],
  };
}

export function resolveDecision(data: Snapshot, decisionId: string, actor: string, at: string): Snapshot {
  const decision = data.decisions.find(d => d.id === decisionId && d.incidentId === data.incident.id);
  if (!decision) throw new Error('Decision not found.');
  if (decision.state === 'closed') return data;
  return {
    ...data,
    decisions: data.decisions.map(d => d.id === decision.id ? { ...d, state: 'closed', version: d.version + 1 } : d),
    activity: [{ id: `resolve:${decision.id}`, incidentId: decision.incidentId, version: 1, text: `Decision ${decision.id} resolved.`, actor, at }, ...data.activity],
  };
}
