import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, ClipboardList, FilePlus2, Gavel, MessagesSquare, Send, UserPlus } from 'lucide-react';
import { roleLabel, tierOf, type Snapshot } from '../../shared/contracts';
import type { IncidentData } from '../data/interface';
import { label, localTime } from '../components/ui';

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

/**
 * The team room: one live discussion for every tier, plus the records the team
 * works from. Everything here is stored in SpacetimeDB in live mode, so every
 * member's screen updates without a refresh.
 */
export function TeamRoom({ data, adapter, onUpdate }: { data: Snapshot; adapter: IncidentData; onUpdate: (next: Snapshot) => void }) {
  const tier = tierOf(adapter.identity?.roles ?? []);
  return <div className="team-room">
    <Discussion data={data} adapter={adapter} onUpdate={onUpdate} />
    <div className="team-side">
      <DecisionsPanel data={data} adapter={adapter} onUpdate={onUpdate} tier={tier} />
      <TasksPanel data={data} adapter={adapter} onUpdate={onUpdate} />
      {tier >= 1 && <AddEvidence adapter={adapter} onUpdate={onUpdate} />}
      {tier >= 1 && <RecordDecision data={data} adapter={adapter} onUpdate={onUpdate} />}
    </div>
  </div>;
}

function Panel({ icon, title, children, hint }: { icon: ReactNode; title: string; children: ReactNode; hint?: string }) {
  return <section className="team-panel" aria-label={title}>
    <h2>{icon}{title}</h2>
    {hint && <p className="muted team-hint">{hint}</p>}
    {children}
  </section>;
}

function Discussion({ data, adapter, onUpdate }: { data: Snapshot; adapter: IncidentData; onUpdate: (next: Snapshot) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [about, setAbout] = useState('');
  const [to, setTo] = useState('');
  const [run, busy, error] = useRun(onUpdate);
  const log = useRef<HTMLOListElement>(null);
  const messages = [...data.messages];
  const me = adapter.identity?.name;
  const teammates = data.members.filter(m => m.active && m.id !== adapter.identityHex && m.name !== me);
  const recordTitle = (evidenceId: string) => data.evidence.find(e => e.id === evidenceId)?.title;
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages.length]);
  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!text.trim()) return;
    if (await run(() => adapter.sendMessage(about, to, text.trim()))) setText('');
  }
  return <Panel icon={<MessagesSquare size={18} aria-hidden="true" />} title="Team discussion" hint="Every tier talks here, live. Link a message to evidence so the context travels with it.">
    <ol className="discussion-log" ref={log} aria-live="polite">
      {messages.length === 0 && <li className="muted">No messages yet. Start with what you know and what you need.</li>}
      {messages.map(m => {
        const mine = m.author === me;
        const recipient = m.recipientId ? data.members.find(x => x.id === m.recipientId)?.name ?? 'one teammate' : '';
        return <li key={m.id} className={mine ? 'mine' : undefined}>
          <div className="discussion-meta"><strong>{m.author}</strong><time dateTime={m.at}>{localTime(m.at)}</time>
            {recipient && <span className="chip">to {recipient}</span>}
            {m.evidenceId && <span className="chip">about {m.evidenceId}{recordTitle(m.evidenceId) ? `: ${recordTitle(m.evidenceId)}` : ''}</span>}
          </div>
          <p>{m.text}</p>
        </li>;
      })}
    </ol>
    <form className="discussion-compose" onSubmit={send} aria-busy={busy}>
      <label htmlFor={`${id}-text`} className="sr-only">Message</label>
      <textarea id={`${id}-text`} rows={2} maxLength={2000} value={text} onChange={e => setText(e.target.value)} disabled={busy}
        placeholder="Has restoration started? What are you seeing?"
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
      <div className="discussion-options">
        <label>About <select value={about} onChange={e => setAbout(e.target.value)} disabled={busy}>
          <option value="">The whole incident</option>
          {data.evidence.map(ev => <option key={ev.id} value={ev.id}>{ev.id}: {ev.title}</option>)}
        </select></label>
        <label>To <select value={to} onChange={e => setTo(e.target.value)} disabled={busy}>
          <option value="">Everyone</option>
          {teammates.map(m => <option key={m.id} value={m.id}>{m.name} ({m.roles.map(roleLabel).join(', ')})</option>)}
        </select></label>
        <button className="primary" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}<Send size={15} /></button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  </Panel>;
}

