import { useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, FilePlus2, Gavel } from 'lucide-react';
import type { Snapshot } from '../../shared/contracts';
import type { IncidentData } from '../data/interface';
import { focusContext, Modal, Status } from '../components/ui';
import { AddEvidence, RecordDecision } from './TeamActions';
import { IncidentConversation, type Draft } from './IncidentPages';
import { proposalForEvidence } from '../../shared/reassessment';
import { IncidentStory } from './IncidentStory';

export interface Selection { evidenceId: string | null; decisionId: string | null; proposalId?: string | null }

export function Decisions({ data, adapter, onUpdate, selection, onSelect }: {
  data: Snapshot; adapter: IncidentData; onUpdate: (data: Snapshot) => void;
  selection: Selection; onSelect: (selection: Selection) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'review' | 'resolved'>('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [adding, setAdding] = useState<'evidence' | 'decision' | null>(null);
  const contextHeading = useRef<HTMLHeadingElement>(null);
  const changesHeading = useRef<HTMLHeadingElement>(null);
  const evidence = data.evidence.find(e => e.id === selection.evidenceId);
  const selectedDecision = data.decisions.find(d => d.id === selection.decisionId);
  const isReviewSuggested = (proposal: Snapshot['proposals'][number]) => {
    if (proposal.state !== 'pending') return false;
    const linkedDecisionIds = Object.keys(proposal.decisionVersions);
    const relatedDecisionIds = linkedDecisionIds.length
      ? linkedDecisionIds
      : data.decisions.filter(decision =>
          decision.incidentId === proposal.incidentId && decision.evidenceIds.includes(proposal.evidenceId),
        ).map(decision => decision.id);
    return !relatedDecisionIds.length || relatedDecisionIds.some(id =>
      data.decisions.find(decision => decision.id === id && decision.incidentId === proposal.incidentId)?.state !== 'closed',
    );
  };
  const reviewCount = data.proposals.filter(isReviewSuggested).length;
  const needsReviewCount = data.decisions.filter(d => d.state === 'needs_review').length;
  const openTasks = data.tasks.filter(t => t.state === 'open').length;
  // The product's story in four stages; each count is a live number from the incident record.
  const stages = [
    { title: 'Evidence Received', value: data.evidence.length, purpose: 'New reports, kept exactly as reported' },
    { title: 'Reviews suggested', value: reviewCount, purpose: 'Nora (Nemotron) flags decisions the evidence may affect' },
    { title: 'Decisions under review', value: needsReviewCount, purpose: 'A person confirms or dismisses each flag' },
    { title: 'Verifications open', value: openTasks, purpose: 'A named owner independently checks the facts' },
  ];
  const activeStage = [1, 2, 3].find(i => stages[i].value > 0) ?? 0;
  // Evidence is grouped under the decision it supports, so related reports sit together.
  const flagged = (evidenceId: string) => data.proposals.some(p => p.evidenceId === evidenceId && isReviewSuggested(p));
  // Evidence Nora (Nemotron) found to challenge a decision sits under that decision too.
  const linkedByNora = (decisionId: string) => [
    ...data.proposals.filter(p => p.origin === 'nemotron' && Object.prototype.hasOwnProperty.call(p.decisionVersions, decisionId)).map(p => p.evidenceId),
    ...(data.evidenceReviews ?? []).filter(r => r.decisionId === decisionId && r.outcome !== 'no_impact' && r.outcome !== 'failed').map(r => r.evidenceId),
  ];
  const evidenceFor = (decision: Snapshot['decisions'][number]) => [...new Set([...decision.evidenceIds, ...linkedByNora(decision.id)])];
  const reviews = new Map((data.evidenceReviews ?? []).map(r => [r.evidenceId, r]));
  const noraVerdict = (evidenceId: string) => {
    const r = reviews.get(evidenceId);
    if (!r) return adapter.mode === 'live' ? { text: 'Nora (Nemotron) is reviewing…', tone: 'pending' } : null;
    if (r.outcome === 'no_impact') return { text: 'Nora (Nemotron): no decision affected', tone: 'quiet' };
    if (r.outcome === 'supports') return { text: `Nora (Nemotron): supports ${r.decisionId ?? 'the decision'}`, tone: 'ok' };
    if (r.outcome === 'failed') return { text: 'Nora (Nemotron) couldn’t finish', tone: 'quiet' };
    return { text: `${r.outcome === 'urgent' ? 'URGENT · ' : ''}Nora (Nemotron): challenges ${r.decisionId}`, tone: r.outcome };
  };
  const groups = [
    ...data.decisions.map(decision => ({ decision, items: evidenceFor(decision).map(id => data.evidence.find(e => e.id === id)).filter((e): e is Snapshot['evidence'][number] => !!e) })),
    { decision: null, items: data.evidence.filter(e => !data.decisions.some(d => evidenceFor(d).includes(e.id))) },
  ]
    .map(group => ({ ...group, shown: group.items.filter(e => filter !== 'review' || flagged(e.id)) }))
    .filter(group => {
      if (filter === 'resolved') return group.decision?.state === 'closed';
      if (group.decision?.state === 'closed') return false;
      return filter === 'review' ? group.shown.length > 0 : !!group.decision || group.items.length > 0;
    })
    .sort((x, y) => Number(y.items.some(e => flagged(e.id))) - Number(x.items.some(e => flagged(e.id))));
  function select(next: Selection) {
    onSelect(next);
    requestAnimationFrame(() => focusContext(contextHeading.current));
  }
  function openReference(id: string) {
    const decision = data.decisions.find(d => d.id === id);
    if (decision) return select({ evidenceId: evidenceFor(decision)[0] ?? null, decisionId: decision.id });
    const linked = data.decisions.find(d => evidenceFor(d).includes(id));
    select({ evidenceId: id, decisionId: linked?.id ?? null });
  }
  return <>
    <div className="workspace-overview">
      <div className="workspace-heading"><div><h1>Incident review</h1><p>When new evidence arrives, Nora (Nemotron) flags the decisions it may affect. A person reviews each flag, then an owner independently verifies the facts.</p></div></div>
      <ol className="stage-strip" aria-label="How a review moves from evidence to verification">
        {stages.map((stage, i) => <li key={stage.title} className={`stage ${i === activeStage ? 'current' : ''}`} aria-current={i === activeStage ? 'step' : undefined}>
          <span className="stage-number" aria-hidden="true">{i + 1}</span>
          <span className="stage-copy"><strong>{stage.value}<span> {stage.title}</span></strong><small>{stage.purpose}</small></span>
        </li>)}
      </ol>
    </div>
    <div className="incident-workspace">
      <section className="change-stream" aria-labelledby="changes-heading">
        <div className="section-heading"><h2 id="changes-heading" ref={changesHeading} tabIndex={-1}>Issues & Evidence</h2><span className="quiet-count">{data.evidence.length} reports</span></div>
        <p className="stream-intro">Each decision is an issue with its own discussion. Reports are grouped under the issue they affect.</p>
        <div className="workspace-add" role="group" aria-label="Add to the incident">
          <button className="primary" onClick={() => setAdding('evidence')}><FilePlus2 size={15} />Add finding</button>
          <button className="secondary" onClick={() => setAdding('decision')}><Gavel size={15} />Record a decision</button>
        </div>
        <div className="change-filters" role="group" aria-label="Filter changes"><button className={filter === 'all' ? 'selected' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All evidence</button><button className={filter === 'review' ? 'selected' : ''} aria-pressed={filter === 'review'} onClick={() => setFilter('review')}>Flagged for review <span>{reviewCount}</span></button><button className={filter === 'resolved' ? 'selected' : ''} aria-pressed={filter === 'resolved'} onClick={() => setFilter('resolved')}>Resolved</button></div>
        <div className="issue-groups">{groups.length ? groups.map(({ decision, shown, items }) => <section key={decision?.id ?? 'unlinked'} className={`issue-group ${decision && selection.decisionId === decision.id ? 'active' : ''} ${decision ? '' : 'unlinked'}`} aria-label={decision ? `${decision.id} ${decision.title}${decision.state === 'closed' ? ', resolved' : ''}` : 'Evidence not linked to a decision'}>
          {decision ? <button className="issue-head" onClick={() => select({ evidenceId: items[0]?.id ?? null, decisionId: decision.id })} aria-controls="change-context" aria-pressed={selection.decisionId === decision.id && !items.some(e => e.id === selection.evidenceId)}>
            <span className="issue-title"><small><span className={`kind-tag ${decision.state === 'approved' ? 'confirmed' : 'decision'}`}>{decision.state === 'approved' ? 'Confirmed decision' : decision.state === 'draft' ? 'Draft decision' : decision.state === 'closed' ? 'Resolved decision' : 'Decision under review'}</span> {decision.id}</small><strong>{decision.title}</strong></span>
            <Status value={decision.state} />
          </button> : <div className="issue-head static"><span className="issue-title"><small>Not linked yet</small><strong>Reports with no decision attached</strong></span></div>}
          <div className="issue-items">{shown.length ? shown.map(e => {
            const p = proposalForEvidence(data, e.id, decision?.id);
            const s = data.sources.find(s => s.id === e.sourceId);
            const resolved = decision?.state === 'closed';
            const underReview = !resolved && s?.trust === 'under_review';
            const reviewState = resolved ? undefined : p?.state === 'accepted' ? 'needs_review' : p?.state;
            const isSelected = selection.evidenceId === e.id && (selection.decisionId ?? null) === (decision?.id ?? null);
            return <button key={e.id} className={`change-item ${isSelected ? 'selected' : ''} ${!resolved && p?.state === 'pending' ? 'attention' : ''}`} onClick={() => select({ evidenceId: e.id, decisionId: decision?.id ?? null })} aria-pressed={isSelected} aria-controls="change-context">
              <span className="change-time">{e.id}<span className={`kind-tag ${e.title.startsWith('Verification of') ? 'verify' : 'human'}`}>{e.title.startsWith('Verification of') ? 'Verification findings' : e.title.startsWith('From discussion') ? 'Finding from discussion' : 'Human report'}</span></span>
              <strong>{underReview ? 'Recovery source under review' : e.title}</strong>
              <span className="change-summary">{s?.label}</span>
              {noraVerdict(e.id) && <span className={`nora-verdict ${noraVerdict(e.id)!.tone}`}>{noraVerdict(e.id)!.text}</span>}
              {reviewState && <span className="change-bottom"><Status value={reviewState} /><ArrowRight size={16} /></span>}
            </button>;
          }) : <p className="issue-empty">{decision ? 'No evidence linked to this decision yet.' : 'Every report is linked to a decision.'}</p>}</div>
          {!decision && !!items.length && <p className="issue-note">Check whether any of these should be tied to a decision above.</p>}
        </section>) : <div className="empty"><Check size={22} /><h3>{filter === 'review' ? 'Nothing flagged' : filter === 'resolved' ? 'Nothing resolved yet' : 'No open issues'}</h3><p>{filter === 'review' ? 'Switch to All evidence to see every open report.' : filter === 'resolved' ? 'Resolved decisions will appear here.' : 'All decision issues are resolved.'}</p>{filter === 'review' && <button className="text-button" onClick={() => setFilter('all')}>Show all evidence</button>}</div>}
        </div>
      </section>
      <div id="change-context" className="change-context story-host">
        <IncidentStory key={`${selection.evidenceId}:${selection.decisionId}`} data={data} adapter={adapter} onUpdate={onUpdate} selection={selection} headingRef={contextHeading} onOverview={() => focusContext(changesHeading.current)} onSelectProposal={id => onSelect({ ...selection, proposalId: id })} onDiscuss={text => setDraft({ text, nonce: Date.now() })} onOpenDecision={id => select({ evidenceId: null, decisionId: id })} />
        {selectedDecision
          ? <IncidentConversation key={selectedDecision.id} decisionId={selectedDecision.id} relatedEvidenceIds={evidenceFor(selectedDecision)} evidenceId={evidence?.id} data={data} adapter={adapter} onUpdate={onUpdate} draft={draft} onOpenReference={openReference} />
          : evidence && <IncidentConversation key={evidence.id} evidenceId={evidence.id} data={data} adapter={adapter} onUpdate={onUpdate} draft={draft} onOpenReference={openReference} />}
      </div>
    </div>
    {adding && <Modal title={adding === 'evidence' ? 'Add finding' : 'Record a decision'} onClose={() => setAdding(null)}>
      {adding === 'evidence'
        ? <AddEvidence adapter={adapter} onUpdate={onUpdate} onDone={() => setAdding(null)} />
        : <RecordDecision data={data} adapter={adapter} onUpdate={next => { onUpdate(next); const d = next.decisions[next.decisions.length - 1]; if (d) onSelect({ evidenceId: d.evidenceIds[0] ?? null, decisionId: d.id }); }} onDone={() => setAdding(null)} />}
    </Modal>}
    <details className="incident-details context-details"><summary><span>Incident details</span><span className="summary-meta">{data.incident.status}<ChevronDown size={17} /></span></summary><div className="detail-content"><dl className="metadata"><dt>Incident</dt><dd>{data.incident.title} · {data.incident.id}</dd><dt>Impact</dt><dd>{data.incident.summary}</dd><dt>Lead</dt><dd>{data.incident.commander}</dd><dt>Severity / status</dt><dd>{data.incident.severity} / {data.incident.status}</dd></dl><p className="small muted">Synthetic training scenario · updates are local to this tab.</p></div></details>
  </>;
}
