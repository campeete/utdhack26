import { useRef, useState } from 'react';
import { Activity as ActivityIcon, AlertTriangle, ArrowRight, Check, ChevronDown, FileText, Layers3, ShieldQuestion } from 'lucide-react';
import type { Snapshot } from '../../shared/contracts';
import type { IncidentData } from '../data/interface';
import { focusContext, localTime, Status } from '../components/ui';
import { IncidentConversation } from './IncidentPages';
import { proposalForEvidence } from '../../shared/reassessment';
import { IncidentStory } from './IncidentStory';

export interface Selection { evidenceId: string | null; decisionId: string | null; proposalId?: string | null }

export function Decisions({ data, adapter, onUpdate, selection, onSelect }: {
  data: Snapshot; adapter: IncidentData; onUpdate: (data: Snapshot) => void;
  selection: Selection; onSelect: (selection: Selection) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'review'>('all');
  const contextHeading = useRef<HTMLHeadingElement>(null);
  const changesHeading = useRef<HTMLHeadingElement>(null);
  const evidence = data.evidence.find(e => e.id === selection.evidenceId);
  const reviewCount = data.proposals.filter(p => p.state === 'pending').length;
  const needsReviewCount = data.decisions.filter(d => d.state === 'needs_review').length;
  const latestActivity = data.activity[0];
  const visibleEvidence = data.evidence.filter(e => filter === 'all' || data.proposals.some(p => p.evidenceId === e.id && p.state === 'pending'));
  function select(next: Selection) {
    onSelect(next);
    requestAnimationFrame(() => focusContext(contextHeading.current));
  }
  return <>
    <div className="workspace-overview">
      <div className="workspace-heading"><div><span className="eyebrow"><ActivityIcon size={14} /> INCIDENT OPERATIONS</span><h1>Incident overview</h1><p>Monitor incoming evidence, decision risk, and verification work.</p></div><span className="review-count">{needsReviewCount ? `${needsReviewCount} decision${needsReviewCount === 1 ? '' : 's'} needs review` : `${reviewCount} review${reviewCount === 1 ? '' : 's'} to consider`}<span>{latestActivity ? `Last activity ${localTime(latestActivity.at)} · local time` : 'Times shown in local time'}</span></span></div>
      <section className="signal-summary" aria-label="Incident signal summary">
      <article className={reviewCount ? 'signal-card attention' : 'signal-card'}>
        <span className="signal-icon"><AlertTriangle size={17} /></span><div><strong>{reviewCount}</strong><small>{reviewCount === 1 ? 'Proposal awaiting review' : 'Proposals awaiting review'}</small></div>
      </article>
      <article className={needsReviewCount ? 'signal-card attention' : 'signal-card'}>
        <span className="signal-icon"><ShieldQuestion size={17} /></span><div><strong>{needsReviewCount}</strong><small>{needsReviewCount === 1 ? 'Decision needs review' : 'Decisions need review'}</small></div>
      </article>
      <article className="signal-card">
        <span className="signal-icon"><FileText size={17} /></span><div><strong>{data.evidence.length}</strong><small>Reports in this incident</small></div>
      </article>
      <article className="signal-card">
        <span className="signal-icon"><Layers3 size={17} /></span><div><strong>{data.scope.length}</strong><small>Tracked affected systems</small></div>
      </article>
      </section>
    </div>
    <div className="incident-workspace">
      <section className="change-stream" aria-labelledby="changes-heading">
        <div className="section-heading"><h2 id="changes-heading" ref={changesHeading} tabIndex={-1}>What changed</h2><span className="quiet-count">{data.evidence.length}</span></div>
        <div className="change-filters" role="group" aria-label="Filter changes"><button className={filter === 'all' ? 'selected' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All changes</button><button className={filter === 'review' ? 'selected' : ''} aria-pressed={filter === 'review'} onClick={() => setFilter('review')}>Review proposed <span>{reviewCount}</span></button></div>
        <div className="change-items">{visibleEvidence.length ? visibleEvidence.map(e => {
          const p = proposalForEvidence(data, e.id);
          const s = data.sources.find(s => s.id === e.sourceId);
          const linked = data.decisions.find(d => d.evidenceIds.includes(e.id));
          const reviewState = p?.state === 'accepted' ? 'needs_review' : p?.state;
          return <button key={e.id} className={`change-item ${selection.evidenceId === e.id ? 'selected' : ''} ${p?.state === 'pending' ? 'attention' : ''}`} onClick={() => select({ evidenceId: e.id, decisionId: linked?.id ?? null })} aria-pressed={selection.evidenceId === e.id} aria-controls="change-context">
            <span className="change-time">{e.id}<span>{s?.trust === 'under_review' ? 'Source update' : 'Evidence added'}</span></span>
            <strong>{s?.trust === 'under_review' ? 'Recovery source under review' : e.title}</strong>
            <span className="change-summary">{s?.label}</span>
            <span className="change-bottom">{reviewState ? <Status value={reviewState} /> : <span className="routine-text">{linked ? 'Decision linked' : 'No linked decision'}</span>}<ArrowRight size={16} /></span>
          </button>;
        }) : <div className="empty"><Check size={22} /><h3>No proposed reviews</h3><p>Your selected context stays open. Switch to All changes to see the full record.</p><button className="text-button" onClick={() => setFilter('all')}>Show all changes</button></div>}</div>
        <details className="decision-register"><summary>Decisions & evidence<span>{data.decisions.length}<ChevronDown size={15} /></span></summary><div>{data.decisions.map(d => <button key={d.id} className={`register-item ${selection.decisionId === d.id ? 'selected' : ''}`} onClick={() => select({ evidenceId: d.evidenceIds[0] ?? null, decisionId: d.id })}><small>{d.id}</small><strong>{d.title}</strong><Status value={d.state} /></button>)}</div></details>
        <p className="stream-note">Source trust and evidence standing are separate assessments.</p>
      </section>
      <div id="change-context" className="change-context story-host">
        <IncidentStory key={`${selection.evidenceId}:${selection.decisionId}`} data={data} adapter={adapter} onUpdate={onUpdate} selection={selection} headingRef={contextHeading} onOverview={() => focusContext(changesHeading.current)} onSelectProposal={id => onSelect({ ...selection, proposalId: id })} />
        {evidence && <IncidentConversation evidenceId={evidence.id} data={data} adapter={adapter} onUpdate={onUpdate} />}
      </div>
    </div>
    <details className="incident-details context-details"><summary><span>Incident details</span><span className="summary-meta">{data.incident.status}<ChevronDown size={17} /></span></summary><div className="detail-content"><dl className="metadata"><dt>Incident</dt><dd>{data.incident.title} · {data.incident.id}</dd><dt>Impact</dt><dd>{data.incident.summary}</dd><dt>Commander</dt><dd>{data.incident.commander}</dd><dt>Severity / status</dt><dd>{data.incident.severity} / {data.incident.status}</dd></dl><p className="small muted">Synthetic training scenario · updates are local to this tab.</p></div></details>
  </>;
}
