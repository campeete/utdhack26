import { useEffect, useRef, useState } from 'react';
import { Activity as ActivityIcon, AlertTriangle, ArrowDown, ArrowRight, Check, ChevronDown, ClipboardCheck, FileText, GitBranch, History, Layers3, ShieldQuestion } from 'lucide-react';
import type { Evidence, Proposal, Snapshot } from '../../shared/contracts';
import type { IncidentData } from '../data/interface';
import { previewImpact } from '../../shared/review';
import { focusContext, label, Status } from '../components/ui';
import { Activity, Briefing, IncidentConversation } from './IncidentPages';

export interface Selection { evidenceId: string | null; decisionId: string | null }
type ReviewAction = 'confirm' | 'dismiss';

export function Decisions({ data, adapter, onUpdate, selection, onSelect }: {
  data: Snapshot; adapter: IncidentData; onUpdate: (data: Snapshot) => void;
  selection: Selection; onSelect: (selection: Selection) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'review'>('all');
  const [composer, setComposer] = useState<ReviewAction | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const contextHeading = useRef<HTMLHeadingElement>(null);
  const changesHeading = useRef<HTMLHeadingElement>(null);
  const actionHeading = useRef<HTMLHeadingElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const dismissButton = useRef<HTMLButtonElement>(null);
  const reportHeading = useRef<HTMLHeadingElement>(null);
  const evidence = data.evidence.find(e => e.id === selection.evidenceId);
  const decision = data.decisions.find(d => d.id === selection.decisionId);
  const source = data.sources.find(s => s.id === evidence?.sourceId);
  const proposal = data.proposals.find(p => p.evidenceId === evidence?.id && (!decision || p.decisionVersions[decision.id] !== undefined));
  const task = data.tasks.find(t => t.proposalId === proposal?.id && t.decisionId === decision?.id);
  const briefings = data.briefings.filter(b => decision && b.decisionIds.includes(decision.id));
  const reviewCount = data.proposals.filter(p => p.state === 'pending').length;
  const needsReviewCount = data.decisions.filter(d => d.state === 'needs_review').length;
  const latestActivity = data.activity[0];
  const visibleEvidence = data.evidence.filter(e => filter === 'all' || data.proposals.some(p => p.evidenceId === e.id && p.state === 'pending'));
  function select(next: Selection) {
    onSelect(next); setComposer(null); setReportOpen(false); setTaskOpen(false);
    requestAnimationFrame(() => focusContext(contextHeading.current));
  }
  function openReport() {
    setReportOpen(true);
    requestAnimationFrame(() => focusContext(reportHeading.current));
  }
  function closeComposer(action: ReviewAction) {
    setComposer(null);
    requestAnimationFrame(() => focusContext(action === 'confirm' ? previewButton.current : dismissButton.current));
  }
  return <>
    <div className="workspace-overview">
      <div className="workspace-heading"><div><span className="eyebrow"><ActivityIcon size={14} /> INCIDENT OPERATIONS</span><h1>Incident overview</h1><p>Monitor incoming evidence, decision risk, and verification work.</p></div><span className="review-count">{needsReviewCount ? `${needsReviewCount} decision${needsReviewCount === 1 ? '' : 's'} needs review` : `${reviewCount} review${reviewCount === 1 ? '' : 's'} to consider`}<span>{latestActivity ? `Last activity ${new Date(latestActivity.at).toISOString().slice(11, 16)} UTC` : 'All times UTC'}</span></span></div>
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
          const p = data.proposals.find(p => p.evidenceId === e.id);
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
      <article id="change-context" className="change-context" aria-labelledby="context-heading">
        <div className="context-body" key={`${selection.evidenceId}:${selection.decisionId}`}>
          <div className="context-heading"><div><span className="section-label">Why it matters</span><h2 id="context-heading" ref={contextHeading} tabIndex={-1}>{decision?.title ?? evidence?.title ?? 'Select a change'}</h2></div>{decision?.state === 'needs_review' ? <Status value="needs_review" emphasis /> : proposal ? <Status value={proposal.state} emphasis /> : decision ? <Status value={decision.state} /> : <span className="routine-text">No linked decision</span>}</div>
          <p className="context-summary">{source?.trust === 'under_review' ? 'The source needs verification. The evidence itself has not been declared false.' : decision && !evidence ? 'This draft has no linked evidence. Its assumption still needs supporting evidence.' : decision ? 'This evidence supports a recorded decision. No source review is proposed.' : evidence ? 'No assumption or decision is linked to this report. It does not trigger a decision review.' : 'Choose an evidence update or a decision to see its context.'}</p>
          {(evidence || decision) && <ol className="relationship" aria-label="Evidence to decision relationship">
            <li><span className="relationship-label"><FileText size={16} />Evidence</span><strong>{evidence?.title ?? 'No evidence linked'}</strong>{evidence ? <Status value={evidence.standing} /> : <span className="routine-text">Not yet linked</span>}</li>
            <li><span className="relationship-label"><GitBranch size={16} />Assumption</span><strong>{decision?.assumption ?? 'No assumption linked'}</strong><span className={source?.trust === 'under_review' && decision ? 'verification-label' : 'routine-text'}>{decision ? source?.trust === 'under_review' ? 'Needs verification' : 'Recorded assumption' : 'No dependency'}</span></li>
            <li><span className="relationship-label"><ClipboardCheck size={16} />Decision</span><strong>{decision?.title ?? 'No decision linked'}</strong>{decision ? <Status value={decision.state} /> : <span className="routine-text">No review triggered</span>}</li>
          </ol>}
          {evidence && <div className="evidence-excerpt"><div className="excerpt-top"><span>{evidence.id} · Source excerpt</span><button className="text-button" onClick={openReport}>Read full report<ArrowDown size={14} /></button></div><blockquote>“{proposal?.excerpt ?? evidence.text}”</blockquote><div className="excerpt-source"><span>{source?.label}</span>{source?.trust === 'under_review' && <Status value="under_review" />}</div></div>}
          <section className={`next-action ${task ? 'confirmed' : ''}`} aria-labelledby="next-heading">
            <div className="next-action-heading"><h3 id="next-heading" ref={actionHeading} tabIndex={-1}>What to do next</h3>{proposal?.state === 'accepted' && <span className="recorded-label" role="status"><Check size={15} />Review recorded</span>}</div>
            {composer && proposal ? <ReviewComposer key={`${proposal.id}:${composer}`} action={composer} proposal={proposal} data={data} adapter={adapter} onCancel={() => closeComposer(composer)} onComplete={next => { onUpdate(next); setComposer(null); setTaskOpen(false); requestAnimationFrame(() => focusContext(actionHeading.current)); }} /> : task ? <>
              <p className="next-summary">{task.title}</p><div className="task-owner"><span className="avatar">{task.owner.split(' ').map(s => s[0]).join('')}</span><span>{task.owner}<small>Verification owner</small></span><Status value={task.state} /></div>
              <button className="primary" onClick={() => setTaskOpen(open => !open)} aria-expanded={taskOpen} aria-controls="verification-details">{taskOpen ? 'Hide verification task' : 'View verification task'}<ArrowRight size={16} /></button>
              {taskOpen && <div id="verification-details" className="verification-details"><h4>Verify before relying on the backup</h4><p>Independently check the original report, backup timing, and integrity. Record the result with the decision owner before revising the approval.</p><p className="small muted">Task {task.id} · {task.decisionId} · {label(task.state)}</p><button className="text-button" onClick={openReport}>Read source for verification<ArrowDown size={14} /></button><small className="muted">Task resolution awaits backend integration.</small></div>}
            </> : proposal?.state === 'pending' ? <><p className="next-summary">Review the dependency, then assign independent verification.</p><div className="action-row"><button ref={previewButton} className="primary" onClick={() => setComposer('confirm')}>Preview impact<ArrowRight size={17} /></button><button ref={dismissButton} className="secondary" onClick={() => setComposer('dismiss')}>Dismiss</button></div></> : proposal?.state === 'dismissed' ? <><p className="next-summary">Proposal dismissed. The decision and briefing remain unchanged.</p><p className="small muted">The source concern is still visible. Inspect the report and recorded reason below.</p></> : proposal?.state === 'stale' ? <p className="notice">This proposal is stale. Refresh its source and dependency versions before reviewing.</p> : <p className="next-summary">{decision ? 'Keep the recorded assumption under observation. Inspect the source if new information arrives.' : 'No decision action is proposed for this report.'}</p>}
            {proposal && <div className="proposal-disclosure"><ShieldQuestion size={14} /><span>{proposal.origin === 'synthetic' ? 'Pre-authored synthetic proposal · AI not connected' : `${label(proposal.origin)} proposal`}</span></div>}
          </section>
          {evidence && <IncidentConversation evidenceId={evidence.id} data={data} adapter={adapter} onUpdate={onUpdate} />}
          {evidence && <details className="context-details" open={reportOpen} onToggle={event => setReportOpen(event.currentTarget.open)}><summary><span><FileText size={17} />Original evidence & source</span><ChevronDown size={17} /></summary><div className="detail-content"><h3 ref={reportHeading} tabIndex={-1}>{evidence.title}</h3><EvidenceReport evidence={evidence} data={data} /><button className="text-button" onClick={() => { setReportOpen(false); requestAnimationFrame(() => focusContext(actionHeading.current)); }}>Return to next action<ArrowRight size={14} /></button></div></details>}
          {decision && <details className="context-details"><summary><span><ClipboardCheck size={17} />Decision rationale & approval</span><ChevronDown size={17} /></summary><div className="detail-content"><p>{decision.rationale}</p><dl className="metadata"><dt>Owner</dt><dd>{decision.owner}</dd><dt>Receipt</dt><dd>{decision.id} · Version {decision.version}</dd><dt>Original approval</dt><dd>{decision.approvedAt ? new Date(decision.approvedAt).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'Draft · not approved'}</dd></dl><p className="small muted">A review preserves the original approval. It does not reverse an operational action.</p></div></details>}
          {briefings.map(b => <details className="context-details" key={b.id}><summary><span><FileText size={17} />Response briefing</span><span className="summary-meta"><Status value={b.state} /><ChevronDown size={17} /></span></summary><div className="detail-content"><Briefing briefing={b} /></div></details>)}
          <details className="context-details"><summary><span><History size={17} />History & review notes</span><ChevronDown size={17} /></summary><div className="detail-content">{proposal && <><h3>Review context</h3><p>{proposal.explanation}</p></>}<Activity data={data} /></div></details>
          <button className="back-to-changes text-button" onClick={() => focusContext(changesHeading.current)}>Back to changes</button>
        </div>
      </article>
    </div>
    <details className="incident-details context-details"><summary><span>Incident details</span><span className="summary-meta">{data.incident.status}<ChevronDown size={17} /></span></summary><div className="detail-content"><dl className="metadata"><dt>Incident</dt><dd>{data.incident.title} · {data.incident.id}</dd><dt>Impact</dt><dd>{data.incident.summary}</dd><dt>Commander</dt><dd>{data.incident.commander}</dd><dt>Severity / status</dt><dd>{data.incident.severity} / {data.incident.status}</dd></dl><p className="small muted">Synthetic training scenario · updates are local to this tab.</p></div></details>
  </>;
}

function EvidenceReport({ evidence, data }: { evidence: Evidence; data: Snapshot }) {
  const source = data.sources.find(s => s.id === evidence.sourceId);
  return <><p className="report-text">{evidence.text}</p><div className="report-status"><Status value={evidence.standing} />{source?.trust === 'under_review' && <Status value="under_review" />}</div><dl className="metadata"><dt>Source</dt><dd>{source?.label ?? 'Unknown source'}</dd><dt>Event time</dt><dd>{new Date(evidence.eventTime).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</dd><dt>Recorded</dt><dd>{new Date(evidence.recordedAt).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</dd><dt>Record</dt><dd>{evidence.id} · Version {evidence.version}</dd></dl><p className="source-note">{source?.reason}</p></>;
}

function ReviewComposer({ action, proposal, data, adapter, onCancel, onComplete }: {
  action: ReviewAction; proposal: Proposal; data: Snapshot; adapter: IncidentData;
  onCancel: () => void; onComplete: (next: Snapshot) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  let impact; let stale = '';
  try { impact = previewImpact(data, proposal); } catch (e) { stale = (e as Error).message; }
  useEffect(() => { focusContext(heading.current); }, []);
  return <div className="review-composer" onKeyDown={e => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onCancel(); } }}>
    <h4 ref={heading} tabIndex={-1}>{action === 'confirm' ? 'Preview the impact' : 'Dismiss this proposal'}</h4>
    {action === 'confirm' ? <><p className="small muted">Confirm a review of these dependencies.</p><ul className="impact-list">
      {impact?.decisionIds.map(id => <li key={id}><span><small>{id} · Decision</small><strong>{data.decisions.find(d => d.id === id)?.title}</strong></span><Status value="needs_review" /></li>)}
      {impact?.briefingIds.map(id => <li key={id}><span><small>{id} · Briefing</small><strong>{data.briefings.find(b => b.id === id)?.title}</strong></span><Status value="outdated" /></li>)}
      {impact?.decisionIds.map(id => <li key={`task:${id}`}><span><small>New verification task</small><strong>Assigned to {data.decisions.find(d => d.id === id)?.owner}</strong></span><Status value="open" /></li>)}
    </ul><p className="preservation-note"><Check size={17} /><span>Evidence keeps its standing. Original approval and briefing text are preserved.</span></p></> : <p>Record why this proposal should not change the decision or briefing.</p>}
    <form onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError('');
      try { onComplete(await adapter[action](proposal.id, reason)); }
      catch (err) { setError((err as Error).message); setBusy(false); }
    }} aria-busy={busy}>
      <label htmlFor="review-reason">{action === 'confirm' ? 'Reason for confirming review' : 'Reason for dismissal'}</label>
      <textarea id="review-reason" value={reason} onChange={e => setReason(e.target.value)} required minLength={8} maxLength={2000} rows={3} placeholder="What needs independent verification?" aria-describedby="reason-hint" />
      <small id="reason-hint" className="muted">8–2,000 characters · {adapter.mode === 'fixture' ? 'Local fixture action' : 'Incident review record'}</small>
      {(error || stale) && <p role="alert" className="error">{error || stale}</p>}
      <div className="action-row"><button className="primary" disabled={busy || (action === 'confirm' && !!stale)}>{busy ? 'Recording…' : action === 'confirm' ? 'Confirm review' : 'Dismiss proposal'}<Check size={16} /></button><button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button></div>
    </form>
  </div>;
}