function DecisionsPanel({ data, adapter, onUpdate, tier }: { data: Snapshot; adapter: IncidentData; onUpdate: (next: Snapshot) => void; tier: number }) {
  const [run, busy, error] = useRun(onUpdate);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignee, setAssignee] = useState('');
  const [task, setTask] = useState('');
  const members = data.members.filter(m => m.active);
  return <Panel icon={<Gavel size={18} aria-hidden="true" />} title="Decisions" hint="Tier 1 records them; Tier 2 approves them and assigns verification.">
    {data.decisions.length === 0 ? <p className="muted">No decisions yet.</p> : <ul className="team-list">
      {data.decisions.map(d => <li key={d.id}>
        <div className="team-row"><strong>{d.id}</strong><span className={`state-chip state-${d.state}`}>{label(d.state)}</span></div>
        <p>{d.title}</p>
        <small className="muted">Rests on: {d.assumption}{d.owner ? ` · ${d.owner}` : ''}</small>
        {tier >= 2 && <div className="action-row compact">
          {(d.state === 'draft' || d.state === 'needs_review') && <button className="secondary" disabled={busy} onClick={() => run(() => adapter.approveDecision(d.id))}>Approve<Check size={14} /></button>}
          <button className="secondary" disabled={busy} onClick={() => { setAssigning(assigning === d.id ? null : d.id); setTask(`Verify: ${d.assumption}`); setAssignee(''); }}>Assign verification<ClipboardList size={14} /></button>
        </div>}
        {assigning === d.id && <form className="assign-form" onSubmit={async e => { e.preventDefault(); if (await run(() => adapter.assignTask(d.id, assignee, task))) setAssigning(null); }}>
          <label>Task <input value={task} onChange={e => setTask(e.target.value)} maxLength={200} required /></label>
          <label>Assign to <select value={assignee} onChange={e => setAssignee(e.target.value)} required>
            <option value="" disabled>Choose a teammate</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name} ({m.roles.map(roleLabel).join(', ')})</option>)}
          </select></label>
          <button className="primary" disabled={busy || !assignee || !task.trim()}>Assign</button>
        </form>}
      </li>)}
    </ul>}
    {error && <p role="alert" className="error">{error}</p>}
  </Panel>;
}

function TasksPanel({ data, adapter, onUpdate }: { data: Snapshot; adapter: IncidentData; onUpdate: (next: Snapshot) => void }) {
  const [run, busy, error] = useRun(onUpdate);
  const me = adapter.identity?.name;
  const mine = (t: Snapshot['tasks'][number]) => (t.ownerId && t.ownerId === adapter.identityHex) || t.owner === me;
  if (data.tasks.length === 0) return null;
  return <Panel icon={<ClipboardList size={18} aria-hidden="true" />} title="Assigned work">
    <ul className="team-list">{data.tasks.map(t => <li key={t.id}>
      <div className="team-row"><strong>{t.decisionId}</strong><span className={`state-chip state-${t.state}`}>{label(t.state)}</span></div>
      <p>{t.title}</p>
      <small className="muted">Assigned to {mine(t) ? 'you' : t.owner}</small>
      {mine(t) && t.state !== 'resolved' && <div className="action-row compact">
        {t.state === 'open' && <button className="secondary" disabled={busy} onClick={() => run(() => adapter.acceptTask(t.id))}>Accept</button>}
        <button className="secondary" disabled={busy} onClick={() => run(() => adapter.resolveTask(t.id))}>Mark verified<Check size={14} /></button>
      </div>}
    </li>)}</ul>
    {error && <p role="alert" className="error">{error}</p>}
  </Panel>;
}

function AddEvidence({ adapter, onUpdate }: { adapter: IncidentData; onUpdate: (next: Snapshot) => void }) {
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [run, busy, error] = useRun(onUpdate);
  return <Panel icon={<FilePlus2 size={18} aria-hidden="true" />} title="Add evidence" hint="Paste what you found. Nora (Nemotron) reads new evidence.">
    <form className="team-form" onSubmit={async e => { e.preventDefault(); if (await run(() => adapter.addEvidence({ title, source, text }))) { setTitle(''); setSource(''); setText(''); } }}>
      <label>Title <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required placeholder="Suspicious access on Sunday" /></label>
      <label>Source <input value={source} onChange={e => setSource(e.target.value)} maxLength={64} placeholder="Firewall logs" /></label>
      <label>What it shows <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={50000} required placeholder="An admin session from an unknown host at 03:12 Sunday…" /></label>
      <button className="primary" disabled={busy || !title.trim() || !text.trim()}>{busy ? 'Saving…' : 'Add evidence'}</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  </Panel>;
}

function RecordDecision({ data, adapter, onUpdate }: { data: Snapshot; adapter: IncidentData; onUpdate: (next: Snapshot) => void }) {
  const [title, setTitle] = useState('');
  const [assumption, setAssumption] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [run, busy, error] = useRun(onUpdate);
  return <Panel icon={<Gavel size={18} aria-hidden="true" />} title="Record a decision" hint="Write down the plan and the assumption it rests on, so new evidence can challenge it.">
    <form className="team-form" onSubmit={async e => { e.preventDefault(); if (await run(() => adapter.recordDecision({ title, assumption, evidenceIds: evidence }))) { setTitle(''); setAssumption(''); setEvidence([]); } }}>
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
