import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Send, ShieldOff, Sparkles } from 'lucide-react';
import { proposalForEvidence } from '../../shared/reassessment';
import { roleLabel, type Briefing as BriefingRecord, type Snapshot } from '../../shared/contracts';
import type { IncidentData } from '../data/interface';
import { label, localTime, Status } from '../components/ui';

export function Activity({ data }: { data: Snapshot }) {
  return <section className="activity" aria-label="Incident activity"><ol>{data.activity.map(a => <li key={a.id}><time>{localTime(a.at)}</time><div><p>{a.text}</p><small>{a.actor}</small></div></li>)}</ol></section>;
}
export function Briefing({ briefing }: { briefing: BriefingRecord }) {
  return <><div className="briefing-heading"><h3>{briefing.title}</h3></div>{briefing.state === 'outdated' && <p className="notice">A supporting decision needs review. Verify this briefing before sharing.</p>}<p className="briefing-copy">{briefing.text}</p><small className="muted">Depends on {briefing.decisionIds.join(', ')} · Original text retained</small></>;
}
export function Scope({ data }: { data: Snapshot }) {
  return <section className="scope-section"><p className="scope-notice">Encryption and exfiltration are separate findings. “Not observed” is not proof of absence.</p><div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable affected systems table"><table><caption className="sr-only">Affected systems and data scope</caption><thead><tr><th>System / data</th><th>Affected extent</th><th>Encryption</th><th>Exfiltration</th><th>Owner</th></tr></thead><tbody>{data.scope.map(s => <tr key={s.id}><td><strong>{s.system}</strong><small>{s.data}</small></td><td>{s.extent}</td><td><Status value={s.encryption} /></td><td><Status value={s.exfiltration} /></td><td>{s.owner}</td></tr>)}</tbody></table></div><small className="integration-note">Synthetic scope records · Updates and evidence linking await backend integration.</small></section>;
}
export function Administration({ data }: { data: Snapshot }) {
  return <><div className="access-notice"><ShieldOff size={22} /><div><h3>Access controls are not connected.</h3><p>These are synthetic memberships. Sign-in, admission, and revocation are unavailable in fixture mode.</p></div></div><div className="member-list">{data.members.map(m => <div className="member" key={m.id}><span className="avatar">{m.name.split(' ').map(s => s[0]).join('')}</span><div><strong>{m.name}</strong><small>{m.roles.map(roleLabel).join(', ')}</small></div><span className="routine-text">{m.active ? 'Active fixture' : 'Inactive fixture'}</span></div>)}</div><details className="context-details"><summary><span>Integration boundary</span><ChevronDown size={16} /></summary><div className="detail-content"><p>Spacetime stores membership privately. Its live read gate remains closed until independent identity, authorized reads, and subscription revocation pass verification.</p><p>Tiers stack: Tier 1 triages, Tier 2 contains and approves Nora’s fixes, Tier 3 does forensics and manages the team.</p></div></details></>;
}
export interface Draft { text: string; nonce: number }
const displayName = (name: string) => name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
const initials = (name: string) => displayName(name).split(' ').map(part => part[0]).join('');
const firstSentence = (text: string) => text.split(/(?<=[.!?])\s/)[0];
const REFERENCE = /\b([EDBP]-\d{3})\b/g;

/** Message text with record ids (E-002, D-001…) turned into chips; evidence and decision ids are clickable. */
function MessageText({ text, data, onOpenReference }: { text: string; data: Snapshot; onOpenReference?: (id: string) => void }) {
  const parts = text.split(REFERENCE);
  return <p>{parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const known = data.evidence.some(e => e.id === part) || data.decisions.some(d => d.id === part);
    return known && onOpenReference
      ? <button key={i} type="button" className="ref-chip" onClick={() => onOpenReference(part)} title={`Open ${part}`}>{part}</button>
      : <span key={i} className="ref-chip static">{part}</span>;
  })}</p>;
}

