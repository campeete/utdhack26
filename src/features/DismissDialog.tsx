import { useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, RotateCcw, Sparkles } from 'lucide-react';
import type { Proposal, Snapshot } from '../../shared/contracts';
import { FEEDBACK_MAX, normalizeFeedback } from '../../shared/reassessment';
import type { IncidentData } from '../data/interface';
import { localDateTime, Modal } from '../components/ui';

/**
 * Dismissal dialog for a suggested review. Cancel, × and Escape close it with
 * no change. Submitting closes it; the record and any reassessment progress
 * then show inline in "What to do next".
 */
export function DismissDialog({ proposal, adapter, onClose, onComplete }: {
  proposal: Proposal; adapter: IncidentData; onClose: () => void; onComplete: (next: Snapshot) => void;
}) {
  const fieldId = useId(); const hintId = useId();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A ref, not state, so a second click before React re-renders is still caught.
  const submitting = useRef(false);
  const reassess = normalizeFeedback(feedback).length > 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try { onComplete(await adapter.dismiss(proposal.id, feedback)); }
    catch (err) { setError((err as Error).message); submitting.current = false; setBusy(false); }
  }
  return <Modal title="Dismiss suggested review" onClose={() => { if (!submitting.current) onClose(); }} closeDisabled={busy}>
    <div className="dismiss-dialog">
      <div className="dismiss-suggestion"><small>{proposal.id} · Suggestion</small><blockquote>“{proposal.excerpt}”</blockquote><p>{proposal.verification}</p></div>
      <form onSubmit={submit} aria-busy={busy}>
        <label htmlFor={fieldId}>Feedback for Nora <span className="muted">(optional)</span></label>
        <textarea id={fieldId} value={feedback} onChange={e => setFeedback(e.target.value)} maxLength={FEEDBACK_MAX} rows={4} disabled={busy} placeholder="Why doesn’t this suggestion hold up?" aria-describedby={hintId} />
        <div id={hintId} className="dismiss-hint">
          <p><Sparkles size={15} aria-hidden="true" />{reassess
            ? 'Submitting feedback asks Nora, our NVIDIA Nemotron analyst, for a new analysis of this suggestion, using the original evidence and your feedback. Any revision comes back as a new suggestion that a person must review.'
            : 'Leave this empty to dismiss without involving Nora. Adding feedback asks Nora for a new analysis.'}</p>
          <p className="muted">The original suggestion, your name and the time are kept with the dismissal.{adapter.mode === 'fixture' ? ' Demo: a synthetic stand-in replies; Nemotron is not connected.' : ''}</p>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="action-row">
          <button className="primary" disabled={busy}>{busy ? 'Recording…' : reassess ? 'Dismiss & reassess' : 'Dismiss'}<Check size={16} /></button>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </div>
  </Modal>;
}

/** The kept dismissal record plus inline reassessment progress, result or Retry. */
export function DismissalRecord({ proposal, data, adapter, onUpdate, onOpenRevision }: {
  proposal: Proposal; data: Snapshot; adapter: IncidentData;
  onUpdate: (next: Snapshot) => void; onOpenRevision: (proposalId: string) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const d = proposal.dismissal; const r = proposal.reassessment;
  const revision = r?.revisionId ? data.proposals.find(p => p.id === r.revisionId) : undefined;
  async function retry() {
    if (inFlight.current) return;
    inFlight.current = true; setRetrying(true); setError('');
    try { onUpdate(await adapter.retryReassessment(proposal.id)); }
    catch (err) { setError((err as Error).message); }
    finally { inFlight.current = false; setRetrying(false); }
  }
  return <div className="dismissal-record">
    <p className="next-summary">Suggestion dismissed. The decision and team update remain unchanged.</p>
    {d && <dl className="metadata"><dt>Dismissed by</dt><dd>{d.reviewer}</dd><dt>When</dt><dd>{localDateTime(d.at)}</dd><dt>Reason</dt><dd>{d.feedback || <span className="muted">No feedback given · not sent to Nora</span>}</dd></dl>}
    {r && <div className="reassessment" aria-live="polite">
      {r.state === 'requested' && <div role="status" className="reassess-progress"><span>Nora is reassessing with your feedback{r.attempt > 1 ? ` (attempt ${r.attempt})` : ''}…</span><span className="progress-track" aria-hidden="true"><span /></span></div>}
      {r.state === 'revised' && <div className="reassess-result"><p><Sparkles size={15} aria-hidden="true" />Nora proposed a revised suggestion. It needs human review before it changes anything.</p>
        {revision ? <button className="text-button" onClick={() => onOpenRevision(revision.id)}>Review revised suggestion {revision.id}<ArrowRight size={14} /></button> : <span className="muted">Revised suggestion {r.revisionId} is not visible to you.</span>}</div>}
      {r.state === 'no_further_review' && <div className="reassess-result"><p><Check size={15} aria-hidden="true" />Nora reassessed this: no further review suggested.</p>{r.note && <p className="small muted">{r.note}</p>}</div>}
      {r.state === 'failed' && <div className="reassess-failed"><p role="alert" className="error">Reassessment failed: {(r.error ?? 'unknown error').replace(/[.\s]+$/, '')}. Your dismissal is still recorded.</p>
        <button className="secondary" onClick={retry} disabled={retrying}>{retrying ? 'Requesting…' : 'Retry reassessment'}<RotateCcw size={15} /></button></div>}
      {error && <p role="alert" className="error">{error}</p>}
    </div>}
  </div>;
}
