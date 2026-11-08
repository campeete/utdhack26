import { useRef, useState, type ReactNode } from 'react';
import { Check, ClipboardList, FilePlus2, Gavel, UserPlus } from 'lucide-react';
import { roleLabel, tierOf, type Snapshot } from '../../shared/contracts';
import type { IncidentData } from '../data/interface';
import { label } from '../components/ui';

type Run = (action: () => Promise<Snapshot>) => Promise<boolean>;

/** Runs one action at a time, shows its error, and hands the new snapshot up. */
function useRun(onUpdate: (next: Snapshot) => void): [Run, boolean, string] {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const run: Run = async action => {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError('');
    try { onUpdate(await action()); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { inFlight.current = false; setBusy(false); }
  };
  return [run, busy, error];
}

function Panel({ icon, title, children, hint }: { icon: ReactNode; title: string; children: ReactNode; hint?: string }) {
  return <section className="team-panel" aria-label={title}>
    <h2>{icon}{title}</h2>
    {hint && <p className="muted team-hint">{hint}</p>}
    {children}
  </section>;
}

/** Tier 2+: approve the decision and assign someone to verify what it rests on. Shown in Review the decision. */
export function DecisionActions({ decision, data, adapter, onUpdate }: { decision: Snapshot['decisions'][number]; data: Snapshot; adapter: IncidentData; onUpdate: (next: Snapshot) => void }) {
  const [run, busy, error] = useRun(onUpdate);
  const [assigning, setAssigning] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [task, setTask] = useState('');
  const tier = tierOf(adapter.identity?.roles ?? []);
  if (decision.state === 'closed') return null;
  if (tier < 2) return <p className="procedure-note">A Tier 2 or Tier 3 approves this decision and assigns verification.</p>;
  const members = data.members.filter(m => m.active);
  return <div className="decision-actions">
    <div className="action-row compact">
      {(decision.state === 'draft' || decision.state === 'needs_review') && <button className="secondary" disabled={busy} onClick={() => run(() => adapter.approveDecision(decision.id))}>{decision.state === 'draft' ? 'Approve decision' : 'Re-approve decision'}<Check size={14} /></button>}
      <button className="secondary" disabled={busy} aria-expanded={assigning} onClick={() => { setAssigning(!assigning); setTask(`Verify: ${decision.assumption}`); setAssignee(''); }}>Assign verification<ClipboardList size={14} /></button>
    </div>
    {assigning && <form className="assign-form" onSubmit={async e => { e.preventDefault(); if (await run(() => adapter.assignTask(decision.id, assignee, task))) setAssigning(false); }}>
      <label>Task <input value={task} onChange={e => setTask(e.target.value)} maxLength={200} required /></label>
      <label>Assign to <select value={assignee} onChange={e => setAssignee(e.target.value)} required>
        <option value="" disabled>Choose a teammate</option>
        {members.map(m => <option key={m.id} value={m.id}>{m.name} ({m.roles.map(roleLabel).join(', ')})</option>)}
      </select></label>
      <button className="primary" disabled={busy || !assignee || !task.trim()}>Assign</button>
    </form>}
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}

/** The verification work on one decision: the assignee accepts it and submits findings. Shown in Independent verification. */
export function DecisionTasks({ decisionId, data, adapter, onUpdate }: { decisionId: string; data: Snapshot; adapter: IncidentData; onUpdate: (next: Snapshot) => void }) {
  const [run, busy, error] = useRun(onUpdate);
  const me = adapter.identity?.name;
  const mine = (t: Snapshot['tasks'][number]) => (t.ownerId && t.ownerId === adapter.identityHex) || t.owner === me;
  const tasks = data.tasks.filter(t => t.decisionId === decisionId);
  if (!tasks.length) return null;
  return <div className="decision-tasks">
    <ul className="team-list">{tasks.map(t => <li key={t.id}>
      <div className="team-row"><strong>{t.title}</strong><span className={`state-chip state-${t.state}`}>{label(t.state)}</span></div>
      <small className="muted">Assigned to {mine(t) ? 'you' : t.owner}</small>
      {mine(t) && t.state === 'open' && <Acknowledge busy={busy} onAcknowledge={reply => run(async () => {
        const next = await adapter.acceptTask(t.id);
        return reply ? adapter.sendMessage('', '', reply, decisionId) : next;
      })} />}
      {!mine(t) && t.state !== 'resolved' && <p className={`ack-state ${t.state === 'accepted' ? 'ok' : 'waiting'}`}>{t.state === 'accepted' ? `${t.owner} acknowledged this.` : `Waiting for ${t.owner} to acknowledge.`}</p>}
      {mine(t) && t.state === 'accepted' && <FindingsForm onSubmit={findings => run(() => adapter.submitFindings(t.id, findings))} busy={busy} />}
    </li>)}</ul>
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}

/** The assignee acknowledges the action, optionally with a reply that goes to the issue's discussion. */
const SUGGESTED_REPLIES = [
  'Checking the backup against the revised timeline.',
  'On it now. I will post what I find here.',
  'I need access to the backup logs to verify this.',
];
function Acknowledge({ busy, onAcknowledge }: { busy: boolean; onAcknowledge: (reply: string) => Promise<boolean> }) {
  const [reply, setReply] = useState(SUGGESTED_REPLIES[0]);
  return <form className="assign-form ack-form" onSubmit={async e => { e.preventDefault(); if (await onAcknowledge(reply.trim())) setReply(''); }}>
    <div className="prepared" role="group" aria-label="Suggested replies"><span className="muted">Suggested replies:</span>
      {SUGGESTED_REPLIES.map(r => <button key={r} type="button" className={`secondary ${reply === r ? 'selected' : ''}`} onClick={() => setReply(r)} disabled={busy}>{r}</button>)}
    </div>
    <label>Reply to the team (optional) <input value={reply} onChange={e => setReply(e.target.value)} maxLength={2000} disabled={busy} placeholder="Checking the backup against the revised timeline." /></label>
    <button className="primary" disabled={busy}>{busy ? 'Sending…' : 'Acknowledge'}<Check size={14} /></button>
  </form>;
}

/** Who owns the next action on this issue, and whether they have acknowledged it. */
export function NextAction({ data, decisionId, pendingSuggestion }: { data: Snapshot; decisionId?: string; pendingSuggestion: boolean }) {
  const task = data.tasks.find(t => t.decisionId === decisionId && t.state !== 'resolved');
  if (task) return <p className={`next-action ${task.state === 'accepted' ? 'ok' : 'waiting'}`} role="status">
    <strong>Next action</strong><span>{task.owner}: {task.title}</span>
    <span className="ack">{task.state === 'accepted' ? 'Acknowledged' : 'Not acknowledged yet'}</span>
  </p>;
  const decision = data.decisions.find(d => d.id === decisionId);
  if (decision?.state === 'needs_review') {
    const done = data.tasks.some(t => t.decisionId === decisionId && t.state === 'resolved');
    // What Nora (Nemotron) concluded about the newest verification findings for this decision.
    const verdict = decisionId ? verificationVerdict(data, decisionId) : undefined;
    const text = !done ? 'A Tier 2 or Tier 3 assigns verification (Review the decision).'
      : !verdict ? 'Verification is done. Nora (Nemotron) is checking the findings against the decision…'
      : verdict.outcome === 'supports' ? 'The findings support the decision. A Tier 2 or Tier 3 re-approves it (Review the decision).'
      : verdict.outcome === 'conflict' || verdict.outcome === 'urgent' ? 'The findings contradict this plan. A Tier 2 or Tier 3 replaces it (Review the decision → Replace the plan).'
      : 'Verification is done. A Tier 2 or Tier 3 decides: re-approve the decision or resolve the issue.';
    return <p className={`next-action ${verdict?.outcome === 'supports' ? 'ok' : 'waiting'}`} role="status"><strong>Next action</strong><span>{text}</span></p>;
  }
  if (pendingSuggestion) return <p className="next-action waiting" role="status"><strong>Next action</strong><span>A Tier 2 reviews Nora (Nemotron)'s suggestion: flag & assign, or dismiss.</span></p>;
  return null;
}

/** Tier 2+: confirm Nora (Nemotron)'s suggestion and give the verification to one person, in one step. */
export function FlagAndAssign({ proposalId, data, adapter, onUpdate }: { proposalId: string; data: Snapshot; adapter: IncidentData; onUpdate: (next: Snapshot) => void }) {
  const [run, busy, error] = useRun(onUpdate);
  const members = data.members.filter(m => m.active);
  const others = members.filter(m => m.id !== adapter.identityHex && m.name !== adapter.identity?.name);
  const [assignee, setAssignee] = useState(others.find(m => tierOf(m.roles) === 1)?.id ?? others[0]?.id ?? '');
  const [reason, setReason] = useState('The new evidence puts the assumption in question.');
  return <form className="assign-form flag-assign" onSubmit={e => { e.preventDefault(); void run(() => adapter.flagAndAssign(proposalId, reason.trim(), assignee)); }}>
    <label>Assign verification to <select value={assignee} onChange={e => setAssignee(e.target.value)} required disabled={busy}>
      <option value="" disabled>Choose a teammate</option>
      {members.map(m => <option key={m.id} value={m.id}>{m.name} ({m.roles.map(roleLabel).join(', ')})</option>)}
    </select></label>
    <label>Why <input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} required disabled={busy} /></label>
    <button className="primary" disabled={busy || !assignee || reason.trim().length < 10}>{busy ? 'Flagging…' : 'Flag & assign'}<ClipboardList size={14} /></button>
    {error && <p role="alert" className="error">{error}</p>}
  </form>;
}

