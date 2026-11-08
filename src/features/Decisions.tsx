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
  const [filter, setFilter] = useState<'all' | 'review' | 'resolved'>('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const contextHeading = useRef<HTMLHeadingElement>(null);
  const changesHeading = useRef<HTMLHeadingElement>(null);
  const evidence = data.evidence.find(e => e.id === selection.evidenceId);
  const reviewCount = data.proposals.filter(p => p.state === 'pending').length;
  const needsReviewCount = data.decisions.filter(d => d.state === 'needs_review').length;
  const openTasks = data.tasks.filter(t => t.state === 'open').length;
  // The product's story in four stages; each count is a live number from the incident record.
  const stages = [
    { title: 'Evidence Received', value: data.evidence.length, purpose: 'New reports, kept exactly as reported' },
    { title: 'Reviews suggested', value: reviewCount, purpose: 'Nora flags decisions the evidence may affect' },
    { title: 'Decisions under review', value: needsReviewCount, purpose: 'A person confirms or dismisses each flag' },
    { title: 'Verifications open', value: openTasks, purpose: 'A named owner independently checks the facts' },
  ];
  const activeStage = [1, 2, 3].find(i => stages[i].value > 0) ?? 0;
  // Evidence is grouped under the decision it supports, so related reports sit together.
  const flagged = (evidenceId: string) => data.proposals.some(p => p.evidenceId === evidenceId && p.state === 'pending');
  const groups = [
    ...data.decisions.map(decision => ({ decision, items: decision.evidenceIds.map(id => data.evidence.find(e => e.id === id)).filter((e): e is Snapshot['evidence'][number] => !!e) })),
    { decision: null, items: data.evidence.filter(e => !data.decisions.some(d => d.evidenceIds.includes(e.id))) },
  ]
    .map(group => ({ ...group, shown: group.items.filter(e => filter !== 'review' || flagged(e.id)) }))
    .filter(group => {
      if (filter === 'resolved') return group.decision?.state === 'closed';
      if (group.decision?.state === 'closed') return false;
      return filter === 'review' ? group.shown.length > 0 : !!group.decision || group.items.length > 0;
    })
    .sort((x, y) => Number(y.items.some(e => flagged(e.id))) - Number(x.items.some(e => flagged(e.id))));
  const resolvedCount = data.decisions.filter(decision => decision.state === 'closed').length;
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
        <div className="section-heading"><h2 id="changes-heading" ref={changesHeading} tabIndex={-1}>Issues & Evidence</h2><span className="quiet-count">{data.evidence.length} reports</span></div>
        <p className="stream-intro">Reports are grouped under the decision they support. Pick a report or a decision.</p>
        <div className="change-filters" role="group" aria-label="Filter changes"><button className={filter === 'all' ? 'selected' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All evidence</button><button className={filter === 'review' ? 'selected' : ''} aria-pressed={filter === 'review'} onClick={() => setFilter('review')}>Flagged for review <span>{reviewCount}</span></button><button className={filter === 'resolved' ? 'selected' : ''} aria-pressed={filter === 'resolved'} onClick={() => setFilter('resolved')}>Resolved</button></div>
        <div className="issue-groups">{groups.length ? groups.map(({ decision, shown, items }) => <section key={decision?.id ?? 'unlinked'} className={`issue-group ${decision && selection.decisionId === decision.id ? 'active' : ''} ${decision ? '' : 'unlinked'}`} aria-label={decision ? `${decision.id} ${decision.title}${decision.state === 'closed' ? ', resolved' : ''}` : 'Evidence not linked to a decision'}>
          {decision ? <button className="issue-head" onClick={() => select({ evidenceId: items[0]?.id ?? null, decisionId: decision.id })} aria-controls="change-context" aria-pressed={selection.decisionId === decision.id && !items.some(e => e.id === selection.evidenceId)}>
            <span className="issue-title"><small>Decision {decision.id}</small><strong>{decision.title}</strong></span>
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
              <span className="change-time">{e.id}<span>{underReview ? 'Source update' : 'Evidence added'}</span></span>
              <strong>{underReview ? 'Recovery source under review' : e.title}</strong>
              <span className="change-summary">{s?.label}</span>
              {reviewState && <span className="change-bottom"><Status value={reviewState} /><ArrowRight size={16} /></span>}
            </button>;
          }) : <p className="issue-empty">{decision ? 'No evidence linked to this decision yet.' : 'Every report is linked to a decision.'}</p>}</div>
          {!decision && !!items.length && <p className="issue-note">Check whether any of these should be tied to a decision above.</p>}
        </section>) : <div className="empty"><Check size={22} /><h3>{filter === 'review' ? 'Nothing flagged' : filter === 'resolved' ? 'Nothing resolved yet' : 'No open issues'}</h3><p>{filter === 'review' ? 'Switch to All evidence to see every open report.' : filter === 'resolved' ? 'Resolved decisions will appear here.' : 'All decision issues are resolved.'}</p>{filter === 'review' && <button className="text-button" onClick={() => setFilter('all')}>Show all evidence</button>}</div>}
        </div>
      </section>
      <div id="change-context" className="change-context story-host">
        <IncidentStory key={`${selection.evidenceId}:${selection.decisionId}`} data={data} adapter={adapter} onUpdate={onUpdate} selection={selection} headingRef={contextHeading} onOverview={() => focusContext(changesHeading.current)} onSelectProposal={id => onSelect({ ...selection, proposalId: id })} onDiscuss={text => setDraft({ text, nonce: Date.now() })} />
        {evidence && <IncidentConversation evidenceId={evidence.id} data={data} adapter={adapter} onUpdate={onUpdate} draft={draft} onOpenReference={openReference} />}
      </div>
    </div>
    <details className="incident-details context-details"><summary><span>Incident details</span><span className="summary-meta">{data.incident.status}<ChevronDown size={17} /></span></summary><div className="detail-content"><dl className="metadata"><dt>Incident</dt><dd>{data.incident.title} · {data.incident.id}</dd><dt>Impact</dt><dd>{data.incident.summary}</dd><dt>Commander</dt><dd>{data.incident.commander}</dd><dt>Severity / status</dt><dd>{data.incident.severity} / {data.incident.status}</dd></dl><p className="small muted">Synthetic training scenario · updates are local to this tab.</p></div></details>
  </>;
}
