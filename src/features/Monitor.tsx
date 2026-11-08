import { useId, useRef, useState, type FormEvent } from 'react';
import { Check, ExternalLink, Link2, RotateCcw, ShieldAlert, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { Finding, Snapshot } from '../../shared/contracts';
import type { IncidentData } from '../data/interface';
import { localDateTime, localTime, Modal } from '../components/ui';

const ACTION_LABEL: Record<Finding['proposedAction'], string> = {
  disable_account: 'Disable account',
  force_password_reset: 'Force password reset',
  monitor_only: 'Keep watching',
};
const STATE_LABEL: Record<Finding['state'], string> = {
  open: 'Waiting for a person', approved: 'Approved', dismissed: 'Dismissed', auto_fixed: 'Fixed by Nora', undone: 'Undone',
};

function clueChips(clues: Finding['clues']): string[] {
  const out: string[] = [];
  if (clues.breached_password === true) out.push('Leaked password');
  if (clues.new_device === true) out.push('New device');
  if (clues.new_network === true) out.push('New network');
  if (typeof clues.ip_abuse_score === 'number') out.push(`IP abuse score ${clues.ip_abuse_score}`);
  if (typeof clues.network_owner === 'string') out.push(clues.network_owner);
  if (typeof clues.country === 'string') out.push(clues.country);
  return out;
}

const attackUrl = (id: string) => `https://attack.mitre.org/techniques/${id.replace('.', '/')}/`;

type Filter = 'person' | 'nora' | 'all';

/** The split-screen monitor: Nora's findings and the audit chain, live. */
export function Monitor({ data, adapter, onUpdate }: { data: Snapshot; adapter: IncidentData; onUpdate: (next: Snapshot) => void }) {
  const [filter, setFilter] = useState<Filter>('person');
  const [dismissing, setDismissing] = useState<Finding | null>(null);
  const findings = data.findings ?? [];
  const counts = {
    person: findings.filter(f => f.state === 'open').length,
    nora: findings.filter(f => f.state === 'auto_fixed').length,
    all: findings.length,
  };
  const shown = findings.filter(f => filter === 'all' || (filter === 'person' ? f.state === 'open' : f.state === 'auto_fixed'));

  return <div className="monitor">
    <section className="monitor-column" aria-labelledby="nora-feed-title">
      <div className="monitor-heading">
        <h2 id="nora-feed-title"><Sparkles size={18} aria-hidden="true" />Nora’s findings</h2>
        <p>Nora watches sign-ins, scores the unusual ones with NVIDIA Nemotron, and proposes one fix. A person approves anything risky.</p>
      </div>
      <div className="monitor-filters" role="group" aria-label="Show findings">
        {(['person', 'nora', 'all'] as Filter[]).map(f => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
          {f === 'person' ? 'Needs a person' : f === 'nora' ? 'Fixed by Nora' : 'All'} <span className="count">{counts[f]}</span>
        </button>)}
      </div>
      {shown.length === 0
        ? <p className="monitor-empty">{findings.length === 0 ? 'No findings yet. Nora writes one when a sign-in looks unusual.' : 'Nothing here right now.'}</p>
        : <ol className="finding-list">{shown.map(f => <FindingCard key={f.id} finding={f} adapter={adapter} onUpdate={onUpdate} onDismiss={() => setDismissing(f)} />)}</ol>}
    </section>
    <AuditPanel data={data} />
    {dismissing && <DismissFinding finding={dismissing} adapter={adapter} onClose={() => setDismissing(null)} onDone={next => { setDismissing(null); onUpdate(next); }} />}
  </div>;
}

function FindingCard({ finding: f, adapter, onUpdate, onDismiss }: { finding: Finding; adapter: IncidentData; onUpdate: (next: Snapshot) => void; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  async function run(action: () => Promise<Snapshot>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { onUpdate(await action()); } catch (e) { setError((e as Error).message); } finally { inFlight.current = false; setBusy(false); }
  }
  const chips = clueChips(f.clues);
  return <li className={`finding-card severity-${f.severity}`}>
    <div className="finding-top">
      <span className={`severity-pill ${f.severity}`}>{f.severity}</span>
      <span className="finding-account">{f.accountRef}</span>
      <span className={`finding-state state-${f.state}`}>{STATE_LABEL[f.state]}</span>
      <time dateTime={f.createdAt}>{localTime(f.createdAt)}</time>
    </div>
    <h3>{f.title}</h3>
    {f.signIn && <p className="finding-signin">{f.signIn}</p>}
    <p>{f.reason}</p>
    {chips.length > 0 && <ul className="clue-chips" aria-label="Clues">{chips.map(c => <li key={c}>{c}</li>)}</ul>}
    <dl className="finding-meta">
      <dt>Proposed fix</dt><dd>{f.proposedFix} <span className="muted">({ACTION_LABEL[f.proposedAction]})</span></dd>
      {f.attackTechnique && <><dt>ATT&CK</dt><dd><a href={attackUrl(f.attackTechnique)} target="_blank" rel="noreferrer noopener">{f.attackTechnique}<ExternalLink size={12} aria-hidden="true" /></a></dd></>}
      {f.decidedBy && <><dt>Decided</dt><dd>{f.decidedBy} · {localDateTime(f.decidedAt!)}{f.ruleId ? ` · under low-severity rule ${f.ruleId}` : ''}</dd></>}
      {f.dismissalFeedback && <><dt>Feedback</dt><dd>{f.dismissalFeedback}</dd></>}
    </dl>
    <small className="muted">{f.model}</small>
    {error && <p role="alert" className="error">{error}</p>}
    {f.state === 'open' && <div className="action-row">
      <button className="primary" disabled={busy} onClick={() => run(() => adapter.approveFinding(f.id))}>{busy ? 'Recording…' : `Approve: ${ACTION_LABEL[f.proposedAction]}`}<Check size={16} /></button>
      <button className="secondary" disabled={busy} onClick={onDismiss}>Dismiss<X size={16} /></button>
    </div>}
    {f.state === 'auto_fixed' && <div className="action-row">
      <button className="secondary" disabled={busy} onClick={() => run(() => adapter.undoFinding(f.id))}>{busy ? 'Undoing…' : 'Undo Nora’s fix'}<RotateCcw size={15} /></button>
    </div>}
  </li>;
}

function DismissFinding({ finding, adapter, onClose, onDone }: { finding: Finding; adapter: IncidentData; onClose: () => void; onDone: (next: Snapshot) => void }) {
  const fieldId = useId();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try { onDone(await adapter.dismissFinding(finding.id, feedback)); }
    catch (err) { setError((err as Error).message); submitting.current = false; setBusy(false); }
  }
  return <Modal title="Dismiss Nora’s finding" onClose={() => { if (!submitting.current) onClose(); }} closeDisabled={busy}>
    <form className="dismiss-dialog" onSubmit={submit} aria-busy={busy}>
      <div className="dismiss-suggestion"><small>{finding.accountRef} · {finding.severity}</small><blockquote>{finding.title}</blockquote></div>
      <label htmlFor={fieldId}>Feedback for Nora <span className="muted">(optional)</span></label>
      <textarea id={fieldId} value={feedback} onChange={e => setFeedback(e.target.value)} maxLength={2000} rows={4} disabled={busy} placeholder="Why isn’t this a problem? Nora reads this on later findings." />
      <p className="muted">The finding, your name and the time are kept. Feedback is saved to Nora’s memory; no model is retrained.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="action-row">
        <button className="primary" disabled={busy}>{busy ? 'Recording…' : 'Dismiss'}<Check size={16} /></button>
        <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
      </div>
    </form>
  </Modal>;
}

function AuditPanel({ data }: { data: Snapshot }) {
  const audit = data.audit;
  const entries = audit?.entries ?? [];
  return <section className="monitor-column" aria-labelledby="audit-title">
    <div className="monitor-heading">
      <h2 id="audit-title"><Link2 size={18} aria-hidden="true" />Audit log</h2>
      <p>Every change and every action by Nora is chained by hash: each entry seals the one before it, so an edited or deleted entry breaks the chain.</p>
    </div>
    {audit?.verified === null || !audit
      ? <p className="chain-status unknown">The audit chain appears in live mode.</p>
      : audit.verified
        ? <p className="chain-status ok" role="status"><ShieldCheck size={18} aria-hidden="true" />Chain intact · {entries.length} entries checked in this browser{audit.headHash ? <> · head <code>{audit.headHash.slice(0, 12)}…</code></> : null}</p>
        : <p className="chain-status broken" role="alert"><ShieldAlert size={18} aria-hidden="true" />Chain broken{audit.firstBreakSeq !== undefined ? ` at entry #${audit.firstBreakSeq}` : ''}. Treat this log as tampered with.</p>}
    {entries.length > 0 && <ol className="audit-list">{entries.slice(0, 200).map(e => <li key={e.seq} className={audit?.firstBreakSeq !== undefined && e.seq >= audit.firstBreakSeq ? 'broken' : undefined}>
      <span className="audit-seq">#{e.seq}</span>
      <div>
        <p><strong>{e.action.replace(/_/g, ' ').toLowerCase()}</strong>{e.detail ? ` · ${e.detail}` : ''}</p>
        <small>{localTime(e.at)} · {e.actor}{e.actorKind === 'service' ? ' (service)' : ''} · <code title={e.hash}>{e.hash.slice(0, 10)}</code></small>
      </div>
    </li>)}</ol>}
  </section>;
}