/** The assignee's findings: saved as evidence that Nora (Nemotron) checks against the decision. */
const SUGGESTED_FINDINGS = [
  { label: 'Backup is clean', text: 'Backup job logs show the Monday backup finished at 01:40, before the 03:12 session, and a test restore came up clean.' },
  { label: 'Backup is compromised', text: 'Backup job logs show the Monday backup started at 04:05, after the 03:12 session, and it contains the attacker\'s new admin account.' },
];
function FindingsForm({ onSubmit, busy }: { onSubmit: (findings: string) => Promise<boolean>; busy: boolean }) {
  const [findings, setFindings] = useState('');
  return <form className="assign-form" onSubmit={async e => { e.preventDefault(); if (await onSubmit(findings.trim())) setFindings(''); }}>
    <div className="prepared" role="group" aria-label="Suggested findings"><span className="muted">Example findings:</span>
      {SUGGESTED_FINDINGS.map(f => <button key={f.label} type="button" className="secondary" disabled={busy} onClick={() => setFindings(f.text)}>{f.label}</button>)}
    </div>
    <label>What you found <textarea rows={3} maxLength={50000} value={findings} onChange={e => setFindings(e.target.value)} disabled={busy}
      placeholder="Backup job logs show the Monday backup finished at 01:40, before the 03:12 session." /></label>
    <button className="primary" disabled={busy || !findings.trim()}>{busy ? 'Submitting…' : 'Submit findings'}<Check size={14} /></button>
    <small className="muted">Closes this task and hands your findings to Nora (Nemotron), who checks them against the decision.</small>
  </form>;
}