export function IncidentConversation({ evidenceId, data, adapter, onUpdate, draft, onOpenReference }: {
  evidenceId: string; data: Snapshot; adapter: IncidentData; onUpdate: (data: Snapshot) => void;
  /** Text handed over from elsewhere in the workspace, e.g. a "Discuss" button. A new nonce replaces the composer text. */
  draft?: Draft | null;
  onOpenReference?: (id: string) => void;
}) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Any active teammate other than yourself (the module allows any active member).
  const administrators = data.members.filter(member => member.active && member.id !== adapter.identityHex && member.name !== adapter.identity?.name);
  const [recipientId, setRecipientId] = useState<string | null>(administrators.length === 1 ? administrators[0].id : null);
  const [recipientPickerOpen, setRecipientPickerOpen] = useState(false);
  const selectedRecipient = administrators.find(member => member.id === recipientId);
  const messages = data.messages.filter(message => message.evidenceId === evidenceId);
  const evidence = data.evidence.find(item => item.id === evidenceId);
  const source = data.sources.find(s => s.id === evidence?.sourceId);
  const decision = data.decisions.find(d => d.evidenceIds.includes(evidenceId));
  const proposal = proposalForEvidence(data, evidenceId, decision?.id);
  const task = data.tasks.find(t => t.decisionId === decision?.id && t.proposalId === proposal?.id);
  const briefing = decision && data.briefings.find(b => b.decisionIds.includes(decision.id));
  const me = adapter.identity?.name;
  const participants = [...new Set([...messages.map(m => displayName(m.author)), ...messages.map(m => data.members.find(member => member.id === m.recipientId)?.name ?? ''), ...(selectedRecipient ? [selectedRecipient.name] : [])].filter(Boolean))];

  useEffect(() => {
    setRecipientId(administrators.length === 1 ? administrators[0].id : null);
    setRecipientPickerOpen(false);
    setError('');
    setText('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidenceId]);
  useEffect(() => {
    if (!draft) return;
    setText(draft.text);
    requestAnimationFrame(() => {
      textarea.current?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      textarea.current?.focus({ preventScroll: true });
    });
  }, [draft]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages.length]);

  const status = [
    `Status · ${evidenceId}: ${label(evidence?.standing ?? 'unknown')}${source?.trust === 'under_review' ? ', source under review' : ''}.`,
    decision && `${decision.id}: ${label(decision.state)}.`,
    `Verification: ${task ? `${task.owner} (${task.state})` : 'not assigned'}.`,
    briefing && `${briefing.id} team update: ${label(briefing.state)}.`,
  ].filter(Boolean).join(' ');
  const quickDrafts = [
    { label: 'Post status', text: status },
    ...(source?.trust === 'under_review' ? [{ label: 'Ask to verify source', text: `Can someone independently verify ${source.label}? ${firstSentence(source.reason)} Until then, treat ${evidenceId} as reported, not confirmed.` }] : []),
    ...(decision ? [{ label: 'Hold dependent actions', text: `${decision.id} “${decision.title}” relies on: ${decision.assumption} ${evidenceId} puts that in question. Please hold related actions until it is verified.` }] : []),
    ...(task?.state === 'open' ? [{ label: `Nudge ${task.owner.split(' ')[0]}`, text: `Reminder for ${task.owner}: “${task.title}” is still open (${decision?.id ?? evidenceId}).` }] : []),
  ];
  async function send() {
    if (busy || !selectedRecipient || !text.trim()) return;
    setBusy(true); setError('');
    try { onUpdate(await adapter.sendMessage(evidenceId, selectedRecipient.id, text)); setText(''); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="chat change-conversation comms" aria-labelledby={`${id}-heading`}>
    <header className="comms-header">
      <div>
        <h3 id={`${id}-heading`}>Discussion</h3>
        <p className="conversation-note">Pinned to <span className="ref-chip static">{evidenceId}</span> {evidence?.title ?? ''}. Messages stay with this item.</p>
      </div>
      {!!participants.length && <div className="comms-people" aria-label={`Participants: ${participants.join(', ')}`}>{participants.slice(0, 4).map(name => <span key={name} className="avatar" title={name}>{initials(name)}</span>)}</div>}
    </header>
    <div className="messages comms-log" role="log" aria-live="polite" ref={log}>
      {messages.length ? messages.map(m => {
        const recipient = data.members.find(member => member.id === m.recipientId)?.name ?? 'Administrator';
        const mine = !!me && displayName(m.author) === me;
        return <article key={m.id} className={`bubble ${mine ? 'mine' : ''} ${m.text.startsWith('Status ·') ? 'status-post' : ''}`}>
          <span className="avatar" aria-hidden="true">{initials(m.author)}</span>
          <div className="bubble-body">
            <div className="bubble-meta"><strong>{mine ? 'You' : displayName(m.author)}</strong><span>→ {recipient}</span><time>{localTime(m.at)}</time></div>
            <MessageText text={m.text} data={data} onOpenReference={onOpenReference} />
          </div>
        </article>;
      }) : <p className="empty">No messages on this item yet. Start with a quick draft below.</p>}
    </div>
    <div className="quick-drafts" role="group" aria-label="Quick drafts">
      <span><Sparkles size={13} aria-hidden="true" />Quick drafts</span>
      {quickDrafts.map(q => <button key={q.label} type="button" onClick={() => { setText(q.text); textarea.current?.focus(); }}>{q.label}</button>)}
    </div>
    <form onSubmit={e => { e.preventDefault(); void send(); }} aria-busy={busy}>
      <label htmlFor={`${id}-message`} className="sr-only">Message</label>
      <div className="composer">
        <textarea ref={textarea} id={`${id}-message`} required maxLength={2000} rows={3} value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
          placeholder={`Message about ${evidenceId}… Mention records like ${decision?.id ?? 'D-001'} to link them.`} />
        <div className="composer-bar">
          <div className="admin-recipient-picker">
            {administrators.length > 1 || !selectedRecipient
              ? <button type="button" className="recipient-chip" disabled={!administrators.length} aria-expanded={recipientPickerOpen} aria-controls={`${id}-admins`} onClick={() => setRecipientPickerOpen(open => !open)}>{selectedRecipient ? <>To: {selectedRecipient.name}</> : 'Choose recipient'}<ChevronDown size={14} /></button>
              : <span className="recipient-chip static">To: {selectedRecipient.name} · {selectedRecipient.roles.map(roleLabel).join(', ')}</span>}
            {recipientPickerOpen && <div id={`${id}-admins`} className="admin-recipient-options" role="group" aria-label="Choose a recipient">
              {administrators.map(admin => <button key={admin.id} type="button" aria-pressed={recipientId === admin.id} onClick={() => { setRecipientId(admin.id); setRecipientPickerOpen(false); setError(''); }}>
                <span className="avatar">{initials(admin.name)}</span><span><strong>{admin.name}</strong><small>{admin.roles.map(roleLabel).join(', ')}</small></span>
              </button>)}
            </div>}
          </div>
          <small className="composer-hint">{text.length ? `${text.length}/2000 · ` : ''}⌘/Ctrl + Enter to send</small>
          <button className="primary" disabled={busy || !text.trim() || !selectedRecipient}>{busy ? 'Sending…' : 'Send'}<Send size={15} /></button>
        </div>
      </div>
      {!administrators.length && <p className="recipient-selection" role="status">No other active teammates in this incident yet.</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {adapter.mode === 'fixture' && <small className="muted comms-footnote">Local demo · messages last until reload</small>}
    </form>
  </section>;
}
