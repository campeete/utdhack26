import { useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown } from 'lucide-react';
import type { Snapshot } from '../../shared/contracts';
import type { IncidentData } from '../data/interface';
import { focusContext, Status } from '../components/ui';
import { IncidentConversation, type Draft } from './IncidentPages';
import { proposalForEvidence } from '../../shared/reassessment';
import { IncidentStory } from './IncidentStory';

export interface Selection { evidenceId: string | null; decisionId: string | null; proposalId?: string | null }

export function Decisions({ data, adapter, onUpdate, selection, onSelect }: {
  data: Snapshot; adapter: IncidentData; onUpdate: (data: Snapshot) => void;
  selection: Selection; onSelect: (selection: Selection) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'review'>('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const contextHeading = useRef<HTMLHeadingElement>(null);
  const changesHeading = useRef<HTMLHeadingElement>(null);
  const evidence = data.evidence.find(e => e.id === selection.evidenceId);
  const reviewCount = data.proposals.filter(p => p.state === 'pending').length;
  const needsReviewCount = data.decisions.filter(d => d.state === 'needs_review').length;
  const openTasks = data.tasks.filter(t => t.state === 'open').length;
  // The product's story in four stages; each count is a live number from the incident record.
  const stages = [
    { title: 'Evidence received', value: data.evidence.length, purpose: 'New reports, kept exactly as reported' },
    { title: 'Reviews suggested', value: reviewCount, purpose: 'Nora flags decisions the evidence may affect' },
    { title: 'Decisions under review', value: needsReviewCount, purpose: 'A person confirms or dismisses each flag' },
    { title: 'Verifications open', value: openTasks, purpose: 'A named owner independently checks the facts' },
  ];
  const activeStage = [1, 2, 3].find(i => stages[i].value > 0) ?? 0;
  const visibleEvidence = data.evidence.filter(e => filter === 'all' || data.proposals.some(p => p.evidenceId === e.id && p.state === 'pending'));
  function select(next: Selection) {
    onSelect(next);
    requestAnimationFrame(() => focusContext(contextHeading.current));
  }
  function openReference(id: string) {
    const decision = data.decisions.find(d => d.id === id);
    if (decision) return select({ evidenceId: decision.evidenceIds[0] ?? null, decisionId: decision.id });
    const linked = data.decisions.find(d => d.evidenceIds.includes(id));
    select({ evidenceId: id, decisionId: linked?.id ?? null });
  }
  return <>
    <div className="workspace-overview">
      <div className="workspace-heading"><div><h1>Incident review</h1><p>When new evidence arrives, Nora flags the decisions it may affect. A person reviews each flag, then an owner independently verifies the facts.</p></div></div>
      <ol className="stage-strip" aria-label="How a review moves from evidence to verification">
        {stages.map((stage, i) => <li key={stage.title} className={`stage ${i === activeStage ? 'current' : ''}`} aria-current={i === activeStage ? 'step' : undefined}>
          <span className="stage-number" aria-hidden="true">{i + 1}</span>
          <span className="stage-copy"><strong>{stage.value}<span> {stage.title}</span></strong><small>{stage.purpose}</small></span>
        </li>)}
      </ol>
    </div>
    <div className="incident-workspace">
      <section className="change-stream" aria-labelledby="changes-heading">
        <div className="section-heading"><h2 id="changes-heading" ref={changesHeading} tabIndex={-1}>Incoming evidence</h2><span className="quiet-count">{data.evidence.length}</span></div>
        <p className="stream-intro">Select an item to see which decision it affects.</p>
        <div className="change-filters" role="group" aria-label="Filter changes"><button className={filter === 'all' ? 'selected' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All evidence</button><button className={filter === 'review' ? 'selected' : ''} aria-pressed={filter === 'review'} onClick={() => setFilter('review')}>Flagged for review <span>{reviewCount}</span></button></div>
        <div className="change-items">{visibleEvidence.length ? visibleEvidence.map(e => {
          const p = proposalForEvidence(data, e.id);
          const s = data.sources.find(s => s.id === e.sourceId);
          const linked = data.decisions.find(d => d.evidenceIds.includes(e.id));
          const reviewState = p?.state === 'accepted' ? 'needs_review' : p?.state;
          return <button key={e.id} className={`change-item ${selection.evidenceId === e.id ? 'selected' : ''} ${p?.state === 'pending' ? 'attention' : ''}`} onClick={() => select({ evidenceId: e.id, decisionId: linked?.id ?? null })} aria-pressed={selection.evidenceId === e.id} aria-controls="change-context">
            <span className="change-time">{e.id}<span>{s?.trust === 'under_review' ? 'Source update' : 'Evidence added'}</span></span>
            <strong>{s?.trust === 'under_review' ? 'Recovery source under review' : e.title}</strong>
            <span className="change-summary">{s?.label}</span>
            <span className="change-bottom">{reviewState ? <Status value={reviewState} /> : <span className="routine-text">{linked ? 'Affects a decision' : 'No decision affected'}</span>}<ArrowRight size={16} /></span>
          </button>;
        }) : <div className="empty"><Check size={22} /><h3>Nothing flagged</h3><p>Your selected item stays open. Switch to All evidence to see every report.</p><button className="text-button" onClick={() => setFilter('all')}>Show all evidence</button></div>}</div>
        <details className="decision-register"><summary>All decisions<span>{data.decisions.length}<ChevronDown size={15} /></span></summary><div>{data.decisions.map(d => <button key={d.id} className={`register-item ${selection.decisionId === d.id ? 'selected' : ''}`} onClick={() => select({ evidenceId: d.evidenceIds[0] ?? null, decisionId: d.id })}><small>{d.id}</small><strong>{d.title}</strong><Status value={d.state} /></button>)}</div></details>
      </section>
      <div id="change-context" className="change-context story-host">
        <IncidentStory key={`${selection.evidenceId}:${selection.decisionId}`} data={data} adapter={adapter} onUpdate={onUpdate} selection={selection} headingRef={contextHeading} onOverview={() => focusContext(changesHeading.current)} onSelectProposal={id => onSelect({ ...selection, proposalId: id })} onDiscuss={text => setDraft({ text, nonce: Date.now() })} />
        {evidence && <IncidentConversation evidenceId={evidence.id} data={data} adapter={adapter} onUpdate={onUpdate} draft={draft} onOpenReference={openReference} />}
      </div>
    </div>
    <details className="incident-details context-details"><summary><span>Incident details</span><span className="summary-meta">{data.incident.status}<ChevronDown size={17} /></span></summary><div className="detail-content"><dl className="metadata"><dt>Incident</dt><dd>{data.incident.title} · {data.incident.id}</dd><dt>Impact</dt><dd>{data.incident.summary}</dd><dt>Commander</dt><dd>{data.incident.commander}</dd><dt>Severity / status</dt><dd>{data.incident.severity} / {data.incident.status}</dd></dl><p className="small muted">Synthetic training scenario · updates are local to this tab.</p></div></details>
  </>;
}