/** Synthetic reports for the demo: one that conflicts with the plan, one urgent, one unrelated. */
export const PREPARED_REPORTS = [
  { label: 'Sunday admin access', notes: 'firewall logs - admin session from unknown host at 03:12 sunday. monday backup ran AFTER that session' },
  { label: 'Files encrypting now', notes: 'helpdesk call: ransom note on file server FS-02 at 06:40 monday, finance share files getting renamed .lock right now, encryption looks ongoing' },
  { label: 'Printer outage', notes: 'facilities ticket - floor 3 printer offline since saturday, bad toner sensor, replaced this morning' },
];

export function AddEvidence({ adapter, onUpdate, onDone }: { adapter: IncidentData; onUpdate: (next: Snapshot) => void; onDone?: () => void }) {
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [run, busy, error] = useRun(onUpdate);
  const [notes, setNotes] = useState('');
  const [formatting, setFormatting] = useState(false);
  const [formatError, setFormatError] = useState('');
  const [formatted, setFormatted] = useState(false);
  async function formatWithNora() {
    setFormatting(true); setFormatError(''); setFormatted(false);
    try {
      const res = await fetch('/api/nora/format', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) });
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { title?: string; source?: string; text?: string; error?: string };
      if (!res.ok || !body.title) throw new Error(body.error ?? 'Nora (Nemotron) could not format these notes.');
      setTitle(body.title); setSource(body.source ?? ''); setText(body.text ?? ''); setFormatted(true);
    } catch (e) { setFormatError((e as Error).message); }
    finally { setFormatting(false); }
  }
  return <Panel icon={<FilePlus2 size={18} aria-hidden="true" />} title="Add finding" hint="A human report. Nora (Nemotron) analyzes it against every open decision as soon as you submit.">
    <div className="prepared" role="group" aria-label="Prepared reports"><span className="muted">Prepared reports:</span>
      {PREPARED_REPORTS.map(r => <button key={r.label} type="button" className="secondary" onClick={() => { setNotes(r.notes); setTitle(''); setSource(''); setText(''); setFormatted(false); }}>{r.label}</button>)}
    </div>
    <div className="team-form format-notes">
      <label>1. Your notes, as rough as you like <textarea rows={3} maxLength={8000} value={notes} onChange={e => setNotes(e.target.value)} disabled={formatting} placeholder="fw logs: admin login from unknown host 03:12 sunday, monday backup ran after" /></label>
      <button type="button" className="secondary" disabled={formatting || notes.trim().length < 10} onClick={() => void formatWithNora()}>{formatting ? 'Nora (Nemotron) is formatting…' : 'Format with Nora (Nemotron)'}</button>
      {formatted && <p className="muted"><span className="kind-tag ai">AI draft</span> Check it below and edit anything before you submit. Nora keeps only what your notes say.</p>}
      {formatError && <><p role="alert" className="error">{formatError}</p>
        <button type="button" className="text-button" onClick={() => { const n = notes.trim(); setTitle(n.length > 80 ? `${n.slice(0, 77)}…` : n); setSource('Responder notes'); setText(n); setFormatError(''); }}>Use my notes as they are</button></>}
    </div>
    <p className="muted format-step">2. Review and submit{formatted ? '' : ' (or fill these in yourself)'}</p>
    <form className="team-form" onSubmit={async e => { e.preventDefault(); if (await run(() => adapter.addEvidence({ title, source, text }))) { setTitle(''); setSource(''); setText(''); onDone?.(); } }}>
      <label>Title <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required placeholder="Suspicious access on Sunday" /></label>
      <label>Source <input value={source} onChange={e => setSource(e.target.value)} maxLength={64} placeholder="Firewall logs" /></label>
      <label>What it shows <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={50000} required placeholder="An admin session from an unknown host at 03:12 Sunday…" /></label>
      <button className="primary" disabled={busy || !title.trim() || !text.trim()}>{busy ? 'Submitting…' : 'Submit & analyze'}</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  </Panel>;
}

export function RecordDecision({ data, adapter, onUpdate, onDone }: { data: Snapshot; adapter: IncidentData; onUpdate: (next: Snapshot) => void; onDone?: () => void }) {
  const [title, setTitle] = useState('');
  const [assumption, setAssumption] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [run, busy, error] = useRun(onUpdate);
  return <Panel icon={<Gavel size={18} aria-hidden="true" />} title="Record a decision" hint="Write down the plan and the assumption it rests on, so new evidence can challenge it.">
    <form className="team-form" onSubmit={async e => { e.preventDefault(); if (await run(() => adapter.recordDecision({ title, assumption, evidenceIds: evidence }))) { setTitle(''); setAssumption(''); setEvidence([]); onDone?.(); } }}>
      <label>Decision <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required placeholder="Restore the portal from Monday's backup" /></label>
      <label>Rests on <input value={assumption} onChange={e => setAssumption(e.target.value)} maxLength={1000} required placeholder="Monday's backup predates the intrusion" /></label>
      {data.evidence.length > 0 && <fieldset className="evidence-picks"><legend>Based on evidence</legend>
        {data.evidence.map(ev => <label key={ev.id} className="check"><input type="checkbox" checked={evidence.includes(ev.id)} onChange={e => setEvidence(list => e.target.checked ? [...list, ev.id] : list.filter(x => x !== ev.id))} />{ev.id}: {ev.title}</label>)}
      </fieldset>}
      <button className="primary" disabled={busy || !title.trim() || !assumption.trim()}>{busy ? 'Saving…' : 'Record decision'}</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  </Panel>;
}

/** Tier 3 manages who is in the incident. Everyone can copy their own ID to be admitted. */
export function TeamAccess({ data, adapter, onUpdate }: { data: Snapshot; adapter: IncidentData; onUpdate: (next: Snapshot) => void }) {
  const [run, busy, error] = useRun(onUpdate);
  const [newId, setNewId] = useState('');
  const [newTier, setNewTier] = useState<'tier1' | 'tier2' | 'tier3'>('tier1');
  const [copied, setCopied] = useState(false);
  const canManage = tierOf(adapter.identity?.roles ?? []) >= 3;
  const myId = adapter.identityHex;
  return <div className="team-access">
    {canManage && adapter.mode === 'live' && <InviteLink data={data} adapter={adapter} onUpdate={onUpdate} />}
    {myId && <div className="my-id"><span className="muted">Your ID (share it with a Tier 3 to be admitted elsewhere)</span>
      <code>{myId}</code>
      <button type="button" className="secondary" onClick={() => { void navigator.clipboard?.writeText(myId).then(() => setCopied(true), () => {}); }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>}
    <ul className="team-list">{data.members.map(m => <li key={m.id} className={m.active ? undefined : 'inactive'}>
      <div className="team-row"><strong>{m.name}</strong><span className="muted">{m.active ? m.roles.map(roleLabel).join(', ') : 'Removed'}</span></div>
      {canManage && m.active && m.id !== myId && m.name !== adapter.identity?.name && <div className="action-row compact">
        <select aria-label={`Tier for ${m.name}`} value={m.roles[0]} disabled={busy} onChange={e => run(() => adapter.setMemberTier(m.id, e.target.value as 'tier1' | 'tier2' | 'tier3'))}>
          <option value="tier1">Tier 1 · Triage</option><option value="tier2">Tier 2 · Containment</option><option value="tier3">Tier 3 · Forensics</option>
        </select>
        <button type="button" className="secondary" disabled={busy} onClick={() => run(() => adapter.revokeMember(m.id))}>Remove</button>
      </div>}
    </li>)}</ul>
    {canManage
      ? <form className="team-form" onSubmit={async e => { e.preventDefault(); if (await run(() => adapter.admitMember(newId.trim(), newTier))) setNewId(''); }}>
        <h3><UserPlus size={16} aria-hidden="true" />Admit a teammate</h3>
        <label>Their ID <input value={newId} onChange={e => setNewId(e.target.value)} placeholder="64 characters from their browser" required /></label>
        <label>Tier <select value={newTier} onChange={e => setNewTier(e.target.value as 'tier1' | 'tier2' | 'tier3')}>
          <option value="tier1">Tier 1 · Triage</option><option value="tier2">Tier 2 · Containment</option><option value="tier3">Tier 3 · Forensics</option>
        </select></label>
        <button className="primary" disabled={busy || !newId.trim()}>Admit</button>
      </form>
      : <p className="muted">Only Tier 3 can add, re-tier or remove people.</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}

function newCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), b => abc[b % abc.length]).join('');
}

/** Tier 3: one link teammates open to join. No IDs to copy. */
function InviteLink({ data, adapter, onUpdate }: { data: Snapshot; adapter: IncidentData; onUpdate: (next: Snapshot) => void }) {
  const [run, busy, error] = useRun(onUpdate);
  const [tier, setTier] = useState<'tier1' | 'tier2'>('tier1');
  const [copied, setCopied] = useState(false);
  const invite = data.invite;
  const link = invite ? `${location.origin}/?data=live&join=${invite.code}` : '';
  return <section className="invite-link" aria-label="Invite link">
    <h3><UserPlus size={16} aria-hidden="true" />Invite link</h3>
    {invite ? <>
      <p className="muted">Anyone who opens this joins as {roleLabel(invite.tier)}. They only type their name.</p>
      <div className="my-id"><code>{link}</code>
        <button type="button" className="secondary" onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {}); }}>{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      <div className="action-row compact">
        <button type="button" className="secondary" disabled={busy} onClick={() => { setCopied(false); void run(() => adapter.setInvite(newCode(), invite.tier as 'tier1' | 'tier2')); }}>New link</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => run(() => adapter.setInvite('', 'tier1'))}>Turn off</button>
      </div>
    </> : <div className="action-row compact">
      <select aria-label="Tier for people who join" value={tier} onChange={e => setTier(e.target.value as 'tier1' | 'tier2')}>
        <option value="tier1">Join as Tier 1 · Triage</option><option value="tier2">Join as Tier 2 · Containment</option>
      </select>
      <button type="button" className="primary" disabled={busy} onClick={() => run(() => adapter.setInvite(newCode(), tier))}>Create invite link</button>
    </div>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}

/** Nora (Nemotron)'s verdict on the newest verification findings for a decision, if any. */
export function verificationVerdict(data: Snapshot, decisionId: string) {
  const verifications = new Set(data.evidence.filter(e => e.title.startsWith(`Verification of ${decisionId}:`)).map(e => e.id));
  return [...(data.evidenceReviews ?? [])].filter(r => verifications.has(r.evidenceId)).sort((x, y) => (x.at < y.at ? 1 : -1))[0];
}

/**
 * Tier 2+: the findings contradict this decision, so replace it. In one step: record the
 * new plan, confirm it, and retire the old decision (it stays in the record as resolved).
 */
export function ReplacePlan({ decision, data, adapter, onUpdate, onReplaced }: {
  decision: Snapshot['decisions'][number]; data: Snapshot; adapter: IncidentData;
  onUpdate: (next: Snapshot) => void; onReplaced?: (newDecisionId: string) => void;
}) {
  const [run, busy, error] = useRun(onUpdate);
  const [title, setTitle] = useState('Rebuild the customer portal from the clean Friday snapshot');
  const [assumption, setAssumption] = useState("Friday's snapshot predates the 03:12 session");
  if (tierOf(adapter.identity?.roles ?? []) < 2) return <p className="procedure-note">A Tier 2 or Tier 3 replaces the plan.</p>;
  async function replace() {
    const before = new Set(data.decisions.map(d => d.id));
    let next = await adapter.recordDecision({ title: title.trim(), assumption: assumption.trim(), evidenceIds: [] });
    let created = next.decisions.find(d => !before.has(d.id));
    for (let i = 0; i < 20 && !created; i++) { await new Promise(r => setTimeout(r, 100)); next = await adapter.load(); created = next.decisions.find(d => !before.has(d.id)); }
    if (!created) throw new Error('The new plan was recorded; approve it from its issue.');
    await adapter.approveDecision(created.id);
    next = await adapter.resolveDecision(decision.id);
    onReplaced?.(created.id);
    return next;
  }
  return <form className="assign-form replace-plan" onSubmit={e => { e.preventDefault(); void run(replace); }}>
    <p className="procedure-recommendation"><span>The findings contradict this plan</span>Replace it: the new plan is confirmed and this one is retired. Both stay in the record.</p>
    <label>New plan <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required disabled={busy} /></label>
    <label>It rests on <input value={assumption} onChange={e => setAssumption(e.target.value)} maxLength={1000} required disabled={busy} /></label>
    <button className="primary" disabled={busy || !title.trim() || !assumption.trim()}>{busy ? 'Replacing…' : 'Replace the plan'}<Check size={14} /></button>
    {error && <p role="alert" className="error">{error}</p>}
  </form>;
}
